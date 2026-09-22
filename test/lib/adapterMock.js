'use strict';

const EventEmitter = require('node:events');
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');

/**
 * RegExp for an ioBroker ID pattern with `*`
 *
 * @param {string} pattern
 */
function patternToRegExp(pattern) {
    return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
}

/**
 * @param {any} state state object or value
 * @param {boolean} [ack]
 */
function toState(state, ack) {
    if (state !== null && typeof state === 'object' && 'val' in state) {
        return { val: state.val, ack: state.ack ?? ack ?? false };
    }
    return { val: state, ack: !!ack };
}

/**
 * Replacement of utils.Adapter from @iobroker/adapter-core with an in-memory database of objects and states.
 * All methods used by the adapter are sinon spies, so the calls can be checked.
 */
class AdapterMock extends EventEmitter {
    constructor(options) {
        super();
        this.name = options.name;
        this.namespace = `${options.name}.0`;
        this.config = {};
        /** @type {Map<string, any>} full ID => object */
        this.objects = new Map();
        /** @type {Map<string, {val: any, ack: boolean}>} full ID => state */
        this.states = new Map();
        this.timers = new Set();
        this.log = {
            silly: sinon.stub(),
            debug: sinon.stub(),
            info: sinon.stub(),
            warn: sinon.stub(),
            error: sinon.stub(),
        };
        this.updateConfig = sinon.stub().resolves();
        this.subscribeStatesAsync = sinon.stub().resolves();
        this.supportsFeature = sinon.stub().returns(false);
        this.getPluginInstance = sinon.stub().returns(null);

        for (const method of [
            'getObjectAsync',
            'getForeignObjectAsync',
            'getForeignObjectsAsync',
            'extendObjectAsync',
            'delObjectAsync',
            'getStateAsync',
            'getStatesAsync',
            'setStateAsync',
            'setStateChangedAsync',
            'setForeignStateAsync',
        ]) {
            this[method] = sinon.spy(this, method);
        }
    }

    /** @param {string} id */
    fixId(id) {
        return id.startsWith(`${this.namespace}.`) ? id : `${this.namespace}.${id}`;
    }

    async getObjectAsync(id) {
        return this.objects.get(this.fixId(id)) || null;
    }

    async getForeignObjectAsync(id) {
        return this.objects.get(id) || null;
    }

    async getForeignObjectsAsync(pattern, type) {
        const regExp = patternToRegExp(pattern);
        const result = {};
        for (const [id, obj] of this.objects) {
            if (regExp.test(id) && (!type || obj.type === type)) {
                result[id] = obj;
            }
        }
        return result;
    }

    async extendObjectAsync(id, obj) {
        const fullId = this.fixId(id);
        const old = this.objects.get(fullId) || {};
        this.objects.set(fullId, {
            ...old,
            ...obj,
            _id: fullId,
            common: { ...old.common, ...obj.common },
            native: { ...old.native, ...obj.native },
        });
        return { id: fullId };
    }

    async delObjectAsync(id) {
        const fullId = this.fixId(id);
        this.objects.delete(fullId);
        this.states.delete(fullId);
    }

    async getStateAsync(id) {
        return this.states.get(this.fixId(id)) || null;
    }

    async getStatesAsync(pattern) {
        const regExp = patternToRegExp(this.fixId(pattern));
        const result = {};
        for (const [id, state] of this.states) {
            if (regExp.test(id)) {
                result[id] = state;
            }
        }
        return result;
    }

    async setStateAsync(id, state, ack) {
        this.states.set(this.fixId(id), toState(state, ack));
        return this.fixId(id);
    }

    async setStateChangedAsync(id, state, ack) {
        const newState = toState(state, ack);
        const old = this.states.get(this.fixId(id));
        if (!old || old.val !== newState.val || old.ack !== newState.ack) {
            this.states.set(this.fixId(id), newState);
        }
        return this.fixId(id);
    }

    async setForeignStateAsync(id, state, ack) {
        this.states.set(id, toState(state, ack));
        return id;
    }

    setTimeout(callback, ms) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            callback();
        }, ms);
        this.timers.add(timer);
        return timer;
    }

    clearTimeout(timer) {
        clearTimeout(timer);
        this.timers.delete(timer);
    }

    /** Stops all timers of the adapter, call it at the end of a test */
    stopTimers() {
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }

    /**
     * Value of a state, `undefined` if it does not exist
     *
     * @param {string} id ID without namespace
     */
    val(id) {
        return this.states.get(this.fixId(id))?.val;
    }
}

/**
 * The adapter from build/main.js with the in-memory adapter-core. node-unifi is the real one unless stubbed.
 *
 * @param {Record<string, any>} [config] native configuration
 * @param {Record<string, any>} [stubs] additional module stubs for proxyquire, e.g. `{ 'node-unifi': ... }`
 */
function createAdapter(config = {}, stubs = {}) {
    const createInstance = proxyquire('../../build/main', {
        '@iobroker/adapter-core': { Adapter: AdapterMock },
        ...stubs,
    });
    const adapter = createInstance();
    adapter.config = { ...structuredClone(require('../../io-package.json').native), ...config };
    return adapter;
}

module.exports = { AdapterMock, createAdapter };
