#!/usr/bin/env node
/**
 * Interactive CLI to bootstrap Garmin Connect authentication.
 *
 * Usage:
 *   node scripts/auth-garmin.mjs --source-id <id>
 *
 * NEVER pass email/password as CLI args — they'd leak via `ps`.
 * This script prompts for credentials on stdin (TTY) and stores
 * the resulting tokens in config/keys/garmin-<id>.token.json
 * (chmod 0600).
 *
 * Second-factor (MFA) is handled interactively: if Garmin sends
 * a 2FA challenge, the script prompts for the verification code.
 *
 * Requirements:
 *   - Python 3 + garminconnect package installed (see scripts/garmin_client/)
 *   - A garminConnect source already configured in config.json
 */
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Source config imports
import config from '../src/config.js';

const PYTHON_VENV = path.join(ROOT, 'scripts', 'garmin_client', '.venv', 'bin', 'python');
const PYTHON_PATH = fs.existsSync(PYTHON_VENV) ? PYTHON_VENV : 'python3';

function showUsage() {
  console.log(`
Usage: node scripts/auth-garmin.mjs --source-id <source-id>

Authenticate a garminConnect source with Garmin Connect.
Prompts for email/password on stdin (never CLI args).

Options:
  --source-id   The ID of the garminConnect source in config.json (required)
  --help        Show this message

The token is saved to config/keys/garmin-<source-id>/ (garth dump directory format).
`);
}

function findSource(id) {
  const sources = config.sources || [];
  return sources.find((s) => s.id === id && s.type === 'garminConnect');
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON_PATH,
      ['-m', 'garmin_client', ...args],
      {
        env: { ...process.env, PYTHONPATH: path.join(ROOT, 'scripts') },
        timeout: 60000,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

async function main() {
  const args = process.argv.slice(2);

  // Check for credentials in args — these must not leak
  const secretsInArgs = args.filter(
    (a) => a.startsWith('--password') || a.startsWith('--email=')
  );
  if (secretsInArgs.length > 0) {
    console.error('ERROR: Do not pass credentials as CLI arguments (leaks via ps).');
    console.error('The script prompts for email and password on stdin.');
    process.exit(1);
  }

  if (args.includes('--help') || args.length === 0) {
    showUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const sourceIdArg = args.find((a) => a.startsWith('--source-id='));
  const sourceId = sourceIdArg ? sourceIdArg.split('=')[1] : null;

  if (!sourceId) {
    console.error('ERROR: --source-id is required');
    process.exit(1);
  }

  const source = findSource(sourceId);
  if (!source) {
    console.error(`ERROR: No garminConnect source with id "${sourceId}" found in config.`);
    console.error('Create the source via the web UI (Kilder → Legg til → Garmin Connect) first.');
    process.exit(1);
  }

  const tokenFile = source.tokenFile
    ? path.resolve(ROOT, source.tokenFile)
    : path.join(ROOT, 'config', 'keys', `garmin-${sourceId}`);

  console.log(`\n=== Garmin Connect Authentication for "${sourceId}" ===`);
  console.log(`Token will be saved to: ${tokenFile}\n`);

  // Interactive credential prompt (never echoed to terminal history)
  const email = await prompt('Garmin email: ');
  const password = await prompt('Garmin password: ');

  console.log('\nAuthenticating...');

  // Step 1: Initial login — may trigger MFA
  try {
    const result = await runPython([
      'login',
      '--email', email,
      '--token', tokenFile,
    ]);
    const parsed = JSON.parse(result);
    if (parsed.ok) {
      fs.chmodSync(tokenFile, 0o600);
      console.log(`✓ Authenticated. Token saved to ${tokenFile}`);
      process.exit(0);
    }
    if (parsed.mfa) {
      // MFA required
      const code = await prompt('Garmin 2FA verification code (from authenticator app): ');
      const mfaResult = await runPython([
        'login-mfa',
        '--token', tokenFile,
        '--code', code,
      ]);
      const mfaParsed = JSON.parse(mfaResult);
      if (mfaParsed.ok) {
        fs.chmodSync(tokenFile, 0o600);
        console.log(`✓ Authenticated with MFA. Token saved to ${tokenFile}`);
        process.exit(0);
      }
      console.error('✗ MFA failed:', mfaParsed.error || 'unknown error');
      process.exit(1);
    }
    console.error('✗ Authentication failed:', parsed.error || 'unknown error');
    process.exit(1);
  } catch (err) {
    console.error('✗ Authentication error:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});