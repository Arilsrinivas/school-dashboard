import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, fail } from '../http.js';
import { tenantTransaction } from '../db/pool.js';
import { authenticate, requireSchoolPermission } from '../middleware/auth.js';

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

const statusSchema = z.enum(['present','absent','late','excused']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(value=>{
  const [yearText,monthText,dayText]=value.split('-');
  const year=Number(yearText),month=Number(monthText),day=Number(dayText);
  if(year<1||month<1||month>12||day<1)return false;
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return day<=(days[month-1]??0);
},'Use a valid calendar date');
const uuidSchema = z.uuid();
const pagination = z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(50)});
const readPermissions = ['attendance:read','attendance:read:assigned','attendance:read:linked','attendance:read:self'] as const;

function membershipId(req: import('express').Request) {
  return tenantTransaction(req.tenant!.id, async client => {
    const result = await client.query('SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active',[req.tenant!.id,req.identity!.id]);
    if (!result.rows[0]) fail(403,'Active school membership is required');
    return result.rows[0].id as string;
  });
}

async function canAccessClass(client: import('../db/pool.js').DbClient, req: import('express').Request, classId: string, sectionId?: string, manage = false) {
  const permissions = req.permissions ?? [];
  const global = permissions.includes(manage ? 'attendance:manage' : 'attendance:read');
  if (global) return;
  const scoped = permissions.includes(manage ? 'attendance:manage:assigned' : 'attendance:read:assigned');
  if (!scoped) fail(403,'Attendance permission is not authorized');
  const assigned = await client.query(`SELECT 1 FROM teachers t
    JOIN teacher_assignments ta ON ta.school_id=t.school_id AND ta.teacher_id=t.id
    JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id
    WHERE t.school_id=$1 AND t.user_id=$2 AND t.employment_status='active' AND cs.class_id=$3
      AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM $4::uuid)
    LIMIT 1`,[req.tenant!.id,req.identity!.id,classId,sectionId ?? null]);
  if (!assigned.rowCount) fail(403,'Class is outside your assigned teaching scope');
}

function queryClass(req: import('express').Request) {
  return z.object({date:dateSchema,classId:uuidSchema,sectionId:uuidSchema.optional()}).parse(req.query);
}

attendanceRouter.get('/attendance/classes',requireSchoolPermission(...readPermissions),asyncRoute(async(req,res)=>{
  const date=dateSchema.parse(req.query.date);
  const items=await tenantTransaction(req.tenant!.id,async client=>{
    const global=req.permissions!.includes('attendance:read');
    const assigned=req.permissions!.includes('attendance:read:assigned');
    if(!global&&!assigned)fail(403,'Class attendance is not available to this account');
    const result=await client.query(`SELECT c.id AS class_id,c.name AS class_name,c.academic_year_id,s.id AS section_id,s.name AS section_name,
      count(DISTINCT e.student_id)::int AS student_count,
      count(DISTINCT a.student_id)::int AS marked_count,
      count(DISTINCT a.student_id) FILTER(WHERE a.status='absent')::int AS absent_count
      FROM classes c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id AND $2::date BETWEEN y.starts_on AND y.ends_on
      LEFT JOIN sections s ON s.school_id=c.school_id AND s.class_id=c.id
      LEFT JOIN student_enrollments e ON e.school_id=c.school_id AND e.class_id=c.id AND e.status='active' AND e.enrolled_on<=$2::date AND (e.ended_on IS NULL OR e.ended_on >= $2::date) AND (s.id IS NULL OR e.section_id=s.id)
      LEFT JOIN attendance a ON a.school_id=c.school_id AND a.class_id=c.id AND a.attendance_date=$2::date AND a.student_id=e.student_id
      WHERE c.school_id=$1 AND ($3::boolean OR EXISTS(SELECT 1 FROM teachers t JOIN teacher_assignments ta ON ta.school_id=t.school_id AND ta.teacher_id=t.id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE t.school_id=c.school_id AND t.user_id=$4 AND t.employment_status='active' AND cs.class_id=c.id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM s.id)))
      GROUP BY c.id,c.name,c.academic_year_id,s.id,s.name ORDER BY c.name,s.name NULLS FIRST`,[req.tenant!.id,date,global,req.identity!.id]);
    return result.rows;
  });
  res.json({items});
}));

