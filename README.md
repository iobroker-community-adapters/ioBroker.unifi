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

This adapter shows your [UniFi network](https://ui.com/) in ioBroker: which devices are online, how your UniFi gateway, switches and access points are doing, how much internet traffic you use, and more. A few things can also be switched from ioBroker, e.g. WLANs, PoE ports, the LEDs of the devices, blocking a client or creating guest vouchers.

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.** For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## Requirements
* A UniFi console with UniFi OS (UDM, UDM-Pro, UDM-SE, UCG, UX, Cloud Key Gen2+, UniFi OS Server) or a self-hosted UniFi Network application
* An **API key** (UniFi OS only, recommended) or a **local user** of the console. Cloud accounts of ui.com with two-factor authentication cannot be used.

## Setup
1. **Create an API key** (recommended): open the UniFi Network application → **Integrations** (in Network 11 in the left navigation, before in Settings → Control Plane → Integrations) → **Create New API Key**. Copy the key, it is shown only once.
   *Without UniFi OS, or if you prefer a user:* create a user in the console under Admins & Users with **Restrict to local access only** and access to UniFi Network: full management to switch things, view only to read only.
2. **Install the adapter** in ioBroker (Adapters → UniFi) and open the settings of the instance.
3. Tab **General**:
   * **IP address** of the console, e.g. `192.168.1.1`. Leave the **port** empty for UniFi OS consoles; a self-hosted application usually uses `8443`.
   * **Authentication**: *API key* and paste the key, or *Local user* with user name and password.
   * Keep **Ignore SSL certificate errors** switched on: the consoles use a self-signed certificate.
   * The **update interval** of 60 seconds fits most networks.
4. Switch on in the other tabs what you need (see below) and **save**. After about a minute the data appears in the objects under `unifi.0`.

`info.connection` shows whether the adapter is connected; the instance is green then.

## Settings
| Tab | What you get | Recommendation |
|-----|--------------|----------------|
| General | connection and update interval | API key, 60 s |
| Sysinfo | version and update status of the UniFi Network application | on |
| Clients | every device in your network: name, IP, online, WLAN, signal; block / reconnect | on |
| Devices | gateway, switches, access points: state, firmware, temperatures, ports with PoE, internet connections (`wan1`, `wan2`); restart, PoE, LEDs | on |
| WLANs | your wireless networks; switch them on and off | on |
| Networks | networks and VLANs with their settings | as needed |
| Health | overall status of internet, LAN, WLAN and VPN | on |
| Vouchers | guest vouchers of the hotspot; create new ones | only with hotspot |
| Alarms | alarm messages | **off** with UniFi Network 10 and newer (no alarms anymore) |
| DPI | traffic per application and category | as needed, needs a gateway with traffic identification |
| Gateway traffic | traffic per day of older gateways | **off** with UniFi Network 11 and newer, use WAN |
| WAN | internet traffic today / yesterday / month, provider, availability, speed test | on with UniFi Network 11 and newer |

**Filter objects:** names, host names, IP or MAC addresses of objects that should not be created. For clients the list can also be used the other way round, as the only clients to create.

**Filter states:** only the selected states are created; if nothing is selected, all states are created. New instances start with a recommended selection for clients and devices, so the object tree stays clear. States that are needed by a selected state are added automatically, e.g. `last_seen_by_uap` / `last_seen_by_usw` for `is_online`.

## What you get
| Folder | Content |
|--------|---------|
| `unifi.0.<site>.sysinfo` | version, update available |
| `unifi.0.<site>.clients.<mac>` | one folder per client: `name`, `ip`, `is_online`, `essid`, `signal`, `last_seen` … |
| `unifi.0.<site>.devices.<mac>` | one folder per UniFi device: `state`, `version`, `upgradable`, `uptime`, temperatures, `port_table` (ports, PoE), `wan1` / `wan2` (internet connections of the gateway) … |
| `unifi.0.<site>.wlans.<name>` | one folder per WLAN, `enabled` |
| `unifi.0.<site>.networks.<name>` | one folder per network |
| `unifi.0.<site>.health.<subsystem>` | `wan`, `lan`, `wlan`, `vpn`, `www` with `status` |
| `unifi.0.<site>.wan.<connection>` | traffic, provider, availability and speed test of every internet connection |
| `unifi.0.<site>.vouchers` | vouchers and the button `create_vouchers` |
| `unifi.0.info` | connection and state of the last refresh (see Troubleshooting) |

`<site>` is the name of the UniFi site, usually `default`. All states have the matching ioBroker role, so they are recognized by visualizations and assistants.

### Internet connections (WAN)
For a gateway (e.g. UDM-Pro, UCG, USG) every internet connection gets its own folder below the device: `wan1`, and `wan2` if a second connection is set up. It shows the public IPv4 address, the IPv6 addresses, whether the connection is up, the port number on the gateway, the link speed and, while connected, the latency and availability.

### WAN statistics (UniFi Network 11 and newer)
UniFi Network 11 moved to a new statistics engine and cleared the statistics history; the gateway report used for `gateway_traffic` returns no data since then. The setting **Update WAN statistics** reads the data of the dashboard of the network application instead and creates `<site>.wan.<connection>` for every internet connection (`WAN`, `WAN2`, …):

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

The traffic values are summed from hourly values of the console, so they are accurate to about one hour. A value stays empty (`null`) as long as the console has no data for the whole interval, e.g. `yesterday_*` on the day of the update to UniFi Network 11. Controllers without this dashboard are skipped after one warning.

## Control
| State | Action |
|-------|--------|
| `wlans.<name>.enabled` | switch the WLAN on (`true`) or off (`false`); the access points take some seconds |
| `clients.<mac>.blocked` | block (`true`) or unblock (`false`) a client, wireless or wired |
| `clients.<mac>.reconnect` | button: disconnect a wireless client so it connects again |
| `devices.<mac>.restart` | button: restart the device |
| `devices.<mac>.led_override` | LEDs `on`, `off` or `default` (setting of the site) |
| `devices.<mac>.port_table.port_<n>.port_poe_enabled` | switch PoE of the port on or off |
| `devices.<mac>.port_table.port_<n>.port_poe_cycle` | button: switch PoE off and on again, e.g. to restart a camera |
| `vouchers.create_vouchers` | button: create vouchers with the settings of the Vouchers tab |
| `unifi.0.trigger_update` | button: read the data now |

Switching needs an API key or a local user with full management of UniFi Network.

## Troubleshooting
| State | Meaning |
|-------|---------|
| `info.connection` | `true` while the console answers |
| `info.lastSuccessfulRefresh` | time of the last complete refresh |
| `info.lastError` | last error message, empty if everything is fine |
| `info.consecutiveErrors` | failed refreshes in a row; after errors the adapter waits a bit longer before the next try |

| Message in the log | What to do |
|--------------------|------------|
| `Incorrect username or password` | check user name and password; the user must be a local user |
| `The API key was rejected` | the key is invalid, expired or deleted: create a new one in UniFi Network → Integrations |
| `The UniFi console blocks the login of the local user` | too many logins, e.g. because the same user is used by other systems. The adapter tries again after 15 minutes. An API key avoids this. |
| `did not answer within 10 s` | the console was busy for a moment, the next refresh repeats it. Only repeated messages need attention. |
| `no gateway statistics` | UniFi Network 11 and newer: switch off *Gateway traffic* and switch on *WAN* |

## Known issues
* The `is_wired` state of clients is incorrect after a client went offline. This is a known issue of the UniFi controller (see https://community.ui.com/questions/Wireless-clients-shown-as-wired-clients/49d49818-4dab-473a-ba7f-d51bc4c067d1).
* The UniFi console locks a local user for a while after too many logins. The adapter waits 15 minutes before it tries again; an API key needs no login.
* UniFi Network 10 and newer no longer provide alarms, switch them off in the settings.

<details>
<summary>For developers: API endpoints</summary>

Not all data of the API is mirrored into ioBroker. To check the raw data, open these URLs in the browser while you are logged in to the console (replace `IP` and `SITE`; a self-hosted application has no `/proxy/network` and needs the port, e.g. `https://IP:8443/api/s/SITE/stat/sta`):

| Information | URL |
|-------------|-----|
| Sites | `https://IP/proxy/network/api/self/sites` |
| System information | `https://IP/proxy/network/api/s/SITE/stat/sysinfo` |
| Clients | `https://IP/proxy/network/api/s/SITE/stat/sta` |
| Devices | `https://IP/proxy/network/api/s/SITE/stat/device` |
| WLANs | `https://IP/proxy/network/api/s/SITE/rest/wlanconf` |
| Networks | `https://IP/proxy/network/api/s/SITE/rest/networkconf` |
| Health | `https://IP/proxy/network/api/s/SITE/stat/health` |
| Vouchers | `https://IP/proxy/network/api/s/SITE/stat/voucher` |
| DPI | `https://IP/proxy/network/api/s/SITE/stat/dpi` |
| WAN statistics | `https://IP/proxy/network/v2/api/site/SITE/aggregated-dashboard?historySeconds=3600` |

</details>

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
- (@Schimi1983) README and settings page for beginners: setup step by step, every tab explained with a recommendation, overview of the folders, control and troubleshooting tables, the API endpoints moved to a section for developers; short explanations on every tab of the settings in 11 languages
- (@Schimi1983) All states have a specific ioBroker role (e.g. `info.ip`, `info.mac`, `indicator.reachable`, `value.temperature`, `switch.enable`, `date`) instead of the generic `state`, so visualizations and assistants recognize them
- (@Schimi1983) Unified units (`B`, `B/s`, `Mbit/s`, `kbit/s`, `min`), numbers are stored as numbers (PoE power/voltage/current, load, CPU, memory, uptime of the devices, voucher duration), and the port settings full duplex, isolation, auto negotiation and spanning tree as true/false
- (@Schimi1983) `rssi` of the clients is the signal-to-noise ratio in dB (unit was dBm)
- (@Schimi1983) Readable names for all folders (e.g. "Ports", "Radios", "Speed test") in 11 languages, the site gets its name from the controller
- (@Schimi1983) New instances: recommended selection of client and device states, alarms off (UniFi Network 10 and newer has no alarms)

### 1.2.1 (2026-11-04)
- (@GermanBluefox) WAN statistics: traffic was counted several times if the history had a gap at its start (e.g. the gateway was offline)

### 1.2.0 (2026-11-04)
- (@Schimi1983) The `blocked` state is created for wired clients too, with role `switch` [#760]
- (@Schimi1983) Gateways: IPv4 and IPv6 addresses, status, port, link speed, latency and availability of every internet connection (`wan1`, `wan2`) [#696]

### 1.1.0 (2026-11-04)
- (@Schimi1983) Authentication with an API key (UniFi OS), as alternative to the local user
- (@Schimi1983) node-unifi was replaced by an own client without dependencies (no axios with known vulnerabilities, one request less per call)
- (@Schimi1983) The session of the local user is ended when the adapter stops
- (@Schimi1983) The default port is empty (UniFi OS) and `common.dataSource` is `poll`
- (@Schimi1983) WAN statistics for UniFi Network 11 and newer: traffic today, yesterday and in the last 24 hours, monthly traffic, state, availability, latency, provider and last speed test of every internet connection [#696]
- (@Schimi1983) Warning when the controller returns no gateway statistics (UniFi Network 11 cleared them)

### 1.0.3 (2026-11-03)
- (@Schimi1983) Settings page: size attributes for all fields of the tabs, as required by the repository checker (W5507)
- (@Schimi1983) Fixed the `blocked` state of the clients: it was not updated when all states were selected (empty states filter), and with several sites the refresh of one site reset the blocked clients of the others
- (@Schimi1983) Fixed commands (restart, LED, PoE, block, ...) failing before the first refresh or after an expired session [#725]
- (@Schimi1983) Switching PoE creates the missing override of a port instead of failing [#658]

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
