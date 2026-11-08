import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PORT, DEFAULT_TIMEOUT, SNAPSHOT_FILE } from './constants.js';
import { loadConfig } from './config.js';
import { log } from './logger.js';
import { getPidFilePath, ensureTempSessionDir } from './paths.js';

let isRecording = false;
let lastTelemetryTime = Date.now();
let server: Server | null = null;
let timeoutInterval: NodeJS.Timeout | null = null;
let corsOrigin = '*';

function setCorsHeaders(res: ServerResponse): void {
    if (corsOrigin === '*') {
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendResponse(res: ServerResponse, statusCode: number, data: unknown): void {
    setCorsHeaders(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function savePid(pid: number): void {
    ensureTempSessionDir();
    fs.writeFileSync(getPidFilePath(), String(pid));
}

function removePid(): void {
    const pidPath = getPidFilePath();
    if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
    }
}

function resetTimeout(): void {
    lastTelemetryTime = Date.now();
}

function startTimeoutWatcher(timeoutMinutes: number): void {
    if (timeoutInterval) clearInterval(timeoutInterval);

    timeoutInterval = setInterval(() => {
        const elapsed = (Date.now() - lastTelemetryTime) / 1000 / 60;
        if (elapsed >= timeoutMinutes && server) {
            log.error(`Daemon auto-shutting down after ${timeoutMinutes} minutes of inactivity.`);
            stopServer();
        }
    }, 30000);
}

function stopServer(): void {
    if (server) {
        server.close();
        server = null;
    }
    if (timeoutInterval) {
        clearInterval(timeoutInterval);
        timeoutInterval = null;
    }
    removePid();
    process.exit(0);
}

async function handleTelemetry(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = '';
    for await (const chunk of req) {
        body += chunk;
    }

    if (!isRecording) {
        sendResponse(res, 200, { status: 'ignored', reason: 'not_recording' });
        return;
    }

    resetTimeout();

    try {
        fs.appendFileSync(path.resolve(process.cwd(), SNAPSHOT_FILE), body + '\n');
        sendResponse(res, 200, { status: 'captured' });
    } catch (error) {
        sendResponse(res, 500, { error: (error as Error).message });
    }
}

interface CorsOptions {
    origin?: string;
}

function startDaemon(port: number, timeoutMinutes: number, corsOptions?: CorsOptions): void {
    if (corsOptions?.origin) {
        corsOrigin = corsOptions.origin;
    }

    server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${port}`);

        if (req.method === 'OPTIONS') {
            setCorsHeaders(res);
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method === 'GET' && url.pathname === '/status') {
            sendResponse(res, 200, {
                isRecording,
                timeout: timeoutMinutes,
                uptime: process.uptime(),
                corsOrigin
            });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/record') {
            isRecording = true;
            resetTimeout();
            log.success('Recording started.');
            sendResponse(res, 200, { isRecording: true });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/stop') {
            isRecording = false;
            log.success('Recording stopped.');
            sendResponse(res, 200, { isRecording: false });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/telemetry') {
            await handleTelemetry(req, res);
            return;
        }

        sendResponse(res, 404, { error: 'Not found' });
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            log.error(`Port ${port} is already in use.`);
            process.exit(1);
        }
        throw error;
    });

    server.listen(port, () => {
        log.info(`Daemon running on http://localhost:${port}`);
        savePid(process.pid);
        startTimeoutWatcher(timeoutMinutes);
    });
}

/** Public entry: resolves port/timeout/CORS from args, env, config file, then defaults. */
export function runDaemon(port?: number, timeout?: number, corsOptions?: CorsOptions): void {
    const config = loadConfig();
    const actualPort = port || config.port || DEFAULT_PORT;
    const actualTimeout = timeout || config.timeout || DEFAULT_TIMEOUT;
    const corsEnv = process.env.SNAP_DAEMON_CORS || config.cors?.origin || '*';
    startDaemon(actualPort, actualTimeout, { origin: corsEnv });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const config = loadConfig();
    runDaemon(config.port || DEFAULT_PORT, config.timeout || DEFAULT_TIMEOUT);
}
