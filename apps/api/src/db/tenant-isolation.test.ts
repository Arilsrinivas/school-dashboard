import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import argon2 from 'argon2';

process.env.NODE_ENV='test';
process.env.ACCESS_TOKEN_SECRET='local-test-access-secret-that-is-long-enough';
process.env.REFRESH_TOKEN_SECRET='different-local-test-refresh-secret-long-enough';

test('school authority, tenant isolation, parent and teacher scopes, and approved support access use PostgreSQL',async()=>{
  const db=await PGlite.create();
  const migrationDir=new URL('../../migrations/',import.meta.url);
  const migrationNames=(await readdir(migrationDir)).filter(name=>name.endsWith('.sql')).sort();
  for(const name of migrationNames){
    let sql=await readFile(new URL(name,migrationDir),'utf8');
    // PGlite includes PostgreSQL's gen_random_uuid but not the optional pgcrypto extension.
    sql=sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/,'');
    await db.exec(sql);
  }
  await db.exec(`CREATE ROLE educonnect_app LOGIN NOBYPASSRLS; CREATE ROLE educonnect_platform LOGIN BYPASSRLS; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO educonnect_app,educonnect_platform; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO educonnect_app,educonnect_platform;`);
  const socket=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:16});
  await socket.start();
  const port=Number(socket.getServerConn().split(':').at(-1));
  process.env.DATABASE_URL=`postgresql://educonnect_app@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.PLATFORM_DATABASE_URL=`postgresql://educonnect_platform@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.MIGRATION_DATABASE_URL=process.env.PLATFORM_DATABASE_URL;

  const [{pool,platformPool,tenantTransaction},{signAccess},{app}]=await Promise.all([import('./pool.js'),import('../auth/tokens.js'),import('../server.js')]);
  // PGlite's socket protocol authenticates every session as its bootstrap superuser;
  // use real database roles per application pool to exercise production RLS policies.
  pool.on('acquire',client=>{void client.query('SET ROLE educonnect_app');});
  platformPool.on('acquire',client=>{void client.query('SET ROLE educonnect_platform');});
  const createdSchools:string[]=[],createdUsers:string[]=[],createdPlatformUsers:string[]=[];
  const httpServer=app.listen(0);await new Promise<void>(resolve=>httpServer.once('listening',resolve));
  const address=httpServer.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
  const call=async(path:string,token:string,init:RequestInit={})=>fetch(`${base}${path}`,{...init,headers:{Authorization:`Bearer ${token}`,...(init.body?{'Content-Type':'application/json'}:{}),...init.headers}});
  const tokenFor=(id:string,role:string,schoolId?:string)=>signAccess({kind:schoolId?'school':'platform',id,role,...(schoolId?{schoolId}:{})});
  try{
    const superAdminId=randomUUID(),platformSuperRole=(await platformPool.query("SELECT id FROM platform_roles WHERE name='super_admin'")).rows[0].id as string;
    await platformPool.query('INSERT INTO platform_users(id,email,name,password_hash,role_id) VALUES($1,$2,$3,$4,$5)',[superAdminId,`${randomUUID()}@test.invalid`,'Test Platform Admin','unused',platformSuperRole]);createdPlatformUsers.push(superAdminId);const superToken=await tokenFor(superAdminId,'super_admin');
    const makeSchool=async(label:string)=>{
      const plan=(await platformPool.query("SELECT id FROM subscription_plans WHERE billing_interval='trial' LIMIT 1")).rows[0];
      const created=await call('/api/platform/schools',superToken,{method:'POST',body:JSON.stringify({name:`Integration ${label} ${randomUUID()}`,contactEmail:`${randomUUID()}@test.invalid`,administratorName:`First Admin ${label}`,administratorEmail:`${randomUUID()}@test.invalid`,planId:plan.id,academicYearLabel:'2026-27'})});assert.equal(created.status,201,'CalmStacks can create a school and issue its first administrator invitation');
      const payload=await created.json() as {school:{id:string;school_id:string};invitation:{developmentUrl?:string}};const school=payload.school;createdSchools.push(school.id);assert.ok(payload.invitation.developmentUrl,'test setup can accept the initial school administrator invitation');const initialAdminToken=new URL(payload.invitation.developmentUrl!).searchParams.get('token')!;
      const activated=await call(`/api/platform/schools/${school.id}/status`,superToken,{method:'PATCH',body:JSON.stringify({status:'active'})});assert.equal(activated.status,200);return {...school,initialAdminToken};
    };
    const schoolA=await makeSchool('A'),schoolB=await makeSchool('B');
    assert.notEqual(schoolA.school_id,schoolB.school_id,'school creation assigns distinct School IDs');
    const acceptAdmin=async(school:{school_id:string;initialAdminToken:string},name:string)=>{const accepted=await call('/api/auth/accept-invitation',superToken,{method:'POST',body:JSON.stringify({token:school.initialAdminToken,name,password:'initial-school-admin-password-001'})});assert.equal(accepted.status,201,'each school initial administrator invitation can be accepted');const result=await accepted.json() as {accessToken:string;user:{id:string}};createdUsers.push(result.user.id);return {id:result.user.id,accessToken:result.accessToken};};
    const adminAAccount=await acceptAdmin(schoolA,'Admin A'),adminBAccount=await acceptAdmin(schoolB,'Admin B'),adminA=adminAAccount.id,adminB=adminBAccount.id,adminToken=adminAAccount.accessToken,adminBToken=adminBAccount.accessToken;
    const teacherA=randomUUID(),parentA=randomUUID(),studentSelfUser=randomUUID();createdUsers.push(teacherA,parentA,studentSelfUser);
    for(const [id,label] of [[teacherA,'Teacher A'],[parentA,'Parent A'],[studentSelfUser,'Student A']] as const){await platformPool.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[id,`${randomUUID()}@test.invalid`,label,'not-used']);}
    const addMembership=async(schoolId:string,userId:string,kind:string,code:string)=>tenantTransaction(schoolId,async client=>{
      const role=await client.query('SELECT id FROM school_roles WHERE school_id=$1 AND code=$2',[schoolId,code]);assert.ok(role.rows[0],`${code} default school role was seeded`);
      return client.query('INSERT INTO school_memberships(school_id,user_id,role,school_role_id) VALUES($1,$2,$3,$4) RETURNING id',[schoolId,userId,kind,role.rows[0].id]);
    });
    const adminMembershipA=(await tenantTransaction(schoolA.id,client=>client.query('SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2',[schoolA.id,adminA]))).rows[0].id as string;
    const teacherMembership=(await addMembership(schoolA.id,teacherA,'teacher','teacher')).rows[0].id as string;
    await addMembership(schoolA.id,parentA,'parent','parent');

    const dataA=await tenantTransaction(schoolA.id,async client=>{
      const year=(await client.query("INSERT INTO academic_years(school_id,name,starts_on,ends_on,is_current) VALUES($1,'2026-27',CURRENT_DATE,CURRENT_DATE+365,true) RETURNING id",[schoolA.id])).rows[0].id;
      const klass=(await client.query("INSERT INTO classes(school_id,academic_year_id,name,grade_level) VALUES($1,$2,'Grade 5',5) RETURNING id",[schoolA.id,year])).rows[0].id;
      const otherClass=(await client.query("INSERT INTO classes(school_id,academic_year_id,name,grade_level) VALUES($1,$2,'Grade 6',6) RETURNING id",[schoolA.id,year])).rows[0].id;
      const subj=(await client.query("INSERT INTO subjects(school_id,name) VALUES($1,'Math') RETURNING id",[schoolA.id])).rows[0].id;
      const classSubject=(await client.query('INSERT INTO class_subjects(school_id,class_id,subject_id) VALUES($1,$2,$3) RETURNING id',[schoolA.id,klass,subj])).rows[0].id;
      const teacher=(await client.query('INSERT INTO teachers(school_id,user_id,employee_id) VALUES($1,$2,$3) RETURNING id',[schoolA.id,teacherA,`EMP-${randomUUID().slice(0,8)}`])).rows[0].id;
      await client.query('INSERT INTO teacher_assignments(school_id,teacher_id,class_subject_id) VALUES($1,$2,$3)',[schoolA.id,teacher,classSubject]);
      const student1=(await client.query("INSERT INTO students(school_id,admission_number,first_name,last_name) VALUES($1,$2,'Linked','Child') RETURNING id",[schoolA.id,randomUUID()])).rows[0].id;
      const student2=(await client.query("INSERT INTO students(school_id,admission_number,first_name,last_name) VALUES($1,$2,'Unlinked','Child') RETURNING id",[schoolA.id,randomUUID()])).rows[0].id;
      await client.query('INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id) VALUES($1,$2,$3,$4),($1,$5,$3,$6)',[schoolA.id,student1,year,klass,student2,otherClass]);
      const parent=(await client.query('INSERT INTO parents(school_id,user_id,relationship) VALUES($1,$2,$3) RETURNING id',[schoolA.id,parentA,'guardian'])).rows[0].id;
      await client.query('INSERT INTO student_parents(school_id,student_id,parent_id,is_primary) VALUES($1,$2,$3,true)',[schoolA.id,student1,parent]);
      return {year,klass,otherClass,student1,student2};
    });
    await addMembership(schoolA.id,studentSelfUser,'student','student');
    await tenantTransaction(schoolA.id,client=>client.query('UPDATE students SET user_id=$3 WHERE school_id=$1 AND id=$2',[schoolA.id,dataA.student1,studentSelfUser]));
    const dataB=await tenantTransaction(schoolB.id,async client=>{
      const year=(await client.query("INSERT INTO academic_years(school_id,name,starts_on,ends_on,is_current) VALUES($1,'2026-27',CURRENT_DATE,CURRENT_DATE+365,true) RETURNING id",[schoolB.id])).rows[0].id;
      const klass=(await client.query("INSERT INTO classes(school_id,academic_year_id,name) VALUES($1,$2,'Private B') RETURNING id",[schoolB.id,year])).rows[0].id;
      const student=(await client.query("INSERT INTO students(school_id,admission_number,first_name) VALUES($1,$2,'Secret Student B') RETURNING id",[schoolB.id,randomUUID()])).rows[0].id;
      await client.query('INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id) VALUES($1,$2,$3,$4)',[schoolB.id,student,year,klass]);return {year,klass,student};
    });
    const [teacherToken,parentToken,studentToken]=await Promise.all([tokenFor(teacherA,'teacher',schoolA.id),tokenFor(parentA,'parent',schoolA.id),tokenFor(studentSelfUser,'student',schoolA.id)]);

    // Attendance stage gate: class roster reads, atomic bulk marking, immutable corrections,
    // idempotent duplicate submissions, outbox enqueueing, and parent/cross-school scopes.
    const attendanceDate=(await tenantTransaction(schoolA.id,client=>client.query('SELECT CURRENT_DATE::text AS date'))).rows[0].date as string;
    const attendanceBody={date:attendanceDate,classId:dataA.klass,records:[{studentId:dataA.student1,status:'absent',note:'Reported by class teacher'}]};
    const marked=await call('/api/school/attendance/bulk',adminToken,{method:'PUT',body:JSON.stringify(attendanceBody)});assert.equal(marked.status,200,'school administrator can bulk mark attendance');
    const markedPayload=await marked.json() as {items:{id:string;status:string;student_id:string}[]};assert.equal(markedPayload.items[0]?.status,'absent');const attendanceId=markedPayload.items[0].id;
    const repeated=await call('/api/school/attendance/bulk',adminToken,{method:'PUT',body:JSON.stringify(attendanceBody)});assert.equal(repeated.status,200,'repeating an identical bulk mark is idempotent');
    const duplicate=await tenantTransaction(schoolA.id,client=>client.query('SELECT count(*)::int AS n FROM attendance WHERE school_id=$1 AND student_id=$2 AND attendance_date=$3::date',[schoolA.id,dataA.student1,attendanceDate]));assert.equal(duplicate.rows[0].n,1,'unique student/date constraint prevents duplicate attendance');
    const silentCorrection=await call('/api/school/attendance/bulk',adminToken,{method:'PUT',body:JSON.stringify({...attendanceBody,records:[{studentId:dataA.student1,status:'present'}]})});assert.equal(silentCorrection.status,409,'bulk marking cannot bypass correction audit requirements');
    const corrected=await call(`/api/school/attendance/${attendanceId}`,adminToken,{method:'PATCH',body:JSON.stringify({status:'present',correctionReason:'Parent provided verified medical note'})});assert.equal(corrected.status,200,'attendance correction requires and records a reason');
    const history=await call(`/api/school/attendance/${attendanceId}/history`,adminToken);assert.equal(history.status,200);const historyPayload=await history.json() as {items:{action:string;before_state:Record<string,unknown>|null;after_state:Record<string,unknown>}[]};assert.equal(historyPayload.items.length,2,'creation and correction are both immutable history entries');assert.equal(historyPayload.items[0]?.after_state.correctionReason,'Parent provided verified medical note');
    await assert.rejects(()=>tenantTransaction(schoolA.id,client=>client.query("UPDATE attendance_history SET action='created' WHERE school_id=$1 AND attendance_id=$2",[schoolA.id,attendanceId])),/append-only/,'attendance history cannot be changed in place');
    await assert.rejects(()=>tenantTransaction(schoolA.id,client=>client.query('DELETE FROM attendance_history WHERE school_id=$1 AND attendance_id=$2',[schoolA.id,attendanceId])),/append-only/,'attendance history cannot be directly deleted');
    await assert.rejects(()=>tenantTransaction(schoolA.id,client=>client.query('TRUNCATE attendance_history')),/append-only/,'attendance history cannot be truncated');
    const attendanceOutbox=await tenantTransaction(schoolA.id,client=>client.query("SELECT count(*)::int AS n FROM background_jobs WHERE school_id=$1 AND job_type='attendance.absence_notification' AND payload->>'studentId'=$2",[schoolA.id,dataA.student1]));assert.equal(attendanceOutbox.rows[0].n,1,'absence notification is queued transactionally once');
    const attendanceRead=await call(`/api/school/attendance?date=${attendanceDate}&classId=${dataA.klass}`,teacherToken);assert.equal(attendanceRead.status,200,'assigned teacher can read assigned class attendance');
    const invalidAttendanceDate=await call('/api/school/attendance/classes?date=2026-02-30',adminToken);assert.equal(invalidAttendanceDate.status,400,'invalid calendar dates are rejected before reaching PostgreSQL');
    const calendarMonth=attendanceDate.slice(0,7);
    const attendanceCalendar=await call(`/api/school/attendance/calendar?month=${calendarMonth}&classId=${dataA.klass}`,teacherToken);assert.equal(attendanceCalendar.status,200,'assigned teacher can read their class attendance calendar');const calendarPayload=await attendanceCalendar.json() as {items:{attendance_date:string;present:number;absent:number}[]};assert.ok(calendarPayload.items.some(day=>day.attendance_date===attendanceDate),'calendar returns dated monthly attendance counts');
    const monthlyAttendance=await call(`/api/school/attendance/reports/monthly?month=${calendarMonth}&classId=${dataA.klass}`,adminToken);assert.equal(monthlyAttendance.status,200);const monthlyPayload=await monthlyAttendance.json() as {items:{attendance_percentage:string|number|null}[]};assert.equal(Number(monthlyPayload.items[0]?.attendance_percentage),100,'monthly attendance percentages count present and late while excluding excused marks');
    const annualAttendance=await call(`/api/school/attendance/reports/annual?year=${attendanceDate.slice(0,4)}&classId=${dataA.klass}`,adminToken);assert.equal(annualAttendance.status,200);assert.ok(((await annualAttendance.json()) as {items:unknown[]}).items.length>0,'annual attendance report includes dated class records');
    const foreignCalendar=await call(`/api/school/attendance/calendar?month=${calendarMonth}&classId=${dataB.klass}`,adminToken);assert.equal(foreignCalendar.status,404,'foreign school class IDs are rejected by the attendance calendar');
    const linkedAttendance=await call(`/api/school/attendance/students/${dataA.student1}`,parentToken);assert.equal(linkedAttendance.status,200,'parent can read linked child attendance');
    const selfAttendance=await call(`/api/school/attendance/students/${dataA.student1}`,studentToken);assert.equal(selfAttendance.status,200,'student can read their own attendance through the linked student record');
    const otherStudentAttendance=await call(`/api/school/attendance/students/${dataA.student2}`,studentToken);assert.equal(otherStudentAttendance.status,404,'student cannot read another student attendance');
    const unlinkedAttendance=await call(`/api/school/attendance/students/${dataA.student2}`,parentToken);assert.equal(unlinkedAttendance.status,404,'parent cannot read an unlinked student attendance record');
    const foreignAttendance=await call(`/api/school/attendance/students/${dataB.student}`,adminToken);assert.equal(foreignAttendance.status,404,'school A cannot read School B attendance by direct API UUID');
    const unauthorizedParentRoster=await call(`/api/school/attendance?date=${attendanceDate}&classId=${dataA.klass}`,parentToken);assert.equal(unauthorizedParentRoster.status,403,'parent cannot read a full class attendance roster');

    const subject=await call('/api/school/subjects',adminToken,{method:'POST',body:JSON.stringify({name:'Science',code:'SCI'})});assert.equal(subject.status,201,'school can configure its own subjects');
    const section=await call('/api/school/sections',adminToken,{method:'POST',body:JSON.stringify({classId:dataA.klass,name:'A',room:'101'})});assert.equal(section.status,201,'school can configure class sections');
    const sectionId=(await section.json() as {section:{id:string}}).section.id;
    const subjectId=(await subject.json() as {subject:{id:string}}).subject.id;
    const classSubject=await call(`/api/school/classes/${dataA.klass}/subjects`,adminToken,{method:'POST',body:JSON.stringify({subjectId})});assert.equal(classSubject.status,201,'school can assign a subject to its class');
    const admittedA=await call('/api/school/students',adminToken,{method:'POST',body:JSON.stringify({admissionNumber:`api-a-${randomUUID()}`,firstName:'API',lastName:'Admitted A',classId:dataA.otherClass,academicYearId:dataA.year})});assert.equal(admittedA.status,201,'school A can independently admit a student through its API');
    const admittedStudent=(await admittedA.json() as {student:{id:string}}).student.id;
    const newYearResponse=await call('/api/school/academic-years',adminToken,{method:'POST',body:JSON.stringify({name:'2027-28',startsOn:'2027-08-01',endsOn:'2028-07-31',isCurrent:true})});assert.equal(newYearResponse.status,201,'school configures its own academic year');const newYear=(await newYearResponse.json() as {academicYear:{id:string}}).academicYear.id;
    const newClassResponse=await call('/api/school/classes',adminToken,{method:'POST',body:JSON.stringify({name:'Grade 7',gradeLevel:7,academicYearId:newYear})});assert.equal(newClassResponse.status,201,'school configures classes within its academic year');const newClass=(await newClassResponse.json() as {class:{id:string}}).class.id;
    const promotion=await call(`/api/school/students/${admittedStudent}/lifecycle`,adminToken,{method:'PATCH',body:JSON.stringify({action:'promote',academicYearId:newYear,classId:newClass})});assert.equal(promotion.status,200,'student promotion creates a new enrollment and retains the prior enrollment');
    const importResponse=await call('/api/school/students/import',adminToken,{method:'POST',body:JSON.stringify({students:[{admissionNumber:`bulk-a-${randomUUID()}`,firstName:'Bulk',lastName:'Admitted',classId:dataA.klass,sectionId,academicYearId:dataA.year}]})});assert.equal(importResponse.status,201,'school can import student rows transactionally');
    const admittedB=await call('/api/school/students',adminBToken,{method:'POST',body:JSON.stringify({admissionNumber:`api-b-${randomUUID()}`,firstName:'API',lastName:'Admitted B',classId:dataB.klass,academicYearId:dataB.year})});assert.equal(admittedB.status,201,'school B can independently admit a student through its API');
    const teacherRole=(await tenantTransaction(schoolA.id,client=>client.query("SELECT id FROM school_roles WHERE code='teacher'"))).rows[0].id as string;
    const invitation=await call('/api/school/members/invitations',adminToken,{method:'POST',body:JSON.stringify({email:`teacher-${randomUUID()}@test.invalid`,name:'Invited Teacher',schoolRoleId:teacherRole})});assert.equal(invitation.status,201,'school administrator can onboard a teacher with an invitation');const invitationPayload=await invitation.json() as {invitation:{developmentUrl?:string}};assert.ok(invitationPayload.invitation.developmentUrl);const inviteToken=new URL(invitationPayload.invitation.developmentUrl!).searchParams.get('token')!;
    const acceptedTeacher=await call('/api/auth/accept-invitation',adminToken,{method:'POST',body:JSON.stringify({token:inviteToken,name:'Invited Teacher',password:'teacher-onboarding-password-001'})});assert.equal(acceptedTeacher.status,201,'teacher invitation creates an active school membership');const invitedTeacher=(await acceptedTeacher.json() as {user:{id:string;schoolRole:string}}).user;createdUsers.push(invitedTeacher.id);assert.equal(invitedTeacher.schoolRole,'teacher');
    const recoveryEmail=(await tenantTransaction(schoolA.id,client=>client.query('SELECT email FROM users WHERE id=$1',[adminA]))).rows[0].email as string;
    await tenantTransaction(schoolA.id,client=>client.query("INSERT INTO user_sessions(user_kind,user_id,school_id,refresh_token_hash,expires_at) VALUES('school',$1,$2,$3,now()+interval '1 day')",[adminA,schoolA.id,randomUUID()]));
    const recovery=await call('/api/auth/recovery/request',adminToken,{method:'POST',body:JSON.stringify({kind:'school',schoolId:schoolA.school_id,email:recoveryEmail})});assert.equal(recovery.status,200);
    const recoveryBody=await recovery.json() as {message:string;developmentUrl?:string};assert.match(recoveryBody.message,/If the account is eligible/);assert.ok(recoveryBody.developmentUrl,'development recovery links are available for local setup');
    const recoveryToken=new URL(recoveryBody.developmentUrl!).searchParams.get('token')!;
    const reset=await call('/api/auth/recovery/confirm',adminToken,{method:'POST',body:JSON.stringify({token:recoveryToken,password:'new-secure-school-password-001'})});assert.equal(reset.status,200,'school accounts can reset passwords using a one-time token');
    const newHash=(await platformPool.query('SELECT password_hash FROM users WHERE id=$1',[adminA])).rows[0].password_hash as string;assert.equal(await argon2.verify(newHash,'new-secure-school-password-001'),true);
    const sessions=await platformPool.query("SELECT count(*)::int AS count FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL",[adminA]);assert.equal(sessions.rows[0].count,0,'password recovery revokes existing refresh sessions');
    const replay=await call('/api/auth/recovery/confirm',adminToken,{method:'POST',body:JSON.stringify({token:recoveryToken,password:'another-secure-password-001'})});assert.equal(replay.status,400,'recovery tokens are one time use');

    const rawVisible=await tenantTransaction(schoolA.id,client=>client.query('SELECT id FROM students WHERE id=$1',[dataB.student]));
    assert.equal(rawVisible.rowCount,0,'RLS hides a known foreign student UUID from school A');
    const adminResponse=await call(`/api/school/students?school_id=${schoolB.id}`,adminToken);
    assert.equal(adminResponse.status,200);const adminRows=await adminResponse.json() as {items:{id:string}[];total:number};
    assert.equal(adminRows.total,4,'school A sees its own four students and not school B records');assert.equal(adminRows.items.some(row=>row.id===dataB.student),false);
    const teacherResponse=await call('/api/school/students',teacherToken);assert.equal(teacherResponse.status,200);
    const teacherRows=await teacherResponse.json() as {items:{id:string}[];total:number};assert.equal(teacherRows.total,2,'teacher sees only students in the assigned class, including imports');assert.ok(teacherRows.items.some(row=>row.id===dataA.student1));assert.equal(teacherRows.items.some(row=>row.id===dataA.student2),false);
    const parentResponse=await call('/api/school/students',parentToken);assert.equal(parentResponse.status,200);
    const parentRows=await parentResponse.json() as {items:{id:string}[];total:number};assert.equal(parentRows.total,1,'parent sees only linked children');assert.equal(parentRows.items[0]?.id,dataA.student1);
    const platformBrowse=await call('/api/school/students',superToken);assert.equal(platformBrowse.status,403,'ordinary platform identity cannot use school data APIs');
    const crossCreate=await call('/api/school/students',adminToken,{method:'POST',body:JSON.stringify({admissionNumber:`cross-${randomUUID()}`,firstName:'Cross Tenant',classId:dataB.klass,academicYearId:dataB.year})});
    assert.equal(crossCreate.status,400,'composite tenant foreign keys reject cross-school class references');
    const ownAfter=await tenantTransaction(schoolA.id,client=>client.query('SELECT id FROM students WHERE school_id=$1',[schoolA.id]));assert.equal(ownAfter.rowCount,4,'failed cross-school admission rolls back cleanly');
    const isolation=await tenantTransaction(schoolA.id,client=>client.query('SELECT school_id FROM school_roles WHERE school_id=$1',[schoolB.id]));assert.equal(isolation.rowCount,0,'school A cannot inspect school B role configuration');

    const createdAgent=await call('/api/platform/team/support-agents',superToken,{method:'POST',body:JSON.stringify({name:'Test Support',email:`${randomUUID()}@test.invalid`,initialPassword:'secure-temporary-password-012345'})});assert.equal(createdAgent.status,201,'platform administrators can create dedicated support agents');const supportId=(await createdAgent.json() as {user:{id:string}}).user.id;createdPlatformUsers.push(supportId);
    const supportToken=await tokenFor(supportId,'support_agent');
    const supportMe=await call('/api/auth/me',supportToken);assert.equal((await supportMe.json() as {user:{role:string}}).user.role,'support_agent','session restoration preserves the separate support role');
    const denied=await call(`/api/platform/support-access/${randomUUID()}/students`,supportToken);assert.equal(denied.status,403,'support without school approval cannot browse student data');
    const requestResponse=await call('/api/platform/support-access',supportToken,{method:'POST',body:JSON.stringify({schoolId:schoolA.school_id,reason:'Investigate a reported import failure for this school.',scopes:['students:read'],durationMinutes:60})});
    assert.equal(requestResponse.status,201);const supportRequest=(await requestResponse.json() as {request:{id:string}}).request;
    const mine=await call('/api/platform/support-access/mine',supportToken);assert.equal(mine.status,200);assert.equal((await mine.json() as {items:{id:string}[]}).items[0]?.id,supportRequest.id,'support agents can track their own access requests');
    const approval=await call(`/api/school/support-access/${supportRequest.id}/decision`,adminToken,{method:'PATCH',body:JSON.stringify({decision:'approve',approvedScopes:['students:read'],durationMinutes:60})});assert.equal(approval.status,200);
    const approvedRead=await call(`/api/platform/support-access/${supportRequest.id}/students`,supportToken);assert.equal(approvedRead.status,200);
    const supportRows=await approvedRead.json() as {items:Record<string,unknown>[];total:number};assert.equal(supportRows.total,4);assert.equal('date_of_birth' in (supportRows.items[0]||{}),false,'support view returns only limited student fields');
    const revoke=await call(`/api/school/support-access/${supportRequest.id}/revoke`,adminToken,{method:'POST'});assert.equal(revoke.status,200);
    const revokedRead=await call(`/api/platform/support-access/${supportRequest.id}/students`,supportToken);assert.equal(revokedRead.status,403,'revoked support grants stop working');
    const schoolAudit=await tenantTransaction(schoolA.id,client=>client.query("SELECT action FROM audit_logs WHERE target_id=$1::uuid AND action LIKE 'support_access.%'",[supportRequest.id]));assert.ok((schoolAudit.rowCount||0)>=3,'support approval, access and revocation are audited in school history');
    const suspended=await call(`/api/platform/schools/${schoolA.id}/status`,superToken,{method:'PATCH',body:JSON.stringify({status:'suspended'})});assert.equal(suspended.status,200);
    const blockedSchool=await call('/api/school/students',adminToken);assert.equal(blockedSchool.status,403,'suspending a tenant blocks school API access');
    const preserved=await platformPool.query('SELECT count(*)::int AS count FROM students WHERE school_id=$1',[schoolA.id]);assert.equal(preserved.rows[0].count,4,'school suspension preserves its student records');
    assert.ok(adminMembershipA,'school administrator is independently provisioned in school A');
  }finally{
    await new Promise<void>(resolve=>httpServer.close(()=>resolve()));
    if(createdSchools.length){await platformPool.query('DELETE FROM subscriptions WHERE school_id=ANY($1::uuid[])',[createdSchools]);await platformPool.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[createdSchools]);}
    if(createdUsers.length)await platformPool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[createdUsers]);
    if(createdPlatformUsers.length){await platformPool.query('DELETE FROM platform_audit_logs WHERE actor_id=ANY($1::uuid[])',[createdPlatformUsers]);await platformPool.query('DELETE FROM platform_users WHERE id=ANY($1::uuid[])',[createdPlatformUsers]);}
    await Promise.all([pool.end(),platformPool.end()]);await socket.stop();await db.close();
  }
});
