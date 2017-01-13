/**
 *
 * UniFi ioBroker Adapter
 *
 * Adapter to communicate with a UniFi-Controller instance
 * dealing with UniFi-WiFi-Devices
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
var utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.unifi.0
var adapter = utils.adapter('unifi');

// define a timeout variable so that
// we can check the controller in regular intervals
var queryTimeout;

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
  try {

    // clear the timeout
    if(queryTimeout)
      clearTimeout(queryTimeout);

    adapter.log.info('cleaned everything up...');
    callback();
  } catch (e) {
    callback();
  }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        adapter.log.info('ack is not set!');
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
  processMessage(obj);

});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

function main() {

  adapter.getForeignObject('system.adapter.' + adapter.namespace, function (err, obj) {
     if (!err && obj && (obj.common.mode !== 'daemon')) {
          obj.common.mode = 'daemon';
          if (obj.common.schedule) delete(obj.common.schedule);
          adapter.setForeignObject(obj._id, obj);
     }
  });

  // subscribe to all state changes
  adapter.subscribeStates('*');

  updateUniFiData();
}

function processMessage(obj) {
  if(!obj)
    return;

  adapter.log.info('Message received = ' + JSON.stringify(message));

  var updateUniFi = false;
  if(typeof obj == 'object' && obj.message) {
    if(obj.command == 'notify') {
      adapter.log.info('got notify');
    }
    else
      updateUniFi = true;
  }

  if(updateUniFi) {
    if(queryTimeout)
      clearTimeout(queryTimeout);

    updateUniFiData();
  }
}

var async = require('async');
var request = require('request').defaults({jar: true, json: true});
var baseurl = 'https://127.0.0.1:8443';
var site = 'default';

/**
 * Login to UniFi Controller
 * -------------------------
 *
 * required parameter <username> = username for UniFi-Controller login
 * required parameter <password> = password for UniFi-Controller login
 *
 */
function unifi_login(username, password) {
  return { url: baseurl + '/api/login', 
           json: { username: username, password: password},
           callback: function(err, res, body) {
             if(!err && body && res.statusCode >= 200 && res.statusCode < 400 && body.meta.rc == "ok") {
               adapter.log.info("LOGIN DONE");
               return true;
             } else {
               return false;
             }
           }
         };
}

/**
 * Logout from UniFi Controller
 * ----------------------------
 */
function unifi_logout() {
  return { url: baseurl + '/logout', 
           callback: function(err, res, body) {
             if(!err && body && res.statusCode >= 200 && res.statusCode < 400) {
               adapter.log.info("LOGOUT DONE");
               return true;
             } else {
               return false;
             }
           }
         };
}

/**
 * Authorize a client device
 * -------------------------
 *
 * optional parameter <site>    = the site name to query
 * required parameter <mac>     = client MAC address
 * required parameter <minutes> = minutes (from now) until authorization expires
 * optional parameter <up>      = upload speed limit in kbps
 * optional parameter <down>    = download speed limit in kbps
 * optional parameter <MBytes>  = data transfer limit in MB
 * optional parameter <ap_mac>  = AP MAC address to which client is connected, should result in faster authorization
 */
function unifi_authorize_guest(site, mac, minutes, up, down, mbytes, ap_mac) {
  site = typeof site !== 'undefined' ? site : "default";
  
  var json = { cmd: 'authorize-guest', mac: mac.toLowerCase(), minutes: minutes };
  if(typeof up !== 'undefined')     json['up'] = up;
  if(typeof down !== 'undefined')   json['down'] = down;
  if(typeof mbytes !== 'undefined') json['bytes'] = mbytes;
  if(typeof ap_mac !== 'undefined') json['ap_mac'] = ap_mac;

  return { url: baseurl + '/api/s/' + site + '/cmd/stamgr',
           json: json,
           callback: function(err, res, body) {
             if(!err && body && res.statusCode >= 200 && res.statusCode < 400 && body.meta.rc == "ok") {
               adapter.log.info(JSON.stringify(body));
               adapter.log.info("AUTHORIZATION DONE");
               return true;
             } else {
               return false;
             }
           }
         };
}

/**
 * Unauthorize a client device
 * ---------------------------
 *
 * optional parameter <site>    = the site name to query
 * required parameter <mac>     = client MAC address
 */
function unifi_authorize_guest(site, mac) {
  site = typeof site !== 'undefined' ? site : "default";
  
  var json = { cmd: 'unauthorize-guest', mac: mac.toLowerCase() };

  return { url: baseurl + '/api/s/' + site + '/cmd/stamgr',
           json: json,
           callback: function(err, res, body) {
             if(!err && body && res.statusCode >= 200 && res.statusCode < 400 && body.meta.rc == "ok") {
               adapter.log.info(JSON.stringify(body));
               adapter.log.info("UNAUTHORIZATION DONE");
               return true;
             } else {
               return false;
             }
           }
         };
}

/**
 * Reconnect a client device
 * -------------------------
 *
 * optional parameter <site>    = the site name to query
 * required parameter <mac>     = client MAC address
 */
