import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { env } from '../config.js';
import { pool, platformPool, tenantTransaction } from '../db/pool.js';
import { asyncRoute, fail } from '../http.js';
import { authenticate } from '../middleware/auth.js';
import { hashRefresh, newRefreshSecret, readAccess, signAccess } from './tokens.js';
import { verifyGoogleIdToken } from './google.js';
import { revokeFirebaseSessions, verifyFirebaseIdToken } from './firebase-admin.js';

export const authRouter = Router();
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200), schoolId: z.string().optional() });
const inviteSchema = z.object({ token: z.string().min(32), password: z.string().min(12).max(200), name: z.string().trim().min(2).max(160) });
const registerSchoolSchema = z.object({
  schoolName: z.string().trim().min(2, 'School name must be at least 2 characters').max(180),
  administratorName: z.string().trim().min(2, 'Administrator name must be at least 2 characters').max(160),
  email: z.string().email('Please enter a valid email address').max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  phone: z.string().trim().max(40).optional(),
  schoolType: z.string().trim().max(80).optional(),
});
const googleAuthSchema = z.object({
  idToken: z.string().optional(),
  credential: z.string().optional(),
  schoolId: z.string().optional(),
  invitationToken: z.string().optional(),
}).refine(data => Boolean(data.idToken || data.credential), {
  message: 'Google ID token (idToken or credential) is required',
});
const googleLinkSchema = z.object({
  idToken: z.string().optional(),
  credential: z.string().optional(),
  password: z.string().optional(),
  schoolId: z.string().optional(),
}).refine(data => Boolean(data.idToken || data.credential), {
  message: 'Google ID token is required',
});
const selectSchoolSchema = z.object({
  schoolId: z.string().min(1, 'School ID is required'),
});
const cookieName = 'educonnect_refresh';
authRouter.get('/me',authenticate,asyncRoute(async(req,res)=>{
  const identity=req.identity!;
  if(identity.kind==='platform'){
    const result=await platformPool.query('SELECT u.id,u.name,r.name AS role FROM platform_users u JOIN platform_roles r ON r.id=u.role_id WHERE u.id=$1 AND u.is_active',[identity.id]);
    if(!result.rows[0])fail(401,'Account is inactive');
    res.json({user:{id:identity.id,name:result.rows[0].name,role:result.rows[0].role}});return;
  }
  const result=await tenantTransaction(identity.schoolId!,client=>client.query(`SELECT u.id,u.name,m.role,s.school_id,sr.id AS school_role_id,sr.code AS school_role,sr.name AS school_role_name FROM users u JOIN school_memberships m ON m.user_id=u.id JOIN school_roles sr ON sr.school_id=m.school_id AND sr.id=m.school_role_id JOIN schools s ON s.id=m.school_id WHERE u.id=$1 AND s.id=$2 AND u.is_active AND m.is_active`,[identity.id,identity.schoolId]));
  if(!result.rows[0])fail(401,'Account is inactive');const permissions=await tenantTransaction(identity.schoolId!,client=>client.query('SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2',[identity.schoolId,result.rows[0].school_role_id]));res.json({user:{id:identity.id,name:result.rows[0].name,role:result.rows[0].role,schoolRole:result.rows[0].school_role,schoolRoleName:result.rows[0].school_role_name,schoolId:result.rows[0].school_id,permissions:permissions.rows.map(row=>row.permission_key)}});
}));
function setRefreshCookie(res: import('express').Response, value: string) {
  const sameSite = env.NODE_ENV === 'production' ? 'Strict' : 'Lax';
  res.setHeader('Set-Cookie', `${cookieName}=${value}; HttpOnly; SameSite=${sameSite}; Path=/api/auth; Max-Age=${env.REFRESH_TOKEN_TTL_DAYS * 86400}${env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
function clearRefreshCookie(res: import('express').Response) { res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0${env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
function cookieValue(req: import('express').Request) { return req.header('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1); }
async function issueSession(userKind: 'platform'|'school', userId: string, identity: Parameters<typeof signAccess>[0], res: import('express').Response) {
  const id = crypto.randomUUID(); const secret = newRefreshSecret();
  const values=[id,userKind,userId,identity.schoolId??null,hashRefresh(secret),env.REFRESH_TOKEN_TTL_DAYS];
  if(userKind==='platform')await platformPool.query('INSERT INTO user_sessions(id,user_kind,user_id,school_id,refresh_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+($6 || \' days\')::interval)',values);
  else await tenantTransaction(identity.schoolId!,client=>client.query('INSERT INTO user_sessions(id,user_kind,user_id,school_id,refresh_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+($6 || \' days\')::interval)',values));
  setRefreshCookie(res, `${id}.${secret}`);
  return signAccess(identity);
}

authRouter.post('/platform/login', asyncRoute(async (req,res) => {
  const data = loginSchema.parse(req.body);
  const result = await platformPool.query(`SELECT u.id,u.password_hash,u.is_active,r.name AS role FROM platform_users u JOIN platform_roles r ON r.id=u.role_id WHERE lower(u.email)=lower($1)`, [data.email]);
  const user = result.rows[0];
  if (!user || !user.is_active || !(await argon2.verify(user.password_hash,data.password))) fail(401,'Email or password is incorrect');
  await platformPool.query('UPDATE platform_users SET last_login_at=now() WHERE id=$1',[user.id]);
  const accessToken = await issueSession('platform',user.id,{kind:'platform',id:user.id,role:user.role},res);
  res.json({ accessToken, user:{id:user.id, name:(await platformPool.query('SELECT name FROM platform_users WHERE id=$1',[user.id])).rows[0].name, role:user.role} });
}));

authRouter.post('/school/login', asyncRoute(async (req,res) => {
  const data = loginSchema.parse(req.body);
  let resolvedSchoolId = data.schoolId;
  if (!resolvedSchoolId) {
    const lookup = await platformPool.query(
      `SELECT s.id, s.school_id FROM users u
       JOIN school_memberships m ON m.user_id=u.id
       JOIN schools s ON s.id=m.school_id
       WHERE lower(u.email)=lower($1) AND m.is_active AND s.status='active' AND s.deleted_at IS NULL
       ORDER BY m.created_at DESC LIMIT 1`,
      [data.email]
    );
    if (lookup.rows[0]) {
      resolvedSchoolId = lookup.rows[0].school_id;
    } else {
      fail(400,'School ID is required');
    }
  }
  const school=await platformPool.query("SELECT id FROM schools WHERE school_id=$1 AND status='active' AND deleted_at IS NULL",[resolvedSchoolId]);
  if(!school.rows[0])fail(401,'Email or password is incorrect');
  const user=await tenantTransaction(school.rows[0].id,async(tenantClient)=>{const result=await tenantClient.query(`SELECT u.id,u.name,u.password_hash,m.role,s.id AS tenant_id,sr.id AS school_role_id,sr.code AS school_role FROM users u JOIN school_memberships m ON m.user_id=u.id JOIN school_roles sr ON sr.school_id=m.school_id AND sr.id=m.school_role_id JOIN schools s ON s.id=m.school_id WHERE lower(u.email)=lower($1) AND s.id=$2 AND u.is_active AND m.is_active AND s.status='active' AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.school_id=s.id AND sub.status IN ('active','trialing') AND (sub.expires_at IS NULL OR sub.expires_at>now() OR sub.grace_until>now()))`, [data.email,school.rows[0].id]);return result.rows[0];});
  if (!user || !(await argon2.verify(user.password_hash,data.password))) fail(401,'Email or password is incorrect');
  const permissions=await tenantTransaction(user.tenant_id,client=>client.query('SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2',[user.tenant_id,user.school_role_id]));
  const accessToken = await issueSession('school',user.id,{kind:'school',id:user.id,role:user.role,schoolId:user.tenant_id},res);
  res.json({accessToken,user:{id:user.id,name:user.name,role:user.role,schoolRole:user.school_role,permissions:permissions.rows.map(row=>row.permission_key),schoolId:resolvedSchoolId}});
}));

authRouter.post('/register-school', asyncRoute(async (_req, res) => {
  // SaaS Security Rule: Schools cannot publicly self-register as new tenants.
  // Tenant provisioning is strictly managed by CalmStacks Platform Administrators.
  return res.status(403).json({
    error: 'school_registration_disabled',
    message: 'Public school self-registration is disabled. Please contact the CalmStacks platform team to onboard and provision your school workspace.'
  });
}));

authRouter.post('/google', asyncRoute(async (req, res) => {
  const data = googleAuthSchema.parse(req.body);
  const token = data.idToken || data.credential!;
  let verified;
  try {
    verified = await verifyGoogleIdToken(token);
  } catch (err: any) {
    fail(401, err.message || 'Invalid or expired Google token');
  }

  const client = await platformPool.connect();
  try {
    // 1. Look up existing external identity by provider and sub
    const linkedResult = await client.query(
      `SELECT * FROM external_identities WHERE provider = 'google' AND provider_subject_id = $1`,
      [verified.sub]
    );

    if (linkedResult.rows[0]) {
      const identity = linkedResult.rows[0];
      await client.query('UPDATE external_identities SET last_authenticated_at = now() WHERE id = $1', [identity.id]);

      // If linked to platform user
      if (identity.user_kind === 'platform') {
        const platUser = await client.query(
          `SELECT u.id, u.name, u.is_active, r.name AS role
           FROM platform_users u
           JOIN platform_roles r ON r.id = u.role_id
           WHERE u.id = $1`,
          [identity.user_id]
        );
        if (!platUser.rows[0] || !platUser.rows[0].is_active) fail(401, 'Account is inactive');
        const pu = platUser.rows[0];
        await client.query('UPDATE platform_users SET last_login_at = now() WHERE id = $1', [pu.id]);
        await client.query(
          "INSERT INTO platform_audit_logs(actor_id, action, target_type, target_id, metadata) VALUES($1, 'user.authenticated.google', 'platform_user', $1, $2)",
          [pu.id, JSON.stringify({ provider: 'google', email: verified.email })]
        );
        const accessToken = await issueSession('platform', pu.id, { kind: 'platform', id: pu.id, role: pu.role }, res);
        return res.json({ accessToken, user: { id: pu.id, name: pu.name, role: pu.role } });
      }

      // If linked to school user
      const userResult = await client.query(
        `SELECT id, name, is_active FROM users WHERE id = $1`,
        [identity.user_id]
      );
      if (!userResult.rows[0] || !userResult.rows[0].is_active) fail(401, 'Account is inactive');
      const u = userResult.rows[0];

      // Retrieve all active memberships for this user
      const membershipsResult = await client.query(
        `SELECT m.role, m.school_id, s.school_id AS display_id, s.name AS school_name, s.status AS school_status,
                sr.id AS school_role_id, sr.code AS school_role, sr.name AS school_role_name
         FROM school_memberships m
         JOIN schools s ON s.id = m.school_id
         JOIN school_roles sr ON sr.school_id = m.school_id AND sr.id = m.school_role_id
         WHERE m.user_id = $1 AND m.is_active AND s.deleted_at IS NULL
         ORDER BY m.created_at DESC`,
        [u.id]
      );

      const allMemberships = membershipsResult.rows;
      if (allMemberships.length > 0 && allMemberships.every(m => m.school_status !== 'active')) {
        fail(403, 'School account is suspended or inactive');
      }

      const activeMemberships = allMemberships.filter(m => m.school_status === 'active');
      if (activeMemberships.length === 0) {
        return res.status(403).json({
          error: 'access_denied',
          message: 'No active school membership found for this account.'
        });
      }

      // Multiple schools and no schoolId provided: return school selection interface
      if (activeMemberships.length > 1 && !data.schoolId) {
        return res.json({
          requireSchoolSelection: true,
          user: { id: u.id, name: u.name, email: verified.email },
          schools: activeMemberships.map(m => ({
            id: m.school_id,
            schoolId: m.display_id,
            name: m.school_name,
            role: m.role,
            schoolRole: m.school_role,
            schoolRoleName: m.school_role_name,
          }))
        });
      }

      // Resolve targeted school membership
      let targetMem = activeMemberships[0];
      if (data.schoolId) {
        const found = activeMemberships.find(m => m.school_id === data.schoolId || m.display_id === data.schoolId);
        if (!found) fail(403, 'You do not have active membership in the selected school');
        targetMem = found;
      }

      // Verify school subscription is active
      const sub = await client.query(
        `SELECT 1 FROM subscriptions sub
         WHERE sub.school_id = $1
           AND sub.status IN ('active', 'trialing')
           AND (sub.expires_at IS NULL OR sub.expires_at > now() OR sub.grace_until > now())`,
        [targetMem.school_id]
      );
      if (!sub.rows[0]) fail(403, 'School subscription is inactive or expired');

      const permissions = await client.query(
        'SELECT permission_key FROM school_role_permissions WHERE school_id = $1 AND role_id = $2',
        [targetMem.school_id, targetMem.school_role_id]
      );

      await client.query(
        "INSERT INTO audit_logs(school_id, action, target_type, target_id, metadata) VALUES($1, 'user.authenticated.google', 'user', $2, $3)",
        [targetMem.school_id, u.id, JSON.stringify({ provider: 'google', email: verified.email })]
      );

      const accessToken = await issueSession('school', u.id, {
        kind: 'school',
        id: u.id,
        role: targetMem.role,
        schoolId: targetMem.school_id,
      }, res);

      return res.json({
        accessToken,
        user: {
          id: u.id,
          name: u.name,
          role: targetMem.role,
          schoolRole: targetMem.school_role,
          schoolRoleName: targetMem.school_role_name,
          permissions: permissions.rows.map(r => r.permission_key),
          schoolId: targetMem.display_id,
        }
      });
    }

    // 2. Identity not linked: check if an existing account exists by verified email
    const existingSchoolUser = await client.query(
      'SELECT id, name, is_active FROM users WHERE lower(email) = lower($1)',
      [verified.email]
    );
    const existingPlatformUser = await client.query(
      'SELECT id, name, is_active FROM platform_users WHERE lower(email) = lower($1)',
      [verified.email]
    );

    if (existingSchoolUser.rows[0] || existingPlatformUser.rows[0]) {
      // Security Rule: Never automatically link accounts solely because emails match.
      // Require verification and proof of control of the existing account before linking.
      return res.json({
        requiresLinking: true,
        provider: 'google',
        email: verified.email,
        name: verified.name,
        message: 'An EduConnect account with this email already exists. Please verify your password to link your Google account.'
      });
    }

    // 3. User does not exist: check if there is an active invitation for this email or token
    let invite = null;
    if (data.invitationToken) {
      const tokenHash = createHash('sha256').update(data.invitationToken).digest('hex');
      const invRes = await client.query(
        'SELECT * FROM invitations WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()',
        [tokenHash]
      );
      invite = invRes.rows[0];
    }
    if (!invite) {
      const invRes = await client.query(
        'SELECT * FROM invitations WHERE lower(email) = lower($1) AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1',
        [verified.email]
      );
      invite = invRes.rows[0];
    }

    if (invite) {
      // Activate invitation with Google Identity
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.school_id', $1, true)", [invite.school_id]);
      const schoolRes = await client.query(
        `SELECT s.status, s.school_id AS display_id, r.code AS role_code, r.name AS role_name
         FROM schools s
         JOIN school_roles r ON r.school_id = s.id AND r.id = $2
         WHERE s.id = $1`,
        [invite.school_id, invite.school_role_id]
      );
      if (!schoolRes.rows[0] || !['pending', 'active'].includes(schoolRes.rows[0].status)) {
        await client.query('ROLLBACK');
        fail(403, 'School is not accepting invitations');
      }

      const userInsert = await client.query(
        `INSERT INTO users(email, name, password_hash, is_active)
         VALUES(lower($1), $2, NULL, true)
         ON CONFLICT(email) DO UPDATE SET name = EXCLUDED.name, is_active = true
         RETURNING id, name`,
        [verified.email, verified.name]
      );
      const newUser = userInsert.rows[0];

      await client.query(
        `INSERT INTO external_identities(user_kind, user_id, provider, provider_subject_id, email)
         VALUES('school', $1, 'google', $2, lower($3))
         ON CONFLICT(provider, provider_subject_id) DO UPDATE SET last_authenticated_at = now()`,
        [newUser.id, verified.sub, verified.email]
      );

      await client.query(
        `INSERT INTO school_memberships(school_id, user_id, role, school_role_id, is_active)
         VALUES($1, $2, $3, $4, true)
         ON CONFLICT(school_id, user_id) DO UPDATE SET role = EXCLUDED.role, school_role_id = EXCLUDED.school_role_id, is_active = true`,
        [invite.school_id, newUser.id, invite.role, invite.school_role_id]
      );

      if (invite.role === 'teacher') {
        const employeeId = typeof invite.member_metadata?.employeeId === 'string'
          ? invite.member_metadata.employeeId
          : `EMP-${randomBytes(4).toString('hex').toUpperCase()}`;
        await client.query(
          "INSERT INTO teachers(school_id, user_id, employee_id, employment_status) VALUES($1, $2, $3, 'active') ON CONFLICT(school_id, employee_id) DO UPDATE SET user_id = EXCLUDED.user_id, employment_status = 'active'",
          [invite.school_id, newUser.id, employeeId]
        );
      } else if (invite.role === 'parent') {
        const parent = await client.query(
          'INSERT INTO parents(school_id, user_id) VALUES($1, $2) ON CONFLICT(school_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING id',
          [invite.school_id, newUser.id]
        );
        const studentIds = Array.isArray(invite.member_metadata?.studentIds)
          ? invite.member_metadata.studentIds.filter((v: unknown): v is string => typeof v === 'string')
          : [];
        for (const studentId of studentIds) {
          await client.query('INSERT INTO student_parents(school_id, student_id, parent_id) VALUES($1, $2, $3) ON CONFLICT DO NOTHING', [invite.school_id, studentId, parent.rows[0].id]);
        }
      } else if (invite.role === 'student') {
        const studentId = typeof invite.member_metadata?.studentId === 'string' ? invite.member_metadata.studentId : null;
        if (studentId) {
          await client.query('UPDATE students SET user_id = $3 WHERE school_id = $1 AND id = $2', [invite.school_id, studentId, newUser.id]);
        }
      }

      await client.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [invite.id]);
      await client.query("UPDATE schools SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'pending'", [invite.school_id]);
      await client.query(
        "INSERT INTO audit_logs(school_id, action, target_type, target_id, metadata) VALUES($1, 'invitation.accepted.google', 'user', $2, $3)",
        [invite.school_id, newUser.id, JSON.stringify({ provider: 'google', email: verified.email })]
      );
      await client.query('COMMIT');

      const permissions = await client.query(
        'SELECT permission_key FROM school_role_permissions WHERE school_id = $1 AND role_id = $2',
        [invite.school_id, invite.school_role_id]
      );

      const accessToken = await issueSession('school', newUser.id, {
        kind: 'school',
        id: newUser.id,
        role: invite.role,
        schoolId: invite.school_id,
      }, res);

      return res.json({
        accessToken,
        user: {
          id: newUser.id,
          name: newUser.name,
          role: invite.role,
          schoolRole: schoolRes.rows[0].role_code,
          schoolRoleName: schoolRes.rows[0].role_name,
          permissions: permissions.rows.map(r => r.permission_key),
          schoolId: schoolRes.rows[0].display_id,
        }
      });
    }

    // 4. No account and no valid invitation: Never provide public school registration through Google Sign-In.
    return res.status(403).json({
      error: 'access_denied',
      message: 'No EduConnect account found for this Google email. Access requires an existing account or an active invitation from your school.'
    });
  } finally {
    client.release();
  }
}));

const handleGoogleLink = async (req: import('express').Request, res: import('express').Response) => {
  const data = googleLinkSchema.parse(req.body);
  const token = data.idToken || data.credential!;
  let verified;
  try {
    verified = await verifyGoogleIdToken(token);
  } catch (err: any) {
    fail(401, err.message || 'Invalid or expired Google token');
  }

  const client = await platformPool.connect();
  try {
    // 1. Check if this Google sub is already linked to another account
    const existingIdentity = await client.query(
      'SELECT user_kind, user_id FROM external_identities WHERE provider = $1 AND provider_subject_id = $2',
      ['google', verified.sub]
    );

    // Check if user is authenticated via Bearer token
    const authHeader = req.header('authorization');
    let authenticatedUser: { id: string; kind: 'platform' | 'school' } | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const parsed = await readAccess(authHeader.slice(7));
        authenticatedUser = { id: parsed.id, kind: parsed.kind };
      } catch {}
    }

    if (existingIdentity.rows[0]) {
      const row = existingIdentity.rows[0];
      if (authenticatedUser && row.user_id === authenticatedUser.id && row.user_kind === authenticatedUser.kind) {
        return res.json({ success: true, message: 'Google account is already linked to your account' });
      }
      fail(409, 'This Google identity is already linked to another account');
    }

    // If authenticated: link directly to current user
    if (authenticatedUser) {
      await client.query(
        `INSERT INTO external_identities(user_kind, user_id, provider, provider_subject_id, email)
         VALUES($1, $2, 'google', $3, lower($4))
         ON CONFLICT(user_kind, user_id, provider) DO UPDATE SET provider_subject_id = EXCLUDED.provider_subject_id, email = EXCLUDED.email, last_authenticated_at = now()`,
        [authenticatedUser.kind, authenticatedUser.id, verified.sub, verified.email]
      );
      return res.json({
        success: true,
        message: 'Google account linked successfully',
        identity: { provider: 'google', email: verified.email, linkedAt: new Date() }
      });
    }

    // If unauthenticated: proof of control (password) is strictly required
    if (!data.password) {
      fail(400, 'Password is required to verify ownership before linking account');
    }

    // Find account by verified Google email
    const schoolUser = await client.query(
      'SELECT id, name, password_hash, is_active FROM users WHERE lower(email) = lower($1)',
      [verified.email]
    );
    const platformUser = await client.query(
      'SELECT id, name, password_hash, is_active FROM platform_users WHERE lower(email) = lower($1)',
      [verified.email]
    );

    const user = schoolUser.rows[0] || platformUser.rows[0];
    const userKind = platformUser.rows[0] ? 'platform' : 'school';

    if (!user || !user.is_active) {
      fail(404, 'No active account found for this email');
    }

    if (!user.password_hash || !(await argon2.verify(user.password_hash, data.password))) {
      fail(401, 'Password verification failed. Incorrect password.');
    }

    // Link Google external identity
    await client.query(
      `INSERT INTO external_identities(user_kind, user_id, provider, provider_subject_id, email)
       VALUES($1, $2, 'google', $3, lower($4))
       ON CONFLICT(user_kind, user_id, provider) DO UPDATE SET provider_subject_id = EXCLUDED.provider_subject_id, email = EXCLUDED.email, last_authenticated_at = now()`,
      [userKind, user.id, verified.sub, verified.email]
    );

    // Issue session for the newly linked user
    if (userKind === 'platform') {
      const roleRow = await client.query('SELECT r.name FROM platform_roles r JOIN platform_users u ON u.role_id = r.id WHERE u.id = $1', [user.id]);
      const role = roleRow.rows[0]?.name || 'super_admin';
      const accessToken = await issueSession('platform', user.id, { kind: 'platform', id: user.id, role }, res);
      return res.json({
        accessToken,
        user: { id: user.id, name: user.name, role },
        message: 'Google account linked successfully'
      });
    }

    // For school user: resolve active membership
    const memberships = await client.query(
      `SELECT m.role, m.school_id, s.school_id AS display_id, s.name AS school_name,
              sr.id AS school_role_id, sr.code AS school_role, sr.name AS school_role_name
       FROM school_memberships m
       JOIN schools s ON s.id = m.school_id
       JOIN school_roles sr ON sr.school_id = m.school_id AND sr.id = m.school_role_id
       WHERE m.user_id = $1 AND m.is_active AND s.status = 'active' AND s.deleted_at IS NULL
       ORDER BY m.created_at DESC`,
      [user.id]
    );

    if (memberships.rows.length === 0) {
      fail(403, 'Account has no active school memberships');
    }

    const targetMem = (data.schoolId && memberships.rows.find(m => m.school_id === data.schoolId || m.display_id === data.schoolId)) || memberships.rows[0];
    const permissions = await client.query(
      'SELECT permission_key FROM school_role_permissions WHERE school_id = $1 AND role_id = $2',
      [targetMem.school_id, targetMem.school_role_id]
    );

    const accessToken = await issueSession('school', user.id, {
      kind: 'school',
      id: user.id,
      role: targetMem.role,
      schoolId: targetMem.school_id,
    }, res);

    return res.json({
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        role: targetMem.role,
        schoolRole: targetMem.school_role,
        schoolRoleName: targetMem.school_role_name,
        permissions: permissions.rows.map(r => r.permission_key),
        schoolId: targetMem.display_id,
      },
      message: 'Google account linked successfully'
    });
  } finally {
    client.release();
  }
};

authRouter.post('/google/link', asyncRoute(handleGoogleLink));

// Migration-safe account claim: requires an existing EduConnect authenticated session
// and a separately verified, email-verified Firebase identity. Email alone never links accounts.
authRouter.post('/firebase/link', asyncRoute(async(req,res)=>{
  const firebaseToken=req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const legacyToken=req.header('x-educonnect-legacy-token');
  if(!firebaseToken||!legacyToken)fail(401,'Both Firebase authentication and an existing EduConnect session are required');
  const [firebaseUser,legacyIdentity]=await Promise.all([verifyFirebaseIdToken(firebaseToken),readAccess(legacyToken)]);
  if(!firebaseUser.email_verified||!firebaseUser.email)fail(403,'Verify the Firebase email address before linking');
  let accountEmail:string|undefined;
  if(legacyIdentity.kind==='platform'){
    const account=await platformPool.query('SELECT email,is_active FROM platform_users WHERE id=$1',[legacyIdentity.id]);
    if(!account.rows[0]?.is_active)fail(403,'Existing account is inactive');accountEmail=account.rows[0].email;
  }else if(legacyIdentity.schoolId){
    const account=await tenantTransaction(legacyIdentity.schoolId,client=>client.query(`SELECT u.email,u.is_active FROM users u JOIN school_memberships m ON m.user_id=u.id AND m.school_id=$2 AND m.is_active WHERE u.id=$1`,[legacyIdentity.id,legacyIdentity.schoolId]));
    if(!account.rows[0]?.is_active)fail(403,'Existing school account is inactive');accountEmail=account.rows[0].email;
  }
  if(!accountEmail||accountEmail.toLowerCase()!==firebaseUser.email.toLowerCase())fail(403,'Firebase email must match the authenticated EduConnect account to claim it');
  const already=await platformPool.query('SELECT user_kind,user_id FROM external_identities WHERE provider=$1 AND provider_subject_id=$2',['firebase',firebaseUser.uid]);
  if(already.rows[0]&&(already.rows[0].user_kind!==legacyIdentity.kind||already.rows[0].user_id!==legacyIdentity.id))fail(409,'Firebase identity is already linked to a different EduConnect account');
  if(legacyIdentity.kind==='platform'){
    await platformPool.query(`INSERT INTO external_identities(user_kind,user_id,provider,provider_subject_id,email) VALUES('platform',$1,'firebase',$2,lower($3)) ON CONFLICT(user_kind,user_id,provider) DO UPDATE SET provider_subject_id=EXCLUDED.provider_subject_id,email=EXCLUDED.email,last_authenticated_at=now()`,[legacyIdentity.id,firebaseUser.uid,firebaseUser.email]);
    await platformPool.query(`INSERT INTO platform_audit_logs(actor_id,action,target_type,target_id,metadata) VALUES($1,'auth.firebase_linked','platform_user',$1,$2::jsonb)`,[legacyIdentity.id,JSON.stringify({email:firebaseUser.email})]);
  } else {
    await tenantTransaction(legacyIdentity.schoolId!,async client=>{
      await client.query(`INSERT INTO external_identities(user_kind,user_id,provider,provider_subject_id,email) VALUES('school',$1,'firebase',$2,lower($3)) ON CONFLICT(user_kind,user_id,provider) DO UPDATE SET provider_subject_id=EXCLUDED.provider_subject_id,email=EXCLUDED.email,last_authenticated_at=now()`,[legacyIdentity.id,firebaseUser.uid,firebaseUser.email]);
      await client.query(`INSERT INTO audit_logs(school_id,action,target_type,target_id,metadata) VALUES($1,'auth.firebase_linked','user',$2,$3::jsonb)`,[legacyIdentity.schoolId,legacyIdentity.id,JSON.stringify({email:firebaseUser.email})]);
    });
  }
  res.status(201).json({linked:true});
}));

authRouter.post('/firebase/logout',asyncRoute(async(req,res)=>{
  const token=req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!token)fail(401,'Firebase authentication required');
  const user=await verifyFirebaseIdToken(token);await revokeFirebaseSessions(user.uid);res.status(204).end();
}));

authRouter.get('/firebase/context',asyncRoute(async(req,res)=>{
  const token=req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!token)fail(401,'Firebase authentication required');
  const firebaseUser=await verifyFirebaseIdToken(token);if(firebaseUser.email&&!firebaseUser.email_verified)fail(403,'Verify your email address');
  const mapping=await platformPool.query<{user_kind:'platform'|'school';user_id:string}>(`SELECT user_kind,user_id FROM external_identities WHERE provider='firebase' AND provider_subject_id=$1`,[firebaseUser.uid]);
  if(!mapping.rows[0])fail(403,'Firebase account is not linked; sign in with the existing EduConnect account to securely link it');
  if(mapping.rows[0].user_kind==='platform'){
    const user=await platformPool.query(`SELECT u.id,u.name,r.name AS role FROM platform_users u JOIN platform_roles r ON r.id=u.role_id WHERE u.id=$1 AND u.is_active`,[mapping.rows[0].user_id]);
    if(!user.rows[0])fail(403,'Platform account is inactive');return res.json({user:user.rows[0],schools:[]});
  }
  const memberships=await platformPool.query(`SELECT s.school_id,s.name,m.role,r.code AS school_role,r.name AS school_role_name FROM users u JOIN school_memberships m ON m.user_id=u.id AND m.is_active JOIN schools s ON s.id=m.school_id AND s.status='active' AND s.deleted_at IS NULL JOIN school_roles r ON r.school_id=m.school_id AND r.id=m.school_role_id WHERE u.id=$1 AND u.is_active AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.school_id=s.id AND sub.status IN ('active','trialing') AND (sub.expires_at IS NULL OR sub.expires_at>now() OR sub.grace_until>now())) ORDER BY s.name`,[mapping.rows[0].user_id]);
  if(!memberships.rows.length)fail(403,'No active EduConnect school memberships');
  res.json({user:{id:mapping.rows[0].user_id,name:memberships.rows[0].name},schools:memberships.rows});
}));
authRouter.post('/external-identities/link', asyncRoute(handleGoogleLink));

authRouter.get('/external-identities', authenticate, asyncRoute(async (req, res) => {
  const identity = req.identity!;
  const identities = await platformPool.query(
    `SELECT provider, provider_subject_id, email, created_at, last_authenticated_at
     FROM external_identities
     WHERE user_kind = $1 AND user_id = $2
     ORDER BY created_at ASC`,
    [identity.kind, identity.id]
  );

  let hasPassword = false;
  if (identity.kind === 'platform') {
    const p = await platformPool.query('SELECT password_hash FROM platform_users WHERE id = $1', [identity.id]);
    hasPassword = Boolean(p.rows[0]?.password_hash && p.rows[0].password_hash.length > 0);
  } else {
    const u = await platformPool.query('SELECT password_hash FROM users WHERE id = $1', [identity.id]);
    hasPassword = Boolean(u.rows[0]?.password_hash && u.rows[0].password_hash.length > 0);
  }

  const canUnlink = hasPassword || identities.rows.length > 1;

  res.json({
    identities: identities.rows,
    hasPassword,
    canUnlink,
  });
}));

authRouter.delete('/external-identities/:provider', authenticate, asyncRoute(async (req, res) => {
  const identity = req.identity!;
  const provider = req.params.provider;

  let hasPassword = false;
  if (identity.kind === 'platform') {
    const p = await platformPool.query('SELECT password_hash FROM platform_users WHERE id = $1', [identity.id]);
    hasPassword = Boolean(p.rows[0]?.password_hash && p.rows[0].password_hash.length > 0);
  } else {
    const u = await platformPool.query('SELECT password_hash FROM users WHERE id = $1', [identity.id]);
    hasPassword = Boolean(u.rows[0]?.password_hash && u.rows[0].password_hash.length > 0);
  }

  const allIdentities = await platformPool.query(
    'SELECT id FROM external_identities WHERE user_kind = $1 AND user_id = $2',
    [identity.kind, identity.id]
  );

  // Security Rule: Allow users to unlink Google only if another valid login method remains.
  if (!hasPassword && allIdentities.rows.length <= 1) {
    fail(400, 'Cannot unlink the only login method. Please set an account password first.');
  }

  const deleted = await platformPool.query(
    'DELETE FROM external_identities WHERE user_kind = $1 AND user_id = $2 AND provider = $3 RETURNING id',
    [identity.kind, identity.id, provider]
  );

  if (deleted.rowCount === 0) {
    fail(404, `No linked ${provider} identity found`);
  }

  res.json({ success: true, message: `${provider} unlinked successfully` });
}));

authRouter.post('/select-school', authenticate, asyncRoute(async (req, res) => {
  const identity = req.identity!;
  if (identity.kind !== 'school') {
    fail(400, 'School selection is only applicable to school users');
  }

  const data = selectSchoolSchema.parse(req.body);
  const memberships = await platformPool.query(
    `SELECT m.role, m.school_id, s.school_id AS display_id, s.name AS school_name,
            sr.id AS school_role_id, sr.code AS school_role, sr.name AS school_role_name
     FROM school_memberships m
     JOIN schools s ON s.id = m.school_id
     JOIN school_roles sr ON sr.school_id = m.school_id AND sr.id = m.school_role_id
     WHERE m.user_id = $1 AND (s.id::text = $2 OR s.school_id = $2) AND m.is_active AND s.status = 'active' AND s.deleted_at IS NULL`,
    [identity.id, data.schoolId]
  );

  if (!memberships.rows[0]) {
    fail(403, 'You do not have an active membership in the selected school');
  }

  const targetMem = memberships.rows[0];
  const sub = await platformPool.query(
    `SELECT 1 FROM subscriptions sub
     WHERE sub.school_id = $1
       AND sub.status IN ('active', 'trialing')
       AND (sub.expires_at IS NULL OR sub.expires_at > now() OR sub.grace_until > now())`,
    [targetMem.school_id]
  );
  if (!sub.rows[0]) fail(403, 'School subscription is inactive or expired');

  const permissions = await platformPool.query(
    'SELECT permission_key FROM school_role_permissions WHERE school_id = $1 AND role_id = $2',
    [targetMem.school_id, targetMem.school_role_id]
  );

  const accessToken = await issueSession('school', identity.id, {
    kind: 'school',
    id: identity.id,
    role: targetMem.role,
    schoolId: targetMem.school_id,
  }, res);

  res.json({
    accessToken,
    user: {
      id: identity.id,
      name: (await platformPool.query('SELECT name FROM users WHERE id = $1', [identity.id])).rows[0]?.name || '',
      role: targetMem.role,
      schoolRole: targetMem.school_role,
      schoolRoleName: targetMem.school_role_name,
      permissions: permissions.rows.map(r => r.permission_key),
      schoolId: targetMem.display_id,
    }
  });
}));

authRouter.post('/refresh', asyncRoute(async (req,res) => {
  const raw = cookieValue(req); if (!raw) fail(401,'Refresh session is required');
  const [id,secret] = raw.split('.'); if (!id || !secret) fail(401,'Invalid refresh session');
  const client = await platformPool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(`SELECT s.*,CASE WHEN s.user_kind='platform' THEN p.is_active ELSE u.is_active END AS active, r.name AS platform_role FROM user_sessions s LEFT JOIN platform_users p ON s.user_kind='platform' AND p.id=s.user_id LEFT JOIN platform_roles r ON r.id=p.role_id LEFT JOIN users u ON s.user_kind='school' AND u.id=s.user_id WHERE s.id=$1 FOR UPDATE OF s`,[id]);
    const session = found.rows[0];
    if (!session || !session.active || session.revoked_at || new Date(session.expires_at)<=new Date() || session.refresh_token_hash!==hashRefresh(secret)) fail(401,'Refresh session is expired or revoked');
    let schoolId: string|undefined,role:string=session.platform_role;
    if (session.user_kind==='school') {
      const membership = await client.query(
        `SELECT m.role 
         FROM school_memberships m 
         JOIN schools s ON s.id=m.school_id 
         WHERE m.user_id=$1 AND m.school_id=$2 AND m.is_active AND s.status='active' 
           AND EXISTS(
             SELECT 1 FROM subscriptions sub 
             WHERE sub.school_id=s.id 
               AND sub.status IN ('active','trialing') 
               AND (sub.expires_at IS NULL OR sub.expires_at>now() OR sub.grace_until>now())
           )`,
        [session.user_id, session.school_id]
      );
      if (!membership.rows[0]) fail(401,'School access is unavailable');
      schoolId = session.school_id;
      role = membership.rows[0].role;
    }
    const nextId=crypto.randomUUID(), nextSecret=newRefreshSecret();
    await client.query('INSERT INTO user_sessions(id,user_kind,user_id,school_id,refresh_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+($6 || \' days\')::interval)',[nextId,session.user_kind,session.user_id,session.school_id,hashRefresh(nextSecret),env.REFRESH_TOKEN_TTL_DAYS]);
    await client.query('UPDATE user_sessions SET revoked_at=now(),replaced_by=$2,last_used_at=now() WHERE id=$1',[id,nextId]);
    await client.query('COMMIT');
    setRefreshCookie(res,`${nextId}.${nextSecret}`);
    res.json({accessToken:await signAccess({kind:session.user_kind,id:session.user_id,role,...(schoolId?{schoolId}:{})})});
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}));

authRouter.post('/logout', asyncRoute(async (req,res) => {
  const raw=cookieValue(req); const [id,secret]=raw?.split('.')||[]; if(id&&secret) await platformPool.query('UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND refresh_token_hash=$2',[id,hashRefresh(secret)]);
  clearRefreshCookie(res); res.status(204).end();
}));

authRouter.post('/accept-invitation', asyncRoute(async(req,res)=>{
  const data=inviteSchema.parse(req.body); const tokenHash=createHash('sha256').update(data.token).digest('hex');
  const client=await platformPool.connect();
  try {
    await client.query('BEGIN');
    const found=await client.query("SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE",[tokenHash]);
    const invite=found.rows[0]; if(!invite || invite.accepted_at || new Date(invite.expires_at)<=new Date()) fail(400,'Invitation is invalid or expired');
    await client.query("SELECT set_config('app.school_id',$1,true)",[invite.school_id]);
    const tenant=await client.query('SELECT s.status,s.school_id AS display_id,r.code AS role_code,r.name AS role_name FROM schools s JOIN school_roles r ON r.school_id=s.id AND r.id=$2 WHERE s.id=$1',[invite.school_id,invite.school_role_id]);
    const permissions=await client.query('SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2',[invite.school_id,invite.school_role_id]);
    if(!tenant.rows[0] || !['pending','active'].includes(tenant.rows[0].status))fail(403,'School is not accepting invitations');
    const passwordHash=await argon2.hash(data.password,{type:argon2.argon2id});
    const result=await client.query(`INSERT INTO users(email,name,password_hash) VALUES(lower($1),$2,$3) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,is_active=true RETURNING id,name`,[invite.email,data.name,passwordHash]);
    const user=result.rows[0];
    await client.query('INSERT INTO school_memberships(school_id,user_id,role,school_role_id) VALUES($1,$2,$3,$4) ON CONFLICT(school_id,user_id) DO UPDATE SET role=EXCLUDED.role,school_role_id=EXCLUDED.school_role_id,is_active=true',[invite.school_id,user.id,invite.role,invite.school_role_id]);
    if(invite.role==='teacher'){
      const employeeId=typeof invite.member_metadata?.employeeId==='string'?invite.member_metadata.employeeId:`EMP-${randomBytes(4).toString('hex').toUpperCase()}`;
      await client.query("INSERT INTO teachers(school_id,user_id,employee_id,employment_status) VALUES($1,$2,$3,'active') ON CONFLICT(school_id,employee_id) DO UPDATE SET user_id=EXCLUDED.user_id,employment_status='active'",[invite.school_id,user.id,employeeId]);
    }
    if(invite.role==='parent'){
      const parent=await client.query('INSERT INTO parents(school_id,user_id) VALUES($1,$2) ON CONFLICT(school_id,user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id',[invite.school_id,user.id]);
      const studentIds=Array.isArray(invite.member_metadata?.studentIds)?invite.member_metadata.studentIds.filter((value:unknown):value is string=>typeof value==='string'):[];
      if(studentIds.length){const valid=await client.query('SELECT id FROM students WHERE school_id=$1 AND id=ANY($2::uuid[])',[invite.school_id,studentIds]);if(valid.rowCount!==new Set(studentIds).size)fail(400,'One or more linked students are unavailable');for(const studentId of studentIds)await client.query('INSERT INTO student_parents(school_id,student_id,parent_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[invite.school_id,studentId,parent.rows[0].id]);}
    }
    if(invite.role==='student'){
      const studentId=typeof invite.member_metadata?.studentId==='string'?invite.member_metadata.studentId:null;if(!studentId)fail(400,'Student invitation is missing a student record');
      const student=await client.query('UPDATE students SET user_id=$3 WHERE school_id=$1 AND id=$2 AND (user_id IS NULL OR user_id=$3) RETURNING id',[invite.school_id,studentId,user.id]);if(!student.rowCount)fail(400,'Student record is unavailable or already linked');
    }
    await client.query('UPDATE invitations SET accepted_at=now() WHERE id=$1',[invite.id]);
    await client.query("UPDATE schools SET status='active',updated_at=now() WHERE id=$1 AND status='pending'",[invite.school_id]);
    await client.query("INSERT INTO audit_logs(school_id,action,target_type,target_id,metadata) VALUES($1,'invitation.accepted','user',$2,'{}')",[invite.school_id,user.id]);
    await client.query('COMMIT');
    const accessToken=await issueSession('school',user.id,{kind:'school',id:user.id,role:invite.role,schoolId:invite.school_id},res);
    res.status(201).json({accessToken,user:{id:user.id,name:user.name,email:invite.email,role:invite.role,schoolRole:tenant.rows[0].role_code,schoolRoleName:tenant.rows[0].role_name,permissions:permissions.rows.map(row=>row.permission_key),schoolId:tenant.rows[0].display_id}});
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}));

export async function sendInvitation(email:string,schoolName:string,token:string) {
  const url=new URL(env.INVITATION_BASE_URL); url.searchParams.set('token',token);
  if(!env.SMTP_HOST) { if(env.NODE_ENV==='production') throw new Error('SMTP_HOST must be configured to send school invitations'); if(process.env.NODE_ENV!=='test')console.info(`Development invitation for ${email} (${schoolName}): ${url}`); return; }
  const transport=nodemailer.createTransport({host:env.SMTP_HOST,port:env.SMTP_PORT||587,secure:(env.SMTP_PORT||587)===465,auth:env.SMTP_USER?{user:env.SMTP_USER,pass:env.SMTP_PASSWORD}:undefined});
  await transport.sendMail({from:env.SMTP_FROM,to:email,subject:`School administrator invitation: ${schoolName}`,text:`You have been invited to administer ${schoolName}. Accept your invitation: ${url}`});
}
export async function sendAccountRecovery(email:string,token:string){const url=new URL(env.RECOVERY_BASE_URL);url.searchParams.set('token',token);if(!env.SMTP_HOST){if(env.NODE_ENV==='production')throw new Error('SMTP_HOST must be configured for account recovery');if(process.env.NODE_ENV!=='test')console.info(`Development account recovery link for ${email}: ${url}`);return;}const transport=nodemailer.createTransport({host:env.SMTP_HOST,port:env.SMTP_PORT||587,secure:(env.SMTP_PORT||587)===465,auth:env.SMTP_USER?{user:env.SMTP_USER,pass:env.SMTP_PASSWORD}:undefined});await transport.sendMail({from:env.SMTP_FROM,to:email,subject:'EduConnect account recovery',text:`Use this one-time link to reset your password. It expires in 30 minutes: ${url}`});}

authRouter.post('/recovery/request',asyncRoute(async(req,res)=>{
  const data=z.object({kind:z.enum(['platform','school']),email:z.email().max(254),schoolId:z.string().min(1).max(40).optional()}).parse(req.body);
  if(data.kind==='platform'&&data.schoolId)fail(400,'School ID is not used for platform recovery');
  let account:{id:string;email:string;schoolId?:string}|undefined;
  let schoolRow:{id:string;school_id:string;name:string}|undefined;

  if(data.kind==='platform'){
    const found=await platformPool.query('SELECT id,email FROM platform_users WHERE lower(email)=lower($1) AND is_active',[data.email]);
    if(found.rows[0])account={id:found.rows[0].id,email:found.rows[0].email};
  } else {
    // 1. If schoolId was provided, attempt direct match
    if(data.schoolId){
      const school=await platformPool.query("SELECT id,school_id,name FROM schools WHERE (school_id=$1 OR id::text=$1) AND status='active' AND deleted_at IS NULL",[data.schoolId]);
      if(school.rows[0]){
        schoolRow=school.rows[0];
        const found=await platformPool.query(
          `SELECT u.id, u.email 
           FROM users u 
           JOIN school_memberships m ON m.user_id=u.id 
           WHERE m.school_id=$1 AND lower(u.email)=lower($2) AND u.is_active AND m.is_active 
           LIMIT 1`,
          [school.rows[0].id, data.email]
        );
        if(found.rows[0])account={id:found.rows[0].id,email:found.rows[0].email,schoolId:school.rows[0].id};
      }
    }

    // 2. Fallback / Auto-resolution: If schoolId was omitted or wrong (e.g. CS-SCH-0001 demo leftover),
    // search for the user's active membership across schools by email
    if(!account){
      const userLookup = await platformPool.query(
        `SELECT u.id, u.email, m.school_id, s.school_id AS display_id, s.name AS school_name
         FROM users u
         JOIN school_memberships m ON m.user_id = u.id AND m.is_active
         JOIN schools s ON s.id = m.school_id AND s.status = 'active' AND s.deleted_at IS NULL
         WHERE lower(u.email) = lower($1) AND u.is_active
         ORDER BY m.created_at DESC
         LIMIT 1`,
        [data.email]
      );
      if(userLookup.rows[0]){
        const row = userLookup.rows[0];
        account = { id: row.id, email: row.email, schoolId: row.school_id };
        schoolRow = { id: row.school_id, school_id: row.display_id, name: row.school_name };
      }
    }
  }

  // If no active user found, check if an unaccepted invitation exists for this email
  if(!account && schoolRow){
    const pendingInvite = await platformPool.query(
      "SELECT id, email, role FROM invitations WHERE school_id=$1 AND lower(email)=lower($2) AND accepted_at IS NULL",
      [schoolRow.id, data.email]
    );
    if(pendingInvite.rows[0]){
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      await platformPool.query(
        "UPDATE invitations SET token_hash=$1, expires_at=now()+interval '72 hours' WHERE id=$2",
        [tokenHash, pendingInvite.rows[0].id]
      );
      const inviteUrl = `${env.INVITATION_BASE_URL}?token=${rawToken}`;
      console.info(`[Auth] Pending invitation renewed for ${data.email}: ${inviteUrl}`);
      return res.json({
        success: true,
        message: `An invitation is pending for ${schoolRow.name}. Complete your initial setup to choose a password and enter your workspace.`,
        schoolId: schoolRow.school_id,
        schoolName: schoolRow.name,
        ...(env.NODE_ENV !== 'production' ? { invitationUrl: inviteUrl, developmentUrl: inviteUrl } : {}),
      });
    }
  }

  if(!account){
    return res.json({
      success: true,
      message: 'If the account is eligible, recovery instructions have been sent.'
    });
  }

  const raw=randomBytes(32).toString('base64url'),tokenHash=createHash('sha256').update(raw).digest('hex');
  await platformPool.query('UPDATE account_recovery_tokens SET used_at=now() WHERE user_kind=$1 AND user_id=$2 AND used_at IS NULL',[data.kind,account.id]);
  await platformPool.query("INSERT INTO account_recovery_tokens(user_kind,user_id,school_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')",[data.kind,account.id,account.schoolId??null,tokenHash]);
  await platformPool.query("INSERT INTO platform_audit_logs(action,target_type,target_id,metadata) VALUES('account_recovery.requested','user',$1,$2)",[account.id,JSON.stringify({kind:data.kind,schoolId:schoolRow?.school_id||data.schoolId||null})]);

  let emailDelivered = false;
  const developmentUrl = `${env.RECOVERY_BASE_URL}?token=${raw}`;
  try{
    await sendAccountRecovery(account.email,raw);
    emailDelivered = !!env.SMTP_HOST;
  }catch(error){
    console.error('Account recovery delivery failed',error);
  }

  const schoolNotice = schoolRow ? `${schoolRow.name} (${schoolRow.school_id})` : '';

  return res.json({
    success: true,
    message: 'If the account is eligible, recovery instructions have been sent.',
    schoolId: schoolRow?.school_id,
    schoolName: schoolRow?.name,
    schoolNotice,
    ...(env.NODE_ENV !== 'production' ? { developmentUrl } : {}),
    emailDelivered
  });
}));

authRouter.post('/recovery/confirm',asyncRoute(async(req,res)=>{
  const {token,password}=z.object({token:z.string().min(32).max(200),password:z.string().min(12).max(200)}).parse(req.body),tokenHash=createHash('sha256').update(token).digest('hex'),hash=await argon2.hash(password,{type:argon2.argon2id}),client=await platformPool.connect();
  try{await client.query('BEGIN');const found=await client.query('SELECT id,user_kind,user_id,school_id FROM account_recovery_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE',[tokenHash]);if(!found.rows[0])fail(400,'Recovery link is invalid or expired');const recovery=found.rows[0];const table=recovery.user_kind==='platform'?'platform_users':'users';const user=await client.query(`UPDATE ${table} SET password_hash=$2,updated_at=now() WHERE id=$1 AND is_active RETURNING id`,[recovery.user_id,hash]);if(!user.rowCount)fail(400,'Recovery link is invalid or expired');await client.query('UPDATE account_recovery_tokens SET used_at=now() WHERE id=$1',[recovery.id]);await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_kind=$1 AND user_id=$2 AND revoked_at IS NULL',[recovery.user_kind,recovery.user_id]);if(recovery.user_kind==='platform')await client.query("INSERT INTO platform_audit_logs(action,target_type,target_id,metadata) VALUES('account.password_reset','user',$1,'{}')",[recovery.user_id]);else await client.query("INSERT INTO audit_logs(school_id,action,target_type,target_id,metadata) VALUES($1,'account.password_reset','user',$2,'{}')",[recovery.school_id,recovery.user_id]);await client.query('COMMIT');res.json({message:'Password updated. Sign in with your new password.'});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}));
export function generateInvitationToken(){return randomBytes(32).toString('base64url');}
