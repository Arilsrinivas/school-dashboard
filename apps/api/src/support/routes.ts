import { Router } from 'express';
import { z } from 'zod';
import { platformPool, tenantTransaction } from '../db/pool.js';
import { asyncRoute, fail } from '../http.js';
import { authenticate, requireSupportAgent } from '../middleware/auth.js';

export const supportRouter=Router();
const supportScope=z.enum(['students:read','fees:read','announcements:read','messages:read']);
supportRouter.get('/support-access/mine',authenticate,requireSupportAgent,asyncRoute(async(req,res)=>{
  const requests=await platformPool.query(`SELECT g.id,g.status,g.reason,g.requested_scopes,g.approved_scopes,g.requested_expires_at,g.expires_at,g.created_at,s.school_id,s.name AS school_name FROM support_access_requests g JOIN schools s ON s.id=g.school_id WHERE g.requested_by=$1 ORDER BY g.created_at DESC LIMIT 100`,[req.identity!.id]);res.json({items:requests.rows});
}));
supportRouter.post('/support-access',authenticate,requireSupportAgent,asyncRoute(async(req,res)=>{
  const data=z.object({schoolId:z.string().min(1).max(40),reason:z.string().trim().min(12).max(1000),scopes:z.array(supportScope).min(1).max(4),durationMinutes:z.number().int().min(15).max(120).default(60)}).parse(req.body);
  const school=await platformPool.query("SELECT id,school_id,name FROM schools WHERE (id::text=$1 OR school_id=$1) AND status='active' AND deleted_at IS NULL",[data.schoolId]);if(!school.rows[0])fail(404,'Active school not found');
  const request=await platformPool.query(`INSERT INTO support_access_requests(school_id,requested_by,reason,requested_scopes,requested_expires_at) VALUES($1,$2,$3,$4,now()+($5 || ' minutes')::interval) RETURNING id,school_id,status,requested_scopes,requested_expires_at,created_at`,[school.rows[0].id,req.identity!.id,data.reason,data.scopes,data.durationMinutes]);
  await platformPool.query(`INSERT INTO platform_audit_logs(actor_id,action,target_type,target_id,metadata) VALUES($1,'support_access.requested','support_access_request',$2,$3)`,[req.identity!.id,request.rows[0].id,JSON.stringify({schoolId:school.rows[0].school_id,scopes:data.scopes})]);
  res.status(201).json({request:{...request.rows[0],schoolName:school.rows[0].name}});
}));

supportRouter.get('/support-access/:id/students',authenticate,requireSupportAgent,asyncRoute(async(req,res)=>{
  const requestId=z.uuid().parse(req.params.id),page=Math.max(1,Number(req.query.page)||1),limit=Math.min(50,Math.max(1,Number(req.query.limit)||20));
  const grant=await platformPool.query(`SELECT g.id,g.school_id,g.expires_at,s.school_id AS display_id FROM support_access_requests g JOIN schools s ON s.id=g.school_id WHERE g.id=$1 AND g.requested_by=$2 AND g.status='approved' AND g.expires_at>now() AND 'students:read'=ANY(g.approved_scopes) AND s.status='active'`,[requestId,req.identity!.id]);
  if(!grant.rows[0])fail(403,'No active school-approved student access grant');
  const schoolId=grant.rows[0].school_id;
  const records=await platformPool.query(`SELECT id,admission_number,first_name,last_name,status FROM students WHERE school_id=$1 ORDER BY last_name,first_name LIMIT $2 OFFSET $3`,[schoolId,limit,(page-1)*limit]);
  const total=await platformPool.query('SELECT count(*)::int AS total FROM students WHERE school_id=$1',[schoolId]);
  await platformPool.query(`INSERT INTO platform_audit_logs(actor_id,action,target_type,target_id,metadata) VALUES($1,'support_access.student_records_read','support_access_request',$2,$3)`,[req.identity!.id,requestId,JSON.stringify({schoolId:grant.rows[0].display_id,page,limit,returned:records.rowCount})]);
  await tenantTransaction(schoolId,client=>client.query("INSERT INTO audit_logs(school_id,action,target_type,target_id,metadata) VALUES($1,'support_access.student_records_read','support_access_request',$2,$3)",[schoolId,requestId,JSON.stringify({platformUserId:req.identity!.id,page,limit,returned:records.rowCount})]));
  res.json({items:records.rows,page,limit,total:total.rows[0].total,accessExpiresAt:grant.rows[0].expires_at});
}));
