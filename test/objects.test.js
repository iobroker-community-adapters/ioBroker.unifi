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

});

describe('client status', () => {
    let adapter;

    const timestamp = secondsAgo => Date.now() - secondsAgo * 1000;

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

    it('creates the blocked state also for wired clients, reconnect only for wireless clients', async () => {
        await adapter.processClients('default', [
            client(1, { is_wired: true }),
            client(2, { is_wired: false, essid: 'Home WiFi' }),
        ]);

        const wired = 'unifi.0.default.clients.aa:bb:cc:dd:ee:01';
        const wireless = 'unifi.0.default.clients.aa:bb:cc:dd:ee:02';
        assert.strictEqual(adapter.objects.get(`${wired}.blocked`)?.common.role, 'switch');
        assert.ok(adapter.objects.has(`${wireless}.blocked`));
        assert.strictEqual(adapter.objects.has(`${wired}.reconnect`), false);
        assert.ok(adapter.objects.has(`${wireless}.reconnect`));
    });

    it('creates the current rates, the WLAN link speed and power save of the clients', async () => {
        await adapter.processClients('default', [
            client(1, { is_wired: true, 'wired-tx_bytes-r': 1500 }),
            client(2, {
                is_wired: false,
                essid: 'Home WiFi',
                'rx_bytes-r': 250,
                tx_rate: 65000,
                rx_rate: 144400,
                powersave_enabled: false,
            }),
        ]);

        const wired = 'default.clients.aa:bb:cc:dd:ee:01';
        const wireless = 'default.clients.aa:bb:cc:dd:ee:02';
        assert.strictEqual(adapter.val(`${wired}.wired-tx_bytes-r`), 1500);
        // the controller leaves the rate out while a client sends nothing
        assert.strictEqual(adapter.val(`${wired}.wired-rx_bytes-r`), 0);
        assert.strictEqual(adapter.objects.has(`unifi.0.${wired}.tx_bytes-r`), false);
        assert.strictEqual(adapter.objects.has(`unifi.0.${wired}.tx_rate`), false);

        assert.strictEqual(adapter.val(`${wireless}.rx_bytes-r`), 250);
        assert.strictEqual(adapter.val(`${wireless}.tx_bytes-r`), 0);
        assert.strictEqual(adapter.val(`${wireless}.tx_rate`), 65);
        assert.strictEqual(adapter.val(`${wireless}.rx_rate`), 144.4);
        assert.strictEqual(adapter.val(`${wireless}.powersave_enabled`), false);
        assert.strictEqual(adapter.objects.get(`unifi.0.${wireless}.tx_rate`)?.common.unit, 'Mbit/s');
        assert.strictEqual(adapter.objects.has(`unifi.0.${wireless}.wired-tx_bytes-r`), false);
    });

    it('creates the WAN ports of a gateway with addresses, status and link', async () => {
        // as reported by a UDM Pro: WAN 1 via PPPoE on SFP+ 1, WAN 2 configured on port 9 without cable
        const gateway = {
            mac: 'aa:bb:cc:00:00:01',
            name: 'UDM Pro',
            type: 'udm',
            wan1: {
                ifname: 'eth9',
                uplink_ifname: 'ppp0',
                port_idx: 10,
                up: true,
                ip: '203.0.113.10',
                ipv6: ['2001:db8::10', 'fe80::1'],
                speed: 1000,
                latency: 2,
                availability: 100,
            },
            wan2: { ifname: 'eth8', uplink_ifname: 'eth8', port_idx: 9, up: false, ipv6: [], speed: 10 },
        };
        const accessPoint = { mac: 'aa:bb:cc:00:00:02', name: 'AP', type: 'uap' };

        await adapter.processDevices('default', [gateway, accessPoint]);

        const wan1 = 'default.devices.aa:bb:cc:00:00:01.wan1';
        assert.strictEqual(adapter.val(`${wan1}.ip`), '203.0.113.10');
        assert.strictEqual(adapter.val(`${wan1}.ipv6`), '2001:db8::10, fe80::1');
        assert.strictEqual(adapter.val(`${wan1}.up`), true);
        assert.strictEqual(adapter.val(`${wan1}.port`), 10);
        assert.strictEqual(adapter.val(`${wan1}.interface`), 'ppp0');
        assert.strictEqual(adapter.val(`${wan1}.speed`), 1000);
        assert.strictEqual(adapter.val(`${wan1}.latency`), 2);
        assert.strictEqual(adapter.val(`${wan1}.availability`), 100);
        assert.strictEqual(adapter.objects.get(`unifi.0.${wan1}`)?.common.name, 'WAN 1');
        assert.strictEqual(adapter.objects.get(`unifi.0.${wan1}.ip`)?.common.role, 'info.ip');
        assert.strictEqual(adapter.objects.get(`unifi.0.${wan1}.up`)?.common.role, 'indicator.reachable');
        assert.strictEqual(adapter.objects.get(`unifi.0.${wan1}.latency`)?.common.unit, 'ms');

        // without connection: no address, no latency and availability
        const wan2 = 'default.devices.aa:bb:cc:00:00:01.wan2';
        assert.strictEqual(adapter.val(`${wan2}.up`), false);
        assert.strictEqual(adapter.val(`${wan2}.port`), 9);
        assert.strictEqual(adapter.val(`${wan2}.ip`), null);
        assert.strictEqual(adapter.val(`${wan2}.ipv6`), '');
        assert.strictEqual(adapter.objects.has(`unifi.0.${wan2}.latency`), false);
        assert.strictEqual(adapter.objects.has(`unifi.0.${wan2}.availability`), false);

        assert.strictEqual(adapter.objects.has('unifi.0.default.devices.aa:bb:cc:00:00:02.wan1'), false);
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

    it('sets the blocked state also if all states are selected (empty filter)', async () => {
        adapter.statesFilter = adapter.normalizeStatesFilter({ clients: [] });
        adapter.controllers.default = {
            getBlockedUsers: sinon.stub().resolves([{ mac: 'AA:BB:CC:DD:EE:01' }]),
        };
        adapter.states.set('unifi.0.default.clients.aa:bb:cc:dd:ee:01.blocked', { val: false, ack: true });

        await adapter.processBlockedClients('default');

        assert.strictEqual(adapter.val('default.clients.aa:bb:cc:dd:ee:01.blocked'), true);
    });

    it('keeps the blocked clients of the other sites', async () => {
        adapter.statesFilter = adapter.normalizeStatesFilter({ clients: ['clients.client.blocked'] });
        adapter.controllers.office = { getBlockedUsers: sinon.stub().resolves([]) };
        adapter.states.set('unifi.0.default.clients.aa:bb:cc:dd:ee:01.blocked', { val: true, ack: true });
        adapter.states.set('unifi.0.office.clients.aa:bb:cc:dd:ee:02.blocked', { val: true, ack: true });

        await adapter.processBlockedClients('office');

        assert.strictEqual(adapter.val('default.clients.aa:bb:cc:dd:ee:01.blocked'), true);
        assert.strictEqual(adapter.val('office.clients.aa:bb:cc:dd:ee:02.blocked'), false);
    });

    it('writes the blocked state only when it changed', async () => {
        adapter.statesFilter = adapter.normalizeStatesFilter({ clients: ['clients.client.blocked'] });
        adapter.controllers.default = { getBlockedUsers: sinon.stub().resolves([]) };
        adapter.states.set('unifi.0.default.clients.aa:bb:cc:dd:ee:01.blocked', { val: false, ack: true });
        adapter.setStateAsync.resetHistory();

        await adapter.processBlockedClients('default');

        sinon.assert.notCalled(adapter.setStateAsync);
    });

    it('does not request the blocked clients if the state is not selected', async () => {
        adapter.statesFilter = adapter.normalizeStatesFilter({ clients: ['clients.client.ip'] });
        adapter.controllers.default = { getBlockedUsers: sinon.stub().resolves([]) };

        await adapter.processBlockedClients('default');

        sinon.assert.notCalled(adapter.controllers.default.getBlockedUsers);
    });
});

describe('device structure of version 3', () => {
    let adapter;

    beforeEach(() => {
        adapter = createAdapter();
    });

    // shortened data of a UniFi Network 11.1 console
    const ACCESS_POINT = {
        mac: '78:45:58:60:46:ec',
        name: 'OG',
        ip: '192.168.1.75',
        model: 'UAL6',
        type: 'uap',
        device_id: 'f1cebf47',
        port_table: [{ port_idx: 1, name: 'Port 1', enable: true }],
        sys_stats: { loadavg_1: '0.82', loadavg_15: '0.82', loadavg_5: '0.83', mem_total: 259813376, mem_used: 80490496 },
        'system-stats': { cpu: '1.9', mem: '31.0', uptime: '928048' },
        radio_table_stats: [
            { name: 'ra0', radio: 'ng', channel: 11, tx_power: 17 },
            { name: 'rai0', radio: 'na', channel: 100, tx_power: 23 },
        ],
        last_uplink: {
            type: 'wire',
            port_idx: 1,
            uplink_mac: '74:ac:b9:ab:8e:f0',
            uplink_device_name: 'USW Pro 24 PoE',
            uplink_remote_port: 18,
        },
        state: 1,
    };
    const SWITCH = {
        mac: '74:ac:b9:ab:8e:f0',
        name: 'USW Pro 24 PoE',
        ip: '192.168.1.243',
        model: 'US24PRO',
        type: 'usw',
        device_id: 'ab976379',
        port_table: [
            { port_idx: 1, name: 'Port 1', enable: true, port_poe: true, poe_mode: 'auto', poe_power: '4.25', speed: 1000 },
            { port_idx: 2, name: 'Port 2', enable: true, port_poe: true, poe_mode: 'off', speed: 0 },
        ],
        port_overrides: [{ port_idx: 1, name: 'Camera', poe_mode: 'auto', isolation: false, full_duplex: true }],
    };

    it('creates ports with their settings, statistics, radios and uplink', async () => {
        await adapter.processDevices('default', [ACCESS_POINT, SWITCH]);

        const ap = 'default.devices.78:45:58:60:46:ec';
        assert.strictEqual(adapter.val(`${ap}.statistics.cpu`), 1.9);
        assert.strictEqual(adapter.val(`${ap}.statistics.loadavg_5`), 0.83);
        assert.strictEqual(adapter.val(`${ap}.statistics.mem_total`), 259813376);
        assert.strictEqual(adapter.objects.get(`unifi.0.${ap}.radios.ra0`).common.name, '2.4 GHz');
        assert.strictEqual(adapter.objects.get(`unifi.0.${ap}.radios.rai0`).common.name, '5 GHz');
        assert.strictEqual(adapter.val(`${ap}.radios.rai0.channel`), 100);
        assert.strictEqual(adapter.val(`${ap}.uplink.name`), 'USW Pro 24 PoE');
        assert.strictEqual(adapter.val(`${ap}.uplink.remote_port`), 18);
        assert.strictEqual(adapter.objects.has(`unifi.0.${ap}.ports.port_1.settings`), false);

        const sw = 'default.devices.74:ac:b9:ab:8e:f0';
        assert.strictEqual(adapter.val(`${sw}.ports.port_1.poe_enabled`), true);
        assert.strictEqual(adapter.val(`${sw}.ports.port_2.poe_enabled`), false);
        assert.strictEqual(adapter.val(`${sw}.ports.port_1.poe_power`), 4.25);
        assert.strictEqual(adapter.objects.get(`unifi.0.${sw}.ports.port_1.poe_enabled`).common.role, 'switch.power');
        assert.ok(adapter.objects.has(`unifi.0.${sw}.ports.port_1.poe_cycle`));
        assert.strictEqual(adapter.val(`${sw}.ports.port_1.settings.name`), 'Camera');
        assert.strictEqual(adapter.val(`${sw}.ports.port_1.settings.full_duplex`), true);
        assert.strictEqual(adapter.objects.has(`unifi.0.${sw}.ports.port_2.settings`), false);

        // nothing of the structure of version 2
        assert.ok(
            ![...adapter.objects.keys()].some(id =>
                /port_table|port_overrides|sys_stats|system-stats|radio_table_stats|last_uplink/.test(id),
            ),
        );
    });
});
