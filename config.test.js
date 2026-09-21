'use strict';

const EventEmitter = require('events');
const proxyquire = require('proxyquire').noCallThru();
const { expect } = require('chai');

const jsonConfig = require('./admin/jsonConfig.json');
const ioPackage = require('./io-package.json');
const { buildStateOptions, forEachStatesFilter } = require('./tasks/generateStateOptions');

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

describe('admin configuration', () => {
    it('lists all states in the state filters (run "node tasks/generateStateOptions.js" otherwise)', () => {
        const categories = [];
        forEachStatesFilter(jsonConfig, (category, item) => {
            categories.push(category);
            expect(item.options, category).to.deep.equal(buildStateOptions(category));
        });

        expect(categories).to.have.members(Object.keys(ioPackage.native.statesFilter));
    });

    it('has a field for every setting and no field without a setting', () => {
        const attrs = collectAttributes(jsonConfig);
        const native = [];
        for (const [key, value] of Object.entries(ioPackage.native)) {
            if (key === 'objectsFilter' || key === 'statesFilter') {
                native.push(...Object.keys(value).map(category => `${key}.${category}`));
            } else {
                native.push(key);
            }
        }

        expect(attrs).to.have.members(native);
    });
});

describe('states filter', () => {
    let adapter;

    beforeEach(() => {
        const createAdapter = proxyquire('./main', {
            '@iobroker/adapter-core': { Adapter: AdapterMock },
            'node-unifi': { Controller: class {} }
        });
        adapter = createAdapter();
    });

    it('keeps an empty selection, so all states are created', () => {
        const filter = adapter.normalizeStatesFilter({ clients: [] });

        expect(filter.clients).to.deep.equal([]);
        expect(filter.devices).to.deep.equal([]);
    });

    it('adds the channels above the selected states', () => {
        const filter = adapter.normalizeStatesFilter({ devices: ['devices.device.port_table.port.poe_power'] });

        expect(filter.devices).to.have.members([
            'devices',
            'devices.device',
            'devices.device.port_table',
            'devices.device.port_table.port',
            'devices.device.port_table.port.poe_power'
        ]);
    });

    it('adds the states that a selected state depends on', () => {
        const filter = adapter.normalizeStatesFilter({ clients: ['clients.client.is_online'] });

        expect(filter.clients).to.include.members(['clients.client.last_seen_by_uap', 'clients.client.last_seen_by_usw']);
    });

    it('adds all states of a required channel', () => {
        const filter = adapter.normalizeStatesFilter({ devices: ['devices.device.port_table.port.port_poe_enabled'] });

        expect(filter.devices).to.include.members([
            'devices.device.port_table.port.port_poe',
            'devices.device.port_overrides.port.poe_mode'
        ]);
    });

    it('reads filters stored by the old admin page, including their channels', () => {
        const filter = adapter.normalizeStatesFilter({ clients: ['clients', 'clients.client', 'clients.client.mac'] });

        expect(filter.clients).to.have.members(['clients', 'clients.client', 'clients.client.mac']);
    });

    it('ignores channels without a selected state', () => {
        const filter = adapter.normalizeStatesFilter({ clients: ['clients', 'clients.client'] });

        expect(filter.clients).to.deep.equal([]);
    });
});
