'use strict';

/*
 * Created with @iobroker/create-adapter v1.17.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here
const UnifiClass = require('node-unifi');
const jsonLogic = require('./admin/lib/json_logic.js');

class Unifi extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'unifi',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));

        this.controllers = {};
        this.objectsFilter = {};
        this.settings = {};
        this.update = {};
        this.clients = {};
        this.vouchers = {};
        this.dpi = {};
        this.statesFilter = {};
        this.queryTimeout = null;

        this.ownObjects = {};

        this.stopped = false;
    }

    /**
     * Is called when adapter received configuration.
     */
    async onReady() {
        try {
            // subscribe to all state changes
            this.subscribeStates('*.wlans.*.enabled');
            this.subscribeStates('*.vouchers.create_vouchers');
            this.subscribeStates('trigger_update');
            this.subscribeStates('*.port_table.port_*.port_poe_enabled');
            this.subscribeStates('*.port_table.port_*.port_poe_cycle');
            this.subscribeStates('*.clients.*.reconnect');
            this.subscribeStates('*.clients.*.blocked');
            this.subscribeStates('*.devices.*.led_override');
            this.subscribeStates('*.devices.*.restart');

            this.log.info('UniFi adapter is ready');

            // Load configuration
            this.settings.updateInterval = (parseInt(this.config.updateInterval, 10) * 1000) || (60 * 1000);
            this.settings.controllerIp = this.config.controllerIp;
            this.settings.controllerPort = this.config.controllerPort;
            this.settings.controllerUsername = this.config.controllerUsername;
            this.settings.controllerPassword = this.config.controllerPassword;
            this.settings.ignoreSSLErrors = this.config.ignoreSSLErrors !== undefined ? this.config.ignoreSSLErrors : true;

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
            this.update.gatewayTrafficMaxDays = this.config.gatewayTrafficMaxDays;

            // @ts-ignore
            this.objectsFilter = this.config.blacklist || this.config.objectsFilter; // blacklist was renamed to objectsFilter in v0.5.3
            // @ts-ignore
            this.statesFilter = this.config.whitelist || this.config.statesFilter; // blacklist was renamed to statesFilter in v0.5.3

            // @ts-ignore
            this.clients.isOnlineOffset = (parseInt(this.config.clientsIsOnlineOffset, 10) * 1000) || (60 * 1000);

            this.vouchers.number = this.config.createVouchersNumber;
            this.vouchers.duration = this.config.createVouchersDuration;
            this.vouchers.quota = this.config.createVouchersQuota;
            this.vouchers.uploadLimit = !this.config.createVouchersUploadLimit ? null : this.config.createVouchersUploadLimit;
            this.vouchers.downloadLimit = !this.config.createVouchersDownloadLimit ? null : this.config.createVouchersDownloadLimit;
            this.vouchers.byteQuota = !this.config.createVouchersByteQuota ? null : this.config.createVouchersByteQuota;
            this.vouchers.note = this.config.createVouchersNote;

            if (this.settings.controllerIp !== '' && this.settings.controllerUsername !== '' && this.settings.controllerPassword !== '') {
                // Send some log messages
                this.log.debug(`controller = ${this.settings.controllerIp}:${this.settings.controllerPort}`);
                this.log.debug(`updateInterval = ${this.settings.updateInterval / 1000}`);

                // Start main function
                this.updateUnifiData();
            } else {
                this.log.error('Adapter deactivated due to missing configuration.');

                await this.setStateAsync('info.connection', { ack: true, val: false });
                this.setForeignState(`system.adapter.${this.namespace}.alive`, false);
            }
        } catch (err) {
            this.handleError(err, undefined, 'onReady');
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
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
                    const portNumber = idParts[6].split('_').pop();
                    this.switchPoeOfPort(site, mac, portNumber, state.val);
                } else if (idParts[7] === 'port_poe_cycle') {
                    const portNumber = idParts[6].split('_').pop();
                    const mac = idParts[4];

                    this.log.info(`onStateChange: port power cycle (port: ${portNumber}, device: ${mac})`);

                    await this.controllers[site].powerCycleSwitchPort(mac, portNumber);
                } else if (idParts[5] === 'reconnect') {
                    await this.reconnectClient(id, idParts, site);
                } else if (idParts[5] === 'blocked') {
                    await this.blockClient(id, site, idParts, state.val);
                } else if (idParts[5] === 'led_override') {
                    const deviceId = await this.getStateAsync(id.substring(0, id.lastIndexOf('.')) + '.device_id');

                    this.log.info(`onStateChange: override led to '${state.val}' (device: ${deviceId.val})`);

                    await this.controllers[site].setLEDOverride(deviceId.val, state.val);
                } else if (idParts[5] === 'restart') {
                    const mac = idParts[4];

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
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.stopped = true;
            if (this.queryTimeout) {
                clearTimeout(this.queryTimeout);
            }

            this.log.info('cleaned everything up...');
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Function to handle error messages
     * @param {Object} err
     * @param {String} site
     * @param {String | undefined} methodName
     */
    async handleError(err, site, methodName = undefined) {
        if (err.message === 'api.err.Invalid') {
            this.log.error(`Error site ${site}: Incorrect username or password.`);
        } else if (err.message === 'api.err.LoginRequired') {
            this.log.error(`Error site ${site}: Login required. Check username and password.`);
        } else if (err.message === 'api.err.Ubic2faTokenRequired') {
            this.log.error(`Error site ${site}: 2-Factor-Authentication required by UniFi controller. 2FA is not supported by this adapter.`);
        } else if (err.message === 'api.err.ServerBusy') {
            this.log.error(`Error site ${site}: Server is busy. There seems to be a problem with the UniFi controller.`);
        } else if (err.message === 'api.err.NoPermission' || (err.response && err.response.data && err.response.data.meta && err.response.data.meta.msg && err.response.data.meta.msg === 'api.err.NoPermission')) {
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
            this.log.error(`Error site ${site}: This error is not related to the adapter. There seems to be a DNS issue. Please google for "getaddrinfo EAI_AGAIN" to fix the issue.`);
        } else if (err.message.includes('getaddrinfo ENOTFOUND')) {
            this.log.error(`Error site ${site}: Host not found. Incorrect IP or port.`);
        } else if (err.message.includes('socket hang up')) {
            this.log.error(`Error site ${site}: Socket hang up: ${err.message}`);
        } else if (err.message.includes('socket disconnected')) {
            this.log.error(`Error site ${site}: Socket disconnected: ${err.message}`);
        } else if (err.message.includes('SSL routines') || err.message.includes('ssl3_') || err.message.includes('certificate has expired')) {
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

            if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
                const sentryInstance = this.getPluginInstance('sentry');
                if (sentryInstance) {
                    sentryInstance.getSentryObject().captureException(err);
                }
            }
        }
    }

    /**
     * Function that takes care of the API calls and processes
     * the responses afterwards
     */
    async updateUnifiData(preventReschedule = false) {
        try {
            this.log.debug('Update started');

            const defaultController = new UnifiClass.Controller({
                host: this.settings.controllerIp,
                port: this.settings.controllerPort,
                username: this.settings.controllerUsername,
                password: this.settings.controllerPassword,
                sslverify: !this.settings.ignoreSSLErrors,
                timeout: 30000
            });

            try {
                await defaultController.login();
            } catch (err) {
                this.handleError(err, undefined, 'updateUnifiData-login');

                // In case of connection timeout, try again later
                if (err.code === 'ECONNABORTED') {
                    this.queryTimeout = setTimeout(() => {
                        this.updateUnifiData();
                    }, this.settings.updateInterval);
                }

                return;
            }
            this.log.debug('Login successful');

            try {
                const sites = await this.fetchSites(defaultController);

                for (const site of sites) {
                    if (this.stopped) {
                        return;
                    }
                    try {
                        if (!this.controllers[site]) {
                            if (site === 'default') {
                                this.controllers[site] = defaultController;

                                /*
                                try {
                                    defaultController.onAny((event, data) => {
                                        this.log.debug(`EVENT [${site}] ${event} : ${JSON.stringify(data)}`);
                                    });

                                    await defaultController.listen();
                                } catch (err) {
                                    this.handleError(err, site, 'subscribe Events');
                                }*/
                            } else {
                                this.controllers[site] = new UnifiClass.Controller({
                                    host: this.settings.controllerIp,
                                    port: this.settings.controllerPort,
                                    username: this.settings.controllerUsername,
                                    password: this.settings.controllerPassword,
                                    site,
                                    sslverify: !this.settings.ignoreSSLErrors
                                });
                                await this.controllers[site].login();
                            }
                        }

                        this.log.debug(`Update site: ${site}`);

                        if (this.update.sysinfo === true) {
                            await this.fetchSiteSysinfo(site);
                        }

                        if (this.update.clients === true) {
                            await this.fetchClients(site);
                        }

                        if (this.update.devices === true) {
                            await this.fetchDevices(site);
                        }

                        if (this.update.wlans === true) {
                            await this.fetchWlans(site);
                        }

                        if (this.update.networks === true) {
                            await this.fetchNetworks(site);
                        }

                        if (this.update.health === true) {
                            await this.fetchHealth(site);
                        }

                        if (this.update.vouchers === true) {
                            await this.fetchVouchers(site);
                        }

                        if (this.update.dpi === true) {
                            await this.fetchDpi(site);
                        }

                        if (this.update.gatewayTraffic === true) {
                            await this.fetchGatewayTraffic(site);
                        }

                        if (this.update.alarms === true) {
                            await this.fetchAlarms(site);
                        }

                        // finalize, logout and finish
                        //await this.controllers[site].logout();
                    } catch (err) {
                        this.handleError(err, site, 'updateUnifiData');
                    }
                }

                // Update is_online of offline clients
                await this.setClientOnlineStatus();

            } catch (err) {
                this.handleError(err, undefined, 'updateUnifiData-fetchSites');
                return;
            }
            await this.setStateAsync('info.connection', { ack: true, val: true });
            this.log.debug('Update done');
        } catch (err) {
            await this.setStateAsync('info.connection', { ack: true, val: false });

            this.handleError(err, undefined, 'updateUnifiData');
        }

        if (preventReschedule === false) {
            // schedule a new execution of updateUnifiData in X seconds
            this.queryTimeout = setTimeout(() => {
                this.updateUnifiData();
            }, this.settings.updateInterval);
        }
    }

    /**
     * Function to fetch site{Object} siteController
     *
     * @param {UnifiClass} siteController
     */
    async fetchSites(siteController) {
        const data = await siteController.getSites();
        if (data === undefined) {
            throw new Error(`fetchSites: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        const sites = data.map((s) => {
            return s.name;
        });
        this.log.debug(`fetchSites: ${sites}`);

        await this.processSites(sites, data);

        return sites;
    }

    /**
     * Function that receives the sites as a JSON data array
     * @param {String[]} sites
     * @param {Object[]} data
     */
    async processSites(sites, data) {
        const objects = require('./admin/lib/objects_sites.json');

        for (const site of sites) {
            const x = sites.indexOf(site);
            const siteData = data[x];

            this.log.silly(`processSites: site: ${site}, data: ${JSON.stringify(data[x])}`);

            await this.applyJsonLogic('', siteData, objects, ['site']);
        }
    }

    /**
     * Function to fetch site sysinfo
     * @param {String} site
     */
    async fetchSiteSysinfo(site) {
        const data = await this.controllers[site].getSiteSysinfo();
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
     * @param {String} site
     * @param {Object} data
     */
    async processSiteSysinfo(site, data) {
        const objects = require('./admin/lib/objects_sysinfo.json');

        await this.applyJsonLogic(site, data, objects, this.statesFilter.sysinfo);
    }

    /**
     * Function to fetch clients
     * @param {String} site
     */
    async fetchClients(site) {
        const data = await this.controllers[site].getClientDevices();
        if (!Array.isArray(data)) {
            throw new Error(`fetchClients ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchClients ${site}: ${data.length}`);
        this.log.silly(`fetchClients ${site}: ${JSON.stringify(data)}`);

        await this.processClients(site, data);
        await this.processBlockedClients(site);

        return data;
    }

    /**
     * Function that receives the clients as a JSON data array
     * @param {String} site
     * @param {Object} data
     */
    async processClients(site, data) {
        const objects = require('./admin/lib/objects_clients.json');

        if(this.update.blacklist === true){
            if (data) {
            // Process objectsFilter
                const siteData = data.filter((item) => {
                    if (this.objectsFilter.clients.includes(item.mac) == true ||
                        this.objectsFilter.clients.includes(item.ip) == true ||
                        this.objectsFilter.clients.includes(item.name) == true ||
                        this.objectsFilter.clients.includes(item.hostname) == true) {
                        return item;
                    }
                });

                if (siteData.length > 0) {
                    await this.applyJsonLogic(site, siteData, objects, this.statesFilter.clients);
                }
            }
        }
        if(this.update.blacklist === false){
            if (data) {
                // Process objectsFilter
                const siteData = data.filter((item) => {
                    if (this.objectsFilter.clients.includes(item.mac) !== true &&
                        this.objectsFilter.clients.includes(item.ip) !== true &&
                        this.objectsFilter.clients.includes(item.name) !== true &&
                        this.objectsFilter.clients.includes(item.hostname) !== true) {
                        return item;
                    }
                });
            
                this.log.silly(`processClients: filtered data: ${JSON.stringify(siteData)}`);

                if (siteData.length > 0) {
                    await this.applyJsonLogic(site, siteData, objects, this.statesFilter.clients);
                }
            }
        }
    }
    
    /**
     * Function to identify blocked clients and set the correct state
     * @param {Object} site
     */
    async processBlockedClients(site) {
        if (this.statesFilter.clients.includes('clients.client.blocked')) {
            const blockedClients = await this.controllers[site].getBlockedUsers();

            const allClients = await this.getStatesAsync(`*.clients.*.blocked`);
            // this.log.warn(JSON.stringify(blockedClients));

            for (const id in allClients) {
                if (blockedClients && blockedClients.length > 0) {
                    const clientMac = id.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/)[0];
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
    async setClientOnlineStatus() {
        const wlanStates = await this.getStatesAsync('*.clients.*.last_seen_by_uap');
        const wiredStates = await this.getStatesAsync('*.clients.*.last_seen_by_usw');

        // Workaround for UniFi bug "wireless clients shown as wired clients"
        // https://community.ui.com/questions/Wireless-clients-shown-as-wired-clients/49d49818-4dab-473a-ba7f-d51bc4c067d1
        for (const [key, value] of Object.entries(wlanStates)) {
            const wiredStateId = key.replace('last_seen_by_uap', 'last_seen_by_usw');

            if (Object.prototype.hasOwnProperty.call(wiredStates, wiredStateId)) {
                delete wiredStates[wiredStateId];
            }
        }

        const states = {
            ...wlanStates,
            ...wiredStates
        };

        const now = Math.floor(Date.now() / 1000) * 1000;

        for (const [key, value] of Object.entries(states)) {
            if (value !== null && typeof value.val === 'string') {
                const lastSeen = Date.parse(value.val.replace(' ', 'T'));
                const isOnline = (lastSeen - (now - this.settings.updateInterval - this.clients.isOnlineOffset) >= 0);
                const stateId = key.replace(/last_seen_by_(usw|uap)/gi, 'is_online');
                const oldState = await this.getStateAsync(stateId);

                if (oldState === null) {
                    // This is the case if the client is new to the adapter with older JS-Controller versions
                    // Check if object is available and set the value
                    const oldObject = await this.getForeignObjectAsync(stateId);

                    if (oldObject !== null) {
                        await this.setForeignStateAsync(stateId, { ack: true, val: isOnline });
                    }
                } else if (oldState.val != isOnline) {
                    await this.setForeignStateAsync(stateId, { ack: true, val: isOnline });
                }
            }
        }
    }

    /**
     * Function to fetch devices
     * @param {String} site
     */
    async fetchDevices(site) {
        const data = await this.controllers[site].getAccessDevices();
        if (!Array.isArray(data)) {
            throw new Error(`fetchDevices ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchDevices ${site}: ${data.length}`);
        this.log.silly(`fetchDevices ${site}: ${JSON.stringify(data)}`);

        await this.processDevices(site, data);

        return data;
    }

    /**
     * Function that receives the devices as a JSON data array
     * @param {String} site
     * @param {Object} data
     */
    async processDevices(site, data) {
        const objects = require('./admin/lib/objects_devices.json');

        if (data) {
            // Process objectsFilter
            const siteData = data.filter((item) => {
                if (this.objectsFilter.devices.includes(item.mac) !== true &&
                    this.objectsFilter.devices.includes(item.ip) !== true &&
                    this.objectsFilter.devices.includes(item.name) !== true) {
                    return item;
                }
            });

            this.log.silly(`processDevices: filtered data: ${JSON.stringify(siteData)}`);

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.devices);
            }
        }
    }

    /**
     * Function to fetch WLANs
     * @param {String} site
     */
    async fetchWlans(site) {
        const data = await this.controllers[site].getWLanSettings();
        if (!Array.isArray(data)) {
            throw new Error(`fetchWlans ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchWlans ${site}: ${data.length}`);
        this.log.silly(`fetchWlans ${site}: ${JSON.stringify(data)}`);

        await this.processWlans(site, data);

        return data;
    }

    /**
     * Function that receives the WLANs as a JSON data array
     * @param {String} site
     * @param {Object} data
     */
    async processWlans(site, data) {
        const objects = require('./admin/lib/objects_wlans.json');

        if (data) {
            // Process objectsFilter
            const siteData = data.filter((item) => {
                if (this.objectsFilter.wlans.includes(item.name) !== true) {
                    return item;
                }
            });

            this.log.silly(`processWlans: filtered data: ${JSON.stringify(siteData)}`);

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.wlans);
            }
        }
    }

    /**
     * Function to fetch networks
     * @param {String} site
     */
    async fetchNetworks(site) {
        const data = await this.controllers[site].getNetworkConf();
        if (!Array.isArray(data)) {
            throw new Error(`fetchNetworks ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchNetworks ${site}: ${data.length}`);
        this.log.silly(`fetchNetworks ${site}: ${JSON.stringify(data)}`);

        await this.processNetworks(site, data);

        return data;
    }

    /**
     * Function that receives the networks as a JSON data array
     * @param {String} site
     * @param {Object} data
     */
    async processNetworks(site, data) {
        const objects = require('./admin/lib/objects_networks.json');

        if (data) {
            // Process objectsFilter
            const siteData = data.filter((item) => {
                if (this.objectsFilter.networks.includes(item.name) !== true) {
                    return item;
                }
            });

            this.log.silly(`processNetworks: filtered data: ${JSON.stringify(siteData)}`);

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.networks);
            }
        }
    }

    /**
     * Function to fetch health
     * @param {String} site
     */
    async fetchHealth(site) {
        const data = await this.controllers[site].getHealth();
        if (!Array.isArray(data)) {
            throw new Error(`fetchHealth ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchHealth ${site}: ${data.length}`);
        this.log.silly(`fetchHealth ${site}: ${JSON.stringify(data)}`);

        await this.processHealth(site, data);

        return data;
    }

    /**
     * Function that receives the health as a JSON data array
     * @param {String} site
     * @param {Object} data
     */
    async processHealth(site, data) {
        const objects = require('./admin/lib/objects_health.json');

        if (data) {
            // Process objectsFilter
            const siteData = data.filter((item) => {
                if (this.objectsFilter.health.includes(item.subsystem) !== true) {
                    return item;
                }
            });

            this.log.silly(`processHealth: filtered data: ${JSON.stringify(siteData)}`);

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.health);
            }
        }
    }

    /**
     * Function to fetch vouchers
     * @param {String} site
     */
    async fetchVouchers(site) {
        const data = await this.controllers[site].getVouchers();
        if (!Array.isArray(data)) {
            throw new Error(`fetchVouchers ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchVouchers ${site}: ${data.length}`);
        this.log.silly(`fetchVouchers ${site}: ${JSON.stringify(data)}`);

        await this.processVouchers(site, data);

        return data;
    }

    /**
     * Function that receives the vouchers as a JSON data array
     * @param {String} site
     * @param {Object} data
     */
    async processVouchers(site, data) {
        const objects = require('./admin/lib/objects_vouchers.json');

        if (data) {
            let siteData = data;

            if (this.update.vouchersNoUsed) {
                // Remove used vouchers
                siteData = siteData.filter((item) => {
                    if (item.used === 0) {
                        return item;
                    }
                });

                this.log.silly(`processVouchers: filtered data: ${JSON.stringify(siteData)}`);

                const existingVouchers = await this.getForeignObjectsAsync(`${this.namespace}.${site}.vouchers.voucher_*`, 'channel');

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

                            if (this.ownObjects[id.replace(`${this.namespace}.`, '')]) {
                                // remove from own objects if exist
                                await delete this.ownObjects[id.replace(`${this.namespace}.`, '')];
                            }
                        }

                        // delete voucher channel
                        await this.delObjectAsync(`${voucherChannelId}`);
                        if (this.ownObjects[voucherChannelId.replace(`${this.namespace}.`, '')]) {
                            // remove from own objects if exist
                            await delete this.ownObjects[voucherChannelId.replace(`${this.namespace}.`, '')];
                        }
                    }
                }
            }

            await this.applyJsonLogic(site, siteData, objects, this.statesFilter.vouchers);
        }
    }

    /**
     * Function to fetch dpi
     * @param {String} site
     */
    async fetchDpi(site) {
        const data = await this.controllers[site].getDPIStats(site);
        if (!Array.isArray(data)) {
            throw new Error(`fetchDpi ${site}: Returned data is not in valid format. This option is only available for gateways!: ${JSON.stringify(data)}`);
        }
        if (data[0] && data[0].by_cat && data[0].by_app) {
            this.log.debug(`fetchDpi ${site}: categories: ${data[0].by_cat.length}, apps: ${data[0].by_app.length}`);
        }

        this.log.silly(`fetchDpi ${site}: ${JSON.stringify(data)}`);

        await this.processDpi(site, data);

        return data;
    }

    /**
     * Function that receives the dpi as a JSON data array
     * @param {String} site
     * @param {Object} data
     */
    async processDpi(site, data) {
        const objects = require('./admin/lib/objects_dpi.json');

        if (data) {
            // Process objectsFilter
            const siteData = data.filter((item) => {
                // if (this.objectsFilter.dpi.includes(item.subsystem) !== true) {
                //     return item;
                // }
                return item;
            });

            this.log.silly(`processDpi: filtered data: ${JSON.stringify(siteData)}`);

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.dpi);
            }
        }
    }

    /**
     * Function to fetch daily gateway traffic
     * @param {String} site
     */
    async fetchGatewayTraffic(site) {
        let start = undefined;
        let end = undefined;
        if (this.update.gatewayTrafficMaxDays > 0) {
            const now = new Date();
            end = now.getTime();

            now.setDate(now.getDate() - this.update.gatewayTrafficMaxDays);
            start = now.getTime();

            this.log.silly(`fetchGatewayTraffic: start: ${new Date(start).toLocaleDateString()}, end: ${new Date(end).toLocaleDateString()}`);
        }

        const data = await this.controllers[site].getDailyGatewayStats(start, end, ['lan-rx_bytes', 'lan-tx_bytes']);
        if (!Array.isArray(data)) {
            throw new Error(`fetchGatewayTraffic ${site}: Returned data is not in valid format. This option is only available for gateways!: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchGatewayTraffic ${site}: ${data.length}`);
        this.log.silly(`fetchGatewayTraffic ${site}: ${JSON.stringify(data)}`);

        await this.processGatewayTraffic(site, data);

        return data;
    }

    /**
     * Function that receives the daily gateway traffic as a JSON data array
     * @param {String} site
     * @param {Object} data
     */
    async processGatewayTraffic(site, data) {
        const objects = require('./admin/lib/objects_gateway_traffic.json');

        if (data) {
            // Process objectsFilter
            const siteData = data.filter((item) => {
                // if (this.objectsFilter.dpi.includes(item.subsystem) !== true) {
                //     return item;
                // }
                return item;
            });

            this.log.silly(`processGatewayTraffic: filtered data: ${JSON.stringify(siteData)}`);

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.gateway_traffic);
            }
        }
    }

    /**
     * Function to fetch alarms
     * @param {String} site
     */
    async fetchAlarms(site) {
        const data = await this.controllers[site].getAlarms();
        if (!Array.isArray(data)) {
            throw new Error(`fetchAlarms ${site}: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`fetchAlarms ${site}: ${data.length}`);
        this.log.silly(`fetchAlarms ${site}: ${JSON.stringify(data)}`);

        await this.processAlarms(site, data);

        return data;
    }

    /**
     * Function that receives the alarms as a JSON data array
     * @param {String} site
     * @param {Object} data
     */
    async processAlarms(site, data) {
        const objects = require('./admin/lib/objects_alarms.json');

        if (data) {
            // Process objectsFilter
            const siteData = data.filter((item) => {
                // if (this.objectsFilter.dpi.includes(item.subsystem) !== true) {
                //     return item;
                // }
                return item;
            });

            this.log.silly(`processAlarms: filtered data: ${JSON.stringify(siteData)}`);

            if (this.update.alarmsNoArchived) {
                const existingAlarms = await this.getForeignObjectsAsync(`${this.namespace}.${site}.alarms.alarm_*`, 'channel');
                const alarmDatapoints = await this.getUnifiObjectsLibIds('alarms');

                for (const alarm in existingAlarms) {
                    const alarmId = alarm.replace(`${this.namespace}.${site}.alarms.alarm_`, '');

                    if (!siteData.find(item => item._id === alarmId)) {
                        this.log.debug(`deleting data points of alarm with id '${alarmId}'`);

                        for (const dp of alarmDatapoints) {
                            const dpId = `${site}.${dp.replace('.alarm', `.alarm_${alarmId}`)}`;

                            if (await this.getObjectAsync(dpId)) {
                                await this.delObjectAsync(dpId);
                            }

                            if (this.ownObjects[dpId]) {
                                // remove from own objects if exist
                                await delete this.ownObjects[dpId];
                            }
                        }
                    }
                }
            }

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.alarms);
            }
        }
    }

    /**
     * Disable or enable a WLAN
     * @param {*} site
     * @param {*} objId
     * @param {*} state
     */
    async updateWlanStatus(site, objId, state) {
        try {
            //await this.controllers[site].login(this.settings.controllerUsername, this.settings.controllerPassword);
            //this.log.debug('Login successful');

            await this.setWlanStatus(site, objId, state);

            // finalize, logout and finish
            //await this.controllers[site].logout();

            this.log.info(`WLAN status set to ${state.val}`);

            return true;
        } catch (err) {
            this.handleError(err, site, 'updateWlanStatus');
        }
    }

    /**
     * Function to fetch vouchers
     * @param {String} site
     * @param {Object} objId
     * @param {Object} state
     */
    async setWlanStatus(site, objId, state) {
        const obj = await this.getForeignObjectAsync(objId);

        if (!obj || !obj.native) {
            throw new Error(`setWlanStatus: Object ${objId} invalid, please restart adapter!`);
        }

        const wlanId = obj.native.wlan_id;
        const disable = !state.val;

        const data = await this.controllers[site].disableWLan(wlanId, disable);
        if (!Array.isArray(data)) {
            throw new Error(`setWlanStatus: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`setWlanStatus: ${data.length}`);

        await this.processWlans(site, data);

        return data;
    }

    /**
     * Create vouchers
     * @param {String} site
     */
    async createUnifiVouchers(site) {
        try {
            //await this.controllers[site].login(this.settings.controllerUsername, this.settings.controllerPassword);
            //this.log.debug('Login successful');

            await this.createVouchers(site);
            await this.fetchVouchers(site);

            // finalize, logout and finish
            //await this.controllers[site].logout();

            this.log.info('Vouchers created');

            return true;
        } catch (err) {
            this.handleError(err, site, 'createUnifiVouchers');
            return false;
        }
    }

    /**
     * Function to create vouchers
     * @param {String} site
     */
    async createVouchers(site) {
        const minutes = this.vouchers.duration || 60;
        const count = this.vouchers.number || 1;
        const quota = this.vouchers.quota || 1;
        const note = this.vouchers.note || '';
        const up = this.vouchers.uploadLimit || 0;
        const down = this.vouchers.downloadLimit || 0;
        const mbytes = this.vouchers.byteQuota || 0;

        const data = await this.controllers[site].createVouchers(site, minutes, count, quota, note, up, down, mbytes);
        if (!Array.isArray(data)) {
            throw new Error(`createVouchers: Returned data is not in valid format: ${JSON.stringify(data)}`);
        }
        this.log.debug(`createVouchers: ${data.length}`);

        await this.processWlans(site, data);

        return data;
    }

    /**
     * Function to switch poe power for port of device
     * @param {String} site
     * @param {String} deviceMac
     * @param {String} port
     * @param {Boolean} val
     */
    async switchPoeOfPort(site, deviceMac, port, val) {
        try {
            this.log.info(`switchPoeOfPort: switching poe power of port ${port} for device ${deviceMac} to ${val}`);

            // we have to get whole data of 'port_overrides' to change poe power of single port.
            // we must sent the 'port_overrides' for all ports, otherwise the other port will set to default settings

            const result = await this.fetchDevices(site);

            const dataDevice = result.filter(x => x.mac === deviceMac);

            if (dataDevice && dataDevice.length) {
                const deviceId = dataDevice[0].device_id;

                // eslint-disable-next-line prefer-const
                let port_overrides = dataDevice[0].port_overrides;

                if (port_overrides && port_overrides.length > 0) {
                    const indexOfPort = port_overrides.findIndex(x => x.port_idx === parseInt(port));

                    if (indexOfPort !== -1) {
                        // port_overrides has settings for this port
                        port_overrides[indexOfPort].poe_mode = val ? 'auto' : 'off';
                    } else {
                        // port_overrides has no settings for this port
                        this.log.debug(`switchPoeOfPort: port ${port} not exists in port_overrides object -> create item`);
                        port_overrides[indexOfPort].poe_mode = val ? 'auto' : 'off';
                    }

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
     * @param {String} id
     * @param {Array<String>} idParts
     * @param {String} site
     */
    async reconnectClient(id, idParts, site) {
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
     * Funtion to block / unblock client
     * @param {String} id
     * @param {String} site
     * @param {Array<String>} idParts
     * @param {Boolean} block
     */
    async blockClient(id, site, idParts, block) {
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
     * @param {*} objectTree
     * @param {*} data
     * @param {*} objects
     * @param {*} statesFilter
     */
    async applyJsonLogic(objectTree, data, objects, statesFilter) {
        try {
            for (const key in objects) {
                if (this.stopped) {
                    return;
                }
                if (statesFilter === undefined || statesFilter.length === 0 || statesFilter.includes(key)) {
                    const obj = {
                        '_id': null,
                        'type': null,
                        'common': {},
                        'native': {}
                    };

                    // Process object id
                    if (Object.prototype.hasOwnProperty.call(objects[key], '_id')) {
                        obj._id = objects[key]._id;
                    } else {
                        obj._id = await this.applyRule(objects[key].logic._id, data);
                    }

                    if (obj._id !== null && obj._id.slice(-1) !== -1) {
                        if (objectTree !== '') {
                            obj._id = `${objectTree}.${obj._id}`;
                        }

                        // Process type
                        if (Object.prototype.hasOwnProperty.call(objects[key], 'type')) {
                            obj.type = objects[key].type;
                        } else {
                            obj.type = await this.applyRule(objects[key].logic.type, data);
                        }

                        // Process common
                        if (Object.prototype.hasOwnProperty.call(objects[key], 'common')) {
                            obj.common = JSON.parse(JSON.stringify(objects[key].common));
                        }

                        if (Object.prototype.hasOwnProperty.call(objects[key].logic, 'common')) {
                            const common = objects[key].logic.common;

                            for (const commonKey in common) {
                                obj.common[commonKey] = await this.applyRule(common[commonKey], data);
                            }
                        }

                        // Process native
                        if (Object.prototype.hasOwnProperty.call(objects[key], 'native')) {
                            obj.native = JSON.parse(JSON.stringify(objects[key].native));
                        }

                        if (Object.prototype.hasOwnProperty.call(objects[key].logic, 'native')) {
                            const native = objects[key].logic.native;

                            for (const nativeKey in native) {
                                obj.native[nativeKey] = await this.applyRule(native[nativeKey], data);
                            }
                        }

                        // Cleanup _id
                        const FORBIDDEN_CHARS = /[\]\[*,;'"`<>\\?\s]/g;
                        let tempId = obj._id.replace(FORBIDDEN_CHARS, '_');
                        tempId = tempId.toLowerCase();
                        obj._id = tempId;

                        //this.log.debug(JSON.stringify(obj));

                        // Update object if changed
                        if (!Object.prototype.hasOwnProperty.call(this.ownObjects, obj._id)) {
                            await this.extendObjectAsync(obj._id, {
                                type: obj.type,
                                common: JSON.parse(JSON.stringify(obj.common)),
                                native: JSON.parse(JSON.stringify(obj.native))
                            });

                            this.ownObjects[obj._id] = JSON.parse(JSON.stringify(obj));

                            //this.log.debug('Object ' + obj._id + ' updated');
                        } else {
                            const ownObj = this.ownObjects[obj._id];

                            if (JSON.stringify(ownObj) !== JSON.stringify(obj)) {
                                await this.extendObjectAsync(obj._id, {
                                    type: obj.type,
                                    common: JSON.parse(JSON.stringify(obj.common)),
                                    native: JSON.parse(JSON.stringify(obj.native))
                                });

                                this.ownObjects[obj._id] = JSON.parse(JSON.stringify(obj));

                                //this.log.debug('Object ' + obj._id + ' updated');
                            }
                        }

                        // Process value
                        if (Object.prototype.hasOwnProperty.call(objects[key], 'value')) {
                            obj.value = objects[key].value;
                        } else {
                            if (Object.prototype.hasOwnProperty.call(objects[key].logic, 'value')) {
                                obj.value = await this.applyRule(objects[key].logic.value, data);
                            }
                        }

                        if (obj.common && obj.value !== undefined && obj.value !== null) {
                            if (obj.common.type === 'number' && typeof obj.value !== 'number') {
                                const val = parseFloat(obj.value);
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
                                obj.value = obj.value.toString();
                            }
                        }
                        // Update state if value changed
                        if (Object.prototype.hasOwnProperty.call(obj, 'value')) {
                            const oldState = await this.getStateAsync(obj._id);

                            if (oldState === null || oldState.val !== obj.value) {
                                if (obj.value && typeof obj.value === 'object') {
                                    await this.setStateAsync(obj._id, { ack: true, val: JSON.stringify(obj.value) });
                                } else {
                                    await this.setStateAsync(obj._id, { ack: true, val: obj.value });
                                }
                            }
                        }

                        // Process has
                        if (Object.prototype.hasOwnProperty.call(objects[key].logic, 'has')) {
                            const hasKey = objects[key].logic.has_key;
                            const has = objects[key].logic.has;

                            if (hasKey === '_self' || Object.prototype.hasOwnProperty.call(data, hasKey)) {
                                let tempData;
                                if (hasKey === '_self') {
                                    tempData = data;
                                } else {
                                    tempData = data[hasKey];
                                }

                                if (Array.isArray(tempData) && tempData.length > 0) {
                                    for (const element of tempData) {
                                        await this.applyJsonLogic(obj._id, element, has, statesFilter);
                                    }
                                } else {
                                    await this.applyJsonLogic(obj._id, tempData, has, statesFilter);
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
     * Function to apply a JSON logic rule to data
     * @param {*} rule
     * @param {*} data
     */
    async applyRule(rule, data) {
        let _rule;

        if (typeof (rule) === 'string') {
            _rule = { 'var': [rule] };
        } else {
            _rule = rule;
        }

        return jsonLogic.apply(
            _rule,
            data
        );
    }

    /**
     * @param {String} libName
     */
    async getUnifiObjectsLibIds(libName) {
        const objects = require(`./admin/lib/objects_${libName}.json`);

        const idList = [];
        await this.extractsIds(objects, idList, libName);

        return idList.reverse();
    }

    /**
     * @param {Object} obj
     * @param {Array} idList
     */
    async extractsIds(obj, idList, libName) {
        for (const [id, value] of Object.entries(obj)) {
            if (value && value.type === 'state') {
                idList.push(id);
            } else if (value && value.type === 'channel' || value.type === 'device') {
                if (id !== libName) {
                    // ignore root id
                    idList.push(id);
                }
                this.extractsIds(value.logic.has, idList, libName);
            }
        }
    }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Unifi(options);
} else {
    // otherwise start the instance directly
    new Unifi();
}
