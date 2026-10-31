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

test('fee structures, assignments, ledger idempotency, reversals, linked scopes and school isolation use PostgreSQL', async () => {
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

  const [{ pool, platformPool, tenantTransaction }, { signAccess }, { feesRouter }, { HttpError }] = await Promise.all([
    import('../db/pool.js'),
    import('../auth/tokens.js'),
    import('./routes.js'),
    import('../http.js'),
  ]);
  pool.on('acquire', client => { void client.query('SET ROLE educonnect_app'); });
  platformPool.on('acquire', client => { void client.query('SET ROLE educonnect_platform'); });

  const app = express();
  app.use(express.json());
  app.use('/api/school/fees', feesRouter);
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
      const school = (await platformPool.query("INSERT INTO schools(name,contact_email,status) VALUES($1,$2,'active') RETURNING id,school_id", [`Fees ${label} ${randomUUID()}`, `${randomUUID()}@test.invalid`])).rows[0];
      schools.push(school.id);
      await platformPool.query("INSERT INTO subscriptions(school_id,plan_id,status) VALUES($1,$2,'trialing')", [school.id, plan.id]);
      return school as { id: string; school_id: string };
    };
    const schoolA = await makeSchool('A'), schoolB = await makeSchool('B');

    const addUser = async (schoolId: string, kind: 'school_admin' | 'parent' | 'student') => {
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
    const parentA = await addUser(schoolA.id, 'parent');
    const studentA = await addUser(schoolA.id, 'student');
    const adminB = await addUser(schoolB.id, 'school_admin');

    const seedA = await tenantTransaction(schoolA.id, async c => {
      const year = (await c.query("INSERT INTO academic_years(school_id,name,starts_on,ends_on,is_current) VALUES($1,'2026-27','2026-04-01','2027-03-31',true) RETURNING id", [schoolA.id])).rows[0].id;
      const klass = (await c.query("INSERT INTO classes(school_id,academic_year_id,name) VALUES($1,$2,'Grade 10') RETURNING id", [schoolA.id, year])).rows[0].id;
      const st = (await c.query("INSERT INTO students(school_id,user_id,admission_number,first_name,last_name) VALUES($1,$2,$3,'Kavya','Nair') RETURNING id", [schoolA.id, studentA.id, `ADM-${randomUUID()}`])).rows[0].id;
      await c.query('INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id) VALUES($1,$2,$3,$4)', [schoolA.id, st, year, klass]);
      const p = (await c.query("INSERT INTO parents(school_id,user_id,relationship) VALUES($1,$2,'father') RETURNING id", [schoolA.id, parentA.id])).rows[0].id;
      await c.query('INSERT INTO student_parents(school_id,student_id,parent_id) VALUES($1,$2,$3)', [schoolA.id, st, p]);
      return { year, klass, st };
    });

    // 1. Create Fee Category
    const catRes = await call('/api/school/fees/categories', adminA.token, {
      method: 'POST',
      body: JSON.stringify({ name: 'Tuition Fee Term 1', categoryType: 'tuition' }),
    });
    assert.equal(catRes.status, 201, await catRes.clone().text());
    const category = (await catRes.json() as { category: { id: string } }).category;

    // 2. Create Fee Structure
    const structRes = await call('/api/school/fees/structures', adminA.token, {
      method: 'POST',
      body: JSON.stringify({
        categoryId: category.id,
        academicYearId: seedA.year,
        amountMinor: 5000000, // ₹50,000.00
        currency: 'INR',
        dueOn: '2026-07-15',
        description: 'Standard Term 1 tuition fee',
      }),
    });
    assert.equal(structRes.status, 201, await structRes.clone().text());
    const structure = (await structRes.json() as { structure: { id: string } }).structure;

    // 3. Assign Fee to Student
    const assignRes = await call('/api/school/fees/assignments', adminA.token, {
      method: 'POST',
      body: JSON.stringify({
        studentId: seedA.st,
        feeStructureId: structure.id,
      }),
    });
    assert.equal(assignRes.status, 201, await assignRes.clone().text());
    const assignment = (await assignRes.json() as { fee: { id: string; amount_due_minor: string | number } }).fee;

    // 4. Inspect Student Fee ledger (Parent scope)
    const parentFeeRead = await call(`/api/school/fees/students/${seedA.st}`, parentA.token);
    assert.equal(parentFeeRead.status, 200);
    const parentPayload = await parentFeeRead.json() as { items: { id: string; balance_minor: number | string }[] };
    assert.equal(parentPayload.items.length, 1);
    assert.equal(Number(parentPayload.items[0]?.balance_minor), 5000000);

    // 5. Record Offline Payment
    const idemKey = `pay-${randomUUID()}`;
    const payRes = await call('/api/school/fees/payments', adminA.token, {
      method: 'POST',
      body: JSON.stringify({
        studentFeeId: assignment.id,
        amountMinor: 2000000, // ₹20,000 partial payment
        method: 'bank_transfer',
        reference: 'IMPS-987654321',
        idempotencyKey: idemKey,
      }),
    });
    assert.equal(payRes.status, 201, await payRes.clone().text());
    const payment = (await payRes.json() as { payment: { id: string }; receipt: { receipt_number: string } });
    assert.ok(payment.receipt?.receipt_number);

    // 6. Idempotency test (repeat exact request with same idempotencyKey returns 200 replayed)
    const repeatPay = await call('/api/school/fees/payments', adminA.token, {
      method: 'POST',
      body: JSON.stringify({
        studentFeeId: assignment.id,
        amountMinor: 2000000,
        method: 'bank_transfer',
        reference: 'IMPS-987654321',
        idempotencyKey: idemKey,
      }),
    });
    assert.equal(repeatPay.status, 200, 'exact duplicate idempotency key replays payment');
    assert.equal((await repeatPay.json() as { replayed: boolean }).replayed, true);

    // 7. Verify updated balance (₹30,000 outstanding)
    const afterPay = await call(`/api/school/fees/students/${seedA.st}`, adminA.token);
    assert.equal(afterPay.status, 200);
    const afterPayload = await afterPay.json() as { items: { paid_minor: number | string; balance_minor: number | string }[] };
    assert.equal(Number(afterPayload.items[0]?.paid_minor), 2000000);
    assert.equal(Number(afterPayload.items[0]?.balance_minor), 3000000);

    // 8. Reversal of payment
    const revIdem = `rev-${randomUUID()}`;
    const revRes = await call(`/api/school/fees/payments/${payment.payment.id}/reversals`, adminA.token, {
      method: 'POST',
      body: JSON.stringify({
        amountMinor: 2000000,
        reason: 'Cheque bounced / payment recall by bank',
        idempotencyKey: revIdem,
      }),
    });
    assert.equal(revRes.status, 201, await revRes.clone().text());

    // 9. Verify outstanding balance restored to ₹50,000
    const afterRev = await call(`/api/school/fees/students/${seedA.st}`, adminA.token);
    assert.equal(afterRev.status, 200);
    const revPayload = await afterRev.json() as { items: { balance_minor: number | string }[] };
    assert.equal(Number(revPayload.items[0]?.balance_minor), 5000000);

    // 10. Direct SQL mutation blocked by append-only database trigger
    await assert.rejects(
      () => tenantTransaction(schoolA.id, c => c.query("UPDATE payments SET amount_minor = 100 WHERE id = $1", [payment.payment.id])),
      /fee ledger is append-only/
    );

    // 11. Cross-school isolation (School B cannot see School A student fees)
    const crossRead = await call(`/api/school/fees/students/${seedA.st}`, adminB.token);
    assert.equal(crossRead.status, 404, 'School B cannot see School A student fee ledger');
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
