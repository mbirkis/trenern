/**
 * Parser for Garmin Connect activity JSON (output by garmin_client Python helper).
 *
 * Detects data by the `_garmin: true` marker added by the source adapter.
 * Handles both GPS and non-GPS activities:
 * - GPS activities: extracts track points + summary metrics
 * - Non-GPS activities (strength, yoga, etc.): returns summary with empty track
 *
 * This parser runs before genericTrack (it's more specific) and MUST be
 * registered before genericTrack in the PARSERS array.
 */
import { activityId } from '../model.js';

const NUM = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const iso = (v) => {
  if (v == null || v === '') return null;
  const s = typeof v === 'string' ? v.replace(' ', 'T') : v;
  const d = new Date(typeof s === 'number' && s < 1e11 ? s * 1000 : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export default {
  id: 'garminConnect',

  detect(json, ref) {
    return !!(json && json._garmin === true);
  },

  parse(json, ctx) {
    // Garmin detail responses nest metrics under summaryDTO, unlike list responses.
    // Preserve support for the legacy flat payload and do not mutate the input.
    const summary = json.summaryDTO || {};
    json = { ...json, ...summary };
    json.averageHeartRate = json.averageHeartRate ?? summary.averageHR;
    json.maxHeartRate = json.maxHeartRate ?? summary.maxHR;
    json.averageRunningCadence = json.averageRunningCadence ?? summary.averageRunCadence;
    const typeKey = json.activityTypeDTO?.typeKey || json.activityType?.typeKey || json._garminType || 'other';
    const startStr = json.startTimeGMT
      ? iso(`${json.startTimeGMT.replace(' ', 'T')}Z`)
      : iso(json.beginTimestamp) || iso(json.startTime) || iso(json.startTimeLocal);
    if (!startStr) return [];
    const startMs = Date.parse(startStr);

    const rawTrack = Array.isArray(json.track) ? json.track : [];
    const track = rawTrack.map((p) => {
      const t = NUM(p.t);
      const seconds = t == null ? undefined
        : t > 1e11 ? (t - startMs) / 1000
        : t > 1e9 ? t - startMs / 1000 : t;
      return {
        lat: NUM(p.lat), lon: NUM(p.lon), ele: NUM(p.ele) ?? undefined,
        hr: NUM(p.hr) ?? undefined, t: seconds, cad: NUM(p.cad) ?? undefined,
        speed: NUM(p.speed) ?? undefined,
      };
    }).filter((p) => p.lat != null && p.lon != null && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);

    // Duration: preferred movingDuration, fallback to duration
    const movingSec = NUM(json.movingDuration) || NUM(json.duration);
    const durSec = NUM(json.duration) || movingSec;

    const partial = {
      // identity
      id: activityId({ source: ctx.sourceId, start: `garmin:${json.activityId || ctx.ref}`, distanceM: 0, type: 'garmin' }),
      source: ctx.sourceId,
      sourceRef: String(json.activityId || ctx.ref),
      parser: 'garminConnect',

      // type: use Garmin's typeKey and normalize through the model
      type: typeKey,

      // name
      name: json.activityName || json.activityName || null,

      // times
      start: startStr,
      end: json.endTime ||
        (startStr && durSec
          ? new Date(new Date(startStr).getTime() + durSec * 1000).toISOString()
          : null),

      // metrics — try Garmin field names, fall through to model derivation
      distanceM: NUM(json.distance),
      durationSec: durSec,
      movingTimeSec: movingSec,
      elevationGainM: NUM(json.elevationGain),
      elevationLossM: NUM(json.elevationLoss) ?? NUM(json.elevationGain),
      avgHr: NUM(json.averageHeartRate),
      maxHr: NUM(json.maxHeartRate),
      calories: NUM(json.calories),
      steps: NUM(json.steps),
      avgCadence: NUM(json.averageCadence || json.averageRunningCadence),
      avgPower: NUM(json.averagePower),
      avgTempC: NUM(json.averageTemperature),
      avgPaceSecPerKm: null, // let model derive from distance/time
      maxSpeedMs: NUM(json.maxSpeed),

      // extras: keep Garmin metadata
      extras: {
        garminActivityId: json.activityId,
        garminTypeKey: typeKey,
        garminLocation: json.locationName || null,
        garminTimezone: json.timeZone || null,
        garminHasPolyline: json._hasPolyline !== false,
      },

      // track
      track,
    };

    return [partial];
  },
};