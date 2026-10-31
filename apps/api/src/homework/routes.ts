import { Router } from 'express';
import { z } from 'zod';
import { tenantTransaction } from '../db/pool.js';
import { asyncRoute, fail } from '../http.js';
import { authenticate, requireSchoolPermission } from '../middleware/auth.js';

export const homeworkRouter = Router();
homeworkRouter.use(authenticate);

const uuid = z.uuid();
const createSchema = z.object({
  classId: uuid,
  sectionId: uuid.optional(),
  subjectId: uuid,
  teacherId: uuid.optional(),
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(10000).default(''),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  maxScore: z.number().finite().min(0).max(100000).optional(),
  attachments: z.array(z.object({ fileId: uuid, displayName: z.string().trim().min(1).max(180) })).max(20).default([]),
  publish: z.boolean().default(false),
});
const submitSchema = z.object({ responseText: z.string().trim().max(20000).default(''), fileId: uuid.optional() });
const reviewSchema = z.object({ score: z.number().finite().min(0).max(100000).nullable().optional(), feedback: z.string().trim().max(10000).nullable().optional() });
const statusSchema = z.object({ status: z.enum(['published', 'archived']) });

type Req = import('express').Request;
function has(req: Req, ...names: string[]) { return names.some(name => req.permissions?.includes(name)); }
async function actorMembership(client: import('../db/pool.js').DbClient, schoolId: string, userId: string) {
  const result = await client.query('SELECT id,role FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active',[schoolId,userId]);
  if (!result.rows[0]) fail(403,'Active school membership is required');
  return result.rows[0] as {id:string;role:string};
}
async function audit(client: import('../db/pool.js').DbClient, schoolId: string, membershipId: string, assignmentId: string, action: string, after: object, before?: object, submissionId?: string) {
  await client.query('INSERT INTO assignment_audit_history(school_id,assignment_id,submission_id,actor_membership_id,action,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6,$7)',[schoolId,assignmentId,submissionId??null,membershipId,action,before?JSON.stringify(before):null,JSON.stringify(after)]);
  await client.query('INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[schoolId,membershipId,`homework.${action}`,submissionId?'assignment_submission':'assignment',submissionId??assignmentId,JSON.stringify(after)]);
}

const visiblePermission = ['homework:read','homework:read:assigned','homework:read:linked','homework:read:self'] as const;
homeworkRouter.get('/teachers',requireSchoolPermission('homework:manage'),asyncRoute(async(req,res)=>{
  const input=z.object({classId:uuid,subjectId:uuid,sectionId:uuid.optional()}).parse(req.query);
  const items=await tenantTransaction(req.tenant!.id,async client=>{
    const target=await client.query('SELECT 1 FROM class_subjects WHERE school_id=$1 AND class_id=$2 AND subject_id=$3',[req.tenant!.id,input.classId,input.subjectId]);
    if(!target.rowCount)fail(404,'Class subject allocation not found');
    if(input.sectionId){const section=await client.query('SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3',[req.tenant!.id,input.sectionId,input.classId]);if(!section.rowCount)fail(404,'Section not found');}
    return (await client.query(`SELECT DISTINCT t.id AS teacher_id,t.employee_id,COALESCE(u.name,t.employee_id,'Teacher') AS name
      FROM teacher_assignments ta JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id
      LEFT JOIN users u ON u.id=t.user_id
      WHERE ta.school_id=$1 AND ta.class_subject_id=(SELECT cs.id FROM class_subjects cs WHERE cs.school_id=$1 AND cs.class_id=$2 AND cs.subject_id=$3)
        AND t.employment_status='active' AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM $4::uuid)
      ORDER BY name`,[req.tenant!.id,input.classId,input.subjectId,input.sectionId??null])).rows;
  });
  res.json({items});
}));

homeworkRouter.get('/assignments',requireSchoolPermission(...visiblePermission),asyncRoute(async(req,res)=>{
  const schoolId=req.tenant!.id,userId=req.identity!.id;
  const limit=Math.min(100,Math.max(1,Number(req.query.limit)||30)),page=Math.max(1,Number(req.query.page)||1);
  const classId=typeof req.query.classId==='string'?uuid.parse(req.query.classId):null;
  const status=typeof req.query.status==='string'?z.enum(['draft','published','archived']).parse(req.query.status):null;
  const scope={all:has(req,'homework:read'),assigned:has(req,'homework:read:assigned'),linked:has(req,'homework:read:linked'),self:has(req,'homework:read:self')};
  const data=await tenantTransaction(schoolId,async client=>{
    const params=[schoolId,userId,scope.all,scope.assigned,scope.linked,scope.self,classId,status,limit,(page-1)*limit];
    const where=`a.school_id=$1 AND ($3::boolean OR a.status<>'draft') AND ($7::uuid IS NULL OR a.class_id=$7) AND ($8::text IS NULL OR a.status=$8) AND (
      $3::boolean OR
      ($4::boolean AND EXISTS(SELECT 1 FROM teachers tx JOIN teacher_assignments ta ON ta.school_id=tx.school_id AND ta.teacher_id=tx.id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE tx.school_id=a.school_id AND tx.user_id=$2 AND tx.employment_status='active' AND cs.class_id=a.class_id AND cs.subject_id=a.subject_id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM a.section_id))) OR
      ($5::boolean AND EXISTS(SELECT 1 FROM student_enrollments e JOIN student_parents sp ON sp.school_id=e.school_id AND sp.student_id=e.student_id JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE e.school_id=a.school_id AND p.user_id=$2 AND e.status='active' AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id))) OR
      ($6::boolean AND EXISTS(SELECT 1 FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id WHERE st.school_id=a.school_id AND st.user_id=$2 AND e.status='active' AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id)))
    )`;
    const rows=await client.query(`SELECT a.id,a.class_id,c.name AS class_name,a.section_id,s.name AS section_name,a.subject_id,sub.name AS subject_name,a.teacher_id,t.employee_id,a.title,a.description,a.due_at,a.max_score,a.status,a.published_at,a.created_at,a.updated_at,
      CASE WHEN $3::boolean OR $4::boolean THEN (SELECT count(*)::int FROM assignment_submissions ss WHERE ss.school_id=a.school_id AND ss.assignment_id=a.id AND ss.submitted_at IS NOT NULL) ELSE NULL END AS submitted_count,
      CASE WHEN $3::boolean OR $4::boolean THEN (SELECT count(*)::int FROM student_enrollments e WHERE e.school_id=a.school_id AND e.status='active' AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id)) ELSE NULL END AS target_count,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('studentId',st.id,'studentName',concat_ws(' ',st.first_name,st.last_name),'submittedAt',ss.submitted_at,'isLate',ss.submitted_at IS NOT NULL AND a.due_at IS NOT NULL AND ss.submitted_at>a.due_at,'score',ss.score,'feedback',ss.feedback) ORDER BY st.last_name,st.first_name)
        FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id AND e.status='active' JOIN student_parents sp ON sp.school_id=st.school_id AND sp.student_id=st.id JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id LEFT JOIN assignment_submissions ss ON ss.school_id=a.school_id AND ss.assignment_id=a.id AND ss.student_id=st.id
        WHERE $5::boolean AND p.user_id=$2 AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id)), '[]'::jsonb) AS linked_child_submissions,
      (SELECT jsonb_build_object('submittedAt',ss.submitted_at,'isLate',ss.submitted_at IS NOT NULL AND a.due_at IS NOT NULL AND ss.submitted_at>a.due_at,'score',ss.score,'feedback',ss.feedback)
        FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id AND e.status='active' LEFT JOIN assignment_submissions ss ON ss.school_id=a.school_id AND ss.assignment_id=a.id AND ss.student_id=st.id WHERE $6::boolean AND st.school_id=a.school_id AND st.user_id=$2 AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id) LIMIT 1) AS own_submission
      FROM assignments a JOIN classes c ON c.school_id=a.school_id AND c.id=a.class_id JOIN subjects sub ON sub.school_id=a.school_id AND sub.id=a.subject_id JOIN teachers t ON t.school_id=a.school_id AND t.id=a.teacher_id LEFT JOIN sections s ON s.school_id=a.school_id AND s.id=a.section_id WHERE ${where} ORDER BY a.due_at NULLS LAST,a.created_at DESC LIMIT $9 OFFSET $10`,params);
    const count=await client.query(`SELECT count(*)::int AS total FROM assignments a WHERE ${where}`,[...params.slice(0,8)]);
    return {items:rows.rows,total:count.rows[0].total};
  });
  res.json({...data,page,limit});
}));

homeworkRouter.post('/assignments',requireSchoolPermission('homework:manage','homework:manage:assigned'),asyncRoute(async(req,res)=>{
  const data=createSchema.parse(req.body),schoolId=req.tenant!.id,userId=req.identity!.id;
  const created=await tenantTransaction(schoolId,async client=>{
    const membership=await actorMembership(client,schoolId,userId);
    let teacherId:string|undefined;
    const assignedOnly=!has(req,'homework:manage');
    if(assignedOnly){
      const own=await client.query("SELECT id FROM teachers WHERE school_id=$1 AND user_id=$2 AND employment_status='active'",[schoolId,userId]);
      if(!own.rows[0])fail(403,'An active teacher profile is required');
      teacherId=own.rows[0].id;
      if(data.teacherId&&data.teacherId!==teacherId)fail(403,'Teachers may create assignments only under their own profile');
    } else teacherId=data.teacherId??(await client.query("SELECT id FROM teachers WHERE school_id=$1 AND user_id=$2 AND employment_status='active'",[schoolId,userId])).rows[0]?.id;
    if(!teacherId)fail(400,'Select the teacher responsible for this assignment');
    const target=await client.query('SELECT c.id FROM classes c JOIN class_subjects cs ON cs.school_id=c.school_id AND cs.class_id=c.id AND cs.subject_id=$3 WHERE c.school_id=$1 AND c.id=$2',[schoolId,data.classId,data.subjectId]);
    if(!target.rowCount)fail(400,'The subject is not allocated to the selected class');
    if(data.sectionId){const section=await client.query('SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3',[schoolId,data.sectionId,data.classId]);if(!section.rowCount)fail(400,'The section does not belong to the selected class');}
    const teacher=await client.query("SELECT id FROM teachers WHERE school_id=$1 AND id=$2 AND employment_status='active'",[schoolId,teacherId]);
    if(!teacher.rowCount)fail(400,'The selected teacher is unavailable');
    if(assignedOnly){const allowed=await client.query(`SELECT 1 FROM teacher_assignments ta JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE ta.school_id=$1 AND ta.teacher_id=$2 AND cs.class_id=$3 AND cs.subject_id=$4 AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM $5::uuid)`,[schoolId,teacherId,data.classId,data.subjectId,data.sectionId??null]);if(!allowed.rowCount)fail(403,'The class, section, and subject are not assigned to you');}
    if(data.attachments.length){const fileIds=[...new Set(data.attachments.map(item=>item.fileId))];const files=await client.query('SELECT id FROM uploaded_files WHERE school_id=$1 AND id=ANY($2::uuid[])',[schoolId,fileIds]);if(files.rowCount!==fileIds.length)fail(400,'An attachment is unavailable in this school');}
    const assignment=await client.query(`INSERT INTO assignments(school_id,class_id,section_id,subject_id,teacher_id,title,description,due_at,published_at,status,max_score)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $9 THEN now() END,CASE WHEN $9 THEN 'published' ELSE 'draft' END,$10)
      RETURNING id,class_id,section_id,subject_id,teacher_id,title,description,due_at,max_score,status,published_at,created_at,updated_at`,[schoolId,data.classId,data.sectionId??null,data.subjectId,teacherId,data.title,data.description,data.dueAt??null,data.publish,data.maxScore??null]);
    for(const attachment of data.attachments)await client.query('INSERT INTO assignment_attachments(school_id,assignment_id,file_id,display_name) VALUES($1,$2,$3,$4)',[schoolId,assignment.rows[0].id,attachment.fileId,attachment.displayName]);
    await audit(client,schoolId,membership.id,assignment.rows[0].id,'created',{status:assignment.rows[0].status,title:data.title,attachmentCount:data.attachments.length});
    if(data.publish)await audit(client,schoolId,membership.id,assignment.rows[0].id,'published',{publishedAt:assignment.rows[0].published_at});
    return assignment.rows[0];
  });
  res.status(201).json({assignment:created});
}));

homeworkRouter.get('/assignments/:id',requireSchoolPermission(...visiblePermission),asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),schoolId=req.tenant!.id,userId=req.identity!.id;
  const result=await tenantTransaction(schoolId,async client=>{
    const scope={all:has(req,'homework:read'),assigned:has(req,'homework:read:assigned'),linked:has(req,'homework:read:linked'),self:has(req,'homework:read:self')};
    const item=await client.query(`SELECT a.id,a.class_id,c.name AS class_name,a.section_id,s.name AS section_name,a.subject_id,sub.name AS subject_name,a.teacher_id,a.title,a.description,a.due_at,a.max_score,a.status,a.published_at,a.created_at,a.updated_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('fileId',f.id,'displayName',aa.display_name,'mimeType',f.mime_type,'byteSize',f.byte_size) ORDER BY aa.created_at) FROM assignment_attachments aa JOIN uploaded_files f ON f.school_id=aa.school_id AND f.id=aa.file_id WHERE aa.school_id=a.school_id AND aa.assignment_id=a.id),'[]'::jsonb) AS attachments
      FROM assignments a JOIN classes c ON c.school_id=a.school_id AND c.id=a.class_id JOIN subjects sub ON sub.school_id=a.school_id AND sub.id=a.subject_id LEFT JOIN sections s ON s.school_id=a.school_id AND s.id=a.section_id
      WHERE a.school_id=$1 AND a.id=$2 AND ($3::boolean OR a.status<>'draft') AND (
        $3::boolean OR
        ($4::boolean AND EXISTS(SELECT 1 FROM teachers tx JOIN teacher_assignments ta ON ta.school_id=tx.school_id AND ta.teacher_id=tx.id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE tx.school_id=a.school_id AND tx.user_id=$5 AND cs.class_id=a.class_id AND cs.subject_id=a.subject_id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM a.section_id))) OR
        ($6::boolean AND EXISTS(SELECT 1 FROM student_enrollments e JOIN student_parents sp ON sp.school_id=e.school_id AND sp.student_id=e.student_id JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE e.school_id=a.school_id AND p.user_id=$5 AND e.status='active' AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id))) OR
        ($7::boolean AND EXISTS(SELECT 1 FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id WHERE st.school_id=a.school_id AND st.user_id=$5 AND e.status='active' AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id))))`,[schoolId,id,scope.all,scope.assigned,userId,scope.linked,scope.self]);
    if(!item.rows[0])fail(404,'Assignment not found');
    const attachments=await client.query('SELECT f.id AS file_id,f.mime_type,f.byte_size,aa.display_name FROM assignment_attachments aa JOIN uploaded_files f ON f.school_id=aa.school_id AND f.id=aa.file_id WHERE aa.school_id=$1 AND aa.assignment_id=$2 ORDER BY aa.created_at',[schoolId,id]);
    return {...item.rows[0],attachments:attachments.rows};
  });
  res.json({assignment:result});
}));

