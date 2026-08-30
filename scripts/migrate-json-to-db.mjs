/**
 * Import activities from the legacy JSON file store (data/activities/*.json)
 * into the configured database backend. Safe to re-run; upserts by id.
 *
 *   node scripts/migrate-json-to-db.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../src/config.js';
import * as store from '../src/store.js';

const dir = config.paths.activities;
if (!fs.existsSync(dir)) {
  console.log(`ingen mappe ${dir} — ingenting å migrere`);
  process.exit(0);
}

await store.ready();
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
let created = 0;
let updated = 0;
let skipped = 0;

for (const f of files) {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!a || !a.id) {
      skipped++;
      continue;
    }
    const outcome = await store.upsert(a);
    if (outcome === 'created') created++;
    else updated++;
  } catch (err) {
    console.warn(`hoppet over ${f}: ${err.message}`);
    skipped++;
  }
}

console.log(`ferdig: ${created} nye, ${updated} oppdatert, ${skipped} hoppet over`);
await store.close();
