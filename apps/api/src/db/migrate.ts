import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pool, platformPool } from './pool.js';
import { env } from '../config.js';

const migrationPool=env.MIGRATION_DATABASE_URL?new pg.Pool({connectionString:env.MIGRATION_DATABASE_URL,max:2}):pool;
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
      console.info(`Applied migration ${name}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally { client.release(); await migrationPool.end(); if(migrationPool!==pool)await pool.end(); await platformPool.end(); }