homeworkRouter.patch('/assignments/:id/status',requireSchoolPermission('homework:manage','homework:manage:assigned'),asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),{status}=statusSchema.parse(req.body),schoolId=req.tenant!.id,userId=req.identity!.id;
  const result=await tenantTransaction(schoolId,async client=>{
    const membership=await actorMembership(client,schoolId,userId);
    const assignment=await client.query('SELECT a.id,a.teacher_id,a.status,a.published_at FROM assignments a WHERE a.school_id=$1 AND a.id=$2 FOR UPDATE',[schoolId,id]);if(!assignment.rows[0])fail(404,'Assignment not found');
    if(!has(req,'homework:manage')){const own=await client.query('SELECT 1 FROM teachers WHERE school_id=$1 AND id=$2 AND user_id=$3',[schoolId,assignment.rows[0].teacher_id,userId]);if(!own.rowCount)fail(403,'You can only manage assignments you own');}
    if(status==='published'&&assignment.rows[0].status==='archived')fail(409,'An archived assignment cannot be republished');
    const updated=await client.query("UPDATE assignments SET status=$3,published_at=CASE WHEN $3='published' THEN COALESCE(published_at,now()) ELSE published_at END,updated_at=now() WHERE school_id=$1 AND id=$2 RETURNING id,status,published_at,updated_at",[schoolId,id,status]);
    await audit(client,schoolId,membership.id,id,status,{status:updated.rows[0].status},{status:assignment.rows[0].status});return updated.rows[0];
  });
  res.json({assignment:result});
}));

