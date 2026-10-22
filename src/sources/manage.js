import fs from 'node:fs';
import path from 'node:path';
import config, { saveConfig, resolvePath } from '../config.js';
import { registeredSourceTypes, buildSources } from './index.js';
import { apiKeyFile } from '../garmin/personalApi.js';

/**
 * CRUD for `config.sources`, driven by the web UI. Secrets (API keys, service
 * account private keys) are stored on disk under config/keys/ and never sent
 * back to the browser.
 */

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

function ensureSources() {
  if (!Array.isArray(config.sources)) config.sources = [];
  return config.sources;
}

function keyFileFor(id) {
  return path.join(config.paths.keys, `${id}.json`);
}

function tokenFileFor(id) {
  return path.join(config.paths.keys, `garmin-${id}`);
}

/** Public, secret-free view of one source config. */
export function redactSource(cfg) {
  const auth = cfg.auth || {};
  const out = {
    id: cfg.id,
    type: cfg.type,
    label: cfg.label || null,
    enabled: !!cfg.enabled,
    recursive: cfg.recursive !== false,
    filePattern: cfg.filePattern || '\\.json$',
  };
  if (cfg.type === 'googleDrive') {
    out.folderId =
      cfg.folderId && !String(cfg.folderId).startsWith('PUT_') ? cfg.folderId : '';
    out.authMethod = auth.method || (auth.apiKey ? 'apiKey' : 'serviceAccount');
    const keyPath = auth.serviceAccountKeyFile
      ? resolvePath(auth.serviceAccountKeyFile)
      : null;
    out.hasServiceAccountKey = !!(keyPath && fs.existsSync(keyPath));
    out.hasApiKey = !!auth.apiKey;
    out.serviceAccountEmail = readServiceAccountEmail(keyPath);
  }
  if (cfg.type === 'localFolder') out.path = cfg.path || '';
  if (cfg.type === 'garminConnect') {
    out.healthStartDate = cfg.healthStartDate || null;
    out.healthBatchDays = cfg.healthBatchDays || 30;
    // Personal API: a stored API key is what "connected" means.
    const keyDir = cfg.tokenFile ? resolvePath(cfg.tokenFile) : tokenFileFor(cfg.id);
    out.hasToken = !!(keyDir && fs.existsSync(apiKeyFile(keyDir)));
  }
  return out;
}

function readServiceAccountEmail(keyPath) {
  if (!keyPath || !fs.existsSync(keyPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(keyPath, 'utf8')).client_email || null;
  } catch {
    return null;
  }
}

export function listSourceConfigs() {
  return ensureSources().map(redactSource);
}

export function getSourceConfig(id) {
  const cfg = ensureSources().find((s) => s.id === id);
  return cfg ? redactSource(cfg) : null;
}

