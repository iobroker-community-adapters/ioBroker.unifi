// Object structure of version 3: the data of a device as in the official UniFi Network API, and the move of the
// objects, history settings and states filters of version 2 and older to the new IDs.

import type { UnifiDevice } from './types';

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Prepares the data of a device for the object definitions, like the official UniFi Network API: one entry per port
 * with its settings (`port_table` + `port_overrides`), and one `statistics` (`sys_stats` + `system-stats`).
 * The original properties stay unchanged, the commands still use them.
 *
 * @param device device as returned by the controller
 */
export function prepareDevice(device: UnifiDevice): UnifiDevice {
    const prepared: UnifiDevice = { ...device };
    if (Array.isArray(device.port_table)) {
        const overrides = Array.isArray(device.port_overrides) ? device.port_overrides : [];
        prepared.ports = (device.port_table as { port_idx?: number }[]).map(port => ({
            ...port,
            settings: overrides.find(override => override.port_idx === port.port_idx) ?? null,
        }));
    }
    const sysStats = device.sys_stats;
    const systemStats = device['system-stats'];
    if (isObject(sysStats) || isObject(systemStats)) {
        prepared.statistics = {
            ...(isObject(sysStats) ? sysStats : {}),
            ...(isObject(systemStats) ? systemStats : {}),
        };
    }
    return prepared;
}

/** States of a port that lost the prefix `port_` */
const PORT_STATES: Record<string, string> = {
    port_poe: 'poe',
    port_poe_enabled: 'poe_enabled',
    port_poe_cycle: 'poe_cycle',
};

/** Client states of version 2 that have no successor (internal values of the controller) */
const REMOVED_CLIENT_STATES = /^(is_guest_by_(uap|ugw|usw)|uptime_by_(uap|ugw|usw)|last_seen_by_ugw)$/;

/** A path of the device folder: `rest` is the part below the device, e.g. `port_table.port_1.port_poe` */
function moveDevicePath(rest: string, port: (key: string) => string): string | null | undefined {
    const parts = rest.split('.');
    switch (parts[0]) {
        case 'port_table':
            if (parts.length === 1) {
                return 'ports';
            }
            if (parts.length === 2) {
                return `ports.${parts[1]}`;
            }
            return `ports.${parts[1]}.${port(parts.slice(2).join('.'))}`;
        case 'port_overrides':
            if (parts.length === 1) {
                // the folder of all port settings has no successor, the settings are below each port
                return null;
            }
            return ['ports', parts[1], 'settings', ...parts.slice(2)].join('.');
        case 'sys_stats':
        case 'system-stats':
            return ['statistics', ...parts.slice(1)].join('.');
        case 'radio_table_stats':
            return ['radios', ...parts.slice(1)].join('.');
        case 'last_uplink':
            return ['uplink', ...parts.slice(1)].join('.');
        default:
            return undefined;
    }
}

/**
 * New ID of an object of version 2 and older, relative to the namespace (e.g. `default.devices.<mac>.port_table`).
 *
 * @param id ID without the namespace
 * @returns the new ID, `null` if the object is removed without successor, `undefined` if it did not change
 */
export function migrateObjectId(id: string): string | null | undefined {
    const parts = id.split('.');
    if (parts.length < 2) {
        return undefined;
    }
    const [site, category] = parts;
    if (category === 'alarms' || category === 'gateway_traffic') {
        // UniFi Network 10 and newer have no alarms, Network 11 no gateway statistics
        return null;
    }
    if (category === 'wan' && parts[2] === 'wan') {
        return [site, 'wan', 'wan1', ...parts.slice(3)].join('.');
    }
    if (category === 'clients' && parts.length === 4 && REMOVED_CLIENT_STATES.test(parts[3])) {
        return null;
    }
    if (category === 'devices' && parts.length >= 4) {
        const moved = moveDevicePath(parts.slice(3).join('.'), key => PORT_STATES[key] ?? key);
        return typeof moved === 'string' ? [...parts.slice(0, 3), moved].join('.') : moved;
    }
    return undefined;
}

/**
 * New path of an entry of the states filter of version 2 and older (e.g. `devices.device.port_table.port.port_poe`).
 *
 * @param path path of the states filter
 * @returns the new path, `null` if the state was removed, `undefined` if it did not change
 */
export function migrateFilterPath(path: string): string | null | undefined {
    const parts = path.split('.');
    if (parts[0] === 'alarms' || parts[0] === 'gateway_traffic') {
        return null;
    }
    if (parts[0] === 'clients' && parts.length === 3 && REMOVED_CLIENT_STATES.test(parts[2])) {
        return null;
    }
    if (parts[0] === 'devices' && parts.length >= 3) {
        const rest = parts.slice(2);
        // the filter uses fixed names for the repeated folders: port_table.port.<state>, radio_table_stats.stat
        if (rest[0] === 'port_overrides' && rest.length === 1) {
            return 'devices.device.ports.port.settings';
        }
        const moved = moveDevicePath(rest.join('.'), key => PORT_STATES[key] ?? key);
        return typeof moved === 'string' ? `devices.device.${moved}` : moved;
    }
    return undefined;
}
