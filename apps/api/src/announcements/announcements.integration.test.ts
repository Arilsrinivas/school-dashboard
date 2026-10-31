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

test('announcements publishing, audience targeting, in-app notifications and school isolation use PostgreSQL', async () => {
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

  const [{ pool, platformPool, tenantTransaction }, { signAccess }, { announcementsRouter }, { HttpError }] = await Promise.all([
    import('../db/pool.js'),
    import('../auth/tokens.js'),
    import('./routes.js'),
    import('../http.js'),
  ]);
  pool.on('acquire', client => { void client.query('SET ROLE educonnect_app'); });
  platformPool.on('acquire', client => { void client.query('SET ROLE educonnect_platform'); });

  const app = express();
  app.use(express.json());
  app.use('/api/school', announcementsRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('SERVER ERROR IN TEST:', err);
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
      const school = (await platformPool.query("INSERT INTO schools(name,contact_email,status) VALUES($1,$2,'active') RETURNING id,school_id", [`Announcements ${label} ${randomUUID()}`, `${randomUUID()}@test.invalid`])).rows[0];
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
    const parentA = await addUser(schoolA.id, 'parent');
    const studentA = await addUser(schoolA.id, 'student');
    const adminB = await addUser(schoolB.id, 'school_admin');

    // 1. Create announcement in draft
    const createRes = await call('/api/school/announcements', adminA.token, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Annual Sports Day 2026',
        body: 'Join us on Friday for sports events, food stalls, and medals ceremony.',
        audience: { type: 'school' },
        publish: false,
      }),
    });
    assert.equal(createRes.status, 201, await createRes.clone().text());
    const ann = (await createRes.json() as { announcement: { id: string; status: string } }).announcement;
    assert.equal(ann.status, 'draft');

    // 2. Draft is not visible to parent/student without manage permission
    const parentListBefore = await call('/api/school/announcements', parentA.token);
    assert.equal(parentListBefore.status, 200);
    assert.equal((await parentListBefore.json() as { items: unknown[] }).items.length, 0);

    // 3. Publish announcement
    const pubRes = await call(`/api/school/announcements/${ann.id}/publish`, adminA.token, { method: 'POST' });
    assert.equal(pubRes.status, 200, await pubRes.clone().text());
    const publishedAnn = (await pubRes.json() as { announcement: { status: string } }).announcement;
    assert.equal(publishedAnn.status, 'published');

    // 4. Published announcement is now visible to parent
    const parentListAfter = await call('/api/school/announcements', parentA.token);
    const bodyText = await parentListAfter.clone().text();
    if (parentListAfter.status !== 200) console.error('ParentListAfter error:', bodyText);
    assert.equal(parentListAfter.status, 200);
    const parentAnns = await parentListAfter.json() as { items: { id: string; title: string }[] };
    assert.equal(parentAnns.items.length, 1);
    assert.equal(parentAnns.items[0]?.title, 'Annual Sports Day 2026');

    // 5. In-app notification was dispatched to parent
    const notifRes = await call('/api/school/notifications', parentA.token);
    assert.equal(notifRes.status, 200);
    const notifData = await notifRes.json() as { items: { id: string; read_at: string | null }[]; unreadCount: number };
    assert.ok(notifData.items.length >= 1);
    assert.equal(notifData.unreadCount, notifData.items.length);
    const firstNotif = notifData.items[0]!;
    assert.equal(firstNotif.read_at, null);

    // 6. Mark notification as read
    const readRes = await call(`/api/school/notifications/${firstNotif.id}/read`, parentA.token, { method: 'PATCH' });
    assert.equal(readRes.status, 200);
    const readPayload = await readRes.json() as { notification: { read_at: string | null } };
    assert.ok(readPayload.notification.read_at !== null);

    // 7. Cross-school isolation (School B cannot see School A announcements or notifications)
    const crossAnnList = await call('/api/school/announcements', adminB.token);
    assert.equal((await crossAnnList.json() as { items: unknown[] }).items.length, 0);

    const crossNotif = await call('/api/school/notifications', adminB.token);
    assert.equal((await crossNotif.json() as { items: unknown[] }).items.length, 0);
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
