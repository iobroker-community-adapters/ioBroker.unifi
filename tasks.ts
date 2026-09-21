/*!
 * ioBroker build tasks
 *
 * npm run build            all steps
 * npm run 0-clean          delete build/
 * npm run 1-backend        compile src/ => build/
 * npm run 2-jsonConfig     fill the state filter options in admin/jsonConfig.json from admin/lib/objects_*.json
 */
import { fork } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildStateOptions } from './src/lib/objectDefinitions';

const STATES_FILTER_PREFIX = 'statesFilter.';

interface JsonConfigItem {
    items?: Record<string, JsonConfigItem>;
    options?: unknown[];
}

function clean(): void {
    rmSync(join(__dirname, 'build'), { recursive: true, force: true });
}

/** Compile the adapter backend: src/*.ts => build/*.js */
function buildBackend(): Promise<void> {
    return new Promise((resolve, reject) => {
        const script = join(__dirname, 'node_modules', 'typescript', 'bin', 'tsc');
        if (!existsSync(script)) {
            reject(new Error(`Cannot find execution file: ${script}`));
            return;
        }
        const child = fork(script, ['-p', join(__dirname, 'tsconfig.build.json')], { cwd: __dirname });
        child.on('close', code => (code ? reject(new Error(`tsc exit code: ${code}`)) : resolve()));
    });
}

/**
 * Call the callback for every state filter select of the jsonConfig
 *
 * @param config jsonConfig or one of its panels
 * @param callback called with the category, e.g. 'clients', and the select
 */
function forEachStatesFilter(config: JsonConfigItem, callback: (category: string, item: JsonConfigItem) => void): void {
    for (const [key, item] of Object.entries(config.items || {})) {
        if (key.startsWith(STATES_FILTER_PREFIX)) {
            callback(key.substring(STATES_FILTER_PREFIX.length), item);
        } else if (item.items) {
            forEachStatesFilter(item, callback);
        }
    }
}

function generateStateOptions(): void {
    const file = join(__dirname, 'admin', 'jsonConfig.json');
    const config = JSON.parse(readFileSync(file, 'utf8')) as JsonConfigItem;

    forEachStatesFilter(config, (category, item) => {
        item.options = buildStateOptions(category);
    });

    writeFileSync(file, `${JSON.stringify(config, null, 4)}\n`);
}

if (process.argv.includes('--0-clean')) {
    clean();
} else if (process.argv.includes('--1-backend')) {
    buildBackend().catch((e: unknown) => {
        console.error(`Cannot build backend: ${e as string}`);
        process.exit(1);
    });
} else if (process.argv.includes('--2-jsonConfig')) {
    generateStateOptions();
} else {
    clean();
    buildBackend()
        .then(() => generateStateOptions())
        .catch((e: unknown) => {
            console.error(`Cannot build: ${e as string}`);
            process.exit(1);
        });
}
