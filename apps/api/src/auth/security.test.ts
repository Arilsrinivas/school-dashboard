import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

process.env.DATABASE_URL ||= 'postgresql://educonnect_app:unused@127.0.0.1:5432/educonnect';
process.env.PLATFORM_DATABASE_URL ||= 'postgresql://educonnect_platform:unused@127.0.0.1:5432/educonnect';
process.env.ACCESS_TOKEN_SECRET ||= 'local-test-access-secret-that-is-long-enough';
process.env.REFRESH_TOKEN_SECRET ||= 'different-local-test-refresh-secret-long-enough';
const { hashRefresh, newRefreshSecret, readAccess, signAccess } = await import('./tokens.js');
const { validateProductionEnvironment } = await import('../config.js');
const { parseFirebaseServiceAccountJson } = await import('./firebase-service-account.js');

test('refresh secrets are opaque and hashed with a separate server secret',()=>{
  const secret=newRefreshSecret();
  assert.ok(secret.length>=40);
  assert.notEqual(secret,hashRefresh(secret));
  assert.equal(hashRefresh(secret),hashRefresh(secret));
});

test('access tokens retain the server-selected tenant and role',async()=>{
  const token=await signAccess({kind:'school',id:'e93c26f2-20c9-4a09-82b0-c8a1cc0c8e3a',role:'teacher',schoolId:'17cbb013-5b5a-40e1-b282-d8ab462d8a83'});
  assert.deepEqual(await readAccess(token),{kind:'school',id:'e93c26f2-20c9-4a09-82b0-c8a1cc0c8e3a',role:'teacher',schoolId:'17cbb013-5b5a-40e1-b282-d8ab462d8a83'});
});

test('invalid access tokens are rejected',async()=>{
  await assert.rejects(()=>readAccess('not-a-token'));
});

test('Firebase Admin service account JSON is validated without exposing credential values',()=>{
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const json = JSON.stringify({ type:'service_account', project_id:'educonnect-44f2b', client_email:'firebase-admin@educonnect-44f2b.iam.gserviceaccount.com', private_key:privateKey });
  assert.deepEqual(parseFirebaseServiceAccountJson(json), { projectId:'educonnect-44f2b', clientEmail:'firebase-admin@educonnect-44f2b.iam.gserviceaccount.com', privateKey });
  assert.throws(()=>parseFirebaseServiceAccountJson('{bad json'), /not valid JSON/);
  assert.throws(()=>parseFirebaseServiceAccountJson(json, 'another-project'), /does not match/);
  assert.throws(()=>parseFirebaseServiceAccountJson(JSON.stringify({ type:'service_account', project_id:'educonnect-44f2b', client_email:'firebase-admin@educonnect-44f2b.iam.gserviceaccount.com', private_key:'-----BEGIN PRIVATE KEY-----bad-----END PRIVATE KEY-----' })), /invalid private key/);
});

test('production config refuses implicit database and signing secrets',()=>{
  assert.throws(()=>validateProductionEnvironment({
    NODE_ENV:'production',
    ACCESS_TOKEN_SECRET:'a'.repeat(40),
    REFRESH_TOKEN_SECRET:'b'.repeat(40)
  }),/DATABASE_URL must be configured/);
  assert.throws(()=>validateProductionEnvironment({
    NODE_ENV:'production',
    DATABASE_URL:'postgresql://app:secret@db.example.test/app'
  }),/ACCESS_TOKEN_SECRET must be explicitly configured/);
  assert.throws(()=>validateProductionEnvironment({
    NODE_ENV:'production',
    DATABASE_URL:'postgresql://app:secret@db.example.test/app',
    ACCESS_TOKEN_SECRET:'a'.repeat(40),
    REFRESH_TOKEN_SECRET:'b'.repeat(40)
  }),/FIREBASE_SERVICE_ACCOUNT_JSON must be configured/);
  assert.doesNotThrow(()=>validateProductionEnvironment({
    NODE_ENV:'production',
    DATABASE_URL:'postgresql://app:secret@db.example.test/app',
    ACCESS_TOKEN_SECRET:'a'.repeat(40),
    REFRESH_TOKEN_SECRET:'b'.repeat(40),
    FIREBASE_PROJECT_ID:'educonnect-44f2b',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:'educonnect-44f2b',client_email:'firebase-admin@educonnect-44f2b.iam.gserviceaccount.com',private_key:generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey})
  }));
});
