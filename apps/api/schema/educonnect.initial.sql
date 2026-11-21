-- EduConnect fresh-install schema. Consolidated from reviewed schema definitions; no legacy records are imported.

-- Apply once to a verified empty EduConnect database using a dedicated migration owner.



-- ===== 001_initial.sql =====
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
CREATE SEQUENCE IF NOT EXISTS school_display_id_seq START 1;

CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE platform_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, description text NOT NULL DEFAULT '');
CREATE TABLE platform_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, description text NOT NULL DEFAULT '');
CREATE TABLE platform_role_permissions (role_id uuid NOT NULL REFERENCES platform_roles(id) ON DELETE CASCADE, permission_id uuid NOT NULL REFERENCES platform_permissions(id) ON DELETE CASCADE, PRIMARY KEY(role_id, permission_id));
CREATE TABLE platform_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, name text NOT NULL, password_hash text NOT NULL, role_id uuid NOT NULL REFERENCES platform_roles(id), is_active boolean NOT NULL DEFAULT true, last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE platform_audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES platform_users(id), action text NOT NULL, target_type text NOT NULL, target_id uuid, metadata jsonb NOT NULL DEFAULT '{}', ip_address inet, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX platform_audit_created_idx ON platform_audit_logs(created_at DESC);

CREATE TYPE school_status AS ENUM ('pending','active','suspended','expired','deactivated');
CREATE TYPE member_role AS ENUM ('school_admin','teacher','parent','student');
CREATE TABLE subscription_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, billing_interval text NOT NULL CHECK (billing_interval IN ('monthly','annual','trial')), price_minor bigint CHECK (price_minor IS NULL OR price_minor >= 0), trial_days integer NOT NULL DEFAULT 0 CHECK(trial_days >= 0), currency char(3) NOT NULL DEFAULT 'INR', student_limit integer, teacher_limit integer, storage_limit_bytes bigint, enabled_modules jsonb NOT NULL DEFAULT '[]', is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE schools (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id text UNIQUE NOT NULL DEFAULT ('CS-SCH-' || lpad(nextval('school_display_id_seq')::text,4,'0')), name text NOT NULL, address text NOT NULL DEFAULT '', contact_email text NOT NULL, contact_phone text NOT NULL DEFAULT '', principal_name text NOT NULL DEFAULT '', school_type text NOT NULL DEFAULT 'general', website text, logo_file_id uuid, status school_status NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON schools USING (id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (id = nullif(current_setting('app.school_id', true), '')::uuid);
CREATE INDEX schools_status_created_idx ON schools(status,created_at DESC);
CREATE TABLE subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id), plan_id uuid NOT NULL REFERENCES subscription_plans(id), status text NOT NULL CHECK(status IN ('trialing','active','past_due','expired','cancelled')), starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, grace_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id));
CREATE INDEX subscriptions_school_status_idx ON subscriptions(school_id,status,expires_at);
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, name text NOT NULL, password_hash text NOT NULL, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE user_profiles (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, phone text, timezone text NOT NULL DEFAULT 'Asia/Kolkata', locale text NOT NULL DEFAULT 'en-IN');
CREATE TABLE school_memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role member_role NOT NULL, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,user_id), UNIQUE(school_id,id));
ALTER TABLE school_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_memberships USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
CREATE INDEX memberships_user_active_idx ON school_memberships(user_id,is_active);
CREATE TABLE user_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_kind text NOT NULL CHECK(user_kind IN ('platform','school')), user_id uuid NOT NULL, school_id uuid REFERENCES schools(id) ON DELETE CASCADE, refresh_token_hash text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz, replaced_by uuid REFERENCES user_sessions(id), created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz NOT NULL DEFAULT now(), CHECK ((user_kind='school' AND school_id IS NOT NULL) OR (user_kind='platform' AND school_id IS NULL)));
CREATE INDEX sessions_user_idx ON user_sessions(user_kind,user_id) WHERE revoked_at IS NULL;
CREATE TABLE invitations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, email text NOT NULL, name text NOT NULL, role member_role NOT NULL DEFAULT 'school_admin', token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, accepted_at timestamptz, invited_by uuid REFERENCES platform_users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,email));
CREATE INDEX invitations_expiry_idx ON invitations(expires_at) WHERE accepted_at IS NULL;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_invitation_scope ON invitations USING (school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK (school_id=nullif(current_setting('app.school_id',true),'')::uuid);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_user_read ON users FOR SELECT USING (EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=users.id AND m.school_id=nullif(current_setting('app.school_id',true),'')::uuid AND m.is_active));
CREATE POLICY tenant_user_invite_insert ON users FOR INSERT WITH CHECK (EXISTS(SELECT 1 FROM invitations i WHERE i.school_id=nullif(current_setting('app.school_id',true),'')::uuid AND lower(i.email)=lower(users.email) AND i.accepted_at IS NULL AND i.expires_at>now()));
CREATE POLICY tenant_user_invite_update ON users FOR UPDATE USING (EXISTS(SELECT 1 FROM invitations i WHERE i.school_id=nullif(current_setting('app.school_id',true),'')::uuid AND lower(i.email)=lower(users.email) AND i.accepted_at IS NULL AND i.expires_at>now())) WITH CHECK (EXISTS(SELECT 1 FROM invitations i WHERE i.school_id=nullif(current_setting('app.school_id',true),'')::uuid AND lower(i.email)=lower(users.email) AND i.accepted_at IS NULL AND i.expires_at>now()));
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_profile_access ON user_profiles USING (EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=user_profiles.user_id AND m.school_id=nullif(current_setting('app.school_id',true),'')::uuid AND m.is_active)) WITH CHECK (EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=user_profiles.user_id AND m.school_id=nullif(current_setting('app.school_id',true),'')::uuid AND m.is_active));
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_access ON user_sessions USING (user_kind='school' AND school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK (user_kind='school' AND school_id=nullif(current_setting('app.school_id',true),'')::uuid);
CREATE TABLE school_settings (school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE, academic_year_label text, settings jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE academic_years (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, name text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL, is_current boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), UNIQUE(school_id,name), CHECK(ends_on >= starts_on));
CREATE UNIQUE INDEX academic_year_one_current_idx ON academic_years(school_id) WHERE is_current;
CREATE TABLE classes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, academic_year_id uuid NOT NULL, name text NOT NULL, grade_level integer, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), UNIQUE(school_id,academic_year_id,name), FOREIGN KEY(school_id,academic_year_id) REFERENCES academic_years(school_id,id));
CREATE TABLE sections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, class_id uuid NOT NULL, name text NOT NULL, room text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), UNIQUE(school_id,class_id,name), FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id));
CREATE TABLE subjects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, name text NOT NULL, code text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), UNIQUE(school_id,name));
CREATE TABLE class_subjects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, class_id uuid NOT NULL, subject_id uuid NOT NULL, UNIQUE(school_id,id), UNIQUE(school_id,class_id,subject_id), FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id), FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id));

