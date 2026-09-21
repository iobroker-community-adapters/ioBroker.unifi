/*
 * Created with @iobroker/create-adapter v1.17.0
 */
import * as utils from '@iobroker/adapter-core';
import { Controller, type ControllerOptions } from 'node-unifi';

import { applyRule } from './lib/jsonLogic';
import { collectStateIds, loadObjectDefinitions } from './lib/objectDefinitions';
import type {
    CreatedObject,
    ObjectDefinitions,
    StatesFilterCategory,
    UnifiAlarm,
    UnifiBlockedClient,
    UnifiClient,
    UnifiDevice,
    UnifiDpiStats,
    UnifiError,
    UnifiHealth,
    UnifiNamedItem,
    UnifiObjectsFilter,
    UnifiSite,
    UnifiStatesFilter,
    UnifiVoucher,
} from './lib/types';

type UpdateKey =
    | 'sysinfo'
    | 'clients'
    | 'devices'
    | 'wlans'
    | 'networks'
    | 'health'
    | 'vouchers'
    | 'dpi'
    | 'gatewayTraffic'
    | 'alarms';

type FetchMethod =
    | 'fetchSiteSysinfo'
    | 'fetchClients'
    | 'fetchDevices'
    | 'fetchWlans'
    | 'fetchNetworks'
    | 'fetchHealth'
    | 'fetchVouchers'
    | 'fetchDpi'
    | 'fetchGatewayTraffic'
    | 'fetchAlarms';

// Data requested for every site, in this order: [update setting, fetch method]
const FETCH_METHODS: [UpdateKey, FetchMethod][] = [
    ['sysinfo', 'fetchSiteSysinfo'],
    ['clients', 'fetchClients'],
    ['devices', 'fetchDevices'],
    ['wlans', 'fetchWlans'],
    ['networks', 'fetchNetworks'],
    ['health', 'fetchHealth'],
    ['vouchers', 'fetchVouchers'],
    ['dpi', 'fetchDpi'],
    ['gatewayTraffic', 'fetchGatewayTraffic'],
    ['alarms', 'fetchAlarms'],
];

// Upper limit for the delay between refreshes after consecutive failures
const MAX_BACKOFF_DELAY = 15 * 60 * 1000;

// Categories of the state filter, defined in admin/lib/objects_<category>.json
const STATES_FILTER_CATEGORIES: StatesFilterCategory[] = [
    'sysinfo',
    'clients',
    'devices',
    'wlans',
    'networks',
    'health',
    'vouchers',
    'alarms',
    'dpi',
    'gateway_traffic',
];

// States that are always selected together with another state: [state, required states or channels]
const STATE_DEPENDENCIES: [string, string[]][] = [
    // is_online is calculated from the last seen timestamps
    ['clients.client.is_online', ['clients.client.last_seen_by_uap', 'clients.client.last_seen_by_usw']],
    [
        'devices.device.port_table.port.port_poe_enabled',
        ['devices.device.port_table.port.port_poe', 'devices.device.port_overrides'],
    ],
    // the LED override is sent with the device ID
    ['devices.device.led_override', ['devices.device.device_id']],
];

