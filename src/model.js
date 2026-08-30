import crypto from 'node:crypto';
import { maxHr, restingHr } from './config.js';

export const ACTIVITY_TYPES = [
  'running',
  'trailrunning',
  'hiking',
  'walking',
  'cycling',
  'skiing',
  'other',
];

/** Map many vendor strings onto our canonical activity types. */
export function normalizeType(raw) {
  if (!raw) return 'other';
  const s = String(raw).toLowerCase().replace(/[\s_-]/g, '');
  if (/(trail).*run|run.*trail/.test(s)) return 'trailrunning';
  if (/run|jog|løp|lop/.test(s)) return 'running';
  if (/hik|fjell|tur|trek|mountain/.test(s)) return 'hiking';
  if (/walk|gå|gange|gange/.test(s)) return 'walking';
  if (/cycl|bike|bik|sykk|ride/.test(s)) return 'cycling';
  if (/ski|langrenn/.test(s)) return 'skiing';
  return 'other';
}

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Compute a stable id for an activity from its identity fields so re-ingesting
 * the same file does not create duplicates.
 */
export function activityId({ source, start, distanceM, type }) {
  const h = crypto.createHash('sha1');
  h.update(`${source}|${start}|${Math.round(distanceM || 0)}|${type}`);
  return h.digest('hex').slice(0, 16);
}

/** Heart-rate zone boundaries (bpm) using the Karvonen-free %HRmax model. */
export function hrZoneBounds() {
  const hrMax = maxHr();
  const pct = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const zones = [];
  for (let i = 0; i < 5; i++) {
    zones.push({
      zone: i + 1,
      minBpm: Math.round(hrMax * pct[i]),
      maxBpm: Math.round(hrMax * pct[i + 1]),
    });
  }
  return zones;
}

export function zoneForHr(bpm) {
  if (!bpm) return null;
  const bounds = hrZoneBounds();
  for (const z of bounds) {
    if (bpm < z.maxBpm) return z.zone;
  }
  return 5;
}

/**
 * Given a track (array of {lat,lon,ele?,t,hr?}) derive summary metrics.
 * `t` is seconds from activity start. Missing pieces are tolerated.
 */
export function deriveFromTrack(track) {
  const out = {
    distanceM: 0,
    elevationGainM: 0,
    elevationLossM: 0,
    movingTimeSec: 0,
    durationSec: 0,
    avgHr: null,
    maxHr: null,
    avgPaceSecPerKm: null,
    maxSpeedMs: null,
  };
  const pts = (track || []).filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)
  );
  if (pts.length < 2) {
    // Still salvage HR / duration if present.
    const hrs = (track || []).map((p) => p.hr).filter(Number.isFinite);
    if (hrs.length) {
      out.avgHr = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
      out.maxHr = Math.max(...hrs);
    }
    const ts = (track || []).map((p) => p.t).filter(Number.isFinite);
    if (ts.length > 1) out.durationSec = Math.max(...ts) - Math.min(...ts);
    return out;
  }

  let hrSum = 0;
  let hrCount = 0;
  let eleSmoothPrev = Number.isFinite(pts[0].ele) ? pts[0].ele : null;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = haversine(a, b);
    out.distanceM += d;

    const dt = Number.isFinite(a.t) && Number.isFinite(b.t) ? b.t - a.t : null;
    if (dt != null && dt > 0) {
      const speed = d / dt; // m/s
      if (speed > 0.5) out.movingTimeSec += dt; // ~1.8 km/h threshold
      if (out.maxSpeedMs == null || speed > out.maxSpeedMs) {
        if (speed < 30) out.maxSpeedMs = speed; // drop GPS spikes
      }
    }

    if (Number.isFinite(b.ele) && eleSmoothPrev != null) {
      const de = b.ele - eleSmoothPrev;
      if (de > 1) out.elevationGainM += de; // 1 m noise gate
      else if (de < -1) out.elevationLossM += -de;
      if (Math.abs(de) > 1) eleSmoothPrev = b.ele;
    } else if (Number.isFinite(b.ele) && eleSmoothPrev == null) {
      eleSmoothPrev = b.ele;
    }

    if (Number.isFinite(b.hr)) {
      hrSum += b.hr;
      hrCount++;
      if (out.maxHr == null || b.hr > out.maxHr) out.maxHr = b.hr;
    }
  }

  const first = pts[0];
  const last = pts[pts.length - 1];
  if (Number.isFinite(first.t) && Number.isFinite(last.t)) {
    out.durationSec = last.t - first.t;
  }
  if (!out.movingTimeSec) out.movingTimeSec = out.durationSec;
  if (hrCount) out.avgHr = Math.round(hrSum / hrCount);
  if (out.distanceM > 0 && out.movingTimeSec > 0) {
    out.avgPaceSecPerKm = out.movingTimeSec / (out.distanceM / 1000);
  }

  out.distanceM = Math.round(out.distanceM);
  out.elevationGainM = Math.round(out.elevationGainM);
  out.elevationLossM = Math.round(out.elevationLossM);
  return out;
}

