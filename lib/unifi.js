/**
 *
 * UniFi controller class (NodeJS)
 *
 * This nodejs class provides functionality to query a UniFi controller (www.ubnt.com) through
 * its Web-API. The functionality implemented here had been gathered through different
 * souces, namely:
 *
 *   UniFi-API-browser class: https://github.com/malle-pietje/UniFi-API-browser/blob/master/phpapi/class.unifi.php
 *   UniFi-API sh client: https://www.ubnt.com/downloads/unifi/5.3.8/unifi_sh_api
 *
 * The majority of the functions in here are actually based on the PHP UniFi-API-browser class
 * version 1.0.12 which defines compatibility to UniFi-Controller versions v4+
 *
 * Copyright (c) 2017 Jens Maus <mail@jens-maus.de>
 *
 * The source code is distributed under the MIT license
 *
 */
var request = require('request');
var async = require('async');

// make sure we setup request correctly for our
// processing
request = request.defaults({ jar: true,
                             json: true,
                             strictSSL: false
                          });

var Controller = function(hostname, port)
{
  var _self = this;

  /** INIT CODE **/

  _self._sites = [];
  _self._baseurl = 'https://127.0.0.1:8443';

  // format a new baseurl based on the arguments
  if(typeof(hostname) != 'undefined' && typeof(port) != 'undefined')
    _self._baseurl = 'https://' + hostname + ':' + port;

  /** PUBLIC FUNCTIONS **/

  /**
   * Login to UniFi Controller - login()
   */
  _self.login = function(username, password, cb)
  {
    if(typeof(cb) != 'function')
      throw new Error('callback function required.');

    var req = request.post({url: _self._baseurl + '/api/login',
                            json: { username: username, password: password }},
                            function(error, response, body)
                            {
                              if(!error && body && response.statusCode >= 200 && response.statusCode < 400 &&
                                 (typeof(body) == 'undefined' || typeof(body.meta) == 'undefined' || body.meta.rc == "ok"))
                              {
                                cb(false);
                              }
                              else
                                cb('Login failed');
                            }
                          );

    req.on('error', function(err)
    {
      cb(err.message);
    });
  };

  /**
   * Logout from UniFi Controller - logout()
   */
  _self.logout = function(cb)
  {
    var req = request.get({url: _self._baseurl + '/logout'},
                           function(error, response, body)
                           {
                             if(!error && body && response.statusCode >= 200 && response.statusCode < 400 &&
                                (typeof(body) == 'undefined' || typeof(body.meta) == 'undefined' || body.meta.rc == "ok"))
                             {
                               if(typeof(cb) == 'function')
                                 cb(false);
                             }
                             else if(typeof(cb) == 'function')
                               cb('Logout failed');
                           }
                         );

    req.on('error', function(err)
    {
      if(_.isFunction(cb))
        cb(err.message);
    });
  };

  /**
   * Authorize a client device - authorize_guest()
   * -------------------------
   *
   * required paramater <sites>   = name or array of site names
   * required parameter <mac>     = client MAC address
   * required parameter <minutes> = minutes (from now) until authorization expires
   * required paramater <cb>      = the callback function that is called with the results
   * optional parameter <up>      = upload speed limit in kbps
   * optional parameter <down>    = download speed limit in kbps
   * optional parameter <MBytes>  = data transfer limit in MB
   * optional parameter <ap_mac>  = AP MAC address to which client is connected, should result in faster authorization
   */
  _self.authorizeGuest = function(sites, mac, minutes, cb, up, down, mbytes, ap_mac)
  {
    _self._stamgr('authorize-guest', sites, mac, minutes, up, down, mbytes, ap_mac, cb);
  };

  /**
   * Unauthorize a client device - unauthorize_guest()
   * ---------------------------
   *
   * required paramater <sites>   = name or array of site names
   * required parameter <mac>     = client MAC address
   */
  _self.authorizeGuest = function(sites, mac, cb)
  {
    _self._stamgr('unauthorize-guest', sites, mac);
  };

  /**
   * Reconnect a client device - reconnect_sta()
   * -------------------------
   *
   * required paramater <sites>   = name or array of site names
   * required parameter <mac>     = client MAC address
   */
  _self.reconnectClient = function(sites, mac, cb)
  {
    _self._stamgr('kick-sta', sites, mac);
  };

  /**
   * Block a client device - block_sta()
   * ---------------------
   *
   * required paramater <sites>   = name or array of site names
   * required parameter <mac>     = client MAC address
   */
  _self.reconnectClient = function(sites, mac, cb)
  {
    _self._stamgr('block-sta', sites, mac);
  };

  /**
   * Unblock a client device - unblock_sta()
   * -----------------------
   *
   * required paramater <sites>   = name or array of site names
   * required parameter <mac>     = client MAC address
   */
  _self.reconnectClient = function(sites, mac, cb)
  {
    _self._stamgr('unblock-sta', sites, mac);
  };

  /**
   * Add/modify a client device note - set_sta_note()
   * -------------------------------
   *
   * required paramater <sites>   = name or array of site names
   * required parameter <user_id> = id of the user device to be modified
   * optional parameter <note>    = note to be applied to the user device
   *
   * NOTES:
   * - when note is empty or not set, the existing note for the user will be removed and "noted" attribute set to FALSE
   */
  _self.setClientNote = function(sites, user_id, cb, note)
  {
    var noted = 1;
    if(typeof(note) == 'undefined')
    {
      note = '';
      noted = 0;
    }

    _self._upd_user(sites, user_id, cb, { note: note, noted: noted });
  };

  /**
   * Add/modify a client device name - set_sta_name()
   * -------------------------------
   *
   * required paramater <sites>   = name or array of site names
   * required parameter <user_id> = id of the user device to be modified
   * optional parameter <name>    = name to be applied to the user device
   *
   * NOTES:
   * - when name is empty or not set, the existing name for the user will be removed
   */
  _self.setClientName = function(sites, user_id, cb, name)
  {
    if(typeof(name) == 'undefined')
      name = '';

    _self._upd_user(sites, user_id, cb, { name: name });
  };

  /**
   * Daily stats method - stat_daily_site()
   * ------------------
   *
   * required paramater <sites> = name or array of site names
   * optional parameter <start> = Unix timestamp in seconds
   * optional parameter <end>   = Unix timestamp in seconds
   *
   * NOTES:
   * - defaults to the past 52*7*24 hours
   * - "bytes" are no longer returned with controller version 4.9.1 and later
   */
  _self.getDailySiteStats = function(sites, cb, start, end)
  {
    if(typeof(end) == 'undefined')
      end = Math.floor(new Date());

    if(typeof(start) == 'undefined')
      start = end - (52*7*24*3600*1000);

    var json = { attrs: [ 'bytes',
                          'wan-tx_bytes',
                          'wan-rx_bytes',
                          'wlan_bytes',
                          'num_sta',
                          'lan-num_sta',
                          'wlan-num_sta',
                          'time' ],
                start: start,
                end: end };

    _self._stat_report(sites, "daily.site", json, cb);
  };

  /**
   * Hourly stats method - stat_hourly_site()
   * -------------------
   *
   * required paramater <sites> = name or array of site names
   * optional parameter <start> = Unix timestamp in seconds
   * optional parameter <end>   = Unix timestamp in seconds
   *
   * NOTES:
   * - defaults to the past 7*24 hours
   * - "bytes" are no longer returned with controller version 4.9.1 and later
   */
  _self.getHourlySiteStats = function(sites, cb, start, end)
  {
    if(typeof(end) == 'undefined')
      end = Math.floor(new Date());

    if(typeof(start) == 'undefined')
      start = end - (7*24*3600*1000);

    var json = { attrs: [ 'bytes',
                          'wan-tx_bytes',
                          'wan-rx_bytes',
                          'wlan_bytes',
                          'num_sta',
                          'lan-num_sta',
                          'wlan-num_sta',
                          'time' ],
                start: start,
                end: end };

    _self._stat_report(sites, "hourly.site", json, cb);
  };

  /**
   * Hourly stats method for all access points - stat_hourly_aps()
   * -----------------------------------------
   *
   * required paramater <sites> = name or array of site names
   * optional parameter <start> = Unix timestamp in seconds
   * optional parameter <end>   = Unix timestamp in seconds
   *
   * NOTES:
   * - defaults to the past 7*24 hours
   * - UniFi controller does not keep these stats longer than 5 hours with versions < 4.6.6
   */
  _self.getHourlyApStats = function(sites, cb, start, end)
  {
    if(typeof(end) == 'undefined')
      end = Math.floor(new Date());

    if(typeof(start) == 'undefined')
      start = end - (7*24*3600*1000);

    var json = { attrs: [ 'bytes',
                          'num_sta',
                          'time' ],
                start: start,
                end: end };

    _self._stat_report(sites, "hourly.ap", json, cb);
  };

  /**
   * List sites
   * ----------
   * calls callback function(err, result) with an array of the sites
   * registered to the UniFi controller
   */
  _self.getSites = function(cb)
  {
    if(typeof(cb) != 'function')
      throw new Error('callback function required.');

    var req = request.get({url: _self._baseurl + '/api/self/sites'},
                           function(error, response, body)
                           {
                             if(!error && body && response.statusCode >= 200 && response.statusCode < 400 &&
                                (typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == "ok"))
                             {
                               cb(false, body.data);
                             }
                             else
                               cb('/api/self/sites failed');
                           }
                         );

    req.on('error', function(err)
    {
      cb(err.message);
    });
  };

  /**
   * List sites stats
   * ----------------
   * calls callback function(err, result) with an array of sysinfo information
   * for all sites registered to the UniFi controller
   *
   * NOTE: endpoint was introduced with controller version 5.2.9
   */
  _self.getSitesStats = function(cb)
  {
    if(typeof(cb) != 'function')
      throw new Error('callback function required.');

    var req = request.get({url: _self._baseurl + '/api/stat/sites'},
                           function(error, response, body)
                           {
                             if(!error && body && response.statusCode >= 200 && response.statusCode < 400 &&
                                (typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == "ok"))
                             {
                               cb(false, body.data);
                             }
                             else
                               cb('/api/stat/sites failed');
                           }
                         );

    req.on('error', function(err)
    {
      cb(err.message);
    });
  };

  /**
   * List site sysinfo
   * -----------------
   * returns an array of known sysinfo data via callback function(err, result)
   * for all sites specified as a function parameter
   */
  _self.getSiteSysinfo = function(sites, cb)
  {
    if(typeof(cb) != 'function')
      throw new Error('callback function required.');

    if(Array.isArray(sites) === false)
      sites = [ sites ];

    var count = 0;
    var results = [];
    async.whilst(
      function() { return count < sites.length; },
      function(callback) {
        var req = request.get({url: _self._baseurl + '/api/s/' + sites[count] + '/stat/sysinfo'},
                               function(error, response, body)
                               {
                                 if(!error && body && response.statusCode >= 200 && response.statusCode < 400 &&
                                    (typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == 'ok'))
                                 {
                                   results.push(body.data);
                                   callback(null);
                                 }
                                 else if(typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == 'error')
                                   callback(body.meta.msg);
                                 else
                                   callback('getSiteSysinfo ERROR');
                               }
                            );

        req.on('error', function(err)
        {
          callback(err.message);
        });

        count++;
      },
      function(err) {
        if(!err)
          cb(false, results);
        else
          cb(err, results);
      }
    );
  };



  /**
   * List online client device(s)
   * ----------------------------
   * returns an array of online client device objects, or in case of a single device request, returns a single client device object
   *
   * required paramater <sites>   = name or array of site names
   * optional parameter <client_mac> = the MAC address of a single online client device for which the call must be made
   */
  _self.getClientDevices = function(sites, cb, client_mac)
  {
    if(typeof(cb) != 'function')
      throw new Error('callback function required.');

    if(Array.isArray(sites) === false)
      sites = [ sites ];

    if(typeof(client_mac) === 'undefined')
      client_mac = '';

    var count = 0;
    var results = [];
    async.whilst(
      function() { return count < sites.length; },
      function(callback) {
        var req = request.get({url: _self._baseurl + '/api/s/' + sites[count] + '/stat/sta/' + client_mac},
                               function(error, response, body)
                               {
                                 if(!error && body && response.statusCode >= 200 && response.statusCode < 400 &&
                                    (typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == 'ok'))
                                 {
                                   results.push(body.data);
                                   callback(null);
                                 }
                                 else if(typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == 'error')
                                   callback(body.meta.msg);
                                 else
                                   callback('getSiteSysinfo ERROR');
                               }
                            );

        req.on('error', function(err)
        {
          callback(err.message);
        });

        count++;
      },
      function(err) {
        if(!err)
          cb(false, results);
        else
          cb(err, results);
      }
    );
  };

  /** PRIVATE FUNCTIONS **/

  /**
   *
   * Private function to send different commands to '/api/s/XXXXX/cmd/stamgr'
   *
   */
  _self._stamgr = function(cmd, sites, cb, mac, minutes, up, down, mbytes, ap_mac)
  {
    if(typeof(cb) != 'function')
      throw new Error('callback function required.');

    if(Array.isArray(sites) === false)
      sites = [ sites ];

    // create the json post data array for use in the post requests
    var json = { cmd: cmd, mac: mac.toLowerCase() };
    if(typeof(minutes) !== 'undefined') json['minutes'] = minutes;
    if(typeof(up) !== 'undefined')      json['up'] = up;
    if(typeof(down) !== 'undefined')    json['down'] = down;
    if(typeof(mbytes) !== 'undefined')  json['bytes'] = mbytes;
    if(typeof(ap_mac) !== 'undefined')  json['ap_mac'] = ap_mac;

    var count = 0;
    var results = [];
    async.whilst(
      function() { return count < sites.length; },
      function(callback) {
        var req = request.post({url: _self._baseurl + '/api/s/' + sites[count] + '/cmd/stamgr',
                                json: json },
                                function(error, response, body)
                                {
                                  if(!error && body && response.statusCode >= 200 && response.statusCode < 400 &&
                                     (typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == 'ok'))
                                  {
                                    results.push(body.data);
                                    callback(null);
                                  }
                                  else if(typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == 'error')
                                    callback(body.meta.msg);
                                  else
                                    callback('stamgr (' + cmd + ') ERROR');
                                }
                             );

        req.on('error', function(err)
        {
          callback(err.message);
        });

        count++;
      },
      function(err) {
        if(!err)
          cb(false, results);
        else
          cb(err, results);
      }
    );
  };

  /**
   *
   * Private function to send different commands to '/api/s/XXXXX/upd/user/XXXX'
   *
   */
  _self._upd_user = function(sites, user_id, cb, json)
  {
    if(typeof(cb) != 'function')
      throw new Error('callback function required.');

    if(Array.isArray(sites) === false)
      sites = [ sites ];

    var count = 0;
    var results = [];
    async.whilst(
      function() { return count < sites.length; },
      function(callback) {
        var req = request.post({url: _self._baseurl + '/api/s/' + sites[count] + '/upd/user/' + user_id,
                                json: json },
                                function(error, response, body)
                                {
                                  if(!error && body && response.statusCode >= 200 && response.statusCode < 400 &&
                                     (typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == 'ok'))
                                  {
                                    results.push(body.data);
                                    callback(null);
                                  }
                                  else if(typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == 'error')
                                    callback(body.meta.msg);
                                  else
                                    callback('upd/user (' + json + ') ERROR');
                                }
                             );

        req.on('error', function(err)
        {
          callback(err.message);
        });

        count++;
      },
      function(err) {
        if(!err)
          cb(false, results);
        else
          cb(err, results);
      }
    );
  };

  /**
   *
   * Private function to send different commands to '/api/s/XXXXX/stat/report/XXXX.site'
   *
   */
  _self._stat_report_site = function(sites, interval, json, cb)
  {
    if(typeof(cb) != 'function')
      throw new Error('callback function required.');

    if(Array.isArray(sites) === false)
      sites = [ sites ];

    var count = 0;
    var results = [];
    async.whilst(
      function() { return count < sites.length; },
      function(callback) {
        var req = request.post({url: _self._baseurl + '/api/s/' + sites[count] + '/stat/report/' + interval + '.site',
                                json: json },
                                function(error, response, body)
                                {
                                  if(!error && body && response.statusCode >= 200 && response.statusCode < 400 &&
                                     (typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == 'ok'))
                                  {
                                    results.push(body.data);
                                    callback(null);
                                  }
                                  else if(typeof(body) != 'undefined' && typeof(body.meta) != 'undefined' && body.meta.rc == 'error')
                                    callback(body.meta.msg);
                                  else
                                    callback('/stat/report/' + interval + '.site ERROR');
                                }
                             );

        req.on('error', function(err)
        {
          callback(err.message);
        });

        count++;
      },
      function(err) {
        if(!err)
          cb(false, results);
        else
          cb(err, results);
      }
    );
  };
};

exports.Controller = Controller;
