/**
 * Garmin Connect source adapter, built on Garmin's Personal API.
 *
 * Authentication is a personal API key the user creates at
 * https://connect.garmin.com/app/settings/personalApiToken and installs with
 * scripts/auth-garmin.mjs. The key lives in config/keys/garmin-{id}/ and is
 * never exposed through the web UI or the HTTP API.
 *
 * config: {
 *   id, enabled, label?,
 *   tokenFile: "./config/keys/garmin-{id}",   // key directory, set by manage.js
 *   healthStartDate?, healthBatchDays?
 * }
 *
 * The Personal API is read-only and has no time-series endpoint, so GPS tracks
 * and per-second metrics are decoded from the original FIT file download.
 *
 * For testing, set src._api to a stub exposing get()/getBuffer().
 */
import path from 'node:path';
import config, { resolvePath } from '../config.js';
import { createPersonalApi } from '../garmin/personalApi.js';
import { unzip } from '../garmin/zip.js';
import { decodeActivityFiles } from '../garmin/fit.js';

const PAGE_SIZE = 100;

/** Endpoints Garmin does not expose through the Personal API. */
const GONE = ['vo2Max', 'trainingStatus', 'trainingReadiness'];

export function keyDirFor(cfg) {
  return cfg.tokenFile ? resolvePath(cfg.tokenFile) : path.join(config.paths.keys, `garmin-${cfg.id}`);
}