attendanceRouter.get('/attendance',requireSchoolPermission(...readPermissions),asyncRoute(async(req,res)=>{
  const filter=queryClass(req);
  const items=await tenantTransaction(req.tenant!.id,async client=>{
    await canAccessClass(client,req,filter.classId,filter.sectionId);
    const classResult=await client.query(`SELECT c.id,c.academic_year_id FROM classes c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=$1 AND c.id=$2 AND $3::date BETWEEN y.starts_on AND y.ends_on`,[req.tenant!.id,filter.classId,filter.date]);
    if(!classResult.rows[0])fail(404,'Class or academic year not found for this date');
    if(filter.sectionId){const section=await client.query('SELECT 1 FROM sections WHERE school_id=$1 AND class_id=$2 AND id=$3',[req.tenant!.id,filter.classId,filter.sectionId]);if(!section.rowCount)fail(400,'Section does not belong to this class');}
    const result=await client.query(`SELECT st.id AS student_id,st.admission_number,st.first_name,st.last_name,e.section_id,sec.name AS section_name,a.id AS attendance_id,a.status,a.note,a.updated_at
      FROM student_enrollments e JOIN students st ON st.school_id=e.school_id AND st.id=e.student_id
      LEFT JOIN sections sec ON sec.school_id=e.school_id AND sec.id=e.section_id
      LEFT JOIN attendance a ON a.school_id=e.school_id AND a.student_id=e.student_id AND a.attendance_date=$3::date
      WHERE e.school_id=$1 AND e.class_id=$2 AND e.status='active' AND e.enrolled_on<=$3::date AND (e.ended_on IS NULL OR e.ended_on >= $3::date)
        AND ($4::uuid IS NULL OR e.section_id=$4::uuid)
      ORDER BY st.last_name,st.first_name,st.admission_number`,[req.tenant!.id,filter.classId,filter.date,filter.sectionId ?? null]);
    return result.rows.map(row=>({...row,status:row.attendance_id?row.status:null}));
  });
  res.json({date:filter.date,classId:filter.classId,sectionId:filter.sectionId??null,items});
}));

