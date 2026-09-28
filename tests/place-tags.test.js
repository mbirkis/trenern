import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sampleTrack, namesFromResponse, tagsForTrack } from '../src/placeTags.js';
import { createSqlite } from '../src/db/sqlite.js';

test('samples a GPS route across distance, including the endpoints', () => {
  const track = Array.from({ length: 31 }, (_, i) => ({ lat: 59.95 + i * 0.001, lon: 10.7 }));
  const samples = sampleTrack(track);
  assert.equal(samples.length, 6);
  assert.equal(samples[0].lat, track[0].lat);
  assert.equal(samples.at(-1).lat, track.at(-1).lat);
});

test('chooses current prioritized place names and deduplicates route tags', async () => {
  const names = namesFromResponse({ navn: [
    { stedstatus: 'aktiv', stedsnavn: [
      { skrivemåte: 'Gamle Sognsvann', navnestatus: 'hovednavn', skrivemåtestatus: 'historisk' },
      { skrivemåte: 'Sognsvann', navnestatus: 'hovednavn', skrivemåtestatus: 'godkjent og prioritert' },
    ] },
    { stedstatus: 'relikt', stedsnavn: [{ skrivemåte: 'Gammelt navn' }] },
  ] });
  assert.deepEqual(names, ['Sognsvann']);

  const requested = [];
  const lookup = async (url) => {
    requested.push(url);
    return { ok: true, json: async () => ({ navn: [
      { stedstatus: 'aktiv', stedsnavn: [{ skrivemåte: 'Sognsvann' }] },
      { stedstatus: 'aktiv', stedsnavn: [{ skrivemåte: 'Vettakollen' }] },
    ] }) };
  };
  const tags = await tagsForTrack([
    { lat: 59.97, lon: 10.72 }, { lat: 59.98, lon: 10.73 },
  ], lookup);
  assert.deepEqual(tags, ['Sognsvann', 'Vettakollen']);
  assert.ok(requested.length >= 2);
  assert.equal(requested[0].searchParams.get('koordsys'), '4258');
});

test('persists place tags in activity summaries and full records', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trenern-place-tags-'));
  process.env.TRENERN_SQLITE_FILE = path.join(dir, 'test.db');
  const db = createSqlite();
  try {
    await db.init();
    await db.upsert({ id: 'route-1', name: 'Tur', type: 'hiking', start: '2026-09-01',
      hasTrack: true, track: [{ lat: 59.97, lon: 10.72 }],
      placeTags: ['Sognsvann', 'Vettakollen'], placeTagsStatus: 'done' });
    assert.deepEqual((await db.list())[0].placeTags, ['Sognsvann', 'Vettakollen']);
    assert.equal((await db.get('route-1')).placeTagsStatus, 'done');
  } finally {
    await db.close();
    delete process.env.TRENERN_SQLITE_FILE;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
