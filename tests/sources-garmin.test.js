/** Tests for the Garmin Connect source adapter (Personal API). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGarminConnectSource } from '../src/sources/garminConnect.js';

const ACTIVITIES = [
  {
    activityId: 12345678,
    activityName: 'Morning Run',
    activityType: { typeKey: 'running' },
    startTimeLocal: '2026-09-25 07:12:00',
    startTimeGMT: '2026-09-25 05:12:00',
    distance: 10234.5,
    duration: 3120,
    hasPolyline: true,
    hrTimeInZone_1: 120,
    hrTimeInZone_2: 900,
    hrTimeInZone_3: 1800,
  },
  {
    activityId: 12345680,
    activityName: 'Strength Training',
    activityType: { typeKey: 'strength_training' },
    startTimeLocal: '2026-09-24 18:00:00',
    distance: 0,
    duration: 2400,
    hasPolyline: false,
    summarizedExerciseSets: [{ category: 'BENCH_PRESS', reps: 10 }],
  },
];

/** Minimal Personal API stub: routes by path prefix. */
function stubApi(routes = {}) {
  return {
    calls: [],
    async get(path, params) {
      this.calls.push([path, params]);
      for (const [prefix, value] of Object.entries(routes)) {
        if (path.startsWith(prefix)) return typeof value === 'function' ? value(path, params) : value;
      }
      return null;
    },
    async getBuffer(path) {
      this.calls.push([path]);
      const err = new Error('ingen fil');
      err.status = 404;
      throw err;
    },
  };
}

