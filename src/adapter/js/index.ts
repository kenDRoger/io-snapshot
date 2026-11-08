import { glob } from 'tinyglobby';
import { injectRecorder, restore as jsRestore } from './transformer.js';
import { LOCAL_BACKUP_DIR, BACKUP_EXT } from '../../core/constants.js';
import type { Adapter } from '../types.js';

export async function inject(targetPattern?: string, force = false): Promise<void> {
    const defaultPattern = '**/*.{ts,tsx,js,jsx}';
    const pattern = targetPattern || defaultPattern;

    const files = await glob(pattern, {
        ignore: ['node_modules/**', '**/node_modules/**', `${LOCAL_BACKUP_DIR}/**`]
    });

    const sourceFiles = files.filter(f => !f.endsWith(BACKUP_EXT));

    if (sourceFiles.length === 0) {
        console.warn(`No JS/TS files found matching: ${pattern}`);
        return;
    }

    await injectRecorder(targetPattern, force);
}

export async function restore(targetPattern?: string | null, keepSnapshots = false): Promise<void> {
    await jsRestore(targetPattern, keepSnapshots);
}

export function getFileExtensions(): string[] {
    return ['.js', '.jsx', '.ts', '.tsx'];
}

// satisfies the Adapter contract even though the module is dynamically imported
export default { inject, restore, getFileExtensions } as Adapter;