CREATE TABLE teachers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, user_id uuid, photo_file_id uuid, employee_id text NOT NULL, qualifications text, employment_status text NOT NULL DEFAULT 'active', hired_on date, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), UNIQUE(school_id,employee_id), FOREIGN KEY(school_id,user_id) REFERENCES school_memberships(school_id,user_id));
CREATE TABLE teacher_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, teacher_id uuid NOT NULL, class_subject_id uuid NOT NULL, section_id uuid, is_class_teacher boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), UNIQUE(school_id,teacher_id,class_subject_id,section_id), FOREIGN KEY(school_id,teacher_id) REFERENCES teachers(school_id,id), FOREIGN KEY(school_id,class_subject_id) REFERENCES class_subjects(school_id,id), FOREIGN KEY(school_id,section_id) REFERENCES sections(school_id,id));
CREATE INDEX teacher_assignments_teacher_idx ON teacher_assignments(school_id,teacher_id);
CREATE TABLE students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, admission_number text NOT NULL, first_name text NOT NULL, last_name text NOT NULL DEFAULT '', photo_file_id uuid, date_of_birth date, gender text, status text NOT NULL DEFAULT 'active', emergency_contact jsonb NOT NULL DEFAULT '{}', medical_notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), UNIQUE(school_id,admission_number));
CREATE INDEX students_school_name_idx ON students(school_id,last_name,first_name);
CREATE TABLE parents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, user_id uuid, relationship text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), FOREIGN KEY(school_id,user_id) REFERENCES school_memberships(school_id,user_id));
CREATE TABLE student_parents (school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, student_id uuid NOT NULL, parent_id uuid NOT NULL, is_primary boolean NOT NULL DEFAULT false, PRIMARY KEY(school_id,student_id,parent_id), FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id), FOREIGN KEY(school_id,parent_id) REFERENCES parents(school_id,id));
CREATE INDEX student_parents_parent_idx ON student_parents(school_id,parent_id);
CREATE TABLE student_enrollments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, student_id uuid NOT NULL, academic_year_id uuid NOT NULL, class_id uuid NOT NULL, section_id uuid, enrolled_on date NOT NULL DEFAULT CURRENT_DATE, status text NOT NULL DEFAULT 'active', ended_on date, UNIQUE(school_id,id), UNIQUE(school_id,student_id,academic_year_id), FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id), FOREIGN KEY(school_id,academic_year_id) REFERENCES academic_years(school_id,id), FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id), FOREIGN KEY(school_id,section_id) REFERENCES sections(school_id,id));
CREATE INDEX enrollments_class_idx ON student_enrollments(school_id,class_id,section_id,academic_year_id);
CREATE TABLE student_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, student_id uuid NOT NULL, uploaded_file_id uuid NOT NULL, category text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id));
CREATE TABLE school_member_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, membership_id uuid NOT NULL, avatar_file_id uuid, profile_data jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,membership_id), FOREIGN KEY(school_id,membership_id) REFERENCES school_memberships(school_id,id));
CREATE TABLE teacher_leaves (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, teacher_id uuid NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL, reason text, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(school_id,teacher_id) REFERENCES teachers(school_id,id), CHECK(ends_on >= starts_on));

CREATE TABLE attendance (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, student_id uuid NOT NULL, class_id uuid NOT NULL, attendance_date date NOT NULL, status text NOT NULL CHECK(status IN ('present','absent','late','excused')), note text, marked_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), UNIQUE(school_id,student_id,attendance_date), FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id), FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id));
CREATE INDEX attendance_date_class_idx ON attendance(school_id,attendance_date,class_id);
CREATE TABLE assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, class_id uuid NOT NULL, subject_id uuid NOT NULL, teacher_id uuid NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '', due_at timestamptz, published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id), FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id), FOREIGN KEY(school_id,teacher_id) REFERENCES teachers(school_id,id));
CREATE TABLE assignment_submissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, assignment_id uuid NOT NULL, student_id uuid NOT NULL, submitted_at timestamptz, file_id uuid, response_text text, score numeric(8,2), feedback text, UNIQUE(school_id,assignment_id,student_id), FOREIGN KEY(school_id,assignment_id) REFERENCES assignments(school_id,id), FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id));
CREATE TABLE examinations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, academic_year_id uuid NOT NULL, name text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL, status text NOT NULL DEFAULT 'draft', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), FOREIGN KEY(school_id,academic_year_id) REFERENCES academic_years(school_id,id));
CREATE TABLE examination_subjects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, examination_id uuid NOT NULL, class_id uuid NOT NULL, subject_id uuid NOT NULL, max_marks numeric(8,2) NOT NULL CHECK(max_marks > 0), exam_at timestamptz, UNIQUE(school_id,id), UNIQUE(school_id,examination_id,class_id,subject_id), FOREIGN KEY(school_id,examination_id) REFERENCES examinations(school_id,id), FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id), FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id));
CREATE TABLE examination_results (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, examination_subject_id uuid NOT NULL, student_id uuid NOT NULL, marks numeric(8,2) CHECK(marks >= 0), grade text, published_at timestamptz, UNIQUE(school_id,examination_subject_id,student_id), FOREIGN KEY(school_id,examination_subject_id) REFERENCES examination_subjects(school_id,id), FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id));
CREATE TABLE report_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, student_id uuid NOT NULL, examination_id uuid NOT NULL, file_id uuid, published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,student_id,examination_id), FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id), FOREIGN KEY(school_id,examination_id) REFERENCES examinations(school_id,id));
CREATE TABLE timetables (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, section_id uuid NOT NULL, subject_id uuid NOT NULL, teacher_id uuid NOT NULL, day_of_week smallint NOT NULL CHECK(day_of_week BETWEEN 1 AND 7), starts_at time NOT NULL, ends_at time NOT NULL, room text, UNIQUE(school_id,id), FOREIGN KEY(school_id,section_id) REFERENCES sections(school_id,id), FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id), FOREIGN KEY(school_id,teacher_id) REFERENCES teachers(school_id,id), CHECK(ends_at > starts_at));

