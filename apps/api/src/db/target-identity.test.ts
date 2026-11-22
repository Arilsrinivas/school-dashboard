import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertEduConnectDatabaseTarget} from './target-identity.js';

const ref='jnhcomdjezlvmxpjkoot';
test('database target guard accepts only matching project and database URLs',()=>{
  const admin=`postgresql://postgres.${ref}:not-a-real-secret@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;
  const runtime=`postgresql://educonnect_app.${ref}:also-not-a-real-secret@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres`;
  assert.doesNotThrow(()=>assertEduConnectDatabaseTarget(runtime,admin,ref));
  assert.throws(()=>assertEduConnectDatabaseTarget(runtime,'postgresql://postgres:unused@127.0.0.1:5432/postgres',ref),/identity guard failed/);
  assert.throws(()=>assertEduConnectDatabaseTarget(runtime,admin,'aaaaaaaaaaaaaaaaaaaa'),/identity guard failed/);
  assert.throws(()=>assertEduConnectDatabaseTarget(runtime,admin,ref,'educonnect'),/identity guard failed/);
});
