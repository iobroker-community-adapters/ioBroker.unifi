'use strict';

const https = require('node:https');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const FIXTURES = join(__dirname, '..', 'fixtures');

/**
 * HTTPS server that answers like a UniFi OS console (e.g. UDM-Pro), so the adapter can be tested with the real
 * UniFi client (src/lib/unifiController.ts). Only the parts that the adapter uses are implemented:
 *
 * - `GET /` with status 200 marks the console as UniFi OS
 * - `POST /api/auth/login` sets the session cookie, `GET /api/users/self` checks it, `POST /api/auth/logout` ends it
 * - `/proxy/network/v2/api/site/<site>/<path>` answers with `responses['v2/<path>']` (without query, without meta),
 *   404 if not set
 * - the header `X-API-KEY` with `apiKey` authenticates every request without a session (answers 401 like
 *   UniFi OS 6 for a wrong key)
 * - `/proxy/network/api/self/sites` and `/proxy/network/api/s/<site>/<path>` answer with `{ meta: { rc: 'ok' }, data }`
 *   from `responses[<path>]`. Unknown paths answer with an empty list.
 */
class FakeController {
    constructor() {
        this.sites = [{ name: 'default', desc: 'Default', _id: 'site1' }];
        /** @type {Record<string, any[] | ((body: any, method: string) => any[])>} path below the site => data */
        this.responses = {};
        /** @type {{ method: string, path: string, body: any }[]} requests to the network API */
        this.requests = [];
        this.logins = 0;
        this.logouts = 0;
        this.token = null;
        /** API key accepted in the header X-API-KEY, null = none */
        this.apiKey = null;
        this.server = https.createServer(
            { key: readFileSync(join(FIXTURES, 'key.pem')), cert: readFileSync(join(FIXTURES, 'cert.pem')) },
            (req, res) => this.handle(req, res),
        );
    }

    /** @returns {Promise<number>} the port */
    listen() {
        return new Promise(resolve => {
            this.server.listen(0, '127.0.0.1', () => resolve(this.server.address().port));
        });
    }

    close() {
        this.server.closeAllConnections();
        return new Promise(resolve => this.server.close(() => resolve()));
    }

    /** The current session becomes invalid, like after a restart of the controller */
    expireSession() {
        this.token = null;
    }

    /**
     * Requests to a path below the site, e.g. `cmd/hotspot`
     *
     * @param {string} path
     */
    requestsTo(path) {
        return this.requests.filter(r => r.path === path);
    }

    handle(req, res) {
        let raw = '';
        req.on('data', chunk => (raw += chunk));
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : undefined;
            const send = (status, data, headers = {}) => {
                res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
                res.end(JSON.stringify(data));
            };
            const apiKey = req.headers['x-api-key'];
            if (apiKey !== undefined && apiKey !== this.apiKey) {
                send(401, { error: { code: 401, message: 'Unauthorized' } });
                return;
            }
            const loggedIn =
                apiKey !== undefined ||
                (this.token !== null && (req.headers.cookie || '').includes(`TOKEN=${this.token}`));

            if (req.url === '/' && req.method === 'GET') {
                send(200, {}, { 'x-csrf-token': 'csrf' });
            } else if (req.url === '/api/auth/login' && req.method === 'POST') {
                this.logins++;
                this.token = `session${this.logins}`;
                send(200, {}, { 'Set-Cookie': `TOKEN=${this.token}; Path=/; HttpOnly` });
            } else if (req.url === '/api/auth/logout' && req.method === 'POST') {
                this.logouts++;
                this.token = null;
                send(200, {});
            } else if (req.url === '/api/users/self') {
                send(loggedIn ? 200 : 401, {});
            } else if (req.url.startsWith('/proxy/network/v2/api/site/')) {
                if (!loggedIn) {
                    send(401, { code: 'api.err.LoginRequired' });
                    return;
                }
                // v2/<path below the site> without query, answered without meta like the v2 API
                const [path, query] = req.url.substring('/proxy/network/v2/api/site/'.length).split('?');
                const v2Path = `v2/${path.split('/').slice(1).join('/')}`;
                this.requests.push({ method: req.method, path: v2Path, query, body });
                const response = this.responses[v2Path];
                if (response === undefined) {
                    send(404, { code: 'api.err.NotFound' });
                    return;
                }
                send(200, typeof response === 'function' ? response(body, req.method) : response);
            } else if (req.url.startsWith('/proxy/network/api/')) {
                if (!loggedIn) {
                    send(401, { meta: { rc: 'error', msg: 'api.err.LoginRequired' }, data: [] });
                    return;
                }
                const path = req.url.substring('/proxy/network/api/'.length);
                if (path === 'self/sites') {
                    send(200, { meta: { rc: 'ok' }, data: this.sites });
                    return;
                }
                // s/<site>/<path>, without a trailing slash
                const sitePath = path.split('/').slice(2).join('/').replace(/\/$/, '');
                this.requests.push({ method: req.method, path: sitePath, body });
                const response = this.responses[sitePath];
                const data = typeof response === 'function' ? response(body, req.method) : response || [];
                send(200, { meta: { rc: 'ok' }, data });
            } else {
                send(404, {});
            }
        });
    }
}

module.exports = { FakeController };
