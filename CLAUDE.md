# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`iobroker.unifi` is an ioBroker adapter that polls a **UniFi Network controller** (classic controller or UniFi OS, e.g. UDM-Pro) via [node-unifi](https://github.com/jens-maus/node-unifi) and mirrors sites, clients, devices, WLANs, networks, health, vouchers, DPI statistics, gateway traffic and alarms into ioBroker states. A few states are writable and control the controller (WLAN on/off, PoE, LED, restart, block/reconnect clients, create vouchers).

TypeScript (CommonJS output). Sources live in `src/`, the published/runnable code is the compiled `build/` (`package.json` `main` is `build/main.js`). `build/` is gitignored — always run the build before starting the adapter or the tests.

## Commands

```bash
npm run build                             # tasks.ts: clean, tsc -p tsconfig.build.json -> build/, regenerate jsonConfig options
npm run 1-backend                         # only compile
npm run 2-jsonConfig                      # only regenerate the state filter options in admin/jsonConfig.json
npm run watch                             # tsc in watch mode
npm run check                             # type check only (tsconfig.json, noEmit)
npm run lint                              # eslint (@iobroker/eslint-config, flat config)
npx eslint -c eslint.config.mjs --fix src tasks.ts   # autofix + prettier formatting

npm run test:package                      # validates package.json / io-package.json / admin JSON (fast, no build needed)
npm run test:unit                         # mocha test/*.test.js against build/ (needs npm run build first)
npm run test:integration                  # starts a real js-controller + adapter instance
npx mocha test/refresh.test.js --exit --grep "backoff"   # single test
npm run release-patch                     # @alcalzone/release-script, moves README changelog into io-package news
```

There is deliberately **no `prepare` script** — `npm ci`/`npm install` does not build. Because `build/` is neither committed nor built on install, `common.nogit` is `true` in `io-package.json`: the adapter can only be installed from npm, not from GitHub. The integration test requires that **no** js-controller is running on the machine, otherwise it aborts with "JS-Controller is already running!".

## Architecture

### Layout

| Path | Content |
| --- | --- |
| `src/main.ts` | the whole adapter: one `Unifi extends utils.Adapter` class |
| `src/lib/jsonLogic.ts` | the custom json-logic operations used by the object definitions, `applyRule()` |
| `src/lib/objectDefinitions.ts` | loads `admin/lib/objects_*.json`, collects state IDs, builds the jsonConfig options |
| `src/lib/dpiNames.ts` | names of the DPI categories and applications (generated from the old `json_logic.js`) |
| `src/lib/types.ts` | object definitions, UniFi data, filters |
| `src/lib/adapter-config.d.ts` | augments `ioBroker.AdapterConfig` |
| `src/types/node-unifi.d.ts` | typings for node-unifi (only the methods used) |
| `admin/lib/objects_*.json` | **the object definitions** — which objects/states exist and how their values are computed |
| `admin/jsonConfig.json` | the configuration dialog |
| `tasks.ts` | build steps (run by `tsx`) |

`src/lib/adapter-config.d.ts` is hand-maintained and must be kept in sync with `native` in `io-package.json` **and** with `admin/jsonConfig.json`. `test/config.test.js` checks that jsonConfig and `native` have the same keys.

### Object definitions: `admin/lib/objects_*.json`

The states are not created in code. Each `objects_<category>.json` is a tree of definitions:

- `_id`, `type`, `common`, `native`, `value` — fixed parts, or the same keys under `logic` as a **json-logic rule** evaluated against the controller data. A plain string rule is short for `{ "var": "<string>" }`.
- `logic.has` + `logic.has_key` — children; `has_key` names the property of the data that holds their data (`_self` = the data itself). Arrays are iterated.
- `applyJsonLogic()` walks the tree, builds each object, writes it with `extendObjectAsync` **only when it changed** (`ownObjects` cache), converts the value to `common.type` and writes the state only when the value changed.

The custom operations (`cleanupForUseAsId`, `timestampToDateTime`, `translateAppCodeToName`, …) are registered on import of `src/lib/jsonLogic.ts`. The files are read from `join(__dirname, '..', '..', 'admin', 'lib')`, i.e. relative to `build/lib` — `admin/lib` must stay in the npm package (`files`).

### Refresh loop

`updateUnifiData()` → `performUpdate()`:

1. `getController('default')` logs in once and caches the `Controller` per site in `controllers`. node-unifi's own re-login is a no-op for an initialised controller, so an expired session is detected by `isAuthenticationError()` (401 or `api.err.LoginRequired`, **not** 403 = missing permission) and handled by `resetControllers()` + one retry — only if cached sessions were used.
2. `fetchSites()`, then for every site the fetch methods in `FETCH_METHODS` whose `update.*` flag is set. A failing site or endpoint is logged and skipped (reported in `info.lastError`), it does not abort the refresh.
3. `setClientOnlineStatus()` computes `is_online` from `last_seen_by_uap/usw` — skipped when client data is incomplete, otherwise every client would go offline.

