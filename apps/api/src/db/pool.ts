import pg from 'pg';
import { env } from '../config.js';
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 15, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined });
export const platformPool = new pg.Pool({ connectionString: env.PLATFORM_DATABASE_URL, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined });
export type DbClient = pg.PoolClient;

export async function tenantTransaction<T>(schoolId: string, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.school_id', $1, true)", [schoolId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
