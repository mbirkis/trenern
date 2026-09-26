import express from 'express';
import config from './config.js';
import * as store from './store.js';
import { buildSources, registeredSourceTypes } from './sources/index.js';
import {
  listSourceConfigs,
  getSourceConfig,
  addSource,
  updateSource,
  removeSource,
  testSource,
} from './sources/manage.js';
import { listParsers } from './parsers/index.js';
import { runIngest, ingestStatus, startScheduler } from './ingest.js';
import { computeStats } from './db/shared.js';
import { hrZoneBounds } from './model.js';

const app = express();
app.use(express.json({ limit: '20mb' }));

/**
 * Resolve the effective map tile layer. Uses the Tracestrack Topo style when a
 * key is configured (config.map.tracestrackKey or TRACESTRACK_KEY), otherwise
 * falls back to the standard OSM raster tiles.
 */
function resolveMapConfig() {
  const m = config.map || {};
  const key = process.env.TRACESTRACK_KEY || m.tracestrackKey || '';
  const wantsKey = (m.tileUrl || '').includes('{key}');
  const useTracestrack = !wantsKey || key;
  return {
    tileUrl: useTracestrack
      ? (m.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').replace('{key}', key)
      : m.fallbackTileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: useTracestrack
      ? m.attribution || '&copy; OpenStreetMap contributors'
      : m.fallbackAttribution || '&copy; OpenStreetMap contributors',
    maxZoom: m.maxZoom || 19,
    style: useTracestrack ? 'tracestrack-topo' : 'osm',
  };
}

/** Downsample a track to ~`max` [lat,lon] pairs for the map overview. */
function simplifyTrack(track, max = 250) {
  const pts = (track || []).filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)
  );
  const r = (v) => Math.round(v * 1e5) / 1e5;
  if (pts.length <= max) return pts.map((p) => [r(p.lat), r(p.lon)]);
  const step = Math.ceil(pts.length / max);
  const out = [];
  for (let i = 0; i < pts.length; i += step) out.push([r(pts[i].lat), r(pts[i].lon)]);
  const last = pts[pts.length - 1];
  out.push([r(last.lat), r(last.lon)]);
  return out;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) => {
  res.json({
    athlete: config.athlete,
    hrZones: hrZoneBounds(),
    parsers: listParsers(),
    ingest: config.ingest,
    map: resolveMapConfig(),
  });
});

app.get('/api/sources', (_req, res) => {
  res.json({ types: registeredSourceTypes(), sources: listSourceConfigs() });
});

app.get('/api/sources/:id', (req, res) => {
  const s = getSourceConfig(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
});

app.post('/api/sources', (req, res) => {
  const { errors, source } = addSource(req.body || {});
  if (errors) return res.status(400).json({ errors });
  res.status(201).json(source);
});

app.put('/api/sources/:id', (req, res) => {
  const { errors, source } = updateSource(req.params.id, req.body || {});
  if (errors)
    return res
      .status(errors[0] === 'kilde ikke funnet' ? 404 : 400)
      .json({ errors });
  res.json(source);
});

app.delete('/api/sources/:id', (req, res) => {
  res.json(removeSource(req.params.id));
});

app.post('/api/sources/:id/test', async (req, res) => {
  res.json(await testSource(req.params.id));
});

app.get('/api/activities', async (req, res, next) => {
  try {
    const { type, from, to } = req.query;
    res.json(await store.list({ type, from, to }));
  } catch (err) {
    next(err);
  }
});

app.get('/api/stats', async (_req, res, next) => {
  try {
    res.json(await store.stats());
  } catch (err) {
    next(err);
  }
});

// Per-calendar-year aggregates for the statistics / year-comparison page.
app.get('/api/garmin/health', async (req, res, next) => {
  try {
    res.json({ days: await store.listHealth({ source: req.query.source, from: req.query.from, to: req.query.to }) });
  } catch (err) { next(err); }
});

app.get('/api/stats/by-year', async (_req, res, next) => {
  try {
    const rows = await store.list({ metrics: true });
    const years = new Map();
    for (const a of rows) {
      const d = a.start ? new Date(a.start) : null;
      if (!d || Number.isNaN(d.getTime())) continue;
      const y = d.getFullYear();
      if (!years.has(y)) years.set(y, []);
      years.get(y).push(a);
    }
    const list = [...years.entries()].map(([year, activities]) => ({ year, ...computeStats(activities) }))
      .sort((x, y) => y.year - x.year);
    res.json({ years: list });
  } catch (err) {
    next(err);
  }
});

// Simplified polylines for every activity — used to draw all routes on the map.
// Fetches all tracks in a single query (no N+1) and downsamples each.
app.get('/api/routes', async (req, res, next) => {
  try {
    const { type, from, to } = req.query;
    const rows = await store.listTracks({ type, from, to });
    const out = [];
    for (const r of rows) {
      const points = simplifyTrack(r.track);
      if (points.length >= 2) {
        out.push({ id: r.id, type: r.type, name: r.name, start: r.start, points });
      }
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
});

app.get('/api/activities/:id', async (req, res, next) => {
  try {
    const a = await store.get(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
    res.json(a);
  } catch (err) {
    next(err);
  }
});

// Set or clear a user-defined name for an activity. Empty/blank resets to the
// parser-derived name. The override survives re-ingest.
app.patch('/api/activities/:id', async (req, res, next) => {
  try {
    const a = await store.get(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
    const raw =
      typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    a.customName = raw || null;
    a.name = a.customName || a.autoName || a.name;
    await store.upsert(a);
    res.json(a);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/activities/:id', async (req, res, next) => {
  try {
    res.json({ removed: await store.remove(req.params.id) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/ingest/status', (_req, res) => res.json(ingestStatus()));

app.post('/api/ingest', async (req, res) => {
  const { force, sourceId } = req.body || {};
  try {
    const result = await runIngest({ force: !!force, sourceId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(config.paths.public));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('API-feil:', err);
  res.status(500).json({ error: err.message });
});

const { port, host } = config.server;

async function main() {
  await store.ready(); // open DB + run one-time JSON migration before serving

  app.listen(port, host, async () => {
    console.log(`trenern kjører på http://${host}:${port}`);
    startScheduler();
    if (config.ingest?.autoOnStart) {
      console.log('kjører oppstarts-ingest ...');
      try {
        const r = await runIngest();
        console.log(
          `ingest ferdig: ${r.created} nye, ${r.updated} oppdatert, ${r.errors.length} feil`
        );
      } catch (e) {
        console.error('oppstarts-ingest feilet:', e.message);
      }
    }
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    try {
      await store.close();
    } finally {
      process.exit(0);
    }
  });
}

main().catch((err) => {
  console.error('oppstart feilet:', err);
  process.exit(1);
});