homeworkRouter.post('/assignments/:id/submission',requireSchoolPermission('homework:read:self'),asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),data=submitSchema.parse(req.body),schoolId=req.tenant!.id,userId=req.identity!.id;
  const result=await tenantTransaction(schoolId,async client=>{
    const membership=await actorMembership(client,schoolId,userId);
    const student=await client.query('SELECT id FROM students WHERE school_id=$1 AND user_id=$2 AND status=\'active\'',[schoolId,userId]);if(!student.rows[0])fail(403,'Student profile is not linked to this account');
    const assignment=await client.query("SELECT id,due_at,class_id,section_id,status FROM assignments WHERE school_id=$1 AND id=$2 AND status='published'",[schoolId,id]);if(!assignment.rows[0])fail(404,'Published assignment not found');
    const enrollment=await client.query("SELECT 1 FROM student_enrollments WHERE school_id=$1 AND student_id=$2 AND status='active' AND class_id=$3 AND ($4::uuid IS NULL OR section_id=$4)",[schoolId,student.rows[0].id,assignment.rows[0].class_id,assignment.rows[0].section_id]);if(!enrollment.rowCount)fail(403,'Assignment is not assigned to your class or section');
    if(data.fileId){const file=await client.query('SELECT 1 FROM uploaded_files WHERE school_id=$1 AND id=$2',[schoolId,data.fileId]);if(!file.rowCount)fail(400,'The submission file is unavailable in this school');}
    const previous=await client.query('SELECT id,submitted_at,response_text,file_id,score,feedback FROM assignment_submissions WHERE school_id=$1 AND assignment_id=$2 AND student_id=$3 FOR UPDATE',[schoolId,id,student.rows[0].id]);
    if(previous.rows[0]?.score!==null&&previous.rows[0]?.score!==undefined)fail(409,'A graded submission cannot be changed');
    const saved=await client.query(`INSERT INTO assignment_submissions(school_id,assignment_id,student_id,submitted_at,file_id,response_text,updated_at)
      VALUES($1,$2,$3,now(),$4,$5,now()) ON CONFLICT(school_id,assignment_id,student_id) DO UPDATE SET submitted_at=now(),file_id=EXCLUDED.file_id,response_text=EXCLUDED.response_text,updated_at=now()
      RETURNING id,assignment_id,student_id,submitted_at,file_id,response_text,score,feedback,updated_at`,[schoolId,id,student.rows[0].id,data.fileId??null,data.responseText]);
    await audit(client,schoolId,membership.id,id,'submitted',{submittedAt:saved.rows[0].submitted_at,isLate:assignment.rows[0].due_at!==null&&new Date(saved.rows[0].submitted_at)>new Date(assignment.rows[0].due_at)},previous.rows[0]?{submittedAt:previous.rows[0].submitted_at}:undefined,saved.rows[0].id);
    return {...saved.rows[0],isLate:assignment.rows[0].due_at!==null&&new Date(saved.rows[0].submitted_at)>new Date(assignment.rows[0].due_at)};
  });
  res.status(201).json({submission:result});
}));

