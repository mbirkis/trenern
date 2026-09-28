import * as store from './store.js';
import { haversine } from './model.js';

const API = 'https://ws.geonorge.no/stedsnavn/v1/punkt';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let running = false;
let requested = false;
let completed = 0;
let error = null;

// Spread lookups over distance, so a long route receives names from several areas.
export function sampleTrack(track, count = 6) {
  const points = (track || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!points.length) return [];
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + haversine(points[i - 1], points[i]));
  }
  const total = distances.at(-1);
  if (total < 300) return [points[Math.floor(points.length / 2)]];
  const samples = [];
  for (let i = 0; i < count; i++) {
    const target = total * i / (count - 1);
    let index = distances.findIndex((d) => d >= target);
    if (index < 0) index = points.length - 1;
    const point = points[index];
    if (!samples.some((p) => haversine(p, point) < 250)) samples.push(point);
  }
  return samples;
}

export function namesFromResponse(json) {
  const names = [];
  for (const place of json?.navn || []) {
    if (place.stedstatus && place.stedstatus !== 'aktiv') continue;
    const best = (place.stedsnavn || []).find((n) => n.navnestatus === 'hovednavn' &&
      n.skrivemåtestatus === 'godkjent og prioritert') ||
      (place.stedsnavn || []).find((n) => n.navnestatus === 'hovednavn') ||
      place.stedsnavn?.[0];
    const name = best?.skrivemåte?.trim();
    if (name && !names.some((n) => n.toLocaleLowerCase('no') === name.toLocaleLowerCase('no'))) {
      names.push(name);
    }
    if (names.length >= 3) break;
  }
  return names;
}

export async function tagsForTrack(track, lookup = fetch) {
  const tags = [];
  for (const point of sampleTrack(track)) {
    // Kartverkets register covers Norway. GPS coordinates are WGS84, compatible
    // with ETRS89 (EPSG:4258) for this nearby-place search.
    if (point.lat < 57 || point.lat > 72 || point.lon < 4 || point.lon > 32) continue;
    const url = new URL(API);
    url.search = new URLSearchParams({
      nord: String(point.lat), ost: String(point.lon), koordsys: '4258',
      radius: '600', treffPerSide: '20', side: '1',
    }).toString();
    const response = await lookup(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Kartverket svarte ${response.status}`);
    for (const name of namesFromResponse(await response.json())) {
      if (!tags.some((t) => t.toLocaleLowerCase('no') === name.toLocaleLowerCase('no'))) tags.push(name);
    }
    await pause(250);
  }
  return tags.slice(0, 15);
}

export function placeTagStatus() { return { running, completed, error }; }

export async function startPlaceTagging() {
  if (running) { requested = true; return; }
  running = true;
  error = null;
  try {
    const pending = (await store.list({ full: true })).filter((a) =>
      a.hasTrack && a.placeTagsStatus !== 'done');
    for (const a of pending) {
      try {
        const tags = await tagsForTrack(a.track);
        const current = await store.get(a.id);
        if (!current || current.placeTagsStatus === 'done') continue;
        current.placeTags = tags;
        current.placeTagsStatus = 'done';
        await store.upsert(current);
        completed++;
      } catch (e) {
        error = e.message;
        console.error('Stedsnavn kunne ikke hentes:', e.message);
        break; // Avoid hammering an unavailable service; retry on next sync/start.
      }
    }
  } finally {
    running = false;
    if (requested && !error) {
      requested = false;
      queueMicrotask(() => startPlaceTagging().catch((e) => console.error('Stedsnavn-feil:', e)));
    } else {
      requested = false;
    }
  }
}
