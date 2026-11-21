import pg from 'pg';
import { readFileSync } from 'node:fs';
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
  const local=url.includes('127.0.0.1')||url.includes('localhost');
  if(local&&url.includes('sslmode=disable')){
    return undefined;
  }
  if(!local&&url.includes('sslmode=disable'))throw new Error('Remote PostgreSQL connections cannot disable TLS');
  return { rejectUnauthorized: true,...(env.DATABASE_SSL_CA_CERT_PATH?{ca:readFileSync(env.DATABASE_SSL_CA_CERT_PATH,'utf8')}: {}) };
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

export async function verifyRuntimeDatabaseRoles(): Promise<void> {
  const check = async (runtimePool: pg.Pool, expectedRole: string) => {
    const { rows } = await runtimePool.query<{ role_name:string; privileged:boolean }>(`
      WITH RECURSIVE role_tree(role_oid, privileged) AS (
        SELECT oid, rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user
        UNION
        SELECT granted.oid, granted.rolsuper OR granted.rolbypassrls
          FROM pg_auth_members membership
          JOIN role_tree member_role ON member_role.role_oid=membership.member
          JOIN pg_roles granted ON granted.oid=membership.roleid
      )
      SELECT current_user AS role_name,COALESCE(bool_or(privileged),true) AS privileged
        FROM role_tree
    `);
    const role = rows[0];
    if (!role || role.role_name !== expectedRole || role.privileged) {
      throw new Error(`Database runtime role must be ${expectedRole} and must not be superuser, inherit a privileged role, or bypass RLS`);
    }
  };
  await Promise.all([
    check(pool, 'educonnect_app'),
    check(platformPool, 'educonnect_platform')
  ]);
}

pool.on('error', (err) => {
  console.warn('[DB Pool] Non-fatal client error:', err.message);
});

platformPool.on('error', (err) => {
  console.warn('[DB PlatformPool] Non-fatal client error:', err.message);
});

export type DbClient = pg.PoolClient;

export async function tenantTransaction<T>(schoolId: string, fn: (client: DbClient) => Promise<T>): Promise<T> {
  return tenantTransactionUsing(pool, schoolId, fn);
}

export async function tenantTransactionUsing<T>(dbPool: pg.Pool, schoolId: string, fn: (client: DbClient) => Promise<T>): Promise<T> {
  let client: DbClient;
  try {
    client = await dbPool.connect();
  } catch (err) {
    // Retry once if an idle connection timed out
    client = await dbPool.connect();
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
