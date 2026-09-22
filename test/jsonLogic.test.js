'use strict';

// The json-logic operations and the helpers for the object definitions

const assert = require('node:assert');
const { applyRule } = require('../build/lib/jsonLogic');
const { buildStateOptions, collectStateIds, loadObjectDefinitions } = require('../build/lib/objectDefinitions');

describe('json-logic operations', () => {
    it('reads a property by its name', () => {
        assert.strictEqual(applyRule('mac', { mac: 'aa:bb' }), 'aa:bb');
        assert.strictEqual(applyRule('missing', { mac: 'aa:bb' }), null);
    });

    it('formats dates in local time', () => {
        const date = new Date(2024, 0, 2, 3, 4, 5);

        assert.strictEqual(applyRule({ timestampToDate: [date.getTime()] }), '2024-01-02');
        assert.strictEqual(applyRule({ timestampToDateTime: [date.getTime()] }), '2024-01-02 03:04:05');
        assert.strictEqual(
            applyRule({ secondsToDateTime: [Math.floor(date.getTime() / 1000)] }),
            '2024-01-02 03:04:05',
        );
    });

    it('throws for invalid dates, like dateformat did', () => {
        assert.throws(() => applyRule({ timestampToDate: ['no date'] }), /Invalid date/);
    });

    it('converts seconds to hours', () => {
        assert.strictEqual(applyRule({ secondsToHours: [0] }), '0:00');
        assert.strictEqual(applyRule({ secondsToHours: [65] }), '1:05');
    });

    it('adds the days since a timestamp', () => {
        const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000 - 1000;

        assert.strictEqual(applyRule({ timestampDiffInDaysToNow: [10, threeDaysAgo] }), 13);
    });

    it('cleans up IDs', () => {
        assert.strictEqual(applyRule({ cleanupForUseAsId: ['My WiFi [5.0 GHz]*'] }), 'my_wifi__5_0_ghz__');
        assert.strictEqual(applyRule({ cleanupForUseAsId: ['AA:BB:CC:DD:EE:FF'] }), 'aa:bb:cc:dd:ee:ff');
        assert.strictEqual(applyRule({ cleanupForUseAsId: [null] }), null);
    });

    it('chooses values depending on null', () => {
        assert.strictEqual(applyRule({ ifNotNull: [{ var: 'ip' }, 'ip', null] }, { ip: '1.2.3.4' }), 'ip');
        assert.strictEqual(applyRule({ ifNotNull: [{ var: 'ip' }, 'ip', null] }, {}), null);
        assert.strictEqual(applyRule({ ifNotNullBoolisTrue: [false, 'yes', 'no'] }), 'no');
        assert.strictEqual(applyRule({ ifNotNullBoolisTrue: [true, 'yes', 'no'] }), 'yes');
        assert.strictEqual(applyRule({ notNull: [0] }), true);
    });

    it('translates the PoE mode', () => {
        assert.strictEqual(applyRule({ poeMode: ['auto'] }), true);
        assert.strictEqual(applyRule({ poeMode: ['off'] }), false);
        assert.strictEqual(applyRule({ poeMode: [null] }), false);
    });

    it('replaces the device placeholder in alarm messages with its name', () => {
        const message = (msg, mac, name) => applyRule({ alarmPrepareMessage: [msg, mac, name] });

        assert.strictEqual(message('{gw} restarted', 'aa', 'Gateway'), 'Gateway: restarted');
        assert.strictEqual(message('{sw} lost', 'aa', 'Switch'), 'Switch: lost');
        assert.strictEqual(message('AP[aa:bb] was disconnected', 'aa:bb', 'Office'), 'AP - Office: was disconnected');
        assert.strictEqual(message('{ap} lost', 'aa', undefined), '{ap} lost');
    });

    it('translates DPI codes', () => {
        assert.strictEqual(applyRule({ translateCatCodeToName: [0] }), 'Instant messengers');
        assert.strictEqual(applyRule({ translateCatCodeToName: [999] }), 'unknown');
        assert.strictEqual(applyRule({ translateAppCodeToName: [0, 41] }), 'WhatsApp');
        assert.strictEqual(applyRule({ translateAppCodeToName: ['0', '41'] }), 'WhatsApp');
        assert.strictEqual(applyRule({ translateAppCodeToName: [99, 99] }), 'unknown');
    });
});

describe('object definitions', () => {
    it('collects the IDs of all states', () => {
        const ids = collectStateIds(loadObjectDefinitions('alarms').alarms.logic.has);

        assert.ok(ids.includes('alarms.alarm.message'));
        assert.ok(ids.includes('alarms.alarm.device.mac'));
        assert.ok(!ids.includes('alarms.alarm'));
        assert.ok(!ids.includes('alarms.alarm.device'));
    });

    it('lists the states of a single channel without groups', () => {
        const options = buildStateOptions('clients');

        assert.ok(options.every(option => !option.items));
        assert.deepStrictEqual(
            options.find(option => option.value === 'clients.client.ip'),
            { label: 'ip', value: 'clients.client.ip', description: 'IP address' },
        );
    });

    it('groups the states by channel', () => {
        const groups = buildStateOptions('devices');

        assert.strictEqual(groups[0].label, 'device');
        const ports = groups.find(group => group.label === 'device › port_table › port');
        assert.ok(ports.items.some(item => item.value === 'devices.device.port_table.port.poe_power'));
    });
});