// Characters that are replaced in the IDs of the created objects
const FORBIDDEN_CHARS = /[\][*,;'"`<>\\?\s]/g;

const MAC_ADDRESS = /([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/;

interface Settings {
    /** In ms */
    updateInterval: number;
    controllerIp: string;
    controllerPort: string | number;
    controllerUsername: string;
    controllerPassword: string;
    ignoreSSLErrors: boolean;
}

type UpdateSettings = Record<UpdateKey, boolean> & {
    /** Use the objects filter of the clients as whitelist */
    blacklist: boolean;
    vouchersNoUsed: boolean;
    alarmsNoArchived: boolean;
    gatewayTrafficMaxDays: number;
};

interface VoucherSettings {
    number: number | string | null;
    duration: number | string | null;
    quota: number | string | null;
    uploadLimit: number | string | null;
    downloadLimit: number | string | null;
    byteQuota: number | string | null;
    note: string;
}

/**
 * True if one of the values is in the list
 *
 * @param list filter list
 * @param values values of the item
 */
function isInList(list: string[], ...values: (string | undefined)[]): boolean {
    return values.some(value => value !== undefined && list.includes(value));
}

class Unifi extends utils.Adapter {
    private controllers: Record<string, Controller> = {};
    private objectsFilter: UnifiObjectsFilter = { clients: [], devices: [], wlans: [], networks: [], health: [] };
    private settings: Settings = {
        updateInterval: 60 * 1000,
        controllerIp: '',
        controllerPort: '',
        controllerUsername: '',
        controllerPassword: '',
        ignoreSSLErrors: true,
    };
    private update: UpdateSettings = {
        blacklist: false,
        sysinfo: false,
        clients: false,
        devices: false,
        wlans: false,
        networks: false,
        health: false,
        vouchers: false,
        vouchersNoUsed: false,
        dpi: false,
        gatewayTraffic: false,
        gatewayTrafficMaxDays: 0,
        alarms: false,
        alarmsNoArchived: false,
    };
    private clients = { isOnlineOffset: 60 * 1000 };
    private vouchers: VoucherSettings = {
        number: null,
        duration: null,
        quota: null,
        uploadLimit: null,
        downloadLimit: null,
        byteQuota: null,
        note: '',
    };
    private statesFilter: UnifiStatesFilter = {
        sysinfo: [],
        clients: [],
        devices: [],
        wlans: [],
        networks: [],
        health: [],
        vouchers: [],
        alarms: [],
        dpi: [],
        gateway_traffic: [],
    };
    private queryTimeout: ioBroker.Timeout | undefined = undefined;
    private updateInProgress = false;
    private consecutiveErrors = 0;
    /** Created objects without the namespace, to write only changed objects */
    private ownObjects: Record<string, CreatedObject> = {};
    private stopped = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'unifi',
        });
        this.on('ready', () => this.onReady());
        this.on('stateChange', (id, state) => this.onStateChange(id, state));
        this.on('unload', callback => this.onUnload(callback));
    }

    /**
     * Is called when adapter received configuration.
     */
    private async onReady(): Promise<void> {
        try {
            // subscribe to all state changes
            await this.subscribeStatesAsync('*.wlans.*.enabled');
            await this.subscribeStatesAsync('*.vouchers.create_vouchers');
            await this.subscribeStatesAsync('trigger_update');
            await this.subscribeStatesAsync('*.port_table.port_*.port_poe_enabled');
            await this.subscribeStatesAsync('*.port_table.port_*.port_poe_cycle');
            await this.subscribeStatesAsync('*.clients.*.reconnect');
            await this.subscribeStatesAsync('*.clients.*.blocked');
            await this.subscribeStatesAsync('*.devices.*.led_override');
            await this.subscribeStatesAsync('*.devices.*.restart');

            this.log.info('UniFi adapter is ready');

            // blacklist and whitelist were renamed in v0.5.3. The old admin page migrated them on save.
            if (this.config.blacklist || this.config.whitelist) {
                this.log.info('Migrating the filter settings of versions < 0.5.3');
                await this.updateConfig({
                    objectsFilter: this.config.blacklist || this.config.objectsFilter,
                    statesFilter: this.config.whitelist || this.config.statesFilter,
                    blacklist: null,
                    whitelist: null,
                });
                // The adapter is restarted with the new configuration
                return;
            }

            // Load configuration
            this.settings.updateInterval = parseInt(String(this.config.updateInterval), 10) * 1000 || 60 * 1000;
            this.settings.controllerIp = this.config.controllerIp;
            // An empty port is used for UniFi OS. The admin page may store it as null.
            this.settings.controllerPort = this.config.controllerPort || '';
            this.settings.controllerUsername = this.config.controllerUsername;
            this.settings.controllerPassword = this.config.controllerPassword;
            this.settings.ignoreSSLErrors =
                this.config.ignoreSSLErrors !== undefined ? this.config.ignoreSSLErrors : true;

            this.update.blacklist = this.config.blacklistClients;
            this.update.clients = this.config.updateClients;
            this.update.devices = this.config.updateDevices;
            this.update.health = this.config.updateHealth;
            this.update.networks = this.config.updateNetworks;
            this.update.sysinfo = this.config.updateSysinfo;
            this.update.vouchers = this.config.updateVouchers;
            this.update.vouchersNoUsed = this.config.updateVouchersNoUsed;
            this.update.wlans = this.config.updateWlans;
            this.update.alarms = this.config.updateAlarms;
            this.update.alarmsNoArchived = this.config.updateAlarmsNoArchived;
            this.update.dpi = this.config.updateDpi;
            this.update.gatewayTraffic = this.config.updateGatewayTraffic;
            this.update.gatewayTrafficMaxDays = Number(this.config.gatewayTrafficMaxDays);

            this.objectsFilter = this.config.objectsFilter;
            this.statesFilter = this.normalizeStatesFilter(this.config.statesFilter);

            this.clients.isOnlineOffset = parseInt(String(this.config.clientsIsOnlineOffset), 10) * 1000 || 60 * 1000;

            this.vouchers.number = this.config.createVouchersNumber;
            this.vouchers.duration = this.config.createVouchersDuration;
            this.vouchers.quota = this.config.createVouchersQuota;
            this.vouchers.uploadLimit = !this.config.createVouchersUploadLimit
                ? null
                : this.config.createVouchersUploadLimit;
            this.vouchers.downloadLimit = !this.config.createVouchersDownloadLimit
                ? null
                : this.config.createVouchersDownloadLimit;
            this.vouchers.byteQuota = !this.config.createVouchersByteQuota ? null : this.config.createVouchersByteQuota;
            this.vouchers.note = this.config.createVouchersNote;

            if (
                this.settings.controllerIp !== '' &&
                this.settings.controllerUsername !== '' &&
                this.settings.controllerPassword !== ''
            ) {
                // Send some log messages
                this.log.debug(`controller = ${this.settings.controllerIp}:${this.settings.controllerPort}`);
                this.log.debug(`updateInterval = ${this.settings.updateInterval / 1000}`);

                // Start main function
                void this.updateUnifiData();
            } else {
                this.log.error('Adapter deactivated due to missing configuration.');

                await this.setStateAsync('info.connection', { ack: true, val: false });
                await this.setForeignStateAsync(`system.adapter.${this.namespace}.alive`, false);
            }
        } catch (err) {
            this.handleError(err, undefined, 'onReady');
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param id ID of the state
     * @param state the new state
     */
    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (state && !state.ack) {
            // The state was changed
            const idParts = id.split('.');
            const site = idParts[2];
            const mac = idParts[4];

            try {
                if (idParts[3] === 'wlans' && idParts[5] === 'enabled') {
                    await this.updateWlanStatus(site, id, state);
                } else if (idParts[3] === 'vouchers' && idParts[4] === 'create_vouchers') {
                    await this.createUnifiVouchers(site);
                } else if (idParts[2] === 'trigger_update') {
                    await this.updateUnifiData(true);
                } else if (idParts[7] === 'port_poe_enabled') {
                    const portNumber = idParts[6].split('_').pop() || '';
                    void this.switchPoeOfPort(site, mac, portNumber, state.val);
                } else if (idParts[7] === 'port_poe_cycle') {
                    const portNumber = idParts[6].split('_').pop() || '';

                    this.log.info(`onStateChange: port power cycle (port: ${portNumber}, device: ${mac})`);

                    await this.controllers[site].powerCycleSwitchPort(mac, portNumber);
                } else if (idParts[5] === 'reconnect') {
                    await this.reconnectClient(id, idParts, site);
                } else if (idParts[5] === 'blocked') {
                    await this.blockClient(id, site, idParts, state.val);
                } else if (idParts[5] === 'led_override') {
                    const deviceId = await this.getStateAsync(`${id.substring(0, id.lastIndexOf('.'))}.device_id`);
                    if (!deviceId) {
                        throw new Error(`onStateChange: device_id of ${id} not found`);
                    }

                    this.log.info(`onStateChange: override led to '${state.val}' (device: ${deviceId.val})`);

                    await this.controllers[site].setLEDOverride(String(deviceId.val), String(state.val));
                } else if (idParts[5] === 'restart') {
                    this.log.info(`onStateChange: restart device '${mac}'`);

                    await this.controllers[site].restartDevice(mac, 'soft');
                }
            } catch (err) {
                this.handleError(err, site, 'onStateChange');
            }
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback to call when done
     */
    private onUnload(callback: () => void): void {
        try {
            this.stopped = true;
            if (this.queryTimeout) {
                this.clearTimeout(this.queryTimeout);
                this.queryTimeout = undefined;
            }

            this.log.info('cleaned everything up...');
            callback();
        } catch {
            callback();
        }
    }

    /**
     * The admin page stores only the selected states. As the filter is checked on
     * every level of the object tree, the channels above them are added, as well as
     * the states they depend on. Nothing selected means: create all states.
     *
     * @param statesFilter filter from the configuration
     */
    private normalizeStatesFilter(statesFilter: Partial<UnifiStatesFilter> | undefined): UnifiStatesFilter {
        const result = {} as UnifiStatesFilter;

        for (const category of STATES_FILTER_CATEGORIES) {
            const selected = statesFilter && Array.isArray(statesFilter[category]) ? statesFilter[category] : [];
            const stateIds = collectStateIds(loadObjectDefinitions(category)[category].logic.has || {});

            // Older versions also stored the channels, which are not needed to find the selection
            const states = selected.filter(id => stateIds.includes(id));
            for (const [state, required] of STATE_DEPENDENCIES) {
                if (states.includes(state)) {
                    states.push(...stateIds.filter(id => required.some(req => id === req || id.startsWith(`${req}.`))));
                }
            }

            const ids = new Set<string>();
            for (const id of states) {
                const parts = id.split('.');
                for (let i = 1; i <= parts.length; i++) {
                    ids.add(parts.slice(0, i).join('.'));
                }
            }
            result[category] = [...ids];
        }

        return result;
    }

    /**
     * Schedule the next automatic refresh. Existing timers are always replaced,
     * so a failed request cannot accidentally create parallel refresh loops.
     *
     * @param delay in ms
     */
    private scheduleNextUpdate(delay = this.settings.updateInterval): void {
        if (this.queryTimeout) {
            this.clearTimeout(this.queryTimeout);
        }

        this.queryTimeout = this.setTimeout(() => {
            this.queryTimeout = undefined;
            void this.updateUnifiData();
        }, delay);
    }

    /**
     * Create and authenticate a controller only when it is needed. The session
     * is reused between refreshes to avoid hitting the controller login limit.
     *
     * @param site name of the site
     */
    private async getController(site = 'default'): Promise<Controller> {
        if (this.controllers[site]) {
            return this.controllers[site];
        }

        const options: ControllerOptions = {
            host: this.settings.controllerIp,
            port: this.settings.controllerPort,
            username: this.settings.controllerUsername,
            password: this.settings.controllerPassword,
            sslverify: !this.settings.ignoreSSLErrors,
            timeout: 10000,
        };

        if (site !== 'default') {
            options.site = site;
        }

        const controller = new Controller(options);
        await controller.login();
        this.controllers[site] = controller;
        this.log.debug(`Login successful for site '${site}'`);

        return controller;
    }

    /** Reset cached sessions before a single re-authentication attempt. */
    private resetControllers(): void {
        this.controllers = {};
    }

    /**
     * Diagnostic states must never interrupt the refresh loop itself. Only
     * changed values are written to avoid a state update on every refresh.
     *
     * @param id ID of the state
     * @param val value to write
     */
    private async setDiagnosticState(id: string, val: ioBroker.StateValue): Promise<void> {
        try {
            await this.setStateChangedAsync(id, { ack: true, val });
        } catch (err) {
            this.log.warn(`Could not update diagnostic state '${id}': ${(err as Error).message || err}`);
        }
    }

    /**
     * Detect a rejected session. A 403 is not included on purpose: the controller
     * answers with 403 (api.err.NoPermission) when the user lacks the rights for a
     * single endpoint, and logging in again cannot fix that.
     *
     * @param err error of node-unifi
     */
    private isAuthenticationError(err: UnifiError): boolean {
        const status = err.response && err.response.status;
        return status === 401 || err.message === 'api.err.LoginRequired';
    }

    /**
     * Execute one complete refresh. A failing site or endpoint is logged and
     * skipped, so it cannot block the remaining data. If cached sessions are used,
     * an authentication error is passed on instead, because the session may have
     * expired and the caller logs in again.
     *
     * @param sessionReused cached sessions are used
     * @returns descriptions of the failed requests
     */
    private async performUpdate(sessionReused = false): Promise<string[]> {
        const failures: string[] = [];
        let clientsIncomplete = false;

        const handleFailure = (err: UnifiError, site: string, methodName: string): void => {
            if (sessionReused && this.isAuthenticationError(err)) {
                throw err;
            }
            failures.push(`${methodName} (${site}): ${err.message || String(err)}`);
            this.handleError(err, site, methodName);
        };

        const defaultController = await this.getController();
        const sites = await this.fetchSites(defaultController);

        for (const site of sites) {
            if (this.stopped) {
                return failures;
            }

            if (site === 'default') {
                this.controllers[site] = defaultController;
            } else {
                try {
                    await this.getController(site);
                } catch (err) {
                    clientsIncomplete = clientsIncomplete || this.update.clients === true;
                    handleFailure(err, site, 'getController');
                    continue;
                }
            }

            this.log.debug(`Update site: ${site}`);

            for (const [updateKey, methodName] of FETCH_METHODS) {
                if (this.stopped) {
                    return failures;
                }
                if (this.update[updateKey] !== true) {
                    continue;
                }

                try {
                    await this[methodName](site);
                } catch (err) {
                    clientsIncomplete = clientsIncomplete || updateKey === 'clients';
                    handleFailure(err, site, methodName);
                }
            }
        }

        // Without fresh client data every client would be marked as offline
        if (clientsIncomplete) {
            this.log.debug('Skipping client online status because not all clients could be fetched');
        } else {
            await this.setClientOnlineStatus();
        }

        return failures;
    }

    /**
     * Function to handle error messages
     *
     * @param err error to log
     * @param site site of the request
     * @param methodName method that failed
     */
    private handleError(err: UnifiError, site: string | undefined, methodName?: string): void {
        if (err.message === 'api.err.Invalid') {
            this.log.error(`Error site ${site}: Incorrect username or password.`);
        } else if (err.message === 'api.err.LoginRequired') {
            this.log.error(`Error site ${site}: Login required. Check username and password.`);
        } else if (err.message === 'api.err.Ubic2faTokenRequired') {
            this.log.error(
                `Error site ${site}: 2-Factor-Authentication required by UniFi controller. 2FA is not supported by this adapter.`,
            );
        } else if (err.message === 'api.err.ServerBusy') {
            this.log.error(
                `Error site ${site}: Server is busy. There seems to be a problem with the UniFi controller.`,
            );
        } else if (err.message === 'api.err.NoPermission' || err.response?.data?.meta?.msg === 'api.err.NoPermission') {
            this.log.error(`Error site ${site}: Permission denied. Check access rights.`);
        } else if (err.message.includes('connect EHOSTUNREACH') || err.message.includes('connect ENETUNREACH')) {
            this.log.error(`Error site ${site}: Host or network cannot be reached.`);
        } else if (err.message.includes('connect ECONNREFUSED')) {
            this.log.error(`Error site ${site}: Connection refused. Incorrect IP or port.`);
        } else if (err.message.includes('connect ETIMEDOUT')) {
            this.log.error(`Error site ${site}: Connection timedout.`);
        } else if (err.message.includes('read ECONNRESET')) {
            this.log.error(`Error site ${site}: Connection was closed by the UniFi controller.`);
        } else if (err.message.includes('getaddrinfo EAI_AGAIN')) {
            this.log.error(
                `Error site ${site}: This error is not related to the adapter. There seems to be a DNS issue. Please google for "getaddrinfo EAI_AGAIN" to fix the issue.`,
            );
        } else if (err.message.includes('getaddrinfo ENOTFOUND')) {
            this.log.error(`Error site ${site}: Host not found. Incorrect IP or port.`);
        } else if (err.message.includes('socket hang up')) {
            this.log.error(`Error site ${site}: Socket hang up: ${err.message}`);
        } else if (err.message.includes('socket disconnected')) {
            this.log.error(`Error site ${site}: Socket disconnected: ${err.message}`);
        } else if (
            err.message.includes('SSL routines') ||
            err.message.includes('ssl3_') ||
            err.message.includes('certificate has expired')
        ) {
            this.log.error(`Error site ${site}: SSL/Certificate issue: ${err.message}`);
        } else if (err.message === 'api.err.InvalidArgs' || err.message === 'api.err.IncorrectNumberRange') {
            this.log.error(`Parameters for this call are invalid (${err.message})! Please check the parameters`);
        } else if (err.message === 'aborted') {
            this.log.error(`Request aborted.`);
        } else if (err.message.includes('Returned data is not in valid format')) {
            this.log.error(err.message);
        } else {
            if (err.response && err.response.data) {
                this.log.error(`Error site ${site} (data): ${JSON.stringify(err.response.data)}`);
            }
            if (methodName) {
                this.log.error(`[${methodName} site ${site}] error: ${err.message}, stack: ${err.stack}`);
            } else {
                this.log.error(`Error site ${site}: ${err.message}, stack: ${err.stack}`);
            }

            if (this.supportsFeature?.('PLUGINS')) {
                const sentryInstance = this.getPluginInstance('sentry');
                if (sentryInstance) {
                    sentryInstance.getSentryObject()?.captureException(err);
                }
            }
        }
    }

    /**
     * Function that takes care of the API calls and processes
     * the responses afterwards
     *
     * @param preventReschedule do not schedule the next refresh (trigger_update)
     */
    private async updateUnifiData(preventReschedule = false): Promise<void> {
        if (this.updateInProgress) {
            this.log.debug('Skipping update because the previous refresh is still running.');

            // The running refresh may come from trigger_update, which does not reschedule
            if (preventReschedule === false && !this.stopped) {
                this.scheduleNextUpdate();
            }
            return;
        }

        this.updateInProgress = true;
        await this.setDiagnosticState('info.lastRefreshAttempt', Date.now());
        await this.setDiagnosticState('info.refreshInProgress', true);

        let successful = false;
        try {
            this.log.debug('Update started');

            // Without cached sessions every login is fresh, so logging in again cannot help
            const sessionReused = Object.keys(this.controllers).length > 0;
            let failures: string[];
            try {
                failures = await this.performUpdate(sessionReused);
            } catch (err) {
                if (!sessionReused || !this.isAuthenticationError(err)) {
                    throw err;
                }
                this.log.info('UniFi session expired. Re-authenticating.');
                this.resetControllers();
                failures = await this.performUpdate(false);
            }

            successful = true;
            this.consecutiveErrors = 0;
            await this.setDiagnosticState('info.connection', true);
            await this.setDiagnosticState('info.lastSuccessfulRefresh', Date.now());
            await this.setDiagnosticState('info.lastError', failures.join('; '));
            await this.setDiagnosticState('info.consecutiveErrors', 0);
            this.log.debug(failures.length ? `Update done with ${failures.length} failed request(s)` : 'Update done');
        } catch (err) {
            this.consecutiveErrors++;
            await this.setDiagnosticState('info.connection', false);
            await this.setDiagnosticState('info.lastError', (err as Error).message || String(err));
            await this.setDiagnosticState('info.consecutiveErrors', this.consecutiveErrors);

            this.handleError(err, undefined, 'updateUnifiData');
        } finally {
            this.updateInProgress = false;
            await this.setDiagnosticState('info.refreshInProgress', false);

            if (preventReschedule === false && !this.stopped) {
                // Backoff 1x, 2x, 4x, 8x, 16x: capped, but never shorter than the configured interval
                const interval = this.settings.updateInterval;
                const backoffFactor = successful ? 1 : Math.pow(2, Math.min(this.consecutiveErrors - 1, 4));
                const delay = Math.max(interval, Math.min(interval * backoffFactor, MAX_BACKOFF_DELAY));
                this.scheduleNextUpdate(delay);
            }
        }
    }

    /**
     * Function to fetch the sites
     *
     * @param siteController controller of the default site
     * @returns the names of the sites
     */
    private async fetchSites(siteController: Controller): Promise<string[]> {
        const data = (await siteController.getSites()) as UnifiSite[] | undefined;
        if (data === undefined) {
            throw new Error(`fetchSites: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        const sites = data.map(s => s.name);
        this.log.debug(`fetchSites: ${sites.join(',')}`);

        await this.processSites(sites, data);

        return sites;
    }

    /**
     * Function that receives the sites as a JSON data array
     *
     * @param sites names of the sites
     * @param data data of the sites
     */
    private async processSites(sites: string[], data: UnifiSite[]): Promise<void> {
        const objects = loadObjectDefinitions('sites');

        for (const site of sites) {
            const x = sites.indexOf(site);
            const siteData = data[x];

            this.log.silly(`processSites: site: ${site}, data: ${JSON.stringify(data[x])}`);

            await this.applyJsonLogic('', siteData, objects, ['site']);
        }
    }

    /**
     * Function to fetch site sysinfo
     *
     * @param site name of the site
     */
    private async fetchSiteSysinfo(site: string): Promise<unknown[]> {
        const data = (await this.controllers[site].getSiteSysinfo()) as unknown[] | undefined;
        if (data === undefined) {
            throw new Error(`fetchSiteSysinfo ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchSiteSysinfo ${site}: ${data.length}`);
        this.log.silly(`fetchSiteSysinfo ${site}: ${JSON.stringify(data)}`);

        await this.processSiteSysinfo(site, data);

        return data;
    }

    /**
     * Function that receives the site sysinfo as a JSON data array
     *
     * @param site name of the site
     * @param data sysinfo of the site
     */
    private async processSiteSysinfo(site: string, data: unknown[]): Promise<void> {
        const objects = loadObjectDefinitions('sysinfo');

        await this.applyJsonLogic(site, data, objects, this.statesFilter.sysinfo);
    }

    /**
     * Function to fetch clients
     *
     * @param site name of the site
     */
    private async fetchClients(site: string): Promise<UnifiClient[]> {
        const data = await this.controllers[site].getClientDevices();
        if (!Array.isArray(data)) {
            throw new Error(`fetchClients ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchClients ${site}: ${data.length}`);
        this.log.silly(`fetchClients ${site}: ${JSON.stringify(data)}`);

        await this.processClients(site, data as UnifiClient[]);
        await this.processBlockedClients(site);

        return data as UnifiClient[];
    }

    /**
     * Function that receives the clients as a JSON data array
     *
     * @param site name of the site
     * @param data clients of the site
     */
    private async processClients(site: string, data: UnifiClient[]): Promise<void> {
        const objects = loadObjectDefinitions('clients');
        const filter = this.objectsFilter.clients;

        if (this.update.blacklist === true) {
            // Whitelist: only the listed clients
            const siteData = data.filter(item => isInList(filter, item.mac, item.ip, item.name, item.hostname));

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.clients);
            }
        }
        if (this.update.blacklist === false) {
            const siteData = data.filter(item => !isInList(filter, item.mac, item.ip, item.name, item.hostname));

            this.log.silly(`processClients: filtered data: ${JSON.stringify(siteData)}`);

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.clients);
            }
        }
    }

    /**
     * Function to identify blocked clients and set the correct state
     *
     * @param site name of the site
     */
    private async processBlockedClients(site: string): Promise<void> {
        if (this.statesFilter.clients.includes('clients.client.blocked')) {
            const blockedClients = (await this.controllers[site].getBlockedUsers()) as UnifiBlockedClient[] | undefined;

            const allClients = await this.getStatesAsync(`*.clients.*.blocked`);

            for (const id in allClients) {
                if (blockedClients && blockedClients.length > 0) {
                    const clientMac = id.match(MAC_ADDRESS)?.[0];
                    const index = blockedClients.findIndex(x => x.mac === clientMac);

                    if (index === -1) {
                        await this.setStateAsync(id, false, true);
                    } else {
                        await this.setStateAsync(id, true, true);
                        this.log.debug(`client '${clientMac}' is blocked`);
                    }
                } else {
                    await this.setStateAsync(id, false, true);
                }
            }
        }
    }

    /**
     * Update is_online of offline clients
     */
    private async setClientOnlineStatus(): Promise<void> {
        const wlanStates = await this.getStatesAsync('*.clients.*.last_seen_by_uap');
        const wiredStates = await this.getStatesAsync('*.clients.*.last_seen_by_usw');

        // Workaround for UniFi bug "wireless clients shown as wired clients"
        // https://community.ui.com/questions/Wireless-clients-shown-as-wired-clients/49d49818-4dab-473a-ba7f-d51bc4c067d1
        for (const key of Object.keys(wlanStates)) {
            const wiredStateId = key.replace('last_seen_by_uap', 'last_seen_by_usw');

            if (Object.prototype.hasOwnProperty.call(wiredStates, wiredStateId)) {
                delete wiredStates[wiredStateId];
            }
        }

        const states = {
            ...wlanStates,
            ...wiredStates,
        };

        const now = Math.floor(Date.now() / 1000) * 1000;

        for (const [key, value] of Object.entries(states)) {
            if (value !== null && typeof value.val === 'string') {
                const lastSeen = Date.parse(value.val.replace(' ', 'T'));
                const isOnline = lastSeen - (now - this.settings.updateInterval - this.clients.isOnlineOffset) >= 0;
                const stateId = key.replace(/last_seen_by_(usw|uap)/gi, 'is_online');
                const oldState = await this.getStateAsync(stateId);

                if (!oldState) {
                    // This is the case if the client is new to the adapter with older JS-Controller versions
                    // Check if object is available and set the value
                    const oldObject = await this.getForeignObjectAsync(stateId);

                    if (oldObject) {
                        await this.setForeignStateAsync(stateId, { ack: true, val: isOnline });
                    }
                } else if (oldState.val !== isOnline) {
                    await this.setForeignStateAsync(stateId, { ack: true, val: isOnline });
                }
            }
        }
    }

    /**
     * Function to fetch devices
     *
     * @param site name of the site
     */
    private async fetchDevices(site: string): Promise<UnifiDevice[]> {
        const data = await this.controllers[site].getAccessDevices();
        if (!Array.isArray(data)) {
            throw new Error(`fetchDevices ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchDevices ${site}: ${data.length}`);
        this.log.silly(`fetchDevices ${site}: ${JSON.stringify(data)}`);

        await this.processDevices(site, data as UnifiDevice[]);

        return data as UnifiDevice[];
    }

    /**
     * Function that receives the devices as a JSON data array
     *
     * @param site name of the site
     * @param data devices of the site
     */
    private async processDevices(site: string, data: UnifiDevice[]): Promise<void> {
        const objects = loadObjectDefinitions('devices');

        // Process objectsFilter
        const siteData = data.filter(item => !isInList(this.objectsFilter.devices, item.mac, item.ip, item.name));

        this.log.silly(`processDevices: filtered data: ${JSON.stringify(siteData)}`);

        if (siteData.length > 0) {
            await this.applyJsonLogic(site, siteData, objects, this.statesFilter.devices);
        }
    }

    /**
     * Function to fetch WLANs
     *
     * @param site name of the site
     */
    private async fetchWlans(site: string): Promise<UnifiNamedItem[]> {
        const data = await this.controllers[site].getWLanSettings();
        if (!Array.isArray(data)) {
            throw new Error(`fetchWlans ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchWlans ${site}: ${data.length}`);
        this.log.silly(`fetchWlans ${site}: ${JSON.stringify(data)}`);

        await this.processWlans(site, data as UnifiNamedItem[]);

        return data as UnifiNamedItem[];
    }

    /**
     * Function that receives the WLANs as a JSON data array
     *
     * @param site name of the site
     * @param data WLANs of the site
     */
    private async processWlans(site: string, data: UnifiNamedItem[]): Promise<void> {
        const objects = loadObjectDefinitions('wlans');

        // Process objectsFilter
        const siteData = data.filter(item => !isInList(this.objectsFilter.wlans, item.name));

        this.log.silly(`processWlans: filtered data: ${JSON.stringify(siteData)}`);

        if (siteData.length > 0) {
            await this.applyJsonLogic(site, siteData, objects, this.statesFilter.wlans);
        }
    }

    /**
     * Function to fetch networks
     *
     * @param site name of the site
     */
    private async fetchNetworks(site: string): Promise<UnifiNamedItem[]> {
        const data = await this.controllers[site].getNetworkConf();
        if (!Array.isArray(data)) {
            throw new Error(`fetchNetworks ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchNetworks ${site}: ${data.length}`);
        this.log.silly(`fetchNetworks ${site}: ${JSON.stringify(data)}`);

        await this.processNetworks(site, data as UnifiNamedItem[]);

        return data as UnifiNamedItem[];
    }

    /**
     * Function that receives the networks as a JSON data array
     *
     * @param site name of the site
     * @param data networks of the site
     */
    private async processNetworks(site: string, data: UnifiNamedItem[]): Promise<void> {
        const objects = loadObjectDefinitions('networks');

        // Process objectsFilter
        const siteData = data.filter(item => !isInList(this.objectsFilter.networks, item.name));

        this.log.silly(`processNetworks: filtered data: ${JSON.stringify(siteData)}`);

        if (siteData.length > 0) {
            await this.applyJsonLogic(site, siteData, objects, this.statesFilter.networks);
        }
    }

    /**
     * Function to fetch health
     *
     * @param site name of the site
     */
    private async fetchHealth(site: string): Promise<UnifiHealth[]> {
        const data = await this.controllers[site].getHealth();
        if (!Array.isArray(data)) {
            throw new Error(`fetchHealth ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchHealth ${site}: ${data.length}`);
        this.log.silly(`fetchHealth ${site}: ${JSON.stringify(data)}`);

        await this.processHealth(site, data as UnifiHealth[]);

        return data as UnifiHealth[];
    }

    /**
     * Function that receives the health as a JSON data array
     *
     * @param site name of the site
     * @param data health of the site
     */
    private async processHealth(site: string, data: UnifiHealth[]): Promise<void> {
        const objects = loadObjectDefinitions('health');

        // Process objectsFilter
        const siteData = data.filter(item => !isInList(this.objectsFilter.health, item.subsystem));

        this.log.silly(`processHealth: filtered data: ${JSON.stringify(siteData)}`);

        if (siteData.length > 0) {
            await this.applyJsonLogic(site, siteData, objects, this.statesFilter.health);
        }
    }

    /**
     * Function to fetch vouchers
     *
     * @param site name of the site
     */
    private async fetchVouchers(site: string): Promise<UnifiVoucher[]> {
        const data = await this.controllers[site].getVouchers();
        if (!Array.isArray(data)) {
            throw new Error(`fetchVouchers ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchVouchers ${site}: ${data.length}`);
        this.log.silly(`fetchVouchers ${site}: ${JSON.stringify(data)}`);

        await this.processVouchers(site, data as UnifiVoucher[]);

        return data as UnifiVoucher[];
    }

    /**
     * Function that receives the vouchers as a JSON data array
     *
     * @param site name of the site
     * @param data vouchers of the site
     */
    private async processVouchers(site: string, data: UnifiVoucher[]): Promise<void> {
        const objects = loadObjectDefinitions('vouchers');

        let siteData = data;

        if (this.update.vouchersNoUsed) {
            // Remove used vouchers
            siteData = siteData.filter(item => item.used === 0);

            this.log.silly(`processVouchers: filtered data: ${JSON.stringify(siteData)}`);

            const existingVouchers = await this.getForeignObjectsAsync(
                `${this.namespace}.${site}.vouchers.voucher_*`,
                'channel',
            );

            for (const voucher in existingVouchers) {
                const voucherId = voucher.replace(`${this.namespace}.${site}.vouchers.voucher_`, '');

                if (!siteData.find(item => item.code === voucherId)) {
                    const voucherChannelId = `${this.namespace}.${site}.vouchers.voucher_${voucherId}`;

                    this.log.debug(`deleting data points of voucher with id '${voucherId}'`);

                    // voucher id not exist in api request result -> get dps and delete them
                    const dpsOfVoucherId = await this.getForeignObjectsAsync(`${voucherChannelId}.*`);

                    for (const id in dpsOfVoucherId) {
                        // delete datapoint
                        await this.delObjectAsync(id);

                        // remove from own objects if exist
                        delete this.ownObjects[id.replace(`${this.namespace}.`, '')];
                    }

                    // delete voucher channel
                    await this.delObjectAsync(voucherChannelId);
                    delete this.ownObjects[voucherChannelId.replace(`${this.namespace}.`, '')];
                }
            }
        }

        await this.applyJsonLogic(site, siteData, objects, this.statesFilter.vouchers);
    }

    /**
     * Function to fetch dpi
     *
     * @param site name of the site
     */
    private async fetchDpi(site: string): Promise<UnifiDpiStats[]> {
        const data = await this.controllers[site].getDPIStats();
        if (!Array.isArray(data)) {
            throw new Error(
                `fetchDpi ${site}: Returned data is not in valid format. This option is only available for gateways!: ${JSON.stringify(data)}`,
            );
        }
        const stats = data as UnifiDpiStats[];
        if (stats[0] && stats[0].by_cat && stats[0].by_app) {
            this.log.debug(`fetchDpi ${site}: categories: ${stats[0].by_cat.length}, apps: ${stats[0].by_app.length}`);
        }

        this.log.silly(`fetchDpi ${site}: ${JSON.stringify(data)}`);

        await this.processDpi(site, stats);

        return stats;
    }

    /**
     * Function that receives the dpi as a JSON data array
     *
     * @param site name of the site
     * @param data DPI statistics of the site
     */
    private async processDpi(site: string, data: UnifiDpiStats[]): Promise<void> {
        const objects = loadObjectDefinitions('dpi');

        // DPI data has no objects filter
        const siteData = data.filter(item => item);

        this.log.silly(`processDpi: filtered data: ${JSON.stringify(siteData)}`);

        if (siteData.length > 0) {
            await this.applyJsonLogic(site, siteData, objects, this.statesFilter.dpi);
        }
    }

    /**
     * Function to fetch daily gateway traffic
     *
     * @param site name of the site
     */
    private async fetchGatewayTraffic(site: string): Promise<unknown[]> {
        let start: number | undefined = undefined;
        let end: number | undefined = undefined;
        if (this.update.gatewayTrafficMaxDays > 0) {
            const now = new Date();
            end = now.getTime();

            now.setDate(now.getDate() - this.update.gatewayTrafficMaxDays);
            start = now.getTime();

            this.log.silly(
                `fetchGatewayTraffic: start: ${new Date(start).toLocaleDateString()}, end: ${new Date(end).toLocaleDateString()}`,
            );
        }

        const data = await this.controllers[site].getDailyGatewayStats(start, end, ['lan-rx_bytes', 'lan-tx_bytes']);
        if (!Array.isArray(data)) {
            throw new Error(
                `fetchGatewayTraffic ${site}: Returned data is not in valid format. This option is only available for gateways!: ${JSON.stringify(data)}`,
            );
        }
        this.log.debug(`fetchGatewayTraffic ${site}: ${data.length}`);
        this.log.silly(`fetchGatewayTraffic ${site}: ${JSON.stringify(data)}`);

        await this.processGatewayTraffic(site, data);

        return data;
    }

    /**
     * Function that receives the daily gateway traffic as a JSON data array
     *
     * @param site name of the site
     * @param data traffic of the site
     */
    private async processGatewayTraffic(site: string, data: unknown[]): Promise<void> {
        const objects = loadObjectDefinitions('gateway_traffic');

        // Gateway traffic has no objects filter
        const siteData = data.filter(item => item);

        this.log.silly(`processGatewayTraffic: filtered data: ${JSON.stringify(siteData)}`);

        if (siteData.length > 0) {
            await this.applyJsonLogic(site, siteData, objects, this.statesFilter.gateway_traffic);
        }
    }

    /**
     * Function to fetch alarms
     *
     * @param site name of the site
     */
    private async fetchAlarms(site: string): Promise<UnifiAlarm[]> {
        const data = await this.controllers[site].getAlarms();
        if (!Array.isArray(data)) {
            throw new Error(`fetchAlarms ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchAlarms ${site}: ${data.length}`);
        this.log.silly(`fetchAlarms ${site}: ${JSON.stringify(data)}`);

        await this.processAlarms(site, data as UnifiAlarm[]);

        return data as UnifiAlarm[];
    }

    /**
     * Function that receives the alarms as a JSON data array
     *
     * @param site name of the site
     * @param data alarms of the site
     */
    private async processAlarms(site: string, data: UnifiAlarm[]): Promise<void> {
        const objects = loadObjectDefinitions('alarms');

        // Alarms have no objects filter
        const siteData = data.filter(item => item);

        this.log.silly(`processAlarms: filtered data: ${JSON.stringify(siteData)}`);

        if (this.update.alarmsNoArchived) {
            const existingAlarms = await this.getForeignObjectsAsync(
                `${this.namespace}.${site}.alarms.alarm_*`,
                'channel',
            );
            const alarmDatapoints = this.getUnifiObjectsLibIds('alarms');

            for (const alarm in existingAlarms) {
                const alarmId = alarm.replace(`${this.namespace}.${site}.alarms.alarm_`, '');

                if (!siteData.find(item => item._id === alarmId)) {
                    this.log.debug(`deleting data points of alarm with id '${alarmId}'`);

                    for (const dp of alarmDatapoints) {
                        const dpId = `${site}.${dp.replace('.alarm', `.alarm_${alarmId}`)}`;

                        if (await this.getObjectAsync(dpId)) {
                            await this.delObjectAsync(dpId);
                        }

                        // remove from own objects if exist
                        delete this.ownObjects[dpId];
                    }
                }
            }
        }

        if (siteData.length > 0) {
            await this.applyJsonLogic(site, siteData, objects, this.statesFilter.alarms);
        }
    }

    /**
     * Disable or enable a WLAN
     *
     * @param site name of the site
     * @param objId ID of the enabled state
     * @param state the new state
     */
    private async updateWlanStatus(site: string, objId: string, state: ioBroker.State): Promise<boolean | undefined> {
        try {
            await this.setWlanStatus(site, objId, state);

            this.log.info(`WLAN status set to ${state.val}`);

            return true;
        } catch (err) {
            this.handleError(err, site, 'updateWlanStatus');
        }
    }

    /**
     * Function to enable or disable a WLAN
     *
     * @param site name of the site
     * @param objId ID of the enabled state
     * @param state the new state
     */
    private async setWlanStatus(site: string, objId: string, state: ioBroker.State): Promise<UnifiNamedItem[]> {
        const obj = await this.getForeignObjectAsync(objId);

        if (!obj || !obj.native) {
            throw new Error(`setWlanStatus: Object ${objId} invalid, please restart adapter!`);
        }

        const wlanId = obj.native.wlan_id as string;
        const disable = !state.val;

        const data = await this.controllers[site].disableWLan(wlanId, disable);
        if (!Array.isArray(data)) {
            throw new Error(`setWlanStatus: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`setWlanStatus: ${data.length}`);

        await this.processWlans(site, data as UnifiNamedItem[]);

        return data as UnifiNamedItem[];
    }

    /**
     * Create vouchers
     *
     * @param site name of the site
     */
    private async createUnifiVouchers(site: string): Promise<boolean> {
        try {
            await this.createVouchers(site);
            await this.fetchVouchers(site);

            this.log.info('Vouchers created');

            return true;
        } catch (err) {
            this.handleError(err, site, 'createUnifiVouchers');
            return false;
        }
    }

    /**
     * Function to create vouchers
     *
     * @param site name of the site
     */
    private async createVouchers(site: string): Promise<unknown[]> {
        // The old admin page stored the numbers as text
        const minutes = Number(this.vouchers.duration) || 60;
        const count = Number(this.vouchers.number) || 1;
        const quota = Number(this.vouchers.quota) || 1;
        const note = this.vouchers.note || '';
        const up = Number(this.vouchers.uploadLimit) || 0;
        const down = Number(this.vouchers.downloadLimit) || 0;
        const mbytes = Number(this.vouchers.byteQuota) || 0;

        // node-unifi 2 takes the site from the controller, it is not a parameter anymore
        const data = await this.controllers[site].createVouchers(minutes, count, quota, note, up, down, mbytes);
        if (!Array.isArray(data)) {
            throw new Error(`createVouchers: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`createVouchers: ${data.length}`);

        return data;
    }

    /**
     * Function to switch poe power for port of device
     *
     * @param site name of the site
     * @param deviceMac MAC address of the switch
     * @param port number of the port
     * @param val switch on
     */
    private async switchPoeOfPort(
        site: string,
        deviceMac: string,
        port: string,
        val: ioBroker.StateValue,
    ): Promise<void> {
        try {
            this.log.info(`switchPoeOfPort: switching poe power of port ${port} for device ${deviceMac} to ${val}`);

            // we have to get whole data of 'port_overrides' to change poe power of single port.
            // we must sent the 'port_overrides' for all ports, otherwise the other port will set to default settings

            const result = await this.fetchDevices(site);

            const dataDevice = result.filter(x => x.mac === deviceMac);

            if (dataDevice && dataDevice.length) {
                const deviceId = dataDevice[0].device_id;

                const port_overrides = dataDevice[0].port_overrides;

                if (port_overrides && port_overrides.length > 0) {
                    const indexOfPort = port_overrides.findIndex(x => x.port_idx === parseInt(port));

                    if (indexOfPort === -1) {
                        // Known issue: creating the missing override was never implemented, so this failed before too
                        this.log.debug(
                            `switchPoeOfPort: port ${port} not exists in port_overrides object -> create item`,
                        );
                        throw new Error(`switchPoeOfPort: port ${port} has no port_overrides entry`);
                    }

                    // port_overrides has settings for this port
                    port_overrides[indexOfPort].poe_mode = val ? 'auto' : 'off';

                    await this.controllers[site].setDeviceSettingsBase(deviceId, { port_overrides: port_overrides });

                    await this.fetchDevices(site);
                } else {
                    this.log.debug(`switchPoeOfPort: no port_overrides object exists!`);
                }
            }
        } catch (err) {
            this.handleError(err, undefined, 'switchPoeOfPort');
        }
    }

    /**
     * Function to reconnect a client
     *
     * @param id ID of the reconnect state
     * @param idParts parts of the ID
     * @param site name of the site
     */
    private async reconnectClient(id: string, idParts: string[], site: string): Promise<void> {
        try {
            const mac = idParts[4];
            const name = await this.getStateAsync(id.replace(idParts[5], 'name'));

            if (name && name.val) {
                this.log.info(`reconnectClient: reconnecting client '${name.val}' (mac: ${mac})'`);
            } else {
                this.log.info(`reconnectClient: reconnecting client '${mac}'`);
            }

            await this.controllers[site].reconnectClient(mac);
        } catch (err) {
            this.handleError(err, undefined, 'reconnectClient');
        }
    }

    /**
     * Function to block / unblock client
     *
     * @param id ID of the blocked state
     * @param site name of the site
     * @param idParts parts of the ID
     * @param block block the client
     */
    private async blockClient(id: string, site: string, idParts: string[], block: ioBroker.StateValue): Promise<void> {
        const mac = idParts[4];
        const name = await this.getStateAsync(id.replace(idParts[5], 'name'));

        if (name && name.val) {
            this.log.info(`${block ? 'block' : 'unblock'} client '${name.val}' (mac: ${mac})'`);
        } else {
            this.log.info(`${block ? 'block' : 'unblock'} client '${mac}'`);
        }

        if (block) {
            await this.controllers[site].blockClient(mac);
        } else {
            await this.controllers[site].unblockClient(mac);
        }
    }

    /**
     * Function to apply JSON logic to API responses
     *
     * @param objectTree ID of the parent object, empty for the root
     * @param data data from the controller
     * @param objects definitions of the objects
     * @param statesFilter IDs of the definitions to create, empty or undefined for all
     */
    private async applyJsonLogic(
        objectTree: string,
        data: unknown,
        objects: ObjectDefinitions,
        statesFilter: string[] | undefined,
    ): Promise<void> {
        try {
            for (const key in objects) {
                if (this.stopped) {
                    return;
                }
                if (statesFilter === undefined || statesFilter.length === 0 || statesFilter.includes(key)) {
                    const definition = objects[key];
                    const obj: CreatedObject = {
                        _id: null,
                        type: null,
                        common: {},
                        native: {},
                    };

                    // Process object id
                    if (Object.prototype.hasOwnProperty.call(definition, '_id')) {
                        obj._id = definition._id ?? null;
                    } else {
                        obj._id = applyRule(definition.logic._id!, data) as string | null;
                    }

                    // Only null skips the object. The check was `_id.slice(-1) !== -1` before, which is always true.
                    if (typeof obj._id === 'string') {
                        if (objectTree !== '') {
                            obj._id = `${objectTree}.${obj._id}`;
                        }

                        // Process type
                        if (Object.prototype.hasOwnProperty.call(definition, 'type')) {
                            obj.type = definition.type ?? null;
                        } else {
                            obj.type = applyRule(definition.logic.type!, data) as ioBroker.ObjectType;
                        }

                        // Process common
                        if (definition.common) {
                            obj.common = JSON.parse(JSON.stringify(definition.common)) as Record<string, unknown>;
                        }

                        if (definition.logic.common) {
                            const common = definition.logic.common;

                            for (const commonKey in common) {
                                obj.common[commonKey] = applyRule(common[commonKey], data);
                            }
                        }

                        // Process native
                        if (definition.native) {
                            obj.native = JSON.parse(JSON.stringify(definition.native)) as Record<string, unknown>;
                        }

                        if (definition.logic.native) {
                            const native = definition.logic.native;

                            for (const nativeKey in native) {
                                obj.native[nativeKey] = applyRule(native[nativeKey], data);
                            }
                        }

                        // Cleanup _id
                        obj._id = obj._id.replace(FORBIDDEN_CHARS, '_').toLowerCase();
                        const objId = obj._id;

                        // Update object if changed
                        const ownObj = this.ownObjects[objId];
                        if (!ownObj || JSON.stringify(ownObj) !== JSON.stringify(obj)) {
                            await this.extendObjectAsync(objId, {
                                type: obj.type,
                                common: JSON.parse(JSON.stringify(obj.common)),
                                native: JSON.parse(JSON.stringify(obj.native)),
                            } as ioBroker.PartialObject);

                            this.ownObjects[objId] = JSON.parse(JSON.stringify(obj)) as CreatedObject;
                        }

                        // Process value
                        if (Object.prototype.hasOwnProperty.call(definition, 'value')) {
                            obj.value = definition.value;
                        } else if (definition.logic.value !== undefined) {
                            obj.value = applyRule(definition.logic.value, data);
                        }

                        // Values of other types are converted with toString(), as before
                        if (obj.common && obj.value !== undefined && obj.value !== null) {
                            if (obj.common.type === 'number' && typeof obj.value !== 'number') {
                                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                                const val = parseFloat(String(obj.value));
                                if (!isNaN(val)) {
                                    obj.value = val;
                                }
                            } else if (obj.common.type === 'boolean' && typeof obj.value !== 'boolean') {
                                if (obj.value === 'true' || obj.value === 'false') {
                                    obj.value = obj.value === 'true';
                                } else {
                                    obj.value = !!obj.value;
                                }
                            } else if (obj.common.type === 'string' && typeof obj.value !== 'string') {
                                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                                obj.value = String(obj.value);
                            }
                        }
                        // Update state if value changed
                        if (Object.prototype.hasOwnProperty.call(obj, 'value')) {
                            const oldState = await this.getStateAsync(objId);

                            if (!oldState || oldState.val !== obj.value) {
                                if (obj.value && typeof obj.value === 'object') {
                                    await this.setStateAsync(objId, { ack: true, val: JSON.stringify(obj.value) });
                                } else {
                                    await this.setStateAsync(objId, {
                                        ack: true,
                                        val: obj.value as ioBroker.StateValue,
                                    });
                                }
                            }
                        }

                        // Process has
                        const has = definition.logic.has;
                        const hasKey = definition.logic.has_key;
                        if (has && hasKey !== undefined) {
                            if (hasKey === '_self' || Object.prototype.hasOwnProperty.call(data, hasKey)) {
                                const tempData = hasKey === '_self' ? data : (data as Record<string, unknown>)[hasKey];

                                if (Array.isArray(tempData) && tempData.length > 0) {
                                    for (const element of tempData) {
                                        await this.applyJsonLogic(objId, element, has, statesFilter);
                                    }
                                } else {
                                    await this.applyJsonLogic(objId, tempData, has, statesFilter);
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            this.handleError(err, undefined, 'applyJsonLogic');
        }
    }

    /**
     * IDs of all states and channels of admin/lib/objects_<libName>.json, children first
     *
     * @param libName e.g. 'alarms'
     */
    private getUnifiObjectsLibIds(libName: string): string[] {
        const idList: string[] = [];
        this.extractsIds(loadObjectDefinitions(libName), idList, libName);

        return idList.reverse();
    }

    /**
     * @param obj definitions
     * @param idList list to add the IDs to
     * @param libName name of the root, which is not added
     */
    private extractsIds(obj: ObjectDefinitions, idList: string[], libName: string): void {
        for (const [id, value] of Object.entries(obj)) {
            if (value.type === 'state') {
                idList.push(id);
            } else if (value.type === 'channel' || value.type === 'device') {
                if (id !== libName) {
                    // ignore root id
                    idList.push(id);
                }
                this.extractsIds(value.logic.has || {}, idList, libName);
            }
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Unifi(options);
} else {
    // otherwise start the instance directly
    (() => new Unifi())();
}
