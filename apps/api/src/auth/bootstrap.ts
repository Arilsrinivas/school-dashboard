import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { initializeFirebaseAdmin } from './firebase-admin.js';
import { env } from '../config.js';
import { platformPool } from '../db/pool.js';
import { assertEduConnectDatabaseTarget } from '../db/target-identity.js';

if(env.AUTH_PROVIDER!=='firebase')throw new Error('One-time administrator bootstrap requires AUTH_PROVIDER=firebase');
if(!env.BOOTSTRAP_ADMIN_EMAIL||!env.BOOTSTRAP_ADMIN_FIREBASE_UID)throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_FIREBASE_UID securely before bootstrap');
const ref=process.env.EDUCONNECT_DATABASE_PROJECT_REF?.trim();
if(!ref)throw new Error('Set EDUCONNECT_DATABASE_PROJECT_REF to the verified EduConnect project reference');
assertEduConnectDatabaseTarget(env.PLATFORM_DATABASE_URL,env.PLATFORM_DATABASE_URL,ref);

const firebaseUser=await initializeFirebaseAdmin().getUser(env.BOOTSTRAP_ADMIN_FIREBASE_UID);
if(!firebaseUser.emailVerified||!firebaseUser.email||firebaseUser.email.toLowerCase()!==env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase())throw new Error('Bootstrap Firebase UID must be an email-verified account matching BOOTSTRAP_ADMIN_EMAIL');

const client=await platformPool.connect();
try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('educonnect:first-platform-admin'))");
  const existing=await client.query('SELECT count(*)::int AS count FROM platform_users');
  if(existing.rows[0].count!==0)throw new Error('One-time bootstrap requires an empty platform_users table');
  const role=await client.query("SELECT id FROM platform_roles WHERE name='super_admin'");
  if(!role.rows[0])throw new Error('Consolidated schema is not initialized');
  const passwordHash=await argon2.hash(randomBytes(48).toString('base64url'),{type:argon2.argon2id});
  const created=await client.query('INSERT INTO platform_users(email,name,password_hash,role_id) VALUES($1,$2,$3,$4) RETURNING id',[env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),env.BOOTSTRAP_ADMIN_NAME,passwordHash,role.rows[0].id]);
  await client.query("INSERT INTO external_identities(user_kind,user_id,provider,provider_subject_id,email) VALUES('platform',$1,'firebase',$2,lower($3))",[created.rows[0].id,firebaseUser.uid,firebaseUser.email]);
  await client.query("INSERT INTO platform_audit_logs(actor_id,action,target_type,target_id,metadata) VALUES($1,'platform.admin_bootstrapped','platform_user',$1,'{}')",[created.rows[0].id]);
  await client.query('COMMIT');
  console.info('Created the first CalmStacks Super Admin with a verified Firebase identity.');
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await platformPool.end();}
