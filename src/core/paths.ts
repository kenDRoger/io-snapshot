import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
    TEMP_SESSION_DIR_PREFIX,
    PID_FILE_NAME,
    LOCAL_BACKUP_DIR,
    BACKUP_EXT
} from './constants.js';

/** Cache of the per-project temp dir (unique md5 of cwd). */
let _tempSessionDirPath: string | null = null;

function getProjectHash(): string {
    return crypto.createHash('md5').update(process.cwd()).digest('hex');
}

export function getTempSessionDirPath(): string {
    if (_tempSessionDirPath) {
        return _tempSessionDirPath;
    }
    _tempSessionDirPath = path.join(os.tmpdir(), TEMP_SESSION_DIR_PREFIX + getProjectHash());
    return _tempSessionDirPath;
}

export function ensureTempSessionDir(): string {
    const dirPath = getTempSessionDirPath();
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
}

export function getPidFilePath(): string {
    return path.join(getTempSessionDirPath(), PID_FILE_NAME);
}

/** Primary backup lives beside session files in the OS temp dir. Creates nested dirs on call. */
export function getPrimaryBackupPath(filePath: string): string {
    const absoluteFilePath = path.resolve(process.cwd(), filePath);
    const relativePath = path.relative(process.cwd(), absoluteFilePath);
    const backupPath = path.join(getTempSessionDirPath(), 'backup', relativePath) + BACKUP_EXT;
    // Ensure the subdirectory structure exists
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    return backupPath;
}

/** Fallback backup lives in the project root (survives OS temp cleanup). Creates nested dirs on call. */
export function getLocalBackupPath(filePath: string): string {
    const absoluteFilePath = path.resolve(process.cwd(), filePath);
    const relativePath = path.relative(process.cwd(), absoluteFilePath);
    const backupPath = path.join(process.cwd(), LOCAL_BACKUP_DIR, relativePath) + BACKUP_EXT;
    // Ensure the subdirectory structure exists
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    return backupPath;
}
