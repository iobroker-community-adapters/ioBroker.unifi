/**
 *
 * UniFi ioBroker Adapter
 *
 * Adapter to communicate with a UniFi-Controller instance
 * dealing with UniFi-WiFi-Devices
 *
 */

/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const adapterName = require('./package.json').name.split('.').pop();

// get unifi class
const unifi = require('node-unifi');

let queryTimeout;
let adapter;
function startAdapter(options) {
    options = options || {};
    Object.assign(options, {name: adapterName});
    adapter = new utils.Adapter(options);
    // is called when adapter shuts down - callback has to be called under any circumstances!
    adapter.on('unload', (callback) => {
        try {

            // clear the timeout
            queryTimeout && clearTimeout(queryTimeout);
            queryTimeout = null;

            adapter.log.info('cleaned everything up...');
            callback();
        } catch (e) {
            callback();
        }
    });

    // is called if a subscribed state changes
    adapter.on('stateChange', (id, state) => {
        // you can use the ack flag to detect if it is status (true) or command (false)
        // Warning, state can be null if it was deleted
        if (state && !state.ack) {
            adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));
        }
    });

    // Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
    adapter.on('message', obj =>
        processMessage(obj));

    // is called when databases are connected and adapter received configuration.
    // start here!
    adapter.on('ready', () =>
        main());

    return adapter;
}

function main() {
    adapter.getForeignObject('system.adapter.' + adapter.namespace, (err, obj) => {
        if (!err && obj && (obj.common.mode !== 'daemon')) {
            obj.common.mode = 'daemon';

            if (obj.common.schedule) {
                delete (obj.common.schedule);
            }

            adapter.setForeignObject(obj._id, obj);
        }
    });

    // subscribe to all state changes
    adapter.subscribeStates('*');

    updateUniFiData();
}

function processMessage(obj) {
    if (!obj) {
        return;
    }

    adapter.log.info('Message received = ' + JSON.stringify(obj.message));

    let updateUniFi = false;
    if (typeof obj === 'object' && obj.message) {
        if (obj.command === 'notify') {
            adapter.log.info('got notify');
        } else {
            updateUniFi = true;
        }
    }

    if (updateUniFi) {
        queryTimeout && clearTimeout(queryTimeout);
        queryTimeout = null;

        updateUniFiData();
    }
}

/**
 * Function to process a bunch of HTTP requests sequentially
 * using 'request' and 'async'
 */

/*
function processRequests(requestList) {
  async.eachSeries(requestList, function(item, cb) {
    if(item.json) {
      request.post(item, function(err, res, body) {
        if(item.callback(err, res, body) === false) {
          cb("ERROR!!!!");
        }
        else {
          cb(err);
        }
      });
    } else {
      request.get(item, function(err, res, body) {
        if(item.callback(err, res, body) === false) {
          cb("ERROR2!!!!");
        }
        else {
          cb(err);
        }
      });
    }
  }, function(err) {
    adapter.log.info('DONE: ' + JSON.stringify(err));
  });
}
*/

/**
 * Helper functions to parse our JSON-based result data in
 * a recursive/traversal fashion.
 */
function traverse(x, level, mindepth, maxdepth, cb, depth) {
    if (typeof depth === 'undefined') {
        depth = 0;
    }

    depth++;
    
    if (typeof maxdepth !== 'undefined' && maxdepth !== 0 && depth > maxdepth) {
        return;
    }

    if (Array.isArray(x)) {
        traverseArray(x, level, mindepth, maxdepth, cb, depth);
    } else if (typeof x === 'object' && x !== null) {
        traverseObject(x, level, mindepth, maxdepth, cb, depth);
    } else if (mindepth <= depth && cb(level, x, depth) === false) { // BF: very strange construction?
        return;
    }     
}

function traverseArray(arr, level, mindepth, maxdepth, cb, depth) {
    if (mindepth <= depth && cb(level, arr, depth) === false) {
        return;
    }

    arr.every((x, i) => {
        if (typeof x === 'object') {
            traverse(x, level, mindepth, maxdepth, cb, depth);   
        } else {
            return false;
        }

        return true;
    });
}

function traverseObject(obj, level, mindepth, maxdepth, cb, depth) {
    if (mindepth <= depth && cb(level, obj, depth) === false) {
        return;
    }

    Object.keys(obj).forEach(key =>
        traverse(obj[key], level + '.' + key, mindepth, maxdepth, cb, depth));    
}

/**
 * Function to organize setState() calls that we are first checking if
 * the value is really changed and only then actually call setState()
 * to let others listen for changes
 */
let setStateArray = [];

