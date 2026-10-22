/** Tests for the Garmin Personal API client (token exchange, caching, retries). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPersonalApi, writeApiKey, readApiKey, apiKeyFile, TOKEN_PATH } from '../src/garmin/personalApi.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trenern-garmin-'));

/** A JWT whose payload only carries the expiry the client reads. */
function jwt(expSec) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part({ exp: expSec })}.sig`;
}

const ok = (body, headers = {}) => ({
  ok: true,
  status: 200,
  headers: new Headers(headers),
  text: async () => body,
  arrayBuffer: async () => Buffer.from(body),
});
const fail = (status, headers = {}) => ({
  ok: false,
  status,
  headers: new Headers(headers),
  text: async () => '',
});

test('exchanges the API key for a bearer token and reuses it until it nears expiry', async () => {
  const dir = tmp();
  writeApiKey(dir, 'my-personal-key');
  assert.equal(readApiKey(dir), 'my-personal-key');
  assert.equal(fs.statSync(apiKeyFile(dir)).mode & 0o777, 0o600);

  const calls = [];
  let nowSec = 1_800_000_000;
  const api = createPersonalApi({
    keyDir: dir,
    now: () => nowSec,
    fetchImpl: async (url, init = {}) => {
      calls.push([String(url), init.method || 'GET', init.headers.Authorization]);
      if (String(url).endsWith(TOKEN_PATH)) return ok(jwt(nowSec + 24 * 3600));
      return ok('{"totalSteps":10}');
    },
  });

  assert.deepEqual(await api.get('/usersummary-service/usersummary/daily', { calendarDate: '2026-09-25' }), { totalSteps: 10 });
  await api.get('/hrv-service/hrv/2026-09-25');
  assert.equal(calls.filter(([u]) => u.endsWith(TOKEN_PATH)).length, 1, 'token fetched once');
  assert.equal(calls[0][1], 'POST');
  assert.equal(calls[0][2], 'ApiKey my-personal-key');
  assert.equal(calls[1][2].slice(0, 7), 'Bearer ');
  assert.match(calls[1][0], /calendarDate=2026-09-25/);

  // A fresh client reads the cached token from disk instead of exchanging again.
  const reopened = createPersonalApi({ keyDir: dir, now: () => nowSec, fetchImpl: async () => ok('{}') });
  await reopened.get('/userprofile-service/userprofile/settings');
  assert.ok(fs.existsSync(path.join(dir, 'bearer-token.json')));

  // Within one hour of expiry it refreshes.
  nowSec += 24 * 3600 - 600;
  await api.get('/hrv-service/hrv/2026-09-26');
  assert.equal(calls.filter(([u]) => u.endsWith(TOKEN_PATH)).length, 2);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('retries once with a fresh token when Garmin answers 401', async () => {
  const dir = tmp();
  writeApiKey(dir, 'key');
  let tokens = 0;
  let dataCalls = 0;
  const api = createPersonalApi({
    keyDir: dir,
    now: () => 1_800_000_000,
    fetchImpl: async (url) => {
      if (String(url).endsWith(TOKEN_PATH)) {
        tokens++;
        return ok(jwt(1_800_000_000 + 24 * 3600));
      }
      return ++dataCalls === 1 ? fail(401) : ok('{"ok":true}');
    },
  });
  assert.deepEqual(await api.get('/userprofile-service/userprofile/settings'), { ok: true });
  assert.equal(tokens, 2, 'token refreshed after the 401');
  assert.equal(dataCalls, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reports HTTP failures with their status so the sync can classify them', async () => {
  const dir = tmp();
  writeApiKey(dir, 'key');
  const api = createPersonalApi({
    keyDir: dir,
    now: () => 1_800_000_000,
    fetchImpl: async (url) => (String(url).endsWith(TOKEN_PATH)
      ? ok(jwt(1_800_000_000 + 3600 * 24))
      : fail(404)),
  });
  await assert.rejects(() => api.get('/activity-service/activity/1'), (err) => {
    assert.equal(err.status, 404);
    assert.equal(err.path, '/activity-service/activity/1');
    return true;
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('explains how to fix a missing or rejected API key', async () => {
  const dir = tmp();
  const api = createPersonalApi({ keyDir: dir, fetchImpl: async () => ok('x') });
  await assert.rejects(() => api.token(), /auth-garmin\.mjs/);

  writeApiKey(dir, 'stale');
  const rejected = createPersonalApi({
    keyDir: dir,
    fetchImpl: async () => fail(401),
  });
  await assert.rejects(() => rejected.token({ force: true }), /401/);
  fs.rmSync(dir, { recursive: true, force: true });
});