const bulkSchema=z.object({date:dateSchema,classId:uuidSchema,sectionId:uuidSchema.optional(),records:z.array(z.object({studentId:uuidSchema,status:statusSchema,note:z.string().trim().max(500).nullable().optional()})).min(1).max(500)}).superRefine((value,ctx)=>{const ids=value.records.map(row=>row.studentId);if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',message:'A student may appear only once in a bulk attendance request',path:['records']});});

attendanceRouter.put('/attendance/bulk',requireSchoolPermission('attendance:manage','attendance:manage:assigned'),asyncRoute(async(req,res)=>{
  const input=bulkSchema.parse(req.body);
  const actor=await membershipId(req);
  const result=await tenantTransaction(req.tenant!.id,async client=>{
    await canAccessClass(client,req,input.classId,input.sectionId,true);
    const klass=await client.query(`SELECT c.academic_year_id FROM classes c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=$1 AND c.id=$2 AND $3::date BETWEEN y.starts_on AND y.ends_on`,[req.tenant!.id,input.classId,input.date]);
    if(!klass.rows[0])fail(404,'Class or academic year not found for this date');
    if(input.sectionId){const section=await client.query('SELECT 1 FROM sections WHERE school_id=$1 AND class_id=$2 AND id=$3',[req.tenant!.id,input.classId,input.sectionId]);if(!section.rowCount)fail(400,'Section does not belong to this class');}
    const studentIds=input.records.map(row=>row.studentId);
    const enrolled=await client.query(`SELECT student_id FROM student_enrollments WHERE school_id=$1 AND class_id=$2 AND academic_year_id=$3 AND student_id=ANY($4::uuid[])
      AND status='active' AND enrolled_on<=$5::date AND (ended_on IS NULL OR ended_on >= $5::date) AND ($6::uuid IS NULL OR section_id=$6::uuid)`,[req.tenant!.id,input.classId,klass.rows[0].academic_year_id,studentIds,input.date,input.sectionId??null]);
    if(enrolled.rowCount!==studentIds.length)fail(400,'One or more students are not enrolled in the selected class, section, and date');
    const rows=[] as Array<Record<string,unknown>>;
    for(const item of input.records){
      // Serialize writes for this student/date, then store both the current row and its immutable change record.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[item.studentId,input.date]);
      const old=await client.query('SELECT id,school_id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,marked_by,updated_at FROM attendance WHERE school_id=$1 AND student_id=$2 AND attendance_date=$3::date FOR UPDATE',[req.tenant!.id,item.studentId,input.date]);
      if(old.rows[0]&&old.rows[0].class_id!==input.classId)fail(409,'Attendance already exists for this student under another class on this date');
      if(old.rows[0]&&(old.rows[0].status!==item.status||old.rows[0].note!==(item.note??null)))fail(409,'Attendance corrections require the correction endpoint and a reason');
      if(old.rows[0]){rows.push(old.rows[0] as Record<string,unknown>);continue;}
      const saved=old.rows[0]
        ? await client.query(`UPDATE attendance SET status=$4,note=$5,marked_by=$6,updated_at=now(),section_id=$7,academic_year_id=$8 WHERE school_id=$1 AND student_id=$2 AND attendance_date=$3::date RETURNING id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,updated_at`,[req.tenant!.id,item.studentId,input.date,item.status,item.note??null,actor,input.sectionId??null,klass.rows[0].academic_year_id])
        : await client.query(`INSERT INTO attendance(school_id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,marked_by) VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9) RETURNING id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,updated_at`,[req.tenant!.id,item.studentId,input.classId,input.sectionId??null,klass.rows[0].academic_year_id,input.date,item.status,item.note??null,actor]);
      const row=saved.rows[0] as Record<string,unknown>;
      const history=await client.query(`INSERT INTO attendance_history(school_id,attendance_id,actor_membership_id,action,before_state,after_state)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING id`,[req.tenant!.id,row.id,actor,old.rows[0]?'updated':'created',old.rows[0]?JSON.stringify(old.rows[0]):null,JSON.stringify(row)]);
      await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,'attendance',$4,$5::jsonb)`,[req.tenant!.id,actor,old.rows[0]?'attendance.updated':'attendance.created',row.id,JSON.stringify({studentId:item.studentId,date:input.date,status:item.status})]);
      if(item.status==='absent'&&old.rows[0]?.status!=='absent'){
        await client.query(`INSERT INTO background_jobs(school_id,job_type,payload,idempotency_key,status) VALUES($1,'attendance.absence_notification',$2::jsonb,$3,'queued') ON CONFLICT(idempotency_key) DO NOTHING`,[req.tenant!.id,JSON.stringify({attendanceId:row.id,studentId:item.studentId,attendanceDate:input.date,historyId:history.rows[0].id}),`attendance-absence:${history.rows[0].id}`]);
      }
      rows.push(row);
    }
    return rows;
  });
  res.json({date:input.date,classId:input.classId,sectionId:input.sectionId??null,items:result});
}));

const historyAccess=['attendance:read','attendance:read:assigned','attendance:read:linked','attendance:read:self'] as const;
attendanceRouter.get('/attendance/students/:studentId',requireSchoolPermission(...historyAccess),asyncRoute(async(req,res)=>{
  const studentId=uuidSchema.parse(req.params.studentId),pageInfo=pagination.parse(req.query);
  const from=req.query.from?dateSchema.parse(req.query.from):undefined,to=req.query.to?dateSchema.parse(req.query.to):undefined;
  if(from&&to&&from>to)fail(400,'from must be on or before to');
  const data=await tenantTransaction(req.tenant!.id,async client=>{
    const access=await client.query(`SELECT st.id FROM students st WHERE st.school_id=$1 AND st.id=$2 AND (
      ($3::boolean AND st.user_id=$4) OR EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE sp.school_id=st.school_id AND sp.student_id=st.id AND p.user_id=$4 AND $5::boolean)
      OR ($6::boolean AND EXISTS(SELECT 1 FROM teacher_assignments ta JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id AND e.class_id=cs.class_id AND e.status='active' WHERE t.school_id=st.school_id AND t.user_id=$4 AND (ta.section_id IS NULL OR ta.section_id=e.section_id)))
      OR $7::boolean)`,[req.tenant!.id,studentId,req.permissions!.includes('attendance:read:self'),req.identity!.id,req.permissions!.includes('attendance:read:linked'),req.permissions!.includes('attendance:read:assigned'),req.permissions!.includes('attendance:read')]);
    if(!access.rowCount)fail(404,'Student attendance is not available');
    const count=await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status IN ('present','late'))::int AS attended,count(*) FILTER(WHERE status<>'excused')::int AS eligible FROM attendance WHERE school_id=$1 AND student_id=$2 AND ($3::date IS NULL OR attendance_date >= $3::date) AND ($4::date IS NULL OR attendance_date <= $4::date)`,[req.tenant!.id,studentId,from??null,to??null]);
    const items=await client.query(`SELECT attendance_date,status,note,class_id,section_id,updated_at FROM attendance WHERE school_id=$1 AND student_id=$2 AND ($3::date IS NULL OR attendance_date >= $3::date) AND ($4::date IS NULL OR attendance_date <= $4::date) ORDER BY attendance_date DESC LIMIT $5 OFFSET $6`,[req.tenant!.id,studentId,from??null,to??null,pageInfo.pageSize,(pageInfo.page-1)*pageInfo.pageSize]);
    const stats=count.rows[0];return {items:items.rows,total:stats.total,attendancePercentage:stats.eligible?Number(((stats.attended/stats.eligible)*100).toFixed(2)):null,eligibleDays:stats.eligible,attendedDays:stats.attended};
  });
  res.json({studentId,page:pageInfo.page,pageSize:pageInfo.pageSize,...data});
}));

