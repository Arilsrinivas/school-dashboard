import { Router } from 'express';
import { z } from 'zod';
import { tenantTransaction } from '../db/pool.js';
import { asyncRoute, fail } from '../http.js';
import { authenticate, requireSchoolPermission } from '../middleware/auth.js';

export const timetableRouter=Router();
timetableRouter.use(authenticate);

const uuid=z.uuid();
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,'Use a valid 24-hour time');
const readPermissions=['timetable:read','timetable:read:assigned','timetable:read:linked','timetable:read:self'] as const;
const periodSchema=z.object({academicYearId:uuid,periodNumber:z.number().int().min(1).max(30),name:z.string().trim().min(1).max(80),startsAt:time,endsAt:time,isBreak:z.boolean().default(false)}).refine(v=>v.endsAt>v.startsAt,{message:'Period end must be after its start',path:['endsAt']});
const periodUpdateSchema=z.object({name:z.string().trim().min(1).max(80).optional(),isActive:z.boolean().optional(),startsAt:time.optional(),endsAt:time.optional()}).refine(v=>Object.keys(v).length>0,{message:'Provide at least one period update'});
const entrySchema=z.object({academicYearId:uuid,classId:uuid,sectionId:uuid,subjectId:uuid,teacherId:uuid,periodId:uuid,dayOfWeek:z.number().int().min(1).max(7),room:z.string().trim().max(80).nullable().optional()});
const publishSchema=z.object({academicYearId:uuid,classId:uuid.optional(),sectionId:uuid.optional()}).refine(v=>!v.sectionId||v.classId,{message:'A section requires its class',path:['classId']});

