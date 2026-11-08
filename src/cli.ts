#!/usr/bin/env node
import { program } from 'commander';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { SNAPSHOT_FILE } from './core/constants.js';
import { loadConfig, validatePort, validateTimeout, validateFilePattern } from './core/config.js';
import { log } from './core/logger.js';
import { getPidFilePath, ensureTempSessionDir } from './core/paths.js';
import { detectLanguages, getAdapter, DEFAULT_PATTERNS, type Language } from './adapter/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ProgramOptions {
    force?: boolean;
    port?: string;
    timeout?: string;
    keepSnapshots?: boolean;
}

function savePid(pid: number | undefined): void {
    if (pid === undefined) return;
    const pidPath = getPidFilePath();
    ensureTempSessionDir();
    fs.writeFileSync(pidPath, String(pid));
}

function getSavedPid(): number | null {
    const pidPath = getPidFilePath();
    if (fs.existsSync(pidPath)) {
        return parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
    }
    return null;
}

function removePid(): void {
    const pidPath = getPidFilePath();
    if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
    }
}

async function daemonRequest(endpoint: string, port: number, method = 'POST'): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const req = http.request(`http://localhost:${port}${endpoint}`, { method }, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk; });
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

interface CliError {
    message: string;
}

program
    .name('io-snapshot')
    .description('Capture and compare function behavior snapshots for zero-regression refactoring');

program
    .command('inject [target]')
    .description('Inject recorder into target files (for explicit use)')
    .option('-f, --force', 'Force re-inject even if already injected')
    .action(async (target: string | undefined, opts: ProgramOptions) => {
        try {
            if (target) validateFilePattern(target);

            const languages = await detectLanguages(target);
            for (const lang of languages) {
                const adapter = await getAdapter(lang);
                const pattern = target || DEFAULT_PATTERNS[lang][0];
                await adapter.inject(pattern, opts.force);
            }
        } catch (error) {
            log.error((error as CliError).message);
            process.exit(1);
        }
    });

program
    .command('record [target]')
    .description('Inject, start daemon, and begin recording snapshots')
    .option('-p, --port <port>', 'Port to run the daemon on')
    .option('-t, --timeout <minutes>', 'Auto-shutdown after N minutes of inactivity')
    .option('-f, --force', 'Force re-inject even if already injected')
    .action(async (target: string | undefined, opts: ProgramOptions) => {
        try {
            if (opts.port) validatePort(opts.port);
            if (opts.timeout) validateTimeout(opts.timeout);
            if (target) validateFilePattern(target);
        } catch (error) {
            log.error((error as CliError).message);
            process.exit(1);
        }

        const config = loadConfig();
        const port = (opts.port ? Number(opts.port) : undefined) || config.port || 9444;
        const timeout = (opts.timeout ? Number(opts.timeout) : undefined) || config.timeout || 30;

        log.divider('IMPORTANT');
        log.info('Run this command FIRST,');
        log.info('         THEN start your app!');
        log.divider();

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
        try {
            const languages = await detectLanguages(target);
            for (const lang of languages) {
                const adapter = await getAdapter(lang);
                const pattern = target || DEFAULT_PATTERNS[lang][0];
                await adapter.inject(pattern, opts.force);
            }
        } catch (error) {
            log.error(`Injection failed: ${(error as CliError).message}`);
            process.exit(1);
        }

        log.step(2, 'Starting daemon...');
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            IOSNAP_DAEMON_PORT: String(port),
            IOSNAP_DAEMON_CORS: '*'
        };

        // spawned relative to the compiled output root: dist/cli.js -> dist/core/daemon.js
        const child: ChildProcess = spawn(process.execPath, [path.join(__dirname, 'core', 'daemon.js')], {
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
            log.success('NOW START YOUR APP');
            log.info('Interact with your app to capture snapshots.');
            log.info('Run "io-snapshot stop" when done to restore original code.');
            log.divider();
        } catch (error) {
            log.error(`Failed to start recording: ${(error as CliError).message}`);
            process.exit(1);
        }
    });

program
    .command('stop')
    .description('Stop recording, stop daemon, and restore original code')
    .option('-p, --port <port>', 'Port where the daemon is running')
    .option('--keep-snapshots', 'Keep the snapshot data file')
    .action(async (opts: ProgramOptions) => {
        try {
            if (opts.port) validatePort(opts.port);
        } catch (error) {
            log.error((error as CliError).message);
            process.exit(1);
        }

        const config = loadConfig();
        const port = (opts.port ? Number(opts.port) : undefined) || config.port || 9444;

        log.step(1, 'Stopping recording...');
        try {
            await daemonRequest('/stop', port);
            log.success('Recording stopped.');
        } catch (error) {
            log.warn(`Daemon not responding: ${(error as CliError).message}.`);
        }

        log.step(2, 'Stopping daemon...');
        const savedPid = getSavedPid();
        if (savedPid) {
            try {
                process.kill(savedPid, 'SIGTERM');
                log.success(`Daemon (PID: ${savedPid}) stopped.`);
                removePid();
            } catch {
                log.warn('Daemon not running, cleaning up PID file.');
                removePid();
            }
        }

        log.step(3, 'Restoring original code...');
        try {
            const languages = await detectLanguages();
            for (const lang of languages) {
                const adapter = await getAdapter(lang);
                await adapter.restore(null, true);
            }
        } catch (error) {
            log.error(`Restore failed: ${(error as CliError).message}`);
        }

        const snapshotPath = path.resolve(process.cwd(), SNAPSHOT_FILE);
        if (fs.existsSync(snapshotPath)) {
            const stats = fs.statSync(snapshotPath);
            log.success(`Snapshots preserved: ${snapshotPath} (${stats.size} bytes)`);
        }

        log.divider();
        log.success('Original code restored.');
        log.info('Run "io-snapshot test" to verify your code changes.');
        log.divider();
    });

program
    .command('test [target]')
    .description('Replay snapshots against current code to verify behavior')
    .action(async (target: string | undefined) => {
        try {
            if (target) validateFilePattern(target);
        } catch (error) {
            log.error((error as CliError).message);
            process.exit(1);
        }

        const { verifyDir } = await import('./core/verifier.js');
        await verifyDir(target);
    });

program
    .command('clean [target]')
    .description('Restore original files and delete snapshots')
    .action(async (target: string | undefined) => {
        try {
            if (target) validateFilePattern(target);

            const languages = await detectLanguages(target);
            for (const lang of languages) {
                const adapter = await getAdapter(lang);
                await adapter.restore(target, false);
            }
        } catch (error) {
            log.error((error as CliError).message);
            process.exit(1);
        }
    });

program.parse();
