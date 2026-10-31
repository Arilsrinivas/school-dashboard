import type { NextFunction, Request, Response } from 'express';
import { platformPool, tenantTransaction } from '../db/pool.js';
import { fail, HttpError } from '../http.js';
import { readAccess, type Identity } from '../auth/tokens.js';

declare global { namespace Express { interface Request { identity?: Identity; tenant?: { id: string; displayId: string; status: string }; schoolRole?: {id:string;code:string;name:string}; permissions?: string[]; } } }
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return next(new HttpError(401,'Authentication required'));
  try { req.identity = await readAccess(token); next(); }
  catch { next(new HttpError(401,'Invalid or expired access token')); }
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
