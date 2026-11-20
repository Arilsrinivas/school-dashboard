import type { NextFunction, Request, Response } from 'express';
import { platformPool, tenantTransaction } from '../db/pool.js';
import { fail, HttpError } from '../http.js';
import { readAccess, type Identity } from '../auth/tokens.js';
import { verifyFirebaseIdToken } from '../auth/firebase-admin.js';
import { env } from '../config.js';

declare global { namespace Express { interface Request { identity?: Identity; authProvider?: 'firebase'|'legacy'; firebaseUid?: string; tenant?: { id: string; displayId: string; status: string }; schoolRole?: {id:string;code:string;name:string}; permissions?: string[]; } } }
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return next(new HttpError(401,'Authentication required'));
  let firebaseVerified=false;
  try {
    if (token.split('.').length === 3 && env.AUTH_PROVIDER === 'firebase') {
      const decoded = await verifyFirebaseIdToken(token);
      if (decoded.email && decoded.email_verified !== true) throw new HttpError(403,'Verify your Firebase email address before continuing');
      firebaseVerified=true;
      const mapping = await platformPool.query<{user_kind:'platform'|'school';user_id:string;name:string;role:string;school_id:string|null;display_school_id:string|null}>(`
        SELECT ei.user_kind,ei.user_id,
          CASE WHEN ei.user_kind='platform' THEN pu.name ELSE u.name END AS name,
          CASE WHEN ei.user_kind='platform' THEN pr.name ELSE m.role::text END AS role,
          s.id AS school_id,s.school_id AS display_school_id
        FROM external_identities ei
        LEFT JOIN platform_users pu ON ei.user_kind='platform' AND pu.id=ei.user_id AND pu.is_active
        LEFT JOIN platform_roles pr ON pr.id=pu.role_id
        LEFT JOIN users u ON ei.user_kind='school' AND u.id=ei.user_id AND u.is_active
        LEFT JOIN school_memberships m ON ei.user_kind='school' AND m.user_id=u.id AND m.is_active
        LEFT JOIN schools s ON s.id=m.school_id AND s.status='active' AND s.deleted_at IS NULL
          AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.school_id=s.id AND sub.status IN ('active','trialing') AND (sub.expires_at IS NULL OR sub.expires_at>now() OR sub.grace_until>now()))
        WHERE ei.provider='firebase' AND ei.provider_subject_id=$1
          AND (ei.user_kind='platform' OR (m.id IS NOT NULL AND s.id IS NOT NULL))
        ORDER BY s.created_at`, [decoded.uid]);
      if (!mapping.rows.length) throw new HttpError(403,'This verified Firebase account is not linked to an active EduConnect account');
      const kind=mapping.rows[0]!.user_kind;
      if(kind==='platform'){
        const row=mapping.rows[0]!;
        if(!row.name||!row.role)throw new HttpError(403,'Platform account is inactive');
        req.identity={kind:'platform',id:row.user_id,role:row.role};
      } else {
        const requested=req.header('x-educonnect-school-id');
        const matching=requested?mapping.rows.find(row=>row.display_school_id===requested||row.school_id===requested):mapping.rows.length===1?mapping.rows[0]:undefined;
        if(!matching)throw new HttpError(409,'Choose an active school membership before continuing');
        req.identity={kind:'school',id:matching.user_id,role:matching.role,schoolId:matching.school_id!};
      }
      req.authProvider='firebase';req.firebaseUid=decoded.uid;return next();
    }
    if(env.AUTH_PROVIDER==='firebase')throw new HttpError(401,'A Firebase ID token is required');
    req.identity = await readAccess(token);req.authProvider='legacy';next();
  } catch (error) { next(error instanceof HttpError?error:firebaseVerified?error:new HttpError(401,'Invalid, expired, revoked or unverified authentication token')); }
}
export async function requirePlatform(req: Request, _res: Response, next: NextFunction) {
  try{
    if (req.identity?.kind !== 'platform' || req.identity.role !== 'super_admin') return next(new HttpError(403,'Platform administrator access required'));
    const user=await platformPool.query("SELECT 1 FROM platform_users u JOIN platform_roles r ON r.id=u.role_id WHERE u.id=$1 AND u.is_active AND r.name='super_admin'",[req.identity.id]);
    if(!user.rowCount)return next(new HttpError(403,'Platform administrator access required'));
    next();
  }catch(error){next(error);}
}
export async function requireSupportAgent(req: Request,_res: Response,next: NextFunction){
  try{
    if(req.identity?.kind!=='platform')return next(new HttpError(403,'Platform support access required'));
    const agent=await platformPool.query(`SELECT 1 FROM platform_users u JOIN platform_roles r ON r.id=u.role_id JOIN platform_role_permissions rp ON rp.role_id=r.id JOIN platform_permissions p ON p.id=rp.permission_id WHERE u.id=$1 AND u.is_active AND r.name='support_agent' AND p.name='support:request'`,[req.identity.id]);
    if(!agent.rowCount)return next(new HttpError(403,'Platform support access required'));next();
  }catch(error){next(error);}
}
export function requireSchoolRole(...roles: string[]) { return async (req: Request,res: Response,next: NextFunction) => {
  try {
    const identity = req.identity;
    if (!identity || identity.kind !== 'school' || !identity.schoolId || !roles.includes(identity.role)) fail(403,'School role is not authorized');
    const result = await tenantTransaction(identity.schoolId,client=>client.query(`SELECT s.id,s.school_id,s.status FROM schools s JOIN school_memberships m ON m.school_id=s.id WHERE s.id=$1 AND m.user_id=$2 AND m.role=$3 AND m.is_active=true AND s.status='active' AND s.deleted_at IS NULL AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.school_id=s.id AND sub.status IN ('active','trialing') AND (sub.expires_at IS NULL OR sub.expires_at>now() OR sub.grace_until>now()))`, [identity.schoolId,identity.id,identity.role]));
    if (!result.rows[0]) fail(403,'School membership is inactive or school access is unavailable');
    req.tenant = { id: result.rows[0].id, displayId: result.rows[0].school_id, status: result.rows[0].status };
    next();
  } catch (error) { next(error); }
}; }

