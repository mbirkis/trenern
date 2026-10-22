#!/usr/bin/env node
/**
 * Install a Garmin Connect personal API key from an interactive terminal,
 * never through the public HTTP API.
 *
 * Create the key first at https://connect.garmin.com/app/settings/personalApiToken
 * (Garmin shows it exactly once), then run this script and paste it.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import config from '../src/config.js';
import { createPersonalApi, writeApiKey } from '../src/garmin/personalApi.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const idx = args.indexOf('--source-id');
const sourceId = idx >= 0 ? args[idx + 1] : args.find(a => a.startsWith('--source-id='))?.slice(12);
if (args.includes('--help') || !args.length) {
  console.log('Usage: node scripts/auth-garmin.mjs --source-id ID (interactive terminal only)');
  console.log('Lag nøkkelen på https://connect.garmin.com/app/settings/personalApiToken først.');
  process.exit(args.includes('--help') ? 0 : 1);
}
if (args.some(a => a.startsWith('--email') || a.startsWith('--password') || a.startsWith('--code') || a.startsWith('--api-key'))) {
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

/** Read one line without echoing it, so the key never lands in scrollback. */
function askSecret(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(prompt);
    const onKeypress = (chunk, key) => {
      if (key && (key.name === 'return' || key.name === 'enter')) process.stdout.write('\n');
    };
    rl.input.on('keypress', onKeypress);
    rl._writeToOutput = () => {}; // suppress echo
    rl.question('', (answer) => {
      rl.input.off('keypress', onKeypress);
      rl.close();
      resolve(answer.trim());
    });
  });
}

const keyDir = path.join(config.paths.keys, `garmin-${sourceId}`);
fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
fs.chmodSync(keyDir, 0o700);

const key = await askSecret('Garmin personal API key: ');
if (!key) {
  console.error('Ingen nøkkel oppgitt.');
  process.exit(1);
}

// Verify before storing anything, so a typo never leaves a broken source behind.
try {
  const api = createPersonalApi({ apiKey: key, keyDir: null });
  await api.token({ force: true });
  const profile = await api.get('/userprofile-service/userprofile/settings');
  const name = profile?.displayName || profile?.userData?.firstName || 'ukjent bruker';
  writeApiKey(keyDir, key);
  // Drop any bearer token cached for a previous key.
  fs.rmSync(path.join(keyDir, 'bearer-token.json'), { force: true });
  console.log(`OK — nøkkel lagret i ${path.relative(root, keyDir)} (${name})`);
} catch (err) {
  console.error(`Kunne ikke bruke nøkkelen: ${err.message}`);
  process.exit(1);
}
