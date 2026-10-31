import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import express from 'express';
import argon2 from 'argon2';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = 'local-test-access-secret-that-is-long-enough';
process.env.REFRESH_TOKEN_SECRET = 'different-local-test-refresh-secret-long-enough';
process.env.INVITATION_BASE_URL = 'http://localhost:5173/accept-invitation';

test('E2E Full Production Lifecycle: Provisioning -> Academics -> Attendance -> Homework -> Exams -> Timetable -> Fees -> Announcements -> Reports -> Tenant Isolation', { timeout: 180_000 }, async () => {
  console.log('[E2E] 1. Initializing PGlite...');
  const db = await PGlite.create();
  const migrationDir = new URL('../../migrations/', import.meta.url);
  const migrationNames = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
  for (const name of migrationNames) {
    console.log(`[E2E] Running migration ${name}...`);
    let sql = await readFile(new URL(name, migrationDir), 'utf8');
    sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/, '');
    await db.exec(sql);
  }
  await db.exec(`
    CREATE ROLE educonnect_app LOGIN NOBYPASSRLS;
    CREATE ROLE educonnect_platform LOGIN BYPASSRLS;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO educonnect_app,educonnect_platform;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO educonnect_app,educonnect_platform;
  `);

  console.log('[E2E] 2. Starting PGlite socket server...');
  const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 32 });
  await socket.start();
  const port = Number(socket.getServerConn().split(':').at(-1));
  process.env.DATABASE_URL = `postgresql://educonnect_app@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.PLATFORM_DATABASE_URL = `postgresql://educonnect_platform@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.MIGRATION_DATABASE_URL = process.env.PLATFORM_DATABASE_URL;

  console.log('[E2E] 3. Importing routers and pool...');
  const [
    { pool, platformPool, tenantTransaction },
    { authRouter },
    { platformRouter, schoolRouter },
    { schoolRoleRouter },
    { attendanceRouter },
    { homeworkRouter },
    { examRouter },
    { timetableRouter },
    { feesRouter },
    { announcementsRouter },
    { reportsRouter },
    { HttpError },
  ] = await Promise.all([
    import('../db/pool.js'),
    import('../auth/routes.js'),
    import('../schools/routes.js'),
    import('../schools/roles.js'),
    import('../attendance/routes.js'),
    import('../homework/routes.js'),
    import('../exams/routes.js'),
    import('../timetable/routes.js'),
    import('../fees/routes.js'),
    import('../announcements/routes.js'),
    import('../reports/routes.js'),
    import('../http.js'),
  ]);

  pool.on('acquire', client => { void client.query('SET ROLE educonnect_app'); });
  platformPool.on('acquire', client => { void client.query('SET ROLE educonnect_platform'); });

  console.log('[E2E] 4. Seeding super admin...');
  // 3. Seed Platform Super Admin in platform_users
  const superAdminRole = (await platformPool.query("SELECT id FROM platform_roles WHERE name='super_admin'")).rows[0].id;
  const adminPasswordHash = await argon2.hash('SuperAdmin#2026', { type: argon2.argon2id });
  await platformPool.query(
    "INSERT INTO platform_users (email, name, password_hash, role_id) VALUES ('platform@calmstacks.dev', 'Platform Super Admin', $1, $2)",
    [adminPasswordHash, superAdminRole]
  );

  console.log('[E2E] 5. Assembling Express server...');
  // 4. Assemble Express App matching server.ts exactly
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/auth', authRouter);
  app.use('/api/platform', platformRouter);
  app.use('/api/school', schoolRouter);
  app.use('/api/school', schoolRoleRouter);
  app.use('/api/school', attendanceRouter);
  app.use('/api/school/homework', homeworkRouter);
  app.use('/api/school', examRouter);
  app.use('/api/school', timetableRouter);
  app.use('/api/school/fees', feesRouter);
  app.use('/api/school', announcementsRouter);
  app.use('/api/school', reportsRouter);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error('E2E SERVER ERROR:', error);
    res.status(500).json({ error: (error as Error).message });
  });

  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const serverAddress = server.address();
  const apiBase = `http://127.0.0.1:${typeof serverAddress === 'object' && serverAddress ? serverAddress.port : 0}`;

  async function api(path: string, options: { method?: string; body?: unknown; token?: string } = {}) {
    const res = await fetch(`${apiBase}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Connection: 'close',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, headers: res.headers, body: json };
  }

  try {
    console.log('[E2E] -> STEP 1: Super Admin Login & Plans');
    // ==========================================
    // STEP 1: Platform Super Admin Sign In
    // ==========================================
    const loginRes = await api('/api/auth/platform/login', {
      method: 'POST',
      body: { email: 'platform@calmstacks.dev', password: 'SuperAdmin#2026' },
    });
    assert.equal(loginRes.status, 200, 'Super admin login must succeed');
    const platformToken = loginRes.body.accessToken;
    assert.ok(platformToken, 'Platform token must be returned');

    // Get Subscription Plans
    const plansRes = await api('/api/platform/plans', { token: platformToken });
    assert.equal(plansRes.status, 200);
    const planId = plansRes.body.items[0]?.id;
    assert.ok(planId, 'Active subscription plan must exist');

    console.log('[E2E] -> STEP 2: School Creation & Provisioning');
    // ==========================================
    // STEP 2: School Creation & Provisioning
    // ==========================================
    const createSchoolRes = await api('/api/platform/schools', {
      method: 'POST',
      token: platformToken,
      body: {
        name: 'Greenwood Global Academy',
        address: '123 Education Boulevard, Bangalore',
        contactEmail: 'contact@greenwood.edu',
        contactPhone: '+91 98765 43210',
        principalName: 'Dr. Elizabeth Warren',
        schoolType: 'general',
        website: 'https://greenwood.edu',
        academicYearLabel: '2026–27',
        planId,
        administratorName: 'Principal Administrator',
        administratorEmail: 'principal@greenwood.edu',
      },
    });
    assert.equal(createSchoolRes.status, 201, 'School creation must succeed');
    const school = createSchoolRes.body.school;
    const inviteUrl = new URL(createSchoolRes.body.invitation.developmentUrl);
    const inviteToken = inviteUrl.searchParams.get('token')!;
    assert.ok(inviteToken, 'Invitation token must be in developmentUrl');

    console.log('[E2E] -> STEP 3: Accept Invitation');
    // ==========================================
    // STEP 3: Accept Invitation & School Admin Login
    // ==========================================
    const acceptRes = await api('/api/auth/accept-invitation', {
      method: 'POST',
      body: {
        token: inviteToken,
        name: 'Dr. Elizabeth Warren',
        password: 'PrincipalPassword#2026',
      },
    });
    assert.equal(acceptRes.status, 201, 'Accepting invitation must succeed with 201');
    const schoolToken = acceptRes.body.accessToken;
    assert.ok(schoolToken, 'School admin access token must be returned');

    console.log('[E2E] -> STEP 4: School Settings & Branding');
    // ==========================================
    // STEP 4: School Settings & Branding (Gate H)
    // ==========================================
    const updateSettingsRes = await api('/api/school/settings', {
      method: 'PATCH',
      token: schoolToken,
      body: {
        academicYearLabel: '2026–27 Academic Session',
        settings: {
          branding: {
            displayName: 'Greenwood Academy Official',
            primaryColor: '#0ea5e9',
            logoUrl: 'https://greenwood.edu/assets/logo.png',
          },
          notifications: {
            email_alerts: true,
            fee_alerts: true,
          },
        },
      },
    });
    assert.equal(updateSettingsRes.status, 200, 'School settings update must succeed');

    const getSettingsRes = await api('/api/school/settings', { token: schoolToken });
    assert.equal(getSettingsRes.status, 200);
    assert.equal(getSettingsRes.body.settings.academic_year_label, '2026–27 Academic Session');
    assert.equal(getSettingsRes.body.settings.settings.branding.displayName, 'Greenwood Academy Official');

    console.log('[E2E] -> STEP 5: Academic Setup');
    // ==========================================
    // STEP 5: Academic Setup (Years, Classes, Sections, Subjects)
    // ==========================================
    const yearRes = await api('/api/school/academic-years', {
      method: 'POST',
      token: schoolToken,
      body: {
        name: '2026–2027',
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        isCurrent: true,
      },
    });
    assert.equal(yearRes.status, 201, 'Academic year creation must succeed');
    const academicYearId = yearRes.body.academicYear.id;

    const classRes = await api('/api/school/classes', {
      method: 'POST',
      token: schoolToken,
      body: {
        name: 'Grade 10',
        academicYearId,
        gradeLevel: 10,
      },
    });
    assert.equal(classRes.status, 201, 'Class creation must succeed');
    const classId = classRes.body.class.id;

    const sectionRes = await api('/api/school/sections', {
      method: 'POST',
      token: schoolToken,
      body: {
        classId,
        name: 'Section A',
        room: 'Room 101',
      },
    });
    assert.equal(sectionRes.status, 201, 'Section creation must succeed');
    const sectionId = sectionRes.body.section.id;

    const subjectRes = await api('/api/school/subjects', {
      method: 'POST',
      token: schoolToken,
      body: {
        name: 'Physics',
        code: 'PHY101',
      },
    });
    assert.equal(subjectRes.status, 201, 'Subject creation must succeed');
    const subjectId = subjectRes.body.subject.id;

    const linkRes = await api(`/api/school/classes/${classId}/subjects`, {
      method: 'POST',
      token: schoolToken,
      body: { subjectId },
    });
    assert.equal(linkRes.status, 201, 'Linking subject to class must succeed');

    console.log('[E2E] -> STEP 6: Student Admissions');
    // ==========================================
    // STEP 6: Student Admissions
    // ==========================================
    const student1Res = await api('/api/school/students', {
      method: 'POST',
      token: schoolToken,
      body: {
        admissionNumber: 'GW-2026-001',
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '2010-05-15',
        academicYearId,
        classId,
        sectionId,
      },
    });
    assert.equal(student1Res.status, 201, 'Student 1 admission must succeed');
    const student1Id = student1Res.body.student.id;

    const student2Res = await api('/api/school/students', {
      method: 'POST',
      token: schoolToken,
      body: {
        admissionNumber: 'GW-2026-002',
        firstName: 'Jane',
        lastName: 'Roe',
        dateOfBirth: '2010-08-22',
        academicYearId,
        classId,
        sectionId,
      },
    });
    assert.equal(student2Res.status, 201, 'Student 2 admission must succeed');
    const student2Id = student2Res.body.student.id;

    console.log('[E2E] -> STEP 7: Attendance Recording');
    // ==========================================
    // STEP 7: Attendance Recording (Gate A)
    // ==========================================
    const today = new Date().toISOString().slice(0, 10);
    const attendanceRes = await api('/api/school/attendance/bulk', {
      method: 'PUT',
      token: schoolToken,
      body: {
        date: today,
        classId,
        sectionId,
        records: [
          { studentId: student1Id, status: 'present' },
          { studentId: student2Id, status: 'absent', note: 'Medical appointment' },
        ],
      },
    });
    assert.equal(attendanceRes.status, 200, 'Attendance marking must succeed');

    const verifyAttendance = await api(`/api/school/attendance?classId=${classId}&date=${today}`, {
      token: schoolToken,
    });
    assert.equal(verifyAttendance.status, 200);
    assert.equal(verifyAttendance.body.items.length, 2);

    console.log('[E2E] -> STEP 8: Homework Assignment & Grading');
    // ==========================================
    // STEP 8: Homework Assignment & Grading (Gate B)
    // ==========================================
    const teacherRoleRes = await api('/api/school/roles', { token: schoolToken });
    const teacherRole = teacherRoleRes.body.items.find((r: any) => r.code === 'teacher');
    assert.ok(teacherRole, 'Teacher role must exist');

    const teacherInviteRes = await api('/api/school/members/invitations', {
      method: 'POST',
      token: schoolToken,
      body: {
        email: 'teacher.physics@greenwood.edu',
        name: 'Prof. Isaac Newton',
        schoolRoleId: teacherRole.id,
      },
    });
    assert.equal(teacherInviteRes.status, 201, 'Teacher invite must succeed');
    const teacherInviteUrl = new URL(teacherInviteRes.body.invitation.developmentUrl);
    const teacherToken = teacherInviteUrl.searchParams.get('token')!;

    const teacherAcceptRes = await api('/api/auth/accept-invitation', {
      method: 'POST',
      body: {
        token: teacherToken,
        name: 'Prof. Isaac Newton',
        password: 'TeacherPassword#2026',
      },
    });
    assert.equal(teacherAcceptRes.status, 201);
    const teacherAuthToken = teacherAcceptRes.body.accessToken;

    // Assign teacher to class subject
    const teacherRecord = await api('/api/school/teachers', { token: schoolToken });
    const teacherId = teacherRecord.body.items[0]?.id;
    assert.ok(teacherId, 'Teacher record must exist');

    await api(`/api/school/classes/${classId}/teachers`, {
      method: 'POST',
      token: schoolToken,
      body: {
        teacherId,
        subjectId,
        sectionId,
      },
    });

    // Create Homework (published)
    const homeworkRes = await api('/api/school/homework/assignments', {
      method: 'POST',
      token: teacherAuthToken,
      body: {
        classId,
        sectionId,
        subjectId,
        title: 'Kinematics & Newton Laws Problem Set',
        description: 'Complete questions 1 to 15 from chapter 3.',
        dueAt: '2026-11-20T18:00:00Z',
        maxScore: 100,
        publish: true,
      },
    });
    assert.equal(homeworkRes.status, 201, 'Homework creation must succeed');
    const homeworkId = homeworkRes.body.assignment.id;

    // Student account setup & submission
    const studentRole = teacherRoleRes.body.items.find((r: any) => r.code === 'student');
    const studentInvite = await api('/api/school/members/invitations', {
      method: 'POST',
      token: schoolToken,
      body: {
        email: 'john.doe@students.greenwood.edu',
        name: 'John Doe',
        schoolRoleId: studentRole.id,
        studentId: student1Id,
      },
    });
    assert.equal(studentInvite.status, 201);
    const studentInviteToken = new URL(studentInvite.body.invitation.developmentUrl).searchParams.get('token')!;

    const studentAccept = await api('/api/auth/accept-invitation', {
      method: 'POST',
      body: {
        token: studentInviteToken,
        name: 'John Doe',
        password: 'StudentPassword#2026',
      },
    });
    assert.equal(studentAccept.status, 201);
    const studentAuthToken = studentAccept.body.accessToken;

    // Submit homework as student
    const submitRes = await api(`/api/school/homework/assignments/${homeworkId}/submission`, {
      method: 'POST',
      token: studentAuthToken,
      body: {
        responseText: 'Attached solutions for Kinematics exercises 1-15.',
      },
    });
    assert.equal(submitRes.status, 201, 'Student homework submission must succeed');
    const submissionId = submitRes.body.submission.id;

    // Review & grade submission as teacher
    const gradeRes = await api(`/api/school/homework/assignments/${homeworkId}/submissions/${submissionId}/review`, {
      method: 'PATCH',
      token: teacherAuthToken,
      body: {
        score: 95,
        feedback: 'Superb step-by-step explanations!',
      },
    });
    assert.equal(gradeRes.status, 200, 'Homework grading must succeed');
    assert.equal(Number(gradeRes.body.submission.score), 95);

    console.log('[E2E] -> STEP 9: Examinations & Results');
    // ==========================================
    // STEP 9: Examinations & Results (Gate C)
    // ==========================================
    const examRes = await api('/api/school/examinations', {
      method: 'POST',
      token: schoolToken,
      body: {
        academicYearId,
        name: 'Term 1 Final Examination',
        type: 'terminal',
        startsOn: '2026-06-01',
        endsOn: '2026-06-15',
        subjects: [
          {
            classId,
            sectionId,
            subjectId,
            maxMarks: 100,
          },
        ],
        grades: [
          { grade: 'A', minPercent: 80, maxPercent: 100 },
          { grade: 'B', minPercent: 60, maxPercent: 79.99 },
          { grade: 'F', minPercent: 0, maxPercent: 59.99 },
        ],
      },
    });
    if (examRes.status !== 201) {
      console.error('EXAM CREATE FAILED:', examRes.status, examRes.body);
    }
    assert.equal(examRes.status, 201, 'Exam creation must succeed');
    const examId = examRes.body.examination.id;

    // Retrieve examinationSubjectId directly using tenant transaction for RLS context
    const examSubjectRow = await tenantTransaction(school.id, client =>
      client.query('SELECT id FROM examination_subjects WHERE school_id=$1 AND examination_id=$2', [school.id, examId])
    );
    const examinationSubjectId = examSubjectRow.rows[0]?.id;
    assert.ok(examinationSubjectId, 'Examination subject ID must exist');

    // Publish exam schedule
    const pubExamRes = await api(`/api/school/examinations/${examId}/publish`, {
      method: 'POST',
      token: schoolToken,
    });
    assert.equal(pubExamRes.status, 200, 'Publishing exam schedule must succeed');

    // Enter marks
    const marksRes = await api(`/api/school/examinations/${examId}/marks/bulk`, {
      method: 'POST',
      token: schoolToken,
      body: {
        examinationSubjectId,
        records: [
          { studentId: student1Id, marks: 92 },
          { studentId: student2Id, marks: 74 },
        ],
      },
    });
    assert.equal(marksRes.status, 200, 'Bulk marks entry must succeed');

    // Publish results
    const pubResultsRes = await api(`/api/school/examinations/${examId}/results/publish`, {
      method: 'POST',
      token: schoolToken,
    });
    assert.equal(pubResultsRes.status, 200, 'Publishing exam results must succeed');

    // Check report card
    const cardRes = await api(`/api/school/report-cards/${student1Id}/${examId}`, {
      token: schoolToken,
    });
    assert.equal(cardRes.status, 200, 'Report card retrieval must succeed');
    assert.equal(cardRes.body.reportCard.student.first_name, 'John');
    assert.equal(Number(cardRes.body.reportCard.results[0]?.marks), 92);
    assert.equal(cardRes.body.reportCard.results[0]?.grade, 'A');

    console.log('[E2E] -> STEP 10: Timetable Operations');
    // ==========================================
    // STEP 10: Timetable Operations (Gate D)
    // ==========================================
    const periodRes = await api('/api/school/timetable/periods', {
      method: 'POST',
      token: schoolToken,
      body: {
        academicYearId,
        name: 'Period 1',
        periodNumber: 1,
        startsAt: '08:30:00',
        endsAt: '09:15:00',
        isBreak: false,
      },
    });
    assert.equal(periodRes.status, 201, 'Period creation must succeed');
    const periodId = periodRes.body.period.id;

    // Schedule entry
    const entryRes = await api('/api/school/timetable', {
      method: 'POST',
      token: schoolToken,
      body: {
        academicYearId,
        periodId,
        classId,
        sectionId,
        subjectId,
        teacherId,
        dayOfWeek: 1, // Monday
        room: 'Room 101',
      },
    });
    assert.equal(entryRes.status, 201, 'Timetable entry creation must succeed');

    // Conflict prevention check: attempt same room at same time with another class
    const conflictRes = await api('/api/school/timetable', {
      method: 'POST',
      token: schoolToken,
      body: {
        academicYearId,
        periodId,
        classId,
        sectionId,
        subjectId,
        teacherId,
        dayOfWeek: 1,
        room: 'Room 101',
      },
    });
    assert.equal(conflictRes.status, 409, 'Conflict prevention must reject collision with 409');

    // Publish timetable
    const pubTimetableRes = await api('/api/school/timetable/publish', {
      method: 'POST',
      token: schoolToken,
      body: { academicYearId },
    });
    assert.equal(pubTimetableRes.status, 200, 'Timetable publishing must succeed');

    console.log('[E2E] -> STEP 11: Fees & Payments');
    // ==========================================
    // STEP 11: Fees & Payments Operations (Gate E)
    // ==========================================
    const feeCatRes = await api('/api/school/fees/categories', {
      method: 'POST',
      token: schoolToken,
      body: {
        name: 'Academic Tuition',
        categoryType: 'tuition',
      },
    });
    assert.equal(feeCatRes.status, 201, 'Fee category creation must succeed');
    const categoryId = feeCatRes.body.category.id;

    const feeStructRes = await api('/api/school/fees/structures', {
      method: 'POST',
      token: schoolToken,
      body: {
        categoryId,
        academicYearId,
        amountMinor: 2500000, // ₹25,000.00
        currency: 'INR',
        dueOn: '2026-06-30',
        description: 'Grade 10 Term 1 Tuition',
      },
    });
    assert.equal(feeStructRes.status, 201, 'Fee structure creation must succeed');
    const structureId = feeStructRes.body.structure.id;

    // Assign fee to John Doe
    const assignFeeRes = await api('/api/school/fees/assignments', {
      method: 'POST',
      token: schoolToken,
      body: {
        feeStructureId: structureId,
        studentId: student1Id,
      },
    });
    assert.equal(assignFeeRes.status, 201, 'Fee assignment must succeed');
    const studentFeeId = assignFeeRes.body.fee.id;
    assert.ok(studentFeeId, 'Assigned fee ID must exist');

    // Record Offline Payment
    const paymentRes = await api('/api/school/fees/payments', {
      method: 'POST',
      token: schoolToken,
      body: {
        studentFeeId,
        amountMinor: 2500000,
        method: 'bank_transfer',
        reference: 'BANK-REF-9876543210',
        idempotencyKey: 'PAYMENT-KEY-GW-2026-001',
      },
    });
    assert.equal(paymentRes.status, 201, 'Payment recording must succeed');
    assert.ok(paymentRes.body.receipt.receipt_number, 'Receipt number must be generated');

    // Verify balance is 0
    const studentFeeLedger = await api(`/api/school/fees/students/${student1Id}`, {
      token: schoolToken,
    });
    assert.equal(studentFeeLedger.status, 200);
    assert.equal(Number(studentFeeLedger.body.items[0]?.balance_minor), 0);

    console.log('[E2E] -> STEP 12: Announcements & Notifications');
    // ==========================================
    // STEP 12: Announcements & Notifications (Gate F)
    // ==========================================
    const announceRes = await api('/api/school/announcements', {
      method: 'POST',
      token: schoolToken,
      body: {
        title: 'Annual Science & Arts Exhibition 2026',
        body: 'All parents, teachers and students are cordially invited to attend the Annual Exhibition on June 25th.',
        audience: { type: 'school' },
        publish: true,
      },
    });
    assert.equal(announceRes.status, 201, 'Announcement creation and publication must succeed');

    // Check notification in school admin feed
    const notifsRes = await api('/api/school/notifications', {
      token: schoolToken,
    });
    assert.equal(notifsRes.status, 200, 'Notifications query must succeed');
    assert.ok(notifsRes.body.items.length >= 1, 'In-app notification must be delivered');
    const notifId = notifsRes.body.items[0].id;

    // Mark notification as read
    const readRes = await api(`/api/school/notifications/${notifId}/read`, {
      method: 'PATCH',
      token: schoolToken,
    });
    assert.equal(readRes.status, 200, 'Marking notification read must succeed');
    assert.ok(readRes.body.notification.read_at, 'Notification read_at must be populated');

    console.log('[E2E] -> STEP 13: Reports & Analytics');
    // ==========================================
    // STEP 13: Reports & Analytics (Gate G)
    // ==========================================
    const dashboardReport = await api('/api/school/reports/dashboard', { token: schoolToken });
    assert.equal(dashboardReport.status, 200, 'Dashboard report query must succeed');
    assert.equal(dashboardReport.body.counts.active_students, 2);
    assert.equal(dashboardReport.body.counts.active_teachers, 1);
    assert.ok(dashboardReport.body.fees.netCollectedMinor > 0);

    const academicReport = await api('/api/school/reports/academics', { token: schoolToken });
    assert.equal(academicReport.status, 200, 'Academic report query must succeed');
    assert.ok(academicReport.body.items.length >= 1);

    const exportCsv = await api('/api/school/reports/export?type=students&format=csv', { token: schoolToken });
    assert.equal(exportCsv.status, 200, 'Student CSV export must succeed');
    assert.ok(exportCsv.headers.get('content-type')?.includes('text/csv'));
    assert.ok(typeof exportCsv.body === 'string' && exportCsv.body.includes('GW-2026-001'));

    console.log('[E2E] -> STEP 14: Multi-Tenant Zero-Leakage Isolation');
    // ==========================================
    // STEP 14: Multi-Tenant Zero-Leakage Isolation Verification
    // ==========================================
    // Provision School 2: "Crescent Hill Academy"
    const school2Res = await api('/api/platform/schools', {
      method: 'POST',
      token: platformToken,
      body: {
        name: 'Crescent Hill Academy',
        address: '99 Mountain Pass, Pune',
        contactEmail: 'contact@crescent.edu',
        contactPhone: '+91 91234 56789',
        principalName: 'Dr. Gregory House',
        schoolType: 'general',
        website: 'https://crescent.edu',
        academicYearLabel: '2026–27',
        planId,
        administratorName: 'Crescent Administrator',
        administratorEmail: 'admin@crescent.edu',
      },
    });
    assert.equal(school2Res.status, 201);
    const school2 = school2Res.body.school;
    const s2Token = new URL(school2Res.body.invitation.developmentUrl).searchParams.get('token')!;

    const s2Accept = await api('/api/auth/accept-invitation', {
      method: 'POST',
      body: {
        token: s2Token,
        name: 'Crescent Administrator',
        password: 'CrescentPassword#2026',
      },
    });
    assert.equal(s2Accept.status, 201);
    const s2SchoolToken = s2Accept.body.accessToken;

    // Attempt to access Greenwood student from Crescent -> Must return 0 items / 404
    const s2StudentAccess = await api(`/api/school/students?search=GW-2026-001`, {
      token: s2SchoolToken,
    });
    assert.equal(s2StudentAccess.status, 200);
    assert.equal(s2StudentAccess.body.items.length, 0, 'Cross-tenant student access must yield 0 results');

    // Attempt to view Greenwood exam from Crescent -> Must 404
    const s2ExamAccess = await api(`/api/school/examinations/${examId}`, {
      token: s2SchoolToken,
    });
    assert.equal(s2ExamAccess.status, 404, 'Cross-tenant examination must return 404');

    // Attempt to view Greenwood fee structure from Crescent -> Must return 0 items
    const s2FeesAccess = await api('/api/school/fees/structures', {
      token: s2SchoolToken,
    });
    assert.equal(s2FeesAccess.status, 200);
    assert.equal(s2FeesAccess.body.items.length, 0, 'Cross-tenant fee structures must yield 0 items');

    // Attempt to view Greenwood announcements from Crescent -> Must return 0 items
    const s2AnnounceAccess = await api('/api/school/announcements', {
      token: s2SchoolToken,
    });
    assert.equal(s2AnnounceAccess.status, 200);
    assert.equal(s2AnnounceAccess.body.items.length, 0, 'Cross-tenant announcements must yield 0 items');

    console.info('========================================================================');
    console.info('SUCCESS: ALL 14 E2E LIFECYCLE PHASES PASSED WITH ZERO TENANT DISCLOSURE');
    console.info('========================================================================');
  } finally {
    if (typeof (server as any).closeAllConnections === 'function') {
      (server as any).closeAllConnections();
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    await Promise.all([pool.end(), platformPool.end()]);
    await socket.stop();
    await db.close();
  }
});
