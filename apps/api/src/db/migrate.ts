import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { env } from '../config.js';

let migratedPromise: Promise<void> | null = null;

export async function runMigrations(): Promise<void> {
  if (migratedPromise) return migratedPromise;

  migratedPromise = (async () => {
    function cleanConnectionString(url: string): string {
      try {
        const u = new URL(url);
        u.searchParams.delete('sslmode');
        return u.toString();
      } catch {
        return url.replace(/([?&])sslmode=[^&]+(&|$)/, '$1').replace(/[?&]$/, '');
      }
    }

    function getSsl(url: string) {
      if (url.includes('127.0.0.1') || url.includes('localhost') || url.includes('sslmode=disable')) {
        return undefined;
      }
      return { rejectUnauthorized: true };
    }

    const connStr = env.MIGRATION_DATABASE_URL || env.PLATFORM_DATABASE_URL || env.DATABASE_URL;
    const appUrl = new URL(env.DATABASE_URL);
    const migrationUrl = new URL(connStr);
    const expectedProjectRef = process.env.EDUCONNECT_DATABASE_PROJECT_REF?.trim();
    if (!expectedProjectRef || !/^[a-z0-9]{20}$/.test(expectedProjectRef)) {
      throw new Error('Set EDUCONNECT_DATABASE_PROJECT_REF to the verified EduConnect Supabase project reference before schema initialization');
    }
    const identifiesProject = (url: URL) => url.hostname.includes(expectedProjectRef) || decodeURIComponent(url.username).includes(expectedProjectRef);
    if (!identifiesProject(appUrl) || !identifiesProject(migrationUrl) || appUrl.pathname !== migrationUrl.pathname) {
      throw new Error('Database identity guard failed: app and migration URLs must both identify the configured EduConnect project and database');
    }
    const migrationPool = new pg.Pool({
      connectionString: cleanConnectionString(connStr),
      max: 2,
      ssl: getSsl(connStr)
    });

    const client = await migrationPool.connect();
    try {
      // Advisory lock (lock key 8492048) prevents concurrent migration runs across multiple deployment workers
      await client.query('SELECT pg_advisory_lock(8492048)');
      try {
        const identity = await client.query<{database:string;host:string;project:string|null;relation_count:number;has_history:boolean}>({
          text: `SELECT current_database() AS database,inet_server_addr()::text AS host,
            current_setting('supabase.project_ref',true) AS project,
            (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) AS relation_count,
            to_regclass('public.schema_migrations') IS NOT NULL AS has_history`
        });
        const actual = identity.rows[0]!;
        if (actual.database !== 'postgres' || (actual.project && actual.project !== expectedProjectRef)) throw new Error('Connected PostgreSQL identity does not match the designated EduConnect database');
        if (actual.relation_count !== 0 || actual.has_history) throw new Error('Refusing fresh initialization: public schema is not empty');
        const sql = await readFile(new URL('../../schema/educonnect.initial.sql', import.meta.url), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations(name) VALUES('educonnect.initial.sql')");
          await client.query('COMMIT');
          console.info('Applied consolidated EduConnect fresh-install schema.');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock(8492048)');
      }
    } finally {
      client.release();
      await migrationPool.end();
    }
  })().catch((err) => {
    migratedPromise = null;
    throw err;
  });

  return migratedPromise;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations().then(() => {
    console.info('[Database Migration] All migrations complete.');
    process.exit(0);
  }).catch((err) => {
    console.error('[Database Migration] Failed:', err);
    process.exit(1);
  });
}
