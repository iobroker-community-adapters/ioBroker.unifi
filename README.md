<img height="100px" src="admin/unifi.svg" align="left"><br/>
# ioBroker.unifi

![Number of Installations](http://iobroker.live/badges/unifi-installed.svg)
![Number of Installations](http://iobroker.live/badges/unifi-stable.svg)
[![NPM version](http://img.shields.io/npm/v/iobroker.unifi.svg)](https://www.npmjs.com/package/iobroker.unifi)

![Test and Release](https://github.com/iobroker-community-adapters/ioBroker.unifi/workflows/Test%20and%20Release/badge.svg)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/unifi/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Downloads](https://img.shields.io/npm/dm/iobroker.unifi.svg)](https://www.npmjs.com/package/iobroker.unifi)

> [!IMPORTANT]
> This adapter cannot be installed from github

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.** For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

This ioBroker adapter allows the monitoring and limited controlling of [UniFi devices](https://ui.com/), such as UniFi WiFi Access Points, using the API of the UniFi Network application.

## Configuration
###  Minimum required information
To get this adapter up and running the following information is needed:
* IP address and port of your UniFi controller (Leave the port empty in case your controller is running on UniFiOS (e.g. UDM-Pro))
* An API key (UniFi OS only, recommended) or a local username and password (2FA **cannot** be supported)
* Update interval

### Authentication
| Method | Available on | Notes |
|--------|--------------|-------|
| API key | UniFi OS consoles (UDM, UCG, Cloud Key Gen2+, UniFi OS Server) | No login, no session, no 2FA prompt. Tested with UniFi OS 6.0.15 / UniFi Network 11.0.97 |
| Local user | All controllers | A user with "Restrict to local access only". Logs in once and reuses the session |

To create an API key, open UniFi Network → **Integrations** (in Network 11 a page of its own in the left navigation, before in Settings → Control Plane → Integrations) → **Create New API Key**. The key is shown only once. API keys can expire: the adapter then logs `The API key was rejected` and `info.connection` becomes `false`.

The key is accepted by the same API that the local user uses, so the adapter offers the same features with both methods (tested: reading data, client and device commands).

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

### WAN statistics (UniFi Network 11 and newer)
UniFi Network 11 moved to a new statistics engine and cleared the statistics history. Since then the gateway report used for `gateway_traffic` returns no data (the adapter logs a warning once). The setting **Update WAN statistics** reads the data of the dashboard of the network application instead (`/v2/api/site/<site>/aggregated-dashboard`) and creates `<site>.wan.<connection>` for every internet connection (`WAN`, `WAN2`, ...):

| State | Content |
|-------|---------|
| `today_rx_bytes`, `today_tx_bytes` | received / sent since midnight (local time of the ioBroker host) |
| `yesterday_rx_bytes`, `yesterday_tx_bytes` | received / sent yesterday |
| `last24h_rx_bytes`, `last24h_tx_bytes` | received / sent in the last 24 hours |
| `monthly_bytes` | traffic of the current month, as counted by the console |
| `rx_rate`, `tx_rate` | current rates in bytes per second |
| `up`, `active`, `interface`, `uptime` | state of the connection, availability in % |
| `latency`, `packet_loss` | of the last hour |
| `isp_name`, `isp_asn`, `capacity_download`, `capacity_upload` | provider and its bandwidth in Mbit/s |
| `speedtest_download`, `speedtest_upload`, `speedtest_latency`, `speedtest_time` | last speed test of the console |

The setting is off by default. The traffic values are summed from hourly values of the console, so they are accurate to about one hour. A value stays empty (`null`) as long as the console has no data for the whole interval, e.g. `yesterday_*` on the day of the update to UniFi Network 11, which cleared the history. In contrast to `gateway_traffic` (LAN side of the gateway) they count the internet traffic. Controllers without this dashboard answer with 404; the adapter then logs a warning and skips the WAN statistics until it restarts.

## Control
### Enable/disable WiFis
By changing the 'enabled' state of a WiFi it is possible to enable/disable it. Some seconds later the change will be provisioned to the Access Points.

### Voucher creation
Using the `vouchers.create_vouchers` button it is possible to create predefined vouchers. It is possible to configure the number of vouchers that will be created, the duration the vouchers are valid and also set limits for up- and download.

## Missing datapoints
To simplify things, not all availble datapoints are pulled into your ioBroker. In case you're missing datapoints, use the following URLs to check the API. (Note: You have to replace IP, PORT and SITE with your settings)

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
- (@Schimi1983) Settings page: size attributes for all fields of the tabs, as required by the repository checker (W5507)
- (@Schimi1983) Authentication with an API key (UniFi OS), as alternative to the local user
- (@Schimi1983) node-unifi was replaced by an own client without dependencies (no axios with known vulnerabilities, one request less per call)
- (@Schimi1983) The session of the local user is ended when the adapter stops
- (@Schimi1983) The default port is empty (UniFi OS) and `common.dataSource` is `poll`
- (@Schimi1983) WAN statistics for UniFi Network 11 and newer: traffic today, yesterday and in the last 24 hours, monthly traffic, state, availability, latency, provider and last speed test of every internet connection [#696]
- (@Schimi1983) Warning when the controller returns no gateway statistics (UniFi Network 11 cleared them)

### 1.0.2 (2026-09-24)
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