async function report(req:import('express').Request, from:string, to:string, classId?:string, sectionId?:string){
  return tenantTransaction(req.tenant!.id,async client=>{
    if(classId)await canAccessClass(client,req,classId,sectionId,false);
    else if(!req.permissions!.includes('attendance:read'))fail(403,'School-wide attendance report is not authorized');
    const result=await client.query(`SELECT a.class_id,c.name AS class_name,a.section_id,s.name AS section_name,
      count(*)::int AS recorded_days,count(*) FILTER(WHERE a.status='present')::int AS present,
      count(*) FILTER(WHERE a.status='absent')::int AS absent,count(*) FILTER(WHERE a.status='late')::int AS late,
      count(*) FILTER(WHERE a.status='excused')::int AS excused,
      CASE WHEN count(*) FILTER(WHERE a.status<>'excused')=0 THEN NULL ELSE round(100.0*count(*) FILTER(WHERE a.status IN ('present','late'))/count(*) FILTER(WHERE a.status<>'excused'),2) END AS attendance_percentage
      FROM attendance a JOIN classes c ON c.school_id=a.school_id AND c.id=a.class_id LEFT JOIN sections s ON s.school_id=a.school_id AND s.id=a.section_id
      WHERE a.school_id=$1 AND a.attendance_date >= $2::date AND a.attendance_date < $3::date AND ($4::uuid IS NULL OR a.class_id=$4::uuid) AND ($5::uuid IS NULL OR a.section_id=$5::uuid)
      GROUP BY a.class_id,c.name,a.section_id,s.name ORDER BY c.name,s.name NULLS FIRST`,[req.tenant!.id,from,to,classId??null,sectionId??null]);
    return result.rows;
  });
}

