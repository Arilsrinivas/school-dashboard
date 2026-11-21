import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('consolidated EduConnect schema initializes an empty PostgreSQL-compatible database with tenant RLS',async()=>{
  const db=await PGlite.create();
  try{
    let sql=await readFile(new URL('../../schema/educonnect.initial.sql',import.meta.url),'utf8');
    sql=sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/,'');
    await db.exec(sql);
    const {rows}=await db.query<{count:number}>('SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=\'public\' AND c.relkind IN (\'r\',\'p\')');
    assert.ok(rows[0]!.count>=60);
    const missing=await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='school_id' AND NOT a.attisdropped WHERE n.nspname='public' AND c.relkind='r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    assert.deepEqual(missing.rows,[],'all school_id tables enforce and force RLS');
    const unscoped=await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='school_id' AND NOT a.attisdropped WHERE n.nspname='public' AND c.relkind='r' AND NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname<>'platform_runtime_access')`);
    assert.deepEqual(unscoped.rows,[],'every school_id table has a tenant policy');
  }finally{await db.close();}
});