describe('GarminConnectSource', () => {
  describe('listFiles', () => {
    it('returns file-like entries with ref, name, modifiedTime and size', async () => {
      const src = createGarminConnectSource({ id: 'test-garmin', enabled: true, label: 'Test Garmin' });
      src._api = stubApi({ '/activitylist-service': ACTIVITIES });

      const files = await src.listFiles();
      assert.equal(files.length, 2);
      for (const f of files) {
        assert.equal(typeof f.ref, 'string');
        assert.equal(typeof f.name, 'string');
        assert.ok(f.modifiedTime);
        assert.equal(typeof f.size, 'number');
      }
      assert.equal(files[0].ref, '12345678');
      assert.equal(files[0].startDate, '2026-09-25');
    });

    it('includes activities without GPS (strength, yoga)', async () => {
      const src = createGarminConnectSource({ id: 'test-garmin', enabled: true });
      src._api = stubApi({ '/activitylist-service': ACTIVITIES });
      const names = (await src.listFiles()).map((f) => f.name);
      assert.ok(names.some((n) => n.includes('Strength')));
      assert.ok(names.some((n) => n.includes('Morning')));
    });

    it('asks Garmin for the documented search endpoint with paging', async () => {
      const src = createGarminConnectSource({ id: 'test-garmin', enabled: true });
      src._api = stubApi({ '/activitylist-service': ACTIVITIES });
      await src.listFiles();
      assert.equal(src._api.calls[0][0], '/activitylist-service/activities/search/activities');
      assert.deepEqual(src._api.calls[0][1], { start: 0, limit: 100 });
    });
  });

  describe('readJson', () => {
    it('merges the activity summary with time in zones and the FIT track', async () => {
      const src = createGarminConnectSource({ id: 'test-garmin', enabled: true });
      src._api = stubApi({
        '/biometric-service': { zone1Floor: 100, zone2Floor: 120, zone3Floor: 140 },
        '/activity-service/activity/12345678/workouts': [],
        '/activity-service/activity/12345678': {
          activityId: 12345678,
          activityTypeDTO: { typeKey: 'running' },
          summaryDTO: { startTimeGMT: '2026-09-25T05:12:00.0', distance: 10234.5, duration: 3120, averageHR: 155 },
        },
      });
      src._api.getBuffer = async () => {
        throw Object.assign(new Error('ingen fil'), { status: 404 });
      };

      const data = await src.readJson({ ref: '12345678', _garminType: 'running', _hasPolyline: true, _summary: ACTIVITIES[0] });
      assert.ok(data._garmin, 'should carry the Garmin marker');
      assert.equal(data.summaryDTO.averageHR, 155);
      assert.equal(data.activityName, 'Morning Run', 'list fields survive the merge');
      assert.deepEqual(data.garminExtras.hrTimeInZones[0], { zoneNumber: 1, secsInZone: 120, zoneLowBoundary: 100 });
      assert.equal(data.garminExtras.configuredHrZones.zone2Floor, 120);
      // A missing original file is normal for manual activities, not an error.
      assert.equal(data.endpointStatus.samples, 'unsupported');
      assert.deepEqual(data.track, []);
    });

    it('returns an empty track for non-GPS activities', async () => {
      const src = createGarminConnectSource({ id: 'test-garmin', enabled: true });
      src._api = stubApi({
        '/activity-service/activity/12345680': {
          activityId: 12345680,
          activityTypeDTO: { typeKey: 'strength_training' },
          summaryDTO: { startTimeGMT: '2026-09-24T16:00:00.0', duration: 2400 },
        },
      });
      const data = await src.readJson({ ref: '12345680', _garminType: 'strength_training', _hasPolyline: false, _summary: ACTIVITIES[1] });
      assert.deepEqual(data.track, []);
      assert.ok(data._garmin);
      assert.deepEqual(data.garminExtras.exerciseSets, [{ category: 'BENCH_PRESS', reps: 10 }]);
    });

    it('stops the sync when Garmin rejects the token', async () => {
      const src = createGarminConnectSource({ id: 'test-garmin', enabled: true });
      src._api = {
        async get() {
          throw Object.assign(new Error('HTTP 401'), { status: 401 });
        },
        async getBuffer() {
          throw Object.assign(new Error('HTTP 401'), { status: 401 });
        },
      };
      await assert.rejects(() => src.readJson({ ref: '1', _summary: {} }), /401/);
    });
  });

  describe('readHealth', () => {
    it('collects one day across the Personal API health endpoints', async () => {
      const src = createGarminConnectSource({ id: 'test-garmin', enabled: true });
      src._api = stubApi({
        '/usersummary-service/usersummary/daily': { totalSteps: 8421, restingHeartRate: 48, avgWakingRespirationValue: 13.5 },
        '/usersummary-service/stats/steps': [{ calendarDate: '2026-09-25', totalSteps: 8421 }],
        '/sleep-service': { sleepTimeSeconds: 27000 },
        '/hrv-service': { lastNightAvg: 62 },
        '/wellness-service/wellness/bodyBattery': [{ charged: 70, drained: 40 }],
      });

      const day = await src.readHealth('2026-09-25');
      assert.equal(day.date, '2026-09-25');
      assert.equal(day.data.daily.totalSteps, 8421);
      assert.equal(day.data.sleep.sleepTimeSeconds, 27000);
      assert.equal(day.data.hrv.lastNightAvg, 62);
      // Range endpoints are unwrapped to a single day for the UI.
      assert.equal(day.data.bodyBattery.charged, 70);
      assert.equal(day.data.steps.totalSteps, 8421);
      // Respiration has no endpoint but rides along in the daily summary.
      assert.equal(day.data.respiration.avgWakingRespirationValue, 13.5);
      assert.equal(day.endpointStatus.daily, 'ok');
      assert.equal(day.endpointStatus.spo2, 'empty');
      assert.equal(day.endpointStatus.trainingReadiness, 'unsupported');
    });
  });

  describe('describe', () => {
    it('returns a human-readable description', async () => {
      const src = createGarminConnectSource({ id: 'my-garmin', enabled: true, label: 'Min Garmin' });
      assert.ok(src.describe().includes('garminConnect'));
      assert.ok(src.describe().includes('my-garmin'));
    });
  });
});