CREATE TABLE fee_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, name text NOT NULL, UNIQUE(school_id,id), UNIQUE(school_id,name));
CREATE TABLE fee_structures (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, category_id uuid NOT NULL, academic_year_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor >= 0), due_on date, UNIQUE(school_id,id), FOREIGN KEY(school_id,category_id) REFERENCES fee_categories(school_id,id), FOREIGN KEY(school_id,academic_year_id) REFERENCES academic_years(school_id,id));
CREATE TABLE student_fees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, student_id uuid NOT NULL, fee_structure_id uuid NOT NULL, amount_due_minor bigint NOT NULL CHECK(amount_due_minor >= 0), UNIQUE(school_id,id), FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id), FOREIGN KEY(school_id,fee_structure_id) REFERENCES fee_structures(school_id,id));
CREATE TABLE payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, student_fee_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor > 0), method text NOT NULL, reference text, received_by uuid, paid_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), FOREIGN KEY(school_id,student_fee_id) REFERENCES student_fees(school_id,id));
CREATE TABLE payment_receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, payment_id uuid NOT NULL, receipt_number text NOT NULL, file_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,receipt_number), FOREIGN KEY(school_id,payment_id) REFERENCES payments(school_id,id));
CREATE TABLE announcements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, author_membership_id uuid, title text NOT NULL, body text NOT NULL, audience jsonb NOT NULL DEFAULT '{"type":"school"}', published_at timestamptz, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, user_id uuid, event_type text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, student_id uuid, subject text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id));
CREATE TABLE conversation_members (school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, conversation_id uuid NOT NULL, membership_id uuid NOT NULL, PRIMARY KEY(school_id,conversation_id,membership_id), FOREIGN KEY(school_id,conversation_id) REFERENCES conversations(school_id,id), FOREIGN KEY(school_id,membership_id) REFERENCES school_memberships(school_id,id));
CREATE TABLE messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, conversation_id uuid NOT NULL, sender_membership_id uuid NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(school_id,conversation_id) REFERENCES conversations(school_id,id), FOREIGN KEY(school_id,sender_membership_id) REFERENCES school_memberships(school_id,id));
CREATE TABLE leave_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, student_id uuid NOT NULL, parent_membership_id uuid NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'pending', reviewed_by uuid, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id), FOREIGN KEY(school_id,parent_membership_id) REFERENCES school_memberships(school_id,id), CHECK(ends_on >= starts_on));
CREATE TABLE uploaded_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, uploaded_by uuid, object_key text NOT NULL, mime_type text NOT NULL, byte_size bigint NOT NULL CHECK(byte_size >= 0), checksum text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), UNIQUE(school_id,object_key));
ALTER TABLE schools ADD CONSTRAINT schools_logo_tenant_fk FOREIGN KEY(id,logo_file_id) REFERENCES uploaded_files(school_id,id);
ALTER TABLE students ADD CONSTRAINT students_photo_tenant_fk FOREIGN KEY(school_id,photo_file_id) REFERENCES uploaded_files(school_id,id);
ALTER TABLE teachers ADD CONSTRAINT teachers_photo_tenant_fk FOREIGN KEY(school_id,photo_file_id) REFERENCES uploaded_files(school_id,id);
ALTER TABLE school_member_profiles ADD CONSTRAINT member_profile_avatar_tenant_fk FOREIGN KEY(school_id,avatar_file_id) REFERENCES uploaded_files(school_id,id);
ALTER TABLE student_documents ADD CONSTRAINT student_documents_file_tenant_fk FOREIGN KEY(school_id,uploaded_file_id) REFERENCES uploaded_files(school_id,id);
ALTER TABLE assignment_submissions ADD CONSTRAINT assignment_submissions_file_tenant_fk FOREIGN KEY(school_id,file_id) REFERENCES uploaded_files(school_id,id);
ALTER TABLE report_cards ADD CONSTRAINT report_cards_file_tenant_fk FOREIGN KEY(school_id,file_id) REFERENCES uploaded_files(school_id,id);
ALTER TABLE payment_receipts ADD CONSTRAINT payment_receipts_file_tenant_fk FOREIGN KEY(school_id,file_id) REFERENCES uploaded_files(school_id,id);
ALTER TABLE uploaded_files ADD CONSTRAINT uploaded_files_uploader_tenant_fk FOREIGN KEY(school_id,uploaded_by) REFERENCES school_memberships(school_id,id);
ALTER TABLE attendance ADD CONSTRAINT attendance_marker_tenant_fk FOREIGN KEY(school_id,marked_by) REFERENCES school_memberships(school_id,id);
ALTER TABLE payments ADD CONSTRAINT payments_receiver_tenant_fk FOREIGN KEY(school_id,received_by) REFERENCES school_memberships(school_id,id);
ALTER TABLE announcements ADD CONSTRAINT announcements_author_tenant_fk FOREIGN KEY(school_id,author_membership_id) REFERENCES school_memberships(school_id,id);
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_reviewer_tenant_fk FOREIGN KEY(school_id,reviewed_by) REFERENCES school_memberships(school_id,id);
CREATE TABLE background_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid REFERENCES schools(id) ON DELETE CASCADE, job_type text NOT NULL, payload jsonb NOT NULL, idempotency_key text UNIQUE, status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE, actor_membership_id uuid, action text NOT NULL, target_type text NOT NULL, target_id uuid, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_tenant_fk FOREIGN KEY(school_id,actor_membership_id) REFERENCES school_memberships(school_id,id);
CREATE INDEX audit_logs_school_created_idx ON audit_logs(school_id,created_at DESC);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscriptions USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON background_jobs USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);

DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT unnest(ARRAY['school_settings','academic_years','classes','sections','subjects','class_subjects','teachers','teacher_assignments','students','parents','student_parents','student_enrollments','student_documents','school_member_profiles','teacher_leaves','attendance','assignments','assignment_submissions','examinations','examination_subjects','examination_results','report_cards','timetables','fee_categories','fee_structures','student_fees','payments','payment_receipts','announcements','notifications','conversations','conversation_members','messages','leave_requests','uploaded_files','audit_logs']) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = nullif(current_setting(''app.school_id'', true), '''')::uuid) WITH CHECK (school_id = nullif(current_setting(''app.school_id'', true), '''')::uuid)', t);
 END LOOP;
END $$;

INSERT INTO platform_roles(name,description) VALUES ('super_admin','CalmStacks platform administrator') ON CONFLICT(name) DO NOTHING;
INSERT INTO platform_permissions(name,description) VALUES ('schools:manage','Create and manage school tenants'),('platform:read','Read platform analytics and audit logs') ON CONFLICT(name) DO NOTHING;
INSERT INTO platform_role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM platform_roles r CROSS JOIN platform_permissions p WHERE r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO subscription_plans(name,billing_interval,price_minor,trial_days) VALUES ('Trial','trial',NULL,30) ON CONFLICT(name) DO NOTHING;

