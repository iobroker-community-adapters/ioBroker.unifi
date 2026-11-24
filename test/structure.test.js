'use strict';

// Object structure of version 3: device data like the official API, move of the objects of version 2

const assert = require('node:assert');
const sinon = require('sinon');
const { migrateFilterPath, migrateObjectId, prepareDevice } = require('../build/lib/structure');
const { createAdapter } = require('./lib/adapterMock');

const MAC = 'aa:bb:cc:dd:ee:ff';

describe('device data', () => {
    it('combines every port with its settings and keeps the original data', () => {
        const device = {
            mac: MAC,
            port_table: [
                { port_idx: 1, name: 'Port 1', poe_mode: 'auto' },
                { port_idx: 2, name: 'Port 2' },
            ],
            port_overrides: [{ port_idx: 1, name: 'Camera', poe_mode: 'auto', speed: 1000 }],
        };

        const prepared = prepareDevice(device);

        assert.deepStrictEqual(prepared.ports[0].settings, device.port_overrides[0]);
        assert.strictEqual(prepared.ports[1].settings, null);
        assert.strictEqual(prepared.ports[0].name, 'Port 1');
        // the PoE command still needs the original port_overrides
        assert.strictEqual(prepared.port_overrides, device.port_overrides);
        assert.strictEqual(device.ports, undefined);
    });

    it('combines the load and the usage of the system into statistics', () => {
        const prepared = prepareDevice({
            mac: MAC,
            sys_stats: { loadavg_1: '0.5', mem_total: 100 },
            'system-stats': { cpu: '12.3', mem: '45.6', uptime: '3600' },
        });

        assert.deepStrictEqual(prepared.statistics, {
            loadavg_1: '0.5',
            mem_total: 100,
            cpu: '12.3',
            mem: '45.6',
            uptime: '3600',
        });
        assert.strictEqual(prepareDevice({ mac: MAC }).statistics, undefined);
    });
});

describe('move of the objects of version 2', () => {
    it('knows the new ID of every moved object', () => {
        const dev = `default.devices.${MAC}`;
        const cases = {
            [`${dev}.port_table`]: `${dev}.ports`,
            [`${dev}.port_table.port_3`]: `${dev}.ports.port_3`,
            [`${dev}.port_table.port_3.port_poe_enabled`]: `${dev}.ports.port_3.poe_enabled`,
            [`${dev}.port_table.port_3.port_poe_cycle`]: `${dev}.ports.port_3.poe_cycle`,
            [`${dev}.port_table.port_3.port_poe`]: `${dev}.ports.port_3.poe`,
            [`${dev}.port_table.port_3.poe_power`]: `${dev}.ports.port_3.poe_power`,
            [`${dev}.port_overrides`]: null,
            [`${dev}.port_overrides.port_3`]: `${dev}.ports.port_3.settings`,
            [`${dev}.port_overrides.port_3.speed`]: `${dev}.ports.port_3.settings.speed`,
            [`${dev}.sys_stats.loadavg_5`]: `${dev}.statistics.loadavg_5`,
            [`${dev}.system-stats`]: `${dev}.statistics`,
            [`${dev}.system-stats.cpu`]: `${dev}.statistics.cpu`,
            [`${dev}.radio_table_stats.wifi0.channel`]: `${dev}.radios.wifi0.channel`,
            [`${dev}.last_uplink.remote_port`]: `${dev}.uplink.remote_port`,
            'default.wan.wan': 'default.wan.wan1',
            'default.wan.wan.today_rx_bytes': 'default.wan.wan1.today_rx_bytes',
            'default.alarms': null,
            'default.alarms.alarm_123.message': null,
            'default.gateway_traffic.aa:bb.day_0.sent': null,
            [`default.clients.${MAC}.uptime_by_uap`]: null,
            [`default.clients.${MAC}.is_guest_by_usw`]: null,
            [`default.clients.${MAC}.last_seen_by_ugw`]: null,
        };
        for (const [oldId, newId] of Object.entries(cases)) {
            assert.strictEqual(migrateObjectId(oldId), newId, oldId);
        }
    });

    it('leaves the unchanged objects alone', () => {
        for (const id of [
            'default',
            'info.connection',
            `default.devices.${MAC}.name`,
            `default.devices.${MAC}.wan1.ip`,
            `default.devices.${MAC}.ports.port_3.poe_enabled`,
            `default.clients.${MAC}.last_seen_by_uap`,
            'default.wan.wan2.up',
            'default.health.wan.status',
        ]) {
            assert.strictEqual(migrateObjectId(id), undefined, id);
        }
    });

    it('moves the paths of the states filter', () => {
        assert.strictEqual(migrateFilterPath('devices.device.port_overrides'), 'devices.device.ports.port.settings');
        assert.strictEqual(
            migrateFilterPath('devices.device.port_table.port.port_poe'),
            'devices.device.ports.port.poe',
        );
        assert.strictEqual(migrateFilterPath('alarms.alarm.message'), null);
        assert.strictEqual(migrateFilterPath('clients.client.uptime_by_ugw'), null);
        assert.strictEqual(migrateFilterPath('clients.client.name'), undefined);
    });
});