homeworkRouter.get('/assignments/:id/submissions',requireSchoolPermission('homework:manage','homework:manage:assigned'),asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),schoolId=req.tenant!.id,userId=req.identity!.id;
  const data=await tenantTransaction(schoolId,async client=>{
    const assignment=await client.query('SELECT id,class_id,section_id,teacher_id,due_at,max_score FROM assignments WHERE school_id=$1 AND id=$2',[schoolId,id]);if(!assignment.rows[0])fail(404,'Assignment not found');
    if(!has(req,'homework:manage')){const own=await client.query('SELECT 1 FROM teachers WHERE school_id=$1 AND id=$2 AND user_id=$3',[schoolId,assignment.rows[0].teacher_id,userId]);if(!own.rowCount)fail(403,'You can only review your own assignments');}
    const rows=await client.query(`SELECT st.id AS student_id,st.admission_number,st.first_name,st.last_name,ss.id AS submission_id,ss.submitted_at,ss.file_id,ss.response_text,ss.score,ss.feedback,ss.reviewed_at,
      (ss.submitted_at IS NOT NULL AND a.due_at IS NOT NULL AND ss.submitted_at>a.due_at) AS is_late
      FROM student_enrollments e JOIN students st ON st.school_id=e.school_id AND st.id=e.student_id JOIN assignments a ON a.school_id=e.school_id AND a.class_id=e.class_id AND a.id=$2 AND (a.section_id IS NULL OR a.section_id=e.section_id)
      LEFT JOIN assignment_submissions ss ON ss.school_id=a.school_id AND ss.assignment_id=a.id AND ss.student_id=st.id
      WHERE e.school_id=$1 AND e.status='active' ORDER BY st.last_name,st.first_name`,[schoolId,id]);
    return {assignment:assignment.rows[0],items:rows.rows};
  });
  res.json(data);
}));