-- ===== 002_school_authority.sql =====
CREATE TABLE school_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  member_kind member_role NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),
  UNIQUE(school_id,code)
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_school_id_id_uidx ON payments(school_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_school_id_id_uidx ON conversations(school_id,id);
CREATE TABLE school_role_permissions (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role_id uuid NOT NULL,
  permission_key text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,role_id,permission_key),
  FOREIGN KEY(school_id,role_id) REFERENCES school_roles(school_id,id) ON DELETE CASCADE
);
ALTER TABLE school_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_roles USING(school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(school_id=nullif(current_setting('app.school_id',true),'')::uuid);
ALTER TABLE school_role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_role_permissions USING(school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(school_id=nullif(current_setting('app.school_id',true),'')::uuid);

ALTER TABLE school_memberships ADD COLUMN school_role_id uuid;
ALTER TABLE school_memberships ADD CONSTRAINT membership_school_role_fk FOREIGN KEY(school_id,school_role_id) REFERENCES school_roles(school_id,id);
ALTER TABLE students ADD COLUMN user_id uuid;
ALTER TABLE students ADD CONSTRAINT students_user_membership_fk FOREIGN KEY(school_id,user_id) REFERENCES school_memberships(school_id,user_id);
ALTER TABLE students ADD CONSTRAINT students_school_user_unique UNIQUE(school_id,user_id);
ALTER TABLE invitations ADD COLUMN school_role_id uuid;
ALTER TABLE invitations ADD COLUMN invited_by_membership_id uuid;
ALTER TABLE invitations ADD COLUMN member_metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE invitations ADD CONSTRAINT invitation_school_role_fk FOREIGN KEY(school_id,school_role_id) REFERENCES school_roles(school_id,id);
ALTER TABLE invitations ADD CONSTRAINT invitation_inviter_membership_fk FOREIGN KEY(school_id,invited_by_membership_id) REFERENCES school_memberships(school_id,id);
ALTER TABLE parents ADD CONSTRAINT parents_school_user_unique UNIQUE(school_id,user_id);

CREATE TABLE support_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES platform_users(id),
  reason text NOT NULL CHECK(length(trim(reason))>=12),
  requested_scopes text[] NOT NULL CHECK(cardinality(requested_scopes)>0),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked','expired')),
  requested_expires_at timestamptz NOT NULL,
  approved_scopes text[] NOT NULL DEFAULT '{}',
  approved_by_membership_id uuid,
  approved_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,approved_by_membership_id) REFERENCES school_memberships(school_id,id),
  CHECK(expires_at IS NULL OR expires_at<=requested_expires_at)
);
CREATE INDEX support_access_school_status_idx ON support_access_requests(school_id,status,created_at DESC);
CREATE INDEX support_access_expiry_idx ON support_access_requests(expires_at) WHERE status='approved';
ALTER TABLE support_access_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON support_access_requests USING(school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(school_id=nullif(current_setting('app.school_id',true),'')::uuid);

CREATE TABLE account_recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_kind text NOT NULL CHECK(user_kind IN ('platform','school')),
  user_id uuid NOT NULL,
  school_id uuid REFERENCES schools(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((user_kind='school' AND school_id IS NOT NULL) OR (user_kind='platform' AND school_id IS NULL))
);
CREATE INDEX account_recovery_lookup_idx ON account_recovery_tokens(token_hash,expires_at) WHERE used_at IS NULL;
ALTER TABLE account_recovery_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_recovery_scope ON account_recovery_tokens USING(user_kind='school' AND school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(user_kind='school' AND school_id=nullif(current_setting('app.school_id',true),'')::uuid);

CREATE TABLE platform_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  role_id uuid NOT NULL REFERENCES platform_roles(id),
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  invited_by uuid NOT NULL REFERENCES platform_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_invitations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION educonnect_seed_school_roles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; role_id uuid; permission text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('school_administrator','School Administrator','school_admin',ARRAY['school:roles:manage','school:members:manage','school:admins:manage','school:settings:read','school:settings:update','academics:read','academics:manage','students:read','students:admit','students:manage','students:archive','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),
    ('principal','Principal','school_admin',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),
    ('vice_principal','Vice Principal','school_admin',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),
    ('academic_coordinator','Academic Coordinator','school_admin',ARRAY['academics:read','academics:manage','students:read','teachers:read','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','reports:read']::text[]),
    ('accountant','Accountant','school_admin',ARRAY['students:read','parents:read','fees:read','fees:manage','reports:read']::text[]),
    ('receptionist','Receptionist','school_admin',ARRAY['students:read','students:admit','parents:manage','teachers:read']::text[]),
    ('teacher','Teacher','teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','announcements:read']::text[]),
    ('class_teacher','Class Teacher','teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','announcements:read','reports:class']::text[]),
    ('parent','Parent','parent',ARRAY['students:read:linked','attendance:read:linked','homework:read:linked','results:read:linked','fees:read:linked','announcements:read']::text[]),
    ('student','Student','student',ARRAY['students:read:self','attendance:read:self','homework:read:self','results:read:self','announcements:read']::text[])
  ) AS defaults(code,name,member_kind,permissions) LOOP
    INSERT INTO school_roles(school_id,name,code,member_kind) VALUES(NEW.id,r.name,r.code,r.member_kind::member_role) RETURNING id INTO role_id;
    FOREACH permission IN ARRAY r.permissions LOOP
      INSERT INTO school_role_permissions(school_id,role_id,permission_key) VALUES(NEW.id,role_id,permission);
    END LOOP;
  END LOOP;
  INSERT INTO school_role_permissions(school_id,role_id,permission_key) SELECT NEW.id,id,'dashboard:read' FROM school_roles WHERE school_id=NEW.id ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER schools_seed_roles AFTER INSERT ON schools FOR EACH ROW EXECUTE FUNCTION educonnect_seed_school_roles();

INSERT INTO school_roles(school_id,name,code,member_kind)
SELECT s.id,v.name,v.code,v.member_kind::member_role FROM schools s CROSS JOIN (VALUES
 ('School Administrator','school_administrator','school_admin'),('Principal','principal','school_admin'),('Vice Principal','vice_principal','school_admin'),('Academic Coordinator','academic_coordinator','school_admin'),('Accountant','accountant','school_admin'),('Receptionist','receptionist','school_admin'),('Teacher','teacher','teacher'),('Class Teacher','class_teacher','teacher'),('Parent','parent','parent'),('Student','student','student')
) AS v(name,code,member_kind) ON CONFLICT(school_id,code) DO NOTHING;
WITH templates(code,permissions) AS (VALUES
 ('school_administrator',ARRAY['school:roles:manage','school:members:manage','school:admins:manage','school:settings:read','school:settings:update','academics:read','academics:manage','students:read','students:admit','students:manage','students:archive','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),
 ('principal',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),
 ('vice_principal',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),
 ('academic_coordinator',ARRAY['academics:read','academics:manage','students:read','teachers:read','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','reports:read']::text[]),
 ('accountant',ARRAY['students:read','parents:read','fees:read','fees:manage','reports:read']::text[]),('receptionist',ARRAY['students:read','students:admit','parents:manage','teachers:read']::text[]),
 ('teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','announcements:read']::text[]),
 ('class_teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','announcements:read','reports:class']::text[]),
 ('parent',ARRAY['students:read:linked','attendance:read:linked','homework:read:linked','results:read:linked','fees:read:linked','announcements:read']::text[]),('student',ARRAY['students:read:self','attendance:read:self','homework:read:self','results:read:self','announcements:read']::text[])
)
INSERT INTO school_role_permissions(school_id,role_id,permission_key)
SELECT r.school_id,r.id,p.permission_key FROM school_roles r JOIN templates t ON t.code=r.code CROSS JOIN LATERAL unnest(t.permissions) p(permission_key) ON CONFLICT DO NOTHING;
INSERT INTO school_role_permissions(school_id,role_id,permission_key) SELECT school_id,id,'dashboard:read' FROM school_roles ON CONFLICT DO NOTHING;
UPDATE school_memberships m SET school_role_id=r.id FROM school_roles r WHERE r.school_id=m.school_id AND r.code=CASE m.role WHEN 'school_admin' THEN 'school_administrator' ELSE m.role::text END AND m.school_role_id IS NULL;
UPDATE invitations i SET school_role_id=r.id FROM school_roles r WHERE r.school_id=i.school_id AND r.code=CASE i.role WHEN 'school_admin' THEN 'school_administrator' ELSE i.role::text END AND i.school_role_id IS NULL;

INSERT INTO platform_roles(name,description) VALUES('support_agent','CalmStacks technical support agent') ON CONFLICT(name) DO NOTHING;
INSERT INTO platform_permissions(name,description) VALUES('support:request','Request time-limited school support access') ON CONFLICT(name) DO NOTHING;
INSERT INTO platform_role_permissions(role_id,permission_id) SELECT r.id,p.id FROM platform_roles r CROSS JOIN platform_permissions p WHERE r.name='support_agent' AND p.name='support:request' ON CONFLICT DO NOTHING;

-- ===== 003_attendance_operations.sql =====
ALTER TABLE attendance
  ADD COLUMN academic_year_id uuid,
  ADD COLUMN section_id uuid;

ALTER TABLE attendance
  ADD CONSTRAINT attendance_year_tenant_fk
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id);