describe('move of the objects at the first refresh', () => {
    const ns = 'unifi.0';
    const dev = `${ns}.default.devices.${MAC}`;
    const history = { 'influxdb.0': { enabled: true } };

    function setObject(adapter, id, common = {}) {
        adapter.objects.set(id, { _id: id, type: 'state', common, native: {} });
        adapter.states.set(id, { val: 1, ack: true });
    }

    it('moves the history settings and rooms, then deletes the old objects', async () => {
        const adapter = createAdapter();
        setObject(adapter, `${dev}.port_table.port_1.poe_power`, { custom: history });
        setObject(adapter, `${dev}.port_table.port_1.speed`);
        setObject(adapter, `${dev}.ports.port_1.poe_power`);
        setObject(adapter, `${dev}.ports.port_1.speed`);
        setObject(adapter, `${ns}.default.alarms.alarm_1.message`);
        adapter.objects.set('enum.rooms.office', {
            _id: 'enum.rooms.office',
            type: 'enum',
            common: { members: [`${dev}.port_table.port_1.speed`, 'hm-rpc.0.ABC'] },
        });

        await adapter.migrateObjects();

        assert.deepStrictEqual(adapter.objects.get(`${dev}.ports.port_1.poe_power`).common.custom, history);
        assert.deepStrictEqual(adapter.objects.get('enum.rooms.office').common.members, [
            `${dev}.ports.port_1.speed`,
            'hm-rpc.0.ABC',
        ]);
        assert.ok(![...adapter.objects.keys()].some(id => id.includes('port_table') || id.includes('alarms')));
        assert.strictEqual(adapter.states.has(`${dev}.port_table.port_1.speed`), false);
        assert.ok(adapter.log.info.calledWith(sinon.match(/3 old objects deleted.*history settings of 1 states/)));
    });

    it('keeps an old object with history settings whose new object does not exist', async () => {
        const adapter = createAdapter();
        setObject(adapter, `${dev}.system-stats.cpu`, { custom: history });
        setObject(adapter, `${dev}.system-stats.mem`);

        await adapter.migrateObjects();

        assert.ok(adapter.objects.has(`${dev}.system-stats.cpu`));
        assert.strictEqual(adapter.objects.has(`${dev}.system-stats.mem`), false);
        assert.ok(adapter.log.warn.calledWith(sinon.match(/1 old objects with history settings were kept/)));
    });

    it('deletes removed objects even with history settings', async () => {
        const adapter = createAdapter();
        setObject(adapter, `${ns}.default.gateway_traffic.aa.day_0.sent`, { custom: history });

        await adapter.migrateObjects();

        assert.strictEqual(adapter.objects.has(`${ns}.default.gateway_traffic.aa.day_0.sent`), false);
        assert.ok(adapter.log.warn.notCalled);
    });

    it('does nothing for the objects of version 3', async () => {
        const adapter = createAdapter();
        setObject(adapter, `${dev}.ports.port_1.speed`);

        await adapter.migrateObjects();

        assert.ok(adapter.objects.has(`${dev}.ports.port_1.speed`));
        assert.ok(adapter.log.info.notCalled);
    });
});
