import config from '../config.js';

/**
 * Pick and construct the storage backend.
 *   - DATABASE_URL env set            -> postgres
 *   - storage.backend in config.json  -> "sqlite" (default) | "postgres"
 */
export async function createDb() {
  let backend = (config.storage?.backend || 'sqlite').toLowerCase();
  if (process.env.DATABASE_URL) backend = 'postgres';
  if (process.env.TRENERN_DB_BACKEND) backend = process.env.TRENERN_DB_BACKEND.toLowerCase();

  if (backend === 'postgres') {
    const { createPostgres } = await import('./postgres.js');
    return createPostgres();
  }
  if (backend === 'sqlite') {
    const { createSqlite } = await import('./sqlite.js');
    return createSqlite();
  }
  throw new Error(`ukjent storage.backend "${backend}"`);
}
