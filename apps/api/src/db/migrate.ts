import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { env } from '../config.js';
import { MIGRATION_SCRIPTS } from './migrationsData.js';

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
      return { rejectUnauthorized: false };
    }

    const connStr = env.MIGRATION_DATABASE_URL || env.PLATFORM_DATABASE_URL || env.DATABASE_URL;
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
        await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
        for (const { name, sql } of MIGRATION_SCRIPTS) {
          const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
          if (exists.rowCount) continue;
          await client.query('BEGIN');
          try {
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
            await client.query('COMMIT');
            console.info(`[Database Migration] Applied ${name}`);
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
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
