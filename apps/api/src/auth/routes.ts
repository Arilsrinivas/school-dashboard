import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { env } from '../config.js';
import { pool, platformPool, tenantTransaction } from '../db/pool.js';
import { asyncRoute, fail } from '../http.js';
import { authenticate } from '../middleware/auth.js';
import { hashRefresh, newRefreshSecret, signAccess } from './tokens.js';

export const authRouter = Router();
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200), schoolId: z.string().optional() });
const inviteSchema = z.object({ token: z.string().min(32), password: z.string().min(12).max(200), name: z.string().trim().min(2).max(160) });
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
  if (!data.schoolId) fail(400,'School ID is required');
  const school=await platformPool.query("SELECT id FROM schools WHERE school_id=$1 AND status='active' AND deleted_at IS NULL",[data.schoolId]);
  if(!school.rows[0])fail(401,'Email or password is incorrect');
  const user=await tenantTransaction(school.rows[0].id,async(tenantClient)=>{const result=await tenantClient.query(`SELECT u.id,u.name,u.password_hash,m.role,s.id AS tenant_id,sr.id AS school_role_id,sr.code AS school_role FROM users u JOIN school_memberships m ON m.user_id=u.id JOIN school_roles sr ON sr.school_id=m.school_id AND sr.id=m.school_role_id JOIN schools s ON s.id=m.school_id WHERE lower(u.email)=lower($1) AND s.id=$2 AND u.is_active AND m.is_active AND s.status='active' AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.school_id=s.id AND sub.status IN ('active','trialing') AND (sub.expires_at IS NULL OR sub.expires_at>now() OR sub.grace_until>now()))`, [data.email,school.rows[0].id]);return result.rows[0];});
  if (!user || !(await argon2.verify(user.password_hash,data.password))) fail(401,'Email or password is incorrect');
  const permissions=await tenantTransaction(user.tenant_id,client=>client.query('SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2',[user.tenant_id,user.school_role_id]));
  const accessToken = await issueSession('school',user.id,{kind:'school',id:user.id,role:user.role,schoolId:user.tenant_id},res);
  res.json({accessToken,user:{id:user.id,name:user.name,role:user.role,schoolRole:user.school_role,permissions:permissions.rows.map(row=>row.permission_key),schoolId:data.schoolId}});
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
      const membership=await tenantTransaction(session.school_id,tenantClient=>tenantClient.query("SELECT m.role FROM school_memberships m JOIN schools s ON s.id=m.school_id WHERE m.user_id=$1 AND m.school_id=$2 AND m.is_active AND s.status='active' AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.school_id=s.id AND sub.status IN ('active','trialing') AND (sub.expires_at IS NULL OR sub.expires_at>now() OR sub.grace_until>now()))",[session.user_id,session.school_id]));
      if (!membership.rows[0]) fail(401,'School access is unavailable'); schoolId=session.school_id;role=membership.rows[0].role;
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
    res.status(201).json({accessToken,user:{id:user.id,name:user.name,role:invite.role,schoolRole:tenant.rows[0].role_code,schoolRoleName:tenant.rows[0].role_name,permissions:permissions.rows.map(row=>row.permission_key),schoolId:tenant.rows[0].display_id}});
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
  if(data.kind==='school'&&!data.schoolId)fail(400,'School ID is required for school account recovery');
  if(data.kind==='platform'&&data.schoolId)fail(400,'School ID is not used for platform recovery');
  let account:{id:string;email:string;schoolId?:string}|undefined;
  let schoolRow:{id:string;school_id:string;name:string}|undefined;

  if(data.kind==='platform'){
    const found=await platformPool.query('SELECT id,email FROM platform_users WHERE lower(email)=lower($1) AND is_active',[data.email]);
    if(found.rows[0])account={id:found.rows[0].id,email:found.rows[0].email};
  } else {
    const school=await platformPool.query("SELECT id,school_id,name FROM schools WHERE school_id=$1 AND status='active' AND deleted_at IS NULL",[data.schoolId]);
    if(school.rows[0]){
      schoolRow=school.rows[0];
      const found=await tenantTransaction(school.rows[0].id,client=>client.query('SELECT u.id,u.email FROM users u JOIN school_memberships m ON m.user_id=u.id WHERE lower(u.email)=lower($1) AND u.is_active AND m.is_active LIMIT 1',[data.email]));
      if(found.rows[0])account={id:found.rows[0].id,email:found.rows[0].email,schoolId:school.rows[0].id};
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
        message: 'An invitation is pending for this account. Please complete your initial account setup to access the school.',
        invitationUrl: inviteUrl,
        developmentUrl: inviteUrl,
      });
    }
  }

  let developmentUrl:string|undefined;
  if(account){
    const raw=randomBytes(32).toString('base64url'),tokenHash=createHash('sha256').update(raw).digest('hex');
    await platformPool.query('UPDATE account_recovery_tokens SET used_at=now() WHERE user_kind=$1 AND user_id=$2 AND used_at IS NULL',[data.kind,account.id]);
    await platformPool.query("INSERT INTO account_recovery_tokens(user_kind,user_id,school_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')",[data.kind,account.id,account.schoolId??null,tokenHash]);
    await platformPool.query("INSERT INTO platform_audit_logs(action,target_type,target_id,metadata) VALUES('account_recovery.requested','user',$1,$2)",[account.id,JSON.stringify({kind:data.kind,schoolId:data.schoolId||null})]);
    try{
      await sendAccountRecovery(account.email,raw);
      developmentUrl=`${env.RECOVERY_BASE_URL}?token=${raw}`;
    }catch(error){
      console.error('Account recovery delivery failed',error);
      developmentUrl=`${env.RECOVERY_BASE_URL}?token=${raw}`;
    }
  }
  res.json({message:'If the account is eligible, recovery instructions have been sent.',...(developmentUrl?{developmentUrl}:{})});
}));

authRouter.post('/recovery/confirm',asyncRoute(async(req,res)=>{
  const {token,password}=z.object({token:z.string().min(32).max(200),password:z.string().min(12).max(200)}).parse(req.body),tokenHash=createHash('sha256').update(token).digest('hex'),hash=await argon2.hash(password,{type:argon2.argon2id}),client=await platformPool.connect();
  try{await client.query('BEGIN');const found=await client.query('SELECT id,user_kind,user_id,school_id FROM account_recovery_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE',[tokenHash]);if(!found.rows[0])fail(400,'Recovery link is invalid or expired');const recovery=found.rows[0];const table=recovery.user_kind==='platform'?'platform_users':'users';const user=await client.query(`UPDATE ${table} SET password_hash=$2,updated_at=now() WHERE id=$1 AND is_active RETURNING id`,[recovery.user_id,hash]);if(!user.rowCount)fail(400,'Recovery link is invalid or expired');await client.query('UPDATE account_recovery_tokens SET used_at=now() WHERE id=$1',[recovery.id]);await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_kind=$1 AND user_id=$2 AND revoked_at IS NULL',[recovery.user_kind,recovery.user_id]);if(recovery.user_kind==='platform')await client.query("INSERT INTO platform_audit_logs(action,target_type,target_id,metadata) VALUES('account.password_reset','user',$1,'{}')",[recovery.user_id]);else await client.query("INSERT INTO audit_logs(school_id,action,target_type,target_id,metadata) VALUES($1,'account.password_reset','user',$2,'{}')",[recovery.school_id,recovery.user_id]);await client.query('COMMIT');res.json({message:'Password updated. Sign in with your new password.'});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}));
export function generateInvitationToken(){return randomBytes(32).toString('base64url');}
