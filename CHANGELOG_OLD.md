# Older changes
## 0.6.4 (2023-03-31)
* (jens-maus) Bumped node-unifi to latest 2.4.0
* (wuliwux) fixed issue in setWlanStatus not working (#665, #601)
* (pafade89) New feature for whitelisting client objects (#651)
* (Scrounger) client block / unblock added
* (Scrounger) restart device added
* (Scrounger) led override added
* (Scrounger) port power cycle added

## 0.6.3 (2022-10-08)
* (jens-maus) Bumped node-unifi to latest 2.2.1 (fixes #613)

## 0.6.2 (2022-10-07)
* (jens-maus) Bumped node-unifi to latest 2.2.0
* (maximilian-1) port-overrides structures added
* (Scrounger) poe power switch added
* (Scrounger) client reconnect added

## 0.6.1 (2022-06-08)
* (jens-maus) Bumped node-unifi to latest 2.1.0
* (jens-maus) updated translations

## 0.6.0 (2022-06-05)
* IMPORTANT: js-controller 2.0 or higher is required
* IMPORTANT: If Login do not work please re-enter the password in the instance configuration
* (Apollon77) Migrate to new version of unifi library
* (Apollon77) Allow to specify if SSL error should be ignored or not  (Default is to ignore errors as in former versions)
* (jens-maus) Fixed more device state object definitions to get rid of state warnings.
* (jens-maus/Apollon77) Updated dependencies, make compatible to newest firmwares

## 0.5.10 (2021-05-27)
* (jens-maus) Changed "Update done" output to be output as debug info.
* (jens-maus) Updated dependencies.

## 0.5.9 (2021-05-07)
* (jens-maus) Fixed all js-controller 3.3 related state warnings
* (kirovilya, jens-maus) Added device state object with dedicated states list.
* (jens-maus) Updated node-unifi to latest version
* (jens-maus) Updated dependencies

## 0.5.8 (2020-08-29)
* (braindead1) Fixed problems related to unused sites
* (braindead1) Fixed some errors reported via Sentry

## 0.5.7 (2020-07-27)
* (braindead1) Fixed Sentry errors caused by not updated configuration after update

## 0.5.6 (2020-07-25)
* (Scrounger, braindead1) Implemented Alarms, DPI & Gateway Traffic
* (braindead1) Prevented creation of ghost clients caused by iOS MAC randomization
* (dklinger) Implemented manual update trigger
* (braindead1) Implemented deletion of used vouchers
* (braindead1) Fixed some errors reported via Sentry

## 0.5.5 (2020-06-13)
* (braindead1) Fixed some errors reported via Sentry

## 0.5.4 (2020-06-06)
* (braindead1) Implemented offset for is_online
* (braindead1) Fixed some issues related to is_online
* (braindead1) Prepared whitelisting of clients etc.

## 0.5.2 (2020-05-23)
* (jens-maus) Implemented UniFiOS/UDM-Pro support
* (braindead1) Implemented possibility to enable/disable WLANs
* (braindead1) Implemented voucher creation
* (braindead1) Implemented online state for clients
* (braindead1) Updated client states
* (braindead1) Updated device states
* (braindead1) Improved error messages

## 0.5.0 (2020-05-09)
* (braindead1) Implemented configuration of updates
* (braindead1) Improved JsonLogic
* (braindead1) Removed legacy code
* (braindead1) Implemented Sentry

## 0.4.3 (2020-04-24)
* (braindead1) fixed configuration issue

## 0.4.2 (2020-04-23)
* (braindead1) subsystem issue fixed

## 0.4.1 (2020-04-16)
* (braindead1) Enhanced refactoring

## 0.4.0 (2020-04-16)
* (bluefox) Refactoring

## 0.3.1
* (jens-maus) added support for multi-site environments.

## 0.3.0
* (jens-maus) added access device data query and moved the client devices to the 'clients' subtree instead

## 0.2.1
* (jens-maus) minor fixes

## 0.2.0
* (jens-maus) moved `lib/unifi.js` to dedicated node-unifi nodejs class and added it as a dependency.

## 0.1.0
* (jens-maus) implemented a first basically working version which can retrieve status information from a UniFi controller.

## 0.0.1
* (jens-maus) initial checkin of non-working development version
