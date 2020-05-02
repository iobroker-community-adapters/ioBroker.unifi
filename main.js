'use strict';

/*
 * Created with @iobroker/create-adapter v1.17.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here
const unifi = require('node-unifi');
const jsonLogic = require('./lib/json_logic.js');

const settings = {};
let queryTimeout;

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
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when adapter received configuration.
     */
    async onReady() {
        // subscribe to all state changes
        this.subscribeStates('*');

        this.log.info('Unifi adapter is ready');

        // Load configuration
        settings.updateInterval = (parseInt(this.config.updateInterval, 10) * 1000) || (60 * 1000);
        settings.controllerIp = this.config.controllerIp;
        settings.controllerPort = this.config.controllerPort;
        settings.controllerUsername = this.config.controllerUsername;
        settings.updateClients = this.config.updateClients;
        settings.updateDevices = this.config.updateDevices;
        settings.updateHealth = this.config.updateHealth;
        settings.updateNetworks = this.config.updateNetworks;
        settings.updateSysinfo = this.config.updateSysinfo;
        settings.updateVouchers = this.config.updateVouchers;
        settings.updateWlans = this.config.updateWlans;
        settings.blacklistedClients = this.config.blacklistedClients || {};
        settings.blacklistedDevices = this.config.blacklistedDevices || {};
        settings.blacklistedHealth = this.config.blacklistedHealth || {};
        settings.blacklistedNetworks = this.config.blacklistedNetworks || {};
        settings.blacklistedWlans = this.config.blacklistedWlans || {};

        if (settings.controllerIp !== '' && settings.controllerUsername !== '' && settings.controllerPassword !== '') {
            this.getForeignObject('system.config', async (err, obj) => {
                if (obj && obj.native && obj.native.secret) {
                    //noinspection JSUnresolvedVariable
                    settings.controllerPassword = await this.decrypt(obj.native.secret, this.config.controllerPassword);
                } else {
                    //noinspection JSUnresolvedVariable
                    settings.controllerPassword = await this.decrypt('Zgfr56gFe87jJOM', this.config.controllerPassword);
                }

                // Send some log messages
                this.log.debug('controller = ' + settings.controllerIp + ':' + settings.controllerPort);
                this.log.debug('updateInterval = ' + settings.updateInterval / 1000);

                this.log.debug('Blacklisted clients: ' + JSON.stringify(settings.blacklistedClients));
                this.log.debug('Blacklisted devices: ' + JSON.stringify(settings.blacklistedDevices));
                this.log.debug('Blacklisted health: ' + JSON.stringify(settings.blacklistedHealth));
                this.log.debug('Blacklisted networks: ' + JSON.stringify(settings.blacklistedNetworks));
                this.log.debug('Blacklisted WLANs: ' + JSON.stringify(settings.blacklistedWlans));

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
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            if (queryTimeout) {
                clearTimeout(queryTimeout);
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
        this.log.error(err.name + ': ' + err.message);

        if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
            const sentryInstance = this.getPluginInstance('sentry');
            if (sentryInstance) {
                sentryInstance.getSentryObject().captureException(err);
            }
        }
    }

    /**
     * Function that takes care of the API calls and processes
     * the responses afterwards
     */
    async updateUnifiData() {
        this.log.debug('Update started');

        /**
         * Function to log into the UniFi controller
         * @param {string} controllerUsername 
         * @param {string} controllerPassword 
         */
        const login = async (controllerUsername, controllerPassword) => {
            return new Promise((resolve, reject) => {
                controller.login(controllerUsername, controllerPassword, (err) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        resolve(true);
                    }
                });
            });
        };

        /**
         * Function to fetch sites
         */
        const getSites = async () => {
            return new Promise((resolve, reject) => {
                controller.getSitesStats((err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        const sites = data.map((s) => { return s.name; });

                        this.log.debug('getSites: ' + sites);

                        if (settings.updateHealth === true) {
                            processSites(sites, data);
                        }

                        resolve(sites);
                    }
                });
            });
        };

        /**
         * Function that receives the sites as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processSites = async (sites, data) => {
            const objects = require('./lib/objects_getSites.json');

            for (const site of sites) {
                const x = sites.indexOf(site);
                let siteData;

                // Process blacklist
                if (Object.prototype.hasOwnProperty.call(data[x], 'health')) {
                    const health = data[x].health.filter((item) => {
                        if (settings.blacklistedHealth.includes(item.subsystem) !== true) {
                            return item;
                        }
                    });

                    siteData = data[x];
                    siteData.health = health;
                } else {
                    siteData = data[x];
                }

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Function to fetch site sysinfo
         * @param {Object} sites 
         */
        const getSiteSysinfo = async (sites) => {
            return new Promise((resolve, reject) => {
                controller.getSiteSysinfo(sites, (err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        this.log.debug('getSiteSysinfo: ' + data.length);

                        processSiteSysinfo(sites, data);

                        resolve(data);
                    }
                });
            });
        };

        /**
         * Function that receives the site sysinfo as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processSiteSysinfo = async (sites, data) => {
            const objects = require('./lib/objects_getSiteSysinfo.json');

            for (const site of sites) {
                const x = sites.indexOf(site);
                const siteData = data[x];

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Function to fetch clients
         * @param {Object} sites 
         */
        const getClients = async (sites) => {
            return new Promise((resolve, reject) => {
                controller.getClientDevices(sites, (err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        this.log.debug('getClients: ' + data[0].length);

                        processClients(sites, data);

                        resolve(data);
                    }
                });
            });
        };

        /**
         * Function that receives the clients as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processClients = async (sites, data) => {
            const objects = require('./lib/objects_getClients.json');

            for (const site of sites) {
                const x = sites.indexOf(site);

                // Process blacklist
                const siteData = data[x].filter((item) => {
                    if (settings.blacklistedClients.includes(item.mac) !== true &&
                        settings.blacklistedClients.includes(item.ip) !== true &&
                        settings.blacklistedClients.includes(item.name) !== true &&
                        settings.blacklistedClients.includes(item.hostname) !== true) {
                        return item;
                    }
                });

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Function to fetch devices
         * @param {Object} sites 
         */
        const getDevices = async (sites) => {
            return new Promise((resolve, reject) => {
                controller.getAccessDevices(sites, (err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        this.log.debug('getDevices: ' + data[0].length);

                        processDevices(sites, data);

                        resolve(data);
                    }
                });
            });
        };

        /**
         * Function that receives the devices as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processDevices = async (sites, data) => {
            const objects = require('./lib/objects_getDevices.json');

            for (const site of sites) {
                const x = sites.indexOf(site);

                // Process blacklist
                const siteData = data[x].filter((item) => {
                    if (settings.blacklistedDevices.includes(item.mac) !== true &&
                        settings.blacklistedDevices.includes(item.ip) !== true &&
                        settings.blacklistedDevices.includes(item.name) !== true) {
                        return item;
                    }
                });

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Function to fetch networks
         * @param {Object} sites 
         */
        const getNetworks = async (sites) => {
            return new Promise((resolve, reject) => {
                controller.getNetworkConf(sites, (err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        this.log.debug('getNetworks: ' + data[0].length);

                        processNetworks(sites, data);

                        resolve(data);
                    }
                });
            });
        };

        /**
         * Function that receives the networks as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processNetworks = async (sites, data) => {
            const objects = require('./lib/objects_getNetworks.json');

            for (const site of sites) {
                const x = sites.indexOf(site);

                // Process blacklist
                const siteData = data[x].filter((item) => {
                    if (settings.blacklistedNetworks.includes(item.name) !== true) {
                        return item;
                    }
                });

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Function to fetch vouchers
         * @param {Object} sites 
         */
        const getVouchers = async (sites) => {
            return new Promise((resolve, reject) => {
                controller.getVouchers(sites, (err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        this.log.debug('getVouchers: ' + data[0].length);

                        processVouchers(sites, data);

                        resolve(data);
                    }
                });
            });
        };

        /**
         * Function that receives the vouchers as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processVouchers = async (sites, data) => {
            const objects = require('./lib/objects_getVouchers.json');

            for (const site of sites) {
                const x = sites.indexOf(site);
                const siteData = data[x];

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Function to fetch WLANs
         * @param {Object} sites 
         */
        const getWlans = async (sites) => {
            return new Promise((resolve, reject) => {
                controller.getWLanSettings(sites, (err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        this.log.debug('getWlans: ' + data[0].length);

                        processWlans(sites, data);

                        resolve(data);
                    }
                });
            });
        };

        /**
         * Function that receives the WLANs as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processWlans = async (sites, data) => {
            const objects = require('./lib/objects_getWlans.json');

            for (const site of sites) {
                const x = sites.indexOf(site);

                // Process blacklist
                const siteData = data[x].filter((item) => {
                    if (settings.blacklistedWlans.includes(item.name) !== true) {
                        return item;
                    }
                });

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Function to apply JSON logic to API responses
         * @param {*} data 
         * @param {*} objects 
         * @param {*} objectTree 
         */
        const applyJsonLogic = async (data, objects, objectTree = '') => {
            for (const key in objects) {
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
                    obj._id = await applyRule(objects[key].logic._id, data);
                }

                if (obj._id !== null) {
                    if (objectTree !== '') {
                        obj._id = objectTree + '.' + obj._id;
                    }

                    // Process type
                    if (Object.prototype.hasOwnProperty.call(objects[key], 'type')) {
                        obj.type = objects[key].type;
                    } else {
                        obj.type = await applyRule(objects[key].logic.type, data);
                    }

                    // Process common
                    if (Object.prototype.hasOwnProperty.call(objects[key], 'common')) {
                        obj.common = objects[key].common;
                    }

                    if (Object.prototype.hasOwnProperty.call(objects[key].logic, 'common')) {
                        const common = objects[key].logic.common;

                        for (const commonKey in common) {
                            obj.common[commonKey] = await applyRule(common[commonKey], data);
                        }
                    }

                    // Process native
                    if (Object.prototype.hasOwnProperty.call(objects[key], 'native')) {
                        obj.native = objects[key].native;
                    }

                    if (Object.prototype.hasOwnProperty.call(objects[key].logic, 'native')) {
                        const native = objects[key].logic.native;

                        for (const nativeKey in native) {
                            obj.native[nativeKey] = await applyRule(native[nativeKey], data);
                        }
                    }

                    // Process value
                    if (Object.prototype.hasOwnProperty.call(objects[key], 'value')) {
                        obj.value = objects[key].value;
                    } else {
                        if (Object.prototype.hasOwnProperty.call(objects[key].logic, 'value')) {
                            obj.value = await applyRule(objects[key].logic.value, data);
                        }
                    }

                    // Cleanup _id
                    const FORBIDDEN_CHARS = /[\]\[*,;'"`<>\\?\s]/g;
                    let tempId = obj._id.replace(FORBIDDEN_CHARS, '_');
                    tempId = tempId.toLowerCase();
                    obj._id = tempId;

                    //this.log.debug(JSON.stringify(obj));

                    await this.extendObjectAsync(obj._id, {
                        type: obj.type,
                        common: JSON.parse(JSON.stringify(obj.common)),
                        native: JSON.parse(JSON.stringify(obj.native))
                    });

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

                            if (Array.isArray(tempData)) {
                                tempData.forEach(async element => {
                                    await applyJsonLogic(element, has, obj._id);
                                });
                            } else {
                                await applyJsonLogic(tempData, has, obj._id);
                            }
                        }
                    }
                }
            }
        };

        /**
         * Function to apply a JSON logic rule to data
         * @param {*} rule 
         * @param {*} data 
         */
        const applyRule = async (rule, data) => {
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
        };

        /********************
         * LET'S GO
         *******************/
        const controller = new unifi.Controller(settings.controllerIp, settings.controllerPort);

        login(settings.controllerUsername, settings.controllerPassword)
            .then(async () => {
                this.log.debug('Login successful');

                const sites = await getSites();

                if (settings.updateSysinfo === true) {
                    await getSiteSysinfo(sites);
                }

                if (settings.updateClients === true) {
                    await getClients(sites);
                }

                if (settings.updateDevices === true) {
                    await getDevices(sites);
                }

                if (settings.updateNetworks === true) {
                    await getNetworks(sites);
                }

                if (settings.updateVouchers === true) {
                    await getVouchers(sites);
                }

                if (settings.updateWlans === true) {
                    await getWlans(sites);
                }

                // finalize, logout and finish
                controller.logout();

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
        queryTimeout = setTimeout(() => {
            this.updateUnifiData();
        }, settings.updateInterval);
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
