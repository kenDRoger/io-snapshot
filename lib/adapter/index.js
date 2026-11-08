import path from 'path';
import { glob } from 'tinyglobby';

export const DEFAULT_PATTERNS = {
  js: ['**/*.{js,jsx,ts,tsx}'],
  java: ['**/*.java']
};

export const GLOBAL_DEFAULT_PATTERN = '**/*.{js,jsx,ts,tsx,java}';

export async function detectLanguages(targetPattern) {
  if (targetPattern) {
    const files = await glob(targetPattern, {
      ignore: ['node_modules/**', '**/node_modules/**', '.io-snapshot-backups/**']
    });
    const languages = new Set(files.map(f => getLanguageFromExt(path.extname(f))));
    return [...languages].filter(Boolean);
  }
  
  // No target - check what files exist
  const jsFiles = await glob(DEFAULT_PATTERNS.js, { onlyFiles: true, ignore: ['node_modules/**'] });
  const javaFiles = await glob(DEFAULT_PATTERNS.java, { onlyFiles: true, ignore: ['node_modules/**'] });
  
  const languages = [];
  if (javaFiles.length > 0) languages.push('java');
  if (jsFiles.length > 0) languages.push('js');
  
  return languages.length > 0 ? languages : ['js']; // default to js
}

function getLanguageFromExt(ext) {
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return 'js';
  if (ext === '.java') return 'java';
  return null;
}

export async function getAdapter(language) {
  if (language === 'js') {
    return (await import('./js/index.js'));
  }
  if (language === 'java') {
    return (await import('./java/index.js'));
  }
  throw new Error(`Unsupported language: ${language}`);
}
