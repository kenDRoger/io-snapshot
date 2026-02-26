#!/usr/bin/env node
import { program } from 'commander';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { SNAPSHOT_FILE } from '../lib/constants.js';
import { loadConfig, validatePort, validateTimeout, validateFilePattern } from '../lib/config.js';
import { log } from '../lib/logger.js';
import { getPidFilePath, ensureTempSessionDir } from '../lib/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function savePid(pid) {
    const pidPath = getPidFilePath();
    ensureTempSessionDir();
    fs.writeFileSync(pidPath, String(pid));
}

function getSavedPid() {
    const pidPath = getPidFilePath();
    if (fs.existsSync(pidPath)) {
        return parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
    }
    return null;
}

function removePid() {
    const pidPath = getPidFilePath();
    if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
    }
}

async function daemonRequest(endpoint, port, method = 'POST') {
    return new Promise((resolve, reject) => {
        const req = http.request(`http://localhost:${port}${endpoint}`, { method }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(data);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

program
    .name('io-snapshot')
    .description('Capture and compare function behavior snapshots for zero-regression refactoring');

program
    .command('inject [target]')
    .description('Inject recorder into target files (for explicit use)')
    .option('-f, --force', 'Force re-inject even if already injected')
    .action(async (target, opts) => {
        try {
            if (target) validateFilePattern(target);
        } catch (error) {
            log.error(error.message);
            process.exit(1);
        }

        const { injectRecorder } = await import('../lib/transformer.js');
        await injectRecorder(target, opts.force);
    });

program
    .command('record [target]')
    .description('Inject, start daemon, and begin recording snapshots')
    .option('-p, --port <port>', 'Port to run the daemon on')
    .option('-t, --timeout <minutes>', 'Auto-shutdown after N minutes of inactivity')
    .option('-f, --force', 'Force re-inject even if already injected')
    .action(async (target, opts) => {
        try {
            if (opts.port) validatePort(opts.port);
            if (opts.timeout) validateTimeout(opts.timeout);
            if (target) validateFilePattern(target);
        } catch (error) {
            log.error(error.message);
            process.exit(1);
        }

        const config = loadConfig();
        const port = opts.port || config.port || 9444;
        const timeout = opts.timeout || config.timeout || 30;

        log.divider('IMPORTANT');
        log.info('Run this command FIRST,');
        log.info('         THEN start your app!');
        log.divider();

        log.workflow([
            'io-snapshot record  → Inject recorder + start background daemon',
            'npm run dev         → Start your app (daemon MUST be running)',
            'Interact with app   → Use your app to capture real-world data',
            'io-snapshot stop    → Stop recording and restore your original code',
            'Modify your code    → Perform your refactoring or changes',
            'io-snapshot test    → Verify new code against captured snapshots'
        ]);

        const snapshotPath = path.resolve(process.cwd(), SNAPSHOT_FILE);
        fs.writeFileSync(snapshotPath, '');
        log.info('Cleared previous snapshot file for a fresh session.');

        log.info('Checking for existing session...');
        const savedPid = getSavedPid();
        if (savedPid) {
            try {
                process.kill(savedPid, 0);
                log.divider();
                log.warn('io-snapshot is already running!');
                log.warn(`A daemon is active (PID: ${savedPid})`);
                log.warn('Please run "io-snapshot stop" first before starting a new session.');
                log.divider();
                process.exit(1);
            } catch {
                removePid();
            }
        }

        log.step(1, 'Injecting recorder into files...');
        const { injectRecorder } = await import('../lib/transformer.js');
        await injectRecorder(target, opts.force);

        log.step(2, 'Starting daemon...');
        const env = {
            ...process.env,
            IOSNAP_DAEMON_PORT: String(port),
            IOSNAP_DAEMON_CORS: '*'
        };

        const child = spawn(process.execPath, [path.join(__dirname, '../lib/daemon.js')], {
            cwd: process.cwd(),
            stdio: 'ignore',
            env,
            detached: true
        });

        child.unref();
        savePid(child.pid);
        log.success(`Daemon started on port ${port} (PID: ${child.pid})`);

        await new Promise(resolve => setTimeout(resolve, 1000));

        log.step(3, 'Starting recording...');

        try {
            await daemonRequest('/record', port);
            log.success('Recording active.');
            log.info(`Snapshots will be saved to: ${snapshotPath}`);
            log.divider();
            log.success('NOW START YOUR APP (e.g., npm run dev)');
            log.info('Interact with your app to capture snapshots.');
            log.info('Run "io-snapshot stop" when done to restore original code.');
            log.divider();
        } catch (error) {
            log.error(`Failed to start recording: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('stop')
    .description('Stop recording, stop daemon, and restore original code')
    .option('-p, --port <port>', 'Port where the daemon is running')
    .action(async (opts) => {
        try {
            if (opts.port) validatePort(opts.port);
        } catch (error) {
            log.error(error.message);
            process.exit(1);
        }

        const config = loadConfig();
        const port = opts.port || config.port || 9444;

        log.step(1, 'Stopping recording...');
        try {
            await daemonRequest('/stop', port);
            log.success('Recording stopped.');
        } catch (error) {
            log.warn(`Daemon not responding: ${error.message}.`);
        }

        log.step(2, 'Stopping daemon...');
        const savedPid = getSavedPid();
        if (savedPid) {
            try {
                process.kill(savedPid, 'SIGTERM');
                log.success(`Daemon (PID: ${savedPid}) stopped.`);
                removePid();
            } catch (error) {
                log.warn('Daemon not running, cleaning up PID file.');
                removePid();
            }
        }

        log.step(3, 'Restoring original code...');
        const { restore } = await import('../lib/transformer.js');
        await restore(null, true);

        const snapshotPath = path.resolve(process.cwd(), SNAPSHOT_FILE);
        if (fs.existsSync(snapshotPath)) {
            const stats = fs.statSync(snapshotPath);
            log.success(`Snapshots preserved: ${snapshotPath} (${stats.size} bytes)`);
        }

        log.divider();
        log.success('Original code restored. Snapshots preserved for testing.');
        log.info('Run "io-snapshot test" to verify your code changes.');
        log.divider();
    });

program
    .command('test [target]')
    .description('Replay snapshots against current code to verify behavior')
    .action(async (target) => {
        try {
            if (target) validateFilePattern(target);
        } catch (error) {
            log.error(error.message);
            process.exit(1);
        }

        const { verifyDir } = await import('../lib/verifier.js');
        await verifyDir(target);
    });

program
    .command('clean [target]')
    .description('Restore original files and delete snapshots')
    .action(async (target) => {
        try {
            if (target) validateFilePattern(target);
        } catch (error) {
            log.error(error.message);
            process.exit(1);
        }

        const { restore } = await import('../lib/transformer.js');
        await restore(target);
    });

program.parse();