type Req=import('express').Request;
type Db=import('../db/pool.js').DbClient;
function has(req:Req,...keys:string[]){return keys.some(key=>req.permissions?.includes(key));}
async function membership(client:Db,schoolId:string,userId:string){const row=await client.query('SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active',[schoolId,userId]);if(!row.rows[0])fail(403,'Active school membership is required');return row.rows[0].id as string;}
async function audit(client:Db,schoolId:string,actorId:string,entryId:string|null,action:string,targetType:string,targetId:string,after:object,before?:object){
  await client.query('INSERT INTO timetable_audit_history(school_id,timetable_id,actor_membership_id,action,before_state,after_state) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[schoolId,entryId,actorId,action,before?JSON.stringify(before):null,JSON.stringify(after)]);
  await client.query('INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[schoolId,actorId,`timetable.${action}`,targetType,targetId,JSON.stringify(after)]);
}
async function lockDay(client:Db,schoolId:string,yearId:string,_day:number){await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[schoolId,yearId]);}
async function validateEntry(client:Db,schoolId:string,input:z.infer<typeof entrySchema>){
  const classYear=await client.query('SELECT 1 FROM classes WHERE school_id=$1 AND id=$2 AND academic_year_id=$3',[schoolId,input.classId,input.academicYearId]);if(!classYear.rowCount)fail(400,'Class is not part of the selected academic year');
  const section=await client.query('SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3',[schoolId,input.sectionId,input.classId]);if(!section.rowCount)fail(400,'Section does not belong to the selected class');
  const subject=await client.query('SELECT 1 FROM class_subjects WHERE school_id=$1 AND class_id=$2 AND subject_id=$3',[schoolId,input.classId,input.subjectId]);if(!subject.rowCount)fail(400,'Subject is not allocated to the selected class');
  const teacher=await client.query("SELECT 1 FROM teachers WHERE school_id=$1 AND id=$2 AND employment_status='active'",[schoolId,input.teacherId]);if(!teacher.rowCount)fail(400,'Teacher is not active in this school');
  const assignment=await client.query(`SELECT 1 FROM teacher_assignments ta JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE ta.school_id=$1 AND ta.teacher_id=$2 AND cs.class_id=$3 AND cs.subject_id=$4 AND (ta.section_id IS NULL OR ta.section_id=$5::uuid) LIMIT 1`,[schoolId,input.teacherId,input.classId,input.subjectId,input.sectionId]);if(!assignment.rowCount)fail(400,'Teacher is not assigned to this class, section, and subject');
  const period=await client.query('SELECT id,starts_at,ends_at,is_break FROM timetable_periods WHERE school_id=$1 AND id=$2 AND academic_year_id=$3 AND is_active',[schoolId,input.periodId,input.academicYearId]);if(!period.rows[0])fail(400,'Period is unavailable for the selected academic year');if(period.rows[0].is_break)fail(400,'Break periods cannot be assigned a subject');
  return {startsAt:String(period.rows[0].starts_at),endsAt:String(period.rows[0].ends_at)};
}
async function findConflicts(client:Db,schoolId:string,entry:{id?:string;academicYearId:string;classId:string;sectionId:string;teacherId:string;dayOfWeek:number;startsAt:string;endsAt:string;room?:string|null}){
  const rows=await client.query(`SELECT id,class_id,section_id,teacher_id,day_of_week,starts_at,ends_at,room
    FROM timetables WHERE school_id=$1 AND academic_year_id=$2 AND day_of_week=$3 AND status<>'archived'
      AND ($4::uuid IS NULL OR id<>$4::uuid) AND starts_at<$6::time AND ends_at>$5::time
      AND (section_id=$7::uuid OR teacher_id=$8::uuid OR ($9::text IS NOT NULL AND room IS NOT NULL AND lower(trim(room))=lower(trim($9::text))))
    ORDER BY starts_at,id`,[schoolId,entry.academicYearId,entry.dayOfWeek,entry.id??null,entry.startsAt,entry.endsAt,entry.sectionId,entry.teacherId,entry.room??null]);
  return rows.rows.map(row=>({id:row.id,classConflict:row.section_id===entry.sectionId,teacherConflict:row.teacher_id===entry.teacherId,roomConflict:!!entry.room&&!!row.room&&String(row.room).trim().toLowerCase()===entry.room.trim().toLowerCase(),startsAt:row.starts_at,endsAt:row.ends_at,room:row.room}));
}
const selectEntries=`SELECT tt.id,tt.academic_year_id,tt.class_id,c.name AS class_name,tt.section_id,s.name AS section_name,tt.subject_id,sub.name AS subject_name,tt.teacher_id,u.name AS teacher_name,tt.period_id,p.period_number,p.name AS period_name,tt.day_of_week,tt.starts_at,tt.ends_at,tt.room,tt.status,tt.created_at,tt.updated_at
  FROM timetables tt JOIN classes c ON c.school_id=tt.school_id AND c.id=tt.class_id JOIN sections s ON s.school_id=tt.school_id AND s.id=tt.section_id JOIN subjects sub ON sub.school_id=tt.school_id AND sub.id=tt.subject_id JOIN teachers t ON t.school_id=tt.school_id AND t.id=tt.teacher_id LEFT JOIN users u ON u.id=t.user_id LEFT JOIN timetable_periods p ON p.school_id=tt.school_id AND p.id=tt.period_id`;

timetableRouter.get('/timetable/periods',requireSchoolPermission(...readPermissions),asyncRoute(async(req,res)=>{
  const query=z.object({academicYearId:uuid,active:z.coerce.boolean().optional()}).parse(req.query);
  const items=await tenantTransaction(req.tenant!.id,async client=>(await client.query(`SELECT id,academic_year_id,period_number,name,starts_at,ends_at,is_break,is_active,created_at,updated_at FROM timetable_periods WHERE school_id=$1 AND academic_year_id=$2 AND ($3::boolean IS NULL OR is_active=$3) ORDER BY period_number`,[req.tenant!.id,query.academicYearId,query.active??null])).rows);
  res.json({items});
}));

timetableRouter.post('/timetable/periods',requireSchoolPermission('timetable:manage'),asyncRoute(async(req,res)=>{
  const input=periodSchema.parse(req.body),actor=await tenantTransaction(req.tenant!.id,client=>membership(client,req.tenant!.id,req.identity!.id));
  const result=await tenantTransaction(req.tenant!.id,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[req.tenant!.id,input.academicYearId]);
    const year=await client.query('SELECT 1 FROM academic_years WHERE school_id=$1 AND id=$2',[req.tenant!.id,input.academicYearId]);if(!year.rowCount)fail(404,'Academic year not found');
    const conflict=await client.query('SELECT id FROM timetable_periods WHERE school_id=$1 AND academic_year_id=$2 AND is_active AND (period_number=$3 OR lower(name)=lower($4) OR (starts_at<$6::time AND ends_at>$5::time)) LIMIT 1',[req.tenant!.id,input.academicYearId,input.periodNumber,input.name,input.startsAt,input.endsAt]);if(conflict.rowCount)fail(409,'Period number, name, or time overlaps an existing active period');
    const created=await client.query('INSERT INTO timetable_periods(school_id,academic_year_id,period_number,name,starts_at,ends_at,is_break) VALUES($1,$2,$3,$4,$5::time,$6::time,$7) RETURNING id,academic_year_id,period_number,name,starts_at,ends_at,is_break,is_active',[req.tenant!.id,input.academicYearId,input.periodNumber,input.name,input.startsAt,input.endsAt,input.isBreak]);
    await audit(client,req.tenant!.id,actor,null,'period_created','timetable_period',created.rows[0].id,created.rows[0]);return created.rows[0];
  });res.status(201).json({period:result});
}));

