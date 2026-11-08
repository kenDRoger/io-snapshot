import path from 'node:path';
import { glob } from 'tinyglobby';
import type { Adapter } from './types.js';

/** Multi-language adapter registry.
 *  Source of truth: lib/adapter/index.js — addition order determines priority. */

export const DEFAULT_PATTERNS: Record<Language, string[]> = {
    js: ['**/*.{js,jsx,ts,tsx}'],
    java: ['**/*.java']
};

export const GLOBAL_DEFAULT_PATTERN = '**/*.{js,jsx,ts,tsx,java}';

export type SupportedLanguage = 'js' | 'java';
export type Language = SupportedLanguage;

export async function detectLanguages(targetPattern?: string): Promise<Language[]> {
    if (targetPattern) {
        const files = await glob(targetPattern, {
            ignore: ['node_modules/**', '**/node_modules/**', '.io-snapshot-backups/**']
        });
        const languages = new Set<Language | null>(
            files.map(f => getLanguageFromExt(path.extname(f)))
        );
        return [...languages].filter((l): l is Language => l !== null);
    }

    // No target - check what files exist
    const jsFiles = await glob(DEFAULT_PATTERNS.js, { onlyFiles: true, ignore: ['node_modules/**'] });
    const javaFiles = await glob(DEFAULT_PATTERNS.java, { onlyFiles: true, ignore: ['node_modules/**'] });

    const languages: Language[] = [];
    if (javaFiles.length > 0) languages.push('java');
    if (jsFiles.length > 0) languages.push('js');

    return languages.length > 0 ? languages : ['js']; // default to js
}

function getLanguageFromExt(ext: string): Language | null {
    if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return 'js';
    if (ext === '.java') return 'java';
    return null;
}

export async function getAdapter(language: Language): Promise<Adapter> {
    if (language === 'js') {
        return (await import('./js/index.js')) as Adapter;
    }
    if (language === 'java') {
        return (await import('./java/index.js')) as Adapter;
    }
    throw new Error(`Unsupported language: ${language}`);
}

export type { Adapter };
