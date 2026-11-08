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

    it('converts the seconds of the controller to a timestamp in ms', () => {
        assert.strictEqual(applyRule({ secondsToMs: [1700000000] }), 1700000000000);
        assert.strictEqual(applyRule({ secondsToMs: [0] }), null);
        assert.strictEqual(applyRule({ secondsToMs: [null] }), null);
        assert.strictEqual(applyRule({ secondsToMs: ['no date'] }), null);
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

    it('joins arrays, e.g. the IPv6 addresses of a WAN port', () => {
        const rule = { join: [{ var: 'ipv6' }, ', '] };
        assert.strictEqual(applyRule(rule, { ipv6: ['2001:db8::1', '', 'fe80::1'] }), '2001:db8::1, fe80::1');
        assert.strictEqual(applyRule(rule, { ipv6: [] }), '');
        assert.strictEqual(applyRule(rule, {}), null);
    });

    it('translates the PoE mode', () => {
        assert.strictEqual(applyRule({ poeMode: ['auto'] }), true);
        assert.strictEqual(applyRule({ poeMode: ['off'] }), false);
        assert.strictEqual(applyRule({ poeMode: [null] }), false);
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
        const ids = collectStateIds(loadObjectDefinitions('devices').devices.logic.has);

        assert.ok(ids.includes('devices.device.ports.port.poe_enabled'));
        assert.ok(ids.includes('devices.device.ports.port.settings.poe_mode'));
        assert.ok(!ids.includes('devices.device.ports.port'));
        assert.ok(!ids.includes('devices.device.ports.port.settings'));
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
        const ports = groups.find(group => group.label === 'device › ports › port');
        assert.ok(ports.items.some(item => item.value === 'devices.device.ports.port.poe_power'));
    });
});
