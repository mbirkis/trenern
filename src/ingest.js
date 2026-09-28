import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import { buildSources } from './sources/index.js';
import { parseDocument } from './parsers/index.js';
import * as store from './store.js';
import { healthDates, mergeHealth } from './healthSync.js';
import { startPlaceTagging } from './placeTags.js';

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
    await store.ready(); // Release the running flag even if database startup fails.
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
          const stamp = `${src.type === 'garminConnect' ? 'garmin-v2:' : ''}${file.modifiedTime || ''}:${file.size || ''}`;
          if (!opts.force && cache[key] === stamp) continue;

          try {
            const json = await src.readJson(file);
            const activities = parseDocument(json, { sourceId: src.id, ref: file.ref });
            sr.parsed++;
            result.filesParsed++;
            for (const a of activities) {
              a.sourceName = file.name;
              // Preserve a user-assigned name across re-ingest.
              const existing = await store.get(a.id);
              if (existing?.extras?.garmin && a.extras?.garmin) {
                if (a.extras.garmin.endpointStatus?.hrTimeInZones === 'error' && existing.hrZoneSource === 'garmin') {
                  a.hrZones = existing.hrZones; a.hrZoneSource = existing.hrZoneSource;
                }
                a.extras.garmin.garminExtras = { ...existing.extras.garmin.garminExtras, ...a.extras.garmin.garminExtras };
              }
              if (existing && existing.customName) {
                a.customName = existing.customName;
                a.name = existing.customName;
              }
              if (existing?.placeTagsStatus === 'done') {
                a.placeTags = existing.placeTags || [];
                a.placeTagsStatus = 'done';
              }
              const outcome = await store.upsert(a);
              if (outcome === 'created') result.created++;
              else result.updated++;
              sr.activities++;
            }
            if (!Object.values(json.endpointStatus || {}).includes('error')) cache[key] = stamp;
            else delete cache[key];
          } catch (err) {
            const msg = `${src.id}/${file.name}: ${err.message}`;
            sr.errors.push(msg);
            result.errors.push(msg);
          }
        }
        if (src.readHealth) {
          const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());
          const starts = files.map(f => f.startDate).filter(Boolean).sort();
          const existing = await store.listHealth({ source: src.id });
          const plan = healthDates({ today, startDate: src.healthStartDate || starts[0] || today,
            existing: existing.map(d => d.date),
            batchDays: src.healthBatchDays, force: !!opts.force });
          sr.health = { imported: 0, remaining: plan.remaining, warnings: [] };
          const retry = existing.filter(d => Object.values(d.endpointStatus || {}).includes('error') &&
            d.date >= (src.healthStartDate || starts[0] || today) && !plan.dates.includes(d.date)).sort((a,b) => (a.ingestedAt || '').localeCompare(b.ingestedAt || '')).slice(0, 3);
          plan.dates.push(...retry.map(d => d.date));
          const previous = new Map(existing.map(d => [d.date, d]));
          for (const [index, date] of plan.dates.entries()) {
            try {
              const day = await src.readHealth(date);
              const record = mergeHealth(previous.get(date), { ...day, source: src.id, ingestedAt: new Date().toISOString() });
              await store.upsertHealth(record);
              sr.health.imported++;
              for (const [key, status] of Object.entries(day.endpointStatus || {})) {
                if (status === 'error') sr.health.warnings.push(`${date}: ${key}`);
              }
            } catch (err) {
              // Stop on authentication/rate-limit/transport failure and retry next sync.
              const msg = `${src.id}/helsedata ${date}: ${err.message}`;
              sr.errors.push(msg); result.errors.push(msg);
              sr.health.remaining += plan.dates.length - index;
              break;
            }
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
    runIngest()
      .then(() => startPlaceTagging())
      .catch((e) => console.error('planlagt ingest feilet:', e.message));
  }, mins * 60 * 1000);
  timer.unref?.();
}
