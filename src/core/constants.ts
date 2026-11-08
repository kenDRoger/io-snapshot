/** Fixed constants for the io-snapshot runtime.
 *  Source of truth: lib/core/constants.js (behavioral parity intended). */
export const DEFAULT_PORT = 9444;
export const DEFAULT_TIMEOUT = 30;
export const SNAPSHOT_FILE = '.snaps.jsonl';
export const CONFIG_FILE = '.iosnapshotrc.json';
export const BACKUP_EXT = '.snap.bak';

// Path-related constants
export const TEMP_SESSION_DIR_PREFIX = 'io-snapshot-session-';
export const PID_FILE_NAME = 'io-snapshot.pid';
export const LOCAL_BACKUP_DIR = '.io-snapshot-backups';