function processStateChanges(stateArray, callback) {
    if (!stateArray || stateArray.length === 0) {
        typeof callback === 'function' &&callback();

        // clear the array
        setStateArray = [];
    } else {
        const newState = setStateArray.shift();
        adapter.getState(newState.name, (err, oldState) => {
            if (oldState === null || newState.val !== oldState.val) {
                //adapter.log.info('changing state ' + newState.name + ' : ' + newState.val);
                adapter.setState(newState.name, {ack: true, val: newState.val}, () =>
                    setTimeout(processStateChanges, 0, setStateArray, callback));
            } else {
                setTimeout(processStateChanges, 0, setStateArray, callback);
            }
        });
    }
}

/**
 * Function to create a state and set its value
 * only if it hasn't been set to this value before
 */
function createState(name, value, desc) {

    if (typeof desc === 'undefined') {
        desc = name;
    }

    if (Array.isArray(value)) {
        value = value.toString();
    }

    adapter.setObjectNotExists(name, {
        type: 'state',
        common: {
            name: desc,
            type: typeof value,
            read: true,
            write: false
        },
        native: {id: name}
    });

    if (typeof value !== 'undefined')
        setStateArray.push({name, val: value});
}

/**
 * Function to create a channel
 */
function createChannel(name, desc) {

    if (typeof desc === 'undefined') {
        desc = name;
    }

    adapter.setObjectNotExists(name, {
        type: 'channel',
        common: {name: desc},
        native: {}
    });
}

/**
 * Function that receives the site info as a JSON data array
 * and parses through it to create all channels+states
 */
function processSiteInfo(site_data) {

    // lets store some site information
    for (let i = 0; i < site_data.length; i++) {
        // traverse the json with depth 0..2 only
        traverse(site_data[i], site_data[i].name, 0, 2, (name, value, depth) => {
            //adapter.log.info('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

            if (typeof value === 'object') {
                if (depth === 1) {
                    createChannel(name, 'Site ' + value.desc);
                } else {// depth == 2
                    // continue the traversal of the object with depth 2
                    traverse(value, name, 2, 2, (name, value, depth) => {
                        //adapter.log.info('_(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));
                        createChannel(name);

                        // walk through all sub values on a flat level starting with the
                        // subsystem tree.
                        traverse(value, name + '.' + value.subsystem, 0, 0, (name, value, depth) => {
                            //adapter.log.info('__(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));
                            if (typeof value === 'object') {
                                createChannel(name, 'Subsystem ' + value.subsystem);
                            } else {
                                createState(name, value);
                            }
                        });
                    });
                }
            } else {
                createState(name, value);
            }
        });
    }
}

/**
 * Function that receives the client device info as a JSON data array
 * and parses through it to create all channels+states
 */
function processClientDeviceInfo(sites, clientDevices) {
    // lets store some site information
    for (let i = 0; i < sites.length; i++) {
        // traverse the json with depth 3..4 only
        traverse(clientDevices[i], sites[i] + '.clients', 2, 2, (name, value, depth) => {
            //adapter.log.info('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

            if (typeof value === 'object') {
                // continue the traversal of the object with depth 2
                traverse(value, name + '.' + value.mac, 1, 0, (name, value, depth) => {
                    //adapter.log.info('_(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                    if (depth === 1) {
                        createChannel(name, typeof (value.hostname) !== 'undefined' ? value.hostname : '');
                    } else {
                        createState(name, value);
                    }
                });
            } else {
                createState(name, value);
            }
        });
    }
}

/**
 * Function that receives the access device info as a JSON data array
 * and parses through it to create all channels+states
 */
function processAccessDeviceInfo(sites, accessDevices) {

    // lets store some site information
    for (let i = 0; i < sites.length; i++) {
        // traverse the json with depth 3..4 only
        traverse(accessDevices[i], sites[i] + '.devices', 2, 2, (name, value, depth) => {
            //adapter.log.info('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

            if (typeof value === 'object' && value !== null) {
                // continue the traversal of the object with depth 2
                traverse(value, name + '.' + value.mac, 1, 2, (name, value, depth) => {
                    //adapter.log.info('_(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                    if (depth === 1) {
                        createChannel(name, value.model + ' - ' + value.serial);
                    } else if (typeof value === 'object' && value !== null) {
                        traverse(value, name, 1, 2, (name, value, depth) => {
                            //adapter.log.info('__(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value) + ' is_null: ' + (value === null));

                            if (depth === 1) {
                                createChannel(name, name);
                            } else if (typeof value === 'object' && value !== null) {
                                traverse(value, name + '.' + value.name, 1, 0, (name, value, depth) => {
                                    //adapter.log.info('___(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value));

                                    if (depth === 1) {
                                        createChannel(name, name);
                                    } else {
                                        createState(name, value);
                                    }
                                });
                            } else {
                                createState(name, value);
                            }
                        });
                    } else {
                        createState(name, value);
                    }
                });
            } else {
                createState(name, value);
            }
        });
    }
}

