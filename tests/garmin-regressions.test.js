import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGarminConnectSource } from '../src/sources/garminConnect.js';
import { parseDocument } from '../src/parsers/index.js';

const source = () => createGarminConnectSource({ id: 'garmin', enabled: true, tokenFile: './config/keys/garmin-garmin' });

test('source paginates until the final short page', async () => {
  const s = source();
  const starts = [];
  s._api = {
    async get(path, params) {
      if (!path.startsWith('/activitylist-service')) return null;
      starts.push(params.start);
      return Array.from({ length: params.start === 0 ? params.limit : 2 }, (_, i) => ({
        activityId: params.start + i + 1, startTimeGMT: '2026-09-24 10:00:00', distance: 0,
      }));
    },
  };
  const files = await s.listFiles();
  assert.deepEqual(starts, [0, 100]);
  assert.equal(files.length, 102);
});

test('Garmin identity stays stable when distance changes', () => {
  const a = { _garmin: true, activityId: 98765, startTimeGMT: '2026-09-24 10:00:00', distance: 100, track: [] };
  const first = parseDocument(a, { sourceId: 'garmin', ref: '98765' })[0];
  const second = parseDocument({ ...a, distance: 120 }, { sourceId: 'garmin', ref: '98765' })[0];
  assert.equal(first.parser, 'garminConnect');
  assert.equal(first.id, second.id);
  assert.equal(first.start, '2026-09-24T10:00:00.000Z');
});

test('Garmin track time uses seconds relative to activity start and zero coordinates remain valid', () => {
  const a = parseDocument({ _garmin: true, activityId: 98765,
    startTimeGMT: '2026-09-24 10:00:00',
    track: [{ lat: 0, lon: 0, t: 1790244000000, hr: 120 }, { lat: 0.001, lon: 0.001, t: 1790244010000, hr: 130 }],
  }, { sourceId: 'garmin', ref: '98765' })[0];
  assert.ok(a);
  assert.equal(a.track[0].lat, 0);
  assert.equal(a.track[0].t, 0);
  assert.equal(a.track[1].t, 10);
});