/** Time-in-zone (seconds) from a track with hr + t. */
export function timeInZones(track) {
  const bounds = hrZoneBounds();
  const secs = [0, 0, 0, 0, 0];
  const pts = (track || []).filter(
    (p) => Number.isFinite(p.hr) && Number.isFinite(p.t)
  );
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t;
    if (dt <= 0 || dt > 120) continue;
    const z = zoneForHr(pts[i].hr);
    if (z) secs[z - 1] += dt;
  }
  return bounds.map((b, i) => ({ ...b, seconds: Math.round(secs[i]) }));
}

/**
 * Final assembly: take a partially-filled activity (from a parser) and fill in
 * everything derivable, returning the canonical normalized object.
 */
export function finalizeActivity(partial) {
  const track = (partial.track || []).map((p) => ({
    lat: p.lat,
    lon: p.lon,
    ele: Number.isFinite(p.ele) ? p.ele : undefined,
    t: Number.isFinite(p.t) ? p.t : undefined,
    hr: Number.isFinite(p.hr) ? p.hr : undefined,
  }));

  const derived = deriveFromTrack(track);
  const m = { ...derived };
  // Parser-provided values win over derived ones when present.
  for (const k of [
    'distanceM',
    'durationSec',
    'movingTimeSec',
    'elevationGainM',
    'elevationLossM',
    'avgHr',
    'maxHr',
    'avgPaceSecPerKm',
  ]) {
    if (partial[k] != null && partial[k] !== '') m[k] = partial[k];
  }

  const start =
    partial.start ||
    (partial.startEpochMs ? new Date(partial.startEpochMs).toISOString() : null);
  const end =
    partial.end ||
    (start && m.durationSec
      ? new Date(new Date(start).getTime() + m.durationSec * 1000).toISOString()
      : null);

  const type = normalizeType(partial.type);
  const id =
    partial.id ||
    activityId({ source: partial.source, start, distanceM: m.distanceM, type });

  const hrZones =
    partial.hrZones && partial.hrZones.length
      ? partial.hrZones
      : timeInZones(track);

  const bounds = [];
  for (const p of track) {
    if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) bounds.push([p.lat, p.lon]);
  }

  return {
    id,
    source: partial.source || 'unknown',
    sourceRef: partial.sourceRef || null,
    parser: partial.parser || null,
    type,
    name: partial.name || defaultName(type, start),
    start,
    end,
    durationSec: round(m.durationSec),
    movingTimeSec: round(m.movingTimeSec),
    distanceM: round(m.distanceM),
    elevationGainM: round(m.elevationGainM),
    elevationLossM: round(m.elevationLossM),
    avgHr: m.avgHr ?? null,
    maxHr: m.maxHr ?? null,
    avgPaceSecPerKm: m.avgPaceSecPerKm ? Math.round(m.avgPaceSecPerKm) : null,
    maxSpeedMs: derived.maxSpeedMs ?? null,
    steps: numOrNull(partial.steps),
    calories: numOrNull(partial.calories),
    avgCadence: numOrNull(partial.avgCadence),
    avgPower: numOrNull(partial.avgPower),
    avgTempC: numOrNull(partial.avgTempC),
    hrRest: restingHr(),
    hrMax: maxHr(),
    hrZones,
    extras: partial.extras || {},
    hasTrack: bounds.length > 1,
    track,
    ingestedAt: new Date().toISOString(),
  };
}

function defaultName(type, start) {
  const label = {
    running: 'Løpetur',
    trailrunning: 'Terrengløp',
    hiking: 'Fjelltur',
    walking: 'Gåtur',
    cycling: 'Sykkeltur',
    skiing: 'Skitur',
    other: 'Økt',
  }[type];
  if (!start) return label;
  const d = new Date(start);
  const hh = String(d.getHours()).padStart(2, '0');
  const parts = ['morgen', 'formiddag', 'ettermiddag', 'kveld'];
  const bucket = parts[Math.min(3, Math.floor(d.getHours() / 6))];
  return `${label} ${bucket}`;
}

const round = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
const numOrNull = (v) => (Number.isFinite(Number(v)) && v != null && v !== '' ? Number(v) : null);
