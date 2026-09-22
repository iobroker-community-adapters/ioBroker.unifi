'use strict';

// Creating objects and states from the controller data with the definitions in admin/lib/objects_*.json

const assert = require('node:assert');
const sinon = require('sinon');
const { createAdapter } = require('./lib/adapterMock');

const now = Math.floor(Date.now() / 1000);

function client(n, extra = {}) {
    return {
        mac: `aa:bb:cc:dd:ee:0${n}`,
        ip: `192.168.1.${n}`,
        name: `Client ${n}`,
        hostname: `client${n}`,
        last_seen: now,
        ...extra,
    };
}

describe('object creation', () => {
    let adapter;

    beforeEach(() => {
        adapter = createAdapter();
    });

    it('writes objects and states only when they changed', async () => {
        const wlans = [{ _id: 'wlan1', name: 'Home WiFi', enabled: true, security: 'wpapsk' }];

        await adapter.processWlans('default', wlans);
        const objectWrites = adapter.extendObjectAsync.callCount;
        const stateWrites = adapter.setStateAsync.callCount;
        assert.ok(objectWrites > 0);
        assert.strictEqual(adapter.val('default.wlans.home_wifi.security'), 'wpapsk');

        await adapter.processWlans('default', wlans);
        assert.strictEqual(adapter.extendObjectAsync.callCount, objectWrites);
        assert.strictEqual(adapter.setStateAsync.callCount, stateWrites);

        await adapter.processWlans('default', [{ ...wlans[0], security: 'open' }]);
        assert.strictEqual(adapter.extendObjectAsync.callCount, objectWrites);
        assert.strictEqual(adapter.setStateAsync.callCount, stateWrites + 1);
        assert.strictEqual(adapter.val('default.wlans.home_wifi.security'), 'open');
    });

    it('converts the values to the type of the state', async () => {
        await adapter.processClients('default', [client(1, { channel: '36', is_wired: 'true', hostname: 1234 })]);

        const id = 'default.clients.aa:bb:cc:dd:ee:01';
        assert.strictEqual(adapter.val(`${id}.channel`), 36);
        assert.strictEqual(adapter.val(`${id}.is_wired`), true);
        assert.strictEqual(adapter.val(`${id}.hostname`), '1234');
    });

    it('creates only the selected states', async () => {
        adapter.statesFilter = adapter.normalizeStatesFilter({ clients: ['clients.client.ip'] });

        await adapter.processClients('default', [client(1)]);

        const ids = [...adapter.objects.keys()].filter(id => id.includes('.clients.'));
        assert.deepStrictEqual(ids.sort(), [
            'unifi.0.default.clients.aa:bb:cc:dd:ee:01',
            'unifi.0.default.clients.aa:bb:cc:dd:ee:01.ip',
        ]);
    });

    it('skips the clients of the objects filter', async () => {
        adapter.objectsFilter.clients = ['Client 1', '192.168.1.2'];

        await adapter.processClients('default', [client(1), client(2), client(3)]);

        assert.strictEqual(adapter.val('default.clients.aa:bb:cc:dd:ee:01.ip'), undefined);
        assert.strictEqual(adapter.val('default.clients.aa:bb:cc:dd:ee:02.ip'), undefined);
        assert.strictEqual(adapter.val('default.clients.aa:bb:cc:dd:ee:03.ip'), '192.168.1.3');
    });

    it('creates only the clients of the objects filter in whitelist mode', async () => {
        adapter.update.blacklist = true;
        adapter.objectsFilter.clients = ['aa:bb:cc:dd:ee:02', 'client3'];

        await adapter.processClients('default', [client(1), client(2), client(3)]);

        assert.strictEqual(adapter.val('default.clients.aa:bb:cc:dd:ee:01.ip'), undefined);
        assert.strictEqual(adapter.val('default.clients.aa:bb:cc:dd:ee:02.ip'), '192.168.1.2');
        assert.strictEqual(adapter.val('default.clients.aa:bb:cc:dd:ee:03.ip'), '192.168.1.3');
    });

    it('skips the WLANs of the objects filter', async () => {
        adapter.objectsFilter.wlans = ['Guests'];

        await adapter.processWlans('default', [
            { _id: 'w1', name: 'Home', enabled: true },
            { _id: 'w2', name: 'Guests', enabled: true },
        ]);

        assert.strictEqual(adapter.val('default.wlans.home.enabled'), true);
        assert.strictEqual(adapter.val('default.wlans.guests.enabled'), undefined);
    });

    it('deletes the used vouchers when only unused vouchers are shown', async () => {
        const vouchers = [
            { code: '1111122222', used: 0, quota: 1, duration: 60, status: 'VALID_ONE', create_time: now },
            { code: '3333344444', used: 1, quota: 1, duration: 60, status: 'USED', create_time: now },
        ];
        await adapter.processVouchers('default', vouchers);
        assert.ok(adapter.objects.has('unifi.0.default.vouchers.voucher_3333344444.code'));

        adapter.update.vouchersNoUsed = true;
        await adapter.processVouchers('default', vouchers);

        assert.ok(adapter.objects.has('unifi.0.default.vouchers.voucher_1111122222.code'));
        assert.ok(![...adapter.objects.keys()].some(id => id.includes('voucher_3333344444')));
        assert.strictEqual(adapter.val('default.vouchers.voucher_3333344444.code'), undefined);
    });

    it('deletes the alarms that are gone when only new alarms are shown', async () => {
        const alarm = (id, extra = {}) => ({
            _id: id,
            key: 'EVT_AP_Lost_Contact',
            msg: 'AP[aa:bb:cc:dd:ee:10] was disconnected',
            ap: 'aa:bb:cc:dd:ee:10',
            ap_name: 'Office AP',
            time: Date.now(),
            archived: false,
            ...extra,
        });
        await adapter.processAlarms('default', [alarm('a1'), alarm('a2')]);
        assert.strictEqual(adapter.val('default.alarms.alarm_a2.message'), 'AP - Office AP: was disconnected');

        adapter.update.alarmsNoArchived = true;
        await adapter.processAlarms('default', [alarm('a1')]);

        assert.ok(adapter.objects.has('unifi.0.default.alarms.alarm_a1.message'));
        assert.ok(![...adapter.objects.keys()].some(id => id.includes('alarm_a2')));
    });
});

