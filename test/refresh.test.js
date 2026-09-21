'use strict';

const assert = require('node:assert');
const EventEmitter = require('node:events');
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');

class AdapterMock extends EventEmitter {
    constructor(options) {
        super();
        this.name = options.name;
        this.namespace = `${options.name}.0`;
        this.config = {};
        this.log = {
            debug: sinon.stub(),
            info: sinon.stub(),
            warn: sinon.stub(),
            error: sinon.stub(),
            silly: sinon.stub(),
        };
        this.setStateAsync = sinon.stub().resolves();
        this.setStateChangedAsync = sinon.stub().resolves();
        this.setTimeout = (cb, ms) => setTimeout(cb, ms);
        this.clearTimeout = timer => clearTimeout(timer);
    }
}

/**
 * @param {number} status
 * @param {string} [msg]
 */
function httpError(status, msg) {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status, data: msg ? { meta: { rc: 'error', msg } } : {} };
    return err;
}

describe('refresh reliability', () => {
    let Controller;
    let createAdapter;

    beforeEach(() => {
        Controller = sinon.stub();
        createAdapter = proxyquire('../build/main', {
            '@iobroker/adapter-core': { Adapter: AdapterMock },
            'node-unifi': { Controller },
        });
    });

    it('reuses an authenticated controller session', async () => {
        const controller = { login: sinon.stub().resolves() };
        Controller.returns(controller);
        const adapter = createAdapter();
        adapter.settings = {
            controllerIp: '127.0.0.1',
            controllerPort: '8443',
            controllerUsername: 'user',
            controllerPassword: 'secret',
            ignoreSSLErrors: true,
        };

        assert.strictEqual(await adapter.getController(), controller);
        assert.strictEqual(await adapter.getController(), controller);
        sinon.assert.calledOnce(Controller);
        sinon.assert.calledOnce(controller.login);
    });

    it('re-authenticates once after an expired session', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        adapter.controllers = { default: {} };
        adapter.performUpdate = sinon.stub();
        adapter.performUpdate.onFirstCall().rejects(new Error('api.err.LoginRequired'));
        adapter.performUpdate.onSecondCall().resolves([]);
        const resetControllers = sinon.spy(adapter, 'resetControllers');

        await adapter.updateUnifiData(true);

        sinon.assert.calledTwice(adapter.performUpdate);
        assert.deepStrictEqual(adapter.performUpdate.firstCall.args, [true]);
        assert.deepStrictEqual(adapter.performUpdate.secondCall.args, [false]);
        sinon.assert.calledOnce(resetControllers);
        assert.strictEqual(adapter.consecutiveErrors, 0);
        assert.strictEqual(adapter.updateInProgress, false);
        sinon.assert.calledWith(adapter.setStateChangedAsync, 'info.connection', { ack: true, val: true });
    });

    it('does not log in again when the first login is rejected', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        adapter.performUpdate = sinon.stub().rejects(httpError(401));
        adapter.handleError = sinon.stub();
        const resetControllers = sinon.spy(adapter, 'resetControllers');

        await adapter.updateUnifiData(true);

        sinon.assert.calledOnceWithExactly(adapter.performUpdate, false);
        sinon.assert.notCalled(resetControllers);
        assert.strictEqual(adapter.consecutiveErrors, 1);
    });

    it('does not treat a missing permission as an expired session', () => {
        const adapter = createAdapter();

        assert.strictEqual(adapter.isAuthenticationError(httpError(401)), true);
        assert.strictEqual(adapter.isAuthenticationError(new Error('api.err.LoginRequired')), true);
        assert.strictEqual(adapter.isAuthenticationError(httpError(403, 'api.err.NoPermission')), false);
        assert.strictEqual(adapter.isAuthenticationError(new Error('connect ECONNREFUSED')), false);
    });

    it('keeps scheduling updates with backoff after a failure', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        adapter.performUpdate = sinon.stub().rejects(new Error('network unavailable'));
        adapter.handleError = sinon.stub();
        adapter.scheduleNextUpdate = sinon.stub();

        await adapter.updateUnifiData();

        assert.strictEqual(adapter.consecutiveErrors, 1);
        assert.strictEqual(adapter.updateInProgress, false);
        sinon.assert.calledOnceWithExactly(adapter.scheduleNextUpdate, 20000);
        sinon.assert.calledWith(adapter.setStateChangedAsync, 'info.connection', { ack: true, val: false });
        sinon.assert.calledWith(adapter.setStateChangedAsync, 'info.refreshInProgress', { ack: true, val: false });

        await adapter.updateUnifiData();
        await adapter.updateUnifiData();

        assert.strictEqual(adapter.consecutiveErrors, 3);
        assert.deepStrictEqual(adapter.scheduleNextUpdate.lastCall.args, [80000]);
    });

    it('caps the backoff but never goes below the configured interval', async () => {
        const adapter = createAdapter();
        adapter.performUpdate = sinon.stub().rejects(new Error('network unavailable'));
        adapter.handleError = sinon.stub();
        adapter.scheduleNextUpdate = sinon.stub();

        adapter.settings.updateInterval = 60000;
        adapter.consecutiveErrors = 10;
        await adapter.updateUnifiData();
        assert.deepStrictEqual(adapter.scheduleNextUpdate.lastCall.args, [15 * 60 * 1000]);

        adapter.settings.updateInterval = 30 * 60 * 1000;
        await adapter.updateUnifiData();
        assert.deepStrictEqual(adapter.scheduleNextUpdate.lastCall.args, [30 * 60 * 1000]);
    });

    it('does not start overlapping refreshes', async () => {
        const adapter = createAdapter();
        adapter.updateInProgress = true;
        adapter.performUpdate = sinon.stub();
        adapter.scheduleNextUpdate = sinon.stub();

        await adapter.updateUnifiData(true);

        sinon.assert.notCalled(adapter.performUpdate);
        sinon.assert.notCalled(adapter.scheduleNextUpdate);
    });

    it('keeps polling when a scheduled refresh collides with trigger_update', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        let finishManualUpdate;
        adapter.performUpdate = sinon.stub().callsFake(
            () =>
                new Promise(resolve => {
                    finishManualUpdate = () => resolve([]);
                }),
        );
        adapter.scheduleNextUpdate = sinon.stub();

        const manualUpdate = adapter.updateUnifiData(true);
        while (!finishManualUpdate) {
            await new Promise(resolve => setImmediate(resolve));
        }
        await adapter.updateUnifiData();
        finishManualUpdate();
        await manualUpdate;

        sinon.assert.calledOnce(adapter.performUpdate);
        sinon.assert.calledOnce(adapter.scheduleNextUpdate);
    });

    it('keeps the refresh loop alive when a diagnostic state cannot be written', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        adapter.performUpdate = sinon.stub().resolves([]);
        adapter.scheduleNextUpdate = sinon.stub();
        adapter.setStateChangedAsync.rejects(new Error('database unavailable'));

        await adapter.updateUnifiData();

        sinon.assert.calledOnce(adapter.performUpdate);
        assert.strictEqual(adapter.updateInProgress, false);
        sinon.assert.calledOnceWithExactly(adapter.scheduleNextUpdate, 20000);
        sinon.assert.called(adapter.log.warn);
    });

    it('reports failed requests without failing the whole refresh', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        adapter.performUpdate = sinon.stub().resolves(['fetchDpi (default): invalid data']);
        adapter.scheduleNextUpdate = sinon.stub();

        await adapter.updateUnifiData();

        assert.strictEqual(adapter.consecutiveErrors, 0);
        sinon.assert.calledOnceWithExactly(adapter.scheduleNextUpdate, 20000);
        sinon.assert.calledWith(adapter.setStateChangedAsync, 'info.connection', { ack: true, val: true });
        sinon.assert.calledWith(adapter.setStateChangedAsync, 'info.lastError', {
            ack: true,
            val: 'fetchDpi (default): invalid data',
        });
    });

    describe('performUpdate', () => {
        let adapter;

        beforeEach(() => {
            adapter = createAdapter();
            adapter.update = { clients: true, devices: true, dpi: true, alarms: true };
            adapter.getController = sinon.stub().resolves({});
            adapter.fetchSites = sinon.stub().resolves(['default', 'office']);
            adapter.fetchClients = sinon.stub().resolves();
            adapter.fetchDevices = sinon.stub().resolves();
            adapter.fetchDpi = sinon.stub().resolves();
            adapter.fetchAlarms = sinon.stub().resolves();
            adapter.setClientOnlineStatus = sinon.stub().resolves();
            adapter.handleError = sinon.stub();
        });

        it('requests only the enabled data of every site', async () => {
            adapter.update.dpi = false;

            const failures = await adapter.performUpdate();

            assert.deepStrictEqual(failures, []);
            sinon.assert.calledTwice(adapter.fetchClients);
            sinon.assert.calledWith(adapter.fetchAlarms, 'office');
            sinon.assert.notCalled(adapter.fetchDpi);
            sinon.assert.calledOnce(adapter.setClientOnlineStatus);
        });

        it('continues with the remaining data when one request fails', async () => {
            adapter.fetchDpi
                .withArgs('default')
                .rejects(new Error('fetchDpi default: Returned data is not in valid format'));

            const failures = await adapter.performUpdate(true);

            assert.strictEqual(failures.length, 1);
            assert.ok(failures[0].includes('fetchDpi (default)'));
            sinon.assert.calledTwice(adapter.fetchAlarms);
            sinon.assert.calledOnceWithExactly(adapter.handleError, sinon.match.instanceOf(Error), 'default', 'fetchDpi');
            sinon.assert.calledOnce(adapter.setClientOnlineStatus);
        });

        it('continues with the remaining sites when a site login fails', async () => {
            adapter.getController.withArgs('office').rejects(new Error('connect ETIMEDOUT'));

            const failures = await adapter.performUpdate();

            assert.strictEqual(failures.length, 1);
            sinon.assert.calledOnceWithExactly(adapter.fetchClients, 'default');
            sinon.assert.notCalled(adapter.setClientOnlineStatus);
        });

        it('does not update the client online status when clients are incomplete', async () => {
            adapter.fetchClients.withArgs('office').rejects(new Error('socket hang up'));

            await adapter.performUpdate();

            sinon.assert.notCalled(adapter.setClientOnlineStatus);
        });

        it('passes on an authentication error only for a reused session', async () => {
            adapter.fetchDevices.rejects(httpError(401));

            await assert.rejects(adapter.performUpdate(true), /status code 401/);

            const failures = await adapter.performUpdate(false);
            assert.strictEqual(failures.length, 2);
        });

        it('keeps going when the user lacks the permission for one endpoint', async () => {
            adapter.fetchDpi.rejects(httpError(403, 'api.err.NoPermission'));

            const failures = await adapter.performUpdate(true);

            assert.strictEqual(failures.length, 2);
            sinon.assert.calledTwice(adapter.fetchAlarms);
        });
    });
});
