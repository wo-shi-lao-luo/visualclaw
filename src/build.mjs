import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', '<!doctype html><meta charset="utf-8"><title>VisualClaw</title><p>Build placeholder</p>');
console.log('build complete');
