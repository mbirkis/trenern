/**
 * Client for Garmin Connect's Personal API (https://personal.connectapi.garmin.com).
 *
 * The personal API key is created by the user at
 * https://connect.garmin.com/app/settings/personalApiToken and exchanged for a
 * short-lived bearer token. Both the key and the cached token live in
 * config/keys/garmin-<id>/ and never leave the server.
 *
 * Only GET requests exist in this API — it is strictly read-only.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'https://personal.connectapi.garmin.com';
export const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

// Refresh well before expiry so a long sync never dies mid-way.
const REFRESH_WINDOW_SEC = 3600;
const MAX_RETRIES = 3;

export function apiKeyFile(dir) {
  return path.join(dir, 'api-key');
}

export function tokenCacheFile(dir) {
  return path.join(dir, 'bearer-token.json');
}

/** Read the stored personal API key, or null when the source is not set up yet. */
export function readApiKey(dir) {
  try {
    const key = fs.readFileSync(apiKeyFile(dir), 'utf8').trim();
    return key || null;
  } catch {
    return null;
  }
}

/** Store the personal API key with owner-only permissions. */
export function writeApiKey(dir, key) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const file = apiKeyFile(dir);
  fs.writeFileSync(file, `${String(key).trim()}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

export class GarminApiError extends Error {
  constructor(message, { status = null, path: reqPath = null } = {}) {
    super(message);
    this.name = 'GarminApiError';
    this.status = status;
    this.path = reqPath;
  }
}

/** Seconds-since-epoch expiry from a JWT, or one hour out when unreadable. */
function jwtExpiry(token, nowSec) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (Number.isFinite(payload.exp)) return Number(payload.exp);
  } catch {
    // Treat an opaque token as short-lived rather than refusing to use it.
  }
  return nowSec + REFRESH_WINDOW_SEC;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} opts
 * @param {string} opts.keyDir    Directory holding api-key + bearer-token.json
 * @param {string} [opts.apiKey]  Key to use instead of the one on disk
 * @param {string} [opts.baseUrl]
 * @param {function} [opts.fetchImpl]
 */
export function createPersonalApi({ keyDir, apiKey = null, baseUrl, fetchImpl, now } = {}) {
  const base = (baseUrl || process.env.GARMIN_PERSONAL_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const doFetch = fetchImpl || globalThis.fetch;
  const clock = now || (() => Date.now() / 1000);
  let cached = null; // { access_token, expires_at }

  function key() {
    const k = apiKey || (keyDir ? readApiKey(keyDir) : null);
    if (!k) {
      throw new GarminApiError(
        'Mangler personlig API-nøkkel for Garmin. Kjør: node scripts/auth-garmin.mjs --source-id <id>'
      );
    }
    return k;
  }

  function readCache() {
    if (cached) return cached;
    if (!keyDir) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(tokenCacheFile(keyDir), 'utf8'));
      if (raw && typeof raw.access_token === 'string' && Number.isFinite(raw.expires_at)) {
        cached = { access_token: raw.access_token, expires_at: Number(raw.expires_at) };
        return cached;
      }
    } catch {
      // A missing or damaged cache just means we fetch a new token.
    }
    return null;
  }

  function writeCache(token) {
    cached = token;
    if (!keyDir) return;
    try {
      fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(tokenCacheFile(keyDir), JSON.stringify(token), { mode: 0o600 });
      fs.chmodSync(tokenCacheFile(keyDir), 0o600);
    } catch (err) {
      console.warn(`kunne ikke mellomlagre Garmin-token: ${err.message}`);
    }
  }

  /** Exchange the API key for a bearer token, reusing a cached one when fresh. */
  async function token({ force = false } = {}) {
    const existing = force ? null : readCache();
    if (existing && existing.expires_at - clock() > REFRESH_WINDOW_SEC) return existing.access_token;

    const res = await doFetch(`${base}${TOKEN_PATH}`, {
      method: 'POST',
      headers: { Accept: '*/*', Authorization: `ApiKey ${key()}` },
    });
    const body = (await res.text()).trim();
    if (!res.ok) {
      throw new GarminApiError(
        res.status === 401
          ? 'Garmin avviste den personlige API-nøkkelen (401). Lag en ny nøkkel og kjør auth-garmin.mjs på nytt.'
          : `Kunne ikke hente Garmin-token (HTTP ${res.status})`,
        { status: res.status, path: TOKEN_PATH }
      );
    }
    if (!body) throw new GarminApiError('Garmin returnerte et tomt token');
    const fresh = { access_token: body, expires_at: jwtExpiry(body, clock()) };
    writeCache(fresh);
    return fresh.access_token;
  }

  async function request(reqPath, { params = null, accept = 'application/json' } = {}) {
    const url = new URL(`${base}${reqPath}`);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }

    let retriedAuth = false;
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(url, {
        headers: { Accept: accept, Authorization: `Bearer ${await token()}` },
      });
      if (res.ok) return res;

      // A revoked or rotated token is worth exactly one silent retry.
      if (res.status === 401 && !retriedAuth) {
        retriedAuth = true;
        await token({ force: true });
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES - 1) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * (attempt + 1));
        continue;
      }
      throw new GarminApiError(`Garmin ${reqPath} svarte HTTP ${res.status}`, {
        status: res.status,
        path: reqPath,
      });
    }
  }

  return {
    baseUrl: base,
    token,

    /** GET a JSON endpoint. Returns null for an empty body. */
    async get(reqPath, params) {
      const res = await request(reqPath, { params });
      const text = await res.text();
      if (!text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw new GarminApiError(`Garmin ${reqPath} returnerte ugyldig JSON`, { path: reqPath });
      }
    },

    /** GET a binary endpoint (the original activity file download). */
    async getBuffer(reqPath, params) {
      const res = await request(reqPath, {
        params,
        accept: 'application/zip, application/x-zip-compressed, application/octet-stream',
      });
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