ALTER TABLE classes ADD CONSTRAINT classes_tenant_id_year_unique UNIQUE (school_id, id, academic_year_id);
ALTER TABLE sections ADD CONSTRAINT sections_tenant_id_class_unique UNIQUE (school_id, id, class_id);
ALTER TABLE attendance
  ADD CONSTRAINT attendance_class_year_tenant_fk
    FOREIGN KEY (school_id, class_id, academic_year_id) REFERENCES classes(school_id, id, academic_year_id),
  ADD CONSTRAINT attendance_section_class_tenant_fk
    FOREIGN KEY (school_id, section_id, class_id) REFERENCES sections(school_id, id, class_id);

CREATE INDEX attendance_class_date_idx ON attendance(school_id, class_id, attendance_date, student_id);
CREATE INDEX attendance_student_date_idx ON attendance(school_id, student_id, attendance_date DESC);

CREATE TABLE attendance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  attendance_id uuid NOT NULL,
  actor_membership_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created','updated')),
  before_state jsonb,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, attendance_id) REFERENCES attendance(school_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (school_id, actor_membership_id) REFERENCES school_memberships(school_id, id)
);
CREATE INDEX attendance_history_record_idx ON attendance_history(school_id, attendance_id, created_at DESC);
CREATE INDEX attendance_history_school_created_idx ON attendance_history(school_id, created_at DESC);

ALTER TABLE attendance_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_history
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);

CREATE FUNCTION prevent_attendance_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'attendance history is append-only';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'attendance history is append-only';
  END IF;
  -- Permit a school hard-delete cascade to remove its own tenant data, while
  -- blocking direct application deletes. Normal school archival is soft-delete.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'attendance history is append-only';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER attendance_history_immutable
  BEFORE UPDATE OR DELETE ON attendance_history
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_history_mutation();
CREATE TRIGGER attendance_history_no_truncate
  BEFORE TRUNCATE ON attendance_history
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_attendance_history_mutation();

-- ===== 004_homework_operations.sql =====
-- Extend the original assignment tables into a section-aware, auditable workflow.
ALTER TABLE assignments
  ADD COLUMN section_id uuid,
  ADD COLUMN status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  ADD COLUMN max_score numeric(8,2) CHECK (max_score IS NULL OR max_score >= 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE assignments
  ADD CONSTRAINT assignments_section_tenant_fk
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id),
  ADD CONSTRAINT assignments_section_class_fk
    FOREIGN KEY (school_id, section_id, class_id) REFERENCES sections(school_id, id, class_id);

UPDATE assignments
SET status = CASE WHEN published_at IS NULL THEN 'draft' ELSE 'published' END;

CREATE INDEX assignments_school_status_due_idx ON assignments(school_id,status,due_at DESC);
CREATE INDEX assignments_school_class_due_idx ON assignments(school_id,class_id,section_id,due_at DESC);
CREATE INDEX assignments_school_teacher_created_idx ON assignments(school_id,teacher_id,created_at DESC);

