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

    it('logs in with a user if the instance has no authMode (versions < 1.1.0)', async () => {
        const adapter = await start({ ...LOGIN, authMode: undefined, apiKey: undefined });

        assert.strictEqual(adapter.settings.authMode, 'credentials');
        assert.strictEqual(adapter.settings.apiKey, '');
        sinon.assert.calledOnce(adapter.updateUnifiData);
    });

    it('starts with an API key and without user', async () => {
        const adapter = await start({ controllerIp: '192.168.1.1', authMode: 'apiKey', apiKey: ' key ' });

        assert.strictEqual(adapter.settings.apiKey, 'key');
        sinon.assert.calledOnce(adapter.updateUnifiData);
    });

    it('deactivates itself if the API key is missing', async () => {
        const adapter = await start({ ...LOGIN, authMode: 'apiKey', apiKey: '' });

        sinon.assert.calledWith(adapter.log.error, 'Adapter deactivated due to missing configuration.');
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

    it('explains a blocked login of the local user without stack', () => {
        const err = new Error('Request failed with status code 403');
        err.response = { status: 403, data: { message: 'SSO Account locked', code: 'AUTHENTICATION_FAILED_ACCOUNT_LOCKED' } };

        const logged = loggedError(err);
        assert.strictEqual(logged.length, 1);
        assert.match(logged[0], /blocks the login of the local user.*15 minutes.*API key/);
    });

    it('shortens the HTML page of an internal error of the controller', () => {
        const err = new Error('Request failed with status code 500');
        err.response = {
            status: 500,
            data: '<!doctype html><html lang="en"><head><title>HTTP Status 500 – Internal Server Error</title><style>body {}</style></head><body><h1>HTTP Status 500 – Internal Server Error</h1></body></html>',
        };

        assert.deepStrictEqual(loggedError(err), [
            '[test site default] the UniFi controller answered with an internal error (500: HTTP Status 500 – Internal Server Error). The request is repeated with the next refresh.',
        ]);
    });

    it('logs a network application that is not available (update, restart) as warning, repeated as error', () => {
        const err = new Error('Request failed with status code 502');
        err.response = { status: 502, data: { error: { code: 502, message: 'Bad Gateway' } } };

        adapter.handleError(err, undefined, 'updateUnifiData');
        sinon.assert.notCalled(adapter.log.error);
        sinon.assert.calledOnceWithExactly(
            adapter.log.warn,
            '[updateUnifiData] the UniFi Network application is not available right now (502: Bad Gateway), e.g. during an update or restart. The request is repeated with the next refresh.',
        );

        adapter.consecutiveErrors = 3;
        assert.deepStrictEqual(loggedError(err), [
            '[test site default] the UniFi Network application is still not available (502: Bad Gateway), 3 refreshes in a row. Check the console.',
        ]);
    });

    it('logs a single timeout as warning without stack, repeated timeouts as error', () => {
        const err = new Error('timeout of 10000ms exceeded');

        adapter.handleError(err, undefined, 'updateUnifiData');
        sinon.assert.notCalled(adapter.log.error);
        sinon.assert.calledOnceWithExactly(
            adapter.log.warn,
            '[updateUnifiData] the UniFi controller did not answer within 10 s. The request is repeated with the next refresh.',
        );

        adapter.consecutiveErrors = 3;
        assert.match(loggedError(err)[0], /did not answer within 10 s, 3 refreshes in a row/);
    });

    it('explains a rejected API key', () => {
        adapter.settings.authMode = 'apiKey';
        const err = new Error('Request failed with status code 401');
        err.response = { status: 401, data: { error: { code: 401, message: 'Unauthorized' } } };

        assert.deepStrictEqual(loggedError(err), [
            'Error site default: The API key was rejected. It may be invalid, expired or deleted. Create a new one in UniFi Network → Integrations.',
        ]);
    });

    it('explains network errors before the first refresh as an error (most likely a wrong IP address or port)', () => {
        assert.deepStrictEqual(loggedError(new Error('connect ECONNREFUSED 192.168.1.1:8443')), [
            '[test site default] the UniFi console refused the connection. Check the IP address and port in the settings and that the console is reachable from the ioBroker host.',
        ]);
    });

    it('logs a network error after a successful refresh as warning, repeated as error', () => {
        adapter.refreshedOnce = true;
        const err = new Error('connect EHOSTUNREACH 192.168.1.1:443');

        adapter.handleError(err, undefined, 'updateUnifiData');
        sinon.assert.notCalled(adapter.log.error);
        sinon.assert.calledOnceWithExactly(
            adapter.log.warn,
            '[updateUnifiData] the UniFi console cannot be reached (network or console not available). The request is repeated with the next refresh.',
        );

        adapter.consecutiveErrors = 3;
        assert.deepStrictEqual(loggedError(new Error('read ECONNRESET')), [
            '[test site default] the UniFi console closed the connection, 3 refreshes in a row. Check that the console is reachable from the ioBroker host.',
        ]);
    });

    it('detects a missing permission in the response', () => {
        const err = new Error('Request failed with status code 403');
        err.response = { status: 403, data: { meta: { msg: 'api.err.NoPermission' } } };

        assert.deepStrictEqual(loggedError(err), ['Error site default: Permission denied. Check access rights.']);
    });

    it('explains a required MFA without logging the response', () => {
        const err = new Error('Request failed with status code 499');
        err.response = {
            status: 499,
            data: { code: 'MFA_AUTH_REQUIRED', data: { mfaCookie: 'UBIC_2FA=secret' } },
        };

        const logged = loggedError(err);

        assert.strictEqual(logged.length, 1);
        assert.ok(logged[0].includes('local UniFi OS user'));
        assert.ok(!logged[0].includes('UBIC_2FA'));
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
