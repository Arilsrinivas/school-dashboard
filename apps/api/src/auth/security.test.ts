import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://educonnect_app:unused@127.0.0.1:5432/educonnect';
process.env.PLATFORM_DATABASE_URL ||= 'postgresql://educonnect_platform:unused@127.0.0.1:5432/educonnect';
process.env.ACCESS_TOKEN_SECRET ||= 'local-test-access-secret-that-is-long-enough';
process.env.REFRESH_TOKEN_SECRET ||= 'different-local-test-refresh-secret-long-enough';
const { hashRefresh, newRefreshSecret, readAccess, signAccess } = await import('./tokens.js');

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
