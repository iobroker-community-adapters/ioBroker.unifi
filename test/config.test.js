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

    it('preselects only states that exist (default states filter of new instances)', () => {
        const options = new Set();
        const collect = item => {
            if (item && typeof item === 'object') {
                if (typeof item.value === 'string' && item.label !== undefined) {
                    options.add(item.value);
                }
                Object.values(item).forEach(collect);
            }
        };
        collect(jsonConfig);
        const unknown = Object.values(ioPackage.native.statesFilter)
            .flat()
            .filter(id => !options.has(id));
        assert.deepStrictEqual(unknown, []);
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
            './lib/unifiController': { Controller: class {} },
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

describe('object definitions', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(__dirname, '..', 'admin', 'lib');

    /** All definitions of all admin/lib/objects_*.json files, as [key, definition] */
    const definitions = [];
    const collect = has => {
        for (const [key, definition] of Object.entries(has)) {
            definitions.push([key, definition]);
            if (definition.logic && definition.logic.has) {
                collect(definition.logic.has);
            }
        }
    };
    for (const file of fs.readdirSync(dir).filter(f => /^objects_.*\.json$/.test(f))) {
        collect(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
    }
    const states = definitions.filter(([, definition]) => definition.type === 'state');

    // @KI_HINWEIS: "state" is the generic fallback of ioBroker. It is only allowed where no specific role exists.
    const GENERIC_ROLE_ALLOWED = ['devices.device.led_override'];
    const UNITS = ['B', 'B/s', 'Mbit/s', 'kbit/s', '%', 's', 'min', 'ms', '°C', 'W', 'V', 'mA', 'dB', 'dBm', 'MB', 'pkts/s'];

    it('gives every state a specific role (ioBroker state roles)', () => {
        const generic = states
            .filter(([key, definition]) => definition.common.role === 'state' && !GENERIC_ROLE_ALLOWED.includes(key))
            .map(([key]) => key);
        assert.deepStrictEqual(generic, []);
    });

    it('uses only the unified units', () => {
        const other = states
            .filter(([, definition]) => definition.common.unit !== undefined && !UNITS.includes(definition.common.unit))
            .map(([key, definition]) => `${key}: ${definition.common.unit}`);
        assert.deepStrictEqual(other, []);
    });

    it('marks writable states with a role that can be written', () => {
        const wrong = states
            .filter(([, definition]) => definition.common.write)
            .filter(([, definition]) => !/^(switch|button|level|state)/.test(definition.common.role))
            .map(([key, definition]) => `${key}: ${definition.common.role}`);
        assert.deepStrictEqual(wrong, []);
    });

    it('gives every fixed channel a name', () => {
        const unnamed = definitions
            .filter(([, definition]) => ['channel', 'device'].includes(definition.type))
            .filter(([, definition]) => !definition.common?.name && !definition.logic?.common?.name)
            .map(([key]) => key);
        assert.deepStrictEqual(unnamed, []);
    });
});
