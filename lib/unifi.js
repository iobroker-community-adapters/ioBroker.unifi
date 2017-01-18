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

  _self._sites = [];
  _self._baseurl = 'https://127.0.0.1:8443';

  // format a new baseurl based on the arguments
  if(typeof(hostname) != 'undefined' && typeof(port) != 'undefined')
    _self._baseurl = 'https://' + hostname + ':' + port;

  /**
   * Login to UniFi Controller
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
   * Logout from UniFi Controller
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
   * NOTE: _self endpoint was introduced with controller version 5.2.9
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
   * Private function to send different commands to 'stamgr'
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
        var req = request.post({url: _self._baseurl + '/api/s/' + sites[count] + '/cmd/stamgr'},
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
   * Authorize a client device
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
   * Unauthorize a client device
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
   * Reconnect a client device
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
   * Block a client device
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
   * Unblock a client device
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
};

exports.Controller = Controller;