function unifi_reconnect_sta(site, mac) {
  site = typeof site !== 'undefined' ? site : "default";
  
  var json = { cmd: 'kick-sta', mac: mac.toLowerCase() };

  return { url: baseurl + '/api/s/' + site + '/cmd/stamgr',
           json: json,
           callback: function(err, res, body) {
             if(!err && body && res.statusCode >= 200 && res.statusCode < 400 && body.meta.rc == "ok") {
               adapter.log.info(JSON.stringify(body));
               adapter.log.info("RECONNECTED DEVICE");
               return true;
             } else {
               return false;
             }
           }
         };
}

/**
 * Block a client device
 * ---------------------
 *
 * optional parameter <site>    = the site name to query
 * required parameter <mac>     = client MAC address
 */
function unifi_block_sta(site, mac) {
  site = typeof site !== 'undefined' ? site : "default";
  
  var json = { cmd: 'block-sta', mac: mac.toLowerCase() };

  return { url: baseurl + '/api/s/' + site + '/cmd/stamgr',
           json: json,
           callback: function(err, res, body) {
             if(!err && body && res.statusCode >= 200 && res.statusCode < 400 && body.meta.rc == "ok") {
               adapter.log.info(JSON.stringify(body));
               adapter.log.info("BLOCKED DEVICE");
               return true;
             } else {
               return false;
             }
           }
         };
}

/**
 * Unblock a client device
 * -----------------------
 *
 * optional parameter <site>    = the site name to query
 * required parameter <mac>     = client MAC address
 */
function unifi_block_sta(site, mac) {
  site = typeof site !== 'undefined' ? site : "default";
  
  var json = { cmd: 'unblock-sta', mac: mac.toLowerCase() };

  return { url: baseurl + '/api/s/' + site + '/cmd/stamgr',
           json: json,
           callback: function(err, res, body) {
             if(!err && body && res.statusCode >= 200 && res.statusCode < 400 && body.meta.rc == "ok") {
               adapter.log.info(JSON.stringify(body));
               adapter.log.info("UNBLOCKED DEVICE");
               return true;
             } else {
               return false;
             }
           }
         };
}

/**
 * List online client device(s)
 * ----------------------------
 *
 * returns an array of online client device objects, or in case of a single device request, returns a single client device object
 * optional parameter <site> = the site name to query
 * optional parameter <client_mac> = the MAC address of a single online client device for which the call must be made
 *
 */
function unifi_list_stations(site, client_mac) {
  site = typeof site !== 'undefined' ? site : "default";
  client_mac = typeof client_mac !== 'undefined' ? client_mac : "";

  return { url: baseurl + '/api/s/' + site + '/stat/sta/' + client_mac, 
           callback: function(err, res, body) {
             if(!err && body && res.statusCode >= 200 && res.statusCode < 400 && body.meta.rc == "ok") {
               adapter.log.info(JSON.stringify(body));
               return true;
             } else {
               return false;
             }
           }
         };
}

/**
 * List sites
 * ----------
 *
 * returns a list sites hosted on this controller with some details
 *
 */
function unifi_list_sites() {
  return { url: baseurl + '/api/self/sites', 
           callback: function(err, res, body) {
             if(!err && body && res.statusCode >= 200 && res.statusCode < 400 && body.meta.rc == "ok") {
               adapter.log.info(JSON.stringify(body));
               return true;
             } else {
               return false;
             }
           }
         };
}

/**
 * List sites stats
 * ----------------
 *
 * returns statistics for all sites hosted on this controller
 *
 * NOTE: this endpoint was introduced with controller version 5.2.9
 */
function unifi_stat_sites() {
  return { url: baseurl + '/api/stat/sites', 
           callback: function(err, res, body) {
             if(!err && body && res.statusCode >= 200 && res.statusCode < 400 && body.meta.rc == "ok") {
               adapter.log.info(JSON.stringify(body));
               return true;
             } else {
               return false;
             }
           }
         };
}

/**
 * List sysinfo
 * ------------
 *
 * returns an array of known sysinfo data
 *
 * optional parameter <site> = the site name to query
 */
function unifi_stat_sysinfo(site) {
  site = typeof site !== 'undefined' ? site : "default";

  return { url: baseurl + '/api/s/' + site + '/stat/sysinfo', 
           callback: function(err, res, body) {
             if(!err && body && res.statusCode >= 200 && res.statusCode < 400 && body.meta.rc == "ok") {
               adapter.log.info(JSON.stringify(body));
               return true;
             } else {
               return false;
             }
           }
         };
}

function updateUniFiData() {

  adapter.log.info('Starting UniFi-Controller query');

  var update_interval = parseInt(adapter.config.update_interval, 10) || 60;
  var controller_ip = adapter.config.controller_ip || "127.0.0.1";
  var controller_port = adapter.config.controller_port || 8443;
  var controller_username = adapter.config.controller_username || "admin";
  var controller_password = adapter.config.controller_password || "";

  adapter.log.info('update_interval = ' + update_interval);
  adapter.log.info('controller = ' + controller_ip + ':' + controller_port);

  // ignore self-signed certificates
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  // set the baseurl
  baseurl = 'https://' + controller_ip + ':' + controller_port;

  var endpoints = [ unifi_login(controller_username, controller_password), 
                    unifi_list_sites(),
                    unifi_stat_sites(),
                    unifi_stat_sysinfo(),
                    unifi_list_stations(site),
                    unifi_logout() ]

  async.eachSeries(endpoints, function(item, cb) {
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

  queryTimeout = setTimeout(updateUniFiData, update_interval * 1000);
}
