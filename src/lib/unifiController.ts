import type { IncomingHttpHeaders } from 'node:http';
import { Agent, request, type RequestOptions } from 'node:https';

/** Authentication of the requests */
export type AuthMode = 'credentials' | 'apiKey';

export interface ControllerOptions {
    /** IP address or host name, IPv6 addresses with or without brackets */
    host: string;
    /** Empty for UniFi OS on port 443 */
    port: string | number;
    /** Default: 'default' */
    site?: string;
    /** Default: true */
    sslverify?: boolean;
    /** Request timeout in ms. Default: 10000 */
    timeout?: number;
    /** Default: 'credentials' */
    authMode?: AuthMode;
    /** For `authMode: 'credentials'`: a local user of the console or controller */
    username?: string;
    password?: string;
    /** For `authMode: 'apiKey'`: UniFi Network → Integrations → Create New API Key (UniFi OS only) */
    apiKey?: string;
}

interface UnifiResponse {
    status: number;
    headers: IncomingHttpHeaders;
    /** Parsed JSON, the raw text if it is no JSON, undefined if empty */
    data: unknown;
}

/**
 * Error of a request. Same shape as the errors of node-unifi (axios), which the adapter evaluates:
 * HTTP errors have the message `Request failed with status code <status>` and the response in `response`,
 * an answer with `meta.rc !== 'ok'` has `meta.msg` as message.
 */
export class UnifiApiError extends Error {
    public response?: { status: number; data: unknown };

    /**
     * @param message error message
     * @param response status and body of the answer
     * @param response.status HTTP status
     * @param response.data body, parsed as JSON if possible
     */
    public constructor(message: string, response?: { status: number; data: unknown }) {
        super(message);
        this.name = 'UnifiApiError';
        this.response = response;
    }
}

/** Methods with a payload are sent as POST, unless PUT is requested (like node-unifi) */
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Client for the UniFi Network application (classic controller or UniFi OS console).
 *
 * Replaces node-unifi with the same method names, so the adapter code stays unchanged. Differences:
 * - authentication with an API key (header `X-API-KEY`) as alternative to a local user. The key is accepted by
 *   the private API (`/proxy/network/api/s/...`, `/proxy/network/v2/api/...`) as well as by the official
 *   integration API, tested with UniFi OS 6.0.15 / Network 11.0.97.
 * - no extra request per call to check the session (node-unifi requested `/api/users/self` every time)
 * - no dependency on axios and the cookie libraries
 */
// @KI_HINWEIS: The session handling is left to the adapter on purpose: a 401 is thrown, the adapter drops the cached
// controllers and logs in again once (see isAuthenticationError() in main.ts).
export class Controller {
    private readonly opts: Required<Omit<ControllerOptions, 'username' | 'password' | 'apiKey'>> &
        Pick<ControllerOptions, 'username' | 'password' | 'apiKey'>;
    private readonly hostname: string;
    private readonly portNumber: number;
    private readonly agent: Agent;
    /** undefined until detected by login() */
    private unifiOs: boolean | undefined = undefined;
    private readonly cookies = new Map<string, string>();
    private csrfToken: string | undefined = undefined;
    private loggedIn = false;

    /**
     * @param options connection settings
     */
    public constructor(options: ControllerOptions) {
        this.opts = {
            site: 'default',
            sslverify: true,
            timeout: 10000,
            authMode: 'credentials',
            ...options,
        };
        // `new URL()` needs brackets around IPv6 addresses, https.request() must not get them
        this.hostname = String(options.host)
            .trim()
            .replace(/^\[(.*)\]$/, '$1');
        const port = parseInt(String(options.port ?? ''), 10);
        this.portNumber = port > 0 && port <= 65535 ? port : 443;
        this.agent = new Agent({ keepAlive: false, rejectUnauthorized: this.opts.sslverify });
    }

    /** True for UniFi OS consoles (UDM, UCG, Cloud Key Gen2+, UniFi OS Server), undefined before login() */
    public get isUnifiOs(): boolean | undefined {
        return this.unifiOs;
    }

    /**
     * Prepare the requests. With an API key nothing is requested: UniFi OS is assumed, an invalid key is
     * reported by the first request (401). With a user the type of controller is detected and the user logs in.
     * Later calls do nothing.
     */
    public async login(): Promise<boolean> {
        if (this.loggedIn) {
            return true;
        }

        if (this.opts.authMode === 'apiKey') {
            if (!this.opts.apiKey) {
                throw new Error('No API key configured');
            }
            // API keys exist on UniFi OS only
            this.unifiOs = true;
            this.loggedIn = true;
            return true;
        }

        await this.detectUnifiOs();

        const response = await this.send('POST', this.unifiOs ? '/api/auth/login' : '/api/login', {
            username: this.opts.username,
            password: this.opts.password,
            rememberMe: true,
        });
        if (response.status < 200 || response.status >= 300) {
            throw this.httpError(response);
        }

        this.loggedIn = true;
        return true;
    }