ALTER TABLE assignment_submissions
  ADD CONSTRAINT assignment_submissions_school_id_uidx UNIQUE (school_id,id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN reviewed_by uuid,
  ADD COLUMN reviewed_at timestamptz,
  ADD CONSTRAINT assignment_submissions_reviewer_tenant_fk
    FOREIGN KEY (school_id, reviewed_by) REFERENCES school_memberships(school_id,id),
  ADD CONSTRAINT assignment_submissions_score_nonnegative CHECK (score IS NULL OR score >= 0);

CREATE INDEX assignment_submissions_school_student_idx ON assignment_submissions(school_id,student_id,submitted_at DESC);
CREATE INDEX assignment_submissions_school_assignment_idx ON assignment_submissions(school_id,assignment_id,submitted_at DESC);

CREATE TABLE assignment_attachments (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  file_id uuid NOT NULL,
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id,assignment_id,file_id),
  FOREIGN KEY (school_id,assignment_id) REFERENCES assignments(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY (school_id,file_id) REFERENCES uploaded_files(school_id,id)
);
CREATE INDEX assignment_attachments_school_assignment_idx ON assignment_attachments(school_id,assignment_id);
ALTER TABLE assignment_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assignment_attachments
  USING (school_id = nullif(current_setting('app.school_id',true),'')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id',true),'')::uuid);

CREATE TABLE assignment_audit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  submission_id uuid,
  actor_membership_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created','updated','published','archived','submitted','reviewed')),
  before_state jsonb,
  after_state jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id,assignment_id) REFERENCES assignments(school_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (school_id,submission_id) REFERENCES assignment_submissions(school_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (school_id,actor_membership_id) REFERENCES school_memberships(school_id,id)
);
CREATE INDEX assignment_audit_school_assignment_idx ON assignment_audit_history(school_id,assignment_id,created_at DESC);
ALTER TABLE assignment_audit_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assignment_audit_history
  USING (school_id = nullif(current_setting('app.school_id',true),'')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id',true),'')::uuid);

CREATE FUNCTION prevent_assignment_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('TRUNCATE','UPDATE') OR (TG_OP='DELETE' AND pg_trigger_depth()<=1) THEN
    RAISE EXCEPTION 'assignment history is append-only';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER assignment_history_immutable
  BEFORE UPDATE OR DELETE ON assignment_audit_history
  FOR EACH ROW EXECUTE FUNCTION prevent_assignment_history_mutation();
CREATE TRIGGER assignment_history_no_truncate
  BEFORE TRUNCATE ON assignment_audit_history
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_assignment_history_mutation();

-- ===== 005_examinations_operations.sql =====
ALTER TABLE examinations
  ADD COLUMN exam_type text NOT NULL DEFAULT 'unit_test',
  ADD COLUMN published_at timestamptz,
  ADD COLUMN results_published_at timestamptz,
  ADD CONSTRAINT examinations_type_name_check CHECK (length(trim(exam_type)) BETWEEN 2 AND 60),
  ADD CONSTRAINT examinations_status_check CHECK (status IN ('draft','published','archived')),
  ADD CONSTRAINT examinations_school_year_unique UNIQUE (school_id,id,academic_year_id);

ALTER TABLE examination_subjects
  ADD COLUMN academic_year_id uuid,
  ADD COLUMN section_id uuid;
UPDATE examination_subjects es SET academic_year_id=e.academic_year_id FROM examinations e WHERE e.school_id=es.school_id AND e.id=es.examination_id;
ALTER TABLE examination_subjects
  ALTER COLUMN academic_year_id SET NOT NULL,
  ADD CONSTRAINT exam_subject_exam_year_fk FOREIGN KEY(school_id,examination_id,academic_year_id) REFERENCES examinations(school_id,id,academic_year_id),
  ADD CONSTRAINT exam_subject_class_year_fk FOREIGN KEY(school_id,class_id,academic_year_id) REFERENCES classes(school_id,id,academic_year_id),
  ADD CONSTRAINT exam_subject_class_subject_fk FOREIGN KEY(school_id,class_id,subject_id) REFERENCES class_subjects(school_id,class_id,subject_id),
  ADD CONSTRAINT exam_subject_section_class_fk FOREIGN KEY(school_id,section_id,class_id) REFERENCES sections(school_id,id,class_id);
ALTER TABLE examination_subjects DROP CONSTRAINT examination_subjects_school_id_examination_id_class_id_subj_key;
ALTER TABLE examination_subjects ADD CONSTRAINT exam_subject_target_unique UNIQUE NULLS NOT DISTINCT(school_id,examination_id,class_id,section_id,subject_id);
CREATE INDEX exam_subjects_school_class_idx ON examination_subjects(school_id,class_id,section_id,examination_id);

ALTER TABLE examination_results
  ADD CONSTRAINT exam_results_school_id_unique UNIQUE(school_id,id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT exam_result_score_status_check CHECK (marks IS NULL OR marks >= 0);
CREATE INDEX exam_results_school_student_idx ON examination_results(school_id,student_id,examination_subject_id);

CREATE TABLE examination_grading_scales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  examination_id uuid NOT NULL,
  grade text NOT NULL CHECK(length(trim(grade)) BETWEEN 1 AND 20),
  min_percent numeric(6,3) NOT NULL CHECK(min_percent BETWEEN 0 AND 100),
  max_percent numeric(6,3) NOT NULL CHECK(max_percent BETWEEN 0 AND 100),
  ordinal smallint NOT NULL CHECK(ordinal>0),
  UNIQUE(school_id,id),
  UNIQUE(school_id,examination_id,grade),
  UNIQUE(school_id,examination_id,ordinal),
  FOREIGN KEY(school_id,examination_id) REFERENCES examinations(school_id,id) ON DELETE CASCADE,
  CHECK(max_percent>=min_percent)
);
CREATE INDEX exam_grades_lookup_idx ON examination_grading_scales(school_id,examination_id,min_percent DESC);

CREATE TABLE examination_audit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  examination_id uuid NOT NULL,
  result_id uuid,
  actor_membership_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('created','updated','marks_entered','results_published','exam_published','ranking_policy_changed')),
  before_state jsonb,
  after_state jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,examination_id) REFERENCES examinations(school_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(school_id,result_id) REFERENCES examination_results(school_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(school_id,actor_membership_id) REFERENCES school_memberships(school_id,id)
);
CREATE INDEX exam_audit_school_exam_idx ON examination_audit_history(school_id,examination_id,created_at DESC);

ALTER TABLE examination_grading_scales ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON examination_grading_scales USING(school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(school_id=nullif(current_setting('app.school_id',true),'')::uuid);
ALTER TABLE examination_audit_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON examination_audit_history USING(school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(school_id=nullif(current_setting('app.school_id',true),'')::uuid);

CREATE FUNCTION prevent_examination_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('TRUNCATE','UPDATE') OR (TG_OP='DELETE' AND pg_trigger_depth()<=1) THEN
    RAISE EXCEPTION 'examination history is append-only';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER examination_history_immutable BEFORE UPDATE OR DELETE ON examination_audit_history FOR EACH ROW EXECUTE FUNCTION prevent_examination_history_mutation();
CREATE TRIGGER examination_history_no_truncate BEFORE TRUNCATE ON examination_audit_history FOR EACH STATEMENT EXECUTE FUNCTION prevent_examination_history_mutation();

-- ===== 006_timetable_operations.sql =====
CREATE TABLE timetable_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL,
  period_number smallint NOT NULL CHECK (period_number BETWEEN 1 AND 30),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  is_break boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id,id),
  UNIQUE (school_id,id,academic_year_id),
  UNIQUE (school_id,academic_year_id,period_number),
  UNIQUE (school_id,academic_year_id,name),
  FOREIGN KEY (school_id,academic_year_id) REFERENCES academic_years(school_id,id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX timetable_periods_school_year_order_idx ON timetable_periods(school_id,academic_year_id,period_number) WHERE is_active;
ALTER TABLE timetable_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON timetable_periods
  USING (school_id = nullif(current_setting('app.school_id',true),'')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id',true),'')::uuid);

ALTER TABLE timetables
  ADD COLUMN class_id uuid,
  ADD COLUMN academic_year_id uuid,
  ADD COLUMN period_id uuid,
  ADD COLUMN status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE timetables t SET class_id=s.class_id FROM sections s WHERE s.school_id=t.school_id AND s.id=t.section_id;
UPDATE timetables t SET academic_year_id=c.academic_year_id FROM classes c WHERE c.school_id=t.school_id AND c.id=t.class_id;
ALTER TABLE timetables
  ALTER COLUMN class_id SET NOT NULL,
  ALTER COLUMN academic_year_id SET NOT NULL,
  ADD CONSTRAINT timetable_class_year_fk FOREIGN KEY(school_id,class_id,academic_year_id) REFERENCES classes(school_id,id,academic_year_id),
  ADD CONSTRAINT timetable_section_class_fk FOREIGN KEY(school_id,section_id,class_id) REFERENCES sections(school_id,id,class_id),
  ADD CONSTRAINT timetable_period_year_fk FOREIGN KEY(school_id,period_id,academic_year_id) REFERENCES timetable_periods(school_id,id,academic_year_id);

CREATE INDEX timetable_school_class_weekday_time_idx ON timetables(school_id,academic_year_id,class_id,section_id,day_of_week,starts_at);
CREATE INDEX timetable_school_teacher_weekday_time_idx ON timetables(school_id,academic_year_id,teacher_id,day_of_week,starts_at);
CREATE INDEX timetable_school_room_weekday_time_idx ON timetables(school_id,academic_year_id,day_of_week,lower(room),starts_at) WHERE room IS NOT NULL;

CREATE TABLE timetable_audit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  timetable_id uuid,
  actor_membership_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('period_created','period_updated','entry_created','entry_updated','entry_published','entry_unpublished','entry_archived','schedule_published')),
  before_state jsonb,
  after_state jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,timetable_id) REFERENCES timetables(school_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(school_id,actor_membership_id) REFERENCES school_memberships(school_id,id)
);
CREATE INDEX timetable_audit_school_entry_idx ON timetable_audit_history(school_id,timetable_id,created_at DESC);
ALTER TABLE timetable_audit_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON timetable_audit_history
  USING (school_id = nullif(current_setting('app.school_id',true),'')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id',true),'')::uuid);

CREATE FUNCTION prevent_timetable_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('TRUNCATE','UPDATE') OR (TG_OP='DELETE' AND pg_trigger_depth()<=1) THEN
    RAISE EXCEPTION 'timetable history is append-only';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER timetable_history_immutable BEFORE UPDATE OR DELETE ON timetable_audit_history FOR EACH ROW EXECUTE FUNCTION prevent_timetable_history_mutation();
CREATE TRIGGER timetable_history_no_truncate BEFORE TRUNCATE ON timetable_audit_history FOR EACH STATEMENT EXECUTE FUNCTION prevent_timetable_history_mutation();

INSERT INTO school_role_permissions(school_id,role_id,permission_key)
SELECT r.school_id,r.id,v.permission_key
FROM school_roles r
CROSS JOIN (VALUES
  ('parent','timetable:read:linked'),
  ('student','timetable:read:self'),
  ('teacher','timetable:read:assigned'),
  ('class_teacher','timetable:read:assigned')
) AS v(role_code,permission_key)
WHERE r.code=v.role_code
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION educonnect_seed_school_roles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; role_id uuid; permission text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('school_administrator','School Administrator','school_admin',ARRAY['school:roles:manage','school:members:manage','school:admins:manage','school:settings:read','school:settings:update','academics:read','academics:manage','students:read','students:admit','students:manage','students:archive','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),
    ('principal','Principal','school_admin',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),
    ('vice_principal','Vice Principal','school_admin',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),
    ('academic_coordinator','Academic Coordinator','school_admin',ARRAY['academics:read','academics:manage','students:read','teachers:read','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','reports:read']::text[]),
    ('accountant','Accountant','school_admin',ARRAY['students:read','parents:read','fees:read','fees:manage','reports:read']::text[]),
    ('receptionist','Receptionist','school_admin',ARRAY['students:read','students:admit','parents:manage','teachers:read']::text[]),
    ('teacher','Teacher','teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','timetable:read:assigned','announcements:read']::text[]),
    ('class_teacher','Class Teacher','teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','timetable:read:assigned','announcements:read','reports:class']::text[]),
    ('parent','Parent','parent',ARRAY['students:read:linked','attendance:read:linked','homework:read:linked','results:read:linked','fees:read:linked','timetable:read:linked','announcements:read']::text[]),
    ('student','Student','student',ARRAY['students:read:self','attendance:read:self','homework:read:self','results:read:self','timetable:read:self','announcements:read']::text[])
  ) AS defaults(code,name,member_kind,permissions) LOOP
    INSERT INTO school_roles(school_id,name,code,member_kind) VALUES(NEW.id,r.name,r.code,r.member_kind::member_role) RETURNING id INTO role_id;
    FOREACH permission IN ARRAY r.permissions LOOP
      INSERT INTO school_role_permissions(school_id,role_id,permission_key) VALUES(NEW.id,role_id,permission);
    END LOOP;
  END LOOP;
  INSERT INTO school_role_permissions(school_id,role_id,permission_key) SELECT NEW.id,id,'dashboard:read' FROM school_roles WHERE school_id=NEW.id ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

-- ===== 007_fees_operations.sql =====
-- Extend school fee configuration and preserve payments as an append-only ledger.
ALTER TABLE fee_categories
  ADD COLUMN category_type text NOT NULL DEFAULT 'custom'
    CHECK (category_type IN ('tuition','transport','examination','custom')),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE fee_structures
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'INR'
    CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN description text NOT NULL DEFAULT ''
    CHECK (length(description) <= 1000),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE student_fees
  ADD COLUMN due_on date,
  ADD COLUMN assigned_by uuid,
  ADD COLUMN assigned_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT student_fees_assigner_tenant_fk
    FOREIGN KEY (school_id, assigned_by) REFERENCES school_memberships(school_id, id),
  ADD CONSTRAINT student_fees_school_student_structure_uidx
    UNIQUE (school_id, student_id, fee_structure_id);

ALTER TABLE payments
  ADD COLUMN idempotency_key text,
  ADD CONSTRAINT payments_school_idempotency_uidx
    UNIQUE (school_id, idempotency_key);

CREATE TABLE fee_receipt_sequences (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);

CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 500),
  idempotency_key text NOT NULL,
  reversed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, id),
  UNIQUE (school_id, idempotency_key),
  FOREIGN KEY (school_id, payment_id) REFERENCES payments(school_id, id),
  FOREIGN KEY (school_id, reversed_by) REFERENCES school_memberships(school_id, id)
);
CREATE INDEX payment_reversals_school_payment_idx ON payment_reversals(school_id, payment_id, created_at);
CREATE INDEX payments_school_paid_at_idx ON payments(school_id, paid_at DESC, student_fee_id);
CREATE INDEX student_fees_school_student_idx ON student_fees(school_id, student_id, is_active);
CREATE INDEX student_fees_school_due_idx ON student_fees(school_id, due_on) WHERE is_active;
CREATE INDEX fee_structures_school_year_idx ON fee_structures(school_id, academic_year_id, category_id);

