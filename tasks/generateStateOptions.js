'use strict';

/*
 * Fills the options of the state filters in admin/jsonConfig.json from the object
 * definitions in admin/lib/objects_*.json. Run it after changing these files:
 *
 *     node tasks/generateStateOptions.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const JSON_CONFIG_FILE = path.join(ADMIN_DIR, 'jsonConfig.json');
const STATES_FILTER_PREFIX = 'statesFilter.';

/**
 * Options for the state filter of one category, grouped by the channel that
 * contains the states. The label is the state name, the description its title.
 *
 * @param {string} category e.g. 'clients'
 * @returns {object[]}
 */
function buildStateOptions(category) {
    const objects = JSON.parse(fs.readFileSync(path.join(ADMIN_DIR, 'lib', `objects_${category}.json`), 'utf8'));
    const groups = [];

    const addGroup = (containerId, has) => {
        const items = [];
        const children = [];

        for (const [id, obj] of Object.entries(has)) {
            if (obj.type === 'state') {
                const item = { label: id.split('.').pop(), value: id };
                if (obj.common && typeof obj.common.name === 'string') {
                    item.description = obj.common.name;
                }
                items.push(item);
            } else if ((obj.type === 'channel' || obj.type === 'device') && obj.logic && obj.logic.has) {
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

    addGroup(category, objects[category].logic.has);

    return groups.length === 1 ? groups[0].items : groups;
}

/**
 * Call the callback for every state filter select in the jsonConfig.
 *
 * @param {object} config
 * @param {(category: string, item: object) => void} callback
 */
function forEachStatesFilter(config, callback) {
    for (const [key, item] of Object.entries(config.items || {})) {
        if (key.startsWith(STATES_FILTER_PREFIX)) {
            callback(key.substring(STATES_FILTER_PREFIX.length), item);
        } else if (item.items) {
            forEachStatesFilter(item, callback);
        }
    }
}

if (require.main === module) {
    const config = JSON.parse(fs.readFileSync(JSON_CONFIG_FILE, 'utf8'));

    forEachStatesFilter(config, (category, item) => {
        item.options = buildStateOptions(category);
    });

    fs.writeFileSync(JSON_CONFIG_FILE, `${JSON.stringify(config, null, 4)}\n`);
    console.log(`Updated ${path.relative(process.cwd(), JSON_CONFIG_FILE)}`);
}

module.exports = { buildStateOptions, forEachStatesFilter };
