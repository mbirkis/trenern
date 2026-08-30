/**
 * Parser for the "Health Auto Export" iOS app JSON format (a very common way to
 * get Apple Health workout + route data onto Google Drive as .json files).
 *
 * The app has shifted its schema over versions, so every field access here is
 * defensive. Shape (roughly):
 *   { data: { workouts: [ {
 *       name, start, end, duration,
 *       distance: { qty, units }, activeEnergyBurned | activeEnergy: kcal or kJ,
 *       stepCount: { qty } | [ { qty } ], elevationUp: { qty }, elevationDown,
 *       avgHeartRate: { qty }, maxHeartRate: { qty },
 *       heartRateData: [ { date, qty | Avg, Min, Max } ],
 *       route | GPS: [ { lat|latitude, lon|lng|longitude, altitude, timestamp|date, speed } ]
 *   } ] } }
 *
 * Notes:
 *  - Dates look like "2026-08-30 14:04:37 +0200" (space, not 'T'); Date() parses them.
 *  - Some exports put only *recovery* HR (after the workout ended) in
 *    heartRateData. Samples outside the workout window are dropped so they don't
 *    smear one bogus value across the whole route; avg/max then come from the
 *    workout's own aggregate fields.
 *  - Energy may be in kJ; stepCount / activeEnergy may be per-minute sample arrays.
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

/** A metric that can be a scalar, a {qty} object, or an array of {qty} samples. */
function qtyOf(v) {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const s = v.reduce((acc, x) => acc + (num(x) || 0), 0);
    return v.length ? Math.round(s) : null;
  }
  return num(v);
}

/** Energy metric -> kcal. Handles kJ, arrays of samples, and plain numbers. */
function toKcal(v) {
  if (v == null) return null;
  const units = !Array.isArray(v) && typeof v === 'object' ? v.units : Array.isArray(v) ? v[0]?.units : null;
  const qty = qtyOf(v);
  if (qty == null) return null;
  return /kj/i.test(String(units || '')) ? Math.round(qty / 4.184) : Math.round(qty);
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

  let duration = num(w.duration);
  // Health Auto Export sometimes reports duration in minutes.
  if (duration && start && endD) {
    const spanSec = (endD.getTime() - startMs) / 1000;
    if (duration < spanSec / 10) duration *= 60;
  }

  // Heart-rate samples. Only keep those that actually fall inside the workout
  // window — some exports put post-workout *recovery* HR under heartRateData,
  // which would otherwise smear a single bogus value across the whole route.
  const trackSpanSec =
    track.length && Number.isFinite(track[track.length - 1].t)
      ? track[track.length - 1].t
      : null;
  const windowEnd = Math.max(
    duration || 0,
    trackSpanSec || 0,
    startMs && endD ? (endD.getTime() - startMs) / 1000 : 0
  );
  const hrData = Array.isArray(w.heartRateData)
    ? w.heartRateData
    : Array.isArray(w.heartRate)
      ? w.heartRate
      : Array.isArray(w.heart_rate)
        ? w.heart_rate
        : [];
  const allHrSamples = [];
  for (const h of hrData) {
    const hd = asDate(h.date ?? h.timestamp ?? h.time);
    const bpm = num(h.qty ?? h.Avg ?? h.avg ?? h.value);
    if (hd && startMs && Number.isFinite(bpm)) {
      allHrSamples.push({ t: (hd.getTime() - startMs) / 1000, hr: bpm });
    }
  }
  allHrSamples.sort((a, b) => a.t - b.t);
  const inWindow = allHrSamples.filter(
    (s) => s.t >= -30 && s.t <= (windowEnd || Infinity) + 30
  );
  // A usable per-point series needs enough coverage of the activity, not just a
  // couple of stray points.
  const hasSeries =
    inWindow.length >= 5 &&
    (!windowEnd || inWindow[inWindow.length - 1].t - inWindow[0].t >= windowEnd * 0.5);

  if (hasSeries && track.length) {
    let j = 0;
    for (const pt of track) {
      if (pt.t == null) continue;
      while (j < inWindow.length - 1 && inWindow[j + 1].t < pt.t) j++;
      const a = inWindow[j];
      const b = inWindow[Math.min(j + 1, inWindow.length - 1)];
      pt.hr = Math.abs(a.t - pt.t) <= Math.abs(b.t - pt.t) ? a.hr : b.hr;
    }
  }

  // Summary avg/max: trust the workout's own aggregate fields first, then the
  // in-window series, and only fall back to the raw array as a last resort.
  const hrObj = !Array.isArray(w.heartRate) ? w.heartRate : null;
  const seriesStats = hrArrayStats(hasSeries ? inWindow.map((s) => ({ qty: s.hr })) : []);
  const rawAll = hrArrayStats(allHrSamples.map((s) => ({ qty: s.hr })));
  const rnd = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  const avgHr = rnd(
    num(w.avgHeartRate) ??
      num(w.averageHeartRate) ??
      num(hrObj?.avg ?? hrObj?.average) ??
      seriesStats.avg ??
      rawAll.avg
  );
  const maxHr = rnd(
    num(w.maxHeartRate) ?? num(hrObj?.max) ?? seriesStats.max ?? rawAll.max
  );

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
    avgHr,
    maxHr,
    steps: qtyOf(w.stepCount ?? w.steps),
    calories: toKcal(
      w.activeEnergyBurned ?? w.activeEnergy ?? w.totalEnergyBurned ?? w.calories
    ),
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
