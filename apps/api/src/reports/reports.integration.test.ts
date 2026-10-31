import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = 'local-test-access-secret-that-is-long-enough';
process.env.REFRESH_TOKEN_SECRET = 'different-local-test-refresh-secret-long-enough';

test('reports dashboard metrics, academic aggregates, attendance breakdown, export and school isolation use PostgreSQL', async () => {
  const db = await PGlite.create();
  const migrationDir = new URL('../../migrations/', import.meta.url);
  const migrationNames = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
  for (const name of migrationNames) {
    let sql = await readFile(new URL(name, migrationDir), 'utf8');
    sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/, '');
    await db.exec(sql);
  }
  await db.exec(`CREATE ROLE educonnect_app LOGIN NOBYPASSRLS; CREATE ROLE educonnect_platform LOGIN BYPASSRLS; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO educonnect_app,educonnect_platform; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO educonnect_app,educonnect_platform;`);
  const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 16 });
  await socket.start();
  const port = Number(socket.getServerConn().split(':').at(-1));
  process.env.DATABASE_URL = `postgresql://educonnect_app@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.PLATFORM_DATABASE_URL = `postgresql://educonnect_platform@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.MIGRATION_DATABASE_URL = process.env.PLATFORM_DATABASE_URL;

  const [{ pool, platformPool, tenantTransaction }, { signAccess }, { reportsRouter }, { HttpError }] = await Promise.all([
    import('../db/pool.js'),
    import('../auth/tokens.js'),
    import('./routes.js'),
    import('../http.js'),
  ]);
  pool.on('acquire', client => { void client.query('SET ROLE educonnect_app'); });
  platformPool.on('acquire', client => { void client.query('SET ROLE educonnect_platform'); });

  const app = express();
  app.use(express.json());
  app.use('/api/school', reportsRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: (err as Error).message });
  });

  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (path: string, token: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });

  const schools: string[] = [], users: string[] = [];
  try {
    const makeSchool = async (label: string) => {
      const plan = (await platformPool.query("SELECT id FROM subscription_plans WHERE billing_interval='trial' LIMIT 1")).rows[0];
      const school = (await platformPool.query("INSERT INTO schools(name,contact_email,status) VALUES($1,$2,'active') RETURNING id,school_id", [`Reports ${label} ${randomUUID()}`, `${randomUUID()}@test.invalid`])).rows[0];
      schools.push(school.id);
      await platformPool.query("INSERT INTO subscriptions(school_id,plan_id,status) VALUES($1,$2,'trialing')", [school.id, plan.id]);
      return school as { id: string; school_id: string };
    };
    const schoolA = await makeSchool('A'), schoolB = await makeSchool('B');

    const addUser = async (schoolId: string, kind: 'school_admin' | 'teacher' | 'parent') => {
      const id = randomUUID();
      users.push(id);
      await platformPool.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [id, `${randomUUID()}@test.invalid`, `${kind} test`, 'not-used']);
      const membership = (await tenantTransaction(schoolId, async c => {
        const role = (await c.query('SELECT id FROM school_roles WHERE school_id=$1 AND code=$2', [schoolId, kind === 'school_admin' ? 'school_administrator' : kind])).rows[0];
        return c.query('INSERT INTO school_memberships(school_id,user_id,role,school_role_id) VALUES($1,$2,$3,$4) RETURNING id', [schoolId, id, kind, role.id]);
      })).rows[0].id;
      return { id, membership, token: await signAccess({ kind: 'school', id, role: kind, schoolId }) };
    };

    const adminA = await addUser(schoolA.id, 'school_admin');
    const adminB = await addUser(schoolB.id, 'school_admin');

    // Seed School A with classes, students, attendance, exams, fees
    await tenantTransaction(schoolA.id, async c => {
      const year = (await c.query("INSERT INTO academic_years(school_id,name,starts_on,ends_on,is_current) VALUES($1,'2026-27','2026-04-01','2027-03-31',true) RETURNING id", [schoolA.id])).rows[0].id;
      const klass = (await c.query("INSERT INTO classes(school_id,academic_year_id,name) VALUES($1,$2,'Grade 6') RETURNING id", [schoolA.id, year])).rows[0].id;
      const st = (await c.query("INSERT INTO students(school_id,admission_number,first_name,last_name) VALUES($1,$2,'Sara','Khan') RETURNING id", [schoolA.id, `ADM-${randomUUID()}`])).rows[0].id;
      await c.query('INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id) VALUES($1,$2,$3,$4)', [schoolA.id, st, year, klass]);
      await c.query("INSERT INTO attendance(school_id,student_id,academic_year_id,class_id,attendance_date,status) VALUES($1,$2,$3,$4,CURRENT_DATE,'present')", [schoolA.id, st, year, klass]);
    });

    // 1. Dashboard summary
    const dashRes = await call('/api/school/reports/dashboard', adminA.token);
    assert.equal(dashRes.status, 200, await dashRes.clone().text());
    const dashData = await dashRes.json() as { counts: { active_students: number; total_classes: number }; attendanceSummary: { status: string; count: number }[] };
    assert.equal(Number(dashData.counts.active_students), 1);
    assert.equal(Number(dashData.counts.total_classes), 1);
    assert.equal(dashData.attendanceSummary.find(s => s.status === 'present')?.count, 1);

    // 2. Attendance report
    const attRes = await call('/api/school/reports/attendance', adminA.token);
    assert.equal(attRes.status, 200);
    const attData = await attRes.json() as { items: { class_name: string; present_count: number }[] };
    assert.equal(attData.items.length, 1);
    assert.equal(attData.items[0]?.class_name, 'Grade 6');
    assert.equal(attData.items[0]?.present_count, 1);

    // 3. Export students (JSON)
    const exportJson = await call('/api/school/reports/export?type=students', adminA.token);
    assert.equal(exportJson.status, 200);
    const studentsList = await exportJson.json() as { items: { first_name: string }[] };
    assert.equal(studentsList.items.length, 1);
    assert.equal(studentsList.items[0]?.first_name, 'Sara');

    // 4. Export students (CSV)
    const exportCsv = await call('/api/school/reports/export?type=students&format=csv', adminA.token);
    assert.equal(exportCsv.status, 200);
    const csvContent = await exportCsv.text();
    assert.ok(csvContent.includes('admission_number'));
    assert.ok(csvContent.includes('Sara'));

    // 5. Cross-school isolation (School B sees 0 students for School B)
    const crossDash = await call('/api/school/reports/dashboard', adminB.token);
    assert.equal(crossDash.status, 200);
    const crossData = await crossDash.json() as { counts: { active_students: number } };
    assert.equal(Number(crossData.counts.active_students), 0);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (schools.length) {
      await platformPool.query('DELETE FROM subscriptions WHERE school_id=ANY($1::uuid[])', [schools]);
      await platformPool.query('DELETE FROM schools WHERE id=ANY($1::uuid[])', [schools]);
    }
    if (users.length) await platformPool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
    await Promise.all([pool.end(), platformPool.end()]);
    await socket.stop();
    await db.close();
  }
});
