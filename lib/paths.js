import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
    TEMP_SESSION_DIR_PREFIX,
    PID_FILE_NAME,
    LOCAL_BACKUP_DIR,
    BACKUP_EXT
} from './constants.js';

let _tempSessionDirPath = null;

function getProjectHash() {
    return crypto.createHash('md5').update(process.cwd()).digest('hex');
}

export function getTempSessionDirPath() {
    if (_tempSessionDirPath) {
        return _tempSessionDirPath;
    }
    _tempSessionDirPath = path.join(os.tmpdir(), TEMP_SESSION_DIR_PREFIX + getProjectHash());
    return _tempSessionDirPath;
}

export function ensureTempSessionDir() {
    const dirPath = getTempSessionDirPath();
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

export function getPidFilePath() {
    return path.join(getTempSessionDirPath(), PID_FILE_NAME);
}

// Gets the path for the primary backup in the OS temp directory
export function getPrimaryBackupPath(filePath) {
    const absoluteFilePath = path.resolve(process.cwd(), filePath);
    const relativePath = path.relative(process.cwd(), absoluteFilePath);
    const backupPath = path.join(getTempSessionDirPath(), 'backup', relativePath) + BACKUP_EXT;
    // Ensure the subdirectory structure exists
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    return backupPath;
}

// Gets the path for the fallback backup in the project's root directory
export function getLocalBackupPath(filePath) {
    const absoluteFilePath = path.resolve(process.cwd(), filePath);
    const relativePath = path.relative(process.cwd(), absoluteFilePath);
    const backupPath = path.join(process.cwd(), LOCAL_BACKUP_DIR, relativePath) + BACKUP_EXT;
    // Ensure the subdirectory structure exists
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    return backupPath;
}
