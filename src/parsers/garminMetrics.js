// Keep Garmin's original measurements as well as stable fields used by the UI.
const num = (v) => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
export function garminZones(raw) {
  const rows = Array.isArray(raw) ? raw : raw?.hrTimeInZones || raw?.timeInZones || [];
  const zones = rows.map((r, i) => ({
    zone: num(r.zoneNumber ?? r.zone) ?? i + 1,
    minBpm: num(r.zoneLowBoundary ?? r.minBpm),
    maxBpm: num(r.zoneHighBoundary ?? r.maxBpm),
    seconds: num(r.secsInZone ?? r.seconds ?? r.timeInZone),
  })).filter((r) => r.zone > 0 && r.seconds != null).sort((a,b) => a.zone-b.zone);
  for (let i = 0; i < zones.length; i++) {
    // The time-in-zones endpoint commonly reports only the lower boundary.
    zones[i].maxBpm ??= zones[i+1]?.minBpm ?? null;
  }
  return zones;
}
export function garminMetrics(s) {
  const fields = {
    aerobicTrainingEffect: ['trainingEffect', 'aerobicTrainingEffect'],
    anaerobicTrainingEffect: ['anaerobicTrainingEffect'],
    trainingLoad: ['activityTrainingLoad', 'trainingLoad'],
    vo2Max: ['vO2MaxValue', 'vo2MaxValue'],
    recoveryTimeMinutes: ['recoveryTime'],
    avgStrideLengthCm: ['avgStrideLength'],
    avgVerticalOscillationCm: ['avgVerticalOscillation'],
    avgGroundContactTimeMs: ['avgGroundContactTime'],
    avgVerticalRatio: ['avgVerticalRatio'],
    avgGroundContactBalance: ['avgGroundContactBalance'],
    maxPower: ['maxPower'], normalizedPower: ['normPower', 'normalizedPower'],
    avgSpeedMs: ['averageSpeed'], maxCadence: ['maxRunCadence', 'maxBikeCadence', 'maxCadence'],
    minElevationM: ['minElevation'], maxElevationM: ['maxElevation'],
    minTempC: ['minTemperature'], maxTempC: ['maxTemperature'],
    totalStrokes: ['totalStrokes'], poolLengthM: ['poolLength'],
    avgSwolf: ['averageSwolf', 'avgSwolf'], lengths: ['numberOfActiveLengths'],
    avgStrokeCadence: ['averageSwimCadenceInStrokesPerMinute'],
    activeCalories: ['activeCalories'], restingCalories: ['bmrCalories'],
    minHr: ['minHR', 'minHeartRate'],
  };
  const out = {};
  for (const [key, names] of Object.entries(fields)) {
    const v = names.map((n) => num(s[n])).find((n) => n != null);
    if (v != null) out[key] = v;
  }
  if (s.trainingEffectLabel) out.trainingEffectLabel = s.trainingEffectLabel;
  return out;
}
