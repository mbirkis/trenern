/**
 * Permissive fallback parser. Finds an array of GPS points anywhere in the JSON
 * under a set of common keys (or a bare top-level array) plus loose metadata.
 * Covers ad-hoc exports, GPX-converted-to-JSON, Strava-ish dumps, etc.
 */

const POINT_ARRAY_KEYS = [
  'track', 'points', 'trackpoints', 'trackPoints', 'route', 'samples',
  'records', 'coordinates', 'positions', 'locations', 'gps', 'GPS', 'path',
];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const asDate = (v) => {
  if (v == null) return null;
  const d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function readPoint(p) {
  if (Array.isArray(p)) {
    // [lon, lat] (GeoJSON) or [lat, lon]; disambiguate by range.
    const [a, b, c] = p;
    let lat = a;
    let lon = b;
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
      lat = b;
      lon = a;
    }
    return { lat: num(lat), lon: num(lon), ele: num(c) };
  }
  if (p && typeof p === 'object') {
    return {
      lat: num(p.lat ?? p.latitude ?? p.y),
      lon: num(p.lon ?? p.lng ?? p.long ?? p.longitude ?? p.x),
      ele: num(p.ele ?? p.elevation ?? p.altitude ?? p.alt ?? p.z),
      hr: num(p.hr ?? p.heartRate ?? p.heart_rate ?? p.bpm),
      time: p.time ?? p.timestamp ?? p.date ?? p.t ?? null,
      speed: num(p.speed ?? p.velocity),
      cad: num(p.cad ?? p.cadence),
    };
  }
  return null;
}

function findPointArray(obj, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    const pt = readPoint(obj[0]);
    if (obj.length > 1 && pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lon)) {
      return obj;
    }
    return null;
  }
  for (const k of POINT_ARRAY_KEYS) {
    if (Array.isArray(obj[k])) {
      const found = findPointArray(obj[k], depth + 1);
      if (found) return found;
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findPointArray(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export default {
  id: 'genericTrack',

  detect(json) {
    return !!findPointArray(json);
  },

  parse(json, ctx) {
    const arr = findPointArray(json);
    if (!arr) return [];

    const meta = json.data && !Array.isArray(json.data) ? json.data : json;
    const rawPoints = arr.map(readPoint).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (rawPoints.length < 2) return [];

    const times = rawPoints.map((p) => asDate(p.time)).filter(Boolean);
    const startMs = times.length ? times[0].getTime() : null;

    const track = rawPoints.map((p) => {
      const d = asDate(p.time);
      return {
        lat: p.lat,
        lon: p.lon,
        ele: p.ele ?? undefined,
        hr: p.hr ?? undefined,
        t: d && startMs ? (d.getTime() - startMs) / 1000 : undefined,
        speed: p.speed ?? undefined,
      };
    });

    const start =
      meta.start ?? meta.startTime ?? meta.startDate ?? meta.date ??
      (startMs ? new Date(startMs).toISOString() : null);

    return [
      {
        source: ctx.sourceId,
        sourceRef: ctx.ref,
        parser: 'genericTrack',
        type: meta.type ?? meta.sport ?? meta.activityType ?? meta.name ?? 'other',
        name: meta.name ?? meta.title ?? null,
        start: start ? new Date(start).toISOString() : null,
        end: meta.end ?? meta.endTime ?? null,
        durationSec: num(meta.duration ?? meta.elapsedTime ?? meta.totalTime),
        distanceM: num(meta.distance ?? meta.totalDistance),
        elevationGainM: num(meta.elevationGain ?? meta.totalAscent ?? meta.ascent),
        elevationLossM: num(meta.elevationLoss ?? meta.totalDescent ?? meta.descent),
        avgHr: num(meta.avgHr ?? meta.averageHeartRate ?? meta.avg_heart_rate),
        maxHr: num(meta.maxHr ?? meta.maxHeartRate ?? meta.max_heart_rate),
        steps: num(meta.steps ?? meta.stepCount),
        calories: num(meta.calories ?? meta.energy ?? meta.kcal),
        avgCadence: num(meta.avgCadence ?? meta.averageCadence),
        avgPower: num(meta.avgPower ?? meta.averagePower),
        extras: {},
        track,
      },
    ];
  },
};
