import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { glob } from 'tinyglobby';
import { LOCAL_BACKUP_DIR } from '../../core/constants.js';
import { JAVA_PROXY_CODE } from '../../java/proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JAVA_CLI_JAR = path.join(__dirname, '../../../io-snapshot-java/target/io-snapshot-java-1.0.0.jar');

export async function inject(targetPattern, force = false) {
  const defaultPattern = '**/*.java';
  const pattern = targetPattern || defaultPattern;
  
  const files = await glob(pattern, {
    ignore: ['node_modules/**', '**/node_modules/**', `${LOCAL_BACKUP_DIR}/**`]
  });
  
  if (files.length === 0) {
    console.warn(`No Java files found matching: ${pattern}`);
    return;
  }

  // Write the Proxy class so the project can compile
  // We place it in a standard location relative to the project
  const proxyPath = path.join(process.cwd(), 'src/main/java/io/snapshot/IOSnapshotProxy.java');
  const proxyDir = path.dirname(proxyPath);
  if (!fs.existsSync(proxyDir)) {
    fs.mkdirSync(proxyDir, { recursive: true });
  }
  fs.writeFileSync(proxyPath, JAVA_PROXY_CODE);
  
  return new Promise((resolve, reject) => {
    const args = ['-jar', JAVA_CLI_JAR, 'inject', `--files=${files.join(',')}`];
    if (force) args.push('--force');
    
    const child = spawn('java', args, { stdio: 'inherit' });
    
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Java transformer exited with code ${code}`));
    });
  });
}

export async function restore(targetPattern, keepSnapshots = false) {
  const defaultPattern = '**/*.java';
  const pattern = targetPattern || defaultPattern;
  
  const files = await glob(pattern, {
    ignore: ['node_modules/**', '**/node_modules/**', `${LOCAL_BACKUP_DIR}/**`]
  });

  // Clean up the Proxy class
  const proxyPath = path.join(process.cwd(), 'src/main/java/io/snapshot/IOSnapshotProxy.java');
  if (fs.existsSync(proxyPath)) {
    fs.unlinkSync(proxyPath);
  }
  
  if (files.length === 0) return;
  
  return new Promise((resolve, reject) => {
    const args = ['-jar', JAVA_CLI_JAR, 'restore', `--files=${files.join(',')}`];
    if (keepSnapshots) args.push('--keep-snapshots');
    
    const child = spawn('java', args, { stdio: 'inherit' });
    
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Java restore exited with code ${code}`));
    });
  });
}

export function getFileExtensions() {
  return ['.java'];
}
