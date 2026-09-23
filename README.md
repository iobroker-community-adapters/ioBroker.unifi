<img height="100px" src="admin/unifi.svg" align="left"><br/>
# ioBroker.unifi

![Number of Installations](http://iobroker.live/badges/unifi-installed.svg)
![Number of Installations](http://iobroker.live/badges/unifi-stable.svg)
[![NPM version](http://img.shields.io/npm/v/iobroker.unifi.svg)](https://www.npmjs.com/package/iobroker.unifi)

![Test and Release](https://github.com/iobroker-community-adapters/ioBroker.unifi/workflows/Test%20and%20Release/badge.svg)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/unifi/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Downloads](https://img.shields.io/npm/dm/iobroker.unifi.svg)](https://www.npmjs.com/package/iobroker.unifi)

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.** For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

This ioBroker adapter allows the monitoring and limited controlling of [UniFi devices](http://www.ubnt.com/), such as UniFi WiFi Access Points using the public UniFi Controller Web-API.

## Configuration
###  Minimum required information
To get this adapter up and running the following information is needed:
* IP address and port of your UniFi controller (Leave the port empty in case your controller is running on UniFiOS (e.g. UDM-Pro))
* Local username and password (2FA **cannot** be supported)
* Update interval

By default the information is updated every 60 seconds. Depending on your ioBroker hardware and your network size (number of clients, UniFi devices etc.) it is recommended to keep this interval and refraid from further decreasing it.

### Filter objects
The adapter updates as much information from your UniFi controller as possible, but offers the possibility to limit the updated information.

It is possible to disable the update of selected information or filter specific objects of that information.

| Information | Objects filterable by                   |
|-------------|-----------------------------------------|
| Clients     | Name, Hostname, IP address, MAC address |
| Devices     | Name, IP address, MAC address           |
| WiFis       | Name                                    |
| Networks    | Name                                    |
| Health      | Subsystem                               |

### Filter states
For every kind of information, the created states can be selected. If nothing is selected, all states are created. States needed by a selected state are added automatically, e.g. `last_seen_by_uap` and `last_seen_by_usw` for `is_online`.

## Control
### Enable/disable WiFis
By changing the 'enabled' state of a WiFi it is possible to enable/disable it. Some seconds later the change will be provisioned to the Access Points.

### Voucher creation
Using the `vouchers.create_vouchers` button it is possible to create predefined vouchers. It is possible to configure the number of vouchers that will be created, the duration the vouchers are valid and also set limits for up- and download.

## Missing datapoints
The adapter uses [node-unifi](https://github.com/jens-maus/node-unifi) to connect to your UniFi Controller. To simplify things, not all availble datapoints are pulled into your ioBroker. In case you're missing datapoints, use the following URLs to check the API. (Note: You have to replace IP, PORT and SITE with your settings)

| Information | API URL                                     |
|-------------|---------------------------------------------|
| Sites       | https://IP:PORT/api/self/sites              |
| SysInfo     | https://IP:PORT/api/s/SITE/stat/sysinfo     |
| Clients     | https://IP:PORT/api/s/SITE/stat/sta         |
| Devices     | https://IP:PORT/api/s/SITE/stat/device      |
| WiFis       | https://IP:PORT/api/s/SITE/rest/wlanconf    |
| Networks    | https://IP:PORT/api/s/SITE/rest/networkconf |
| Health      | https://IP:PORT/api/s/SITE/stat/health      |
| Vouchers    | https://IP:PORT/api/s/SITE/stat/voucher     |
| DPI         | https://IP:PORT/api/s/SITE/stat/dpi         |
| Alarms      | https://IP:PORT/api/s/SITE/stat/alarm       |

### UniFiOS (UDM-Pro) endpoints

| Information | API URL                                              |
|-------------|------------------------------------------------------|
| Sites       | https://IP/proxy/network/api/self/sites              |
| SysInfo     | https://IP/proxy/network/api/s/SITE/stat/sysinfo     |
| Clients     | https://IP/proxy/network/api/s/SITE/stat/sta         |
| Devices     | https://IP/proxy/network/api/s/SITE/stat/device      |
| WiFis       | https://IP/proxy/network/api/s/SITE/rest/wlanconf    |
| Networks    | https://IP/proxy/network/api/s/SITE/rest/networkconf |
| Health      | https://IP/proxy/network/api/s/SITE/stat/health      |
| Vouchers    | https://IP/proxy/network/api/s/SITE/stat/voucher     |
| DPI         | https://IP/proxy/network/api/s/SITE/stat/dpi         |
| Alarms      | https://IP/proxy/network/api/s/SITE/stat/alarm       |

## Known issues
* The is_wired state of clients is incorrect after a client went offline. This is a known issue of the UniFi controller and is not related to the adapter. (see https://community.ui.com/questions/Wireless-clients-shown-as-wired-clients/49d49818-4dab-473a-ba7f-d51bc4c067d1)

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
- (copilot) Adapter requires node.js >= 22 now
- (copilot) Adapter requires admin >= 7.7.22 now
- (copilot) Adapter requires js-controller >= 6.0.11 now
- (@FiraSenax) Controller sessions are reused and the polling loop keeps running after errors, new diagnostic states in `info` [#989]
- (@GermanBluefox) A failing endpoint or site no longer aborts the whole refresh
- (@GermanBluefox) Fixed polling stopping after `trigger_update` overlapped a scheduled refresh
- (@GermanBluefox) Migrated the settings page to JSON config
- (@GermanBluefox) Fixed creating vouchers: the settings were passed in the wrong order since node-unifi 2
- (@GermanBluefox) The adapter was refactored to TypeScript. It can be installed from npm only, not from GitHub

### 0.7.0 (2024-04-13)
* (mcm1957) Adapter requires node.js 18 and js-controller >= 5 now
* (mcm1957) Dependencies have been updated

### 0.6.7 (2023-12-10)
* (jens-maus) updated node-unifi to 2.5.1 to fix UDMpro v3.2.x auth issues
* (jens-maus) updated dependencies

### 0.6.6 (2023-06-20)
* (pafade89) fixed broken client status updates (#672)

### 0.6.5 (2023-06-20)
* (jens-maus) Bumped node-unifi to latest 2.4.1

[Older changelogs can be found there](CHANGELOG_OLD.md)

## References
This adapter uses functionality from the following third-party nodejs modules:

* [node-unifi](https://github.com/jens-maus/node-unifi)
* [json-logic-js](https://github.com/jwadhams/json-logic-js)

## License
The MIT License (MIT)

Copyright (c) 2024-2026 iobroker-community-adapters <iobroker-community-adapters@gmx.de>
Copyright (c) 2016-2023 Jens Maus &lt;mail@jens-maus.de&gt;
Copyright (c) 2020 braindead1 &lt;os.braindead1@gmail.com&gt;

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