/** Collect several optional endpoints, keeping per-endpoint status visible. */
async function collect(api, calls) {
  const data = {};
  const status = {};
  for (const [key, [reqPath, params]] of Object.entries(calls)) {
    try {
      const value = await api.get(reqPath, params);
      if (value == null || (Array.isArray(value) && !value.length) ||
          (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) {
        status[key] = 'empty';
      } else {
        data[key] = value;
        status[key] = 'ok';
      }
    } catch (err) {
      // Auth and throttling stop the sync instead of issuing more requests.
      if (err.status === 401 || err.status === 429) throw err;
      status[key] = [400, 403, 404, 204].includes(err.status) ? 'unsupported' : 'error';
    }
  }
  return { data, status };
}

/** Per-zone seconds from the activity list's hrTimeInZone_N / powerTimeInZone_N fields. */
function timeInZones(summary, prefix, floors = null) {
  const rows = [];
  for (let zone = 1; zone <= 7; zone++) {
    const seconds = summary?.[`${prefix}_${zone}`];
    if (seconds == null) continue;
    rows.push({
      zoneNumber: zone,
      secsInZone: Number(seconds),
      ...(floors?.[`zone${zone}Floor`] != null ? { zoneLowBoundary: Number(floors[`zone${zone}Floor`]) } : {}),
    });
  }
  return rows.length ? rows : null;
}

/**
 * Build the Garmin Connect source adapter.
 * @param {object} cfg  Source configuration from config.sources[]
 */
export function createGarminConnectSource(cfg) {
  const keyDir = keyDirFor(cfg);
  let hrZonesCache; // undefined = not fetched, null = unavailable

  return {
    id: cfg.id,
    type: 'garminConnect',
    // Allow test injection.
    _api: createPersonalApi({ keyDir }),

    describe: () => `garminConnect ${cfg.id}${cfg.label ? ` (${cfg.label})` : ''}`,

    /** The user's configured heart rate zone boundaries, fetched once per sync. */
    async _hrZoneFloors() {
      if (hrZonesCache !== undefined) return hrZonesCache;
      try {
        hrZonesCache = (await this._api.get('/biometric-service/heartRateZones/v2')) || null;
      } catch {
        // Boundaries are decoration; time-in-zone still imports without them.
        hrZonesCache = null;
      }
      return hrZonesCache;
    },

    /**
     * List activities as file-like entries, newest first.
     * Each entry uses the Garmin activity ID as `ref` (stable across syncs).
     */
    async listFiles() {
      const files = [];
      for (let start = 0; ; start += PAGE_SIZE) {
        const page = await this._api.get('/activitylist-service/activities/search/activities', {
          start,
          limit: PAGE_SIZE,
        });
        if (!Array.isArray(page)) throw new Error('Garmin returnerte ikke en aktivitetsliste');
        for (const a of page) {
          files.push({
            ref: String(a.activityId),
            name: a.activityName || a.activityType?.typeKey || `Garmin-${a.activityId}`,
            // Re-import whenever any summary field changed.
            modifiedTime: `v3:${JSON.stringify(a)}`,
            size: a.distance ?? 0,
            startDate: (a.startTimeLocal || a.startTimeGMT || '').slice(0, 10) ||
              (a.beginTimestamp ? new Date(a.beginTimestamp).toISOString().slice(0, 10) : null),
            _garminType: a.activityType?.typeKey || 'unknown',
            _hasPolyline: a.hasPolyline !== false,
            // Keep the summary so readJson needs no second list call.
            _summary: a,
          });
        }
        if (page.length < PAGE_SIZE) break;
      }
      return files;
    },

    healthStartDate: cfg.healthStartDate || null,
    healthBatchDays: Math.max(1, Math.min(90, Number(cfg.healthBatchDays) || 30)),

    /** One day of health data, shaped like the panel in the web UI expects. */
    async readHealth(date) {
      const { data, status } = await collect(this._api, {
        daily: ['/usersummary-service/usersummary/daily', { calendarDate: date }],
        dailyV2: ['/usersummary-service/v2/dailysummaries', { startDate: date, endDate: date }],
        heartRate: ['/wellness-service/wellness/dailyHeartRate', { date }],
        steps: [`/usersummary-service/stats/steps/daily/${date}/${date}`],
        stress: [`/usersummary-service/stats/stress/daily/${date}/${date}`],
        hydration: [`/usersummary-service/stats/hydration/daily/${date}/${date}`],
        sleep: ['/sleep-service/sleep/dailySleep', { date }],
        hrv: [`/hrv-service/hrv/${date}`],
        bodyBattery: ['/wellness-service/wellness/bodyBattery/reports/daily', { startDate: date, endDate: date }],
        spo2: [`/wellness-service/wellness/daily/spo2acclimation/${date}`],
        fitnessAge: [`/fitnessage-service/fitnessage/v2/${date}`],
        weight: [`/weight-service/weight/range/${date}/${date}`, { includeAll: 'true' }],
      });

      // Body Battery and the daily stats endpoints answer with a one-element
      // range; unwrap so the UI sees a single day like it did before.
      if (Array.isArray(data.bodyBattery)) data.bodyBattery = data.bodyBattery[0] ?? null;
      for (const key of ['steps', 'stress', 'hydration']) {
        if (Array.isArray(data[key])) data[key] = data[key][0] ?? null;
      }

      // Respiration has no endpoint of its own but rides along in the daily summary.
      const daily = data.daily || {};
      if (daily.avgWakingRespirationValue != null || daily.latestRespirationValue != null) {
        data.respiration = {
          avgWakingRespirationValue: daily.avgWakingRespirationValue,
          highestRespirationValue: daily.highestRespirationValue,
          lowestRespirationValue: daily.lowestRespirationValue,
          latestRespirationValue: daily.latestRespirationValue,
        };
        status.respiration = 'ok';
      }

      for (const key of GONE) status[key] = 'unsupported';

      if (!Object.keys(data).length && Object.values(status).includes('error')) {
        throw new Error('Garmin-helsedata feilet; dagen prøves igjen');
      }
      return { date, data, endpointStatus: status };
    },

    /** Full activity detail: summary from the API, samples from the FIT file. */
    async readJson(file) {
      const id = file.ref;
      const summary = file._summary || {};
      const detail = (await this._api.get(`/activity-service/activity/${id}`)) || {};

      const merged = { ...summary, ...detail };
      merged._garmin = true;
      merged._garminType = file._garminType;
      merged._hasPolyline = file._hasPolyline;

      const floors = await this._hrZoneFloors();
      const status = {};
      const extras = {};
      if (floors) extras.configuredHrZones = floors;
      const hrZones = timeInZones(summary, 'hrTimeInZone', floors);
      const powerZones = timeInZones(summary, 'powerTimeInZone');
      if (hrZones) extras.hrTimeInZones = hrZones;
      if (powerZones) extras.powerTimeInZones = powerZones;
      if (detail.splitSummaries?.length) extras.splitSummaries = detail.splitSummaries;
      if (summary.summarizedExerciseSets?.length) extras.exerciseSets = summary.summarizedExerciseSets;

      try {
        const workouts = await this._api.get(`/activity-service/activity/${id}/workouts`);
        if (workouts && (!Array.isArray(workouts) || workouts.length)) extras.workouts = workouts;
      } catch (err) {
        if (err.status === 401 || err.status === 429) throw err;
      }

      // The original file is the only source of per-second data in this API.
      let samples = [];
      try {
        const zip = await this._api.getBuffer(`/download-service/files/activity/${id}`);
        const decoded = decodeActivityFiles(unzip(zip));
        samples = decoded.track;
        if (decoded.session) extras.fitSession = decoded.session;
        status.samples = samples.length ? 'ok' : 'empty';
      } catch (err) {
        if (err.status === 401 || err.status === 429) throw err;
        // Manually entered activities have no file at all.
        status.samples = [400, 403, 404, 204].includes(err.status) ? 'unsupported' : 'error';
      }

      merged.samples = samples;
      merged.track = samples.filter((p) => p.lat != null && p.lon != null);
      merged.garminExtras = extras;
      merged.endpointStatus = status;
      return merged;
    },
  };
}