    /** End the session of a local user. Errors are ignored, the controller cannot be used afterwards. */
    public async logout(): Promise<void> {
        if (this.loggedIn && this.opts.authMode === 'credentials') {
            try {
                await this.send(this.unifiOs ? 'POST' : 'GET', this.unifiOs ? '/api/auth/logout' : '/api/logout');
            } catch {
                // the session expires on the controller anyway
            }
        }
        this.loggedIn = false;
        this.cookies.clear();
        this.csrfToken = undefined;
        this.agent.destroy();
    }

    /**
     * Request a path of the network application and return the `data` of the answer.
     *
     * @param path e.g. `/api/s/<SITE>/stat/sta`, `<SITE>` is replaced by the site
     * @param payload JSON body. A payload makes a POST, unless PUT is given
     * @param method HTTP method, default GET or POST (with payload)
     */
    public async customApiRequest(
        path: string,
        payload: unknown = null,
        method: Method | null = null,
    ): Promise<unknown> {
        await this.login();

        const httpMethod: Method = payload !== null ? (method === 'PUT' ? 'PUT' : 'POST') : (method ?? 'GET');
        const response = await this.send(httpMethod, this.networkPath(path), payload);
        const body = response.data as { meta?: { rc?: string; msg?: string }; data?: unknown } | undefined;

        if (response.status < 200 || response.status >= 400) {
            throw this.httpError(response);
        }
        if (body === undefined || body === null) {
            throw new UnifiApiError('empty response data', { status: response.status, data: body });
        }
        if (typeof body === 'object' && body.meta !== undefined) {
            if (body.meta.rc === 'ok') {
                return body.data;
            }
            throw new UnifiApiError(body.meta.msg ?? 'generic error', { status: response.status, data: body });
        }
        // v2 and integration API: the body is the data
        return body;
    }

    // ---- data, same methods and parameters as node-unifi 2 ----

    /** Sites the user has access to */
    public getSites(): Promise<unknown> {
        return this.customApiRequest('/api/self/sites');
    }

    /** System information of the site */
    public getSiteSysinfo(): Promise<unknown> {
        return this.customApiRequest('/api/s/<SITE>/stat/sysinfo');
    }

    /**
     * Connected clients
     *
     * @param clientMac only this client
     */
    public getClientDevices(clientMac = ''): Promise<unknown> {
        return this.customApiRequest(`/api/s/<SITE>/stat/sta${this.optionalId(clientMac.toLowerCase())}`);
    }

    /**
     * Blocked clients
     *
     * @param within hours to look back
     */
    public getBlockedUsers(within = 8760): Promise<unknown> {
        return this.customApiRequest('/api/s/<SITE>/stat/alluser', { type: 'blocked', conn: 'all', within });
    }

    /**
     * UniFi devices (gateways, switches, access points)
     *
     * @param deviceMac only this device
     */
    public getAccessDevices(deviceMac = ''): Promise<unknown> {
        return this.customApiRequest(`/api/s/<SITE>/stat/device${this.optionalId(deviceMac.toLowerCase())}`);
    }

    /**
     * WLAN configurations
     *
     * @param wlanId only this WLAN
     */
    public getWLanSettings(wlanId: string | null = null): Promise<unknown> {
        return this.customApiRequest(`/api/s/<SITE>/rest/wlanconf${this.optionalId(wlanId)}`);
    }

    /**
     * Network configurations
     *
     * @param networkId only this network
     */
    public getNetworkConf(networkId: string | null = null): Promise<unknown> {
        return this.customApiRequest(`/api/s/<SITE>/rest/networkconf${this.optionalId(networkId)}`);
    }

    /** Health of the subsystems */
    public getHealth(): Promise<unknown> {
        return this.customApiRequest('/api/s/<SITE>/stat/health');
    }

    /**
     * Hotspot vouchers
     *
     * @param createTime only the vouchers created at this time (seconds)
     */
    public getVouchers(createTime: number | null = null): Promise<unknown> {
        return this.customApiRequest(
            '/api/s/<SITE>/stat/voucher',
            createTime !== null ? { create_time: createTime } : {},
        );
    }