ALTER TABLE fee_receipt_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fee_receipt_sequences
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
ALTER TABLE payment_reversals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_reversals
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);

CREATE FUNCTION prevent_fee_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('TRUNCATE','UPDATE') OR (TG_OP='DELETE' AND pg_trigger_depth()<=1) THEN
    RAISE EXCEPTION 'fee ledger is append-only';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER payments_immutable
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION prevent_fee_ledger_mutation();
CREATE TRIGGER payments_no_truncate
  BEFORE TRUNCATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_fee_ledger_mutation();
CREATE TRIGGER payment_reversals_immutable
  BEFORE UPDATE OR DELETE ON payment_reversals
  FOR EACH ROW EXECUTE FUNCTION prevent_fee_ledger_mutation();
CREATE TRIGGER payment_reversals_no_truncate
  BEFORE TRUNCATE ON payment_reversals
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_fee_ledger_mutation();
CREATE TRIGGER payment_receipts_immutable
  BEFORE UPDATE OR DELETE ON payment_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_fee_ledger_mutation();
CREATE TRIGGER payment_receipts_no_truncate
  BEFORE TRUNCATE ON payment_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_fee_ledger_mutation();

-- ===== 008_announcements_operations.sql =====
-- Enhance announcements and notifications with status, audience indexing, read tracking, and audit history.
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_school_id_id_key') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_school_id_id_key UNIQUE (school_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_author_membership_fk') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_author_membership_fk
      FOREIGN KEY (school_id, author_membership_id) REFERENCES school_memberships(school_id, id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS announcements_school_status_idx ON announcements(school_id, status, published_at DESC);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_school_id_id_key') THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_school_id_id_key UNIQUE (school_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_fk') THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_user_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications(school_id, user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_user_recent_idx ON notifications(school_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS announcement_audit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  announcement_id uuid,
  actor_membership_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created','updated','published','archived')),
  before_state jsonb,
  after_state jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, announcement_id) REFERENCES announcements(school_id, id) ON DELETE SET NULL,
  FOREIGN KEY (school_id, actor_membership_id) REFERENCES school_memberships(school_id, id)
);