timetableRouter.patch('/timetable/periods/:id',requireSchoolPermission('timetable:manage'),asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),input=periodUpdateSchema.parse(req.body),actor=await tenantTransaction(req.tenant!.id,client=>membership(client,req.tenant!.id,req.identity!.id));
  const updated=await tenantTransaction(req.tenant!.id,async client=>{
    const old=(await client.query('SELECT id,academic_year_id,period_number,name,starts_at,ends_at,is_break,is_active FROM timetable_periods WHERE school_id=$1 AND id=$2 FOR UPDATE',[req.tenant!.id,id])).rows[0];if(!old)fail(404,'Timetable period not found');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[req.tenant!.id,old.academic_year_id]);
    const next={...old,name:input.name??old.name,starts_at:input.startsAt??old.starts_at,ends_at:input.endsAt??old.ends_at,is_active:input.isActive??old.is_active};if(next.ends_at<=next.starts_at)fail(400,'Period end must be after its start');
    const timeChanged=next.starts_at!==old.starts_at||next.ends_at!==old.ends_at||next.is_active!==old.is_active;
    if(timeChanged){const used=await client.query("SELECT 1 FROM timetables WHERE school_id=$1 AND period_id=$2 AND status<>'archived' LIMIT 1",[req.tenant!.id,id]);if(used.rowCount)fail(409,'A period used by timetable entries cannot be deactivated or have its times changed; archive its entries first');}
    const conflict=await client.query('SELECT 1 FROM timetable_periods WHERE school_id=$1 AND academic_year_id=$2 AND id<>$3 AND is_active AND $4::boolean AND (lower(name)=lower($5) OR period_number=$6 OR (starts_at<$8::time AND ends_at>$7::time)) LIMIT 1',[req.tenant!.id,old.academic_year_id,id,next.is_active,next.name,next.period_number,next.starts_at,next.ends_at]);if(conflict.rowCount)fail(409,'Period number, name, or time overlaps another active period');
    const row=(await client.query('UPDATE timetable_periods SET name=$3,starts_at=$4::time,ends_at=$5::time,is_active=$6,updated_at=now() WHERE school_id=$1 AND id=$2 RETURNING id,academic_year_id,period_number,name,starts_at,ends_at,is_break,is_active,updated_at',[req.tenant!.id,id,next.name,next.starts_at,next.ends_at,next.is_active])).rows[0];
    await audit(client,req.tenant!.id,actor,null,'period_updated','timetable_period',id,row,old);return row;
  });res.json({period:updated});
}));