homeworkRouter.patch('/assignments/:id/submissions/:submissionId/review',requireSchoolPermission('homework:manage','homework:manage:assigned'),asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),submissionId=uuid.parse(req.params.submissionId),data=reviewSchema.parse(req.body),schoolId=req.tenant!.id,userId=req.identity!.id;
  const updated=await tenantTransaction(schoolId,async client=>{
    const membership=await actorMembership(client,schoolId,userId);
    const assignment=await client.query('SELECT teacher_id,max_score FROM assignments WHERE school_id=$1 AND id=$2',[schoolId,id]);if(!assignment.rows[0])fail(404,'Assignment not found');
    if(!has(req,'homework:manage')){const own=await client.query('SELECT 1 FROM teachers WHERE school_id=$1 AND id=$2 AND user_id=$3',[schoolId,assignment.rows[0].teacher_id,userId]);if(!own.rowCount)fail(403,'You can only review your own assignments');}
    if(data.score!==undefined&&data.score!==null&&assignment.rows[0].max_score!==null&&data.score>Number(assignment.rows[0].max_score))fail(400,'Score cannot exceed the assignment maximum');
    const before=await client.query('SELECT id,score,feedback FROM assignment_submissions WHERE school_id=$1 AND assignment_id=$2 AND id=$3 FOR UPDATE',[schoolId,id,submissionId]);if(!before.rows[0])fail(404,'Submission not found');
    const saved=await client.query('UPDATE assignment_submissions SET score=COALESCE($4,score),feedback=COALESCE($5,feedback),reviewed_by=$6,reviewed_at=now(),updated_at=now() WHERE school_id=$1 AND assignment_id=$2 AND id=$3 RETURNING id,assignment_id,student_id,score,feedback,reviewed_by,reviewed_at,updated_at',[schoolId,id,submissionId,data.score??null,data.feedback??null,membership.id]);
    await audit(client,schoolId,membership.id,id,'reviewed',{score:saved.rows[0].score,feedback:saved.rows[0].feedback},{score:before.rows[0].score,feedback:before.rows[0].feedback},submissionId);return saved.rows[0];
  });
  res.json({submission:updated});
}));

