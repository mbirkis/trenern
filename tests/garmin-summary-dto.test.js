import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../src/parsers/index.js';

test('rejects unparseable Garmin data instead of allowing a successful empty import', () => {
  assert.throws(() => parseDocument({ _garmin: true, activityId: 456, summaryDTO: {}, track: [] },
    { sourceId: 'test-garmin', ref: '456' }), /Garmin.*456/);
});

// Synthetic values, matching the nested structure observed in Garmin's real detail response.
test('imports Garmin detail summaryDTO with time, distance and heart rate', () => {
  const data = {
    _garmin: true, activityId: 123, activityName: 'Test walk',
    activityTypeDTO: { typeKey: 'walking' },
    summaryDTO: {
      startTimeGMT: '2026-09-25T08:00:00.0', distance: 2500,
      duration: 1800, movingDuration: 1700, averageHR: 110, maxHR: 135,
      calories: 150, steps: 3200, elevationGain: 40, elevationLoss: 35,
    }, track: [],
  };
  const activities = parseDocument(data, { sourceId: 'test-garmin', ref: '123' });
  assert.equal(activities.length, 1);
  const a = activities[0];
  assert.equal(a.start, '2026-09-25T08:00:00.000Z');
  assert.equal(a.type, 'walking');
  assert.equal(a.distanceM, 2500);
  assert.equal(a.durationSec, 1800);
  assert.equal(a.movingTimeSec, 1700);
  assert.equal(a.avgHr, 110);
  assert.equal(a.maxHr, 135);
  assert.equal(a.steps, 3200);
  assert.equal(a.sourceRef, '123');
});
