import pg from 'pg';
import { env } from '../config.js';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined
});

export const platformPool = new pg.Pool({
  connectionString: env.PLATFORM_DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined
});

pool.on('error', (err) => {
  console.warn('[DB Pool] Non-fatal client error:', err.message);
});

platformPool.on('error', (err) => {
  console.warn('[DB PlatformPool] Non-fatal client error:', err.message);
});

export type DbClient = pg.PoolClient;

export async function tenantTransaction<T>(schoolId: string, fn: (client: DbClient) => Promise<T>): Promise<T> {
  let client: DbClient;
  try {
    client = await pool.connect();
  } catch (err) {
    // Retry once if an idle connection timed out
    client = await pool.connect();
  }
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.school_id', $1, true)", [schoolId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    try { client.release(); } catch {}
  }
}