attendanceRouter.get('/attendance/reports/monthly',requireSchoolPermission(...readPermissions),asyncRoute(async(req,res)=>{
  const input=z.object({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),classId:uuidSchema.optional(),sectionId:uuidSchema.optional()}).parse(req.query);
  const year=Number(input.month.slice(0,4)),month=Number(input.month.slice(5,7)),from=`${input.month}-01`,to=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
  const items=await report(req,from,to,input.classId,input.sectionId);res.json({month:input.month,items});
}));

attendanceRouter.get('/attendance/reports/annual',requireSchoolPermission(...readPermissions),asyncRoute(async(req,res)=>{
  const input=z.object({year:z.coerce.number().int().min(2000).max(2200),classId:uuidSchema.optional(),sectionId:uuidSchema.optional()}).parse(req.query);
  const items=await report(req,`${input.year}-01-01`,`${input.year+1}-01-01`,input.classId,input.sectionId);res.json({year:input.year,items});
}));

attendanceRouter.get('/attendance/calendar',requireSchoolPermission(...readPermissions),asyncRoute(async(req,res)=>{
  const input=z.object({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),classId:uuidSchema.optional(),sectionId:uuidSchema.optional()}).parse(req.query);
  if(input.sectionId&&!input.classId)fail(400,'classId is required when filtering by sectionId');
  const year=Number(input.month.slice(0,4)),month=Number(input.month.slice(5,7)),from=`${input.month}-01`,to=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
  const items=await tenantTransaction(req.tenant!.id,async client=>{
    if(input.classId){
      const exists=await client.query('SELECT 1 FROM classes WHERE school_id=$1 AND id=$2',[req.tenant!.id,input.classId]);
      if(!exists.rowCount)fail(404,'Class not found');
      if(input.sectionId){const section=await client.query('SELECT 1 FROM sections WHERE school_id=$1 AND class_id=$2 AND id=$3',[req.tenant!.id,input.classId,input.sectionId]);if(!section.rowCount)fail(404,'Section not found');}
      await canAccessClass(client,req,input.classId,input.sectionId,false);
    }else if(!req.permissions!.includes('attendance:read'))fail(403,'School-wide attendance calendar is not authorized');
    return (await client.query(`SELECT to_char(a.attendance_date,'YYYY-MM-DD') AS attendance_date,count(*)::int AS total,
      count(*) FILTER(WHERE a.status='present')::int AS present,
      count(*) FILTER(WHERE a.status='absent')::int AS absent,
      count(*) FILTER(WHERE a.status='late')::int AS late,
      count(*) FILTER(WHERE a.status='excused')::int AS excused,
      CASE WHEN count(*) FILTER(WHERE a.status<>'excused')=0 THEN NULL ELSE round(100.0*count(*) FILTER(WHERE a.status IN ('present','late'))/count(*) FILTER(WHERE a.status<>'excused'),2) END AS attendance_percentage
      FROM attendance a WHERE a.school_id=$1 AND a.attendance_date >= $2::date AND a.attendance_date < $3::date
      AND ($4::uuid IS NULL OR a.class_id=$4::uuid) AND ($5::uuid IS NULL OR a.section_id=$5::uuid)
      GROUP BY a.attendance_date ORDER BY a.attendance_date`,[req.tenant!.id,from,to,input.classId??null,input.sectionId??null])).rows;
  });
  res.json({month:input.month,classId:input.classId??null,sectionId:input.sectionId??null,items});
}));

