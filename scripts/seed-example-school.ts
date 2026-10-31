import pg from 'pg';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';

async function seed() {
  const pool = new pg.Pool({
    connectionString: 'postgresql://educonnect_platform:local-dev-platform-pass-2026@127.0.0.1:5432/postgres?sslmode=disable',
  });

  try {
    console.log('[Seed] Starting example school data seed...');

    // 1. Get or Create School CS-SCH-0001
    let school = (await pool.query("SELECT id, school_id, name FROM schools WHERE school_id = 'CS-SCH-0001'")).rows[0];
    if (!school) {
      const plan = (await pool.query("SELECT id FROM subscription_plans LIMIT 1")).rows[0];
      const res = await pool.query(
        `INSERT INTO schools (name, school_id, address, contact_email, contact_phone, principal_name, school_type, website, status)
         VALUES ('KIDZLAND International Academy', 'CS-SCH-0001', '100 Silicon Boulevard, Bangalore', 'office@kidzland.edu', '+91 98765 43210', 'Dr. Aril Srinivas', 'general', 'https://kidzland.edu', 'active')
         RETURNING id, school_id, name`
      );
      school = res.rows[0];
      console.log('[Seed] Created school CS-SCH-0001:', school.name);
    } else {
      await pool.query("UPDATE schools SET name = 'KIDZLAND International Academy', status = 'active' WHERE id = $1", [school.id]);
      console.log('[Seed] Using existing school CS-SCH-0001:', school.name);
    }
    const schoolId = school.id;

    // Ensure active subscription
    const existingSub = await pool.query('SELECT id FROM subscriptions WHERE school_id = $1', [schoolId]);
    if (!existingSub.rows[0]) {
      const plan = (await pool.query("SELECT id FROM subscription_plans LIMIT 1")).rows[0];
      await pool.query(
        "INSERT INTO subscriptions (school_id, plan_id, status, expires_at) VALUES ($1, $2, 'active', now() + interval '1 year')",
        [schoolId, plan.id]
      );
    }

    // 2. Fetch School Roles
    const rolesRes = await pool.query('SELECT id, code, member_kind FROM school_roles WHERE school_id = $1', [schoolId]);
    const roleMap = new Map<string, string>();
    for (const r of rolesRes.rows) {
      roleMap.set(r.code, r.id);
    }

    const adminRoleId = roleMap.get('school_administrator') || roleMap.get('principal')!;
    const teacherRoleId = roleMap.get('teacher') || roleMap.get('class_teacher')!;
    const parentRoleId = roleMap.get('parent')!;
    const studentRoleId = roleMap.get('student')!;

    // 3. Helper to upsert user and membership
    const hashCache = new Map<string, string>();
    async function getHash(pw: string) {
      if (!hashCache.has(pw)) {
        hashCache.set(pw, await argon2.hash(pw, { type: argon2.argon2id }));
      }
      return hashCache.get(pw)!;
    }

    async function upsertUser(email: string, name: string, passwordText: string, memberKind: string, roleId: string) {
      const pwHash = await getHash(passwordText);
      const userRes = await pool.query(
        `INSERT INTO users (email, name, password_hash, is_active)
         VALUES (lower($1), $2, $3, true)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, is_active = true
         RETURNING id, name, email`,
        [email, name, pwHash]
      );
      const user = userRes.rows[0];

      const memRes = await pool.query(
        `INSERT INTO school_memberships (school_id, user_id, role, school_role_id, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (school_id, user_id) DO UPDATE SET role = EXCLUDED.role, school_role_id = EXCLUDED.school_role_id, is_active = true
         RETURNING id`,
        [schoolId, user.id, memberKind, roleId]
      );
      return { ...user, membershipId: memRes.rows[0].id };
    }

    // Seed Users
    // 3a. Primary Administrator (arilsrinivas8@gmail.com / Password#2026)
    const adminUser = await upsertUser('arilsrinivas8@gmail.com', 'Aril Srinivas', 'Password#2026', 'school_admin', adminRoleId);
    console.log('[Seed] Admin user seeded: arilsrinivas8@gmail.com / Password#2026');

    // 3b. Secondary Administrator (admin@kidzland.edu / Admin#2026)
    await upsertUser('admin@kidzland.edu', 'Dr. Elizabeth Warren', 'Admin#2026', 'school_admin', adminRoleId);

    // 3c. Teachers
    const teacher1 = await upsertUser('teacher@kidzland.edu', 'Prof. Isaac Newton', 'Teacher#2026', 'teacher', teacherRoleId);
    const teacher2 = await upsertUser('teacher2@kidzland.edu', 'Dr. Marie Curie', 'Teacher#2026', 'teacher', teacherRoleId);

    // 3d. Students & Parents
    const studentUser = await upsertUser('student@kidzland.edu', 'John Doe', 'Student#2026', 'student', studentRoleId);
    const parentUser = await upsertUser('parent@kidzland.edu', 'Robert Doe', 'Parent#2026', 'parent', parentRoleId);

    // Mark existing invitation as accepted
    await pool.query("UPDATE invitations SET accepted_at = now() WHERE school_id = $1 AND lower(email) = 'arilsrinivas8@gmail.com'", [schoolId]);

    // 4. School Settings & Branding (Gate H)
    const brandingSettings = {
      branding: {
        displayName: 'KIDZLAND International Academy',
        primaryColor: '#0ea5e9',
        logoUrl: 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=128&q=80',
      },
      notifications: {
        email_alerts: true,
        fee_alerts: true,
        parent_notifications: true,
      },
    };
    await pool.query(
      `INSERT INTO school_settings (school_id, academic_year_label, settings, updated_at)
       VALUES ($1, '2026–2027 Academic Session', $2, now())
       ON CONFLICT (school_id) DO UPDATE SET academic_year_label = EXCLUDED.academic_year_label, settings = EXCLUDED.settings, updated_at = now()`,
      [schoolId, JSON.stringify(brandingSettings)]
    );

    // 5. Academic Year (2026–2027)
    let year = (await pool.query("SELECT id FROM academic_years WHERE school_id = $1 AND name = '2026–2027'", [schoolId])).rows[0];
    if (!year) {
      const yearRes = await pool.query(
        `INSERT INTO academic_years (school_id, name, starts_on, ends_on, is_current)
         VALUES ($1, '2026–2027', '2026-04-01', '2027-03-31', true)
         RETURNING id`,
        [schoolId]
      );
      year = yearRes.rows[0];
    }
    const yearId = year.id;

    // 6. Classes
    async function upsertClass(name: string, gradeLevel: number) {
      let cl = (await pool.query('SELECT id FROM classes WHERE school_id = $1 AND academic_year_id = $2 AND name = $3', [schoolId, yearId, name])).rows[0];
      if (!cl) {
        const res = await pool.query(
          'INSERT INTO classes (school_id, academic_year_id, name, grade_level) VALUES ($1, $2, $3, $4) RETURNING id',
          [schoolId, yearId, name, gradeLevel]
        );
        cl = res.rows[0];
      }
      return cl.id;
    }

    const grade10Id = await upsertClass('Grade 10', 10);
    const grade9Id = await upsertClass('Grade 9', 9);
    const grade5Id = await upsertClass('Grade 5', 5);

    // 7. Sections
    async function upsertSection(classId: string, name: string, room: string) {
      let sec = (await pool.query('SELECT id FROM sections WHERE school_id = $1 AND class_id = $2 AND name = $3', [schoolId, classId, name])).rows[0];
      if (!sec) {
        const res = await pool.query(
          'INSERT INTO sections (school_id, class_id, name, room) VALUES ($1, $2, $3, $4) RETURNING id',
          [schoolId, classId, name, room]
        );
        sec = res.rows[0];
      }
      return sec.id;
    }

    const sec10A = await upsertSection(grade10Id, 'Section A', 'Room 101');
    const sec10B = await upsertSection(grade10Id, 'Section B', 'Room 102');
    const sec9A = await upsertSection(grade9Id, 'Section A', 'Room 201');

    // 8. Subjects
    async function upsertSubject(name: string, code: string) {
      let sub = (await pool.query('SELECT id FROM subjects WHERE school_id = $1 AND code = $2', [schoolId, code])).rows[0];
      if (!sub) {
        const res = await pool.query('INSERT INTO subjects (school_id, name, code) VALUES ($1, $2, $3) RETURNING id', [schoolId, name, code]);
        sub = res.rows[0];
      }
      return sub.id;
    }

    const subPhysics = await upsertSubject('Physics', 'PHY-101');
    const subMath = await upsertSubject('Mathematics', 'MTH-101');
    const subEnglish = await upsertSubject('English Literature', 'ENG-101');
    const subCS = await upsertSubject('Computer Science', 'CS-101');

    // Link Class Subjects
    for (const sId of [subPhysics, subMath, subEnglish, subCS]) {
      await pool.query(
        'INSERT INTO class_subjects (school_id, class_id, subject_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [schoolId, grade10Id, sId]
      );
    }

    // 9. Teachers Table Records & Assignments
    async function upsertTeacher(userId: string, empId: string) {
      let t = (await pool.query('SELECT id FROM teachers WHERE school_id = $1 AND user_id = $2', [schoolId, userId])).rows[0];
      if (!t) {
        const res = await pool.query(
          "INSERT INTO teachers (school_id, user_id, employee_id, employment_status) VALUES ($1, $2, $3, 'active') RETURNING id",
          [schoolId, userId, empId]
        );
        t = res.rows[0];
      }
      return t.id;
    }

    const teacherNewtonId = await upsertTeacher(teacher1.id, 'EMP-NEWTON');
    const teacherCurieId = await upsertTeacher(teacher2.id, 'EMP-CURIE');

    // Assign Newton to Grade 10 Physics & Math
    const csPhysics = (await pool.query('SELECT id FROM class_subjects WHERE school_id=$1 AND class_id=$2 AND subject_id=$3', [schoolId, grade10Id, subPhysics])).rows[0]?.id;
    const csMath = (await pool.query('SELECT id FROM class_subjects WHERE school_id=$1 AND class_id=$2 AND subject_id=$3', [schoolId, grade10Id, subMath])).rows[0]?.id;
    const csCS = (await pool.query('SELECT id FROM class_subjects WHERE school_id=$1 AND class_id=$2 AND subject_id=$3', [schoolId, grade10Id, subCS])).rows[0]?.id;

    if (csPhysics) {
      await pool.query('INSERT INTO teacher_assignments (school_id, teacher_id, class_subject_id, section_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [schoolId, teacherNewtonId, csPhysics, sec10A]);
    }
    if (csMath) {
      await pool.query('INSERT INTO teacher_assignments (school_id, teacher_id, class_subject_id, section_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [schoolId, teacherNewtonId, csMath, sec10A]);
    }
    if (csCS) {
      await pool.query('INSERT INTO teacher_assignments (school_id, teacher_id, class_subject_id, section_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [schoolId, teacherCurieId, csCS, sec10A]);
    }

    // 10. Students & Enrollments
    async function upsertStudent(admissionNo: string, firstName: string, lastName: string, dob: string, classId: string, sectionId: string, linkedUserId?: string) {
      let st = (await pool.query('SELECT id FROM students WHERE school_id = $1 AND admission_number = $2', [schoolId, admissionNo])).rows[0];
      if (!st) {
        const res = await pool.query(
          `INSERT INTO students (school_id, admission_number, first_name, last_name, date_of_birth, user_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'active')
           RETURNING id`,
          [schoolId, admissionNo, firstName, lastName, dob, linkedUserId || null]
        );
        st = res.rows[0];
      } else if (linkedUserId) {
        await pool.query('UPDATE students SET user_id = $1 WHERE id = $2', [linkedUserId, st.id]);
      }

      await pool.query(
        `INSERT INTO student_enrollments (school_id, student_id, academic_year_id, class_id, section_id, enrolled_on, status)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'active')
         ON CONFLICT (school_id, student_id, academic_year_id) DO UPDATE SET class_id = EXCLUDED.class_id, section_id = EXCLUDED.section_id, status = 'active'`,
        [schoolId, st.id, yearId, classId, sectionId]
      );
      return st.id;
    }

    const stJohn = await upsertStudent('GW-2026-001', 'John', 'Doe', '2010-05-15', grade10Id, sec10A, studentUser.id);
    const stJane = await upsertStudent('GW-2026-002', 'Jane', 'Roe', '2010-08-22', grade10Id, sec10A);
    const stAlex = await upsertStudent('GW-2026-003', 'Alex', 'Smith', '2010-11-04', grade10Id, sec10A);
    const stEmma = await upsertStudent('GW-2026-004', 'Emma', 'Watson', '2010-03-12', grade10Id, sec10B);
    const stMichael = await upsertStudent('GW-2026-005', 'Michael', 'Brown', '2011-07-19', grade9Id, sec9A);

    // 11. Parents
    let parent = (await pool.query('SELECT id FROM parents WHERE school_id = $1 AND user_id = $2', [schoolId, parentUser.id])).rows[0];
    if (!parent) {
      const res = await pool.query('INSERT INTO parents (school_id, user_id) VALUES ($1, $2) RETURNING id', [schoolId, parentUser.id]);
      parent = res.rows[0];
    }
    await pool.query('INSERT INTO student_parents (school_id, student_id, parent_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [schoolId, stJohn, parent.id]);

    // 12. Attendance (Gate A)
    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    for (const d of [yesterdayStr, todayStr]) {
      await pool.query(
        `INSERT INTO attendance (school_id, student_id, academic_year_id, class_id, section_id, attendance_date, status, note)
         VALUES ($1, $2, $3, $4, $5, $6, 'present', NULL)
         ON CONFLICT (school_id, student_id, attendance_date) DO NOTHING`,
        [schoolId, stJohn, yearId, grade10Id, sec10A, d]
      );
      await pool.query(
        `INSERT INTO attendance (school_id, student_id, academic_year_id, class_id, section_id, attendance_date, status, note)
         VALUES ($1, $2, $3, $4, $5, $6, 'absent', 'Medical appointment')
         ON CONFLICT (school_id, student_id, attendance_date) DO NOTHING`,
        [schoolId, stJane, yearId, grade10Id, sec10A, d]
      );
      await pool.query(
        `INSERT INTO attendance (school_id, student_id, academic_year_id, class_id, section_id, attendance_date, status, note)
         VALUES ($1, $2, $3, $4, $5, $6, 'present', NULL)
         ON CONFLICT (school_id, student_id, attendance_date) DO NOTHING`,
        [schoolId, stAlex, yearId, grade10Id, sec10A, d]
      );
    }
    console.log('[Seed] Attendance records seeded.');

    // 13. Homework (Gate B) - table name is `assignments`
    let hw = (await pool.query('SELECT id FROM assignments WHERE school_id = $1 AND title = $2', [schoolId, "Kinematics & Newton's Laws Problem Set"])).rows[0];
    if (!hw) {
      const res = await pool.query(
        `INSERT INTO assignments (school_id, class_id, section_id, subject_id, teacher_id, title, description, max_score, due_at, status, published_at)
         VALUES ($1, $2, $3, $4, $5, 'Kinematics & Newton''s Laws Problem Set', 'Complete exercises 1 to 15 from Chapter 3 on Newton laws and linear momentum.', 100, now() + interval '14 days', 'published', now())
         RETURNING id`,
        [schoolId, grade10Id, sec10A, subPhysics, teacherNewtonId]
      );
      hw = res.rows[0];
    }
    const hwId = hw.id;

    // Student submission - table name is `assignment_submissions`
    let sub = (await pool.query('SELECT id FROM assignment_submissions WHERE school_id = $1 AND assignment_id = $2 AND student_id = $3', [schoolId, hwId, stJohn])).rows[0];
    if (!sub) {
      const res = await pool.query(
        `INSERT INTO assignment_submissions (school_id, assignment_id, student_id, response_text, score, feedback, reviewed_by, reviewed_at, submitted_at)
         VALUES ($1, $2, $3, 'Attached step-by-step solutions for kinematics problems 1-15.', 95.00, 'Excellent mathematical derivation and clear free-body diagrams!', $4, now(), now())
         RETURNING id`,
        [schoolId, hwId, stJohn, teacher1.membershipId]
      );
      sub = res.rows[0];
    }
    console.log('[Seed] Homework and submission seeded.');

    // 14. Examinations & Report Cards (Gate C)
    let exam = (await pool.query("SELECT id FROM examinations WHERE school_id = $1 AND name = 'Term 1 Final Examination'", [schoolId])).rows[0];
    if (!exam) {
      const res = await pool.query(
        `INSERT INTO examinations (school_id, academic_year_id, name, exam_type, starts_on, ends_on, status, published_at, results_published_at)
         VALUES ($1, $2, 'Term 1 Final Examination', 'terminal', '2026-06-01', '2026-06-15', 'published', now(), now())
         RETURNING id`,
        [schoolId, yearId]
      );
      exam = res.rows[0];
    }
    const examId = exam.id;

    // Exam subjects
    let esPhysics = (await pool.query('SELECT id FROM examination_subjects WHERE school_id = $1 AND examination_id = $2 AND subject_id = $3', [schoolId, examId, subPhysics])).rows[0];
    if (!esPhysics) {
      const res = await pool.query(
        `INSERT INTO examination_subjects (school_id, examination_id, academic_year_id, class_id, section_id, subject_id, max_marks)
         VALUES ($1, $2, $3, $4, $5, $6, 100)
         RETURNING id`,
        [schoolId, examId, yearId, grade10Id, sec10A, subPhysics]
      );
      esPhysics = res.rows[0];
    }

    let esMath = (await pool.query('SELECT id FROM examination_subjects WHERE school_id = $1 AND examination_id = $2 AND subject_id = $3', [schoolId, examId, subMath])).rows[0];
    if (!esMath) {
      const res = await pool.query(
        `INSERT INTO examination_subjects (school_id, examination_id, academic_year_id, class_id, section_id, subject_id, max_marks)
         VALUES ($1, $2, $3, $4, $5, $6, 100)
         RETURNING id`,
        [schoolId, examId, yearId, grade10Id, sec10A, subMath]
      );
      esMath = res.rows[0];
    }

    // Grading scale
    for (const g of [
      { grade: 'A', min: 80, max: 100, ord: 1 },
      { grade: 'B', min: 65, max: 79.99, ord: 2 },
      { grade: 'C', min: 50, max: 64.99, ord: 3 },
      { grade: 'F', min: 0, max: 49.99, ord: 4 },
    ]) {
      await pool.query(
        `INSERT INTO examination_grading_scales (school_id, examination_id, grade, min_percent, max_percent, ordinal)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (school_id, examination_id, grade) DO NOTHING`,
        [schoolId, examId, g.grade, g.min, g.max, g.ord]
      );
    }

    // Marks
    await pool.query(
      `INSERT INTO examination_results (school_id, examination_subject_id, student_id, marks, grade)
       VALUES ($1, $2, $3, 92.00, 'A')
       ON CONFLICT (school_id, examination_subject_id, student_id) DO UPDATE SET marks = 92.00, grade = 'A'`,
      [schoolId, esPhysics.id, stJohn]
    );
    await pool.query(
      `INSERT INTO examination_results (school_id, examination_subject_id, student_id, marks, grade)
       VALUES ($1, $2, $3, 96.00, 'A')
       ON CONFLICT (school_id, examination_subject_id, student_id) DO UPDATE SET marks = 96.00, grade = 'A'`,
      [schoolId, esMath.id, stJohn]
    );
    await pool.query(
      `INSERT INTO examination_results (school_id, examination_subject_id, student_id, marks, grade)
       VALUES ($1, $2, $3, 78.00, 'B')
       ON CONFLICT (school_id, examination_subject_id, student_id) DO UPDATE SET marks = 78.00, grade = 'B'`,
      [schoolId, esPhysics.id, stJane]
    );
    await pool.query(
      `INSERT INTO examination_results (school_id, examination_subject_id, student_id, marks, grade)
       VALUES ($1, $2, $3, 85.00, 'A')
       ON CONFLICT (school_id, examination_subject_id, student_id) DO UPDATE SET marks = 85.00, grade = 'A'`,
      [schoolId, esPhysics.id, stAlex]
    );
    console.log('[Seed] Examination and marks seeded.');

    // 15. Timetable (Gate D)
    async function upsertPeriod(num: number, name: string, starts: string, ends: string, isBreak = false) {
      let p = (await pool.query('SELECT id FROM timetable_periods WHERE school_id = $1 AND academic_year_id = $2 AND period_number = $3', [schoolId, yearId, num])).rows[0];
      if (!p) {
        const res = await pool.query(
          `INSERT INTO timetable_periods (school_id, academic_year_id, period_number, name, starts_at, ends_at, is_break)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [schoolId, yearId, num, name, starts, ends, isBreak]
        );
        p = res.rows[0];
      }
      return p.id;
    }

    const p1 = await upsertPeriod(1, 'Period 1', '08:30:00', '09:15:00');
    const p2 = await upsertPeriod(2, 'Period 2', '09:15:00', '10:00:00');
    const p3 = await upsertPeriod(3, 'Break', '10:00:00', '10:20:00', true);
    const p4 = await upsertPeriod(4, 'Period 3', '10:20:00', '11:05:00');
    const p5 = await upsertPeriod(5, 'Period 4', '11:05:00', '11:50:00');

    // Schedule Monday to Friday entries - table name is `timetables`
    for (let day = 1; day <= 5; day++) {
      await pool.query(
        `INSERT INTO timetables (school_id, academic_year_id, period_id, class_id, section_id, subject_id, teacher_id, day_of_week, starts_at, ends_at, room, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '08:30:00'::time, '09:15:00'::time, 'Room 101', 'published')
         ON CONFLICT DO NOTHING`,
        [schoolId, yearId, p1, grade10Id, sec10A, subPhysics, teacherNewtonId, day]
      );
      await pool.query(
        `INSERT INTO timetables (school_id, academic_year_id, period_id, class_id, section_id, subject_id, teacher_id, day_of_week, starts_at, ends_at, room, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '09:15:00'::time, '10:00:00'::time, 'Room 101', 'published')
         ON CONFLICT DO NOTHING`,
        [schoolId, yearId, p2, grade10Id, sec10A, subMath, teacherNewtonId, day]
      );
      await pool.query(
        `INSERT INTO timetables (school_id, academic_year_id, period_id, class_id, section_id, subject_id, teacher_id, day_of_week, starts_at, ends_at, room, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '10:20:00'::time, '11:05:00'::time, 'Room 101', 'published')
         ON CONFLICT DO NOTHING`,
        [schoolId, yearId, p4, grade10Id, sec10A, subCS, teacherCurieId, day]
      );
    }
    console.log('[Seed] Timetable entries seeded.');

    // 16. Fees & Ledger (Gate E)
    let catTuition = (await pool.query("SELECT id FROM fee_categories WHERE school_id = $1 AND name = 'Academic Tuition'", [schoolId])).rows[0];
    if (!catTuition) {
      const res = await pool.query(
        "INSERT INTO fee_categories (school_id, name, category_type) VALUES ($1, 'Academic Tuition', 'tuition') RETURNING id",
        [schoolId]
      );
      catTuition = res.rows[0];
    }
    let catLab = (await pool.query("SELECT id FROM fee_categories WHERE school_id = $1 AND name = 'Laboratory & Science'", [schoolId])).rows[0];
    if (!catLab) {
      const res = await pool.query(
        "INSERT INTO fee_categories (school_id, name, category_type) VALUES ($1, 'Laboratory & Science', 'custom') RETURNING id",
        [schoolId]
      );
      catLab = res.rows[0];
    }

    let fsTuition = (await pool.query('SELECT id FROM fee_structures WHERE school_id = $1 AND category_id = $2 AND academic_year_id = $3', [schoolId, catTuition.id, yearId])).rows[0];
    if (!fsTuition) {
      const res = await pool.query(
        `INSERT INTO fee_structures (school_id, category_id, academic_year_id, amount_minor, currency, due_on, description)
         VALUES ($1, $2, $3, 2500000, 'INR', '2026-06-30', 'Grade 10 Term 1 Tuition')
         RETURNING id`,
        [schoolId, catTuition.id, yearId]
      );
      fsTuition = res.rows[0];
    }

    // Assign Fee to John Doe & Jane Roe
    async function assignFee(studentId: string, structureId: string) {
      let sf = (await pool.query('SELECT id FROM student_fees WHERE school_id = $1 AND student_id = $2 AND fee_structure_id = $3', [schoolId, studentId, structureId])).rows[0];
      if (!sf) {
        const res = await pool.query(
          `INSERT INTO student_fees (school_id, student_id, fee_structure_id, amount_due_minor, due_on, is_active)
           VALUES ($1, $2, $3, 2500000, '2026-06-30', true)
           RETURNING id`,
          [schoolId, studentId, structureId]
        );
        sf = res.rows[0];
      }
      return sf.id;
    }

    const sfJohn = await assignFee(stJohn, fsTuition.id);
    const sfJane = await assignFee(stJane, fsTuition.id);

    // Record Payment for John Doe (₹25,000 paid in full)
    let payment = (await pool.query('SELECT id FROM payments WHERE school_id = $1 AND student_fee_id = $2', [schoolId, sfJohn])).rows[0];
    if (!payment) {
      const pRes = await pool.query(
        `INSERT INTO payments (school_id, student_fee_id, amount_minor, method, reference, received_by, paid_at, idempotency_key)
         VALUES ($1, $2, 2500000, 'bank_transfer', 'NEFT-AXIS-9876543210', $3, now(), 'IDEMP-JOHN-001')
         RETURNING id`,
        [schoolId, sfJohn, adminUser.membershipId]
      );
      payment = pRes.rows[0];

      await pool.query(
        `INSERT INTO payment_receipts (school_id, payment_id, receipt_number)
         VALUES ($1, $2, 'REC-2026-0001')
         ON CONFLICT DO NOTHING`,
        [schoolId, payment.id]
      );
    }
    console.log('[Seed] Fee structures, assignments and payment receipts seeded.');

    // 17. Announcements & Notifications (Gate F)
    let ann = (await pool.query("SELECT id FROM announcements WHERE school_id = $1 AND title = 'Annual Science & Arts Exhibition 2026'", [schoolId])).rows[0];
    if (!ann) {
      const res = await pool.query(
        `INSERT INTO announcements (school_id, author_membership_id, title, body, audience, status, published_at)
         VALUES ($1, $2, 'Annual Science & Arts Exhibition 2026', 'All parents, teachers and students are cordially invited to attend the Annual Exhibition on June 25th in the Main Auditorium.', '{"type":"school"}', 'published', now())
         RETURNING id`,
        [schoolId, adminUser.membershipId]
      );
      ann = res.rows[0];
    }

    // In-app notifications
    for (const u of [adminUser, teacher1, parentUser, studentUser]) {
      await pool.query(
        `INSERT INTO notifications (school_id, user_id, event_type, title, payload)
         VALUES ($1, $2, 'announcement.published', 'New Announcement: Annual Science & Arts Exhibition 2026', $3)`,
        [schoolId, u.id, JSON.stringify({ announcementId: ann.id })]
      );
    }
    console.log('[Seed] Announcements and notifications seeded.');

    console.log('\n=============================================================');
    console.log('SUCCESS: Example School CS-SCH-0001 fully seeded and active!');
    console.log('=============================================================');
    console.log('School:   KIDZLAND International Academy (CS-SCH-0001)');
    console.log('Admin:     arilsrinivas8@gmail.com  / Password#2026');
    console.log('Admin 2:   admin@kidzland.edu       / Admin#2026');
    console.log('Teacher:   teacher@kidzland.edu     / Teacher#2026');
    console.log('Teacher 2: teacher2@kidzland.edu    / Teacher#2026');
    console.log('Student:   student@kidzland.edu     / Student#2026');
    console.log('Parent:    parent@kidzland.edu      / Parent#2026');
    console.log('Super Admin: admin@calmstacks.example / SuperAdmin#2026');
    console.log('=============================================================\n');
  } finally {
    await pool.end();
  }
}

seed().catch(err => {
  console.error('[Seed Error]:', err);
  process.exit(1);
});
