/** Tests for auth-garmin CLI script. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const AUTH_SCRIPT = path.join(ROOT, 'scripts', 'auth-garmin.mjs');

describe('AuthGarminCLI', () => {
  it('exits with usage when no args given', async () => {
    return new Promise((resolve, reject) => {
      execFile(process.execPath, [AUTH_SCRIPT], { timeout: 5000 }, (err, stdout, stderr) => {
        assert.ok(err, 'should exit with error');
        assert.ok(stdout.includes('Usage') || stderr.includes('Usage'), 'output should show usage');
        resolve();
      });
    });
  });

  it('exits with usage for --help', async () => {
    return new Promise((resolve, reject) => {
      execFile(process.execPath, [AUTH_SCRIPT, '--help'], { timeout: 5000 }, (err, stdout, stderr) => {
        assert.ok(stdout.includes('Usage') || stderr.includes('Usage'), 'should show usage');
        resolve();
      });
    });
  });

  it('exits with error for unknown --source-id when config has no matching source', async () => {
    return new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [AUTH_SCRIPT, '--source-id', 'nonexistent-garmin'],
        { timeout: 5000 },
        (err, stdout, stderr) => {
          assert.ok(err, 'should exit with error for unknown source');
          resolve();
        }
      );
      // Send empty stdin to simulate no input
      child.stdin.end();
    });
  });

  it('rejects credentials passed as CLI args (must be stdin)', async () => {
    // If any credentials are visible in `ps`, the script must error out
    return new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [AUTH_SCRIPT, '--source-id', 'test', '--email', 'test@example.com', '--password', 'secret123'],
        { timeout: 5000 },
        (err, stdout, stderr) => {
          assert.ok(err, 'should error when credentials are in args');
          resolve();
        }
      );
    });
  });
});