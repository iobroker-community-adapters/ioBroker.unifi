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
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
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
        this.statesFilter = {};
        this.queryTimeout;

        this.ownObjects = {};
    }

    /**
     * Is called when adapter received configuration.
     */
    async onReady() {
        // subscribe to all state changes
        this.subscribeStates('*.wlans.*.enabled');
        this.subscribeStates('*.vouchers.create_vouchers');
        this.subscribeStates('*.UpdateAllData');

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
        this.update.wlans = this.config.updateWlans;


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
    }

    /**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
    onStateChange(id, state) {
        if (typeof state == 'object' && !state.ack) {
            // The state was changed
            const idParts = id.split('.');
            const site = idParts[2];

            if (idParts[3] === 'wlans' && idParts[5] === 'enabled') {
                this.updateWlanStatus(site, id, state);
            } else if (idParts[3] === 'vouchers' && idParts[4] === 'create_vouchers') {
                this.createUnifiVouchers(site);
            } else if (idParts[2] === 'info' && idParts[3] === 'UpdateAllData') {                
                this.updateUnifiData();
            }
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
     */
    async errorHandling(err) {
        if (err.message === 'api.err.Invalid') {
            this.log.error('Error: Incorrect username or password.');
        } else if (err.message === 'api.err.LoginRequired') {
            this.log.error('Error: Login required. Check username and password.');
        } else if (err.message.includes('connect ECONNREFUSED') === true) {
            this.log.error('Error: Connection refused. Incorrect IP or port.');
        } else if (err.message.includes('read ECONNRESET') === true) {
            this.log.error('Error: Connection was closed by the UniFi controller.');
        } else if (err.message.includes('getaddrinfo EAI_AGAIN') === true) {
            this.log.error('Error: This error is not related to the adapter. There seems to be a DNS issue. Please google for "getaddrinfo EAI_AGAIN" to fix the issue.');
        } else if (err.message.includes('getaddrinfo ENOTFOUND') === true) {
            this.log.error('Error: Host not found. Incorrect IP or port.');
        } else if (err.message === 'Returned data is not in valid format') {
            this.log.error(err.message);
        } else {
            this.log.error(err.name + ': ' + err.message);

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
    async updateUnifiData() {
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

        // schedule a new execution of updateUnifiData in X seconds
        this.queryTimeout = setTimeout(() => {
            this.updateUnifiData();
        }, this.settings.updateInterval);
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
                    reject(new Error('Returned data is not in valid format'));
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
                    reject(new Error('Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchSiteSysinfo: ' + data.length);

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
                    reject(new Error('Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchClients: ' + data[0].length);

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

            // Process objectsFilter
            const siteData = data[x].filter((item) => {
                if (this.objectsFilter.clients.includes(item.mac) !== true &&
                    this.objectsFilter.clients.includes(item.ip) !== true &&
                    this.objectsFilter.clients.includes(item.name) !== true &&
                    this.objectsFilter.clients.includes(item.hostname) !== true) {
                    return item;
                }
            });

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.clients);
            }

            // Update is_online of offline clients
            await this.setClientOnlineStatus();
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
                    reject(new Error('Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchDevices: ' + data[0].length);

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

            // Process objectsFilter
            const siteData = data[x].filter((item) => {
                if (this.objectsFilter.devices.includes(item.mac) !== true &&
                    this.objectsFilter.devices.includes(item.ip) !== true &&
                    this.objectsFilter.devices.includes(item.name) !== true) {
                    return item;
                }
            });

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.devices);
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
                    reject(new Error('Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchWlans: ' + data[0].length);

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

            // Process objectsFilter
            const siteData = data[x].filter((item) => {
                if (this.objectsFilter.wlans.includes(item.name) !== true) {
                    return item;
                }
            });

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.wlans);
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
                    reject(new Error('Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchNetworks: ' + data[0].length);

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

            // Process objectsFilter
            const siteData = data[x].filter((item) => {
                if (this.objectsFilter.networks.includes(item.name) !== true) {
                    return item;
                }
            });

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.networks);
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
                    reject(new Error('Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchHealth: ' + data[0].length);

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

            // Process objectsFilter
            const siteData = data[x].filter((item) => {
                if (this.objectsFilter.health.includes(item.subsystem) !== true) {
                    return item;
                }
            });

            if (siteData.length > 0) {
                await this.applyJsonLogic(site, siteData, objects, this.statesFilter.health);
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
                    reject(new Error('Returned data is not in valid format'));
                } else {
                    this.log.debug('fetchVouchers: ' + data[0].length);

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
            const siteData = data[x];

            await this.applyJsonLogic(site, siteData, objects, this.statesFilter.vouchers);
        }
    }

    /**
     * Disable or enable a WLAN
     * @param {*} site 
     * @param {*} objId 
     * @param {*} status 
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
     * @param {Object} sites 
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
                    reject(new Error('Returned data is not in valid format'));
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
     * @param {*} objId
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
     * @param {Object} sites 
     */
    async createVouchers(site) {
        const minutes = this.vouchers.duration;
        const count = this.vouchers.number;
        const quota = this.vouchers.quota;
        const note = this.vouchers.note;
        const up = this.vouchers.uploadLimit;
        const down = this.vouchers.downloadLimit;
        const mbytes = this.vouchers.byteQuota;

        return new Promise((resolve, reject) => {
            const cb = async (err, data) => {
                if (err) {
                    reject(new Error(err));
                } else if (data === undefined || tools.isArray(data) === false || data[0] === undefined || tools.isArray(data[0]) === false) {
                    reject(new Error('Returned data is not in valid format'));
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
        for (const key in objects) {
            if (statesFilter.lenth === 0 || statesFilter.includes(key)) {
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

                            this.log.debug('Object ' + obj._id + ' updated');
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
                            await this.setStateAsync(obj._id, { ack: true, val: obj.value });
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
