import path from 'path';
import { glob } from 'tinyglobby';

export async function detectLanguage(targetPattern) {
  const jsPatterns = ['**/*.{js,jsx,ts,tsx}'];
  const javaPatterns = ['**/*.java'];
  
  const hasJs = async () => (await glob(jsPatterns, { onlyFiles: true })).length > 0;
  const hasJava = async () => (await glob(javaPatterns, { onlyFiles: true })).length > 0;

  if (!targetPattern) {
    const [jsExists, javaExists] = await Promise.all([hasJs(), hasJava()]);
    if (javaExists && !jsExists) return 'java';
    if (jsExists && !javaExists) return 'js';
    if (javaExists && jsExists) {
      return 'mixed'; // Both languages present
    }
    return 'js'; // default
  }

  const files = await glob(targetPattern);
  if (files.length === 0) return null;
  
  const ext = path.extname(files[0]);
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return 'js';
  if (ext === '.java') return 'java';
  return null;
}

export async function getAdapter(language) {
  if (language === 'js' || language === 'mixed') {
    return (await import('./js/index.js'));
  }
  if (language === 'java') {
    return (await import('./java/index.js'));
  }
  throw new Error(`Unsupported language: ${language}`);
}
