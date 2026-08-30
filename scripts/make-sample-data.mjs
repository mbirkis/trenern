/**
 * Generates a few synthetic workout JSON files (Health Auto Export style) into
 * data/sample/ so the app has something to render out of the box.
 *   node scripts/make-sample-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sample');
fs.mkdirSync(dir, { recursive: true });

function makeWorkout({ name, center, radiusM, points, startISO, durMin, baseHr, hrPeak, climb }) {
  const start = new Date(startISO);
  const route = [];
  const heartRateData = [];
  const [clat, clon] = center;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((clat * Math.PI) / 180);
  for (let i = 0; i < points; i++) {
    const frac = i / (points - 1);
    const ang = frac * Math.PI * 2;
    const r = radiusM * (0.75 + 0.25 * Math.sin(ang * 3));
    const lat = clat + (r * Math.cos(ang)) / mPerDegLat;
    const lon = clon + (r * Math.sin(ang)) / mPerDegLon;
    const ele = 120 + climb * (0.5 - 0.5 * Math.cos(ang)) + 4 * Math.sin(ang * 6);
    const t = new Date(start.getTime() + frac * durMin * 60_000);
    route.push({
      lat: +lat.toFixed(6),
      lon: +lon.toFixed(6),
      altitude: +ele.toFixed(1),
      timestamp: t.toISOString(),
      speed: +(2.6 + 0.6 * Math.sin(ang * 2)).toFixed(2),
    });
    const hr = Math.round(
      baseHr + (hrPeak - baseHr) * (0.5 - 0.5 * Math.cos(ang)) + 6 * Math.sin(ang * 5)
    );
    heartRateData.push({ date: t.toISOString(), qty: hr, Min: hr - 4, Max: hr + 4, Avg: hr });
  }
  const distanceKm = (2 * Math.PI * radiusM * 0.9) / 1000;
  return {
    data: {
      workouts: [
        {
          name,
          start: start.toISOString(),
          end: new Date(start.getTime() + durMin * 60_000).toISOString(),
          duration: durMin * 60,
          distance: { qty: +distanceKm.toFixed(2), units: 'km' },
          activeEnergyBurned: { qty: Math.round(distanceKm * 65), units: 'kcal' },
          stepCount: { qty: Math.round(distanceKm * 1400) },
          elevationUp: { qty: Math.round(climb), units: 'm' },
          elevationDown: { qty: Math.round(climb), units: 'm' },
          heartRateData,
          route,
        },
      ],
    },
  };
}

const samples = [
  {
    file: 'run-sognsvann.json',
    args: {
      name: 'Outdoor Run', center: [59.9686, 10.7290], radiusM: 1400, points: 260,
      startISO: '2026-08-24T07:15:00+02:00', durMin: 42, baseHr: 120, hrPeak: 178, climb: 85,
    },
  },
  {
    file: 'hike-vettakollen.json',
    args: {
      name: 'Hiking', center: [59.9820, 10.6790], radiusM: 1800, points: 320,
      startISO: '2026-08-17T10:00:00+02:00', durMin: 135, baseHr: 105, hrPeak: 155, climb: 430,
    },
  },
  {
    file: 'trailrun-grefsenkollen.json',
    args: {
      name: 'Trail Run', center: [59.9640, 10.7900], radiusM: 1200, points: 300,
      startISO: '2026-08-28T17:30:00+02:00', durMin: 58, baseHr: 132, hrPeak: 184, climb: 260,
    },
  },
];

for (const s of samples) {
  fs.writeFileSync(path.join(dir, s.file), JSON.stringify(makeWorkout(s.args), null, 2));
  console.log('skrev', s.file);
}
