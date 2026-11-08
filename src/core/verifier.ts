import SuperJSON from 'superjson';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import diff, { type Difference } from 'microdiff';
import { glob } from 'tinyglobby';
import { SNAPSHOT_FILE } from './constants.js';
import { loadConfig } from './config.js';
import { log } from './logger.js';

export interface SnapshotEntry {
    fnName: string;
    args: unknown[];
    result: unknown;
    at?: string;
    lang?: string;
}

export interface VerifySingleResult {
    passed: boolean;
    error?: string;
    skipped?: boolean;
    failed?: number;
    total?: number;
}

const DEFAULT_FILE_PATTERN = '**/*.{ts,tsx,js,jsx,java}';

/** Robustly parses one JSONL snapshot line (SuperJSON first, plain JSON second). */
function parseSnapshotLine(line: string): SnapshotEntry | null {
    try {
        const parsed = SuperJSON.parse<SnapshotEntry>(line);
        if (parsed?.fnName) return parsed;
    } catch (error) {
        log.warn(`Failed to parse snapshot line: ${(error as Error).message}`);
    }
    try {
        const parsed = JSON.parse(line) as SnapshotEntry;
        if (parsed?.fnName) return parsed;
    } catch (error) {
        log.warn(`Failed to parse snapshot line as JSON: ${(error as Error).message}`);
    }
    return null;
}

function readAllSnapshots(): SnapshotEntry[] | null {
    if (!fs.existsSync(path.resolve(process.cwd(), SNAPSHOT_FILE))) {
        log.error(`No snapshots found! Run 'io-snapshot record' first.`);
        return null;
    }
    const fileContent = fs.readFileSync(path.resolve(process.cwd(), SNAPSHOT_FILE), 'utf8');
    return fileContent
        .split('\n')
        .filter(line => line.trim())
        .map(parseSnapshotLine)
        .filter((s): s is SnapshotEntry => s !== null);
}

/** Replays every recorded snapshot of `fnName` through `newFn` and reports drift via microdiff. */
export async function verify(newFn: (...args: unknown[]) => unknown, fnName: string): Promise<VerifySingleResult> {
    const config = loadConfig();
    void config; // port currently unused on this path; kept for behavioral parity with lib/core/verifier.js
    const allSnapshots = readAllSnapshots();
    if (allSnapshots === null) {
        return { passed: false, error: 'no_snapshots' };
    }

    const snapshots = allSnapshots.filter(s => s?.fnName === fnName);

    if (snapshots.length === 0) {
        log.info(`No snapshots found for function '${fnName}'.`);
        return { passed: true, skipped: true };
    }

    let allPassed = true;
    let failedCount = 0;

    for (const snap of snapshots) {
        const newResult = await newFn(...snap.args);
        // microdiff's own typings are narrower than its runtime (it handles scalar roots);
        // lib/core/verifier.js relies on this, so the cast preserves behavior under strict TS.
        const changes: Difference[] = diff(snap.result as unknown as Record<string, unknown>, newResult as unknown as Record<string, unknown>);

        if (changes.length > 0) {
            log.error(`Drift detected in ${fnName}!`);
            console.dir(changes, { depth: null });
            allPassed = false;
            failedCount++;
        } else {
            log.success(`${fnName} passed semantic check.`);
        }
    }

    if (allPassed && snapshots.length > 0) {
        log.success(`All ${snapshots.length} snapshots passed for ${fnName}.`);
    }

    return { passed: allPassed, failed: failedCount, total: snapshots.length };
}

/** Replays every function that has snapshots, discovering the current implementation via dynamic import. */
export async function verifyDir(targetPattern?: string): Promise<void> {
    const allSnapshots = readAllSnapshots();
    if (allSnapshots === null) {
        process.exit(1);
    }

    const fnNames = [...new Set(allSnapshots.map(s => s.fnName))];

    if (fnNames.length === 0) {
        log.warn('No snapshots to verify.');
        return;
    }

    const pattern = targetPattern || DEFAULT_FILE_PATTERN;

    const files = await glob(pattern, {
        ignore: ['node_modules/**', '**/node_modules/**', '.io-snapshot-backups/**']
    });
    const allFiles = files.filter(f => !f.includes('.snap.bak'));

    if (allFiles.length === 0) {
        log.warn('No source files found.');
        return;
    }

    log.info(`Verifying ${fnNames.length} functions against ${allSnapshots.length} snapshots...`);

    let totalPassed = true;

    for (const fnName of fnNames) {
        let found = false;

        for (const file of allFiles) {
            if (file.endsWith('.java')) {
                // Java verification not yet implemented in JS test runner
                continue;
            }
            try {
                const absolutePath = path.resolve(process.cwd(), file);
                const fileUrl = pathToFileURL(absolutePath).href;
                const mod = (await import(/* @vite-ignore */ fileUrl)) as Record<string, unknown>;
                const fn = mod[fnName];

                if (!fn) {
                    continue;
                }

                found = true;
                log.info(`Checking function '${fnName}' in ${file}`);
                assertInvocable(fn);
                const result = await verify(fn as (...args: unknown[]) => unknown, fnName);
                if (result && !result.passed) {
                    totalPassed = false;
                }
                break;
            } catch (error) {
                log.warn(`Could not load function from ${file}: ${(error as Error).message}`);
            }
        }

        if (!found) {
            // For Java, we might want a different warning or no warning if it's handled elsewhere
            const isProbablyJava = allSnapshots.some(s => s.fnName === fnName && s.lang === 'java');
            if (!isProbablyJava) {
                log.warn(`Function '${fnName}' not found in any source file.`);
            }
        }
    }

    if (totalPassed) {
        log.divider('SUCCESS');
        log.success('All verifications passed!');
        process.exit(0);
    } else {
        log.divider('FAILURE');
        log.error('Some verifications failed.');
        process.exit(1);
    }
}

function assertInvocable(fn: unknown): asserts fn is (...args: unknown[]) => unknown {
    if (typeof fn !== 'function') {
        throw new Error('found symbol is not callable');
    }
}
