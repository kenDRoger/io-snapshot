import http from 'http';
import fs from 'fs';
import path from 'path';
import { DEFAULT_PORT, DEFAULT_TIMEOUT, SNAPSHOT_FILE } from './constants.js';
import { loadConfig } from './config.js';
import { log } from './logger.js';
import { getPidFilePath, ensureTempSessionDir } from './paths.js';

let isRecording = false;
let lastTelemetryTime = Date.now();
let server = null;
let timeoutInterval = null;
let corsOrigin = '*';

function setCorsHeaders(res) {
    if (corsOrigin === '*') {
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendResponse(res, statusCode, data) {
    setCorsHeaders(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function savePid(pid) {
    ensureTempSessionDir();
    fs.writeFileSync(getPidFilePath(), String(pid));
}

function removePid() {
    const pidPath = getPidFilePath();
    if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
    }
}

function resetTimeout() {
    lastTelemetryTime = Date.now();
}

function startTimeoutWatcher(timeoutMinutes) {
    if (timeoutInterval) clearInterval(timeoutInterval);
    
    timeoutInterval = setInterval(() => {
        const elapsed = (Date.now() - lastTelemetryTime) / 1000 / 60;
        if (elapsed >= timeoutMinutes && server) {
            log.error(`Daemon auto-shutting down after ${timeoutMinutes} minutes of inactivity.`);
            stopServer();
        }
    }, 30000);
}

function stopServer() {
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

async function handleTelemetry(req, res) {
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
        sendResponse(res, 500, { error: error.message });
    }
}

function startDaemon(port, timeoutMinutes, corsOptions) {
    if (corsOptions?.origin) {
        corsOrigin = corsOptions.origin;
    }
    
    server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${port}`);

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

    server.on('error', (error) => {
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

export function runDaemon(port, timeout, corsOptions) {
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
