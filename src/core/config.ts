import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE } from './constants.js';

/** Shape of the optional `.iosnapshotrc.json` the user may leave in the project root.
 *  Every field is optional — the CLI falls back to built-in defaults. */
export interface IoSnapshotConfig {
    port?: number;
    timeout?: number;
    cors?: { origin?: string };
    /** Unrecognized keys are tolerated (forward compatibility) but only known fields are read. */
    [key: string]: unknown;
}

/** Reads `<cwd>/.iosnapshotrc.json`, returning `{}` when absent or unparsable. */
export function loadConfig(): IoSnapshotConfig {
    const configPath = path.resolve(process.cwd(), CONFIG_FILE);

    if (!fs.existsSync(configPath)) {
        return {};
    }

    try {
        const content = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(content) as IoSnapshotConfig;
    } catch (error) {
        console.warn(`[io-snapshot] Warning: Failed to parse config file: ${(error as Error).message}`);
        return {};
    }
}

/** Accepts an int between 1..65535; throws otherwise. */
export function validatePort(port: unknown): number {
    const portNum = parseInt(String(port), 10);
    if (isNaN(portNum) || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        throw new Error(`Invalid port: ${port}. Must be an integer between 1 and 65535.`);
    }
    return portNum;
}

/** Accepts an int >= 1; throws otherwise. */
export function validateTimeout(timeout: unknown): number {
    const timeoutNum = parseInt(String(timeout), 10);
    if (isNaN(timeoutNum) || !Number.isInteger(timeoutNum) || timeoutNum < 1) {
        throw new Error(`Invalid timeout: ${timeout}. Must be a positive integer.`);
    }
    return timeoutNum;
}

/** Accepts a non-empty awk-ish glob string; throws otherwise. */
export function validateFilePattern(pattern: unknown): string {
    if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
        throw new Error('File pattern must be a non-empty string.');
    }
    return pattern.trim();
}
