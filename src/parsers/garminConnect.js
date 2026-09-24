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
import { finalizeActivity as _finalize, normalizeType } from '../model.js';

const NUM = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export default {
  id: 'garminConnect',

  detect(json, ref) {
    return !!(json && json._garmin === true);
  },

  parse(json, ctx) {
    const typeKey = json.activityType?.typeKey || json._garminType || 'other';
    const startStr =
      json.startTime ||
      (json.beginTimestamp ? new Date(json.beginTimestamp).toISOString() : null);

    // Track points: from the `track` array. Each point has lat/lon/ele/hr/t.
    const rawTrack = Array.isArray(json.track) ? json.track : [];
    const track = rawTrack.map((p) => ({
      lat: NUM(p.lat),
      lon: NUM(p.lon),
      ele: NUM(p.ele) ?? undefined,
      hr: NUM(p.hr) ?? undefined,
      t: NUM(p.t) ?? undefined,
      cad: NUM(p.cad) ?? undefined,
      speed: NUM(p.speed) ?? undefined,
    })).filter((p) => p.lat != null && p.lon != null);

    // Duration: preferred movingDuration, fallback to duration
    const movingSec = NUM(json.movingDuration) || NUM(json.duration);
    const durSec = NUM(json.duration) || movingSec;

    const partial = {
      // identity
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