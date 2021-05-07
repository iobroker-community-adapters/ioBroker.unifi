'use strict';

/*
 * Created with @iobroker/create-adapter v1.17.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here
const unifi = require('node-unifi');
const jsonLogic = require('./admin/lib/json_logic.js');
const tools = require('./lib/tools.js');

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

        this.controller;
        this.objectsFilter = {};
        this.settings = {};
        this.update = {};
        this.clients = {};
        this.vouchers = {};
        this.dpi = {};
        this.statesFilter = {};
        this.queryTimeout;

        this.ownObjects = {};
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

            this.log.info('UniFi adapter is ready');

            // Load configuration
            this.settings.updateInterval = (parseInt(this.config.updateInterval, 10) * 1000) || (60 * 1000);
            this.settings.controllerIp = this.config.controllerIp;
            this.settings.controllerPort = this.config.controllerPort;
            this.settings.controllerUsername = this.config.controllerUsername;

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

            this.objectsFilter = this.config.blacklist || this.config.objectsFilter; // blacklist was renamed to objectsFilter in v0.5.3
            this.statesFilter = this.config.whitelist || this.config.statesFilter; // blacklist was renamed to statesFilter in v0.5.3

            this.clients.isOnlineOffset = (parseInt(this.config.clientsIsOnlineOffset, 10) * 1000) || (60 * 1000);

            this.vouchers.number = this.config.createVouchersNumber;
            this.vouchers.duration = this.config.createVouchersDuration;
            this.vouchers.quota = this.config.createVouchersQuota;
            this.vouchers.uploadLimit = (this.config.createVouchersUploadLimit == 0) ? null : this.config.createVouchersUploadLimit;
            this.vouchers.downloadLimit = (this.config.createVouchersDownloadLimit == 0) ? null : this.config.createVouchersDownloadLimit;
            this.vouchers.byteQuota = (this.config.createVouchersByteQuota == 0) ? null : this.config.createVouchersByteQuota;
            this.vouchers.note = this.config.createVouchersNote;

            if (this.settings.controllerIp !== '' && this.settings.controllerUsername !== '' && this.settings.controllerPassword !== '') {
                this.getForeignObject('system.config', async (err, obj) => {
                    if (obj && obj.native && obj.native.secret) {
                        //noinspection JSUnresolvedVariable
                        this.settings.controllerPassword = await this.decrypt(obj.native.secret, this.config.controllerPassword);
                    } else {
                        //noinspection JSUnresolvedVariable
                        this.settings.controllerPassword = await this.decrypt('Zgfr56gFe87jJOM', this.config.controllerPassword);
                    }

                    // Send some log messages
                    this.log.debug('controller = ' + this.settings.controllerIp + ':' + this.settings.controllerPort);
                    this.log.debug('updateInterval = ' + this.settings.updateInterval / 1000);

                    // Start main function
                    this.updateUnifiData();
                });
            } else {
                this.log.error('Adapter deactivated due to missing configuration.');

                await this.setStateAsync('info.connection', { ack: true, val: false });
                this.setForeignState('system.adapter.' + this.namespace + '.alive', false);
            }
        } catch (err) {
            this.errorHandling(err, 'onReady');
        }
    }

    /**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
    onStateChange(id, state) {
        try {
            if (typeof state === 'object' && state !== null && !state.ack) {
                // The state was changed
                const idParts = id.split('.');
                const site = idParts[2];

                if (idParts[3] === 'wlans' && idParts[5] === 'enabled') {
                    this.updateWlanStatus(site, id, state);
                } else if (idParts[3] === 'vouchers' && idParts[4] === 'create_vouchers') {
                    this.createUnifiVouchers(site);
                } else if (idParts[2] === 'trigger_update') {
                    this.updateUnifiData(true);
                }
            }
        } catch (err) {
            this.errorHandling(err, 'onStateChange');
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
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
     * Function to decrypt passwords
     * @param {*} key 
     * @param {*} value 
     */
    decrypt(key, value) {
        let result = '';

        for (let i = 0; i < value.length; ++i) {
            result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
        }

        return result;
    }

    /**
     * Function to handle error messages
     * @param {Object} err
     * @param {String | undefined} methodName
     */
    async errorHandling(err, methodName = undefined) {
        if (err.message === 'api.err.Invalid') {
            this.log.error('Error: Incorrect username or password.');
        } else if (err.message === 'api.err.LoginRequired') {
            this.log.error('Error: Login required. Check username and password.');
        } else if (err.message === 'api.err.Ubic2faTokenRequired') {
            this.log.error('Error: 2-Factor-Authentication required by UniFi controller. 2FA is not supported by this adapter.');
        } else if (err.message === 'api.err.ServerBusy') {
            this.log.error('Error: Server is busy. There seems to be a problem with the UniFi controller.');
        } else if (err.message === 'api.err.NoPermission') {
            this.log.error('Error: Permission denied. Check access rights.');
        } else if (err.message.includes('connect EHOSTUNREACH') === true) {
            this.log.error('Error: Host cannot be reached.');
        } else if (err.message.includes('connect ECONNREFUSED') === true) {
            this.log.error('Error: Connection refused. Incorrect IP or port.');
        } else if (err.message.includes('connect ETIMEDOUT') === true) {
            this.log.error('Error: Connection timedout.');
        } else if (err.message.includes('read ECONNRESET') === true) {
            this.log.error('Error: Connection was closed by the UniFi controller.');
        } else if (err.message.includes('getaddrinfo EAI_AGAIN') === true) {
            this.log.error('Error: This error is not related to the adapter. There seems to be a DNS issue. Please google for "getaddrinfo EAI_AGAIN" to fix the issue.');
        } else if (err.message.includes('getaddrinfo ENOTFOUND') === true) {
            this.log.error('Error: Host not found. Incorrect IP or port.');
        } else if (err.message.includes('socket hang up') === true) {
            this.log.error('Error: Socket hang up.');
        } else if (err.message.includes('Returned data is not in valid format')) {
            this.log.error(err.message);
        } else {

            if (methodName) {
                this.log.error(`[${methodName}] error: ${err.message}, stack: ${err.stack}`);
            } else {
                this.log.error(`error: ${err.message}, stack: ${err.stack}`);
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

            this.controller = new unifi.Controller(this.settings.controllerIp, this.settings.controllerPort);

            this.login(this.settings.controllerUsername, this.settings.controllerPassword)
                .then(async () => {
                    this.log.debug('Login successful');

                    const sites = await this.fetchSites();

                    if (this.update.sysinfo === true) {
                        await this.fetchSiteSysinfo(sites);
                    }

                    if (this.update.clients === true) {
                        await this.fetchClients(sites);
                    }

                    if (this.update.devices === true) {
                        await this.fetchDevices(sites);
                    }

                    if (this.update.wlans === true) {
                        await this.fetchWlans(sites);
                    }

                    if (this.update.networks === true) {
                        await this.fetchNetworks(sites);
                    }

                    if (this.update.health === true) {
                        await this.fetchHealth(sites);
                    }

                    if (this.update.vouchers === true) {
                        await this.fetchVouchers(sites);
                    }

                    if (this.update.dpi === true) {
                        await this.fetchDpi(sites);
                    }

                    if (this.update.gatewayTraffic === true) {
                        await this.fetchGatewayTraffic(sites);
                    }

                    if (this.update.alarms === true) {
                        await this.fetchAlarms(sites);
                    }

                    // finalize, logout and finish
                    this.controller.logout();

                    await this.setStateAsync('info.connection', { ack: true, val: true });
                    this.log.info('Update done');

                    return Promise.resolve(true);
                })
                .catch(async (err) => {
                    await this.setStateAsync('info.connection', { ack: true, val: false });

                    this.errorHandling(err);

                    return;
                });

            if (preventReschedule === false) {
                // schedule a new execution of updateUnifiData in X seconds
                this.queryTimeout = setTimeout(() => {
                    this.updateUnifiData();
                }, this.settings.updateInterval);
            }
        } catch (err) {
            this.errorHandling(err, 'updateUnifiData');
        }
    }

    /**
     * Function to log into the UniFi controller
     * @param {string} controllerUsername 
     * @param {string} controllerPassword 
     */
    async login(controllerUsername, controllerPassword) {
        return new Promise((resolve, reject) => {
            this.controller.login(controllerUsername, controllerPassword, async (err) => {
                if (err) {
                    reject(new Error(err));
                } else {
                    resolve(true);
                }
            });
        });
    }

    /**
     * Function to fetch sites
     */
    async fetchSites() {
        return new Promise((resolve, reject) => {
            this.controller.getSites(async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined) {
                    reject(new Error('fetchSites: Returned data is not in valid format'));
                } else {
                    const sites = data.map((s) => { return s.name; });
                    this.log.debug('fetchSites: ' + sites);

                    await this.processSites(sites, data);

                    resolve(sites);
                }
            });
        });
    }

    /**
     * Function that receives the sites as a JSON data array
     * @param {Object} sites 
     * @param {Object} data 
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
     * @param {Object} sites 
     */
    async fetchSiteSysinfo(sites) {
        return new Promise((resolve, reject) => {
            this.controller.getSiteSysinfo(sites, async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined) {
                    reject(new Error('fetchSiteSysinfo: Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchSiteSysinfo: ' + data.length);
                    this.log.silly(`fetchSiteSysinfo: ${JSON.stringify(data)}`);

                    await this.processSiteSysinfo(sites, data);

                    resolve(data);
                }
            });
        });
    }

    /**
     * Function that receives the site sysinfo as a JSON data array
     * @param {Object} sites 
     * @param {Object} data 
     */
    async processSiteSysinfo(sites, data) {
        const objects = require('./admin/lib/objects_sysinfo.json');

        for (const site of sites) {
            const x = sites.indexOf(site);
            const siteData = data[x];

            this.log.silly(`processSiteSysinfo: site: ${site}, data: ${JSON.stringify(data[x])}`);

            await this.applyJsonLogic(site, siteData, objects, this.statesFilter.sysinfo);
        }
    }

    /**
     * Function to fetch clients
     * @param {Object} sites 
     */
    async fetchClients(sites) {
        return new Promise((resolve, reject) => {
            this.controller.getClientDevices(sites, async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('fetchClients: Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchClients: ' + data[0].length);
                    this.log.silly(`fetchClients: ${JSON.stringify(data)}`);

                    await this.processClients(sites, data);

                    resolve(data);
                }
            });
        });
    }

    /**
     * Function that receives the clients as a JSON data array
     * @param {Object} sites 
     * @param {Object} data 
     */
    async processClients(sites, data) {
        const objects = require('./admin/lib/objects_clients.json');

        for (const site of sites) {
            const x = sites.indexOf(site);

            if (x != -1 && data[x]) {
                this.log.silly(`processClients: site: ${site}, data: ${JSON.stringify(data[x])}`);

                // Process objectsFilter
                const siteData = data[x].filter((item) => {
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

                // Update is_online of offline clients
                await this.setClientOnlineStatus();
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
                const isOnline = (lastSeen - (now - this.settings.updateInterval - this.clients.isOnlineOffset) < 0 === true) ? false : true;
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
     * @param {Object} sites 
     */
    async fetchDevices(sites) {
        return new Promise((resolve, reject) => {
            this.controller.getAccessDevices(sites, async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('fetchDevices: Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchDevices: ' + data[0].length);
                    this.log.silly(`fetchDevices: ${JSON.stringify(data)}`);

                    await this.processDevices(sites, data);

                    resolve(data);
                }
            });
        });
    }

    /**
     * Function that receives the devices as a JSON data array
     * @param {Object} sites 
     * @param {Object} data 
     */
    async processDevices(sites, data) {
        const objects = require('./admin/lib/objects_devices.json');

        for (const site of sites) {
            const x = sites.indexOf(site);

            if (x != -1 && data[x]) {
                this.log.silly(`processDevices: site: ${site}, data: ${JSON.stringify(data[x])}`);

                // Process objectsFilter
                const siteData = data[x].filter((item) => {
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
    }

    /**
     * Function to fetch WLANs
     * @param {Object} sites 
     */
    async fetchWlans(sites) {
        return new Promise((resolve, reject) => {
            this.controller.getWLanSettings(sites, async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('fetchWlans: Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchWlans: ' + data[0].length);
                    this.log.silly(`fetchWlans: ${JSON.stringify(data)}`);

                    await this.processWlans(sites, data);

                    resolve(data);
                }
            });
        });
    }

    /**
     * Function that receives the WLANs as a JSON data array
     * @param {Object} sites 
     * @param {Object} data 
     */
    async processWlans(sites, data) {
        const objects = require('./admin/lib/objects_wlans.json');

        for (const site of sites) {
            const x = sites.indexOf(site);

            if (x != -1 && data[x]) {
                this.log.silly(`processWlans: site: ${site}, data: ${JSON.stringify(data[x])}`);

                // Process objectsFilter
                const siteData = data[x].filter((item) => {
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
    }

    /**
     * Function to fetch networks
     * @param {Object} sites 
     */
    async fetchNetworks(sites) {
        return new Promise((resolve, reject) => {
            this.controller.getNetworkConf(sites, async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('fetchNetworks: Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchNetworks: ' + data[0].length);
                    this.log.silly(`fetchNetworks: ${JSON.stringify(data)}`);

                    await this.processNetworks(sites, data);

                    resolve(data);
                }
            });
        });
    }

    /**
     * Function that receives the networks as a JSON data array
     * @param {Object} sites 
     * @param {Object} data 
     */
    async processNetworks(sites, data) {
        const objects = require('./admin/lib/objects_networks.json');

        for (const site of sites) {
            const x = sites.indexOf(site);

            if (x != -1 && data[x]) {
                this.log.silly(`processNetworks: site: ${site}, data: ${JSON.stringify(data[x])}`);

                // Process objectsFilter
                const siteData = data[x].filter((item) => {
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
    }

    /**
     * Function to fetch health
     * @param {Object} sites 
     */
    async fetchHealth(sites) {
        return new Promise((resolve, reject) => {
            this.controller.getHealth(sites, async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('fetchHealth: Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchHealth: ' + data[0].length);
                    this.log.silly(`fetchHealth: ${JSON.stringify(data)}`);

                    await this.processHealth(sites, data);

                    resolve(data);
                }
            });
        });
    }

    /**
     * Function that receives the health as a JSON data array
     * @param {Object} sites 
     * @param {Object} data 
     */
    async processHealth(sites, data) {
        const objects = require('./admin/lib/objects_health.json');

        for (const site of sites) {
            const x = sites.indexOf(site);

            if (x != -1 && data[x]) {
                this.log.silly(`processHealth: site: ${site}, data: ${JSON.stringify(data[x])}`);

                // Process objectsFilter
                const siteData = data[x].filter((item) => {
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
    }

    /**
     * Function to fetch vouchers
     * @param {Object} sites 
     */
    async fetchVouchers(sites) {
        return new Promise((resolve, reject) => {
            this.controller.getVouchers(sites, async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('fetchVouchers: Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchVouchers: ' + data[0].length);
                    this.log.silly(`fetchVouchers: ${JSON.stringify(data)}`);

                    await this.processVouchers(sites, data);

                    resolve(data);
                }
            });
        });
    }

    /**
     * Function that receives the vouchers as a JSON data array
     * @param {Object} sites 
     * @param {Object} data 
     */
    async processVouchers(sites, data) {
        const objects = require('./admin/lib/objects_vouchers.json');

        for (const site of sites) {
            const x = sites.indexOf(site);

            if (x != -1 && data[x]) {
                let siteData = data[x];

                this.log.silly(`processVouchers: site: ${site}, data: ${JSON.stringify(data[x])}`);

                if (this.update.vouchersNoUsed) {
                    // Remove used vouchers
                    siteData = data[x].filter((item) => {
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
    }

    /**
     * Function to fetch dpi
     * @param {Object} sites 
     */
    async fetchDpi(sites) {
        return new Promise((resolve, reject) => {
            this.controller.getDPIStats(sites, async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('fetchDpi: Returned data is not in valid format. This option is only available for gateways!'));
                } else {
                    if (data[0] && data[0][0] && data[0][0].by_cat && data[0][0].by_app) {
                        this.log.debug(`fetchDpi: categories: ${data[0][0].by_cat.length}, apps: ${data[0][0].by_app.length}`);
                    }

                    this.log.silly(`fetchDpi: ${JSON.stringify(data)}`);

                    await this.processDpi(sites, data);

                    resolve(data);
                }
            });
        });
    }

    /**
     * Function that receives the dpi as a JSON data array
     * @param {Object} sites 
     * @param {Object} data 
     */
    async processDpi(sites, data) {
        const objects = require('./admin/lib/objects_dpi.json');

        for (const site of sites) {
            const x = sites.indexOf(site);

            if (x != -1 && data[x]) {
                this.log.silly(`processDpi: site: ${site}, data: ${JSON.stringify(data[x])}`);

                // Process objectsFilter
                const siteData = data[x].filter((item) => {
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
    }


    /**
     * Function to fetch daily gateway traffic
     * @param {Object} sites 
     */
    async fetchGatewayTraffic(sites) {
        let start = undefined;
        let end = undefined;
        if (this.update.gatewayTrafficMaxDays > 0) {
            const now = new Date();
            end = now.getTime();

            now.setDate(now.getDate() - this.update.gatewayTrafficMaxDays);
            start = now.getTime();

            this.log.silly(`fetchGatewayTraffic: start: ${new Date(start).toLocaleDateString()}, end: ${new Date(end).toLocaleDateString()}`);
        }

        return new Promise((resolve, reject) => {
            this.controller.getDailyGatewayStats(sites, async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('fetchGatewayTraffic: Returned data is not in valid format. This option is only available for gateways!'));
                } else {
                    this.log.debug('fetchGatewayTraffic: ' + data[0].length);
                    this.log.silly(`fetchGatewayTraffic: ${JSON.stringify(data)}`);

                    await this.processGatewayTraffic(sites, data);

                    resolve(data);
                }
            }, start, end, ['lan-rx_bytes', 'lan-tx_bytes']);
        });
    }

    /**
     * Function that receives the daily gateway traffic as a JSON data array
     * @param {Object} sites 
     * @param {Object} data 
     */
    async processGatewayTraffic(sites, data) {
        const objects = require('./admin/lib/objects_gateway_traffic.json');

        for (const site of sites) {
            const x = sites.indexOf(site);

            if (x != -1 && data[x]) {
                this.log.silly(`processGatewayTraffic: site: ${site}, data: ${JSON.stringify(data[x])}`);

                // Process objectsFilter
                const siteData = data[x].filter((item) => {
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
    }

    /**
     * Function to fetch alarms
     * @param {Object} sites 
     */
    async fetchAlarms(sites) {
        return new Promise((resolve, reject) => {
            this.controller.getAlarms(sites, async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('fetchAlarms: Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchAlarms: ' + data[0].length);
                    this.log.silly(`fetchAlarms: ${JSON.stringify(data)}`);

                    await this.processAlarms(sites, data);

                    resolve(data);
                }
            }, (this.update.alarmsNoArchived === false));
        });
    }

    /**
     * Function that receives the alarms as a JSON data array
     * @param {Object} sites 
     * @param {Object} data 
     */
    async processAlarms(sites, data) {
        const objects = require('./admin/lib/objects_alarms.json');

        for (const site of sites) {
            const x = sites.indexOf(site);

            if (x != -1 && data[x]) {
                this.log.silly(`processAlarms: site: ${site}, data: ${JSON.stringify(data[x])}`);

                // Process objectsFilter
                const siteData = data[x].filter((item) => {
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
    }

    /**
     * Disable or enable a WLAN
     * @param {*} site 
     * @param {*} objId 
     * @param {*} state
     */
    updateWlanStatus(site, objId, state) {
        this.login(this.settings.controllerUsername, this.settings.controllerPassword)
            .then(async () => {
                this.log.debug('Login successful');

                await this.setWlanStatus(site, objId, state);

                // finalize, logout and finish
                this.controller.logout();

                this.log.info('WLAN status set to ' + state.val);

                return true;
            })
            .catch(async (err) => {
                this.errorHandling(err);

                return;
            });
    }

    /**
     * Function to fetch vouchers
     * @param {Object} site 
     * @param {Object} objId
     * @param {Object} state
     */
    async setWlanStatus(site, objId, state) {
        const obj = await this.getForeignObjectAsync(objId);

        const wlanId = obj.native.wlan_id;
        const disable = (state.val == true) ? false : true;

        return new Promise((resolve, reject) => {
            this.controller.disableWLan(site, wlanId, disable, async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('setWlanStatus: Returned data is not in valid format'));
                } else {
                    this.log.debug('setWlanStatus: ' + data[0].length);

                    await this.processWlans([site], data);

                    resolve(data);
                }
            });
        });
    }

    /**
     * Create vouchers
     * @param {*} site
     */
    createUnifiVouchers(site) {
        this.login(this.settings.controllerUsername, this.settings.controllerPassword)
            .then(async () => {
                this.log.debug('Login successful');

                await this.createVouchers(site);
                await this.fetchVouchers([site]);

                // finalize, logout and finish
                this.controller.logout();

                this.log.info('Vouchers created');

                return true;
            })
            .catch(async (err) => {
                this.errorHandling(err);

                return;
            });
    }

    /**
     * Function to create vouchers
     * @param {Object} site
     */
    async createVouchers(site) {
        const minutes = this.vouchers.duration || 60;
        const count = this.vouchers.number || 1;
        const quota = this.vouchers.quota || 1;
        const note = this.vouchers.note || '';
        const up = this.vouchers.uploadLimit || 0;
        const down = this.vouchers.downloadLimit || 0;
        const mbytes = this.vouchers.byteQuota || 0;

        return new Promise((resolve, reject) => {
            const cb = async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('createVouchers: Returned data is not in valid format'));
                } else {
                    this.log.debug('createVouchers: ' + data[0].length);

                    await this.processWlans([site], data);

                    resolve(data);
                }
            };

            this.controller.createVouchers(site, minutes, cb, count, quota, note, up, down, mbytes);
        });
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
                            obj._id = objectTree + '.' + obj._id;
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

                        // Update state if value changed
                        if (Object.prototype.hasOwnProperty.call(obj, 'value')) {
                            const oldState = await this.getStateAsync(obj._id);

                            if (oldState === null || oldState.val != obj.value) {
                                if(typeof obj.value === 'object') {
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

                                if (Array.isArray(tempData) && Object.keys(tempData).length > 0) {
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
            this.errorHandling(err, 'applyJsonLogic');
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
