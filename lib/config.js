import fs from 'fs';
import path from 'path';
import { CONFIG_FILE } from './constants.js';

export function loadConfig() {
    const configPath = path.resolve(process.cwd(), CONFIG_FILE);

    if (!fs.existsSync(configPath)) {
        return {};
    }

    try {
        const content = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`[io-snapshot] Warning: Failed to parse config file: ${error.message}`);
        return {};
    }
}

export function validatePort(port) {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        throw new Error(`Invalid port: ${port}. Must be an integer between 1 and 65535.`);
    }
    return portNum;
}

export function validateTimeout(timeout) {
    const timeoutNum = parseInt(timeout, 10);
    if (isNaN(timeoutNum) || !Number.isInteger(timeoutNum) || timeoutNum < 1) {
        throw new Error(`Invalid timeout: ${timeout}. Must be a positive integer.`);
    }
    return timeoutNum;
}

export function validateFilePattern(pattern) {
    if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
        throw new Error('File pattern must be a non-empty string.');
    }
    return pattern.trim();
}
