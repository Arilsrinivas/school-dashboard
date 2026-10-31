import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

process.env.NODE_ENV='test';
process.env.ACCESS_TOKEN_SECRET='local-test-access-secret-that-is-long-enough';
process.env.REFRESH_TOKEN_SECRET='different-local-test-refresh-secret-long-enough';

test('homework creation, assigned/student/parent scopes, submissions, grading and tenant isolation use PostgreSQL',async()=>{
  const db=await PGlite.create();
  const migrationDir=new URL('../../migrations/',import.meta.url);
  const migrationNames=(await readdir(migrationDir)).filter(name=>name.endsWith('.sql')).sort();
  for(const name of migrationNames){let sql=await readFile(new URL(name,migrationDir),'utf8');sql=sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/,'');await db.exec(sql);}
  await db.exec('CREATE ROLE educonnect_app LOGIN NOBYPASSRLS; CREATE ROLE educonnect_platform LOGIN BYPASSRLS; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO educonnect_app,educonnect_platform; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO educonnect_app,educonnect_platform;');
  const socket=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:16});await socket.start();
  const port=Number(socket.getServerConn().split(':').at(-1));
  process.env.DATABASE_URL=`postgresql://educonnect_app@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.PLATFORM_DATABASE_URL=`postgresql://educonnect_platform@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.MIGRATION_DATABASE_URL=process.env.PLATFORM_DATABASE_URL;
  const [{pool,platformPool,tenantTransaction},{signAccess},{homeworkRouter}]=await Promise.all([import('../db/pool.js'),import('../auth/tokens.js'),import('./routes.js')]);
  pool.on('acquire',client=>{void client.query('SET ROLE educonnect_app');});platformPool.on('acquire',client=>{void client.query('SET ROLE educonnect_platform');});
  const app=express();app.use(express.json());app.use('/api/school/homework',homeworkRouter);
  const server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
  const call=async(path:string,token:string,init:RequestInit={})=>fetch(`${base}${path}`,{...init,headers:{Authorization:`Bearer ${token}`,...(init.body?{'Content-Type':'application/json'}:{}),...init.headers}});
  const schools:string[]=[],users:string[]=[];
  try{
    const appToken=(id:string,schoolId:string)=>signAccess({kind:'school',id,role:'school_admin',schoolId});
    const makeSchool=async(label:string)=>{
      const plan=(await platformPool.query("SELECT id FROM subscription_plans WHERE billing_interval='trial' LIMIT 1")).rows[0];
      const school=(await platformPool.query("INSERT INTO schools(name,contact_email,status) VALUES($1,$2,'active') RETURNING id,school_id",[`Homework ${label} ${randomUUID()}`,`${randomUUID()}@test.invalid`])).rows[0];schools.push(school.id);
      await platformPool.query("INSERT INTO subscriptions(school_id,plan_id,status) VALUES($1,$2,'trialing')",[school.id,plan.id]);
      return school as {id:string;school_id:string};
    };
    const schoolA=await makeSchool('A'),schoolB=await makeSchool('B');
    const addUser=async(schoolId:string,kind:'teacher'|'parent'|'student')=>{
      const id=randomUUID();users.push(id);await platformPool.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[id,`${randomUUID()}@test.invalid`,`${kind} ${id.slice(0,5)}`,'not-used']);
      const membership=(await tenantTransaction(schoolId,async client=>{const role=(await client.query('SELECT id FROM school_roles WHERE school_id=$1 AND code=$2',[schoolId,kind])).rows[0];return client.query('INSERT INTO school_memberships(school_id,user_id,role,school_role_id) VALUES($1,$2,$3,$4) RETURNING id',[schoolId,id,kind,role.id]);})).rows[0];
      return {id,membershipId:membership.id,token:await appToken(id,schoolId)};
    };
    const teacher=await addUser(schoolA.id,'teacher'),parent=await addUser(schoolA.id,'parent'),studentUser=await addUser(schoolA.id,'student');
    const secondTeacher=await addUser(schoolA.id,'teacher');
    const studentBUser=await addUser(schoolB.id,'student');
    const seedA=await tenantTransaction(schoolA.id,async client=>{
      const year=(await client.query("INSERT INTO academic_years(school_id,name,starts_on,ends_on,is_current) VALUES($1,'2026-27',CURRENT_DATE,CURRENT_DATE+365,true) RETURNING id",[schoolA.id])).rows[0].id;
      const klass=(await client.query("INSERT INTO classes(school_id,academic_year_id,name) VALUES($1,$2,'Grade 5') RETURNING id",[schoolA.id,year])).rows[0].id;
      const section=(await client.query("INSERT INTO sections(school_id,class_id,name) VALUES($1,$2,'A') RETURNING id",[schoolA.id,klass])).rows[0].id;
      const subject=(await client.query("INSERT INTO subjects(school_id,name) VALUES($1,'Math') RETURNING id",[schoolA.id])).rows[0].id;
      const classSubject=(await client.query('INSERT INTO class_subjects(school_id,class_id,subject_id) VALUES($1,$2,$3) RETURNING id',[schoolA.id,klass,subject])).rows[0].id;
      const teach=(await client.query('INSERT INTO teachers(school_id,user_id,employee_id) VALUES($1,$2,$3) RETURNING id',[schoolA.id,teacher.id,`EMP-${randomUUID()}`])).rows[0].id;
      await client.query('INSERT INTO teacher_assignments(school_id,teacher_id,class_subject_id,section_id) VALUES($1,$2,$3,$4)',[schoolA.id,teach,classSubject,section]);
      const unrelated=(await client.query('INSERT INTO teachers(school_id,user_id,employee_id) VALUES($1,$2,$3) RETURNING id',[schoolA.id,secondTeacher.id,`EMP-${randomUUID()}`])).rows[0].id;
      const student=(await client.query("INSERT INTO students(school_id,user_id,admission_number,first_name,last_name) VALUES($1,$2,$3,'Lina','Student') RETURNING id",[schoolA.id,studentUser.id,`ADM-${randomUUID()}`])).rows[0].id;
      await client.query('INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id) VALUES($1,$2,$3,$4,$5)',[schoolA.id,student,year,klass,section]);
      const parentId=(await client.query("INSERT INTO parents(school_id,user_id,relationship) VALUES($1,$2,'guardian') RETURNING id",[schoolA.id,parent.id])).rows[0].id;
      await client.query('INSERT INTO student_parents(school_id,student_id,parent_id) VALUES($1,$2,$3)',[schoolA.id,student,parentId]);
      const upload=(await client.query('INSERT INTO uploaded_files(school_id,uploaded_by,object_key,mime_type,byte_size) VALUES($1,$2,$3,$4,$5) RETURNING id',[schoolA.id,teacher.membershipId,`assignments/${randomUUID()}.pdf`,'application/pdf',120])).rows[0].id;
      return {year,klass,section,subject,student,teach,unrelated,upload};
    });
    const seedB=await tenantTransaction(schoolB.id,async client=>{
      const year=(await client.query("INSERT INTO academic_years(school_id,name,starts_on,ends_on,is_current) VALUES($1,'2026-27',CURRENT_DATE,CURRENT_DATE+365,true) RETURNING id",[schoolB.id])).rows[0].id;
      const klass=(await client.query("INSERT INTO classes(school_id,academic_year_id,name) VALUES($1,$2,'Private class') RETURNING id",[schoolB.id,year])).rows[0].id;
      const subject=(await client.query("INSERT INTO subjects(school_id,name) VALUES($1,'Private') RETURNING id",[schoolB.id])).rows[0].id;
      await client.query('INSERT INTO class_subjects(school_id,class_id,subject_id) VALUES($1,$2,$3)',[schoolB.id,klass,subject]);
      const teacher=(await client.query('INSERT INTO teachers(school_id,employee_id) VALUES($1,$2) RETURNING id',[schoolB.id,`EMP-${randomUUID()}`])).rows[0].id;
      return {year,klass,subject,teacher};
    });
    const created=await call('/api/school/homework/assignments',teacher.token,{method:'POST',body:JSON.stringify({classId:seedA.klass,sectionId:seedA.section,subjectId:seedA.subject,title:'Fractions worksheet',description:'Complete questions 1–8',dueAt:new Date(Date.now()-60_000).toISOString(),maxScore:20,publish:true,attachments:[{fileId:seedA.upload,displayName:'Worksheet.pdf'}]})});
    assert.equal(created.status,201,await created.clone().text());const assignment=(await created.json() as {assignment:{id:string;status:string}}).assignment;assert.equal(assignment.status,'published');
    const teacherList=await call('/api/school/homework/assignments',teacher.token);assert.equal(teacherList.status,200);const teacherItems=await teacherList.json() as {items:{id:string}[];total:number};assert.equal(teacherItems.total,1);assert.equal(teacherItems.items[0]?.id,assignment.id);
    const unrelatedRead=await call(`/api/school/homework/assignments/${assignment.id}`,secondTeacher.token);assert.equal(unrelatedRead.status,404,'an assigned-only teacher cannot read another teacher’s assignment');
    const studentList=await call('/api/school/homework/assignments',studentUser.token);assert.equal(studentList.status,200);assert.equal((await studentList.json() as {total:number}).total,1);
    const submit=await call(`/api/school/homework/assignments/${assignment.id}/submission`,studentUser.token,{method:'POST',body:JSON.stringify({responseText:'Answers submitted'})});assert.equal(submit.status,201,await submit.clone().text());const submission=(await submit.json() as {submission:{id:string;isLate:boolean}}).submission;assert.equal(submission.isLate,true,'late submissions are calculated from deadline at write time');
    const parentList=await call('/api/school/homework/assignments',parent.token);assert.equal(parentList.status,200);const parentItems=await parentList.json() as {items:{id:string;linked_child_submissions:{studentId:string;submittedAt:string|null}[]}[]};assert.equal(parentItems.items.length,1);assert.equal(parentItems.items[0]?.linked_child_submissions[0]?.studentId,seedA.student);
    const teacherSubmissions=await call(`/api/school/homework/assignments/${assignment.id}/submissions`,teacher.token);assert.equal(teacherSubmissions.status,200);const submissions=(await teacherSubmissions.json() as {items:{submission_id:string|null}[]}).items;assert.equal(submissions.length,1);assert.equal(submissions[0]?.submission_id,submission.id);
    const grade=await call(`/api/school/homework/assignments/${assignment.id}/submissions/${submission.id}/review`,teacher.token,{method:'PATCH',body:JSON.stringify({score:18,feedback:'Good work'})});assert.equal(grade.status,200,await grade.clone().text());assert.equal(Number((await grade.json() as {submission:{score:number|string}}).submission.score),18);
    const overMax=await call(`/api/school/homework/assignments/${assignment.id}/submissions/${submission.id}/review`,teacher.token,{method:'PATCH',body:JSON.stringify({score:21})});assert.equal(overMax.status,400,'marks cannot exceed configured maximum');
    const crossSchool=await tenantTransaction(schoolB.id,async client=>{
      const t=(await client.query('INSERT INTO teachers(school_id,employee_id) VALUES($1,$2) RETURNING id',[schoolB.id,`EMP-${randomUUID()}`])).rows[0].id;
      return client.query(`INSERT INTO assignments(school_id,class_id,subject_id,teacher_id,title,status,published_at) VALUES($1,$2,$3,$4,'Private assignment','published',now()) RETURNING id`,[schoolB.id,seedB.klass,seedB.subject,t]);
    });
    const foreignRead=await call(`/api/school/homework/assignments/${crossSchool.rows[0].id}`,teacher.token);assert.equal(foreignRead.status,404,'foreign-school assignment IDs are not observable');
    const invalidAttachment=await call('/api/school/homework/assignments',teacher.token,{method:'POST',body:JSON.stringify({classId:seedA.klass,sectionId:seedA.section,subjectId:seedA.subject,title:'Wrong tenant file',publish:true,attachments:[{fileId:randomUUID(),displayName:'foreign.pdf'}]})});assert.equal(invalidAttachment.status,400,'unavailable attachment IDs are rejected without cross-tenant lookup');
    const auditRows=await tenantTransaction(schoolA.id,client=>client.query('SELECT action FROM assignment_audit_history WHERE school_id=$1 AND assignment_id=$2',[schoolA.id,assignment.id]));assert.deepEqual(auditRows.rows.map((row:{action:string})=>row.action).sort(),['created','published','reviewed','submitted']);
    assert.ok(seedB.teacher&&seedB.year&&seedA.unrelated);
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    if(schools.length){await platformPool.query('DELETE FROM subscriptions WHERE school_id=ANY($1::uuid[])',[schools]);await platformPool.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[schools]);}
    if(users.length)await platformPool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
    await Promise.all([pool.end(),platformPool.end()]);await socket.stop();await db.close();
  }
});
