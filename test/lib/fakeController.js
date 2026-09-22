'use strict';

const https = require('node:https');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const FIXTURES = join(__dirname, '..', 'fixtures');

/**
 * HTTPS server that answers like a UniFi OS console (e.g. UDM-Pro), so the adapter can be tested with the real
 * node-unifi. Only the parts that node-unifi uses are implemented:
 *
 * - `GET /` with status 200 marks the console as UniFi OS
 * - `POST /api/auth/login` sets the session cookie, `GET /api/users/self` checks it
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
        this.token = null;
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
            const loggedIn = this.token !== null && (req.headers.cookie || '').includes(`TOKEN=${this.token}`);

            if (req.url === '/' && req.method === 'GET') {
                send(200, {}, { 'x-csrf-token': 'csrf' });
            } else if (req.url === '/api/auth/login' && req.method === 'POST') {
                this.logins++;
                this.token = `session${this.logins}`;
                send(200, {}, { 'Set-Cookie': `TOKEN=${this.token}; Path=/; HttpOnly` });
            } else if (req.url === '/api/users/self') {
                send(loggedIn ? 200 : 401, {});
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
                // s/<site>/<path>, without a trailing slash (node-unifi adds one for optional IDs)
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
