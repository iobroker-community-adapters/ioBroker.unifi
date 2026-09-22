'use strict';

// The adapter with the real node-unifi against a fake UniFi OS controller

const assert = require('node:assert');
const { createAdapter } = require('./lib/adapterMock');
const { FakeController } = require('./lib/fakeController');

const now = Math.floor(Date.now() / 1000);

const CLIENTS = [
    {
        mac: 'aa:bb:cc:dd:ee:01',
        ip: '192.168.1.10',
        name: 'Laptop',
        hostname: 'laptop',
        essid: 'Home WiFi',
        channel: '36',
        is_wired: false,
        first_seen: now - 3600,
        last_seen: now,
        _last_seen_by_uap: now,
    },
    // without IP, a client gets no objects
    { mac: 'aa:bb:cc:dd:ee:02', hostname: 'no-ip', last_seen: now },
];

const WLANS = [{ _id: 'wlan1', name: 'Home WiFi', enabled: true, security: 'wpapsk' }];

describe('adapter with a UniFi OS controller', function () {
    this.timeout(20000);

    let controller;
    let adapter;

    /**
     * Load the configuration like on start, but let the tests run the refreshes
     *
     * @param {Record<string, any>} [config] additional settings
     */
    async function startAdapter(config = {}) {
        adapter = createAdapter({
            controllerIp: '127.0.0.1',
            controllerPort: await controller.listen(),
            controllerUsername: 'user',
            controllerPassword: 'secret',
            ignoreSSLErrors: true,
            updateSysinfo: false,
            updateClients: true,
            updateDevices: false,
            updateWlans: true,
            updateNetworks: false,
            updateHealth: false,
            updateVouchers: false,
            updateAlarms: false,
            ...config,
        });
        adapter.updateUnifiData = async () => {};
        await adapter.onReady();
        delete adapter.updateUnifiData;
    }

    beforeEach(() => {
        controller = new FakeController();
        controller.responses['stat/sta'] = CLIENTS;
        controller.responses['rest/wlanconf'] = WLANS;
    });

    afterEach(async () => {
        adapter?.stopTimers();
        await controller.close();
    });

    it('creates the objects and states from the controller data', async () => {
        await startAdapter();
        await adapter.updateUnifiData(true);

        assert.strictEqual(controller.logins, 1);
        assert.strictEqual(adapter.val('info.connection'), true);
        assert.strictEqual(adapter.val('info.lastError'), '');

        // site
        assert.strictEqual(adapter.objects.get('unifi.0.default').type, 'device');

        // client, with the value types of the definitions
        const client = 'default.clients.aa:bb:cc:dd:ee:01';
        assert.strictEqual(adapter.objects.get(`unifi.0.${client}`).common.name, 'Laptop');
        assert.strictEqual(adapter.val(`${client}.ip`), '192.168.1.10');
        assert.strictEqual(adapter.val(`${client}.channel`), 36);
        assert.strictEqual(adapter.val(`${client}.is_wired`), false);
        assert.match(adapter.val(`${client}.last_seen`), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
        assert.strictEqual(adapter.val(`${client}.is_online`), true);
        assert.strictEqual(adapter.objects.has('unifi.0.default.clients.aa:bb:cc:dd:ee:02'), false);

        // WLAN, the ID is cleaned up
        assert.strictEqual(adapter.val('default.wlans.home_wifi.enabled'), true);
        assert.strictEqual(adapter.objects.get('unifi.0.default.wlans.home_wifi.enabled').native.wlan_id, 'wlan1');
    });

    it('logs in again when the session expired', async () => {
        await startAdapter();
        await adapter.updateUnifiData(true);
        controller.expireSession();

        await adapter.updateUnifiData(true);

        assert.strictEqual(controller.logins, 2);
        assert.strictEqual(adapter.val('info.connection'), true);
        assert.strictEqual(adapter.val('info.consecutiveErrors'), 0);
    });

    it('creates vouchers with the configured settings', async () => {
        // the old admin page stored numbers as text
        await startAdapter({
            createVouchersNumber: '2',
            createVouchersDuration: '120',
            createVouchersQuota: '1',
            createVouchersNote: 'Guests',
        });
        await adapter.updateUnifiData(true);
        controller.responses['cmd/hotspot'] = [{ create_time: now }];

        await adapter.onStateChange('unifi.0.default.vouchers.create_vouchers', { val: true, ack: false });

        const [request] = controller.requestsTo('cmd/hotspot');
        assert.deepStrictEqual(request.body, {
            cmd: 'create-voucher',
            expire: 120,
            n: 2,
            quota: 1,
            note: 'Guests',
            up: 0,
            down: 0,
            bytes: 0,
        });
        assertNoErrors(adapter);
    });

    it('enables and disables a WLAN', async () => {
        await startAdapter();
        await adapter.updateUnifiData(true);

        await adapter.onStateChange('unifi.0.default.wlans.home_wifi.enabled', { val: false, ack: false });

        const [request] = controller.requestsTo('rest/wlanconf/wlan1');
        assert.strictEqual(request.method, 'PUT');
        assert.deepStrictEqual(request.body, { enabled: false });
        assertNoErrors(adapter);
    });

    it('reports an endpoint that returns invalid data without losing the connection', async () => {
        await startAdapter();
        controller.responses['rest/wlanconf'] = () => ({ invalid: true });

        await adapter.updateUnifiData(true);

        assert.strictEqual(adapter.val('info.connection'), true);
        assert.match(adapter.val('info.lastError'), /fetchWlans \(default\): .*not in valid format/);
        assert.strictEqual(adapter.val('default.clients.aa:bb:cc:dd:ee:01.ip'), '192.168.1.10');
    });
});

/**
 * The adapter logged no errors
 *
 * @param {any} adapter
 */
function assertNoErrors(adapter) {
    assert.deepStrictEqual(
        adapter.log.error.getCalls().map(call => call.args[0]),
        [],
    );
}
