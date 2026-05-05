import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

await mkdir(distDir, { recursive: true });
for (const file of ['index.html', 'app.js', 'styles.css']) {
  await writeFile(path.join(distDir, file), await readFile(path.join(__dirname, file), 'utf8'));
}
console.log('build complete');