describe('client status', () => {
    let adapter;

    const timestamp = secondsAgo => {
        const date = new Date(Date.now() - secondsAgo * 1000);
        const pad = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    };

    beforeEach(() => {
        adapter = createAdapter();
        adapter.settings.updateInterval = 60 * 1000;
        adapter.clients.isOnlineOffset = 30 * 1000;
    });

    it('calculates is_online from the time the client was seen last', async () => {
        const c = 'unifi.0.default.clients';
        adapter.states.set(`${c}.recent.last_seen_by_uap`, { val: timestamp(10), ack: true });
        adapter.states.set(`${c}.recent.is_online`, { val: false, ack: true });
        adapter.states.set(`${c}.old.last_seen_by_usw`, { val: timestamp(3600), ack: true });
        adapter.states.set(`${c}.old.is_online`, { val: true, ack: true });
        // Wireless clients may be reported as wired too: the wireless timestamp wins
        adapter.states.set(`${c}.both.last_seen_by_uap`, { val: timestamp(3600), ack: true });
        adapter.states.set(`${c}.both.last_seen_by_usw`, { val: timestamp(10), ack: true });
        adapter.states.set(`${c}.both.is_online`, { val: true, ack: true });

        await adapter.setClientOnlineStatus();

        assert.strictEqual(adapter.val(`${c}.recent.is_online`), true);
        assert.strictEqual(adapter.val(`${c}.old.is_online`), false);
        assert.strictEqual(adapter.val(`${c}.both.is_online`), false);
    });

    it('sets is_online of a new client only if the object exists', async () => {
        const c = 'unifi.0.default.clients';
        adapter.states.set(`${c}.withobject.last_seen_by_uap`, { val: timestamp(10), ack: true });
        adapter.objects.set(`${c}.withobject.is_online`, { type: 'state', common: {}, native: {} });
        adapter.states.set(`${c}.noobject.last_seen_by_uap`, { val: timestamp(10), ack: true });

        await adapter.setClientOnlineStatus();

        assert.strictEqual(adapter.val(`${c}.withobject.is_online`), true);
        assert.strictEqual(adapter.states.has(`${c}.noobject.is_online`), false);
    });

    it('sets the blocked state of the clients', async () => {
        adapter.statesFilter = adapter.normalizeStatesFilter({ clients: ['clients.client.blocked'] });
        adapter.controllers.default = {
            getBlockedUsers: sinon.stub().resolves([{ mac: 'aa:bb:cc:dd:ee:01' }]),
        };
        adapter.states.set('unifi.0.default.clients.aa:bb:cc:dd:ee:01.blocked', { val: false, ack: true });
        adapter.states.set('unifi.0.default.clients.aa:bb:cc:dd:ee:02.blocked', { val: true, ack: true });

        await adapter.processBlockedClients('default');

        assert.strictEqual(adapter.val('default.clients.aa:bb:cc:dd:ee:01.blocked'), true);
        assert.strictEqual(adapter.val('default.clients.aa:bb:cc:dd:ee:02.blocked'), false);
    });

    it('does not request the blocked clients if the state is not selected', async () => {
        adapter.statesFilter = adapter.normalizeStatesFilter({ clients: ['clients.client.ip'] });
        adapter.controllers.default = { getBlockedUsers: sinon.stub().resolves([]) };

        await adapter.processBlockedClients('default');

        sinon.assert.notCalled(adapter.controllers.default.getBlockedUsers);
    });
});
