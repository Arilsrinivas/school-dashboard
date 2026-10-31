import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import argon2 from 'argon2';

async function main() {
  const dbPath = resolve(process.cwd(), '.pgdata');
  const db = new PGlite(dbPath);
  const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 5432, maxConnections: 32 });

  await socket.start();
  console.log('PGlite PostgreSQL server listening on 127.0.0.1:5432 (persisted to .pgdata)');

  // Run migrations idempotently
  const migrationDir = resolve(process.cwd(), 'apps/api/migrations');
  const migrationNames = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
  for (const name of migrationNames) {
    let sql = await readFile(resolve(migrationDir, name), 'utf8');
    sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/g, '');
    try {
      await db.exec(sql);
      console.log(`[Database] Migration applied: ${name}`);
    } catch (err: any) {
      if (!err.message?.includes('already exists') && !err.message?.includes('duplicate key')) {
        console.warn(`[Database] Migration ${name}:`, err.message);
      }
    }
  }

  // Ensure database roles exist
  for (const roleSql of [
    'CREATE ROLE educonnect_app LOGIN NOBYPASSRLS;',
    'CREATE ROLE educonnect_platform LOGIN BYPASSRLS;',
    'CREATE ROLE educonnect LOGIN;'
  ]) {
    try { await db.exec(roleSql); } catch {}
  }

  try {
    await db.exec(`
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO educonnect_app, educonnect_platform, educonnect;
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO educonnect_app, educonnect_platform, educonnect;
    `);
  } catch {}

  // Seed Platform Super Admin if not present
  try {
    const superRole = await db.query("SELECT id FROM platform_roles WHERE name='super_admin'");
    if (superRole.rows.length > 0) {
      const roleId = (superRole.rows[0] as any).id;
      const existing = await db.query("SELECT id FROM platform_users WHERE email='admin@calmstacks.example'");
      if (existing.rows.length === 0) {
        const hash = await argon2.hash('SuperAdmin#2026', { type: argon2.argon2id });
        await db.query(
          "INSERT INTO platform_users (email, name, password_hash, role_id) VALUES ('admin@calmstacks.example', 'CalmStacks Platform Admin', $1, $2)",
          [hash, roleId]
        );
        console.log('[Database] Seeded Platform Admin: admin@calmstacks.example (Password: SuperAdmin#2026)');
      } else {
        console.log('[Database] Platform Admin exists: admin@calmstacks.example (Password: SuperAdmin#2026)');
      }
    }
  } catch (e: any) {
    console.warn('[Database] Platform admin seed note:', e.message);
  }

  console.log('[Database] Ready for connections from EduConnect API on port 5432.');
}

main().catch(console.error);
