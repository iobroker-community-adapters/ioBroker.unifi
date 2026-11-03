'use strict';

// The UniFi client against small HTTPS servers: controller detection, paths, errors

const assert = require('node:assert');
const https = require('node:https');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Controller, UnifiApiError } = require('../build/lib/unifiController');

const FIXTURES = join(__dirname, 'fixtures');

/**
 * HTTPS server on 127.0.0.1 with a request handler, records the requests
 *
 * @param {(req: import('node:http').IncomingMessage, body: any) => { status?: number, headers?: Record<string, string>, data?: any, delay?: number }} handler
 */
async function startServer(handler) {
    const requests = [];
    const server = https.createServer(
        { key: readFileSync(join(FIXTURES, 'key.pem')), cert: readFileSync(join(FIXTURES, 'cert.pem')) },
        (req, res) => {
            let raw = '';
            req.on('data', chunk => (raw += chunk));
            req.on('end', () => {
                const body = raw ? JSON.parse(raw) : undefined;
                requests.push({ method: req.method, url: req.url, headers: req.headers, body });
                const answer = handler(req, body);
                const reply = () => {
                    res.writeHead(answer.status ?? 200, { 'Content-Type': 'application/json', ...answer.headers });
                    res.end(answer.data === undefined ? '' : JSON.stringify(answer.data));
                };
                answer.delay ? setTimeout(reply, answer.delay) : reply();
            });
        },
    );
    const port = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    return {
        port,
        requests,
        close: () => {
            server.closeAllConnections();
            return new Promise(resolve => server.close(() => resolve()));
        },
    };
}

const OK = data => ({ data: { meta: { rc: 'ok' }, data } });