homeworkRouter.get('/dashboard',requireSchoolPermission('homework:read','homework:read:assigned'),asyncRoute(async(req,res)=>{
  const schoolId=req.tenant!.id,userId=req.identity!.id;
  const metrics=await tenantTransaction(schoolId,client=>client.query(`SELECT count(DISTINCT a.id)::int AS assignments,
    count(DISTINCT ss.id) FILTER(WHERE ss.submitted_at IS NOT NULL)::int AS submissions,
    count(DISTINCT ss.id) FILTER(WHERE ss.submitted_at IS NOT NULL AND a.due_at IS NOT NULL AND ss.submitted_at>a.due_at)::int AS late_submissions,
    count(DISTINCT ss.id) FILTER(WHERE ss.submitted_at IS NOT NULL AND ss.score IS NULL)::int AS awaiting_review
    FROM assignments a LEFT JOIN assignment_submissions ss ON ss.school_id=a.school_id AND ss.assignment_id=a.id
    WHERE a.school_id=$1 AND a.status='published' AND ($3::boolean OR ($4::boolean AND EXISTS(SELECT 1 FROM teachers t JOIN teacher_assignments ta ON ta.school_id=t.school_id AND ta.teacher_id=t.id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE t.school_id=a.school_id AND t.user_id=$2 AND cs.class_id=a.class_id AND cs.subject_id=a.subject_id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM a.section_id))))`,[schoolId,userId,has(req,'homework:read'),has(req,'homework:read:assigned')]));
  res.json({metrics:metrics.rows[0]});
}));
