import type { RulesLogic } from 'json-logic-js';

/** Object filter: names, IPs or MACs of the objects to exclude (or include in whitelist mode for clients) */
export interface UnifiObjectsFilter {
    clients: string[];
    devices: string[];
    wlans: string[];
    networks: string[];
    health: string[];
}

/** State filter: the selected states per category, e.g. `clients.client.mac`. Empty = all states */
export interface UnifiStatesFilter {
    sysinfo: string[];
    clients: string[];
    devices: string[];
    wlans: string[];
    networks: string[];
    health: string[];
    vouchers: string[];
    alarms: string[];
    dpi: string[];
    gateway_traffic: string[];
}

export type StatesFilterCategory = keyof UnifiStatesFilter;

/** A json-logic rule, or the name of a property of the data (short for `{ "var": name }`) */
export type ObjectRule = RulesLogic | string;

/** Definition of an object in admin/lib/objects_*.json. Fixed values win over the rules in `logic`. */
export interface ObjectDefinition {
    _id?: string;
    type?: ioBroker.ObjectType;
    common?: Record<string, unknown>;
    native?: Record<string, unknown>;
    value?: unknown;
    logic: {
        _id?: ObjectRule;
        type?: ObjectRule;
        common?: Record<string, ObjectRule>;
        native?: Record<string, ObjectRule>;
        value?: ObjectRule;
        /** Property of the data that contains the data of the children, `_self` for the data itself */
        has_key?: string;
        has?: ObjectDefinitions;
    };
}

export type ObjectDefinitions = Record<string, ObjectDefinition>;

/** Object as created from a definition and the data */
export interface CreatedObject {
    _id: string | null;
    type: ioBroker.ObjectType | null;
    common: Record<string, unknown>;
    native: Record<string, unknown>;
    value?: unknown;
}

/** Option of a state filter in admin/jsonConfig.json */
export interface StateOption {
    label: string;
    value: string;
    description?: string;
}

export interface StateOptionGroup {
    label: string;
    items: StateOption[];
}

/** Error of node-unifi: an axios error or an error with the `meta.msg` of the controller as message */
export interface UnifiError extends Error {
    code?: string;
    response?: {
        status?: number;
        data?: {
            meta?: {
                msg?: string;
            };
        };
    };
}

// Only the properties used by the adapter are listed. The data is also processed as a whole by the
// rules in admin/lib/objects_*.json.

export interface UnifiSite {
    name: string;
    [key: string]: unknown;
}

export interface UnifiClient {
    mac: string;
    ip?: string;
    name?: string;
    hostname?: string;
    [key: string]: unknown;
}

export interface UnifiBlockedClient {
    mac: string;
    [key: string]: unknown;
}

export interface UnifiPortOverride {
    port_idx: number;
    poe_mode?: string;
    [key: string]: unknown;
}

export interface UnifiDevice {
    mac: string;
    ip?: string;
    name?: string;
    device_id: string;
    port_overrides?: UnifiPortOverride[];
    [key: string]: unknown;
}

export interface UnifiNamedItem {
    name?: string;
    [key: string]: unknown;
}

export interface UnifiHealth {
    subsystem?: string;
    [key: string]: unknown;
}

export interface UnifiVoucher {
    code: string;
    used: number;
    [key: string]: unknown;
}

export interface UnifiDpiStats {
    by_cat?: unknown[];
    by_app?: unknown[];
    [key: string]: unknown;
}

export interface UnifiAlarm {
    _id: string;
    [key: string]: unknown;
}
