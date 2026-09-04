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
    }
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
        adapter.performUpdate = sinon.stub();
        adapter.performUpdate.onFirstCall().rejects(new Error('api.err.LoginRequired'));
        adapter.performUpdate.onSecondCall().resolves();
        const resetControllers = sinon.spy(adapter, 'resetControllers');

        await adapter.updateUnifiData(true);

        expect(adapter.performUpdate).to.have.been.calledTwice;
        expect(resetControllers).to.have.been.calledOnce;
        expect(adapter.consecutiveErrors).to.equal(0);
        expect(adapter.updateInProgress).to.equal(false);
        expect(adapter.setStateAsync).to.have.been.calledWith('info.connection', { ack: true, val: true });
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
        expect(adapter.scheduleNextUpdate).to.have.been.calledOnceWith(40000);
        expect(adapter.setStateAsync).to.have.been.calledWith('info.connection', { ack: true, val: false });
        expect(adapter.setStateAsync).to.have.been.calledWith('info.refreshInProgress', { ack: true, val: false });
    });

    it('does not start overlapping refreshes', async () => {
        const adapter = createAdapter();
        adapter.updateInProgress = true;
        adapter.performUpdate = sinon.stub();

        await adapter.updateUnifiData();

        expect(adapter.performUpdate).not.to.have.been.called;
        expect(adapter.log.warn).to.have.been.calledOnce;
    });

    it('keeps the refresh loop alive when a diagnostic state cannot be written', async () => {
        const adapter = createAdapter();
        adapter.settings.updateInterval = 20000;
        adapter.performUpdate = sinon.stub().resolves();
        adapter.scheduleNextUpdate = sinon.stub();
        adapter.setStateAsync.rejects(new Error('database unavailable'));

        await adapter.updateUnifiData();

        expect(adapter.performUpdate).to.have.been.calledOnce;
        expect(adapter.updateInProgress).to.equal(false);
        expect(adapter.scheduleNextUpdate).to.have.been.calledOnceWith(20000);
        expect(adapter.log.warn).to.have.been.called;
    });
});
