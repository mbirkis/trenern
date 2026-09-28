import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import config, { resolvePath } from '../config.js';
import {
  COLUMNS,
  SUMMARY_COLUMNS,
  activityToRow,
  rowToSummary,
  rowToActivity,
  computeStats,
} from './shared.js';

const SQL_TYPE = { text: 'TEXT', int: 'INTEGER', real: 'REAL', bool: 'INTEGER', json: 'TEXT' };

export function createSqlite() {
  const file = resolvePath(
    process.env.TRENERN_SQLITE_FILE ||
      config.storage?.sqlite?.file ||
      './data/trenern.db'
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const colDefs = COLUMNS.map(
    ([col, , kind]) => `  ${col} ${SQL_TYPE[kind]}${col === 'id' ? ' PRIMARY KEY' : ''}`
  ).join(',\n');
  const colNames = COLUMNS.map(([c]) => c);
  const summaryNames = SUMMARY_COLUMNS.map(([c]) => c);

  const insertSql = `INSERT INTO activities (${colNames.join(', ')})
    VALUES (${colNames.map((c) => '@' + c).join(', ')})
    ON CONFLICT(id) DO UPDATE SET ${colNames
      .filter((c) => c !== 'id')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ')}`;

  return {
    backend: 'sqlite',
    describe: () => `sqlite ${file}`,

    async init() {
      db.exec(`CREATE TABLE IF NOT EXISTS activities (\n${colDefs}\n);`);
      if (!db.prepare('PRAGMA table_info(activities)').all().some((c) => c.name === 'place_tags')) {
        db.exec('ALTER TABLE activities ADD COLUMN place_tags TEXT');
      }
      db.exec(`CREATE TABLE IF NOT EXISTS garmin_health (
        source TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (source, date)
      );`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_activities_start ON activities(start_time DESC);
         CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);`
      );
    },

    async has(id) {
      return !!db.prepare('SELECT 1 FROM activities WHERE id = ?').get(id);
    },

    async get(id) {
      const r = db.prepare('SELECT data FROM activities WHERE id = ?').get(id);
      return r ? rowToActivity(r.data) : null;
    },

    async list({ type, from, to, full = false, metrics = false } = {}) {
      const where = [];
      const params = {};
      if (type) {
        where.push('type = @type');
        params.type = type;
      }
      if (from) {
        where.push('start_time >= @from');
        params.from = from;
      }
      if (to) {
        where.push('start_time <= @to');
        params.to = to;
      }
      const sql =
        `SELECT ${full ? 'data' : summaryNames.join(', ') + (metrics ? " , json_extract(data, '$.metrics') AS stats_metrics" : '')} FROM activities` +
        (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
        ' ORDER BY start_time DESC';
      return db.prepare(sql).all(params).map(r => full ? rowToActivity(r.data) : { ...rowToSummary(r), ...(metrics ? {metrics: rowToActivity(r.stats_metrics) || {}} : {}) });
    },

    async listTracks({ type, from, to } = {}) {
      const where = ['has_track = 1'];
      const params = {};
      if (type) {
        where.push('type = @type');
        params.type = type;
      }
      if (from) {
        where.push('start_time >= @from');
        params.from = from;
      }
      if (to) {
        where.push('start_time <= @to');
        params.to = to;
      }
      const sql =
        `SELECT id, type, name, start_time, data FROM activities` +
        ` WHERE ${where.join(' AND ')} ORDER BY start_time DESC`;
      return db.prepare(sql).all(params).map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        start: r.start_time,
        track: (rowToActivity(r.data) || {}).track || [],
      }));
    },

    async upsert(activity) {
      const existed = await this.has(activity.id);
      db.prepare(insertSql).run(activityToRow(activity));
      return existed ? 'updated' : 'created';
    },

    async remove(id) {
      return db.prepare('DELETE FROM activities WHERE id = ?').run(id).changes > 0;
    },

    async stats() {
      return computeStats(await this.list({ metrics: true }));
    },

    async upsertHealth(record) {
      db.prepare(`INSERT INTO garmin_health (source, date, data) VALUES (?, ?, ?)
        ON CONFLICT(source, date) DO UPDATE SET data = excluded.data`)
        .run(record.source, record.date, JSON.stringify(record));
    },

    async listHealth({ source, from, to } = {}) {
      const where = [], params = {};
      for (const [key, value] of Object.entries({ source, from, to })) {
        if (value) { where.push(`${key === 'source' ? 'source =' : key === 'from' ? 'date >=' : 'date <='} @${key}`); params[key] = value; }
      }
      return db.prepare('SELECT data FROM garmin_health' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY date DESC, source')
        .all(params).map(r => rowToActivity(r.data));
    },

    async close() {
      db.close();
    },
  };
}