timetableRouter.get('/timetable',requireSchoolPermission(...readPermissions),asyncRoute(async(req,res)=>{
  const filter=z.object({academicYearId:uuid.optional(),classId:uuid.optional(),sectionId:uuid.optional(),teacherId:uuid.optional(),dayOfWeek:z.coerce.number().int().min(1).max(7).optional(),status:z.enum(['draft','published','archived']).optional(),limit:z.coerce.number().int().min(1).max(500).default(250)}).parse(req.query);
  if(filter.sectionId&&!filter.classId)fail(400,'A class is required when filtering by section');
  const scope={global:has(req,'timetable:read'),assigned:has(req,'timetable:read:assigned'),linked:has(req,'timetable:read:linked'),self:has(req,'timetable:read:self')};
  const data=await tenantTransaction(req.tenant!.id,async client=>{
    if(filter.classId){const exists=await client.query('SELECT 1 FROM classes WHERE school_id=$1 AND id=$2',[req.tenant!.id,filter.classId]);if(!exists.rowCount)fail(404,'Class not found');}
    if(filter.sectionId){const exists=await client.query('SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3',[req.tenant!.id,filter.sectionId,filter.classId]);if(!exists.rowCount)fail(404,'Section not found');}
    const params=[req.tenant!.id,filter.academicYearId??null,filter.classId??null,filter.sectionId??null,filter.teacherId??null,filter.dayOfWeek??null,filter.status??null,scope.global,scope.assigned,scope.linked,scope.self,req.identity!.id,filter.limit];
    const items=await client.query(`${selectEntries} WHERE tt.school_id=$1 AND ($2::uuid IS NULL OR tt.academic_year_id=$2) AND ($3::uuid IS NULL OR tt.class_id=$3) AND ($4::uuid IS NULL OR tt.section_id=$4) AND ($5::uuid IS NULL OR tt.teacher_id=$5) AND ($6::smallint IS NULL OR tt.day_of_week=$6) AND ($7::text IS NULL OR tt.status=$7) AND (
      $8::boolean OR
      ($9::boolean AND EXISTS(SELECT 1 FROM teacher_assignments ta JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id JOIN teachers t2 ON t2.school_id=ta.school_id AND t2.id=ta.teacher_id WHERE ta.school_id=tt.school_id AND t2.user_id=$12 AND t2.id=tt.teacher_id AND cs.class_id=tt.class_id AND cs.subject_id=tt.subject_id AND (ta.section_id IS NULL OR ta.section_id=tt.section_id))) OR
      ($10::boolean AND tt.status='published' AND EXISTS(SELECT 1 FROM student_enrollments e JOIN student_parents sp ON sp.school_id=e.school_id AND sp.student_id=e.student_id JOIN parents p2 ON p2.school_id=sp.school_id AND p2.id=sp.parent_id WHERE e.school_id=tt.school_id AND p2.user_id=$12 AND e.status='active' AND e.class_id=tt.class_id AND e.academic_year_id=tt.academic_year_id AND e.section_id=tt.section_id)) OR
      ($11::boolean AND tt.status='published' AND EXISTS(SELECT 1 FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id WHERE st.school_id=tt.school_id AND st.user_id=$12 AND e.status='active' AND e.class_id=tt.class_id AND e.academic_year_id=tt.academic_year_id AND e.section_id=tt.section_id))
    ) ORDER BY tt.day_of_week,tt.starts_at,c.name,s.name LIMIT $13`,params);
    return items.rows;
  });res.json({items:data});
}));

timetableRouter.get('/timetable/teachers/:teacherId',requireSchoolPermission(...readPermissions),asyncRoute(async(req,res)=>{
  const teacherId=uuid.parse(req.params.teacherId);
  if(has(req,'timetable:read:assigned')){const own=await tenantTransaction(req.tenant!.id,client=>client.query('SELECT 1 FROM teachers WHERE school_id=$1 AND id=$2 AND user_id=$3 AND employment_status=\u0027active\u0027',[req.tenant!.id,teacherId,req.identity!.id]));if(!own.rowCount&&!has(req,'timetable:read'))fail(404,'Teacher timetable not found');}
  const query=z.object({academicYearId:uuid.optional()}).parse(req.query);
  const result=await tenantTransaction(req.tenant!.id,client=>client.query(`${selectEntries} WHERE tt.school_id=$1 AND tt.teacher_id=$2 AND ($3::uuid IS NULL OR tt.academic_year_id=$3) AND ($4::boolean OR ($5::boolean AND t.user_id=$6)) ORDER BY tt.day_of_week,tt.starts_at`,[req.tenant!.id,teacherId,query.academicYearId??null,has(req,'timetable:read'),has(req,'timetable:read:assigned'),req.identity!.id]));
  res.json({items:result.rows});
}));

