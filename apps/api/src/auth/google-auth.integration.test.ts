import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import express from 'express';
import argon2 from 'argon2';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = 'local-test-access-secret-that-is-long-enough';
process.env.REFRESH_TOKEN_SECRET = 'different-local-test-refresh-secret-long-enough';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id-12345';

test('Google Authentication integration, token verification, account linking, school access and revocation', async () => {
  const db = await PGlite.create();
  const migrationDir = new URL('../../migrations/', import.meta.url);
  const migrationNames = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
  for (const name of migrationNames) {
    let sql = await readFile(new URL(name, migrationDir), 'utf8');
    sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/, '');
    await db.exec(sql);
  }
  await db.exec('CREATE ROLE educonnect_app LOGIN NOBYPASSRLS; CREATE ROLE educonnect_platform LOGIN BYPASSRLS; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO educonnect_app,educonnect_platform; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO educonnect_app,educonnect_platform;');
  const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 16 });
  await socket.start();
  const port = Number(socket.getServerConn().split(':').at(-1));
  process.env.DATABASE_URL = `postgresql://educonnect_app@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.PLATFORM_DATABASE_URL = `postgresql://educonnect_platform@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.MIGRATION_DATABASE_URL = process.env.PLATFORM_DATABASE_URL;

  const [{ pool, platformPool, tenantTransaction }, { signAccess }, { authRouter }, { setGoogleTokenVerifier, resetGoogleTokenVerifier }] = await Promise.all([
    import('../db/pool.js'),
    import('./tokens.js'),
    import('./routes.js'),
    import('./google.js')
  ]);

  pool.on('acquire', client => { void client.query('SET ROLE educonnect_app'); });
  platformPool.on('acquire', client => { void client.query('SET ROLE educonnect_platform'); });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    }
  });

  const createdSchools: string[] = [];
  const createdUsers: string[] = [];

  try {
    const makeSchool = async (status: 'active' | 'suspended' = 'active') => {
      const plan = (await platformPool.query("SELECT id FROM subscription_plans WHERE billing_interval='trial' LIMIT 1")).rows[0];
      const school = (await platformPool.query(
        "INSERT INTO schools(name, contact_email, status) VALUES($1, $2, $3) RETURNING id, school_id, name",
        [`Test School ${randomUUID()}`, `${randomUUID()}@school.test`, status]
      )).rows[0];
      createdSchools.push(school.id);
      await platformPool.query("INSERT INTO subscriptions(school_id, plan_id, status) VALUES($1, $2, 'active')", [school.id, plan.id]);
      return school;
    };

    const schoolA = await makeSchool('active');
    const schoolB = await makeSchool('active');
    const schoolSuspended = await makeSchool('suspended');

    // Injected test verifier to support integration test mocks safely
    setGoogleTokenVerifier(async (token: string, expectedAudience?: string) => {
      const clientId = expectedAudience || process.env.GOOGLE_CLIENT_ID;
      if (token.startsWith('test-google-token:') || token.startsWith('mock-google-token:')) {
        const rawJson = token.replace(/^(test-google-token:|mock-google-token:)/, '');
        const parsed = JSON.parse(rawJson);
        if (parsed.invalidSignature) throw new Error('Invalid token signature');
        if (parsed.exp && parsed.exp * 1000 < Date.now()) throw new Error('Token is expired');
        if (clientId && parsed.aud && parsed.aud !== clientId) throw new Error('Invalid token audience');
        const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
        if (parsed.iss && !validIssuers.includes(parsed.iss)) throw new Error('Invalid token issuer');
        if (!parsed.email || !parsed.email.includes('@')) throw new Error('Valid email information is required');
        if (parsed.email_verified === false) throw new Error('Google email is not verified');
        if (!parsed.sub) throw new Error('Google sub claim is missing');
        return {
          sub: String(parsed.sub),
          email: String(parsed.email).toLowerCase().trim(),
          emailVerified: parsed.email_verified !== false,
          name: String(parsed.name || parsed.email.split('@')[0]),
          picture: parsed.picture
        };
      }
      throw new Error('Unrecognized test token format');
    });

    // Helper to generate mock tokens
    const makeMockToken = (params: {
      sub?: string;
      email?: string;
      name?: string;
      aud?: string;
      iss?: string;
      exp?: number;
      email_verified?: boolean;
      invalidSignature?: boolean;
    }) => {
      const payload = {
        sub: params.sub || `sub-${randomUUID()}`,
        email: params.email || `${randomUUID()}@google.test`,
        name: params.name || 'Test Google User',
        aud: params.aud !== undefined ? params.aud : 'test-google-client-id-12345',
        iss: params.iss !== undefined ? params.iss : 'https://accounts.google.com',
        exp: params.exp !== undefined ? params.exp : Math.floor(Date.now() / 1000) + 3600,
        email_verified: params.email_verified !== undefined ? params.email_verified : true,
        invalidSignature: params.invalidSignature
      };
      return `test-google-token:${JSON.stringify(payload)}`;
    };

    // 1. Invalid ID tokens rejected with 401
    {
      const invalidToken = makeMockToken({ invalidSignature: true });
      const res = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: invalidToken })
      });
      assert.equal(res.status, 401, 'Invalid signature rejected with 401');
    }

    // 2. Expired ID tokens rejected with 401
    {
      const expiredToken = makeMockToken({ exp: Math.floor(Date.now() / 1000) - 100 });
      const res = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: expiredToken })
      });
      assert.equal(res.status, 401, 'Expired token rejected with 401');
    }

    // 3. Incorrect audience rejected with 401
    {
      const wrongAudToken = makeMockToken({ aud: 'different-client-id' });
      const res = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: wrongAudToken })
      });
      assert.equal(res.status, 401, 'Incorrect audience rejected with 401');
    }

    // 4. Unauthorized school access (user not registered and no active invitation)
    {
      const unlinkedToken = makeMockToken({ email: 'stranger@nowhere.test' });
      const res = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: unlinkedToken })
      });
      assert.equal(res.status, 403, 'Unknown user without invitation rejected with 403');
      const data = await res.json() as any;
      assert.equal(data.error, 'access_denied');
    }

    // 5. Existing account linking: returns requiresLinking: true and requires proof of control (password)
    const existingEmail = `teacher.${randomUUID()}@school.test`;
    const plainPassword = 'teacher-secure-password-2026';
    const passwordHash = await argon2.hash(plainPassword, { type: argon2.argon2id });
    const teacherUser = (await platformPool.query(
      "INSERT INTO users(email, name, password_hash) VALUES($1, $2, $3) RETURNING id, name",
      [existingEmail, 'Existing Teacher', passwordHash]
    )).rows[0];
    createdUsers.push(teacherUser.id);

    const teacherRole = (await platformPool.query("SELECT id FROM school_roles WHERE school_id=$1 AND code='teacher'", [schoolA.id])).rows[0];
    await platformPool.query(
      "INSERT INTO school_memberships(school_id, user_id, role, school_role_id) VALUES($1, $2, 'teacher', $3)",
      [schoolA.id, teacherUser.id, teacherRole.id]
    );

    const teacherGoogleSub = `google-sub-${randomUUID()}`;
    const teacherGoogleToken = makeMockToken({ sub: teacherGoogleSub, email: existingEmail, name: 'Existing Teacher' });

    // Step A: Calling /api/auth/google with unlinked email returns requiresLinking: true
    {
      const res = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: teacherGoogleToken })
      });
      assert.equal(res.status, 200);
      const data = await res.json() as any;
      assert.equal(data.requiresLinking, true, 'Returns requiresLinking for unlinked email');
    }

    // Step B: Linking with WRONG password rejected with 401
    {
      const res = await call('/api/auth/google/link', {
        method: 'POST',
        body: JSON.stringify({ idToken: teacherGoogleToken, password: 'wrong-password' })
      });
      assert.equal(res.status, 401, 'Wrong password fails proof of control');
    }

    // Step C: Linking with CORRECT password succeeds
    let teacherAccessToken = '';
    {
      const res = await call('/api/auth/google/link', {
        method: 'POST',
        body: JSON.stringify({ idToken: teacherGoogleToken, password: plainPassword })
      });
      assert.equal(res.status, 200, 'Correct password links Google account');
      const data = await res.json() as any;
      assert.ok(data.accessToken, 'Session issued on successful link');
      assert.equal(data.user.id, teacherUser.id);
      teacherAccessToken = data.accessToken;
    }

    // 6. Successful Google authentication now that account is linked
    {
      const res = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: teacherGoogleToken })
      });
      assert.equal(res.status, 200, 'Linked account logs in directly');
      const data = await res.json() as any;
      assert.ok(data.accessToken);
      assert.equal(data.user.id, teacherUser.id);
      assert.equal(data.user.role, 'teacher');
    }

    // 7. Duplicate identities: linking the same Google sub to another account fails with 409
    {
      const otherEmail = `other.${randomUUID()}@school.test`;
      const otherPw = await argon2.hash('other-password-1234', { type: argon2.argon2id });
      const otherUser = (await platformPool.query(
        "INSERT INTO users(email, name, password_hash) VALUES($1, $2, $3) RETURNING id",
        [otherEmail, 'Other User', otherPw]
      )).rows[0];
      createdUsers.push(otherUser.id);

      const res = await call('/api/auth/google/link', {
        method: 'POST',
        body: JSON.stringify({ idToken: teacherGoogleToken, password: 'other-password-1234' })
      });
      assert.equal(res.status, 409, 'Duplicate sub identity rejected with 409 Conflict');
    }

    // 8. Multiple school memberships: returns requireSchoolSelection: true
    {
      // Add teacherUser to schoolB as well
      const teacherRoleB = (await platformPool.query("SELECT id FROM school_roles WHERE school_id=$1 AND code='teacher'", [schoolB.id])).rows[0];
      await platformPool.query(
        "INSERT INTO school_memberships(school_id, user_id, role, school_role_id) VALUES($1, $2, 'teacher', $3)",
        [schoolB.id, teacherUser.id, teacherRoleB.id]
      );

      // Now login without schoolId -> should return requireSchoolSelection
      const res = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: teacherGoogleToken })
      });
      assert.equal(res.status, 200);
      const data = await res.json() as any;
      assert.equal(data.requireSchoolSelection, true, 'Multi-school user prompted for school selection');
      assert.equal(data.schools.length, 2, 'Lists both schools');

      // Login providing specific schoolId
      const selectRes = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: teacherGoogleToken, schoolId: schoolB.id })
      });
      assert.equal(selectRes.status, 200);
      const selectData = await selectRes.json() as any;
      assert.ok(selectData.accessToken);
      assert.equal(selectData.user.schoolId, schoolB.school_id);
    }

    // 9. Suspended school accounts: rejected with 403
    {
      const suspendedEmail = `suspended.${randomUUID()}@school.test`;
      const user = (await platformPool.query(
        "INSERT INTO users(email, name, is_active) VALUES($1, 'Suspended Member', true) RETURNING id",
        [suspendedEmail]
      )).rows[0];
      createdUsers.push(user.id);

      const role = (await platformPool.query("SELECT id FROM school_roles WHERE school_id=$1 AND code='teacher'", [schoolSuspended.id])).rows[0];
      await platformPool.query(
        "INSERT INTO school_memberships(school_id, user_id, role, school_role_id) VALUES($1, $2, 'teacher', $3)",
        [schoolSuspended.id, user.id, role.id]
      );

      const sub = `sub-suspended-${randomUUID()}`;
      await platformPool.query(
        "INSERT INTO external_identities(user_kind, user_id, provider, provider_subject_id, email) VALUES('school', $1, 'google', $2, $3)",
        [user.id, sub, suspendedEmail]
      );

      const token = makeMockToken({ sub, email: suspendedEmail });
      const res = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: token })
      });
      assert.equal(res.status, 403, 'Suspended school member rejected with 403');
    }

    // 10. Suspended user accounts: rejected with 401
    {
      const inactiveEmail = `inactive.${randomUUID()}@school.test`;
      const user = (await platformPool.query(
        "INSERT INTO users(email, name, is_active) VALUES($1, 'Inactive Member', false) RETURNING id",
        [inactiveEmail]
      )).rows[0];
      createdUsers.push(user.id);

      const role = (await platformPool.query("SELECT id FROM school_roles WHERE school_id=$1 AND code='teacher'", [schoolA.id])).rows[0];
      await platformPool.query(
        "INSERT INTO school_memberships(school_id, user_id, role, school_role_id) VALUES($1, $2, 'teacher', $3)",
        [schoolA.id, user.id, role.id]
      );

      const sub = `sub-inactive-${randomUUID()}`;
      await platformPool.query(
        "INSERT INTO external_identities(user_kind, user_id, provider, provider_subject_id, email) VALUES('school', $1, 'google', $2, $3)",
        [user.id, sub, inactiveEmail]
      );

      const token = makeMockToken({ sub, email: inactiveEmail });
      const res = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: token })
      });
      assert.equal(res.status, 401, 'Inactive user rejected with 401');
    }

    // 11. Invitation-based account activation with Google
    {
      const invitedEmail = `invited.${randomUUID()}@school.test`;
      const role = (await platformPool.query("SELECT id FROM school_roles WHERE school_id=$1 AND code='teacher'", [schoolA.id])).rows[0];
      await platformPool.query(
        `INSERT INTO invitations(school_id, email, name, role, school_role_id, token_hash, expires_at)
         VALUES($1, $2, 'Invited Teacher', 'teacher', $3, $4, now() + interval '3 days')`,
        [schoolA.id, invitedEmail, role.id, `hash-${randomUUID()}`]
      );

      const token = makeMockToken({ email: invitedEmail, name: 'Invited Teacher' });
      const res = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: token })
      });
      assert.equal(res.status, 200, 'Invitation activated via Google');
      const data = await res.json() as any;
      assert.ok(data.accessToken);
      assert.equal(data.user.role, 'teacher');

      // Verify invitation marked accepted
      const invCheck = await platformPool.query('SELECT accepted_at FROM invitations WHERE lower(email)=lower($1)', [invitedEmail]);
      assert.ok(invCheck.rows[0].accepted_at, 'Invitation marked accepted');
    }

    // 12. Account unlinking security rules
    {
      // teacherUser has password, so can unlink Google
      const unlinkRes = await call('/api/auth/external-identities/google', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${teacherAccessToken}` }
      });
      assert.equal(unlinkRes.status, 200, 'User with password can unlink Google');

      // Now create a user with NO password and only Google
      const noPwEmail = `nopw.${randomUUID()}@school.test`;
      const noPwUser = (await platformPool.query(
        "INSERT INTO users(email, name, password_hash) VALUES($1, 'No Pw User', NULL) RETURNING id",
        [noPwEmail]
      )).rows[0];
      createdUsers.push(noPwUser.id);
      const role = (await platformPool.query("SELECT id FROM school_roles WHERE school_id=$1 AND code='student'", [schoolA.id])).rows[0];
      await platformPool.query(
        "INSERT INTO school_memberships(school_id, user_id, role, school_role_id) VALUES($1, $2, 'student', $3)",
        [schoolA.id, noPwUser.id, role.id]
      );
      const sub = `sub-nopw-${randomUUID()}`;
      await platformPool.query(
        "INSERT INTO external_identities(user_kind, user_id, provider, provider_subject_id, email) VALUES('school', $1, 'google', $2, $3)",
        [noPwUser.id, sub, noPwEmail]
      );

      const loginRes = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: makeMockToken({ sub, email: noPwEmail }) })
      });
      const loginData = await loginRes.json() as any;

      // Try to unlink Google when it is the only login method
      const cantUnlinkRes = await call('/api/auth/external-identities/google', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${loginData.accessToken}` }
      });
      assert.equal(cantUnlinkRes.status, 400, 'Cannot unlink only login method');
    }

    // 13. Logout and session revocation
    {
      const logoutRes = await call('/api/auth/logout', { method: 'POST' });
      assert.equal(logoutRes.status, 204, 'Logout returns 204');
    }

    // 14. Verification that un-injected mock tokens are strictly rejected
    {
      resetGoogleTokenVerifier();
      const mockToken = makeMockToken({ email: 'hacker@attacker.test' });
      const res = await call('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: mockToken })
      });
      assert.equal(res.status, 401, 'Mock token rejected when verifier is reset');
    }

  } finally {
    server.close();
    await socket.stop();
  }
});
