import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { glob } from 'tinyglobby';
import { LOCAL_BACKUP_DIR } from '../../core/constants.js';
import { JAVA_PROXY_CODE } from '../../java/proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JAVA_CLI_JAR = path.join(__dirname, '../../../io-snapshot-java/target/io-snapshot-java-1.0.0.jar');

interface SpawnResult {
    code: number | null;
}

function runJavaCli(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('java', args, { stdio: 'inherit' });

        child.on('close', (code: SpawnResult['code']) => {
            if (code === 0) resolve();
            else reject(new Error(`java ${args[0]} exited with code ${code}`));
        });
    });
}

export async function inject(targetPattern?: string, force = false): Promise<void> {
    const defaultPattern = '**/*.java';
    const pattern = targetPattern || defaultPattern;

    const files = await glob(pattern, {
        ignore: ['node_modules/**', '**/node_modules/**', `${LOCAL_BACKUP_DIR}/**`]
    });

    const sourceFiles = files.filter(f => !f.endsWith('IOSnapshotProxy.java'));

    if (sourceFiles.length === 0) {
        console.warn(`No Java files found matching: ${pattern}`);
        return;
    }

    // Write proxy code to temp file (to avoid CLI arg length issues)
    const proxyFilePath = path.join(process.cwd(), '.io-snapshot-proxy.tmp');
    fs.writeFileSync(proxyFilePath, JAVA_PROXY_CODE);

    try {
        const args = [
            '-jar', JAVA_CLI_JAR,
            'inject',
            `--files=${sourceFiles.join(',')}`,
            `--proxy-file=${proxyFilePath}`
        ];
        if (force) args.push('--force');

        const child = spawn('java', args, { stdio: 'inherit' });

        await new Promise<void>((resolve, reject) => {
            child.on('close', (code: SpawnResult['code']) => {
                if (code === 0) resolve();
                else reject(new Error(`Java transformer exited with code ${code}`));
            });
        });
    } finally {
        // Clean up temp file (also on injected failure paths)
        if (fs.existsSync(proxyFilePath)) {
            fs.unlinkSync(proxyFilePath);
        }
    }
}

export async function restore(targetPattern?: string | null, keepSnapshots = false): Promise<void> {
    const defaultPattern = '**/*.java';
    const pattern = targetPattern || defaultPattern;

    const files = await glob(pattern, {
        ignore: ['node_modules/**', '**/node_modules/**', `${LOCAL_BACKUP_DIR}/**`]
    });

    if (files.length === 0) return;

    const args = ['-jar', JAVA_CLI_JAR, 'restore', `--files=${files.join(',')}`];
    if (keepSnapshots) args.push('--keep-snapshots');

    const child = spawn('java', args, { stdio: 'inherit' });

    await new Promise<void>((resolve, reject) => {
        child.on('close', (code: SpawnResult['code']) => {
            if (code === 0) resolve();
            else reject(new Error(`Java restore exited with code ${code}`));
        });
    });
}

export function getFileExtensions(): string[] {
    return ['.java'];
}
