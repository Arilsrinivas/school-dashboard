import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { env } from '../config.js';
import { pool, platformPool, tenantTransactionUsing, verifyRuntimeDatabaseRoles } from './pool.js';

/**
 * Exercises the configured EduConnect PostgreSQL target with temporary rows
 * inside one rolled-back transaction. It never persists fixture data.
 */
async function main(): Promise<void> {
  const expectedRef = process.env.EDUCONNECT_DATABASE_PROJECT_REF?.trim();
  assert.equal(expectedRef, 'jnhcomdjezlvmxpjkoot', 'expected EduConnect Supabase project is configured');
  const adminUrl = new URL(env.MIGRATION_DATABASE_URL || '');
  assert.ok(adminUrl.username.includes(expectedRef), 'migration URL identifies the expected project');
  assert.equal(adminUrl.pathname, '/postgres', 'migration URL targets the expected database');
  assert.equal(adminUrl.port, '5432', 'migration URL uses the session pooler');
  const caPath = env.DATABASE_SSL_CA_CERT_PATH;
  assert.ok(caPath, 'TLS root CA path is configured');
  const ca = readFileSync(caPath, 'utf8');
  const admin = new pg.Client({
    connectionString: adminUrl.toString(),
    ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000
  });

  try {
    await admin.connect();
    const identity = await admin.query<{ database_name: string; role_name: string; version: string }>(
      'SELECT current_database() AS database_name,current_user AS role_name,current_setting(\'server_version\') AS version'
    );
    assert.equal(identity.rows[0]?.database_name, 'postgres');
    assert.equal(identity.rows[0]?.role_name, 'postgres');

    const roles = await admin.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolinherit: boolean; rolcanlogin: boolean }>(`
      SELECT rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit,rolcanlogin
        FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname
    `, [['educonnect_app', 'educonnect_platform']]);
    assert.equal(roles.rowCount, 2, 'both runtime roles exist');
    for (const role of roles.rows) {
      assert.equal(role.rolsuper, false, `${role.rolname} is not superuser`);
      assert.equal(role.rolbypassrls, false, `${role.rolname} cannot bypass RLS`);
      assert.equal(role.rolcreatedb, false, `${role.rolname} cannot create databases`);
      assert.equal(role.rolcreaterole, false, `${role.rolname} cannot create roles`);
      assert.equal(role.rolinherit, false, `${role.rolname} does not inherit memberships`);
      assert.equal(role.rolcanlogin, true, `${role.rolname} is an application login`);
    }
    await verifyRuntimeDatabaseRoles();

    const tables = await admin.query<{ total: number; tenant_tables: number; invalid_tenant_tables: number; unprotected_tables: number }>(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE has_school_id)::int AS tenant_tables,
             count(*) FILTER (WHERE has_school_id AND (NOT relrowsecurity OR NOT relforcerowsecurity OR tenant_policies=0))::int AS invalid_tenant_tables,
             count(*) FILTER (WHERE NOT relrowsecurity)::int AS unprotected_tables
        FROM (
          SELECT c.oid,c.relrowsecurity,c.relforcerowsecurity,
                 EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='school_id' AND NOT a.attisdropped) AS has_school_id,
                 (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname<>'platform_runtime_access') AS tenant_policies
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind IN ('r','p')
        ) inventory
    `);
    assert.ok((tables.rows[0]?.total ?? 0) > 0, 'application tables exist');
    assert.ok((tables.rows[0]?.tenant_tables ?? 0) > 0, 'tenant tables exist');
    assert.equal(tables.rows[0]?.invalid_tenant_tables, 0, 'every school_id table has enabled and forced RLS with a tenant policy');
    assert.equal(tables.rows[0]?.unprotected_tables, 0, 'every public application table has RLS enabled');
    const apiRoleAccess = await admin.query<{ role_name: string; select_allowed: boolean; insert_allowed: boolean; update_allowed: boolean; delete_allowed: boolean }>(`
      SELECT role_name,
             has_table_privilege(role_name,'public.schools','SELECT') AS select_allowed,
             has_table_privilege(role_name,'public.schools','INSERT') AS insert_allowed,
             has_table_privilege(role_name,'public.schools','UPDATE') AS update_allowed,
             has_table_privilege(role_name,'public.schools','DELETE') AS delete_allowed
        FROM unnest(ARRAY['anon','authenticated','service_role']) role_name
    `);
    for (const role of apiRoleAccess.rows) {
      assert.equal(role.select_allowed || role.insert_allowed || role.update_allowed || role.delete_allowed, false, `${role.role_name} has no direct table access`);
    }
    const defaultApiPrivileges = await admin.query<{ unsafe_defaults: number }>(`
      SELECT count(*)::int AS unsafe_defaults
        FROM pg_default_acl d
        CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
       WHERE d.defaclnamespace='public'::regnamespace
         AND d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='postgres')
         AND d.defaclobjtype IN ('r','S')
         AND acl.grantee IN (SELECT oid FROM pg_roles WHERE rolname=ANY(ARRAY['anon','authenticated','service_role']))
    `);
    assert.equal(defaultApiPrivileges.rows[0]?.unsafe_defaults, 0, 'Supabase API roles receive no default table or sequence privileges');

    const schoolA = randomUUID();
    const schoolB = randomUUID();
    const studentA = randomUUID();
    const studentB = randomUUID();
    await admin.query('BEGIN');
    try {
      // Temporary membership lets the provider-managed setup identity assume
      // the exact runtime roles. The grant itself is rolled back with the data.
      await admin.query('GRANT educonnect_app,educonnect_platform TO postgres');
      await admin.query('SET LOCAL ROLE educonnect_platform');
      await admin.query("INSERT INTO schools(id,name,contact_email,status) VALUES($1,'Tenant verification A',$2,'active'),($3,'Tenant verification B',$4,'active')", [schoolA, `${schoolA}@verify.invalid`, schoolB, `${schoolB}@verify.invalid`]);

      await admin.query('SET LOCAL ROLE educonnect_app');
      await admin.query("SELECT set_config('app.school_id',$1,true)", [schoolA]);
      await admin.query("INSERT INTO students(id,school_id,admission_number,first_name) VALUES($1,$2,$3,'Tenant A')", [studentA, schoolA, `A-${studentA}`]);

      await admin.query('SAVEPOINT tenant_b_insert');
      let foreignInsertDenied = false;
      try {
        await admin.query("INSERT INTO students(id,school_id,admission_number,first_name) VALUES($1,$2,$3,'Unauthorized')", [randomUUID(), schoolB, `DENIED-${randomUUID()}`]);
      } catch (error) {
        foreignInsertDenied = (error as { code?: string }).code === '42501';
        if (!foreignInsertDenied) throw error;
      }
      await admin.query('ROLLBACK TO SAVEPOINT tenant_b_insert');
      assert.equal(foreignInsertDenied, true, 'tenant A cannot insert a row for tenant B');

      await admin.query("SELECT set_config('app.school_id',$1,true)", [schoolB]);
      await admin.query("INSERT INTO students(id,school_id,admission_number,first_name) VALUES($1,$2,$3,'Tenant B')", [studentB, schoolB, `B-${studentB}`]);
      await admin.query("SELECT set_config('app.school_id',$1,true)", [schoolA]);
      assert.equal((await admin.query('SELECT id FROM students WHERE id=$1', [studentB])).rowCount, 0, 'tenant A cannot read tenant B');
      assert.equal((await admin.query("UPDATE students SET first_name='Tampered' WHERE id=$1", [studentB])).rowCount, 0, 'tenant A cannot update tenant B');
      assert.equal((await admin.query('DELETE FROM students WHERE id=$1', [studentB])).rowCount, 0, 'tenant A cannot delete tenant B');

      await admin.query("SELECT set_config('app.school_id','',true)");
      assert.equal((await admin.query('SELECT id FROM students')).rowCount, 0, 'missing tenant context cannot read student rows');
      await admin.query('SAVEPOINT missing_context_insert');
      let missingContextInsertDenied = false;
      try {
        await admin.query("INSERT INTO students(id,school_id,admission_number,first_name) VALUES($1,$2,$3,'No Context')", [randomUUID(), schoolA, `NONE-${randomUUID()}`]);
      } catch (error) {
        missingContextInsertDenied = (error as { code?: string }).code === '42501';
        if (!missingContextInsertDenied) throw error;
      }
      await admin.query('ROLLBACK TO SAVEPOINT missing_context_insert');
      assert.equal(missingContextInsertDenied, true, 'missing tenant context cannot insert student rows');
    } finally {
      await admin.query('ROLLBACK');
    }

    const tenantA = randomUUID();
    const tenantB = randomUUID();
    let backendPid = 0;
    const scoped = await tenantTransactionUsing(pool, tenantA, async client => {
      const result = await client.query<{ tenant_id: string; backend_pid: number }>("SELECT current_setting('app.school_id',true) AS tenant_id,pg_backend_pid() AS backend_pid");
      backendPid = result.rows[0]!.backend_pid;
      return result.rows[0]!;
    });
    assert.equal(scoped.tenant_id, tenantA, 'application helper sets tenant context inside a transaction');
    const reused = await pool.query<{ tenant_id: string | null; backend_pid: number }>("SELECT nullif(current_setting('app.school_id',true),'') AS tenant_id,pg_backend_pid() AS backend_pid");
    assert.equal(reused.rows[0]?.backend_pid, backendPid, 'pool reuses the same PostgreSQL connection');
    assert.equal(reused.rows[0]?.tenant_id, null, 'transaction-scoped tenant context is cleared on connection reuse');
    const scopedAgain = await tenantTransactionUsing(pool, tenantB, client => client.query<{ tenant_id: string }>("SELECT current_setting('app.school_id',true) AS tenant_id").then(r => r.rows[0]!));
    assert.equal(scopedAgain.tenant_id, tenantB, 'the reused connection receives only the next request tenant context');

    console.info(`PASS: PostgreSQL ${identity.rows[0]!.version}; ${tables.rows[0]!.tenant_tables} tenant tables; two-tenant read/insert/update/delete denial; missing-context denial; same-connection tenant context reset; temporary records rolled back.`);
  } finally {
    await admin.end();
    await Promise.all([pool.end(), platformPool.end()]);
  }
}

main().catch(error => {
  console.error('Live PostgreSQL tenant verification failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
