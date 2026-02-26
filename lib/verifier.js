import SuperJSON from 'superjson';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import diff from 'microdiff';
import { glob } from 'tinyglobby';
import { SNAPSHOT_FILE } from './constants.js';
import { loadConfig } from './config.js';
import { log } from './logger.js';

export async function verify(newFn, fnName) {
    const config = loadConfig();
    const port = config.port || 9444;

    if (!fs.existsSync(path.resolve(process.cwd(), SNAPSHOT_FILE))) {
        log.error(`No snapshots found! Run 'io-snapshot record' first.`);
        return { passed: false, error: 'no_snapshots' };
    }

    const fileContent = fs.readFileSync(path.resolve(process.cwd(), SNAPSHOT_FILE), 'utf8');
    const snapshots = fileContent.split('\n')
        .filter(line => line.trim())
        .map(line => {
            try {
                const parsed = SuperJSON.parse(line);
                if (parsed?.fnName) return parsed;
            } catch (error) {
                log.warn(`Failed to parse snapshot line: ${error.message}`);
            }
            try {
                const parsed = JSON.parse(line);
                if (parsed?.fnName) return parsed;
            } catch (error) {
                log.warn(`Failed to parse snapshot line as JSON: ${error.message}`);
            }
            return null;
        })
        .filter(s => s?.fnName === fnName);

    if (snapshots.length === 0) {
        log.info(`No snapshots found for function '${fnName}'.`);
        return { passed: true, skipped: true };
    }

    let allPassed = true;
    let failedCount = 0;

    for (const snap of snapshots) {
        const newResult = await newFn(...snap.args);
        const changes = diff(snap.result, newResult);

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

export async function verifyDir(targetPattern) {
    if (!fs.existsSync(path.resolve(process.cwd(), SNAPSHOT_FILE))) {
        log.error(`No snapshots found! Run 'io-snapshot record' first.`);
        process.exit(1);
    }

    const fileContent = fs.readFileSync(path.resolve(process.cwd(), SNAPSHOT_FILE), 'utf8');
    const allSnapshots = fileContent.split('\n')
        .filter(line => line.trim())
        .map(line => {
            try {
                const parsed = SuperJSON.parse(line);
                if (parsed?.fnName) return parsed;
            } catch (error) {
                log.warn(`Failed to parse snapshot line: ${error.message}`);
            }
            try {
                const parsed = JSON.parse(line);
                if (parsed?.fnName) return parsed;
            } catch (error) {
                log.warn(`Failed to parse snapshot line as JSON: ${error.message}`);
            }
            return null;
        })
        .filter(s => s?.fnName);

    const fnNames = [...new Set(allSnapshots.map(s => s.fnName))];

    if (fnNames.length === 0) {
        log.warn('No snapshots to verify.');
        return;
    }

    let allFiles = [];

    if (targetPattern) {
        const files = await glob(targetPattern);
        const tsFiles = files.filter(f => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.snap.bak'));
        const jsFiles = files.filter(f => (f.endsWith('.js') || f.endsWith('.jsx')) && !f.includes('.snap.bak'));
        allFiles = [...tsFiles, ...jsFiles];
    } else {
        const allSourceFiles = await glob('**/*.{ts,tsx,js,jsx}', {
            ignore: ['node_modules/**', '**/node_modules/**']
        });
        allFiles = allSourceFiles.filter(f => !f.includes('.snap.bak'));
    }

    if (allFiles.length === 0) {
        log.warn('No source files found.');
        return;
    }

    log.info(`Verifying ${fnNames.length} functions against ${allSnapshots.length} snapshots...`);

    let totalPassed = true;

    for (const fnName of fnNames) {
        let found = false;

        for (const file of allFiles) {
            try {
                const absolutePath = path.resolve(process.cwd(), file);
                const fileUrl = pathToFileURL(absolutePath).href;
                const mod = await import(fileUrl);
                const fn = mod[fnName];

                if (!fn) {
                    continue;
                }

                found = true;
                log.info(`Checking function '${fnName}' in ${file}`);
                const result = await verify(fn, fnName);
                if (result && !result.passed) {
                    totalPassed = false;
                }
                break;
            } catch (error) {
                log.warn(`Could not load function from ${file}: ${error.message}`);
            }
        }

        if (!found) {
            log.warn(`Function '${fnName}' not found in any source file.`);
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
