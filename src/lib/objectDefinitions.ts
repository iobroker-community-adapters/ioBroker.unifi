import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ObjectDefinitions, StateOption, StateOptionGroup } from './types';

// admin/lib, seen from build/lib (and from src/lib when used by tasks.ts)
const OBJECTS_DIR = join(__dirname, '..', '..', 'admin', 'lib');

const cache = new Map<string, ObjectDefinitions>();

/**
 * Object definitions of admin/lib/objects_<name>.json
 *
 * @param name e.g. 'clients'
 */
export function loadObjectDefinitions(name: string): ObjectDefinitions {
    let objects = cache.get(name);
    if (!objects) {
        objects = JSON.parse(readFileSync(join(OBJECTS_DIR, `objects_${name}.json`), 'utf8')) as ObjectDefinitions;
        cache.set(name, objects);
    }
    return objects;
}

/**
 * IDs of all states below the definitions, e.g. `clients.client.mac`
 *
 * @param has definitions of the children
 * @param ids list to add the IDs to
 */
export function collectStateIds(has: ObjectDefinitions, ids: string[] = []): string[] {
    for (const [id, obj] of Object.entries(has)) {
        if (obj.type === 'state') {
            ids.push(id);
        } else if (obj.logic.has) {
            collectStateIds(obj.logic.has, ids);
        }
    }
    return ids;
}

/**
 * Options for the state filter of one category in admin/jsonConfig.json, grouped by the channel that
 * contains the states. The label is the state name, the description its title.
 *
 * @param category e.g. 'clients'
 */
export function buildStateOptions(category: string): StateOption[] | StateOptionGroup[] {
    const groups: StateOptionGroup[] = [];

    const addGroup = (containerId: string, has: ObjectDefinitions): void => {
        const items: StateOption[] = [];
        const children: [string, ObjectDefinitions][] = [];

        for (const [id, obj] of Object.entries(has)) {
            if (obj.type === 'state') {
                const item: StateOption = { label: id.split('.').pop() || id, value: id };
                if (typeof obj.common?.name === 'string') {
                    item.description = obj.common.name;
                }
                items.push(item);
            } else if ((obj.type === 'channel' || obj.type === 'device') && obj.logic.has) {
                children.push([id, obj.logic.has]);
            }
        }

        if (items.length) {
            groups.push({ label: containerId.split('.').slice(1).join(' › ') || category, items });
        }
        for (const [id, childHas] of children) {
            addGroup(id, childHas);
        }
    };

    const root = loadObjectDefinitions(category)[category];
    if (root.logic.has) {
        addGroup(category, root.logic.has);
    }

    return groups.length === 1 ? groups[0].items : groups;
}
