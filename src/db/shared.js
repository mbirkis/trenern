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
  const byType = {};
  let distance = 0;
  let duration = 0;
  let gain = 0;
  for (const a of summaries) {
    byType[a.type] = (byType[a.type] || 0) + 1;
    distance += a.distanceM || 0;
    duration += a.movingTimeSec || 0;
    gain += a.elevationGainM || 0;
  }
  return {
    count: summaries.length,
    byType,
    totalDistanceM: Math.round(distance),
    totalMovingTimeSec: Math.round(duration),
    totalElevationGainM: Math.round(gain),
  };
}
