import { add_operation, apply, type RulesLogic } from 'json-logic-js';

import { DPI_APPLICATIONS, DPI_CATEGORIES } from './dpiNames';
import type { ObjectRule } from './types';

// Additional operations for the rules in admin/lib/objects_*.json

/** Convert seconds (UNIX time of the controller) to a timestamp in ms, the format of ioBroker (role `value.time`) */
add_operation('secondsToMs', (a: number | null): number | null =>
    typeof a === 'number' && Number.isFinite(a) && a > 0 ? a * 1000 : null,
);

/** Convert to string */
add_operation('string', (a: { toString(): string }): string => a.toString());

/** Join the items of an array with a separator, e.g. the IPv6 addresses of a WAN port; no array stays as it is */
add_operation('join', (a: unknown, separator: string): unknown =>
    Array.isArray(a) ? a.filter(item => item !== null && item !== undefined && item !== '').join(separator) : a,
);

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
