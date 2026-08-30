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

    async list({ type, from, to } = {}) {
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
        `SELECT ${summaryNames.join(', ')} FROM activities` +
        (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
        ' ORDER BY start_time DESC';
      const r = await pool.query(sql, params);
      return r.rows.map(rowToSummary);
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
      const r = await pool.query(
        'SELECT type, distance_m, moving_time_sec, elevation_gain_m FROM activities'
      );
      return computeStats(
        r.rows.map((row) => ({
          type: row.type,
          distanceM: Number(row.distance_m) || 0,
          movingTimeSec: Number(row.moving_time_sec) || 0,
          elevationGainM: Number(row.elevation_gain_m) || 0,
        }))
      );
    },

    async close() {
      await pool.end();
    },
  };
}
