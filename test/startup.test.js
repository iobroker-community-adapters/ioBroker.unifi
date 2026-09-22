'use strict';

// Start of the adapter, error handling and validation of the controller data

const assert = require('node:assert');
const sinon = require('sinon');
const { createAdapter } = require('./lib/adapterMock');

const LOGIN = { controllerIp: '192.168.1.1', controllerUsername: 'user', controllerPassword: 'secret' };

/**
 * Adapter with the configuration, onReady() called but without starting the refreshes
 *
 * @param {Record<string, any>} config
 */
async function start(config) {
    const adapter = createAdapter(config);
    adapter.updateUnifiData = sinon.stub().resolves();
    await adapter.onReady();
    return adapter;
}

describe('start', () => {
    it('reads the configuration of the old admin page, which stored numbers as text', async () => {
        const adapter = await start({
            ...LOGIN,
            controllerPort: '8443',
            updateInterval: '30',
            clientsIsOnlineOffset: '20',
            gatewayTrafficMaxDays: '7',
            createVouchersUploadLimit: '',
        });

        assert.strictEqual(adapter.settings.updateInterval, 30000);
        assert.strictEqual(adapter.settings.controllerPort, '8443');
        assert.strictEqual(adapter.clients.isOnlineOffset, 20000);
        assert.strictEqual(adapter.update.gatewayTrafficMaxDays, 7);
        assert.strictEqual(adapter.vouchers.uploadLimit, null);
        sinon.assert.calledOnceWithExactly(adapter.updateUnifiData);
    });

    it('uses the defaults for missing numbers and an empty port for UniFi OS', async () => {
        const adapter = await start({
            ...LOGIN,
            controllerPort: null,
            updateInterval: 0,
            clientsIsOnlineOffset: null,
        });

        assert.strictEqual(adapter.settings.controllerPort, '');
        assert.strictEqual(adapter.settings.updateInterval, 60000);
        assert.strictEqual(adapter.clients.isOnlineOffset, 60000);
    });

    it('subscribes to the writable states', async () => {
        const adapter = await start(LOGIN);

        const patterns = adapter.subscribeStatesAsync.getCalls().map(call => call.args[0]);
        for (const pattern of ['trigger_update', '*.wlans.*.enabled', '*.clients.*.blocked', '*.devices.*.restart']) {
            assert.ok(patterns.includes(pattern), pattern);
        }
    });

    it('normalizes the states filter', async () => {
        const adapter = await start({
            ...LOGIN,
            statesFilter: { ...createAdapter().config.statesFilter, clients: ['clients.client.is_online'] },
        });

        assert.ok(adapter.statesFilter.clients.includes('clients.client.last_seen_by_uap'));
        assert.deepStrictEqual(adapter.statesFilter.devices, []);
    });

    it('migrates the filters of versions before 0.5.3 and waits for the restart', async () => {
        const blacklist = { clients: ['old'], devices: [], wlans: [], networks: [], health: [] };
        const whitelist = { clients: ['clients.client.ip'] };

        const adapter = await start({ ...LOGIN, blacklist, whitelist });

        sinon.assert.calledOnceWithExactly(adapter.updateConfig, {
            objectsFilter: blacklist,
            statesFilter: whitelist,
            blacklist: null,
            whitelist: null,
        });
        sinon.assert.notCalled(adapter.updateUnifiData);
    });

    it('deactivates itself without login data', async () => {
        const adapter = await start({ controllerIp: '', controllerUsername: '', controllerPassword: '' });

        sinon.assert.calledWith(adapter.log.error, 'Adapter deactivated due to missing configuration.');
        assert.strictEqual(adapter.val('info.connection'), false);
        assert.strictEqual(adapter.states.get('system.adapter.unifi.0.alive').val, false);
        sinon.assert.notCalled(adapter.updateUnifiData);
    });

    it('stops the scheduled refresh on unload', () => {
        const adapter = createAdapter();
        adapter.scheduleNextUpdate(60000);
        const callback = sinon.spy();

        adapter.onUnload(callback);

        sinon.assert.calledOnce(callback);
        assert.strictEqual(adapter.timers.size, 0);
        assert.strictEqual(adapter.stopped, true);
    });
});

describe('error handling', () => {
    let adapter;

    beforeEach(() => {
        adapter = createAdapter();
    });

    const loggedError = err => {
        adapter.handleError(err, 'default', 'test');
        return adapter.log.error.getCalls().map(call => call.args[0]);
    };

    it('explains the known errors of the controller', () => {
        assert.deepStrictEqual(loggedError(new Error('api.err.Invalid')), [
            'Error site default: Incorrect username or password.',
        ]);
    });

    it('explains connection errors', () => {
        assert.deepStrictEqual(loggedError(new Error('connect ECONNREFUSED 192.168.1.1:8443')), [
            'Error site default: Connection refused. Incorrect IP or port.',
        ]);
    });

    it('detects a missing permission in the response', () => {
        const err = new Error('Request failed with status code 403');
        err.response = { status: 403, data: { meta: { msg: 'api.err.NoPermission' } } };

        assert.deepStrictEqual(loggedError(err), ['Error site default: Permission denied. Check access rights.']);
    });

    it('logs unknown errors with stack and reports them to Sentry', () => {
        const captureException = sinon.spy();
        adapter.supportsFeature.withArgs('PLUGINS').returns(true);
        adapter.getPluginInstance.withArgs('sentry').returns({ getSentryObject: () => ({ captureException }) });
        const err = new Error('something unexpected');

        const lines = loggedError(err);

        assert.ok(lines[0].startsWith('[test site default] error: something unexpected, stack: Error: something'));
        sinon.assert.calledOnceWithExactly(captureException, err);
    });

    it('does not report known errors to Sentry', () => {
        adapter.supportsFeature.withArgs('PLUGINS').returns(true);
        adapter.getPluginInstance.returns({ getSentryObject: () => ({ captureException: sinon.spy() }) });

        loggedError(new Error('socket hang up'));

        sinon.assert.notCalled(adapter.getPluginInstance);
    });
});

describe('validation of the controller data', () => {
    let adapter;

    beforeEach(() => {
        adapter = createAdapter();
        adapter.controllers.default = {
            getClientDevices: sinon.stub().resolves({ unexpected: true }),
            getAccessDevices: sinon.stub().resolves(undefined),
            getDPIStats: sinon.stub().resolves('error'),
            getSiteSysinfo: sinon.stub().resolves(undefined),
        };
    });

    for (const [method, pattern] of [
        ['fetchClients', /fetchClients default: Returned data is not in valid format/],
        ['fetchDevices', /fetchDevices default: Returned data is not in valid format/],
        ['fetchDpi', /only available for gateways/],
        ['fetchSiteSysinfo', /fetchSiteSysinfo default: Returned data is not in valid format/],
    ]) {
        it(`${method} rejects invalid data`, async () => {
            await assert.rejects(adapter[method]('default'), pattern);
        });
    }

    it('handles the invalid data message without stack and Sentry', () => {
        adapter.supportsFeature.returns(true);

        adapter.handleError(new Error('fetchClients default: Returned data is not in valid format: {}'), 'default');

        sinon.assert.calledOnceWithExactly(
            adapter.log.error,
            'fetchClients default: Returned data is not in valid format: {}',
        );
        sinon.assert.notCalled(adapter.getPluginInstance);
    });
});