The next refresh is always scheduled in `finally` (`scheduleNextUpdate`, `this.setTimeout`), with backoff 1x, 2x, 4x, 8x, 16x of the interval after consecutive failures, capped at 15 min but never below the interval. `trigger_update` runs a refresh without rescheduling; a scheduled refresh that collides with it reschedules itself. Diagnostic states `info.*` are written with `setStateChangedAsync` and must never break the loop.

Always use `this.setTimeout` / `this.clearTimeout` (adapter-core, auto-cleared on unload), never the globals.

### Filters

- **Objects filter** (`objectsFilter.<category>`, chips in the admin): names/IPs/MACs of objects to skip. For clients, `blacklistClients` turns it into a whitelist.
- **States filter** (`statesFilter.<category>`, multi-select in the admin): the admin stores only the selected **states**. `normalizeStatesFilter()` adds the channels above them (the filter is checked on every level of the tree) and the states in `STATE_DEPENDENCIES` (e.g. `is_online` needs `last_seen_by_uap/usw`). An empty selection means all states. Configurations of the old admin page, which stored the channels too, are read the same way.
- `blacklist`/`whitelist` are the names before 0.5.3; `onReady()` migrates them with `updateConfig()` (the instance restarts).

### Admin configuration

`admin/jsonConfig.json` (`common.adminUI.config = "json"`). The `options` of the `statesFilter.*` selects are **generated** from `admin/lib/objects_*.json` by `npm run build` / `npm run 2-jsonConfig` — do not edit them by hand. `test/config.test.js` fails if they are out of date.

Translations are the flat `admin/i18n/<lang>.json` files (`"i18n": true`), keys are the English texts of `jsonConfig.json`. The option descriptions are the `common.name` of the state definitions, so they are translation keys too — renaming a state name in `objects_*.json` needs the translations to be renamed as well. `npm run translate` fills missing languages from `en.json`.

Numbers in `native` may be strings: the old admin page stored every input as text. Parse them (`parseInt(String(...))`, `Number(...)`), as `onReady()` does.

### Misc conventions

- node-unifi 2 takes the site from the controller options; its methods have **no site parameter** (the adapter passed one to `createVouchers()` until this was fixed).
- `FORBIDDEN_CHARS` in `src/main.ts` is applied to every created object ID.
- Kept from the JS version on purpose: `createVouchers()` maps a quota of 0 to 1, values of unexpected types are converted with `toString()` in `applyJsonLogic()`, and `switchPoeOfPort()` fails for ports without a `port_overrides` entry (creating one was never implemented).
- `main.ts` exports a factory when required (compact mode) and self-starts when run directly.

## Tests

The unit tests in `test/*.test.js` load the compiled `build/main.js` with `proxyquire` (build first):

| File | Content |
| --- | --- |
| `test/lib/adapterMock.js` | `AdapterMock`: replaces `utils.Adapter` with an in-memory database of objects and states (all methods are sinon spies, `adapter.val(id)` reads a state); `createAdapter(config, stubs)` |
| `test/lib/fakeController.js` | HTTPS server that answers like a UniFi OS console, used with the **real** node-unifi. `responses['stat/sta'] = [...]` sets the data of a path, `requestsTo(path)` returns the received requests, `expireSession()` invalidates the login. The certificate in `test/fixtures` is a self-signed test certificate for 127.0.0.1. |
| `test/controller.test.js` | end-to-end against the fake controller: objects/states, re-login, vouchers, WLAN switch |
| `test/objects.test.js` | object creation from `admin/lib/objects_*.json`, filters, deleting vouchers/alarms, `is_online`, blocked clients |
| `test/control.test.js` | the writable states (`onStateChange`), PoE, vouchers |
| `test/refresh.test.js` | refresh loop: re-login, backoff, overlapping refreshes, failure isolation |
| `test/startup.test.js` | `onReady` (old text configs, migration, missing login), `handleError`, validation of the controller data |
| `test/config.test.js` | jsonConfig ↔ `native`, generated options, states filter normalization |
| `test/jsonLogic.test.js` | the json-logic operations and the option generator |

## Release flow

Changelog lives in `README.md` under the `### **WORK IN PROGRESS**` placeholder comment; `release-script` (config in `.releaseconfig.json`) moves it into `io-package.json` `common.news`. CI (`.github/workflows/test-and-release.yml`, ioBroker testing actions) type-checks, lints and runs `test:package`, then builds and runs `test:unit` and `test:integration` on Node 22/24/26 × Linux/Windows/macOS, and publishes to npm on version tags.
