/**
 * Golden roundtrip suite (T5) — drives the REAL cli.js (dist/) end to end:
 *
 *   record (inject + daemon start + /record)
 *     → fixture app runs against the injected recorder (calls flow through /telemetry)
 *     → mutate a recorded function's result (breaking change)
 *     → stop (daemon killed, SNAPSHOT_FILE preserved, source byte-exact restored)
 *     → test (verifier detects drift, non-zero exit)
 *
 * Everything runs in a temp git-ignored workspace so repository state is untouched.
 * Each test rigorously asserts exit codes, stdout/stderr content, and the on-disk
 * effects of the rule it covers.
 */
import { spawnSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = path.resolve(__dirname, '..', 'dist', 'cli.js');
const PORT = 9477; // dedicated test port range, env-overridable for CI parallelism
const BASE_PORT = parseInt(process.env.IOSNAP_TEST_PORT ?? String(PORT), 10);
const stopDaemon = (dir: string, port: number | string) => runCli(['stop', '--port', String(port)], dir);

function workspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'iosnap-golden-'));
}

function runCli(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, IOSNAP_TEST_PORT: '1' }, // unused by cli; port passed explicitly
        timeout: 20_000
    });
    return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Waits for a file to be non-empty, polling the filesystem. */
function waitForFile(f: string, ms = 15000): void {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        const s = fs.statSync(f, { throwIfNoEntry: false });
        if (s && s.size > 0) return;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    throw new Error(`file never became non-empty: ${f}`);
}

const FIXTURE_ORIG = `export function greet(name: string): string {
    return 'hello ' + name;
}

export function add(a: number, b: number): number {
    return a + b;
}
`;

// The app the "user" runs against the injected code. It imports the fixture
// entry, calls its functions, then exits — exactly how an app exercises the
// recorder in real usage.
function appScript(): string {
    return [
    "import { greet, add } from './src/utils.ts';",
    "import fs from 'node:fs';",
    "const a = greet('ken');",
    "const b = add(2, 3);",
    "fs.writeFileSync('app_out.json', JSON.stringify({ a, b }));",
    "console.log('app ran:', a, b);"
    ].join('\n');
}

const fixtureDirs: string[] = [];
afterAll(() => {
    for (const dir of fixtureDirs) {
        execSync(`git -C ${dir} reset --hard >/dev/null 2>&1 || true`, { stdio: 'ignore' });
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function seedFixture(): string {
    const dir = workspace();
    fixtureDirs.push(dir);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'golden-fixture', version: '1.0.0',
        scripts: { start: 'npx --yes tsx app.mjs' }
    }, null, 2));
    fs.writeFileSync(path.join(dir, 'src', 'utils.ts'), FIXTURE_ORIG);
    fs.writeFileSync(path.join(dir, 'app.mjs.orig'), appScript());
    fs.writeFileSync(path.join(dir, 'app.mjs'), appScript());
    // no git inside fixture, so git reset no-ops
    return dir;
}

function runApp(dir: string): { status: number; stdout: string } {
    const result = spawnSync('npx', ['--yes', 'tsx', 'app.mjs'], { cwd: dir, encoding: 'utf8', timeout: 30_000 });
    return { status: result.status ?? -1, stdout: result.stdout ?? '' };
}

function getSnapshots(dir: string): Record<string, { fnName: string; args: unknown[]; result: unknown }[]> {
    const file = path.join(dir, '.snaps.jsonl');
    if (!fs.existsSync(file)) return {};
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
        .reduce((acc, entry) => {
            (acc[entry.fnName] ||= []).push(entry);
            return acc;
        }, {} as Record<string, { fnName: string; args: unknown[]; result: unknown }[]>);
}

async function daemonAlive(dir: string): Promise<boolean> {
    // pid file lives in the per-project temp session dir (md5 of cwd) — the
    // daemon's cwd is the fixture dir, so the path must be derived from it
    const hash = crypto.createHash('md5').update(dir).digest('hex');
    const pidFile = path.join(os.tmpdir(), `io-snapshot-session-${hash}`, 'io-snapshot.pid');
    if (!fs.existsSync(pidFile)) return false;
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
    try { process.kill(pid, 0); return true; } catch { return false; }
}

