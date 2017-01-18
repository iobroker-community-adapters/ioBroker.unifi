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
var utils = require(__dirname + '/lib/utils'); // Get common adapter utils

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

/**
 * Function to process a bunch of HTTP requests sequentially
 * using 'request' and 'async'
 */
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

function updateUniFiData() {

  adapter.log.info('Starting UniFi-Controller query');

  var update_interval = parseInt(adapter.config.update_interval, 10) || 60;
  var controller_ip = adapter.config.controller_ip || "127.0.0.1";
  var controller_port = adapter.config.controller_port || 8443;
  var controller_username = adapter.config.controller_username || "admin";
  var controller_password = adapter.config.controller_password || "";

  adapter.log.info('update_interval = ' + update_interval);
  adapter.log.info('controller = ' + controller_ip + ':' + controller_port);

  // get unifi class
  var unifi = require(__dirname + '/lib/unifi');

  var controller = new unifi.Controller(controller_ip, controller_port);

  adapter.log.info('here we go');
  controller.login(controller_username, controller_password, function(err) {
    if(err)
    {
      adapter.log.info('ERROR: ' + err);
      return;
    }

    adapter.log.info('login successfull');

    controller.getSitesStats(function(err, sites) {
      adapter.log.info('getSitesStats: ' + sites[0].name);
      adapter.log.info(JSON.stringify(sites));

      controller.getSiteSysinfo(sites[0].name, function(err, sysinfo) {
        adapter.log.info('getSiteSysinfo: ' + sysinfo[0].length);
        //adapter.log.info(JSON.stringify(data));

        controller.getClientDevices(sites[0].name, function(err, client_data) {
          adapter.log.info('getClientDevices: ' + client_data[0].length);
          //adapter.log.info(JSON.stringify(client_data));

          controller.logout();

          queryTimeout = setTimeout(updateUniFiData, update_interval * 1000);
        });
      });
    });
  });

  //var endpoints = [ unifi_login(controller_username, controller_password),
  //                  unifi_stat_sites(getSites),
  //                  //unifi_stat_sysinfo(sites, getSiteSysinfo),
  //                  //unifi_list_stations(site),
  //                  unifi_logout() ]

  //processRequests(endpoints);

  //queryTimeout = setTimeout(updateUniFiData, update_interval * 1000);
}