timetableRouter.get('/timetable/classes/:classId',requireSchoolPermission(...readPermissions),asyncRoute(async(req,res)=>{
  const classId=uuid.parse(req.params.classId),query=z.object({academicYearId:uuid.optional(),sectionId:uuid.optional()}).parse(req.query);
  const params=[req.tenant!.id,classId,query.academicYearId??null,query.sectionId??null,has(req,'timetable:read'),has(req,'timetable:read:assigned'),has(req,'timetable:read:linked'),has(req,'timetable:read:self'),req.identity!.id];
  const result=await tenantTransaction(req.tenant!.id,async client=>{
    const exists=await client.query('SELECT 1 FROM classes WHERE school_id=$1 AND id=$2',[req.tenant!.id,classId]);if(!exists.rowCount)fail(404,'Class not found');
    if(query.sectionId){const section=await client.query('SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3',[req.tenant!.id,query.sectionId,classId]);if(!section.rowCount)fail(404,'Section not found');}
    return client.query(`${selectEntries} WHERE tt.school_id=$1 AND tt.class_id=$2 AND ($3::uuid IS NULL OR tt.academic_year_id=$3) AND ($4::uuid IS NULL OR tt.section_id=$4) AND (
      $5::boolean OR
      ($6::boolean AND EXISTS(SELECT 1 FROM teacher_assignments ta JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id JOIN teachers t2 ON t2.school_id=ta.school_id AND t2.id=ta.teacher_id WHERE ta.school_id=tt.school_id AND t2.user_id=$9 AND cs.class_id=tt.class_id AND cs.subject_id=tt.subject_id AND t2.id=tt.teacher_id AND (ta.section_id IS NULL OR ta.section_id=tt.section_id))) OR
      ($7::boolean AND tt.status='published' AND EXISTS(SELECT 1 FROM student_enrollments e JOIN student_parents sp ON sp.school_id=e.school_id AND sp.student_id=e.student_id JOIN parents p2 ON p2.school_id=sp.school_id AND p2.id=sp.parent_id WHERE e.school_id=tt.school_id AND p2.user_id=$9 AND e.status='active' AND e.academic_year_id=tt.academic_year_id AND e.section_id=tt.section_id)) OR
      ($8::boolean AND tt.status='published' AND EXISTS(SELECT 1 FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id WHERE st.school_id=tt.school_id AND st.user_id=$9 AND e.status='active' AND e.academic_year_id=tt.academic_year_id AND e.section_id=tt.section_id))
    ) ORDER BY tt.day_of_week,tt.starts_at`,params);
  });res.json({items:result.rows});
}));

timetableRouter.post('/timetable',requireSchoolPermission('timetable:manage'),asyncRoute(async(req,res)=>{
  const input=entrySchema.parse(req.body),actor=await tenantTransaction(req.tenant!.id,client=>membership(client,req.tenant!.id,req.identity!.id));
  const created=await tenantTransaction(req.tenant!.id,async client=>{
    await lockDay(client,req.tenant!.id,input.academicYearId,input.dayOfWeek);
    const period=await validateEntry(client,req.tenant!.id,input);
    const overlaps=await findConflicts(client,req.tenant!.id,{academicYearId:input.academicYearId,classId:input.classId,sectionId:input.sectionId,teacherId:input.teacherId,dayOfWeek:input.dayOfWeek,startsAt:period.startsAt,endsAt:period.endsAt,room:input.room});if(overlaps.length)fail(409,`Schedule conflict: ${JSON.stringify(overlaps)}`);
    const row=(await client.query(`INSERT INTO timetables(school_id,academic_year_id,class_id,section_id,subject_id,teacher_id,period_id,day_of_week,starts_at,ends_at,room,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::time,$10::time,$11,'draft') RETURNING id,academic_year_id,class_id,section_id,subject_id,teacher_id,period_id,day_of_week,starts_at,ends_at,room,status`,[req.tenant!.id,input.academicYearId,input.classId,input.sectionId,input.subjectId,input.teacherId,input.periodId,input.dayOfWeek,period.startsAt,period.endsAt,input.room??null])).rows[0];
    await audit(client,req.tenant!.id,actor,row.id,'entry_created','timetable',row.id,row);return row;
  });res.status(201).json({entry:created});
}));