describe('UniFi client', () => {
    let server;

    afterEach(async () => {
        await server?.close();
    });

    it('detects a classic controller and uses its paths', async () => {
        server = await startServer(req => {
            if (req.url === '/') {
                return { status: 302, headers: { location: '/manage' } };
            }
            if (req.url === '/api/login') {
                return { headers: { 'Set-Cookie': 'unifises=abc; Path=/; HttpOnly' }, ...OK([]) };
            }
            return OK([{ name: 'default' }]);
        });
        const controller = new Controller({
            host: '127.0.0.1',
            port: server.port,
            username: 'user',
            password: 'secret',
            sslverify: false,
        });

        assert.deepStrictEqual(await controller.getSites(), [{ name: 'default' }]);

        assert.strictEqual(controller.isUnifiOs, false);
        const [, login, sites] = server.requests;
        assert.deepStrictEqual(login.body, { username: 'user', password: 'secret', rememberMe: true });
        assert.strictEqual(sites.url, '/api/self/sites');
        assert.strictEqual(sites.headers.cookie, 'unifises=abc');
    });

    it('sends the CSRF token and the session cookie on UniFi OS', async () => {
        server = await startServer(req => {
            if (req.url === '/') {
                return { headers: { 'x-csrf-token': 'csrf1' } };
            }
            if (req.url === '/api/auth/login') {
                return { headers: { 'Set-Cookie': 'TOKEN=t1; Path=/', 'x-updated-csrf-token': 'csrf2' } };
            }
            return OK([]);
        });
        const controller = new Controller({
            host: '127.0.0.1',
            port: server.port,
            username: 'u',
            password: 'p',
            sslverify: false,
        });

        await controller.reconnectClient('AA:BB:CC:DD:EE:FF');

        const command = server.requests[2];
        assert.strictEqual(command.url, '/proxy/network/api/s/default/cmd/stamgr');
        assert.strictEqual(command.method, 'POST');
        assert.strictEqual(command.headers['x-csrf-token'], 'csrf2');
        assert.strictEqual(command.headers.cookie, 'TOKEN=t1');
        assert.deepStrictEqual(command.body, { cmd: 'kick-sta', mac: 'aa:bb:cc:dd:ee:ff' });
    });

    it('authenticates with an API key without logging in', async () => {
        server = await startServer(() => OK([{ hostname: 'udm' }]));
        const controller = new Controller({
            host: '127.0.0.1',
            port: server.port,
            authMode: 'apiKey',
            apiKey: 'key',
            site: 'office',
            sslverify: false,
        });

        await controller.getSiteSysinfo();

        assert.strictEqual(server.requests.length, 1);
        const [request] = server.requests;
        assert.strictEqual(request.url, '/proxy/network/api/s/office/stat/sysinfo');
        assert.strictEqual(request.headers['x-api-key'], 'key');
        assert.strictEqual(request.headers.cookie, undefined);
    });

    it('accepts IPv6 addresses with and without brackets', async () => {
        for (const host of ['::1', '[::1]']) {
            const controller = new Controller({ host, port: '', authMode: 'apiKey', apiKey: 'k' });
            assert.strictEqual(controller.hostname, '::1');
            assert.strictEqual(controller.portNumber, 443);
        }
    });

    it('throws the message of the controller for meta.rc = error', async () => {
        server = await startServer(() => ({
            data: { meta: { rc: 'error', msg: 'api.err.UnknownStation' }, data: [] },
        }));
        const controller = new Controller({
            host: '127.0.0.1',
            port: server.port,
            authMode: 'apiKey',
            apiKey: 'k',
            sslverify: false,
        });

        await assert.rejects(controller.blockClient('00:00:00:00:00:00'), { message: 'api.err.UnknownStation' });
    });

    it('throws HTTP errors in the shape of axios errors', async () => {
        server = await startServer(() => ({ status: 401, data: { error: { code: 401, message: 'Unauthorized' } } }));
        const controller = new Controller({
            host: '127.0.0.1',
            port: server.port,
            authMode: 'apiKey',
            apiKey: 'k',
            sslverify: false,
        });

        await assert.rejects(controller.getHealth(), err => {
            assert.ok(err instanceof UnifiApiError);
            assert.strictEqual(err.message, 'Request failed with status code 401');
            assert.deepStrictEqual(err.response, {
                status: 401,
                data: { error: { code: 401, message: 'Unauthorized' } },
            });
            return true;
        });
    });

    it('returns the body of the v2 API, which has no meta', async () => {
        server = await startServer(() => ({ data: [{ mac: 'aa' }] }));
        const controller = new Controller({
            host: '127.0.0.1',
            port: server.port,
            authMode: 'apiKey',
            apiKey: 'k',
            sslverify: false,
        });

        assert.deepStrictEqual(await controller.customApiRequest('/v2/api/site/<SITE>/clients/active'), [
            { mac: 'aa' },
        ]);
        assert.strictEqual(server.requests[0].url, '/proxy/network/v2/api/site/default/clients/active');
    });

    it('rejects a self-signed certificate unless SSL errors are ignored', async () => {
        server = await startServer(() => OK([]));
        const controller = new Controller({ host: '127.0.0.1', port: server.port, authMode: 'apiKey', apiKey: 'k' });

        await assert.rejects(
            controller.getHealth(),
            err => err.code !== undefined && /self[- ]signed|certificate/i.test(err.message),
        );
    });

    it('aborts a request after the timeout', async () => {
        server = await startServer(() => ({ delay: 500, ...OK([]) }));
        const controller = new Controller({
            host: '127.0.0.1',
            port: server.port,
            authMode: 'apiKey',
            apiKey: 'k',
            sslverify: false,
            timeout: 100,
        });

        await assert.rejects(controller.getHealth(), { message: 'timeout of 100ms exceeded' });
    });

    it('requires an API key', async () => {
        const controller = new Controller({ host: '127.0.0.1', port: '', authMode: 'apiKey', apiKey: '' });

        await assert.rejects(controller.login(), { message: 'No API key configured' });
    });
});
