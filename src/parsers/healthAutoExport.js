/**
 * Parser for the "Health Auto Export" iOS app JSON format (a very common way to
 * get Apple Health workout + route data onto Google Drive as .json files).
 *
 * The app has shifted its schema over versions, so every field access here is
 * defensive. Shape (roughly):
 *   { data: { workouts: [ {
 *       name, start, end, duration,
 *       distance: { qty, units }, activeEnergyBurned: { qty, units },
 *       stepCount: { qty }, elevationUp: { qty }, elevationDown: { qty },
 *       heartRateData: [ { date, qty | Avg, Min, Max } ],
 *       route | GPS: [ { lat, lon | lng, altitude, timestamp | date, speed } ]
 *   } ] } }
 */

const num = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return num(v.qty ?? v.value ?? v.Avg ?? v.avg);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function toMeters(qty, units) {
  if (qty == null) return null;
  const u = String(units || 'm').toLowerCase();
  if (u.startsWith('km')) return qty * 1000;
  if (u === 'mi' || u.startsWith('mile')) return qty * 1609.344;
  if (u === 'ft' || u.startsWith('feet')) return qty * 0.3048;
  return qty; // assume metres
}

function pickWorkouts(json) {
  if (Array.isArray(json?.data?.workouts)) return json.data.workouts;
  if (Array.isArray(json?.workouts)) return json.workouts;
  if (Array.isArray(json?.data) && json.data[0]?.route) return json.data;
  if (json?.name && (json?.route || json?.GPS || json?.gps)) return [json];
  return null;
}

export default {
  id: 'healthAutoExport',

  detect(json) {
    const w = pickWorkouts(json);
    if (!w || !w.length) return false;
    const s = w[0];
    return (
      'route' in s || 'GPS' in s || 'gps' in s ||
      'heartRateData' in s || 'activeEnergyBurned' in s ||
      'stepCount' in s || 'elevationUp' in s
    );
  },

  parse(json, ctx) {
    const workouts = pickWorkouts(json) || [];
    return workouts.map((w) => parseWorkout(w, ctx)).filter(Boolean);
  },
};

function parseWorkout(w, ctx) {
  const startD = asDate(w.start ?? w.startDate ?? w.startTime);
  const endD = asDate(w.end ?? w.endDate ?? w.endTime);
  const start = startD ? startD.toISOString() : null;
  const startMs = startD ? startD.getTime() : null;

  const rawRoute = w.route || w.GPS || w.gps || w.locations || [];
  const track = [];
  for (const p of rawRoute) {
    const lat = num(p.lat ?? p.latitude);
    const lon = num(p.lon ?? p.lng ?? p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const pd = asDate(p.timestamp ?? p.date ?? p.time);
    track.push({
      lat,
      lon,
      ele: num(p.altitude ?? p.elevation ?? p.ele),
      t: pd && startMs ? (pd.getTime() - startMs) / 1000 : undefined,
      hr: undefined,
      speed: num(p.speed),
    });
  }

  // Merge heart-rate samples onto the nearest track point by time.
  const hrData = w.heartRateData || w.heartRate || w.heart_rate || [];
  const hrSamples = [];
  for (const h of hrData) {
    const hd = asDate(h.date ?? h.timestamp ?? h.time);
    const bpm = num(h.qty ?? h.Avg ?? h.avg ?? h.value);
    if (hd && startMs && Number.isFinite(bpm)) {
      hrSamples.push({ t: (hd.getTime() - startMs) / 1000, hr: bpm });
    }
  }
  if (hrSamples.length && track.length) {
    hrSamples.sort((a, b) => a.t - b.t);
    let j = 0;
    for (const pt of track) {
      if (pt.t == null) continue;
      while (j < hrSamples.length - 1 && hrSamples[j + 1].t < pt.t) j++;
      const a = hrSamples[j];
      const b = hrSamples[Math.min(j + 1, hrSamples.length - 1)];
      pt.hr = Math.abs(a.t - pt.t) <= Math.abs(b.t - pt.t) ? a.hr : b.hr;
    }
  }

  let duration = num(w.duration);
  // Health Auto Export sometimes reports duration in minutes.
  if (duration && start && endD) {
    const spanSec = (endD.getTime() - startMs) / 1000;
    if (duration < spanSec / 10) duration *= 60;
  }

  const hrStats = hrArrayStats(hrData);

  return {
    source: ctx.sourceId,
    sourceRef: ctx.ref,
    parser: 'healthAutoExport',
    type: w.name || w.workoutActivityType || w.type,
    name: w.name || null,
    start,
    end: endD ? endD.toISOString() : null,
    durationSec: duration || null,
    distanceM:
      toMeters(num(w.distance), w.distance?.units) ??
      toMeters(num(w.totalDistance), w.totalDistance?.units),
    elevationGainM: num(w.elevationUp ?? w.totalAscent ?? w.elevationAscended),
    elevationLossM: num(w.elevationDown ?? w.totalDescent ?? w.elevationDescended),
    avgHr: hrStats.avg ?? num(w.averageHeartRate),
    maxHr: hrStats.max ?? num(w.maxHeartRate),
    steps: num(w.stepCount ?? w.steps),
    calories: num(w.activeEnergyBurned ?? w.totalEnergyBurned ?? w.calories),
    avgCadence: num(w.stepCadence ?? w.averageCadence),
    avgTempC: num(w.temperature),
    extras: {},
    track,
  };
}

function hrArrayStats(arr) {
  const vals = [];
  let max = null;
  for (const h of arr || []) {
    const v = num(h.qty ?? h.Avg ?? h.avg ?? h.value);
    const mx = num(h.Max ?? h.max);
    if (Number.isFinite(v)) vals.push(v);
    if (Number.isFinite(mx)) max = Math.max(max ?? 0, mx);
  }
  const avg = vals.length
    ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
    : null;
  if (max == null && vals.length) max = Math.max(...vals);
  return { avg, max };
}
