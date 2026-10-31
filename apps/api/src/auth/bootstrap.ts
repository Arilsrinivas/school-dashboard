import argon2 from 'argon2';
import { env } from '../config.js';
import { platformPool } from '../db/pool.js';

if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD in .env before bootstrapping');
try {
  const passwordHash = await argon2.hash(env.BOOTSTRAP_ADMIN_PASSWORD, { type: argon2.argon2id });
  const role = await platformPool.query("SELECT id FROM platform_roles WHERE name='super_admin'");
  if (!role.rows[0]) throw new Error('Run database migrations first');
  const existing = await platformPool.query('SELECT id FROM platform_users WHERE email=$1', [env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase()]);
  if (existing.rows[0]) {
    await platformPool.query('UPDATE platform_users SET name=$2,password_hash=$3,is_active=true WHERE id=$1', [existing.rows[0].id, env.BOOTSTRAP_ADMIN_NAME, passwordHash]);
    console.info('Updated configured platform administrator credentials.');
  } else {
    await platformPool.query('INSERT INTO platform_users(email,name,password_hash,role_id) VALUES($1,$2,$3,$4)', [env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), env.BOOTSTRAP_ADMIN_NAME, passwordHash, role.rows[0].id]);
    console.info('Created platform administrator.');
  }
} finally { await platformPool.end(); }
