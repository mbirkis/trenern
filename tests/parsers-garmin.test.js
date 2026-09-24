/** Tests for Garmin Connect parser. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../src/parsers/index.js';

describe('GarminConnectParser', () => {
  const ctx = { sourceId: 'test-garmin', ref: '12345678' };

  it('detects Garmin-sourced JSON by _garmin marker', () => {
    // If the dedicated garminConnect parser is registered, _garmin: true should match
    const activities = parseDocument(
      { _garmin: true, startTime: '2024-06-15T07:30:00.0', track: [{ lat: 59.9, lon: 10.8 }] },
      ctx
    );
    assert.ok(activities.length > 0, 'should parse to at least one activity');
  });

  it('parses GPS activity with full track into valid activity', () => {
    const activities = parseDocument(
      {
        _garmin: true,
        activityId: 12345678,
        activityName: 'Morning Run',
        startTime: '2024-06-15T07:30:00.0',
        activityType: { typeKey: 'running' },
        distance: 10000,
        duration: 3600,
        elevationGain: 85,
        averageHeartRate: 145,
        maxHeartRate: 170,
        calories: 550,
        track: [
          { lat: 59.91333, lon: 10.75297, ele: 100.0, hr: 120, t: 0 },
          { lat: 59.91350, lon: 10.75320, ele: 100.5, hr: 125, t: 10 },
          { lat: 59.91380, lon: 10.75350, ele: 101.0, hr: 130, t: 20 },
        ],
      },
      ctx
    );
    assert.ok(activities.length > 0);
    const a = activities[0];
    assert.equal(a.type, 'running');
    assert.ok(a.start, 'must have start time');
    assert.ok(a.distanceM >= 10000, `expected ~10000m, got ${a.distanceM}`);
    assert.ok(a.durationSec > 0);
    assert.ok(a.hasTrack, 'must have track flag');
    assert.ok(a.track.length >= 3, 'must preserve track points');
  });

  it('parses non-GPS activity (strength, yoga) without track', () => {
    const activities = parseDocument(
      {
        _garmin: true,
        activityId: 12345680,
        activityName: 'Strength Training',
        startTime: '2024-06-16T08:00:00.0',
        activityType: { typeKey: 'strength_training' },
        distance: 0,
        duration: 2700,
        elevationGain: 0,
        averageHeartRate: 110,
        maxHeartRate: 140,
        calories: 200,
        track: [],
      },
      ctx
    );
    assert.ok(activities.length > 0, 'non-GPS activities should not be dropped');
    const a = activities[0];
    assert.equal(a.type, 'other'); // strength_training maps to 'other'
    assert.ok(a.start, 'must have start time');
    assert.ok(!a.hasTrack, 'non-GPS activity should not have track flag');
  });

  it('uses Garmin activity ID as stable source ref', () => {
    const activities = parseDocument(
      {
        _garmin: true,
        activityId: 12345678,
        startTime: '2024-06-15T07:30:00.0',
        activityType: { typeKey: 'running' },
      },
      ctx
    );
    const a = activities[0];
    assert.equal(a.source, 'test-garmin');
    assert.equal(a.sourceRef, '12345678');
  });

  it('falls through to genericTrack when _garmin marker is absent', () => {
    // Without _garmin marker, genericTrack should still handle track data
    const activities = parseDocument(
      {
        startTime: '2024-06-15T07:30:00.0',
        type: 'running',
        track: [{ lat: 59.9, lon: 10.8 }, { lat: 59.91, lon: 10.81 }],
      },
      ctx
    );
    assert.ok(activities.length > 0, 'genericTrack should handle this');
  });
});