/**
 * Column <-> activity-object mapping shared by the SQLite and Postgres
 * backends. The full normalized activity (including `track`) is always kept in
 * the `data` column; the scalar columns exist for listing, filtering and stats
 * without deserializing every track.
 */

// [ dbColumn, activityKey, kind ]   kind: 'text' | 'int' | 'real' | 'bool' | 'json'
export const COLUMNS = [
  ['id', 'id', 'text'],
  ['source', 'source', 'text'],
  ['source_ref', 'sourceRef', 'text'],
  ['source_name', 'sourceName', 'text'],
  ['parser', 'parser', 'text'],
  ['type', 'type', 'text'],
  ['name', 'name', 'text'],
  ['start_time', 'start', 'text'],
  ['end_time', 'end', 'text'],
  ['duration_sec', 'durationSec', 'int'],
  ['moving_time_sec', 'movingTimeSec', 'int'],
  ['distance_m', 'distanceM', 'int'],
  ['elevation_gain_m', 'elevationGainM', 'int'],
  ['elevation_loss_m', 'elevationLossM', 'int'],
  ['avg_hr', 'avgHr', 'int'],
  ['max_hr', 'maxHr', 'int'],
  ['avg_pace_sec_per_km', 'avgPaceSecPerKm', 'int'],
  ['max_speed_ms', 'maxSpeedMs', 'real'],
  ['steps', 'steps', 'int'],
  ['calories', 'calories', 'int'],
  ['avg_cadence', 'avgCadence', 'int'],
  ['avg_power', 'avgPower', 'int'],
  ['avg_temp_c', 'avgTempC', 'real'],
  ['hr_rest', 'hrRest', 'int'],
  ['hr_max', 'hrMax', 'int'],
  ['has_track', 'hasTrack', 'bool'],
  ['ingested_at', 'ingestedAt', 'text'],
  ['hr_zones', 'hrZones', 'json'],
  ['data', null, 'json'], // full activity object
];

/** Columns returned by list() — everything except the big `data` blob. */
export const SUMMARY_COLUMNS = COLUMNS.filter(([col]) => col !== 'data');

/** Build a plain row object (db column names -> values) from an activity. */
export function activityToRow(a) {
  const row = {};
  for (const [col, key, kind] of COLUMNS) {
    let v;
    if (col === 'data') v = a;
    else v = a[key];
    if (kind === 'json') v = v == null ? null : JSON.stringify(v);
    else if (kind === 'bool') v = v ? 1 : 0;
    else if (v === undefined) v = null;
    row[col] = v;
  }
  return row;
}

/** Reconstruct the list-summary object from a summary row. */
export function rowToSummary(row) {
  const out = {};
  for (const [col, key, kind] of SUMMARY_COLUMNS) {
    let v = row[col];
    if (kind === 'json') v = parseJson(v);
    else if (kind === 'bool') v = !!v;
    else if ((kind === 'int' || kind === 'real') && v != null) v = Number(v);
    out[key] = v ?? null;
  }
  return out;
}

/** Parse the `data` column back into the full activity object. */
export function rowToActivity(dataValue) {
  return parseJson(dataValue);
}

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v; // pg jsonb already parsed
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export function computeStats(summaries) {
  const totals = { count: summaries.length, byType: {}, totalDistanceM: 0,
    totalMovingTimeSec: 0, totalDurationSec: 0, totalPauseTimeSec: 0,
    totalElevationGainM: 0, totalElevationLossM: 0, totalCalories: 0, totalSteps: 0,
    hrZones: {}, coverage: {}, averages: {} };
  const sums = {}, weights = {};
  for (const a of summaries) {
    totals.byType[a.type] = (totals.byType[a.type] || 0) + 1;
    for (const [key, field] of Object.entries({ totalDistanceM: 'distanceM',
      totalMovingTimeSec: 'movingTimeSec', totalDurationSec: 'durationSec',
      totalElevationGainM: 'elevationGainM', totalElevationLossM: 'elevationLossM',
      totalCalories: 'calories', totalSteps: 'steps' })) {
      if (Number.isFinite(a[field])) {
        totals[key] += a[field];
        totals.coverage[field] = (totals.coverage[field] || 0) + 1;
      }
    }
    totals.totalPauseTimeSec += Math.max(0, (a.durationSec || 0) - (a.movingTimeSec || 0));
    for (const z of a.hrZones || []) {
      totals.hrZones[z.zone] = (totals.hrZones[z.zone] || 0) + (z.seconds || 0);
    }
    // Time-weighted means avoid treating short and long sessions equally.
    for (const field of ['avgHr', 'avgCadence', 'avgPower', 'avgTempC']) {
      if (Number.isFinite(a[field]) && a.movingTimeSec > 0) {
        sums[field] = (sums[field] || 0) + a[field] * a.movingTimeSec;
        weights[field] = (weights[field] || 0) + a.movingTimeSec;
        totals.coverage[field] = (totals.coverage[field] || 0) + 1;
      }
    }
    for (const [key, value] of Object.entries(a.metrics || {})) {
      if (!Number.isFinite(value)) continue;
      const field = `metrics.${key}`;
      sums[field] = (sums[field] || 0) + value;
      weights[field] = (weights[field] || 0) + 1;
      totals.coverage[field] = weights[field];
    }
  }
  for (const [field, sum] of Object.entries(sums)) totals.averages[field] = sum / weights[field];
  for (const key of Object.keys(totals)) if (key.startsWith('total')) totals[key] = Math.round(totals[key]);
  return totals;
}
