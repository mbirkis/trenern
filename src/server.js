import express from 'express';
import config from './config.js';
import * as store from './store.js';
import { buildSources } from './sources/index.js';
import { listParsers } from './parsers/index.js';
import { runIngest, ingestStatus, startScheduler } from './ingest.js';
import { hrZoneBounds } from './model.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) => {
  res.json({
    athlete: config.athlete,
    hrZones: hrZoneBounds(),
    parsers: listParsers(),
    ingest: config.ingest,
  });
});

app.get('/api/sources', (_req, res) => {
  const sources = buildSources({ includeDisabled: true }).map((s) => ({
    id: s.id,
    type: s.type,
    enabled: s.enabled,
    describe: s.describe?.() || s.type,
  }));
  res.json(sources);
});

app.get('/api/activities', (req, res) => {
  const { type, from, to } = req.query;
  res.json(store.list({ type, from, to }));
});

app.get('/api/stats', (_req, res) => res.json(store.stats()));

app.get('/api/activities/:id', (req, res) => {
  const a = store.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json(a);
});

app.delete('/api/activities/:id', (req, res) => {
  res.json({ removed: store.remove(req.params.id) });
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

const { port, host } = config.server;
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