ALTER TABLE announcement_audit_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON announcement_audit_history;
CREATE POLICY tenant_isolation ON announcement_audit_history
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);

-- ===== 009_external_identities.sql =====
CREATE TABLE IF NOT EXISTS external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_kind text NOT NULL DEFAULT 'school' CHECK(user_kind IN ('platform', 'school')),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  provider_subject_id text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_subject_id),
  UNIQUE(user_kind, user_id, provider)
);

CREATE INDEX IF NOT EXISTS external_identities_user_idx ON external_identities(user_kind, user_id);
CREATE INDEX IF NOT EXISTS external_identities_provider_sub_idx ON external_identities(provider, provider_subject_id);
CREATE INDEX IF NOT EXISTS external_identities_email_idx ON external_identities(lower(email));

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE external_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_external_identities_scope ON external_identities
  USING (
    user_kind = 'platform' OR
    EXISTS (
      SELECT 1 FROM school_memberships m
      WHERE m.user_id = external_identities.user_id
        AND m.school_id = nullif(current_setting('app.school_id', true), '')::uuid
        AND m.is_active
    )
  );

-- ===== 010_tenant_security_hardening.sql =====
-- Migration 010: Tenant Security Hardening and Student Privacy
-- 1. Apply FORCE ROW LEVEL SECURITY across all tenant tables
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'schools','school_settings','academic_years','classes','sections','subjects',
    'class_subjects','teachers','teacher_assignments','students','parents',
    'student_parents','student_enrollments','student_documents','school_member_profiles',
    'teacher_leaves','attendance','attendance_history','assignments','assignment_submissions',
    'examinations','examination_subjects','examination_results','report_cards','timetables',
    'fee_categories','fee_structures','student_fees','payments','payment_receipts',
    'announcements','notifications','conversations','conversation_members','messages',
    'leave_requests','uploaded_files','audit_logs','school_roles','school_role_permissions',
    'support_access_requests','account_recovery_tokens','subscriptions','background_jobs',
    'invitations','user_sessions','user_profiles'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- 2. Add students:medical:read permission to school_administrator and principal roles
INSERT INTO school_role_permissions(school_id, role_id, permission_key)
SELECT r.school_id, r.id, 'students:medical:read'
FROM school_roles r
WHERE r.code IN ('school_administrator', 'principal')
ON CONFLICT DO NOTHING;

-- 3. Case-insensitive functional indexes for user email lookups
CREATE INDEX IF NOT EXISTS users_lower_email_idx ON users(lower(email));
CREATE INDEX IF NOT EXISTS platform_users_lower_email_idx ON platform_users(lower(email));

-- 4. Student child consent records (privacy and child protection)
CREATE TABLE IF NOT EXISTS child_consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  parent_id uuid NOT NULL,
  consent_type text NOT NULL,
  is_granted boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id, id),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, parent_id) REFERENCES parents(school_id, id) ON DELETE CASCADE
);

ALTER TABLE child_consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_consent_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON child_consent_records
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);

-- ===== 011_operations_rls_hardening.sql =====
-- Apply FORCE RLS to tenant tables introduced after the initial security sweep.
-- Keep this as a forward migration so databases that already applied 010 can upgrade safely.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'school_memberships',
    'users',
    'attendance_history',
    'assignment_attachments',
    'assignment_audit_history',
    'examination_grading_scales',
    'examination_audit_history',
    'timetable_periods',
    'timetable_audit_history',
    'fee_receipt_sequences',
    'payment_reversals',
    'announcement_audit_history'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

-- ===== 012_runtime_role_rls.sql =====
-- Runtime roles must be ordinary, non-superuser, non-BYPASSRLS logins.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='educonnect_app') THEN
    ALTER ROLE educonnect_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='educonnect_platform') THEN
    ALTER ROLE educonnect_platform NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- Force RLS for all application tables that already use it. This intentionally
-- discovers tables from the catalog so newly added modules are not omitted.
DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

-- The platform API uses a separate, explicitly non-BYPASSRLS login for
-- cross-school administrative operations. Access is still governed by RLS and
-- this policy applies only when the authenticated database role is exactly
-- educonnect_platform. The school API role receives no access from this rule.
DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relrowsecurity
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
       WHERE p.polrelid=format('%I.%I',current_schema(),table_name)::regclass
         AND p.polname='platform_runtime_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY platform_runtime_access ON %I USING (current_user = %L) WITH CHECK (current_user = %L)',
        table_name, 'educonnect_platform', 'educonnect_platform'
      );
    END IF;
  END LOOP;
END $$;

-- Every school_id table must have tenant isolation, even where it also has the
-- platform-only policy above. Existing operation migrations provide the
-- tenant policy; fail this migration if a future table forgot one.
DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='school_id' AND NOT a.attisdropped
     WHERE n.nspname=current_schema() AND c.relkind='r'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
       WHERE p.polrelid=format('%I.%I',current_schema(),table_name)::regclass
         AND p.polname <> 'platform_runtime_access'
    ) THEN
      RAISE EXCEPTION 'Tenant table % is missing its school-scoped RLS policy', table_name;
    END IF;
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid=format('%I.%I',current_schema(),table_name)::regclass) THEN
      RAISE EXCEPTION 'Tenant table % must have ENABLE and FORCE ROW LEVEL SECURITY', table_name;
    END IF;
  END LOOP;
END $$;

-- ===== 013_private_file_storage.sql =====
ALTER TABLE uploaded_files
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'ready';
ALTER TABLE uploaded_files
  ADD CONSTRAINT uploaded_files_upload_status_check
  CHECK (upload_status IN ('pending_upload','ready','failed'));
CREATE INDEX IF NOT EXISTS uploaded_files_pending_idx ON uploaded_files(created_at) WHERE upload_status='pending_upload';
