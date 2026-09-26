import pg from 'pg';
import config from '../config.js';
import {
  COLUMNS,
  SUMMARY_COLUMNS,
  activityToRow,
  rowToSummary,
  rowToActivity,
  computeStats,
} from './shared.js';

const SQL_TYPE = {
  text: 'text',
  int: 'bigint',
  real: 'double precision',
  bool: 'boolean',
  json: 'jsonb',
};

export function createPostgres() {
  const connectionString =
    process.env.DATABASE_URL || config.storage?.postgres?.url || null;
  if (!connectionString) {
    throw new Error(
      'postgres-backend valgt, men ingen tilkoblingsstreng (DATABASE_URL eller storage.postgres.url)'
    );
  }
  const pool = new pg.Pool({ connectionString, max: 4 });

  const colNames = COLUMNS.map(([c]) => c);
  const summaryNames = SUMMARY_COLUMNS.map(([c]) => c);
  const colDefs = COLUMNS.map(
    ([col, , kind]) => `${col} ${SQL_TYPE[kind]}${col === 'id' ? ' PRIMARY KEY' : ''}`
  ).join(', ');

  const placeholders = colNames.map((_, i) => `$${i + 1}`).join(', ');
  const updates = colNames
    .filter((c) => c !== 'id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');
  const insertSql = `INSERT INTO activities (${colNames.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (id) DO UPDATE SET ${updates}
    RETURNING (xmax = 0) AS inserted`;

  function rowValues(activity) {
    const row = activityToRow(activity);
    // shared.activityToRow JSON.stringifies json columns; jsonb params take that fine.
    return colNames.map((c) => row[c]);
  }

  return {
    backend: 'postgres',
    describe: () => `postgres ${connectionString.replace(/:[^:@/]*@/, ':***@')}`,

    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS activities (${colDefs})`);
      await pool.query(`CREATE TABLE IF NOT EXISTS garmin_health (
        source text NOT NULL, date text NOT NULL, data jsonb NOT NULL,
        PRIMARY KEY (source, date)
      )`);
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_activities_start ON activities(start_time DESC)'
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type)'
      );
    },

    async has(id) {
      const r = await pool.query('SELECT 1 FROM activities WHERE id = $1', [id]);
      return r.rowCount > 0;
    },

    async get(id) {
      const r = await pool.query('SELECT data FROM activities WHERE id = $1', [id]);
      return r.rowCount ? rowToActivity(r.rows[0].data) : null;
    },

    async list({ type, from, to, full = false, metrics = false } = {}) {
      const where = [];
      const params = [];
      if (type) {
        params.push(type);
        where.push(`type = $${params.length}`);
      }
      if (from) {
        params.push(from);
        where.push(`start_time >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        where.push(`start_time <= $${params.length}`);
      }
      const sql =
        `SELECT ${full ? 'data' : summaryNames.join(', ') + (metrics ? " , data->'metrics' AS stats_metrics" : '')} FROM activities` +
        (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
        ' ORDER BY start_time DESC';
      const r = await pool.query(sql, params);
      return r.rows.map(row => full ? rowToActivity(row.data) : { ...rowToSummary(row), ...(metrics ? {metrics: rowToActivity(row.stats_metrics) || {}} : {}) });
    },

    async listTracks({ type, from, to } = {}) {
      const where = ['has_track = true'];
      const params = [];
      if (type) {
        params.push(type);
        where.push(`type = $${params.length}`);
      }
      if (from) {
        params.push(from);
        where.push(`start_time >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        where.push(`start_time <= $${params.length}`);
      }
      const sql =
        `SELECT id, type, name, start_time, data FROM activities` +
        ` WHERE ${where.join(' AND ')} ORDER BY start_time DESC`;
      const r = await pool.query(sql, params);
      return r.rows.map((row) => ({
        id: row.id,
        type: row.type,
        name: row.name,
        start: row.start_time,
        track: (rowToActivity(row.data) || {}).track || [],
      }));
    },

    async upsert(activity) {
      const r = await pool.query(insertSql, rowValues(activity));
      return r.rows[0]?.inserted ? 'created' : 'updated';
    },

    async remove(id) {
      const r = await pool.query('DELETE FROM activities WHERE id = $1', [id]);
      return r.rowCount > 0;
    },

    async stats() {
      return computeStats(await this.list({ metrics: true }));
    },

    async upsertHealth(record) {
      await pool.query(`INSERT INTO garmin_health (source, date, data) VALUES ($1, $2, $3)
        ON CONFLICT(source, date) DO UPDATE SET data = EXCLUDED.data`,
        [record.source, record.date, JSON.stringify(record)]);
    },

    async listHealth({ source, from, to } = {}) {
      const where = [], params = [];
      for (const [key, value] of Object.entries({ source, from, to })) {
        if (value) { params.push(value); where.push(`${key === 'source' ? 'source =' : key === 'from' ? 'date >=' : 'date <='} $${params.length}`); }
      }
      const r = await pool.query('SELECT data FROM garmin_health' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY date DESC, source', params);
      return r.rows.map(row => rowToActivity(row.data));
    },

    async close() {
      await pool.end();
    },
  };
}