    /** DPI statistics of the site */
    public getDPIStats(): Promise<unknown> {
        return this.customApiRequest('/api/s/<SITE>/stat/dpi');
    }

    /**
     * Daily statistics of the gateway
     *
     * @param start in ms, default: one year before end
     * @param end in ms, default: now
     * @param attribs attributes in addition to `time`
     */
    public getDailyGatewayStats(
        start: number | null = null,
        end: number | null = null,
        attribs: string[] | null = null,
    ): Promise<unknown> {
        const to = end ?? Date.now();
        const from = start ?? to - 52 * 7 * 24 * 3600 * 1000;
        const attrs = attribs === null ? ['time', 'mem', 'cpu', 'loadavg_5'] : ['time', ...attribs];
        return this.customApiRequest('/api/s/<SITE>/stat/report/daily.gw', { attrs, start: from, end: to });
    }

    /**
     * Alarms. Not available in UniFi Network 10 and newer (404)
     *
     * @param payload filter, e.g. `{ archived: false }`
     */
    public getAlarms(payload: Record<string, unknown> | null = null): Promise<unknown> {
        return this.customApiRequest('/api/s/<SITE>/stat/alarm', payload);
    }

    // ---- commands ----

    /**
     * Enable or disable a WLAN
     *
     * @param wlanId _id of the WLAN
     * @param disable true to disable
     */
    public disableWLan(wlanId: string, disable: boolean): Promise<unknown> {
        return this.customApiRequest(
            `/api/s/<SITE>/rest/wlanconf/${wlanId.trim()}`,
            { enabled: disable !== true },
            'PUT',
        );
    }

    /**
     * Create hotspot vouchers
     *
     * @param minutes validity
     * @param count number of vouchers
     * @param quota 0 = multi-use, 1 = single-use, n = n uses
     * @param note note
     * @param up upload limit in Kbps
     * @param down download limit in Kbps
     * @param megabytes data limit in MB
     */
    public createVouchers(
        minutes: number,
        count = 1,
        quota = 0,
        note: string | null = null,
        up: number | null = null,
        down: number | null = null,
        megabytes: number | null = null,
    ): Promise<unknown> {
        const payload: Record<string, unknown> = { cmd: 'create-voucher', expire: minutes, n: count, quota };
        if (note !== null) {
            payload.note = note.trim();
        }
        if (up !== null) {
            payload.up = up;
        }
        if (down !== null) {
            payload.down = down;
        }
        if (megabytes !== null) {
            payload.bytes = megabytes;
        }
        return this.customApiRequest('/api/s/<SITE>/cmd/hotspot', payload);
    }

    /**
     * Change settings of a device
     *
     * @param deviceId _id of the device
     * @param payload settings, e.g. `{ port_overrides: [...] }`
     */
    public setDeviceSettingsBase(deviceId: string, payload: Record<string, unknown>): Promise<unknown> {
        return this.customApiRequest(`/api/s/<SITE>/rest/device/${deviceId.trim()}`, payload, 'PUT');
    }

    /**
     * Disconnect a wireless client, it reconnects
     *
     * @param mac MAC address of the client
     */
    public reconnectClient(mac: string): Promise<unknown> {
        return this.customApiRequest('/api/s/<SITE>/cmd/stamgr', { cmd: 'kick-sta', mac: mac.toLowerCase() });
    }

    /**
     * Block a client
     *
     * @param mac MAC address of the client
     */
    public blockClient(mac: string): Promise<unknown> {
        return this.customApiRequest('/api/s/<SITE>/cmd/stamgr', { cmd: 'block-sta', mac: mac.toLowerCase() });
    }

    /**
     * Unblock a client
     *
     * @param mac MAC address of the client
     */
    public unblockClient(mac: string): Promise<unknown> {
        return this.customApiRequest('/api/s/<SITE>/cmd/stamgr', { cmd: 'unblock-sta', mac: mac.toLowerCase() });
    }

    /**
     * Switch PoE off and on again
     *
     * @param switchMac MAC address of the switch
     * @param portIdx port number
     */
    public powerCycleSwitchPort(switchMac: string, portIdx: number | string): Promise<unknown> {
        return this.customApiRequest('/api/s/<SITE>/cmd/devmgr', {
            mac: switchMac.toLowerCase(),
            port_idx: portIdx,
            cmd: 'power-cycle',
        });
    }