/**
 * Function that receives the site sysinfo as a JSON data array
 * and parses through it to create all channels+states
 */
function processSiteSysInfo(sites, sysinfo) {

    // lets store some site information
    for (let i = 0; i < sysinfo.length; i++) {
        // traverse the json with depth 0..2 only
        traverse(sysinfo[i], sites[i] + '.sysinfo', 2, 4, (name, value, depth) => {
            //adapter.log.info('(' + depth + '): ' + name + ' = ' + value + ' type: ' + typeof(value) + ' array: ' + Array.isArray(value));

            if (typeof value === 'object') {
                if (depth === 2) {
                    createChannel(name, 'Site Sysinfo');
                }                 
                else if (depth === 3) {
                    createChannel(name);
                }                 
                else {
                    if (typeof (value.key) !== 'undefined') {
                        // continue the traversal of the object with depth 2
                        traverse(value, name + '.' + value.key, 1, 2, (name, value, depth) => {
                            //adapter.log.info('_(' + depth + '): ' + name + ' = ' + value + ' type2: ' + typeof(value) + ' array: ' + Array.isArray(value));

                            if (Array.isArray(value) === false && typeof value === 'object') {
                                createChannel(name, value.name);
                            } else {
                                createState(name, value);
                            }
                        });
                    } else {
                        createState(name, value);
                    } 
                }
            } else {
                createState(name, value);
            }
        });
    }
}

function updateUniFiData() {

    adapter.log.info('Starting UniFi-Controller query');

    const update_interval     = parseInt(adapter.config.update_interval, 10) || 60;
    const controller_ip       = adapter.config.controller_ip || '127.0.0.1';
    const controller_port     = adapter.config.controller_port || 8443;
    const controller_username = adapter.config.controller_username || 'admin';
    const controller_password = adapter.config.controller_password || '';

    adapter.log.info('update_interval = ' + update_interval);
    adapter.log.info('controller = ' + controller_ip + ':' + controller_port);

    const controller = new unifi.Controller(controller_ip, controller_port);

    //////////////////////////////
    // LOGIN
    controller.login(controller_username, controller_password, (err) => {
        if (err) {
            adapter.log.info('ERROR: ' + err);
            return;
        }

        //////////////////////////////
        // GET SITE STATS
        controller.getSitesStats((err, site_data) => {
            const sites = site_data.map(s => s.name);

            adapter.log.info('getSitesStats: ' + sites);
            //adapter.log.info(JSON.stringify(site_data));

            processSiteInfo(site_data);

            //////////////////////////////
            // GET SITE SYSINFO
            controller.getSiteSysinfo(sites, (err, sysinfo) => {
                adapter.log.info('getSiteSysinfo: ' + sysinfo.length);
                //adapter.log.info(JSON.stringify(sysinfo));

                processSiteSysInfo(sites, sysinfo);

                //////////////////////////////
                // GET CLIENT DEVICES
                controller.getClientDevices(sites, (err, client_data) => {
                    adapter.log.info('getClientDevices: ' + client_data[0].length);
                    //adapter.log.info(JSON.stringify(client_data));

                    processClientDeviceInfo(sites, client_data);

                    //////////////////////////////
                    // GET ACCESS DEVICES
                    controller.getAccessDevices(sites, (err, devices_data) => {
                        adapter.log.info('getAccessDevices: ' + devices_data[0].length);
                        //adapter.log.info(JSON.stringify(devices_data));

                        processAccessDeviceInfo(sites, devices_data);

                        //////////////////////////////
                        // FINALIZE

                        // finalize, logout and finish
                        controller.logout();

                        // process all schedule state changes
                        processStateChanges(setStateArray);

                        // schedule a new execution of updateUniFiData in X seconds
                        queryTimeout = setTimeout(() => updateUniFiData(), update_interval * 1000);
                    });
                });
            });
        });
    });

    //const endpoints = [ unifi_login(controller_username, controller_password),
    //                  unifi_stat_sites(getSites),
    //                  //unifi_stat_sysinfo(sites, getSiteSysinfo),
    //                  //unifi_list_stations(site),
    //                  unifi_logout() ]

    //processRequests(endpoints);

    //queryTimeout = setTimeout(updateUniFiData, update_interval * 1000);
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
