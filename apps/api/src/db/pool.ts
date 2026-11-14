import pg from 'pg';
import { env } from '../config.js';

function cleanConnectionString(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url.replace(/([?&])sslmode=[^&]+(&|$)/, '$1').replace(/[?&]$/, '');
  }
}

function getSslConfig(url: string) {
  if (url.includes('127.0.0.1') || url.includes('localhost') || url.includes('sslmode=disable')) {
    return undefined;
  }
  return { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: cleanConnectionString(env.DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000,
  ssl: getSslConfig(env.DATABASE_URL)
});

export const platformPool = new pg.Pool({
  connectionString: cleanConnectionString(env.PLATFORM_DATABASE_URL),
  max: 5,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000,
  ssl: getSslConfig(env.PLATFORM_DATABASE_URL)
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
