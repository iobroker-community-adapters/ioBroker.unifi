'use strict';

/*
 * Created with @iobroker/create-adapter v1.17.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here
const unifi = require('node-unifi');

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
        this.log.info('Update started');

        // Load configuration
        const update_interval = parseInt(this.config.update_interval, 10) || 60;
        const controller_ip = this.config.controller_ip || '127.0.0.1';
        const controller_port = this.config.controller_port || 8443;
        const controller_username = this.config.controller_username || 'admin';
        const controller_password = this.config.controller_password || '';

        /**
         * Function to log into the UniFi controller
         * @param {string} controller_username 
         * @param {string} controller_password 
         */
        const login = async (controller_username, controller_password) => {
            return new Promise((resolve, reject) => {
                controller.login(controller_username, controller_password, (err) => {
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
    
                        this.log.info('getSitesStats: ' + sites);
                        //this.log.debug(JSON.stringify(data));
    
                        processSiteInfo(data);
    
                        resolve(sites);
                    }
                });
            });
        };

        /**
        * Function that receives the site info as a JSON data array
        * and parses through it to create all channels+states
        * @param {Object} siteInfo 
        */
        const processSiteInfo = (siteInfo) => {
            // lets store some site information
            for (let i = 0; i < siteInfo.length; i++) {
                // traverse the json with depth 0..2 only
                traverse(siteInfo[i], siteInfo[i].name, 0, 2, function (name, value, depth) {
                    //this.log.debug('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                    if (typeof (value) === 'object') {
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
                                    if (typeof (value) === 'object') {
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
                        this.log.info('getSiteSysinfo: ' + data.length);
                        //this.log.debug(JSON.stringify(data));
    
                        processSiteSysInfo(sites, data);
    
                        resolve(data);
                    }                
                });
            });
        };

        /**
         * Function that receives the site sysinfo as a JSON data array
         * and parses through it to create all channels+states
         * @param {Object} sites 
         * @param {Object} siteSysinfo 
         */
        const processSiteSysInfo = (sites, siteSysinfo) => {
            // lets store some site information
            for (let i = 0; i < siteSysinfo.length; i++) {
                // traverse the json with depth 0..2 only
                traverse(siteSysinfo[i], sites[i] + '.sysinfo', 2, 4, function (name, value, depth) {
                    //this.log.debug('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value) + ' array: ' + Array.isArray(value));

                    if (typeof (value) === 'object') {
                        if (depth == 2) {
                            this.localCreateChannel(name, 'Site Sysinfo');
                        } else if (depth == 3) {
                            this.localCreateChannel(name);
                        } else {
                            if (typeof (value.key) !== 'undefined') {
                                // continue the traversal of the object with depth 2
                                traverse(value, name + '.' + value.key, 1, 2, function (name, value, depth) {
                                    //this.log.debug('_(' + depth + '): ' + name + ' = ' + value + ' type2: ' + typeof(value) + ' array: ' + Array.isArray(value));

                                    if (Array.isArray(value) === false && typeof (value) === 'object') {
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
                        this.log.info('getClientDevices: ' + data[0].length);
                        //this.log.debug(JSON.stringify(data));
    
                        processClientDeviceInfo(sites, data);
    
                        resolve(data);
                    }                
                });
            });
        };

        /**
         * Function that receives the client device info as a JSON data array
         * and parses through it to create all channels+states
         * @param {Object} sites 
         * @param {Object} clientDevices 
         */
        const processClientDeviceInfo = (sites, clientDevices) => {
            // lets store some site information
            for (let i = 0; i < sites.length; i++) {
                // traverse the json with depth 3..4 only
                traverse(clientDevices[i], sites[i] + '.clients', 2, 2, function (name, value, depth) {
                    //this.log.debug('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                    if (typeof (value) === 'object') {
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
                        this.log.info('getAccessDevices: ' + data[0].length);
                        //this.log.debug(JSON.stringify(data));
    
                        processAccessDeviceInfo(sites, data);
    
                        resolve(data);
                    }                
                });
            });
        };

        /**
         * Function that receives the access device info as a JSON data array
         * and parses through it to create all channels+states
         * @param {Object} sites 
         * @param {Object} accessDevices 
         */
        const processAccessDeviceInfo = (sites, accessDevices) => {
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


        /********************
         * LET'S GO
         *******************/
        this.log.info('controller = ' + controller_ip + ':' + controller_port);
        this.log.info('update_interval = ' + update_interval);

        const controller = new unifi.Controller(controller_ip, controller_port);

        login(controller_username, controller_password)
            .then(async () => {
                this.log.info('Login successful');

                const sites = await getSitesStats();
                await getSiteSysinfo(sites);
                await getClientDevices(sites);
                await getAccessDevices(sites);

                // finalize, logout and finish
                controller.logout();

                // process all schedule state changes
                processStateChanges(this.setStateArray);

                this.log.info('Update done');

                return Promise.resolve(true);
            })
            .catch((err) => {
                this.log.error(err.name + ': ' + err.message);
                return;
            });
        
        // schedule a new execution of updateUnifiData in X seconds
        this.queryTimeout = setTimeout(function () {
            this.updateUnifiData();
        }.bind(this), update_interval * 1000);
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
