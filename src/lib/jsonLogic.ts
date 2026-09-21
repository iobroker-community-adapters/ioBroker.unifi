import { add_operation, apply, type RulesLogic } from 'json-logic-js';

import { DPI_APPLICATIONS, DPI_CATEGORIES } from './dpiNames';
import type { ObjectRule } from './types';

const DAY = 1000 * 60 * 60 * 24;

/**
 * Local date as `yyyy-mm-dd` or `yyyy-mm-dd HH:MM:ss`, like the dateformat package that was used before.
 *
 * @param date date to format
 * @param withTime add the time
 */
function formatDate(date: Date, withTime: boolean): string {
    if (isNaN(date.getTime())) {
        // same as dateformat, which threw on invalid dates
        throw new TypeError('Invalid date');
    }
    const pad = (n: number): string => n.toString().padStart(2, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

    return withTime ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` : day;
}

// Additional operations for the rules in admin/lib/objects_*.json

/** Convert seconds to date time */
add_operation('secondsToDateTime', (a: number): string => formatDate(new Date(a * 1000), true));

/** Convert seconds to hours */
add_operation('secondsToHours', (a: number): string => `${Math.floor(a / 60)}:${`0${Math.floor(a % 60)}`.slice(-2)}`);

/** Convert to string */
add_operation('string', (a: { toString(): string }): string => a.toString());

/** Check if not null */
add_operation('notNull', (a: unknown): boolean => a !== null);

/** Return b if a is not null, otherwise c */
add_operation('ifNotNull', (a: unknown, b: unknown, c: unknown): unknown => (a !== null ? b : c));

/** Return b if a is not null and true, otherwise c */
add_operation('ifNotNullBoolisTrue', (a: unknown, b: unknown, c: unknown): unknown => (a !== null && a ? b : c));

/** Cleanup for use as ID */
add_operation('cleanupForUseAsId', (a: string | null): string | null => {
    if (a === null) {
        return null;
    }

    const FORBIDDEN_CHARS = /[\][*.,;'"`<>\\?\s]/g;

    return a.replace(FORBIDDEN_CHARS, '_').toLowerCase();
});

/** Convert timestamp to date */
add_operation('timestampToDate', (a: number): string => formatDate(new Date(a), false));

/** Convert timestamp to date time */
add_operation('timestampToDateTime', (a: number): string => formatDate(new Date(a), true));

/** Add the days between the timestamp b and now to a */
add_operation('timestampDiffInDaysToNow', (a: number, b: number): number => {
    const diffDays = parseInt(String((Date.now() - new Date(b).getTime()) / DAY), 10);

    return a + diffDays;
});

/** Replace the MAC address in an alarm message with the device name, if it exists */
add_operation('alarmPrepareMessage', (msg: string, mac?: string, name?: string): string => {
    if (mac && name) {
        if (msg.includes('{gw}')) {
            return msg.replace('{gw}', `${name}:`);
        }
        if (msg.includes('{dm}')) {
            return msg.replace('{dm}', `${name}:`);
        }
        if (msg.includes('{sw}')) {
            return msg.replace('{sw}', `${name}:`);
        }
        if (msg.includes('{ap}')) {
            return msg.replace('{ap}', `${name}:`);
        }
        return msg.replace(`[${mac}]`, ` - ${name}:`);
    }
    return msg;
});

/** Translate PoE mode (off / auto) to boolean */
add_operation('poeMode', (a: string | null): boolean => a === 'auto');

/** Translate category code to name */
add_operation('translateCatCodeToName', (a: number): string =>
    Object.prototype.hasOwnProperty.call(DPI_CATEGORIES, a) ? DPI_CATEGORIES[a] : 'unknown',
);

/** Translate category and application code to the application name */
add_operation('translateAppCodeToName', (catId: number | string, appId: number | string): string => {
    const id = (parseInt(String(catId)) << 16) + parseInt(String(appId));

    return Object.prototype.hasOwnProperty.call(DPI_APPLICATIONS, id) ? DPI_APPLICATIONS[id] : 'unknown';
});

/**
 * Apply a rule of admin/lib/objects_*.json to the data
 *
 * @param rule json-logic rule or the name of a property
 * @param data data from the controller
 */
export function applyRule(rule: ObjectRule, data: unknown): unknown {
    const logic: RulesLogic = typeof rule === 'string' ? { var: [rule] } : rule;

    return apply(logic, data) as unknown;
}