    /**
     * Override the LED setting of the site
     *
     * @param deviceId _id of the device
     * @param overrideMode 'on', 'off' or 'default'
     */
    public setLEDOverride(deviceId: string, overrideMode: string): Promise<unknown> {
        return this.customApiRequest(
            `/api/s/<SITE>/rest/device/${deviceId.trim()}`,
            { led_override: overrideMode },
            'PUT',
        );
    }

    /**
     * Restart a device
     *
     * @param mac MAC address of the device
     * @param rebootType 'soft' or 'hard' (hard also cycles PoE of switches)
     */
    public restartDevice(mac: string, rebootType: 'soft' | 'hard' = 'soft'): Promise<unknown> {
        return this.customApiRequest('/api/s/<SITE>/cmd/devmgr', {
            cmd: 'restart',
            mac: mac.toLowerCase(),
            reboot_type: rebootType,
        });
    }

    // ---- internals ----

    /**
     * Like node-unifi: a classic controller redirects `/` to `/manage`, UniFi OS answers with 200.
     */
    private async detectUnifiOs(): Promise<void> {
        const response = await this.send('GET', '/');
        const location = response.headers.location;

        if (response.status === 302 && location === '/manage') {
            this.unifiOs = false;
        } else if (response.status === 200) {
            this.unifiOs = true;
        } else {
            throw new UnifiApiError('failed to detect UniFiOS status', {
                status: response.status,
                data: response.data,
            });
        }
    }

    /**
     * Path of the network application: below `/proxy/network` on UniFi OS
     *
     * @param path path with `<SITE>`
     */
    private networkPath(path: string): string {
        const sitePath = path.replace('<SITE>', encodeURIComponent(this.opts.site));
        return this.unifiOs ? `/proxy/network${sitePath}` : sitePath;
    }

    /**
     * `/<id>` or nothing
     *
     * @param id optional ID
     */
    private optionalId(id: string | null | undefined): string {
        const trimmed = (id ?? '').trim();
        return trimmed ? `/${trimmed}` : '';
    }

    /**
     * @param response answer with a status >= 400
     */
    private httpError(response: UnifiResponse): UnifiApiError {
        return new UnifiApiError(`Request failed with status code ${response.status}`, {
            status: response.status,
            data: response.data,
        });
    }

    /**
     * Send one request and collect cookies and CSRF token. Redirects are not followed.
     *
     * @param method HTTP method
     * @param path absolute path
     * @param payload JSON body
     */
    private send(method: Method, path: string, payload: unknown = null): Promise<UnifiResponse> {
        const body = payload !== null && payload !== undefined ? JSON.stringify(payload) : undefined;
        const headers: Record<string, string> = { Accept: 'application/json' };

        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = String(Buffer.byteLength(body));
        }
        if (this.opts.authMode === 'apiKey' && this.opts.apiKey) {
            headers['X-API-KEY'] = this.opts.apiKey;
        } else {
            if (this.cookies.size > 0) {
                headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
            }
            if (this.csrfToken) {
                headers['X-CSRF-Token'] = this.csrfToken;
            }
        }

        const options: RequestOptions = {
            method,
            hostname: this.hostname,
            port: this.portNumber,
            path,
            headers,
            agent: this.agent,
            timeout: this.opts.timeout,
        };

        return new Promise((resolve, reject) => {
            const req = request(options, res => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('error', reject);
                res.on('end', () => {
                    this.storeSession(res.headers);
                    const text = Buffer.concat(chunks).toString('utf8');
                    let data: unknown = undefined;
                    if (text) {
                        try {
                            data = JSON.parse(text);
                        } catch {
                            data = text;
                        }
                    }
                    resolve({ status: res.statusCode ?? 0, headers: res.headers, data });
                });
            });
            req.on('timeout', () => req.destroy(new Error(`timeout of ${this.opts.timeout}ms exceeded`)));
            req.on('error', reject);
            if (body !== undefined) {
                req.write(body);
            }
            req.end();
        });
    }

    /**
     * Keep the session cookies and the CSRF token of an answer
     *
     * @param headers response headers
     */
    private storeSession(headers: IncomingHttpHeaders): void {
        for (const cookie of headers['set-cookie'] ?? []) {
            const [pair] = cookie.split(';');
            const index = pair.indexOf('=');
            if (index > 0) {
                this.cookies.set(pair.substring(0, index).trim(), pair.substring(index + 1).trim());
            }
        }
        // UniFi OS renews the token with x-updated-csrf-token
        const csrf = headers['x-updated-csrf-token'] ?? headers['x-csrf-token'];
        if (typeof csrf === 'string' && csrf) {
            this.csrfToken = csrf;
        }
    }
}
