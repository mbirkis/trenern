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

app.get('/api/activities/:id', async (req, res, next) => {
  try {
    const a = await store.get(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
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
