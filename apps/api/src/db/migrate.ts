import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { pool } from './pool.js';
import { env } from '../config.js';

let migratedPromise: Promise<void> | null = null;

export async function runMigrations(): Promise<void> {
  if (migratedPromise) return migratedPromise;

  migratedPromise = (async () => {
    function getSsl(url: string) {
      if (url.includes('127.0.0.1') || url.includes('localhost') || url.includes('sslmode=disable')) {
        return undefined;
      }
      return { rejectUnauthorized: false };
    }

    const connStr = env.MIGRATION_DATABASE_URL || env.PLATFORM_DATABASE_URL || env.DATABASE_URL;
    const migrationPool = new pg.Pool({
      connectionString: connStr,
      max: 2,
      ssl: getSsl(connStr)
    });

    const client = await migrationPool.connect();
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
      const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
      for (const name of files) {
        const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
        if (exists.rowCount) continue;
        await client.query('BEGIN');
        try {
          await client.query(await readFile(join(dir, name), 'utf8'));
          await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
          await client.query('COMMIT');
          console.info(`[Database Migration] Applied ${name}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      client.release();
      await migrationPool.end();
    }
  })();

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