let portCursor = 0;
function nextPort(): number {
    portCursor = (portCursor + 1) % 32;
    return BASE_PORT + portCursor;
}

describe('T5 golden roundtrip', () => {

    it('record→app→stop→byte-exact restore + snapshots captured', async () => {
        const dir = seedFixture();
        const port = nextPort();
        const rec = runCli(['record', '--port', String(port), '--timeout', '2'], dir);
        expect(rec.status).toBe(0);
        expect(rec.stdout).toContain('Recording active.');

        const appRun = runApp(dir);
        expect(appRun.status).toBe(0);
        expect(appRun.stdout).toContain('app ran: hello ken 5');

        waitForFile(path.join(dir, '.snaps.jsonl'));

        const snaps = getSnapshots(dir);
        expect(Object.keys(snaps)).toContain('greet');
        expect(snaps['greet'].length).toBeGreaterThan(0);
        expect(snaps['greet'][0].args).toEqual(['ken']);
        expect(snaps['greet'][0].result).toBe('hello ken');
        expect(Object.keys(snaps)).toContain('add');
        expect(snaps['add'][0].result).toBe(5);

        const stp = runCli(['stop', '--port', String(port)], dir);
        expect(stp.status).toBe(0);
        expect(stp.stdout).toContain('Original code restored.');

        const utils = path.join(dir, 'src', 'utils.ts');
        expect(fs.readFileSync(utils, 'utf8')).toBe(FIXTURE_ORIG);
        const snapFile = path.join(dir, '.snaps.jsonl');
        expect(fs.readFileSync(snapFile, 'utf8')).toContain('hello ken');
    }, 60_000);

    it('test catches drift after a breaking change (non-zero exit, drift diff printed)', async () => {
        const dir = seedFixture();
        const port = nextPort();
        const rec = runCli(['record', '--port', String(port), '--timeout', '2'], dir);
        expect(rec.status).toBe(0);
        const appRun = runApp(dir);
        expect(appRun.status).toBe(0);
        const stp = runCli(['stop', '--port', String(port)], dir);
        expect(stp.status).toBe(0);

        // break the function exactly like a refactor gone wrong
        fs.writeFileSync(path.join(dir, 'src', 'utils.ts'),
            FIXTURE_ORIG.replace("'hello ' + name", "'HELLO ' + name"));

        const tst = runCli(['test'], dir);
        expect(tst.status).not.toBe(0);
        expect(tst.stderr).toContain('Drift detected in greet!'); // log.error -> stderr
    }, 60_000);

    it('test passes cleanly on a non-breaking refactor of the same behavior', async () => {
        const dir = seedFixture();
        const port = nextPort();
        const rec = runCli(['record', '--port', String(port), '--timeout', '2'], dir);
        expect(rec.status).toBe(0);
        const appRun = runApp(dir);
        expect(appRun.status).toBe(0);
        const stp = runCli(['stop', '--port', String(port)], dir);
        expect(stp.status).toBe(0);

        // behavior-preserving refactor only
        fs.writeFileSync(path.join(dir, 'src', 'utils.ts'),
            FIXTURE_ORIG.replace("return 'hello ' + name;", "return ['hello', name].join(' ');"));

        const tst = runCli(['test'], dir);
        expect(tst.status).toBe(0);
        expect(tst.stdout).toContain('greet passed semantic check');
        expect(tst.stdout).toContain('All verifications passed!');
    }, 60_000);

    it('stop removes the daemon pid and kills the underlying process', async () => {
        const dir = seedFixture();
        const port = nextPort();
        const rec = runCli(['record', '--port', String(port), '--timeout', '2'], dir);
        expect(rec.status).toBe(0);
        expect(await daemonAlive(dir)).toBe(true);
        const stp = runCli(['stop', '--port', String(port)], dir);
        expect(stp.status).toBe(0);
        expect(await daemonAlive(dir)).toBe(false);
    }, 60_000);
});
