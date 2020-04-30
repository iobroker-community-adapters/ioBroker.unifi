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

        // define a timeout variable so that we can check the controller in regular intervals
        this.queryTimeout;

        this.setStateArray = [];
    }

    /**
     * Is called when adapter received configuration.
     */
    async onReady() {
        // subscribe to all state changes
        this.subscribeStates('*');

        this.log.info('Unifi adapter is ready');

        this.updateUnifiData();
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
     * Function to create a channel
     * @param {*} name 
     * @param {*} desc 
     */
    localCreateChannel(name, desc) {
        if (typeof (desc) === 'undefined') {
            desc = name;
        }

        const FORBIDDEN_CHARS = /[\]\[*,;'"`<>\\?\s]/g;
        name = name.replace(FORBIDDEN_CHARS, '_');

        this.setObjectNotExists(name, {
            type: 'channel',
            common: {
                name: desc
            },
            native: {}
        });
    }

    /**
     * Function to create a state and set its value
     * only if it hasn't been set to this value before
     * @param {*} name 
     * @param {*} value 
     * @param {*} desc 
     */
    localCreateState(name, value, desc) {
        if (typeof (desc) === 'undefined') {
            desc = name;
        }

        if (Array.isArray(value)) {
            value = value.toString();
        }

        const FORBIDDEN_CHARS = /[\]\[*,;'"`<>\\?\s]/g;
        name = name.replace(FORBIDDEN_CHARS, '_');

        this.setObjectNotExists(name, {
            type: 'state',
            common: {
                name: desc,
                type: typeof (value),
                read: true,
                write: false
            },
            native: {
                id: name
            }
        });

        if (typeof (value) !== 'undefined') {
            this.setStateArray.push({
                name: name,
                val: value
            });
        }
    }

    /**
     * Function that takes care of the API calls and processes
     * the responses afterwards
     */
    async updateUnifiData() {
        this.log.debug('Update started');

        // Load configuration
        const updateInterval = parseInt(this.config.updateInterval, 10) || 60;
        const controllerIp = this.config.controllerIp || '127.0.0.1';
        const controllerPort = this.config.controllerPort || 8443;
        const controllerUsername = this.config.controllerUsername || 'admin';
        const controllerPassword = this.config.controllerPassword || '';
        const run_legacy = this.config.updateMode === 'legacy' ? true : false;
        const updateClients = this.config.updateClients;
        const updateDevices = this.config.updateDevices;
        const updateHealth = this.config.updateHealth;
        const updateNetworks = this.config.updateNetworks;
        const updateSysinfo = this.config.updateSysinfo;
        const updateVouchers = this.config.updateVouchers;
        const blacklistedClients = this.config.blacklistedClients || {};
        const blacklistedDevices = this.config.blacklistedDevices || {};
        const blacklistedHealth = this.config.blacklistedHealth || {};
        const blacklistedNetworks = this.config.blacklistedNetworks || {};

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
         * Function to fetch site stats
         */
        const getSitesStats = async () => {
            return new Promise((resolve, reject) => {
                controller.getSitesStats((err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        const sites = data.map(function (s) { return s.name; });

                        this.log.debug('getSitesStats: ' + sites);
                        //this.log.debug(JSON.stringify(data));

                        if (updateHealth) {
                            if (run_legacy) {
                                processSitesStatsLegacy(data);
                            } else {
                                processSitesStats(sites, data);
                            }
                        }

                        resolve(sites);
                    }
                });
            });
        };

        /**
         * Function that receives the site info as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processSitesStats = async (sites, data) => {
            const objects = require('./lib/objects_getSitesStats.json');

            for (let x = 0; x < sites.length; x++) {
                const site = sites[x];
                const siteData = data[x];

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
        * Function that receives the site info as a JSON data array
        * and parses through it to create all channels+states
        * @param {Object} siteInfo 
        */
        const processSitesStatsLegacy = (siteInfo) => {
            // lets store some site information
            for (let i = 0; i < siteInfo.length; i++) {
                // traverse the json with depth 0..2 only
                traverse(siteInfo[i], siteInfo[i].name, 0, 2, function (name, value, depth) {
                    //this.log.debug('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                    if (typeof (value) === 'object' && value !== null) {
                        if (depth == 1) {
                            this.localCreateChannel(name, 'Site ' + value.desc);
                        } else {
                            // continue the traversal of the object with depth 2
                            traverse(value, name, 2, 2, function (name, value, depth) {
                                //this.log.debug('_(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));
                                this.localCreateChannel(name);

                                // walk through all sub values on a flat level starting with the
                                // subsystem tree.
                                traverse(value, name + '.' + value.subsystem, 0, 0, function (name, value, depth) {
                                    //this.log.debug('__(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));
                                    if (typeof (value) === 'object' && value !== null) {
                                        this.localCreateChannel(name, 'Subsystem ' + value.subsystem);
                                    } else {
                                        this.localCreateState(name, value);
                                    }
                                }.bind(this));
                            }.bind(this));
                        }
                    } else {
                        this.localCreateState(name, value);
                    }
                }.bind(this));
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
                        //this.log.debug(JSON.stringify(data));

                        if (updateSysinfo) {
                            if (run_legacy) {
                                processSiteSysinfoLegacy(sites, data);
                            } else {
                                processSiteSysinfo(sites, data);
                            }
                        }

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

            for (let x = 0; x < sites.length; x++) {
                const site = sites[x];
                const siteData = data[x];

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Function that receives the site sysinfo as a JSON data array
         * and parses through it to create all channels+states
         * @param {Object} sites 
         * @param {Object} siteSysinfo 
         */
        const processSiteSysinfoLegacy = (sites, siteSysinfo) => {
            // lets store some site information
            for (let i = 0; i < siteSysinfo.length; i++) {
                // traverse the json with depth 0..2 only
                traverse(siteSysinfo[i], sites[i] + '.sysinfo', 2, 4, function (name, value, depth) {
                    //this.log.debug('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value) + ' array: ' + Array.isArray(value));

                    if (typeof (value) === 'object' && value !== null) {
                        if (depth == 2) {
                            this.localCreateChannel(name, 'Site Sysinfo');
                        } else if (depth == 3) {
                            this.localCreateChannel(name);
                        } else {
                            if (typeof (value.key) !== 'undefined') {
                                // continue the traversal of the object with depth 2
                                traverse(value, name + '.' + value.key, 1, 2, function (name, value, depth) {
                                    //this.log.debug('_(' + depth + '): ' + name + ' = ' + value + ' type2: ' + typeof(value) + ' array: ' + Array.isArray(value));

                                    if (Array.isArray(value) === false && typeof (value) === 'object' && value !== null) {
                                        this.localCreateChannel(name, value.name);
                                    } else {
                                        this.localCreateState(name, value);
                                    }
                                });
                            } else {
                                this.localCreateState(name, value);
                            }
                        }
                    } else {
                        this.localCreateState(name, value);
                    }
                }.bind(this));
            }
        };

        /**
         * Function to fetch devices
         * @param {Object} sites 
         */
        const getClientDevices = async (sites) => {
            return new Promise((resolve, reject) => {
                controller.getClientDevices(sites, (err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        this.log.debug('getClientDevices: ' + data[0].length);
                        //this.log.debug(JSON.stringify(data));

                        if (updateClients) {
                            if (run_legacy) {
                                processClientDeviceInfoLegacy(sites, data);
                            } else {
                                processClientDeviceInfo(sites, data);
                            }
                        }

                        resolve(data);
                    }
                });
            });
        };

        /**
         * Function that receives the client device info as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processClientDeviceInfo = async (sites, data) => {
            const objects = require('./lib/objects_getClientDevices.json');

            for (let x = 0; x < sites.length; x++) {
                const site = sites[x];
                const siteData = data[x];

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Function that receives the client device info as a JSON data array
         * and parses through it to create all channels+states
         * @param {Object} sites 
         * @param {Object} clientDevices 
         */
        const processClientDeviceInfoLegacy = (sites, clientDevices) => {
            // lets store some site information
            for (let i = 0; i < sites.length; i++) {
                // traverse the json with depth 3..4 only
                traverse(clientDevices[i], sites[i] + '.clients', 2, 2, function (name, value, depth) {
                    //this.log.debug('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                    if (typeof (value) === 'object' && value !== null) {
                        // continue the traversal of the object with depth 2
                        traverse(value, name + '.' + value.mac, 1, 0, function (name, value, depth) {
                            //this.log.debug('_(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                            if (depth == 1) {
                                this.localCreateChannel(name, typeof (value.hostname) !== 'undefined' ? value.hostname : '');
                            } else {
                                this.localCreateState(name, value);
                            }
                        }.bind(this));
                    } else {
                        this.localCreateState(name, value);
                    }
                }.bind(this));
            }
        };

        /**
         * Function to fetch access devices
         * @param {Object} sites 
         */
        const getAccessDevices = async (sites) => {
            return new Promise((resolve, reject) => {
                controller.getAccessDevices(sites, (err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        this.log.debug('getAccessDevices: ' + data[0].length);
                        //this.log.debug(JSON.stringify(data));

                        if (updateDevices) {
                            if (run_legacy) {
                                processAccessDeviceInfoLegacy(sites, data);
                            } else {
                                processAccessDeviceInfo(sites, data);
                            }
                        }

                        resolve(data);
                    }
                });
            });
        };

        /**
         * Function that receives the client device info as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processAccessDeviceInfo = async (sites, data) => {
            const objects = require('./lib/objects_getAccessDevices.json');

            for (let x = 0; x < sites.length; x++) {
                const site = sites[x];
                const siteData = data[x];

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Function that receives the access device info as a JSON data array
         * and parses through it to create all channels+states
         * @param {Object} sites 
         * @param {Object} accessDevices 
         */
        const processAccessDeviceInfoLegacy = (sites, accessDevices) => {
            // lets store some site information
            for (let i = 0; i < sites.length; i++) {
                // traverse the json with depth 3..4 only
                traverse(accessDevices[i], sites[i] + '.devices', 2, 2, function (name, value, depth) {
                    //this.log.debug('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                    if (typeof (value) === 'object' && value !== null) {
                        // continue the traversal of the object with depth 2
                        traverse(value, name + '.' + value.mac, 1, 2, function (name, value, depth) {
                            //this.log.debug('_(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                            if (depth === 1) {
                                this.localCreateChannel(name, value.model + ' - ' + value.serial);
                            } else if (typeof (value) === 'object' && value !== null) {
                                traverse(value, name, 1, 2, function (name, value, depth) {
                                    //this.log.debug('__(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value) + ' is_null: ' + (value === null));

                                    if (depth === 1) {
                                        this.localCreateChannel(name, name);
                                    } else if (typeof (value) === 'object' && value !== null) {
                                        traverse(value, name + '.' + value.name, 1, 0, function (name, value, depth) {
                                            //this.log.debug('___(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                                            if (depth === 1) {
                                                this.localCreateChannel(name, name);
                                            } else {
                                                this.localCreateState(name, value);
                                            }
                                        }.bind(this));
                                    } else {
                                        this.localCreateState(name, value);
                                    }
                                }.bind(this));
                            } else {
                                this.localCreateState(name, value);
                            }
                        }.bind(this));
                    } else {
                        this.localCreateState(name, value);
                    }
                }.bind(this));
            }
        };

        /**
         * Function to fetch network configuration
         * @param {Object} sites 
         */
        const getNetworkConf = async (sites) => {
            return new Promise((resolve, reject) => {
                controller.getNetworkConf(sites, (err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        this.log.debug('getNetworkConf: ' + data[0].length);
                        //this.log.debug(JSON.stringify(data));

                        if (updateNetworks) {
                            if (run_legacy) {
                                processNetworkConfLegacy(sites, data);
                            } else {
                                processNetworkConf(sites, data);
                            }
                        }

                        resolve(data);
                    }
                });
            });
        };

        /**
         * Function that receives the client device info as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processNetworkConf = async (sites, data) => {
            const objects = require('./lib/objects_getNetworkConf.json');

            for (let x = 0; x < sites.length; x++) {
                const site = sites[x];
                const siteData = data[x];

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Function that receives the client device info as a JSON data array
         * and parses through it to create all channels+states
         * @param {Object} sites 
         * @param {Object} clientDevices 
         */
        const processNetworkConfLegacy = (sites, clientDevices) => {
            // lets store some site information
            for (let i = 0; i < sites.length; i++) {
                // traverse the json with depth 3..4 only
                traverse(clientDevices[i], sites[i] + '.networks', 2, 2, function (name, value, depth) {
                    //this.log.debug('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                    if (typeof (value) === 'object' && value !== null) {
                        // continue the traversal of the object with depth 2
                        traverse(value, name + '.' + value.name, 1, 0, function (name, value, depth) {
                            //this.log.debug('_(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                            if (Array.isArray(value) === false && typeof (value) === 'object' && value !== null) {
                                this.localCreateChannel(name, value.name);
                            } else {
                                this.localCreateState(name, value);
                            }
                        }.bind(this));
                    } else {
                        this.localCreateState(name, value);
                    }
                }.bind(this));
            }
        };

        /**
         * Function to fetch access devices
         * @param {Object} sites 
         */
        const getVouchers = async (sites) => {
            return new Promise((resolve, reject) => {
                controller.getVouchers(sites, (err, data) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        this.log.debug('getVouchers: ' + data[0].length);
                        //this.log.debug(JSON.stringify(data));

                        if (updateVouchers) {
                            if (run_legacy === false) {
                                processVouchers(sites, data);
                            }
                        }

                        resolve(data);
                    }
                });
            });
        };

        /**
         * Function that receives the client device info as a JSON data array
         * @param {Object} sites 
         * @param {Object} data 
         */
        const processVouchers = async (sites, data) => {
            const objects = require('./lib/objects_getVouchers.json');

            for (let x = 0; x < sites.length; x++) {
                const site = sites[x];
                const siteData = data[x];

                await applyJsonLogic(siteData, objects, site);
            }
        };

        /**
         * Helper functions to parse our JSON-based result data in
         * a recursive/traversal fashion.
         * @param {*} x 
         * @param {*} level
         * @param {*} mindepth
         * @param {*} maxdepth
         * @param {*} callback
         * @param {*} depth
         */
        const traverse = (x, level, mindepth, maxdepth, callback, depth) => {
            if (typeof (depth) === 'undefined') {
                depth = 0;
            }

            depth++;
            if (typeof (maxdepth) !== 'undefined' && maxdepth !== 0 && depth > maxdepth) {
                return;
            }

            if (Array.isArray(x)) {
                traverseArray(x, level, mindepth, maxdepth, callback, depth);
            } else if ((typeof (x) === 'object') && (x !== null)) {
                traverseObject(x, level, mindepth, maxdepth, callback, depth);
            } else if (mindepth <= depth && callback(level, x, depth) === false) {
                return;
            }
        };

        /**
         * 
         * @param {*} arr 
         * @param {*} level 
         * @param {*} mindepth 
         * @param {*} maxdepth 
         * @param {*} callback 
         * @param {*} depth 
         */
        const traverseArray = (arr, level, mindepth, maxdepth, callback, depth) => {
            if (mindepth <= depth && callback(level, arr, depth) === false) {
                return;
            }

            arr.every(function (x) {
                if ((typeof (x) === 'object')) {
                    traverse(x, level, mindepth, maxdepth, callback, depth);
                } else {
                    return false;
                }

                return true;
            }.bind(this));
        };

        /**
         * 
         * @param {*} obj 
         * @param {*} level 
         * @param {*} mindepth 
         * @param {*} maxdepth 
         * @param {*} callback 
         * @param {*} depth 
         */
        const traverseObject = (obj, level, mindepth, maxdepth, callback, depth) => {
            if (mindepth <= depth && callback(level, obj, depth) === false) {
                return;
            }

            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    traverse(obj[key], level + '.' + key, mindepth, maxdepth, callback, depth);
                }
            }
        };

        /**
         * Function to organize setState() calls that we are first checking if
         * the value is really changed and only then actually call setState()
         * to let others listen for changes
         * @param {*} stateArray
         */
        const processStateChanges = async (stateArray) => {
            if (!stateArray || stateArray.length === 0) {
                // clear the array
                this.setStateArray = [];
            } else {
                for (const newState of this.setStateArray) {
                    const oldState = await this.getStateAsync(newState.name);

                    if (oldState === null || newState.val != oldState.val) {
                        //this.log.debug('changing state ' + newState.name + ' : ' + newState.val);
                        await this.setStateAsync(newState.name, { ack: true, val: newState.val });
                    }
                }

                this.setStateArray = [];
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
                }

                // Process has_many
                if (Object.prototype.hasOwnProperty.call(objects[key].logic, 'has')) {
                    const hasKey = objects[key].logic.has_key;
                    const has = objects[key].logic.has;

                    if (Object.prototype.hasOwnProperty.call(data, hasKey)) {
                        if (Array.isArray(data[hasKey])) {
                            data[hasKey].forEach(async element => {
                                await applyJsonLogic(element, has, obj._id);
                            });
                        } else {
                            await applyJsonLogic(data[hasKey], has, obj._id);
                        }
                    } else {
                        data.forEach(async element => {
                            await applyJsonLogic(element, has, obj._id);
                        });
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
        this.log.debug('controller = ' + controllerIp + ':' + controllerPort);
        this.log.debug('updateInterval = ' + updateInterval);

        this.log.debug('Blacklisted clients: ' + JSON.stringify(blacklistedClients));
        this.log.debug('Blacklisted devices: ' + JSON.stringify(blacklistedDevices));
        this.log.debug('Blacklisted health: ' + JSON.stringify(blacklistedHealth));
        this.log.debug('Blacklisted networks: ' + JSON.stringify(blacklistedNetworks));

        const controller = new unifi.Controller(controllerIp, controllerPort);

        login(controllerUsername, controllerPassword)
            .then(async () => {
                this.log.debug('Login successful');

                const sites = await getSitesStats();
                await getSiteSysinfo(sites);
                await getClientDevices(sites);
                await getAccessDevices(sites);
                await getNetworkConf(sites);
                await getVouchers(sites);

                // finalize, logout and finish
                controller.logout();

                // process all schedule state changes
                processStateChanges(this.setStateArray);

                await this.setStateAsync('info.connection', { ack: true, val: true });
                this.log.info('Update done');

                return Promise.resolve(true);
            })
            .catch(async (err) => {
                await this.setStateAsync('info.connection', { ack: true, val: false });
                this.log.error(err.name + ': ' + err.message);

                return;
            });

        // schedule a new execution of updateUnifiData in X seconds
        this.queryTimeout = setTimeout(function () {
            this.updateUnifiData();
        }.bind(this), updateInterval * 1000);
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
