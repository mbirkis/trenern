import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

const DIR = config.paths.activities;
const INDEX = path.join(config.paths.data, 'index.json');

/** Lightweight summary fields kept in the in-memory / on-disk index. */
const SUMMARY_KEYS = [
  'id', 'source', 'sourceRef', 'parser', 'type', 'name', 'start', 'end',
  'durationSec', 'movingTimeSec', 'distanceM', 'elevationGainM', 'elevationLossM',
  'avgHr', 'maxHr', 'avgPaceSecPerKm', 'maxSpeedMs', 'steps', 'calories',
  'avgCadence', 'avgPower', 'avgTempC', 'hrRest', 'hrMax', 'hrZones',
  'hasTrack', 'ingestedAt',
];

function summarize(a) {
  const s = {};
  for (const k of SUMMARY_KEYS) s[k] = a[k];
  return s;
}

let index = new Map();
try {
  const raw = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  for (const a of raw) index.set(a.id, a);
} catch {
  // Rebuild from activity files if the index is missing/corrupt.
  if (fs.existsSync(DIR)) {
    for (const f of fs.readdirSync(DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const a = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
        index.set(a.id, summarize(a));
      } catch {}
    }
  }
}

function persistIndex() {
  const arr = [...index.values()].sort((a, b) =>
    String(b.start).localeCompare(String(a.start))
  );
  fs.writeFileSync(INDEX, JSON.stringify(arr, null, 0));
}

export function has(id) {
  return index.has(id);
}

export function list({ type, from, to } = {}) {
  let arr = [...index.values()];
  if (type) arr = arr.filter((a) => a.type === type);
  if (from) arr = arr.filter((a) => a.start && a.start >= from);
  if (to) arr = arr.filter((a) => a.start && a.start <= to);
  return arr.sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

export function get(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** Insert or replace an activity. Returns 'created' | 'updated'. */
export function upsert(activity) {
  const existed = index.has(activity.id);
  fs.writeFileSync(
    path.join(DIR, `${activity.id}.json`),
    JSON.stringify(activity, null, 0)
  );
  index.set(activity.id, summarize(activity));
  persistIndex();
  return existed ? 'updated' : 'created';
}

export function remove(id) {
  try {
    fs.unlinkSync(path.join(DIR, `${id}.json`));
  } catch {}
  const had = index.delete(id);
  if (had) persistIndex();
  return had;
}

export function stats() {
  const arr = [...index.values()];
  const byType = {};
  let distance = 0;
  let duration = 0;
  let gain = 0;
  for (const a of arr) {
    byType[a.type] = (byType[a.type] || 0) + 1;
    distance += a.distanceM || 0;
    duration += a.movingTimeSec || 0;
    gain += a.elevationGainM || 0;
  }
  return {
    count: arr.length,
    byType,
    totalDistanceM: Math.round(distance),
    totalMovingTimeSec: Math.round(duration),
    totalElevationGainM: Math.round(gain),
  };
}
