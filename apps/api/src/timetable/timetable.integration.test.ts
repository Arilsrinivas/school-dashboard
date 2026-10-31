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

test('timetable periods, conflict prevention, publishing, role scopes and school isolation use PostgreSQL', async () => {
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

  const [{ pool, platformPool, tenantTransaction }, { signAccess }, { timetableRouter }, { HttpError }] = await Promise.all([
    import('../db/pool.js'),
    import('../auth/tokens.js'),
    import('./routes.js'),
    import('../http.js'),
  ]);
  pool.on('acquire', client => { void client.query('SET ROLE educonnect_app'); });
  platformPool.on('acquire', client => { void client.query('SET ROLE educonnect_platform'); });

  const app = express();
  app.use(express.json());
  app.use('/api/school', timetableRouter);
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
      const school = (await platformPool.query("INSERT INTO schools(name,contact_email,status) VALUES($1,$2,'active') RETURNING id,school_id", [`Timetable ${label} ${randomUUID()}`, `${randomUUID()}@test.invalid`])).rows[0];
      schools.push(school.id);
      await platformPool.query("INSERT INTO subscriptions(school_id,plan_id,status) VALUES($1,$2,'trialing')", [school.id, plan.id]);
      return school as { id: string; school_id: string };
    };
    const schoolA = await makeSchool('A'), schoolB = await makeSchool('B');

    const addUser = async (schoolId: string, kind: 'school_admin' | 'teacher' | 'parent' | 'student') => {
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
    const teacherA1 = await addUser(schoolA.id, 'teacher');
    const teacherA2 = await addUser(schoolA.id, 'teacher');
    const studentA = await addUser(schoolA.id, 'student');
    const parentA = await addUser(schoolA.id, 'parent');
    const adminB = await addUser(schoolB.id, 'school_admin');

    const seedA = await tenantTransaction(schoolA.id, async c => {
      const year = (await c.query("INSERT INTO academic_years(school_id,name,starts_on,ends_on,is_current) VALUES($1,'2026-27','2026-04-01','2027-03-31',true) RETURNING id", [schoolA.id])).rows[0].id;
      const klass = (await c.query("INSERT INTO classes(school_id,academic_year_id,name) VALUES($1,$2,'Grade 8') RETURNING id", [schoolA.id, year])).rows[0].id;
      const section = (await c.query("INSERT INTO sections(school_id,class_id,name) VALUES($1,$2,'A') RETURNING id", [schoolA.id, klass])).rows[0].id;
      const subMath = (await c.query("INSERT INTO subjects(school_id,name) VALUES($1,'Mathematics') RETURNING id", [schoolA.id])).rows[0].id;
      const subSci = (await c.query("INSERT INTO subjects(school_id,name) VALUES($1,'Science') RETURNING id", [schoolA.id])).rows[0].id;
      const csMath = (await c.query('INSERT INTO class_subjects(school_id,class_id,subject_id) VALUES($1,$2,$3) RETURNING id', [schoolA.id, klass, subMath])).rows[0].id;
      const csSci = (await c.query('INSERT INTO class_subjects(school_id,class_id,subject_id) VALUES($1,$2,$3) RETURNING id', [schoolA.id, klass, subSci])).rows[0].id;
      const t1 = (await c.query('INSERT INTO teachers(school_id,user_id,employee_id) VALUES($1,$2,$3) RETURNING id', [schoolA.id, teacherA1.id, `T1-${randomUUID().slice(0, 6)}`])).rows[0].id;
      const t2 = (await c.query('INSERT INTO teachers(school_id,user_id,employee_id) VALUES($1,$2,$3) RETURNING id', [schoolA.id, teacherA2.id, `T2-${randomUUID().slice(0, 6)}`])).rows[0].id;
      await c.query('INSERT INTO teacher_assignments(school_id,teacher_id,class_subject_id,section_id) VALUES($1,$2,$3,$4)', [schoolA.id, t1, csMath, section]);
      await c.query('INSERT INTO teacher_assignments(school_id,teacher_id,class_subject_id,section_id) VALUES($1,$2,$3,$4)', [schoolA.id, t2, csSci, section]);
      const st = (await c.query("INSERT INTO students(school_id,user_id,admission_number,first_name,last_name) VALUES($1,$2,$3,'Rohan','Patel') RETURNING id", [schoolA.id, studentA.id, `ADM-${randomUUID()}`])).rows[0].id;
      await c.query('INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id) VALUES($1,$2,$3,$4,$5)', [schoolA.id, st, year, klass, section]);
      const p = (await c.query("INSERT INTO parents(school_id,user_id,relationship) VALUES($1,$2,'mother') RETURNING id", [schoolA.id, parentA.id])).rows[0].id;
      await c.query('INSERT INTO student_parents(school_id,student_id,parent_id) VALUES($1,$2,$3)', [schoolA.id, st, p]);
      return { year, klass, section, subMath, subSci, t1, t2, st };
    });

    // 1. Create timetable periods
    const p1Res = await call('/api/school/timetable/periods', adminA.token, {
      method: 'POST',
      body: JSON.stringify({ academicYearId: seedA.year, periodNumber: 1, name: 'Period 1', startsAt: '09:00', endsAt: '09:45' }),
    });
    assert.equal(p1Res.status, 201, await p1Res.clone().text());
    const period1 = (await p1Res.json() as { period: { id: string } }).period;

    const p2Res = await call('/api/school/timetable/periods', adminA.token, {
      method: 'POST',
      body: JSON.stringify({ academicYearId: seedA.year, periodNumber: 2, name: 'Period 2', startsAt: '09:45', endsAt: '10:30' }),
    });
    assert.equal(p2Res.status, 201);
    const period2 = (await p2Res.json() as { period: { id: string } }).period;

    // 2. Read periods
    const listPeriods = await call(`/api/school/timetable/periods?academicYearId=${seedA.year}`, adminA.token);
    assert.equal(listPeriods.status, 200);
    const periodsPayload = await listPeriods.json() as { items: { id: string }[] };
    assert.equal(periodsPayload.items.length, 2);

    // 3. Create a timetable entry
    const entry1Res = await call('/api/school/timetable', adminA.token, {
      method: 'POST',
      body: JSON.stringify({
        academicYearId: seedA.year,
        classId: seedA.klass,
        sectionId: seedA.section,
        subjectId: seedA.subMath,
        teacherId: seedA.t1,
        periodId: period1.id,
        dayOfWeek: 1, // Monday
        room: 'Lab 1',
      }),
    });
    assert.equal(entry1Res.status, 201, await entry1Res.clone().text());
    const entry1 = (await entry1Res.json() as { entry: { id: string; status: string } }).entry;
    assert.equal(entry1.status, 'draft');

    // 4. Duplicate entry collision (same section, same period/time)
    const conflictRes = await call('/api/school/timetable', adminA.token, {
      method: 'POST',
      body: JSON.stringify({
        academicYearId: seedA.year,
        classId: seedA.klass,
        sectionId: seedA.section,
        subjectId: seedA.subSci,
        teacherId: seedA.t2,
        periodId: period1.id,
        dayOfWeek: 1,
        room: 'Lab 2',
      }),
    });
    assert.equal(conflictRes.status, 409, 'overlapping period for the same section triggers a conflict check');

    // 5. Room collision (different section/class, but same room and overlapping time)
    const roomConflictRes = await call('/api/school/timetable', adminA.token, {
      method: 'POST',
      body: JSON.stringify({
        academicYearId: seedA.year,
        classId: seedA.klass,
        sectionId: seedA.section,
        subjectId: seedA.subSci,
        teacherId: seedA.t2,
        periodId: period1.id,
        dayOfWeek: 1,
        room: 'Lab 1', // room busy
      }),
    });
    assert.equal(roomConflictRes.status, 409);

    // 6. Non-conflicting entry (period 2)
    const entry2Res = await call('/api/school/timetable', adminA.token, {
      method: 'POST',
      body: JSON.stringify({
        academicYearId: seedA.year,
        classId: seedA.klass,
        sectionId: seedA.section,
        subjectId: seedA.subSci,
        teacherId: seedA.t2,
        periodId: period2.id,
        dayOfWeek: 1,
        room: 'Lab 1',
      }),
    });
    assert.equal(entry2Res.status, 201);

    // 7. Publish schedule
    const pubRes = await call('/api/school/timetable/publish', adminA.token, {
      method: 'POST',
      body: JSON.stringify({ academicYearId: seedA.year, classId: seedA.klass, sectionId: seedA.section }),
    });
    assert.equal(pubRes.status, 200, await pubRes.clone().text());

    // 8. Teacher weekly view
    const teacherSchedule = await call(`/api/school/timetable/teachers/${seedA.t1}?academicYearId=${seedA.year}`, teacherA1.token);
    assert.equal(teacherSchedule.status, 200);
    const teacherPayload = await teacherSchedule.json() as { items: unknown[] };
    assert.equal(teacherPayload.items.length, 1);

    // 9. Student/Parent view
    const studentSchedule = await call(`/api/school/timetable/classes/${seedA.klass}?academicYearId=${seedA.year}&sectionId=${seedA.section}`, studentA.token);
    assert.equal(studentSchedule.status, 200);
    const studentPayload = await studentSchedule.json() as { items: unknown[] };
    assert.equal(studentPayload.items.length, 2);

    // 10. Cross-school isolation (School B cannot see School A's periods or entries)
    const crossPeriods = await call(`/api/school/timetable/periods?academicYearId=${seedA.year}`, adminB.token);
    assert.equal((await crossPeriods.json() as { items: unknown[] }).items.length, 0, 'School B sees 0 periods from School A');

    const crossSchedule = await call(`/api/school/timetable/classes/${seedA.klass}?academicYearId=${seedA.year}`, adminB.token);
    assert.equal(crossSchedule.status, 404, 'School B cannot see School A class timetable');
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
