'use strict';

const EventEmitter = require('events');
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');
const { expect } = require('chai');

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
            silly: sinon.stub()
        };
        this.setStateAsync = sinon.stub().resolves();
        this.setStateChangedAsync = sinon.stub().resolves();
    }
}

/**
 * @param {number} status
 * @param {string} [msg]
 */
function httpError(status, msg) {
    const err = new Error(`Request failed with status code ${status}`);
    // @ts-ignore
    err.response = { status, data: msg ? { meta: { rc: 'error', msg } } : {} };
    return err;
}

describe('refresh reliability', () => {
    let Controller;
    let createAdapter;

    beforeEach(() => {
        Controller = sinon.stub();
        createAdapter = proxyquire('./main', {
            '@iobroker/adapter-core': { Adapter: AdapterMock },
            'node-unifi': { Controller }
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
            ignoreSSLErrors: true
        };

        expect(await adapter.getController()).to.equal(controller);
        expect(await adapter.getController()).to.equal(controller);
        expect(Controller).to.have.been.calledOnce;
        expect(controller.login).to.have.been.calledOnce;
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

        expect(adapter.performUpdate).to.have.been.calledTwice;
        expect(adapter.performUpdate.firstCall).to.have.been.calledWith(true);
        expect(adapter.performUpdate.secondCall).to.have.been.calledWith(false);
        expect(resetControllers).to.have.been.calledOnce;
        expect(adapter.consecutiveErrors).to.equal(0);
        expect(adapter.updateInProgress).to.equal(false);
        expect(adapter.setStateChangedAsync).to.have.been.calledWith('info.connection', { ack: true, val: true });
    });

    it('does not log in again when the first login is rejected', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        adapter.performUpdate = sinon.stub().rejects(httpError(401));
        adapter.handleError = sinon.stub();
        const resetControllers = sinon.spy(adapter, 'resetControllers');

        await adapter.updateUnifiData(true);

        expect(adapter.performUpdate).to.have.been.calledOnceWith(false);
        expect(resetControllers).not.to.have.been.called;
        expect(adapter.consecutiveErrors).to.equal(1);
    });

    it('does not treat a missing permission as an expired session', () => {
        const adapter = createAdapter();

        expect(adapter.isAuthenticationError(httpError(401))).to.equal(true);
        expect(adapter.isAuthenticationError(new Error('api.err.LoginRequired'))).to.equal(true);
        expect(adapter.isAuthenticationError(httpError(403, 'api.err.NoPermission'))).to.equal(false);
        expect(adapter.isAuthenticationError(new Error('connect ECONNREFUSED'))).to.equal(false);
    });

    it('keeps scheduling updates with backoff after a failure', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        adapter.performUpdate = sinon.stub().rejects(new Error('network unavailable'));
        adapter.handleError = sinon.stub();
        adapter.scheduleNextUpdate = sinon.stub();

        await adapter.updateUnifiData();

        expect(adapter.consecutiveErrors).to.equal(1);
        expect(adapter.updateInProgress).to.equal(false);
        expect(adapter.scheduleNextUpdate).to.have.been.calledOnceWith(20000);
        expect(adapter.setStateChangedAsync).to.have.been.calledWith('info.connection', { ack: true, val: false });
        expect(adapter.setStateChangedAsync).to.have.been.calledWith('info.refreshInProgress', { ack: true, val: false });

        await adapter.updateUnifiData();
        await adapter.updateUnifiData();

        expect(adapter.consecutiveErrors).to.equal(3);
        expect(adapter.scheduleNextUpdate.lastCall).to.have.been.calledWith(80000);
    });

    it('caps the backoff but never goes below the configured interval', async () => {
        const adapter = createAdapter();
        adapter.performUpdate = sinon.stub().rejects(new Error('network unavailable'));
        adapter.handleError = sinon.stub();
        adapter.scheduleNextUpdate = sinon.stub();

        adapter.settings.updateInterval = 60000;
        adapter.consecutiveErrors = 10;
        await adapter.updateUnifiData();
        expect(adapter.scheduleNextUpdate.lastCall).to.have.been.calledWith(15 * 60 * 1000);

        adapter.settings.updateInterval = 30 * 60 * 1000;
        await adapter.updateUnifiData();
        expect(adapter.scheduleNextUpdate.lastCall).to.have.been.calledWith(30 * 60 * 1000);
    });

    it('does not start overlapping refreshes', async () => {
        const adapter = createAdapter();
        adapter.updateInProgress = true;
        adapter.performUpdate = sinon.stub();
        adapter.scheduleNextUpdate = sinon.stub();

        await adapter.updateUnifiData(true);

        expect(adapter.performUpdate).not.to.have.been.called;
        expect(adapter.scheduleNextUpdate).not.to.have.been.called;
    });

    it('keeps polling when a scheduled refresh collides with trigger_update', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        let finishManualUpdate;
        adapter.performUpdate = sinon.stub().callsFake(() => new Promise(resolve => {
            finishManualUpdate = () => resolve([]);
        }));
        adapter.scheduleNextUpdate = sinon.stub();

        const manualUpdate = adapter.updateUnifiData(true);
        while (!finishManualUpdate) {
            await new Promise(resolve => setImmediate(resolve));
        }
        await adapter.updateUnifiData();
        finishManualUpdate();
        await manualUpdate;

        expect(adapter.performUpdate).to.have.been.calledOnce;
        expect(adapter.scheduleNextUpdate).to.have.been.calledOnce;
    });

    it('keeps the refresh loop alive when a diagnostic state cannot be written', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        adapter.performUpdate = sinon.stub().resolves([]);
        adapter.scheduleNextUpdate = sinon.stub();
        adapter.setStateChangedAsync.rejects(new Error('database unavailable'));

        await adapter.updateUnifiData();

        expect(adapter.performUpdate).to.have.been.calledOnce;
        expect(adapter.updateInProgress).to.equal(false);
        expect(adapter.scheduleNextUpdate).to.have.been.calledOnceWith(20000);
        expect(adapter.log.warn).to.have.been.called;
    });

    it('reports failed requests without failing the whole refresh', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        adapter.performUpdate = sinon.stub().resolves(['fetchDpi (default): invalid data']);
        adapter.scheduleNextUpdate = sinon.stub();

        await adapter.updateUnifiData();

        expect(adapter.consecutiveErrors).to.equal(0);
        expect(adapter.scheduleNextUpdate).to.have.been.calledOnceWith(20000);
        expect(adapter.setStateChangedAsync).to.have.been.calledWith('info.connection', { ack: true, val: true });
        expect(adapter.setStateChangedAsync).to.have.been.calledWith('info.lastError', { ack: true, val: 'fetchDpi (default): invalid data' });
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
            adapter.handleError = sinon.stub().resolves();
        });

        it('requests only the enabled data of every site', async () => {
            adapter.update.dpi = false;

            const failures = await adapter.performUpdate();

            expect(failures).to.deep.equal([]);
            expect(adapter.fetchClients).to.have.been.calledTwice;
            expect(adapter.fetchAlarms).to.have.been.calledWith('office');
            expect(adapter.fetchDpi).not.to.have.been.called;
            expect(adapter.setClientOnlineStatus).to.have.been.calledOnce;
        });

        it('continues with the remaining data when one request fails', async () => {
            adapter.fetchDpi.withArgs('default').rejects(new Error('fetchDpi default: Returned data is not in valid format'));

            const failures = await adapter.performUpdate(true);

            expect(failures).to.have.length(1);
            expect(failures[0]).to.contain('fetchDpi (default)');
            expect(adapter.fetchAlarms).to.have.been.calledTwice;
            expect(adapter.handleError).to.have.been.calledOnceWith(sinon.match.instanceOf(Error), 'default', 'fetchDpi');
            expect(adapter.setClientOnlineStatus).to.have.been.calledOnce;
        });

        it('continues with the remaining sites when a site login fails', async () => {
            adapter.getController.withArgs('office').rejects(new Error('connect ETIMEDOUT'));

            const failures = await adapter.performUpdate();

            expect(failures).to.have.length(1);
            expect(adapter.fetchClients).to.have.been.calledOnceWith('default');
            expect(adapter.setClientOnlineStatus).not.to.have.been.called;
        });

        it('does not update the client online status when clients are incomplete', async () => {
            adapter.fetchClients.withArgs('office').rejects(new Error('socket hang up'));

            await adapter.performUpdate();

            expect(adapter.setClientOnlineStatus).not.to.have.been.called;
        });

        it('passes on an authentication error only for a reused session', async () => {
            adapter.fetchDevices.rejects(httpError(401));

            await expect(adapter.performUpdate(true)).to.be.rejectedWith('status code 401');

            const failures = await adapter.performUpdate(false);
            expect(failures).to.have.length(2);
        });

        it('keeps going when the user lacks the permission for one endpoint', async () => {
            adapter.fetchDpi.rejects(httpError(403, 'api.err.NoPermission'));

            const failures = await adapter.performUpdate(true);

            expect(failures).to.have.length(2);
            expect(adapter.fetchAlarms).to.have.been.calledTwice;
        });
    });
});
