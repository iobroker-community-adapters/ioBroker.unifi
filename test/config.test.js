'use strict';

const assert = require('node:assert');
const EventEmitter = require('node:events');
const proxyquire = require('proxyquire').noCallThru();

const jsonConfig = require('../admin/jsonConfig.json');
const ioPackage = require('../io-package.json');
const { buildStateOptions } = require('../build/lib/objectDefinitions');

const STATES_FILTER_PREFIX = 'statesFilter.';

class AdapterMock extends EventEmitter {
    constructor(options) {
        super();
        this.name = options.name;
        this.namespace = `${options.name}.0`;
        this.config = {};
    }
}

/**
 * @param {object} config
 * @param {string[]} [attrs]
 * @returns {string[]} all attributes that are stored in the native part of the instance
 */
function collectAttributes(config, attrs = []) {
    for (const [key, item] of Object.entries(config.items || {})) {
        if (item.items) {
            collectAttributes(item, attrs);
        } else if (!key.startsWith('_')) {
            attrs.push(key);
        }
    }
    return attrs;
}

/**
 * @param {string[]} actual
 * @param {string[]} expected
 */
function assertSameMembers(actual, expected) {
    assert.deepStrictEqual([...actual].sort(), [...expected].sort());
}

describe('admin configuration', () => {
    it('lists all states in the state filters (run "npm run 2-jsonConfig" otherwise)', () => {
        const categories = collectAttributes(jsonConfig)
            .filter(attr => attr.startsWith(STATES_FILTER_PREFIX))
            .map(attr => attr.substring(STATES_FILTER_PREFIX.length));

        const findItem = (config, key) => {
            for (const [k, item] of Object.entries(config.items || {})) {
                if (k === key) {
                    return item;
                }
                const found = item.items && findItem(item, key);
                if (found) {
                    return found;
                }
            }
            return undefined;
        };

        for (const category of categories) {
            const item = findItem(jsonConfig, `${STATES_FILTER_PREFIX}${category}`);
            assert.deepStrictEqual(item.options, buildStateOptions(category), category);
        }

        assertSameMembers(categories, Object.keys(ioPackage.native.statesFilter));
    });

    it('has a field for every setting and no field without a setting', () => {
        const native = [];
        for (const [key, value] of Object.entries(ioPackage.native)) {
            if (key === 'objectsFilter' || key === 'statesFilter') {
                native.push(...Object.keys(value).map(category => `${key}.${category}`));
            } else {
                native.push(key);
            }
        }

        assertSameMembers(collectAttributes(jsonConfig), native);
    });
});

describe('states filter', () => {
    let adapter;

    beforeEach(() => {
        const createAdapter = proxyquire('../build/main', {
            '@iobroker/adapter-core': { Adapter: AdapterMock },
            'node-unifi': { Controller: class {} },
        });
        adapter = createAdapter();
    });

    it('keeps an empty selection, so all states are created', () => {
        const filter = adapter.normalizeStatesFilter({ clients: [] });

        assert.deepStrictEqual(filter.clients, []);
        assert.deepStrictEqual(filter.devices, []);
    });

    it('adds the channels above the selected states', () => {
        const filter = adapter.normalizeStatesFilter({ devices: ['devices.device.port_table.port.poe_power'] });

        assertSameMembers(filter.devices, [
            'devices',
            'devices.device',
            'devices.device.port_table',
            'devices.device.port_table.port',
            'devices.device.port_table.port.poe_power',
        ]);
    });

    it('adds the states that a selected state depends on', () => {
        const filter = adapter.normalizeStatesFilter({ clients: ['clients.client.is_online'] });

        assert.ok(filter.clients.includes('clients.client.last_seen_by_uap'));
        assert.ok(filter.clients.includes('clients.client.last_seen_by_usw'));
    });

    it('adds all states of a required channel', () => {
        const filter = adapter.normalizeStatesFilter({ devices: ['devices.device.port_table.port.port_poe_enabled'] });

        assert.ok(filter.devices.includes('devices.device.port_table.port.port_poe'));
        assert.ok(filter.devices.includes('devices.device.port_overrides.port.poe_mode'));
    });

    it('reads filters stored by the old admin page, including their channels', () => {
        const filter = adapter.normalizeStatesFilter({ clients: ['clients', 'clients.client', 'clients.client.mac'] });

        assertSameMembers(filter.clients, ['clients', 'clients.client', 'clients.client.mac']);
    });

    it('ignores channels without a selected state', () => {
        const filter = adapter.normalizeStatesFilter({ clients: ['clients', 'clients.client'] });

        assert.deepStrictEqual(filter.clients, []);
    });
});

describe('json-logic operations', () => {
    const { applyRule } = require('../build/lib/jsonLogic');

    it('formats dates like before', () => {
        const date = new Date(2024, 0, 2, 3, 4, 5);

        assert.strictEqual(applyRule({ timestampToDate: [date.getTime()] }), '2024-01-02');
        assert.strictEqual(applyRule({ timestampToDateTime: [date.getTime()] }), '2024-01-02 03:04:05');
        assert.strictEqual(
            applyRule({ secondsToDateTime: [Math.floor(date.getTime() / 1000)] }),
            '2024-01-02 03:04:05',
        );
        assert.throws(() => applyRule({ timestampToDate: ['no date'] }), /Invalid date/);
    });

    it('translates DPI codes', () => {
        assert.strictEqual(applyRule({ translateCatCodeToName: [0] }), 'Instant messengers');
        assert.strictEqual(applyRule({ translateAppCodeToName: [0, 41] }), 'WhatsApp');
        assert.strictEqual(applyRule({ translateAppCodeToName: [99, 99] }), 'unknown');
    });

    it('reads a property by its name', () => {
        assert.strictEqual(applyRule('mac', { mac: 'aa:bb' }), 'aa:bb');
    });
});