export function requireSchoolPermission(...permissions: string[]) { return async (req: Request,res: Response,next: NextFunction) => {
  try{
    const identity=req.identity;
    if(!identity||identity.kind!=='school'||!identity.schoolId)fail(403,'School authentication is required');
    const access=await tenantTransaction(identity.schoolId,async(client)=>{
      const membership=await client.query(`SELECT s.id,s.school_id,s.status,m.school_role_id,r.code,r.name FROM schools s JOIN school_memberships m ON m.school_id=s.id JOIN school_roles r ON r.school_id=m.school_id AND r.id=m.school_role_id WHERE s.id=$1 AND m.user_id=$2 AND m.is_active AND s.status='active' AND s.deleted_at IS NULL AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.school_id=s.id AND sub.status IN ('active','trialing') AND (sub.expires_at IS NULL OR sub.expires_at>now() OR sub.grace_until>now()))`,[identity.schoolId,identity.id]);
      if(!membership.rows[0])fail(403,'School membership is inactive or school access is unavailable');
      const grants=await client.query('SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2',[identity.schoolId,membership.rows[0].school_role_id]);
      return {membership:membership.rows[0],permissions:grants.rows.map((row:{permission_key:string})=>row.permission_key)};
    });
    if(!permissions.some(permission=>access.permissions.includes(permission)))fail(403,'School permission is not authorized');
    req.tenant={id:access.membership.id,displayId:access.membership.school_id,status:access.membership.status};
    req.schoolRole={id:access.membership.school_role_id,code:access.membership.code,name:access.membership.name};
    req.permissions=access.permissions;next();
  }catch(error){next(error);}
}; }
