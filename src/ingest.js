import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import { buildSources } from './sources/index.js';
import { parseDocument } from './parsers/index.js';
import * as store from './store.js';

const CACHE_FILE = path.join(config.paths.cache, 'ingest-cache.json');

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveCache(c) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(c, null, 0));
}

let running = false;
let lastResult = null;

export function ingestStatus() {
  return { running, lastResult };
}

/**
 * Pull from every enabled source, parse new/changed files, store activities.
 * @param {object} opts { force?: boolean, sourceId?: string }
 */
export async function runIngest(opts = {}) {
  if (running) return { skipped: true, reason: 'allerede i gang' };
  running = true;
  await store.ready(); // ensure DB is open (and legacy JSON migrated) once
  const startedAt = new Date().toISOString();
  const cache = loadCache();
  const result = {
    startedAt,
    finishedAt: null,
    sources: [],
    created: 0,
    updated: 0,
    filesScanned: 0,
    filesParsed: 0,
    errors: [],
  };

  try {
    let sources = buildSources();
    if (opts.sourceId) sources = sources.filter((s) => s.id === opts.sourceId);

    for (const src of sources) {
      const sr = { id: src.id, type: src.type, files: 0, parsed: 0, activities: 0, errors: [] };
      try {
        const files = await src.listFiles();
        sr.files = files.length;
        result.filesScanned += files.length;

        for (const file of files) {
          const key = `${src.id}:${file.ref}`;
          const stamp = `${file.modifiedTime || ''}:${file.size || ''}`;
          if (!opts.force && cache[key] === stamp) continue;

          try {
            const json = await src.readJson(file);
            const activities = parseDocument(json, { sourceId: src.id, ref: file.ref });
            sr.parsed++;
            result.filesParsed++;
            for (const a of activities) {
              a.sourceName = file.name;
              const outcome = await store.upsert(a);
              if (outcome === 'created') result.created++;
              else result.updated++;
              sr.activities++;
            }
            cache[key] = stamp;
          } catch (err) {
            const msg = `${src.id}/${file.name}: ${err.message}`;
            sr.errors.push(msg);
            result.errors.push(msg);
          }
        }
      } catch (err) {
        const msg = `kilde ${src.id}: ${err.message}`;
        sr.errors.push(msg);
        result.errors.push(msg);
      }
      result.sources.push(sr);
    }

    saveCache(cache);
  } finally {
    result.finishedAt = new Date().toISOString();
    running = false;
    lastResult = result;
  }
  return result;
}

let timer = null;
export function startScheduler() {
  const mins = config.ingest?.intervalMinutes;
  if (!mins || mins <= 0) return;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    runIngest().catch((e) => console.error('planlagt ingest feilet:', e.message));
  }, mins * 60 * 1000);
  timer.unref?.();
}