attendanceRouter.patch('/attendance/:attendanceId',requireSchoolPermission('attendance:manage','attendance:manage:assigned'),asyncRoute(async(req,res)=>{
  const id=uuidSchema.parse(req.params.attendanceId);
  const input=z.object({status:statusSchema,note:z.string().trim().max(500).nullable().optional(),correctionReason:z.string().trim().min(5).max(500)}).parse(req.body);
  const actor=await membershipId(req);
  const updated=await tenantTransaction(req.tenant!.id,async client=>{
    const current=await client.query(`SELECT id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,marked_by,updated_at FROM attendance WHERE school_id=$1 AND id=$2 FOR UPDATE`,[req.tenant!.id,id]);
    if(!current.rows[0])fail(404,'Attendance record not found');
    const old=current.rows[0];
    await canAccessClass(client,req,old.class_id,old.section_id,true);
    const nextNote=input.note===undefined?old.note:input.note;
    if(old.status===input.status&&old.note===nextNote)fail(400,'Correction does not change the attendance record');
    const saved=await client.query(`UPDATE attendance SET status=$3,note=$4,marked_by=$5,updated_at=now() WHERE school_id=$1 AND id=$2
      RETURNING id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,updated_at`,[req.tenant!.id,id,input.status,nextNote,actor]);
    const after={...saved.rows[0],correctionReason:input.correctionReason};
    await client.query(`INSERT INTO attendance_history(school_id,attendance_id,actor_membership_id,action,before_state,after_state) VALUES($1,$2,$3,'updated',$4::jsonb,$5::jsonb)`,[req.tenant!.id,id,actor,JSON.stringify(old),JSON.stringify(after)]);
    await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'attendance.corrected','attendance',$3,$4::jsonb)`,[req.tenant!.id,actor,id,JSON.stringify({studentId:old.student_id,date:old.attendance_date,fromStatus:old.status,toStatus:input.status,reason:input.correctionReason})]);
    if(input.status==='absent'&&old.status!=='absent'){
      const history=await client.query(`SELECT id FROM attendance_history WHERE school_id=$1 AND attendance_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,[req.tenant!.id,id]);
      await client.query(`INSERT INTO background_jobs(school_id,job_type,payload,idempotency_key,status) VALUES($1,'attendance.absence_notification',$2::jsonb,$3,'queued') ON CONFLICT(idempotency_key) DO NOTHING`,[req.tenant!.id,JSON.stringify({attendanceId:id,studentId:old.student_id,attendanceDate:old.attendance_date,historyId:history.rows[0].id}),`attendance-absence:${history.rows[0].id}`]);
    }
    return {...saved.rows[0],correctionReason:input.correctionReason};
  });
  res.json({attendance:updated});
}));

attendanceRouter.get('/attendance/:attendanceId/history',requireSchoolPermission('attendance:read','attendance:read:assigned'),asyncRoute(async(req,res)=>{
  const id=uuidSchema.parse(req.params.attendanceId);
  const items=await tenantTransaction(req.tenant!.id,async client=>{
    const row=await client.query('SELECT class_id,section_id FROM attendance WHERE school_id=$1 AND id=$2',[req.tenant!.id,id]);if(!row.rows[0])fail(404,'Attendance record not found');
    await canAccessClass(client,req,row.rows[0].class_id,row.rows[0].section_id,false);
    return (await client.query(`SELECT h.id,h.action,h.before_state,h.after_state,h.created_at,m.user_id,u.name AS actor_name FROM attendance_history h JOIN school_memberships m ON m.school_id=h.school_id AND m.id=h.actor_membership_id JOIN users u ON u.id=m.user_id WHERE h.school_id=$1 AND h.attendance_id=$2 ORDER BY h.created_at DESC`,[req.tenant!.id,id])).rows;
  });res.json({attendanceId:id,items});
}));

