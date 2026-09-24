#!/usr/bin/env node
/** Authenticate from an interactive terminal, never through the public HTTP API. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const idx = args.indexOf('--source-id');
const sourceId = idx >= 0 ? args[idx + 1] : args.find(a => a.startsWith('--source-id='))?.slice(12);
if (args.includes('--help') || !args.length) {
  console.log('Usage: node scripts/auth-garmin.mjs --source-id ID (interactive terminal only)');
  process.exit(args.includes('--help') ? 0 : 1);
}
if (args.some(a => a.startsWith('--email') || a.startsWith('--password') || a.startsWith('--code'))) {
  console.error('Credentials must never be passed as arguments.');
  process.exit(1);
}
if (!sourceId || !/^[a-z0-9-]+$/.test(sourceId) || !config.sources?.some(s => s.type === 'garminConnect' && s.id === sourceId)) {
  console.error('No Garmin Connect source found for this ID. Create it in config first.');
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error('Garmin login requires an interactive terminal (TTY); never pipe credentials.');
  process.exit(1);
}
const tokenDir = path.join(config.paths.keys, `garmin-${sourceId}`);
fs.mkdirSync(tokenDir, { recursive: true, mode: 0o700 });
fs.chmodSync(tokenDir, 0o700);
const venv = path.join(root, 'scripts/garmin_client/.venv/bin/python');
const python = fs.existsSync(venv) ? venv : 'python3';
const child = spawnSync(python, ['-m', 'garmin_client', 'login', '--token', tokenDir], {
  stdio: 'inherit', env: { ...process.env, PYTHONPATH: path.join(root, 'scripts') },
});
if (child.error) console.error(child.error.message);
process.exit(child.status ?? 1);