timetableRouter.patch('/timetable/:id',requireSchoolPermission('timetable:manage'),asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),input=entrySchema.parse(req.body),actor=await tenantTransaction(req.tenant!.id,client=>membership(client,req.tenant!.id,req.identity!.id));
  const updated=await tenantTransaction(req.tenant!.id,async client=>{
    const old=(await client.query('SELECT id,status,academic_year_id,class_id,section_id,subject_id,teacher_id,period_id,day_of_week,room FROM timetables WHERE school_id=$1 AND id=$2 FOR UPDATE',[req.tenant!.id,id])).rows[0];if(!old)fail(404,'Timetable entry not found');if(old.status!=='draft')fail(409,'Unpublish a timetable entry before editing it');if(input.academicYearId!==old.academic_year_id)fail(400,'Timetable entries cannot be moved between academic years; create a new entry and archive this one');
    await lockDay(client,req.tenant!.id,input.academicYearId,input.dayOfWeek);
    const period=await validateEntry(client,req.tenant!.id,input),overlaps=await findConflicts(client,req.tenant!.id,{id,academicYearId:input.academicYearId,classId:input.classId,sectionId:input.sectionId,teacherId:input.teacherId,dayOfWeek:input.dayOfWeek,startsAt:period.startsAt,endsAt:period.endsAt,room:input.room});if(overlaps.length)fail(409,`Schedule conflict: ${JSON.stringify(overlaps)}`);
    const row=(await client.query(`UPDATE timetables SET academic_year_id=$3,class_id=$4,section_id=$5,subject_id=$6,teacher_id=$7,period_id=$8,day_of_week=$9,starts_at=$10::time,ends_at=$11::time,room=$12,updated_at=now() WHERE school_id=$1 AND id=$2 RETURNING id,academic_year_id,class_id,section_id,subject_id,teacher_id,period_id,day_of_week,starts_at,ends_at,room,status,updated_at`,[req.tenant!.id,id,input.academicYearId,input.classId,input.sectionId,input.subjectId,input.teacherId,input.periodId,input.dayOfWeek,period.startsAt,period.endsAt,input.room??null])).rows[0];
    await audit(client,req.tenant!.id,actor,id,'entry_updated','timetable',id,row,old);return row;
  });res.json({entry:updated});
}));

timetableRouter.patch('/timetable/:id/status',requireSchoolPermission('timetable:manage'),asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),{status}=z.object({status:z.enum(['draft','archived'])}).parse(req.body),actor=await tenantTransaction(req.tenant!.id,client=>membership(client,req.tenant!.id,req.identity!.id));
  const updated=await tenantTransaction(req.tenant!.id,async client=>{
    const old=(await client.query('SELECT id,status FROM timetables WHERE school_id=$1 AND id=$2 FOR UPDATE',[req.tenant!.id,id])).rows[0];if(!old)fail(404,'Timetable entry not found');
    const row=(await client.query('UPDATE timetables SET status=$3,updated_at=now() WHERE school_id=$1 AND id=$2 RETURNING id,status,updated_at',[req.tenant!.id,id,status])).rows[0];
    await audit(client,req.tenant!.id,actor,id,status==='draft'?'entry_unpublished':'entry_archived','timetable',id,row,old);return row;
  });res.json({entry:updated});
}));

timetableRouter.post('/timetable/publish',requireSchoolPermission('timetable:manage'),asyncRoute(async(req,res)=>{
  const input=publishSchema.parse(req.body),actor=await tenantTransaction(req.tenant!.id,client=>membership(client,req.tenant!.id,req.identity!.id));
  const updated=await tenantTransaction(req.tenant!.id,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[req.tenant!.id,input.academicYearId]);
    const target=(await client.query(`SELECT id,class_id,section_id,teacher_id,day_of_week,starts_at,ends_at,room FROM timetables WHERE school_id=$1 AND academic_year_id=$2 AND status='draft' AND ($3::uuid IS NULL OR class_id=$3) AND ($4::uuid IS NULL OR section_id=$4) ORDER BY day_of_week,starts_at,id FOR UPDATE`,[req.tenant!.id,input.academicYearId,input.classId??null,input.sectionId??null])).rows;
    if(!target.length)fail(404,'No draft timetable entries matched the publication target');
    for(const item of target){const overlaps=await findConflicts(client,req.tenant!.id,{id:item.id,academicYearId:input.academicYearId,classId:item.class_id,sectionId:item.section_id,teacherId:item.teacher_id,dayOfWeek:item.day_of_week,startsAt:String(item.starts_at),endsAt:String(item.ends_at),room:item.room});if(overlaps.length)fail(409,`Resolve schedule conflicts before publication: ${JSON.stringify(overlaps)}`);}
    const ids=target.map(row=>row.id);
    const rows=(await client.query("UPDATE timetables SET status='published',updated_at=now() WHERE school_id=$1 AND id=ANY($2::uuid[]) RETURNING id,class_id,section_id,day_of_week,starts_at,ends_at,room,status",[req.tenant!.id,ids])).rows;
    for(const row of rows)await audit(client,req.tenant!.id,actor,row.id,'entry_published','timetable',row.id,row);
    await audit(client,req.tenant!.id,actor,null,'schedule_published','timetable_schedule',input.classId??input.academicYearId,{academicYearId:input.academicYearId,classId:input.classId??null,sectionId:input.sectionId??null,count:rows.length});
    return rows;
  });res.json({items:updated});
}));
