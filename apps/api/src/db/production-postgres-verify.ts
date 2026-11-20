import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

const confirmation = 'I_CREATED_EMPTY_ISOLATED_VERIFY_DATABASE';
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; this verifier never falls back to .env`);
  return value;
}
function connectionUrl(name: string): URL {
  const value = new URL(required(name));
  if (!['postgres:', 'postgresql:'].includes(value.protocol)) throw new Error(`${name} must be a PostgreSQL URL`);
  return value;
}

async function verifyRole(pool: pg.Pool, expectedRole: string, expectedDatabase: string) {
  const { rows } = await pool.query<{ role_name: string; database_name: string; privileged: boolean }>(`
    WITH RECURSIVE role_tree(role_oid, privileged) AS (
      SELECT oid, rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user
      UNION
      SELECT granted.oid,granted.rolsuper OR granted.rolbypassrls
        FROM pg_auth_members membership
        JOIN role_tree member_role ON member_role.role_oid=membership.member
        JOIN pg_roles granted ON granted.oid=membership.roleid
    )
    SELECT current_user AS role_name,current_database() AS database_name,
           COALESCE(bool_or(privileged),true) AS privileged
      FROM role_tree
  `);
  const role = rows[0];
  assert.ok(role, `database role ${expectedRole} exists`);
  assert.equal(role.role_name, expectedRole, 'connection authenticated as the intended runtime role');
  assert.equal(role.database_name, expectedDatabase, 'all pools point to the isolated verification database');
  assert.equal(role.privileged, false, `${expectedRole} is not superuser, does not inherit an elevated role, and does not bypass RLS`);
}

async function main() {
  if (process.env.POSTGRES_SECURITY_TEST_CONFIRM !== confirmation) {
    throw new Error(`Refusing to run. Set POSTGRES_SECURITY_TEST_CONFIRM=${confirmation} only for a newly created, empty, non-production database.`);
  }
  const adminUrl = connectionUrl('POSTGRES_SECURITY_TEST_ADMIN_URL');
  const appUrl = connectionUrl('POSTGRES_SECURITY_TEST_APP_URL');
  const platformUrl = connectionUrl('POSTGRES_SECURITY_TEST_PLATFORM_URL');
  const databaseName = decodeURIComponent(adminUrl.pathname.replace(/^\//, ''));
  if (!/^educonnect_security_verify_[0-9]{8}$/.test(databaseName)) {
    throw new Error('Verification database must be newly created and named educonnect_security_verify_YYYYMMDD');
  }
  if (adminUrl.hostname !== appUrl.hostname || adminUrl.hostname !== platformUrl.hostname ||
      adminUrl.port !== appUrl.port || adminUrl.port !== platformUrl.port ||
      adminUrl.pathname !== appUrl.pathname || adminUrl.pathname !== platformUrl.pathname) {
    throw new Error('Admin, app, and platform URLs must target the same isolated PostgreSQL database');
  }

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = appUrl.toString();
  process.env.PLATFORM_DATABASE_URL = platformUrl.toString();
  process.env.ACCESS_TOKEN_SECRET ||= 'postgres-security-verification-access-secret';
  process.env.REFRESH_TOKEN_SECRET ||= 'postgres-security-verification-refresh-secret';

  const admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 1, application_name: 'educonnect-security-migrations' });
  const appPool = new pg.Pool({ connectionString: appUrl.toString(), max: 1, application_name: 'educonnect-security-app-test' });
  const platformPool = new pg.Pool({ connectionString: platformUrl.toString(), max: 1, application_name: 'educonnect-security-platform-test' });
  try {
    const dbState = await admin.query<{ name: string; table_count: number }>(`
      SELECT current_database() AS name,
             (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')) AS table_count
    `);
    assert.equal(dbState.rows[0]?.name, databaseName);
    assert.equal(dbState.rows[0]?.table_count, 0, 'verification database is empty before any migrations or test writes');

    const existingRoles = await admin.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])`,
      [['educonnect_app', 'educonnect_platform']]
    );
    assert.equal(existingRoles.rowCount, 2, 'both runtime login roles exist before migrations');

    const migrationDir = new URL('../../migrations/', import.meta.url);
    const migrations = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
    for (const name of migrations) {
      let sql = await readFile(new URL(name, migrationDir), 'utf8');
      sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/, '');
      await admin.query(sql);
      console.info(`Applied ${name} to the isolated verification database`);
    }

    await admin.query('GRANT USAGE ON SCHEMA public TO educonnect_app,educonnect_platform');
    await admin.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO educonnect_app,educonnect_platform');
    await admin.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO educonnect_app,educonnect_platform');

    await verifyRole(appPool, 'educonnect_app', databaseName);
    await verifyRole(platformPool, 'educonnect_platform', databaseName);

    const tables = await admin.query<{ relname: string; rls: boolean; force_rls: boolean; tenant_policies: number }>(`
      SELECT c.relname,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
             count(p.oid) FILTER (WHERE p.polname<>'platform_runtime_access')::int AS tenant_policies
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='school_id' AND NOT a.attisdropped
        LEFT JOIN pg_policy p ON p.polrelid=c.oid
       WHERE n.nspname='public' AND c.relkind='r'
       GROUP BY c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity ORDER BY c.relname
    `);
    assert.ok(tables.rowCount, 'the catalog contains tenant-owned tables');
    for (const table of tables.rows) {
      assert.equal(table.rls, true, `${table.relname}: RLS enabled`);
      assert.equal(table.force_rls, true, `${table.relname}: FORCE RLS enabled`);
      assert.ok(table.tenant_policies > 0, `${table.relname}: tenant policy present`);
    }

    const schoolA = (await platformPool.query<{ id: string }>(
      `INSERT INTO schools(name,contact_email,status) VALUES($1,$2,'active') RETURNING id`,
      [`Security Verify A ${randomUUID()}`, `${randomUUID()}@verify.invalid`]
    )).rows[0]!.id;
    const schoolB = (await platformPool.query<{ id: string }>(
      `INSERT INTO schools(name,contact_email,status) VALUES($1,$2,'active') RETURNING id`,
      [`Security Verify B ${randomUUID()}`, `${randomUUID()}@verify.invalid`]
    )).rows[0]!.id;

    const { tenantTransactionUsing } = await import('./pool.js');
    const studentA = randomUUID();
    const studentB = randomUUID();
    await tenantTransactionUsing(appPool, schoolA, client => client.query(
      `INSERT INTO students(id,school_id,admission_number,first_name) VALUES($1,$2,$3,'Tenant A')`,
      [studentA, schoolA, `A-${studentA}`]
    ));
    await tenantTransactionUsing(appPool, schoolB, client => client.query(
      `INSERT INTO students(id,school_id,admission_number,first_name) VALUES($1,$2,$3,'Tenant B')`,
      [studentB, schoolB, `B-${studentB}`]
    ));

    const foreignRead = await tenantTransactionUsing(appPool, schoolA, client => client.query(
      'SELECT id FROM students WHERE school_id=$1 AND id=$2', [schoolB, studentB]
    ));
    assert.equal(foreignRead.rowCount, 0, 'tenant A cannot read tenant B rows');
    const foreignUpdate = await tenantTransactionUsing(appPool, schoolA, client => client.query(
      `UPDATE students SET first_name='Tampered' WHERE school_id=$1 AND id=$2`, [schoolB, studentB]
    ));
    assert.equal(foreignUpdate.rowCount, 0, 'tenant A cannot update tenant B rows');
    const foreignDelete = await tenantTransactionUsing(appPool, schoolA, client => client.query(
      'DELETE FROM students WHERE school_id=$1 AND id=$2', [schoolB, studentB]
    ));
    assert.equal(foreignDelete.rowCount, 0, 'tenant A cannot delete tenant B rows');
    await assert.rejects(() => tenantTransactionUsing(appPool, schoolA, client => client.query(
      `INSERT INTO students(school_id,admission_number,first_name) VALUES($1,$2,'Unauthorized')`, [schoolB, randomUUID()]
    )), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === '42501'), 'tenant A cannot insert for tenant B');

    assert.equal((await appPool.query('SELECT id FROM students')).rowCount, 0, 'missing tenant context cannot read tenant rows');
    await assert.rejects(() => appPool.query(
      `INSERT INTO students(school_id,admission_number,first_name) VALUES($1,$2,'No Context')`, [schoolA, randomUUID()]
    ), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === '42501'), 'missing tenant context cannot insert tenant rows');

    const aVisible = await tenantTransactionUsing(appPool, schoolA, client => client.query(
      'SELECT id FROM schools WHERE id=$1', [schoolA]
    ));
    assert.equal(aVisible.rowCount, 1);
    const afterReuse = await appPool.query<{ tenant_id: string | null; visible: number }>(
      `SELECT current_setting('app.school_id',true) AS tenant_id,(SELECT count(*)::int FROM schools) AS visible`
    );
    assert.ok(!afterReuse.rows[0]?.tenant_id, 'SET LOCAL tenant context is cleared after commit and pool reuse');
    assert.equal(afterReuse.rows[0]?.visible, 0, 'a reused connection has no previous tenant visibility');
    const bVisible = await tenantTransactionUsing(appPool, schoolB, client => client.query(
      'SELECT id FROM schools WHERE id=$1', [schoolB]
    ));
    assert.equal(bVisible.rowCount, 1);

    assert.equal((await platformPool.query('SELECT id FROM schools WHERE id=ANY($1::uuid[])', [[schoolA, schoolB]])).rowCount, 2,
      'platform role sees both tenants through its explicit RLS policy, without bypass privileges');
    console.info(`PASS: ${tables.rowCount} tenant tables, NOBYPASSRLS roles, two-school read/write/delete isolation, missing context, and pool reuse`);
  } finally {
    await Promise.all([admin.end(), appPool.end(), platformPool.end()]);
  }
}

main().catch(error => {
  console.error('Isolated PostgreSQL verification failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
