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

  adapter.setObjectNotExists('status.last_notify', {
      type: 'state',
      common: {
          name: 'status.last_notify',
          type: 'string',
          read: true,
          write: false
      },
      native: {id: 'status.last_notify'}
  });

  adapter.getState('status.last_notify', function (err, state) {
      if (!err && !state) {
          adapter.setState('status.last_notify', {ack: true, val: ''});
      }
      if (!err) updateUniFiData();
  });

  // subscribe to all state changes
  adapter.subscribeStates('*');
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

function updateUniFiData() {

  adapter.log.info('Starting UniFi-Controller query');

  var update_interval = parseInt(adapater.config.update_interval, 10) || 60;

  adapter.log.info('update_interval = ' + update_interval);

	queryTimeout = setTimeout(updateUniFiData, update_interval * 1000);
}
