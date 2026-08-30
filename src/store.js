import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import { createDb } from './db/index.js';

/**
 * Storage facade. All calls are async and delegate to the configured DB
 * backend (SQLite by default, Postgres when DATABASE_URL / config says so).
 * The backend is created lazily on first use; a one-time migration imports any
 * activities left over from the old JSON file store.
 */

let _db = null;
let _booting = null;

async function db() {
  if (_db) return _db;
  if (!_booting) {
    _booting = (async () => {
      const d = await createDb();
      await d.init();
      _db = d;
      console.log(`lagring: ${d.describe()}`);
      await migrateLegacyJson(d);
      return d;
    })();
  }
  return _booting;
}

/** Import data/activities/*.json from the pre-database store, once. */
async function migrateLegacyJson(d) {
  const dir = config.paths.activities;
  const marker = path.join(config.paths.data, '.migrated-to-db');
  if (fs.existsSync(marker) || !fs.existsSync(dir)) return;
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return;
  }
  if (!files.length) {
    fs.writeFileSync(marker, new Date().toISOString());
    return;
  }
  const existing = await d.stats();
  if (existing.count > 0) {
    fs.writeFileSync(marker, `skipped: db not empty ${new Date().toISOString()}`);
    return;
  }
  let n = 0;
  for (const f of files) {
    try {
      const a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (a && a.id) {
        await d.upsert(a);
        n++;
      }
    } catch (err) {
      console.warn(`  migrering hoppet over ${f}: ${err.message}`);
    }
  }
  fs.writeFileSync(marker, `${n} aktiviteter ${new Date().toISOString()}`);
  console.log(`migrerte ${n} aktivitet(er) fra JSON-lager til databasen`);
}

export async function ready() {
  return db();
}

export async function has(id) {
  return (await db()).has(id);
}

export async function list(opts) {
  return (await db()).list(opts || {});
}

export async function get(id) {
  return (await db()).get(id);
}

/** Insert or replace an activity. Resolves to 'created' | 'updated'. */
export async function upsert(activity) {
  return (await db()).upsert(activity);
}

export async function remove(id) {
  return (await db()).remove(id);
}

export async function stats() {
  return (await db()).stats();
}

export async function close() {
  if (_db) await _db.close();
  _db = null;
  _booting = null;
}