function validate(input, { existingId } = {}) {
  const errors = [];
  const type = input.type;
  if (!registeredSourceTypes().includes(type)) {
    errors.push(`ukjent type "${type}"`);
    return { errors };
  }

  let id = input.id || slugify(input.label) || `${type}-${Date.now()}`;
  id = slugify(id) || `${type}-${Date.now()}`;
  if (!existingId && ensureSources().some((s) => s.id === id)) {
    errors.push(`kilde-id "${id}" finnes allerede`);
  }

  const cfg = {
    id,
    type,
    label: (input.label || '').trim() || null,
    enabled: input.enabled !== false,
    recursive: input.recursive !== false,
    filePattern: (input.filePattern || '').trim() || '\\.json$',
  };
  try {
    new RegExp(cfg.filePattern);
  } catch {
    errors.push('filePattern er ikke et gyldig regulært uttrykk');
  }

  if (type === 'googleDrive') {
    const folderId = (input.folderId || '').trim();
    if (!folderId) errors.push('folderId er påkrevd for Google Drive');
    cfg.folderId = folderId;

    const method = input.authMethod === 'apiKey' ? 'apiKey' : 'serviceAccount';
    cfg.auth = { method };
    if (method === 'apiKey') {
      const apiKey = (input.apiKey || '').trim();
      if (!apiKey && !input._keepSecret) errors.push('apiKey er påkrevd');
      if (apiKey) cfg.auth.apiKey = apiKey;
    } else {
      cfg.auth.serviceAccountKeyFile = `./config/keys/${id}.json`;
      let sa = input.serviceAccountKey;
      if (typeof sa === 'string' && sa.trim()) {
        try {
          sa = JSON.parse(sa);
        } catch {
          errors.push('serviceAccountKey er ikke gyldig JSON');
          sa = null;
        }
      }
      if (sa && typeof sa === 'object') {
        if (!sa.client_email || !sa.private_key) {
          errors.push('service account-JSON mangler client_email / private_key');
        } else {
          cfg._pendingKey = sa;
        }
      } else if (!input._keepSecret) {
        errors.push('service account-JSON er påkrevd');
      }
    }
  } else if (type === 'localFolder') {
    const p = (input.path || '').trim();
    if (!p) errors.push('path er påkrevd for lokal mappe');
    cfg.path = p;
  } else if (type === 'garminConnect') {
    // Key directory is derived from the source ID; no user input needed.
    // The personal API key is installed with scripts/auth-garmin.mjs
    // (interactive CLI), never through the web UI.
    cfg.tokenFile = `./config/keys/garmin-${id}`;
    cfg.filePattern = null; // not applicable for Garmin — files are API activities
    cfg.recursive = false;  // not applicable
    cfg.healthStartDate = input.healthStartDate || null;
    if (cfg.healthStartDate && (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.healthStartDate) ||
        !Number.isFinite(Date.parse(cfg.healthStartDate)) ||
        new Date(cfg.healthStartDate).toISOString().slice(0, 10) !== cfg.healthStartDate)) {
      errors.push('Startdato for helsedata er ugyldig');
    }
    cfg.healthBatchDays = Number(input.healthBatchDays ?? 30);
    if (!Number.isInteger(cfg.healthBatchDays) || cfg.healthBatchDays < 1 || cfg.healthBatchDays > 90) {
      errors.push('Helsedager per synk må være mellom 1 og 90');
    }
  }

  return { errors, cfg };
}

function commitKey(cfg) {
  if (cfg._pendingKey) {
    fs.writeFileSync(keyFileFor(cfg.id), JSON.stringify(cfg._pendingKey, null, 2));
    delete cfg._pendingKey;
  }
}

export function addSource(input) {
  const { errors, cfg } = validate(input);
  if (errors.length) return { errors };
  commitKey(cfg);
  ensureSources().push(cfg);
  saveConfig();
  return { source: redactSource(cfg) };
}

export function updateSource(id, input) {
  const list = ensureSources();
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) return { errors: ['kilde ikke funnet'] };
  const prev = list[idx];

  // Keep existing secret if the form did not supply a new one.
  const keepSecret =
    !input.serviceAccountKey &&
    !input.apiKey &&
    (redactSource(prev).hasServiceAccountKey || redactSource(prev).hasApiKey);

  const { errors, cfg } = validate(
    { ...input, healthStartDate: input.healthStartDate === undefined ? prev.healthStartDate : input.healthStartDate, healthBatchDays: input.healthBatchDays ?? prev.healthBatchDays, id, type: input.type || prev.type, _keepSecret: keepSecret },
    { existingId: id }
  );
  if (errors.length) return { errors };

  // Carry forward an untouched secret.
  if (keepSecret && cfg.type === 'googleDrive') {
    if (prev.auth?.apiKey && cfg.auth.method === 'apiKey') {
      cfg.auth.apiKey = prev.auth.apiKey;
    }
    if (prev.auth?.serviceAccountKeyFile && cfg.auth.method === 'serviceAccount') {
      cfg.auth.serviceAccountKeyFile = prev.auth.serviceAccountKeyFile;
    }
  }
  commitKey(cfg);
  list[idx] = cfg;
  saveConfig();
  return { source: redactSource(cfg) };
}

export function removeSource(id) {
  const list = ensureSources();
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) return { removed: false };
  const [removed] = list.splice(idx, 1);
  saveConfig();
  if (removed.type === 'garminConnect') {
    // API key and cached bearer token live in a directory named after the source.
    fs.rmSync(tokenFileFor(id), { recursive: true, force: true });
  } else {
    try { fs.unlinkSync(keyFileFor(id)); } catch {}
  }
  return { removed: true };
}

/** Try listing files for one source; used by the "Test tilkobling" button. */
export async function testSource(id) {
  const src = buildSources({ includeDisabled: true }).find((s) => s.id === id);
  if (!src) return { ok: false, error: 'kilde ikke funnet' };
  try {
    const files = await src.listFiles();
    return {
      ok: true,
      fileCount: files.length,
      sample: files.slice(0, 5).map((f) => f.name),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
