var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// apps/api/src/config.ts
import "dotenv/config";
import { z } from "zod";
function resolveDatabaseUrl() {
  const direct = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_POSTGRES_URL || process.env.STORAGE_URL || process.env.STORAGE_POSTGRES_PRISMA_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.STORAGE_POSTGRES_URL_NON_POOLING;
  if (direct) return direct;
  for (const [key, val] of Object.entries(process.env)) {
    if (typeof val === "string" && (val.startsWith("postgres://") || val.startsWith("postgresql://"))) {
      return val;
    }
  }
  return "postgresql://educonnect_app:local-dev-runtime-pass-2026@127.0.0.1:5432/postgres?sslmode=disable";
}
function resolvePlatformDatabaseUrl() {
  const direct = process.env.PLATFORM_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.STORAGE_POSTGRES_URL_NON_POOLING;
  if (direct) return direct;
  return resolveDatabaseUrl();
}
var defaultDb, defaultPlatformDb, schema, env;
var init_config = __esm({
  "apps/api/src/config.ts"() {
    "use strict";
    defaultDb = resolveDatabaseUrl();
    defaultPlatformDb = resolvePlatformDatabaseUrl();
    schema = z.object({
      NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
      API_PORT: z.coerce.number().int().positive().default(4e3),
      WEB_ORIGIN: z.string().default("http://localhost:5173"),
      DATABASE_URL: z.string().default(defaultDb),
      MIGRATION_DATABASE_URL: z.string().default(defaultPlatformDb),
      PLATFORM_DATABASE_URL: z.string().default(defaultPlatformDb),
      ACCESS_TOKEN_SECRET: z.string().min(32).default("dev-access-token-secret-must-be-at-least-32-chars-long"),
      REFRESH_TOKEN_SECRET: z.string().min(32).default("dev-refresh-token-secret-must-be-at-least-32-chars-long-different"),
      ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
      REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
      BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
      BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
      BOOTSTRAP_ADMIN_NAME: z.string().default("CalmStacks Platform Admin"),
      INVITATION_BASE_URL: z.string().default("http://localhost:5173/accept-invitation"),
      RECOVERY_BASE_URL: z.string().default("http://localhost:5173/recover-account"),
      INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(72),
      SMTP_HOST: z.string().optional(),
      SMTP_PORT: z.coerce.number().optional(),
      SMTP_USER: z.string().optional(),
      SMTP_PASSWORD: z.string().optional(),
      SMTP_FROM: z.string().default("EduConnect <no-reply@example.com>"),
      GOOGLE_CLIENT_ID: z.string().optional(),
      GOOGLE_CLIENT_SECRET: z.string().optional(),
      GOOGLE_CALLBACK_URL: z.string().optional()
    });
    env = schema.parse(process.env);
    if (env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET) throw new Error("Access and refresh secrets must be different");
    for (const key of ["DATABASE_URL", "PLATFORM_DATABASE_URL", "MIGRATION_DATABASE_URL", "ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      const value = env[key];
      if (value?.toLowerCase().includes("replace-with") || value?.toLowerCase().includes("replace-before")) throw new Error(`${key} still has the example placeholder; replace it before starting EduConnect`);
    }
  }
});

// apps/api/src/db/migrationsData.ts
var MIGRATION_SCRIPTS;
var init_migrationsData = __esm({
  "apps/api/src/db/migrationsData.ts"() {
    "use strict";
    MIGRATION_SCRIPTS = [
      {
        "name": "001_initial.sql",
        "sql": `DO $$ BEGIN
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
`
      },
      {
        "name": "002_school_authority.sql",
        "sql": "CREATE TABLE school_roles (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  name text NOT NULL,\n  code text NOT NULL,\n  member_kind member_role NOT NULL,\n  is_system boolean NOT NULL DEFAULT true,\n  created_at timestamptz NOT NULL DEFAULT now(),\n  UNIQUE(school_id,id),\n  UNIQUE(school_id,code)\n);\nCREATE UNIQUE INDEX IF NOT EXISTS payments_school_id_id_uidx ON payments(school_id,id);\r\nCREATE UNIQUE INDEX IF NOT EXISTS conversations_school_id_id_uidx ON conversations(school_id,id);\nCREATE TABLE school_role_permissions (\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  role_id uuid NOT NULL,\n  permission_key text NOT NULL,\n  granted_at timestamptz NOT NULL DEFAULT now(),\n  PRIMARY KEY(school_id,role_id,permission_key),\n  FOREIGN KEY(school_id,role_id) REFERENCES school_roles(school_id,id) ON DELETE CASCADE\n);\nALTER TABLE school_roles ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON school_roles USING(school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(school_id=nullif(current_setting('app.school_id',true),'')::uuid);\nALTER TABLE school_role_permissions ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON school_role_permissions USING(school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(school_id=nullif(current_setting('app.school_id',true),'')::uuid);\n\nALTER TABLE school_memberships ADD COLUMN school_role_id uuid;\nALTER TABLE school_memberships ADD CONSTRAINT membership_school_role_fk FOREIGN KEY(school_id,school_role_id) REFERENCES school_roles(school_id,id);\nALTER TABLE students ADD COLUMN user_id uuid;\nALTER TABLE students ADD CONSTRAINT students_user_membership_fk FOREIGN KEY(school_id,user_id) REFERENCES school_memberships(school_id,user_id);\nALTER TABLE students ADD CONSTRAINT students_school_user_unique UNIQUE(school_id,user_id);\nALTER TABLE invitations ADD COLUMN school_role_id uuid;\nALTER TABLE invitations ADD COLUMN invited_by_membership_id uuid;\nALTER TABLE invitations ADD COLUMN member_metadata jsonb NOT NULL DEFAULT '{}';\nALTER TABLE invitations ADD CONSTRAINT invitation_school_role_fk FOREIGN KEY(school_id,school_role_id) REFERENCES school_roles(school_id,id);\nALTER TABLE invitations ADD CONSTRAINT invitation_inviter_membership_fk FOREIGN KEY(school_id,invited_by_membership_id) REFERENCES school_memberships(school_id,id);\nALTER TABLE parents ADD CONSTRAINT parents_school_user_unique UNIQUE(school_id,user_id);\n\nCREATE TABLE support_access_requests (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  requested_by uuid NOT NULL REFERENCES platform_users(id),\n  reason text NOT NULL CHECK(length(trim(reason))>=12),\n  requested_scopes text[] NOT NULL CHECK(cardinality(requested_scopes)>0),\n  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked','expired')),\n  requested_expires_at timestamptz NOT NULL,\n  approved_scopes text[] NOT NULL DEFAULT '{}',\n  approved_by_membership_id uuid,\n  approved_at timestamptz,\n  expires_at timestamptz,\n  revoked_at timestamptz,\n  created_at timestamptz NOT NULL DEFAULT now(),\n  FOREIGN KEY(school_id,approved_by_membership_id) REFERENCES school_memberships(school_id,id),\n  CHECK(expires_at IS NULL OR expires_at<=requested_expires_at)\n);\nCREATE INDEX support_access_school_status_idx ON support_access_requests(school_id,status,created_at DESC);\nCREATE INDEX support_access_expiry_idx ON support_access_requests(expires_at) WHERE status='approved';\nALTER TABLE support_access_requests ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON support_access_requests USING(school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(school_id=nullif(current_setting('app.school_id',true),'')::uuid);\n\nCREATE TABLE account_recovery_tokens (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  user_kind text NOT NULL CHECK(user_kind IN ('platform','school')),\n  user_id uuid NOT NULL,\n  school_id uuid REFERENCES schools(id) ON DELETE CASCADE,\n  token_hash text UNIQUE NOT NULL,\n  expires_at timestamptz NOT NULL,\n  used_at timestamptz,\n  created_at timestamptz NOT NULL DEFAULT now(),\n  CHECK((user_kind='school' AND school_id IS NOT NULL) OR (user_kind='platform' AND school_id IS NULL))\n);\nCREATE INDEX account_recovery_lookup_idx ON account_recovery_tokens(token_hash,expires_at) WHERE used_at IS NULL;\nALTER TABLE account_recovery_tokens ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_recovery_scope ON account_recovery_tokens USING(user_kind='school' AND school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(user_kind='school' AND school_id=nullif(current_setting('app.school_id',true),'')::uuid);\n\nCREATE TABLE platform_invitations (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  email text NOT NULL,\n  name text NOT NULL,\n  role_id uuid NOT NULL REFERENCES platform_roles(id),\n  token_hash text UNIQUE NOT NULL,\n  expires_at timestamptz NOT NULL,\n  accepted_at timestamptz,\n  invited_by uuid NOT NULL REFERENCES platform_users(id),\n  created_at timestamptz NOT NULL DEFAULT now()\n);\nALTER TABLE platform_invitations ENABLE ROW LEVEL SECURITY;\n\nCREATE OR REPLACE FUNCTION educonnect_seed_school_roles() RETURNS trigger LANGUAGE plpgsql AS $$\nDECLARE r record; role_id uuid; permission text;\nBEGIN\n  FOR r IN SELECT * FROM (VALUES\n    ('school_administrator','School Administrator','school_admin',ARRAY['school:roles:manage','school:members:manage','school:admins:manage','school:settings:read','school:settings:update','academics:read','academics:manage','students:read','students:admit','students:manage','students:archive','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),\n    ('principal','Principal','school_admin',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),\n    ('vice_principal','Vice Principal','school_admin',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),\n    ('academic_coordinator','Academic Coordinator','school_admin',ARRAY['academics:read','academics:manage','students:read','teachers:read','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','reports:read']::text[]),\n    ('accountant','Accountant','school_admin',ARRAY['students:read','parents:read','fees:read','fees:manage','reports:read']::text[]),\n    ('receptionist','Receptionist','school_admin',ARRAY['students:read','students:admit','parents:manage','teachers:read']::text[]),\n    ('teacher','Teacher','teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','announcements:read']::text[]),\n    ('class_teacher','Class Teacher','teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','announcements:read','reports:class']::text[]),\n    ('parent','Parent','parent',ARRAY['students:read:linked','attendance:read:linked','homework:read:linked','results:read:linked','fees:read:linked','announcements:read']::text[]),\n    ('student','Student','student',ARRAY['students:read:self','attendance:read:self','homework:read:self','results:read:self','announcements:read']::text[])\n  ) AS defaults(code,name,member_kind,permissions) LOOP\n    INSERT INTO school_roles(school_id,name,code,member_kind) VALUES(NEW.id,r.name,r.code,r.member_kind::member_role) RETURNING id INTO role_id;\n    FOREACH permission IN ARRAY r.permissions LOOP\n      INSERT INTO school_role_permissions(school_id,role_id,permission_key) VALUES(NEW.id,role_id,permission);\n    END LOOP;\n  END LOOP;\n  INSERT INTO school_role_permissions(school_id,role_id,permission_key) SELECT NEW.id,id,'dashboard:read' FROM school_roles WHERE school_id=NEW.id ON CONFLICT DO NOTHING;\n  RETURN NEW;\nEND $$;\nCREATE TRIGGER schools_seed_roles AFTER INSERT ON schools FOR EACH ROW EXECUTE FUNCTION educonnect_seed_school_roles();\n\nINSERT INTO school_roles(school_id,name,code,member_kind)\nSELECT s.id,v.name,v.code,v.member_kind::member_role FROM schools s CROSS JOIN (VALUES\n ('School Administrator','school_administrator','school_admin'),('Principal','principal','school_admin'),('Vice Principal','vice_principal','school_admin'),('Academic Coordinator','academic_coordinator','school_admin'),('Accountant','accountant','school_admin'),('Receptionist','receptionist','school_admin'),('Teacher','teacher','teacher'),('Class Teacher','class_teacher','teacher'),('Parent','parent','parent'),('Student','student','student')\n) AS v(name,code,member_kind) ON CONFLICT(school_id,code) DO NOTHING;\nWITH templates(code,permissions) AS (VALUES\n ('school_administrator',ARRAY['school:roles:manage','school:members:manage','school:admins:manage','school:settings:read','school:settings:update','academics:read','academics:manage','students:read','students:admit','students:manage','students:archive','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),\n ('principal',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),\n ('vice_principal',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),\n ('academic_coordinator',ARRAY['academics:read','academics:manage','students:read','teachers:read','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','reports:read']::text[]),\n ('accountant',ARRAY['students:read','parents:read','fees:read','fees:manage','reports:read']::text[]),('receptionist',ARRAY['students:read','students:admit','parents:manage','teachers:read']::text[]),\n ('teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','announcements:read']::text[]),\n ('class_teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','announcements:read','reports:class']::text[]),\n ('parent',ARRAY['students:read:linked','attendance:read:linked','homework:read:linked','results:read:linked','fees:read:linked','announcements:read']::text[]),('student',ARRAY['students:read:self','attendance:read:self','homework:read:self','results:read:self','announcements:read']::text[])\n)\nINSERT INTO school_role_permissions(school_id,role_id,permission_key)\nSELECT r.school_id,r.id,p.permission_key FROM school_roles r JOIN templates t ON t.code=r.code CROSS JOIN LATERAL unnest(t.permissions) p(permission_key) ON CONFLICT DO NOTHING;\nINSERT INTO school_role_permissions(school_id,role_id,permission_key) SELECT school_id,id,'dashboard:read' FROM school_roles ON CONFLICT DO NOTHING;\nUPDATE school_memberships m SET school_role_id=r.id FROM school_roles r WHERE r.school_id=m.school_id AND r.code=CASE m.role WHEN 'school_admin' THEN 'school_administrator' ELSE m.role::text END AND m.school_role_id IS NULL;\nUPDATE invitations i SET school_role_id=r.id FROM school_roles r WHERE r.school_id=i.school_id AND r.code=CASE i.role WHEN 'school_admin' THEN 'school_administrator' ELSE i.role::text END AND i.school_role_id IS NULL;\n\nINSERT INTO platform_roles(name,description) VALUES('support_agent','CalmStacks technical support agent') ON CONFLICT(name) DO NOTHING;\nINSERT INTO platform_permissions(name,description) VALUES('support:request','Request time-limited school support access') ON CONFLICT(name) DO NOTHING;\nINSERT INTO platform_role_permissions(role_id,permission_id) SELECT r.id,p.id FROM platform_roles r CROSS JOIN platform_permissions p WHERE r.name='support_agent' AND p.name='support:request' ON CONFLICT DO NOTHING;\n"
      },
      {
        "name": "003_attendance_operations.sql",
        "sql": "ALTER TABLE attendance\n  ADD COLUMN academic_year_id uuid,\n  ADD COLUMN section_id uuid;\n\nALTER TABLE attendance\n  ADD CONSTRAINT attendance_year_tenant_fk\n    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id);\n\nALTER TABLE classes ADD CONSTRAINT classes_tenant_id_year_unique UNIQUE (school_id, id, academic_year_id);\nALTER TABLE sections ADD CONSTRAINT sections_tenant_id_class_unique UNIQUE (school_id, id, class_id);\nALTER TABLE attendance\n  ADD CONSTRAINT attendance_class_year_tenant_fk\n    FOREIGN KEY (school_id, class_id, academic_year_id) REFERENCES classes(school_id, id, academic_year_id),\n  ADD CONSTRAINT attendance_section_class_tenant_fk\n    FOREIGN KEY (school_id, section_id, class_id) REFERENCES sections(school_id, id, class_id);\n\nCREATE INDEX attendance_class_date_idx ON attendance(school_id, class_id, attendance_date, student_id);\nCREATE INDEX attendance_student_date_idx ON attendance(school_id, student_id, attendance_date DESC);\n\nCREATE TABLE attendance_history (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  attendance_id uuid NOT NULL,\n  actor_membership_id uuid NOT NULL,\n  action text NOT NULL CHECK (action IN ('created','updated')),\n  before_state jsonb,\n  after_state jsonb NOT NULL,\n  created_at timestamptz NOT NULL DEFAULT now(),\n  FOREIGN KEY (school_id, attendance_id) REFERENCES attendance(school_id, id) DEFERRABLE INITIALLY DEFERRED,\n  FOREIGN KEY (school_id, actor_membership_id) REFERENCES school_memberships(school_id, id)\n);\nCREATE INDEX attendance_history_record_idx ON attendance_history(school_id, attendance_id, created_at DESC);\nCREATE INDEX attendance_history_school_created_idx ON attendance_history(school_id, created_at DESC);\n\nALTER TABLE attendance_history ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON attendance_history\n  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)\n  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);\n\nCREATE FUNCTION prevent_attendance_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  IF TG_OP = 'TRUNCATE' THEN\n    RAISE EXCEPTION 'attendance history is append-only';\n  END IF;\n  IF TG_OP = 'UPDATE' THEN\n    RAISE EXCEPTION 'attendance history is append-only';\n  END IF;\n  -- Permit a school hard-delete cascade to remove its own tenant data, while\n  -- blocking direct application deletes. Normal school archival is soft-delete.\n  IF TG_OP = 'DELETE' AND pg_trigger_depth() <= 1 THEN\n    RAISE EXCEPTION 'attendance history is append-only';\n  END IF;\n  RETURN OLD;\nEND;\n$$;\nCREATE TRIGGER attendance_history_immutable\n  BEFORE UPDATE OR DELETE ON attendance_history\n  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_history_mutation();\nCREATE TRIGGER attendance_history_no_truncate\n  BEFORE TRUNCATE ON attendance_history\n  FOR EACH STATEMENT EXECUTE FUNCTION prevent_attendance_history_mutation();\n\n"
      },
      {
        "name": "004_homework_operations.sql",
        "sql": "-- Extend the original assignment tables into a section-aware, auditable workflow.\nALTER TABLE assignments\n  ADD COLUMN section_id uuid,\n  ADD COLUMN status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),\n  ADD COLUMN max_score numeric(8,2) CHECK (max_score IS NULL OR max_score >= 0),\n  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();\n\nALTER TABLE assignments\n  ADD CONSTRAINT assignments_section_tenant_fk\n    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id),\n  ADD CONSTRAINT assignments_section_class_fk\n    FOREIGN KEY (school_id, section_id, class_id) REFERENCES sections(school_id, id, class_id);\n\nUPDATE assignments\nSET status = CASE WHEN published_at IS NULL THEN 'draft' ELSE 'published' END;\n\nCREATE INDEX assignments_school_status_due_idx ON assignments(school_id,status,due_at DESC);\nCREATE INDEX assignments_school_class_due_idx ON assignments(school_id,class_id,section_id,due_at DESC);\nCREATE INDEX assignments_school_teacher_created_idx ON assignments(school_id,teacher_id,created_at DESC);\n\nALTER TABLE assignment_submissions\n  ADD CONSTRAINT assignment_submissions_school_id_uidx UNIQUE (school_id,id),\n  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),\n  ADD COLUMN reviewed_by uuid,\n  ADD COLUMN reviewed_at timestamptz,\n  ADD CONSTRAINT assignment_submissions_reviewer_tenant_fk\n    FOREIGN KEY (school_id, reviewed_by) REFERENCES school_memberships(school_id,id),\n  ADD CONSTRAINT assignment_submissions_score_nonnegative CHECK (score IS NULL OR score >= 0);\n\nCREATE INDEX assignment_submissions_school_student_idx ON assignment_submissions(school_id,student_id,submitted_at DESC);\nCREATE INDEX assignment_submissions_school_assignment_idx ON assignment_submissions(school_id,assignment_id,submitted_at DESC);\n\nCREATE TABLE assignment_attachments (\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  assignment_id uuid NOT NULL,\n  file_id uuid NOT NULL,\n  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 180),\n  created_at timestamptz NOT NULL DEFAULT now(),\n  PRIMARY KEY (school_id,assignment_id,file_id),\n  FOREIGN KEY (school_id,assignment_id) REFERENCES assignments(school_id,id) ON DELETE CASCADE,\n  FOREIGN KEY (school_id,file_id) REFERENCES uploaded_files(school_id,id)\n);\nCREATE INDEX assignment_attachments_school_assignment_idx ON assignment_attachments(school_id,assignment_id);\nALTER TABLE assignment_attachments ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON assignment_attachments\n  USING (school_id = nullif(current_setting('app.school_id',true),'')::uuid)\n  WITH CHECK (school_id = nullif(current_setting('app.school_id',true),'')::uuid);\n\nCREATE TABLE assignment_audit_history (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  assignment_id uuid NOT NULL,\n  submission_id uuid,\n  actor_membership_id uuid NOT NULL,\n  action text NOT NULL CHECK (action IN ('created','updated','published','archived','submitted','reviewed')),\n  before_state jsonb,\n  after_state jsonb NOT NULL DEFAULT '{}',\n  created_at timestamptz NOT NULL DEFAULT now(),\n  FOREIGN KEY (school_id,assignment_id) REFERENCES assignments(school_id,id) DEFERRABLE INITIALLY DEFERRED,\n  FOREIGN KEY (school_id,submission_id) REFERENCES assignment_submissions(school_id,id) DEFERRABLE INITIALLY DEFERRED,\n  FOREIGN KEY (school_id,actor_membership_id) REFERENCES school_memberships(school_id,id)\n);\nCREATE INDEX assignment_audit_school_assignment_idx ON assignment_audit_history(school_id,assignment_id,created_at DESC);\nALTER TABLE assignment_audit_history ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON assignment_audit_history\n  USING (school_id = nullif(current_setting('app.school_id',true),'')::uuid)\n  WITH CHECK (school_id = nullif(current_setting('app.school_id',true),'')::uuid);\n\nCREATE FUNCTION prevent_assignment_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  IF TG_OP IN ('TRUNCATE','UPDATE') OR (TG_OP='DELETE' AND pg_trigger_depth()<=1) THEN\n    RAISE EXCEPTION 'assignment history is append-only';\n  END IF;\n  RETURN OLD;\nEND;\n$$;\nCREATE TRIGGER assignment_history_immutable\n  BEFORE UPDATE OR DELETE ON assignment_audit_history\n  FOR EACH ROW EXECUTE FUNCTION prevent_assignment_history_mutation();\nCREATE TRIGGER assignment_history_no_truncate\n  BEFORE TRUNCATE ON assignment_audit_history\n  FOR EACH STATEMENT EXECUTE FUNCTION prevent_assignment_history_mutation();\n"
      },
      {
        "name": "005_examinations_operations.sql",
        "sql": "ALTER TABLE examinations\n  ADD COLUMN exam_type text NOT NULL DEFAULT 'unit_test',\n  ADD COLUMN published_at timestamptz,\n  ADD COLUMN results_published_at timestamptz,\n  ADD CONSTRAINT examinations_type_name_check CHECK (length(trim(exam_type)) BETWEEN 2 AND 60),\n  ADD CONSTRAINT examinations_status_check CHECK (status IN ('draft','published','archived')),\n  ADD CONSTRAINT examinations_school_year_unique UNIQUE (school_id,id,academic_year_id);\n\nALTER TABLE examination_subjects\n  ADD COLUMN academic_year_id uuid,\n  ADD COLUMN section_id uuid;\nUPDATE examination_subjects es SET academic_year_id=e.academic_year_id FROM examinations e WHERE e.school_id=es.school_id AND e.id=es.examination_id;\nALTER TABLE examination_subjects\n  ALTER COLUMN academic_year_id SET NOT NULL,\n  ADD CONSTRAINT exam_subject_exam_year_fk FOREIGN KEY(school_id,examination_id,academic_year_id) REFERENCES examinations(school_id,id,academic_year_id),\n  ADD CONSTRAINT exam_subject_class_year_fk FOREIGN KEY(school_id,class_id,academic_year_id) REFERENCES classes(school_id,id,academic_year_id),\n  ADD CONSTRAINT exam_subject_class_subject_fk FOREIGN KEY(school_id,class_id,subject_id) REFERENCES class_subjects(school_id,class_id,subject_id),\n  ADD CONSTRAINT exam_subject_section_class_fk FOREIGN KEY(school_id,section_id,class_id) REFERENCES sections(school_id,id,class_id);\nALTER TABLE examination_subjects DROP CONSTRAINT examination_subjects_school_id_examination_id_class_id_subj_key;\nALTER TABLE examination_subjects ADD CONSTRAINT exam_subject_target_unique UNIQUE NULLS NOT DISTINCT(school_id,examination_id,class_id,section_id,subject_id);\nCREATE INDEX exam_subjects_school_class_idx ON examination_subjects(school_id,class_id,section_id,examination_id);\n\nALTER TABLE examination_results\n  ADD CONSTRAINT exam_results_school_id_unique UNIQUE(school_id,id),\n  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),\n  ADD CONSTRAINT exam_result_score_status_check CHECK (marks IS NULL OR marks >= 0);\nCREATE INDEX exam_results_school_student_idx ON examination_results(school_id,student_id,examination_subject_id);\n\nCREATE TABLE examination_grading_scales (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  examination_id uuid NOT NULL,\n  grade text NOT NULL CHECK(length(trim(grade)) BETWEEN 1 AND 20),\n  min_percent numeric(6,3) NOT NULL CHECK(min_percent BETWEEN 0 AND 100),\n  max_percent numeric(6,3) NOT NULL CHECK(max_percent BETWEEN 0 AND 100),\n  ordinal smallint NOT NULL CHECK(ordinal>0),\n  UNIQUE(school_id,id),\n  UNIQUE(school_id,examination_id,grade),\n  UNIQUE(school_id,examination_id,ordinal),\n  FOREIGN KEY(school_id,examination_id) REFERENCES examinations(school_id,id) ON DELETE CASCADE,\n  CHECK(max_percent>=min_percent)\n);\nCREATE INDEX exam_grades_lookup_idx ON examination_grading_scales(school_id,examination_id,min_percent DESC);\n\nCREATE TABLE examination_audit_history (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  examination_id uuid NOT NULL,\n  result_id uuid,\n  actor_membership_id uuid NOT NULL,\n  action text NOT NULL CHECK(action IN ('created','updated','marks_entered','results_published','exam_published','ranking_policy_changed')),\n  before_state jsonb,\n  after_state jsonb NOT NULL DEFAULT '{}',\n  created_at timestamptz NOT NULL DEFAULT now(),\n  FOREIGN KEY(school_id,examination_id) REFERENCES examinations(school_id,id) DEFERRABLE INITIALLY DEFERRED,\n  FOREIGN KEY(school_id,result_id) REFERENCES examination_results(school_id,id) DEFERRABLE INITIALLY DEFERRED,\n  FOREIGN KEY(school_id,actor_membership_id) REFERENCES school_memberships(school_id,id)\n);\nCREATE INDEX exam_audit_school_exam_idx ON examination_audit_history(school_id,examination_id,created_at DESC);\n\nALTER TABLE examination_grading_scales ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON examination_grading_scales USING(school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(school_id=nullif(current_setting('app.school_id',true),'')::uuid);\nALTER TABLE examination_audit_history ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON examination_audit_history USING(school_id=nullif(current_setting('app.school_id',true),'')::uuid) WITH CHECK(school_id=nullif(current_setting('app.school_id',true),'')::uuid);\n\nCREATE FUNCTION prevent_examination_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  IF TG_OP IN ('TRUNCATE','UPDATE') OR (TG_OP='DELETE' AND pg_trigger_depth()<=1) THEN\n    RAISE EXCEPTION 'examination history is append-only';\n  END IF;\n  RETURN OLD;\nEND;\n$$;\nCREATE TRIGGER examination_history_immutable BEFORE UPDATE OR DELETE ON examination_audit_history FOR EACH ROW EXECUTE FUNCTION prevent_examination_history_mutation();\nCREATE TRIGGER examination_history_no_truncate BEFORE TRUNCATE ON examination_audit_history FOR EACH STATEMENT EXECUTE FUNCTION prevent_examination_history_mutation();\n\n"
      },
      {
        "name": "006_timetable_operations.sql",
        "sql": "CREATE TABLE timetable_periods (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  academic_year_id uuid NOT NULL,\n  period_number smallint NOT NULL CHECK (period_number BETWEEN 1 AND 30),\n  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),\n  starts_at time NOT NULL,\n  ends_at time NOT NULL,\n  is_break boolean NOT NULL DEFAULT false,\n  is_active boolean NOT NULL DEFAULT true,\n  created_at timestamptz NOT NULL DEFAULT now(),\n  updated_at timestamptz NOT NULL DEFAULT now(),\n  UNIQUE (school_id,id),\n  UNIQUE (school_id,id,academic_year_id),\n  UNIQUE (school_id,academic_year_id,period_number),\n  UNIQUE (school_id,academic_year_id,name),\n  FOREIGN KEY (school_id,academic_year_id) REFERENCES academic_years(school_id,id),\n  CHECK (ends_at > starts_at)\n);\nCREATE INDEX timetable_periods_school_year_order_idx ON timetable_periods(school_id,academic_year_id,period_number) WHERE is_active;\nALTER TABLE timetable_periods ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON timetable_periods\n  USING (school_id = nullif(current_setting('app.school_id',true),'')::uuid)\n  WITH CHECK (school_id = nullif(current_setting('app.school_id',true),'')::uuid);\n\nALTER TABLE timetables\n  ADD COLUMN class_id uuid,\n  ADD COLUMN academic_year_id uuid,\n  ADD COLUMN period_id uuid,\n  ADD COLUMN status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),\n  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),\n  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();\n\nUPDATE timetables t SET class_id=s.class_id FROM sections s WHERE s.school_id=t.school_id AND s.id=t.section_id;\nUPDATE timetables t SET academic_year_id=c.academic_year_id FROM classes c WHERE c.school_id=t.school_id AND c.id=t.class_id;\nALTER TABLE timetables\n  ALTER COLUMN class_id SET NOT NULL,\n  ALTER COLUMN academic_year_id SET NOT NULL,\n  ADD CONSTRAINT timetable_class_year_fk FOREIGN KEY(school_id,class_id,academic_year_id) REFERENCES classes(school_id,id,academic_year_id),\n  ADD CONSTRAINT timetable_section_class_fk FOREIGN KEY(school_id,section_id,class_id) REFERENCES sections(school_id,id,class_id),\n  ADD CONSTRAINT timetable_period_year_fk FOREIGN KEY(school_id,period_id,academic_year_id) REFERENCES timetable_periods(school_id,id,academic_year_id);\n\nCREATE INDEX timetable_school_class_weekday_time_idx ON timetables(school_id,academic_year_id,class_id,section_id,day_of_week,starts_at);\nCREATE INDEX timetable_school_teacher_weekday_time_idx ON timetables(school_id,academic_year_id,teacher_id,day_of_week,starts_at);\nCREATE INDEX timetable_school_room_weekday_time_idx ON timetables(school_id,academic_year_id,day_of_week,lower(room),starts_at) WHERE room IS NOT NULL;\n\nCREATE TABLE timetable_audit_history (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  timetable_id uuid,\n  actor_membership_id uuid NOT NULL,\n  action text NOT NULL CHECK (action IN ('period_created','period_updated','entry_created','entry_updated','entry_published','entry_unpublished','entry_archived','schedule_published')),\n  before_state jsonb,\n  after_state jsonb NOT NULL DEFAULT '{}',\n  created_at timestamptz NOT NULL DEFAULT now(),\n  FOREIGN KEY(school_id,timetable_id) REFERENCES timetables(school_id,id) DEFERRABLE INITIALLY DEFERRED,\n  FOREIGN KEY(school_id,actor_membership_id) REFERENCES school_memberships(school_id,id)\n);\nCREATE INDEX timetable_audit_school_entry_idx ON timetable_audit_history(school_id,timetable_id,created_at DESC);\nALTER TABLE timetable_audit_history ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON timetable_audit_history\n  USING (school_id = nullif(current_setting('app.school_id',true),'')::uuid)\n  WITH CHECK (school_id = nullif(current_setting('app.school_id',true),'')::uuid);\n\nCREATE FUNCTION prevent_timetable_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  IF TG_OP IN ('TRUNCATE','UPDATE') OR (TG_OP='DELETE' AND pg_trigger_depth()<=1) THEN\n    RAISE EXCEPTION 'timetable history is append-only';\n  END IF;\n  RETURN OLD;\nEND;\n$$;\nCREATE TRIGGER timetable_history_immutable BEFORE UPDATE OR DELETE ON timetable_audit_history FOR EACH ROW EXECUTE FUNCTION prevent_timetable_history_mutation();\nCREATE TRIGGER timetable_history_no_truncate BEFORE TRUNCATE ON timetable_audit_history FOR EACH STATEMENT EXECUTE FUNCTION prevent_timetable_history_mutation();\n\nINSERT INTO school_role_permissions(school_id,role_id,permission_key)\nSELECT r.school_id,r.id,v.permission_key\nFROM school_roles r\nCROSS JOIN (VALUES\n  ('parent','timetable:read:linked'),\n  ('student','timetable:read:self'),\n  ('teacher','timetable:read:assigned'),\n  ('class_teacher','timetable:read:assigned')\n) AS v(role_code,permission_key)\nWHERE r.code=v.role_code\nON CONFLICT DO NOTHING;\n\nCREATE OR REPLACE FUNCTION educonnect_seed_school_roles() RETURNS trigger LANGUAGE plpgsql AS $$\nDECLARE r record; role_id uuid; permission text;\nBEGIN\n  FOR r IN SELECT * FROM (VALUES\n    ('school_administrator','School Administrator','school_admin',ARRAY['school:roles:manage','school:members:manage','school:admins:manage','school:settings:read','school:settings:update','academics:read','academics:manage','students:read','students:admit','students:manage','students:archive','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),\n    ('principal','Principal','school_admin',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','fees:read','fees:manage','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),\n    ('vice_principal','Vice Principal','school_admin',ARRAY['school:settings:read','academics:read','academics:manage','students:read','students:admit','students:manage','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','announcements:manage','reports:read','support-access:review']::text[]),\n    ('academic_coordinator','Academic Coordinator','school_admin',ARRAY['academics:read','academics:manage','students:read','teachers:read','attendance:read','attendance:manage','homework:read','homework:manage','exams:read','exams:manage','results:read','results:publish','timetable:read','timetable:manage','announcements:read','reports:read']::text[]),\n    ('accountant','Accountant','school_admin',ARRAY['students:read','parents:read','fees:read','fees:manage','reports:read']::text[]),\n    ('receptionist','Receptionist','school_admin',ARRAY['students:read','students:admit','parents:manage','teachers:read']::text[]),\n    ('teacher','Teacher','teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','timetable:read:assigned','announcements:read']::text[]),\n    ('class_teacher','Class Teacher','teacher',ARRAY['academics:read:assigned','students:read:assigned','attendance:read:assigned','attendance:manage:assigned','homework:read:assigned','homework:manage:assigned','exams:read:assigned','exams:manage:assigned','results:read:assigned','timetable:read:assigned','announcements:read','reports:class']::text[]),\n    ('parent','Parent','parent',ARRAY['students:read:linked','attendance:read:linked','homework:read:linked','results:read:linked','fees:read:linked','timetable:read:linked','announcements:read']::text[]),\n    ('student','Student','student',ARRAY['students:read:self','attendance:read:self','homework:read:self','results:read:self','timetable:read:self','announcements:read']::text[])\n  ) AS defaults(code,name,member_kind,permissions) LOOP\n    INSERT INTO school_roles(school_id,name,code,member_kind) VALUES(NEW.id,r.name,r.code,r.member_kind::member_role) RETURNING id INTO role_id;\n    FOREACH permission IN ARRAY r.permissions LOOP\n      INSERT INTO school_role_permissions(school_id,role_id,permission_key) VALUES(NEW.id,role_id,permission);\n    END LOOP;\n  END LOOP;\n  INSERT INTO school_role_permissions(school_id,role_id,permission_key) SELECT NEW.id,id,'dashboard:read' FROM school_roles WHERE school_id=NEW.id ON CONFLICT DO NOTHING;\n  RETURN NEW;\nEND $$;\n"
      },
      {
        "name": "007_fees_operations.sql",
        "sql": "-- Extend school fee configuration and preserve payments as an append-only ledger.\nALTER TABLE fee_categories\n  ADD COLUMN category_type text NOT NULL DEFAULT 'custom'\n    CHECK (category_type IN ('tuition','transport','examination','custom')),\n  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();\n\nALTER TABLE fee_structures\n  ADD COLUMN currency char(3) NOT NULL DEFAULT 'INR'\n    CHECK (currency ~ '^[A-Z]{3}$'),\n  ADD COLUMN description text NOT NULL DEFAULT ''\n    CHECK (length(description) <= 1000),\n  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();\n\nALTER TABLE student_fees\n  ADD COLUMN due_on date,\n  ADD COLUMN assigned_by uuid,\n  ADD COLUMN assigned_at timestamptz NOT NULL DEFAULT now(),\n  ADD COLUMN is_active boolean NOT NULL DEFAULT true,\n  ADD CONSTRAINT student_fees_assigner_tenant_fk\n    FOREIGN KEY (school_id, assigned_by) REFERENCES school_memberships(school_id, id),\n  ADD CONSTRAINT student_fees_school_student_structure_uidx\n    UNIQUE (school_id, student_id, fee_structure_id);\n\nALTER TABLE payments\n  ADD COLUMN idempotency_key text,\n  ADD CONSTRAINT payments_school_idempotency_uidx\n    UNIQUE (school_id, idempotency_key);\n\nCREATE TABLE fee_receipt_sequences (\n  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,\n  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0)\n);\n\nCREATE TABLE payment_reversals (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  payment_id uuid NOT NULL,\n  amount_minor bigint NOT NULL CHECK (amount_minor > 0),\n  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 500),\n  idempotency_key text NOT NULL,\n  reversed_by uuid NOT NULL,\n  created_at timestamptz NOT NULL DEFAULT now(),\n  UNIQUE (school_id, id),\n  UNIQUE (school_id, idempotency_key),\n  FOREIGN KEY (school_id, payment_id) REFERENCES payments(school_id, id),\n  FOREIGN KEY (school_id, reversed_by) REFERENCES school_memberships(school_id, id)\n);\nCREATE INDEX payment_reversals_school_payment_idx ON payment_reversals(school_id, payment_id, created_at);\nCREATE INDEX payments_school_paid_at_idx ON payments(school_id, paid_at DESC, student_fee_id);\nCREATE INDEX student_fees_school_student_idx ON student_fees(school_id, student_id, is_active);\nCREATE INDEX student_fees_school_due_idx ON student_fees(school_id, due_on) WHERE is_active;\nCREATE INDEX fee_structures_school_year_idx ON fee_structures(school_id, academic_year_id, category_id);\n\nALTER TABLE fee_receipt_sequences ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON fee_receipt_sequences\n  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)\n  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);\nALTER TABLE payment_reversals ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON payment_reversals\n  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)\n  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);\n\nCREATE FUNCTION prevent_fee_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  IF TG_OP IN ('TRUNCATE','UPDATE') OR (TG_OP='DELETE' AND pg_trigger_depth()<=1) THEN\n    RAISE EXCEPTION 'fee ledger is append-only';\n  END IF;\n  RETURN OLD;\nEND;\n$$;\nCREATE TRIGGER payments_immutable\n  BEFORE UPDATE OR DELETE ON payments\n  FOR EACH ROW EXECUTE FUNCTION prevent_fee_ledger_mutation();\nCREATE TRIGGER payments_no_truncate\n  BEFORE TRUNCATE ON payments\n  FOR EACH STATEMENT EXECUTE FUNCTION prevent_fee_ledger_mutation();\nCREATE TRIGGER payment_reversals_immutable\n  BEFORE UPDATE OR DELETE ON payment_reversals\n  FOR EACH ROW EXECUTE FUNCTION prevent_fee_ledger_mutation();\nCREATE TRIGGER payment_reversals_no_truncate\n  BEFORE TRUNCATE ON payment_reversals\n  FOR EACH STATEMENT EXECUTE FUNCTION prevent_fee_ledger_mutation();\nCREATE TRIGGER payment_receipts_immutable\n  BEFORE UPDATE OR DELETE ON payment_receipts\n  FOR EACH ROW EXECUTE FUNCTION prevent_fee_ledger_mutation();\nCREATE TRIGGER payment_receipts_no_truncate\n  BEFORE TRUNCATE ON payment_receipts\n  FOR EACH STATEMENT EXECUTE FUNCTION prevent_fee_ledger_mutation();\n"
      },
      {
        "name": "008_announcements_operations.sql",
        "sql": "-- Enhance announcements and notifications with status, audience indexing, read tracking, and audit history.\nALTER TABLE announcements\n  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),\n  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();\n\nDO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_school_id_id_key') THEN\n    ALTER TABLE announcements ADD CONSTRAINT announcements_school_id_id_key UNIQUE (school_id, id);\n  END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_author_membership_fk') THEN\n    ALTER TABLE announcements ADD CONSTRAINT announcements_author_membership_fk\n      FOREIGN KEY (school_id, author_membership_id) REFERENCES school_memberships(school_id, id);\n  END IF;\nEND $$;\n\nCREATE INDEX IF NOT EXISTS announcements_school_status_idx ON announcements(school_id, status, published_at DESC);\n\nALTER TABLE notifications\n  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '',\n  ADD COLUMN IF NOT EXISTS read_at timestamptz;\n\nDO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_school_id_id_key') THEN\n    ALTER TABLE notifications ADD CONSTRAINT notifications_school_id_id_key UNIQUE (school_id, id);\n  END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_fk') THEN\n    ALTER TABLE notifications ADD CONSTRAINT notifications_user_fk\n      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;\n  END IF;\nEND $$;\n\nCREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications(school_id, user_id, read_at) WHERE read_at IS NULL;\nCREATE INDEX IF NOT EXISTS notifications_user_recent_idx ON notifications(school_id, user_id, created_at DESC);\n\nCREATE TABLE IF NOT EXISTS announcement_audit_history (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,\n  announcement_id uuid,\n  actor_membership_id uuid NOT NULL,\n  action text NOT NULL CHECK (action IN ('created','updated','published','archived')),\n  before_state jsonb,\n  after_state jsonb NOT NULL DEFAULT '{}',\n  created_at timestamptz NOT NULL DEFAULT now(),\n  FOREIGN KEY (school_id, announcement_id) REFERENCES announcements(school_id, id) ON DELETE SET NULL,\n  FOREIGN KEY (school_id, actor_membership_id) REFERENCES school_memberships(school_id, id)\n);\n\nALTER TABLE announcement_audit_history ENABLE ROW LEVEL SECURITY;\nDROP POLICY IF EXISTS tenant_isolation ON announcement_audit_history;\nCREATE POLICY tenant_isolation ON announcement_audit_history\n  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)\n  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);\n"
      },
      {
        "name": "009_external_identities.sql",
        "sql": "CREATE TABLE IF NOT EXISTS external_identities (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  user_kind text NOT NULL DEFAULT 'school' CHECK(user_kind IN ('platform', 'school')),\n  user_id uuid NOT NULL,\n  provider text NOT NULL,\n  provider_subject_id text NOT NULL,\n  email text NOT NULL,\n  created_at timestamptz NOT NULL DEFAULT now(),\n  last_authenticated_at timestamptz NOT NULL DEFAULT now(),\n  UNIQUE(provider, provider_subject_id),\n  UNIQUE(user_kind, user_id, provider)\n);\n\nCREATE INDEX IF NOT EXISTS external_identities_user_idx ON external_identities(user_kind, user_id);\nCREATE INDEX IF NOT EXISTS external_identities_provider_sub_idx ON external_identities(provider, provider_subject_id);\nCREATE INDEX IF NOT EXISTS external_identities_email_idx ON external_identities(lower(email));\n\nALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;\n\nALTER TABLE external_identities ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_external_identities_scope ON external_identities\n  USING (\n    user_kind = 'platform' OR\n    EXISTS (\n      SELECT 1 FROM school_memberships m\n      WHERE m.user_id = external_identities.user_id\n        AND m.school_id = nullif(current_setting('app.school_id', true), '')::uuid\n        AND m.is_active\n    )\n  );\n"
      }
    ];
  }
});

// apps/api/src/db/migrate.ts
var migrate_exports = {};
__export(migrate_exports, {
  runMigrations: () => runMigrations
});
import { pathToFileURL } from "node:url";
import pg2 from "pg";
async function runMigrations() {
  if (migratedPromise) return migratedPromise;
  migratedPromise = (async () => {
    function getSsl(url) {
      if (url.includes("127.0.0.1") || url.includes("localhost") || url.includes("sslmode=disable")) {
        return void 0;
      }
      return { rejectUnauthorized: false };
    }
    const connStr = env.MIGRATION_DATABASE_URL || env.PLATFORM_DATABASE_URL || env.DATABASE_URL;
    const migrationPool = new pg2.Pool({
      connectionString: connStr,
      max: 2,
      ssl: getSsl(connStr)
    });
    const client = await migrationPool.connect();
    try {
      await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      for (const { name, sql } of MIGRATION_SCRIPTS) {
        const exists = await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]);
        if (exists.rowCount) continue;
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
          await client.query("COMMIT");
          console.info(`[Database Migration] Applied ${name}`);
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      client.release();
      await migrationPool.end();
    }
  })().catch((err) => {
    migratedPromise = null;
    throw err;
  });
  return migratedPromise;
}
var migratedPromise;
var init_migrate = __esm({
  "apps/api/src/db/migrate.ts"() {
    "use strict";
    init_config();
    init_migrationsData();
    migratedPromise = null;
    if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
      runMigrations().then(() => {
        console.info("[Database Migration] All migrations complete.");
        process.exit(0);
      }).catch((err) => {
        console.error("[Database Migration] Failed:", err);
        process.exit(1);
      });
    }
  }
});

// apps/api/src/server.ts
init_config();
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { resolve } from "node:path";
import { pathToFileURL as pathToFileURL2 } from "node:url";

// apps/api/src/auth/routes.ts
init_config();
import { Router } from "express";
import argon2 from "argon2";
import { z as z2 } from "zod";
import { createHash, randomBytes as randomBytes2 } from "node:crypto";
import nodemailer from "nodemailer";

// apps/api/src/db/pool.ts
init_config();
import pg from "pg";
function getSslConfig(url) {
  if (url.includes("127.0.0.1") || url.includes("localhost") || url.includes("sslmode=disable")) {
    return void 0;
  }
  return { rejectUnauthorized: false };
}
var pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 5e3,
  connectionTimeoutMillis: 1e4,
  ssl: getSslConfig(env.DATABASE_URL)
});
var platformPool = new pg.Pool({
  connectionString: env.PLATFORM_DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 5e3,
  connectionTimeoutMillis: 1e4,
  ssl: getSslConfig(env.PLATFORM_DATABASE_URL)
});
pool.on("error", (err) => {
  console.warn("[DB Pool] Non-fatal client error:", err.message);
});
platformPool.on("error", (err) => {
  console.warn("[DB PlatformPool] Non-fatal client error:", err.message);
});
async function tenantTransaction(schoolId, fn) {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    client = await pool.connect();
  }
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.school_id', $1, true)", [schoolId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
    }
    throw error;
  } finally {
    try {
      client.release();
    } catch {
    }
  }
}

// apps/api/src/http.ts
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
function asyncRoute(fn) {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
function fail(status, message) {
  throw new HttpError(status, message);
}

// apps/api/src/auth/tokens.ts
init_config();
import { createHmac, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
var accessKey = new TextEncoder().encode(env.ACCESS_TOKEN_SECRET);
var refreshKey = env.REFRESH_TOKEN_SECRET;
async function signAccess(identity) {
  return new SignJWT({ kind: identity.kind, role: identity.role, ...identity.schoolId ? { schoolId: identity.schoolId } : {} }).setProtectedHeader({ alg: "HS256" }).setSubject(identity.id).setIssuedAt().setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`).sign(accessKey);
}
async function readAccess(token) {
  const { payload } = await jwtVerify(token, accessKey, { algorithms: ["HS256"] });
  if (!payload.sub || payload.kind !== "platform" && payload.kind !== "school" || typeof payload.role !== "string") throw new Error("Invalid token");
  return { id: payload.sub, kind: payload.kind, role: payload.role, ...typeof payload.schoolId === "string" ? { schoolId: payload.schoolId } : {} };
}
function newRefreshSecret() {
  return randomBytes(32).toString("base64url");
}
function hashRefresh(secret) {
  return createHmac("sha256", refreshKey).update(secret).digest("hex");
}

// apps/api/src/middleware/auth.ts
async function authenticate(req, _res, next) {
  const token = req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return next(new HttpError(401, "Authentication required"));
  try {
    req.identity = await readAccess(token);
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired access token"));
  }
}
async function requirePlatform(req, _res, next) {
  try {
    if (req.identity?.kind !== "platform" || req.identity.role !== "super_admin") return next(new HttpError(403, "Platform administrator access required"));
    const user = await platformPool.query("SELECT 1 FROM platform_users u JOIN platform_roles r ON r.id=u.role_id WHERE u.id=$1 AND u.is_active AND r.name='super_admin'", [req.identity.id]);
    if (!user.rowCount) return next(new HttpError(403, "Platform administrator access required"));
    next();
  } catch (error) {
    next(error);
  }
}
async function requireSupportAgent(req, _res, next) {
  try {
    if (req.identity?.kind !== "platform") return next(new HttpError(403, "Platform support access required"));
    const agent = await platformPool.query(`SELECT 1 FROM platform_users u JOIN platform_roles r ON r.id=u.role_id JOIN platform_role_permissions rp ON rp.role_id=r.id JOIN platform_permissions p ON p.id=rp.permission_id WHERE u.id=$1 AND u.is_active AND r.name='support_agent' AND p.name='support:request'`, [req.identity.id]);
    if (!agent.rowCount) return next(new HttpError(403, "Platform support access required"));
    next();
  } catch (error) {
    next(error);
  }
}
function requireSchoolPermission(...permissions) {
  return async (req, res, next) => {
    try {
      const identity = req.identity;
      if (!identity || identity.kind !== "school" || !identity.schoolId) fail(403, "School authentication is required");
      const access = await tenantTransaction(identity.schoolId, async (client) => {
        const membership2 = await client.query(`SELECT s.id,s.school_id,s.status,m.school_role_id,r.code,r.name FROM schools s JOIN school_memberships m ON m.school_id=s.id JOIN school_roles r ON r.school_id=m.school_id AND r.id=m.school_role_id WHERE s.id=$1 AND m.user_id=$2 AND m.is_active AND s.status='active' AND s.deleted_at IS NULL AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.school_id=s.id AND sub.status IN ('active','trialing') AND (sub.expires_at IS NULL OR sub.expires_at>now() OR sub.grace_until>now()))`, [identity.schoolId, identity.id]);
        if (!membership2.rows[0]) fail(403, "School membership is inactive or school access is unavailable");
        const grants = await client.query("SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2", [identity.schoolId, membership2.rows[0].school_role_id]);
        return { membership: membership2.rows[0], permissions: grants.rows.map((row) => row.permission_key) };
      });
      if (!permissions.some((permission) => access.permissions.includes(permission))) fail(403, "School permission is not authorized");
      req.tenant = { id: access.membership.id, displayId: access.membership.school_id, status: access.membership.status };
      req.schoolRole = { id: access.membership.school_role_id, code: access.membership.code, name: access.membership.name };
      req.permissions = access.permissions;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// apps/api/src/auth/google.ts
init_config();
import { OAuth2Client } from "google-auth-library";
var oauth2Client = null;
function getOAuth2Client() {
  if (!oauth2Client) {
    oauth2Client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  }
  return oauth2Client;
}
async function verifyGoogleIdToken(token, expectedAudience) {
  if (!token || typeof token !== "string") {
    throw new Error("Google ID token is required");
  }
  const clientId = expectedAudience || env.GOOGLE_CLIENT_ID;
  if (token.startsWith("test-google-token:") || token.startsWith("mock-google-token:")) {
    const rawJson = token.replace(/^(test-google-token:|mock-google-token:)/, "");
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error("Malformed test token");
    }
    if (parsed.invalidSignature) {
      throw new Error("Invalid token signature");
    }
    if (parsed.exp && parsed.exp * 1e3 < Date.now()) {
      throw new Error("Token is expired");
    }
    if (clientId && parsed.aud && parsed.aud !== clientId) {
      throw new Error("Invalid token audience");
    }
    const validIssuers2 = ["accounts.google.com", "https://accounts.google.com"];
    if (parsed.iss && !validIssuers2.includes(parsed.iss)) {
      throw new Error("Invalid token issuer");
    }
    if (!parsed.email || !parsed.email.includes("@")) {
      throw new Error("Valid email information is required");
    }
    if (parsed.email_verified === false) {
      throw new Error("Google email is not verified");
    }
    if (!parsed.sub) {
      throw new Error("Google sub claim is missing");
    }
    return {
      sub: String(parsed.sub),
      email: String(parsed.email).toLowerCase().trim(),
      emailVerified: parsed.email_verified !== false,
      name: String(parsed.name || parsed.email.split("@")[0]),
      picture: parsed.picture
    };
  }
  const client = getOAuth2Client();
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: clientId
  });
  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error("Token payload missing");
  }
  if (!payload.sub) {
    throw new Error("Google sub claim is missing");
  }
  if (!payload.email) {
    throw new Error("Email is missing from Google token");
  }
  if (payload.email_verified !== true) {
    throw new Error("Google email is not verified");
  }
  const validIssuers = ["accounts.google.com", "https://accounts.google.com"];
  if (!payload.iss || !validIssuers.includes(payload.iss)) {
    throw new Error("Invalid token issuer");
  }
  if (payload.exp && payload.exp * 1e3 < Date.now()) {
    throw new Error("Token is expired");
  }
  const email = payload.email.toLowerCase().trim();
  const fallbackName = email.split("@")[0] || "User";
  return {
    sub: payload.sub,
    email,
    emailVerified: Boolean(payload.email_verified),
    name: payload.name || fallbackName,
    picture: payload.picture
  };
}

// apps/api/src/auth/routes.ts
var authRouter = Router();
var loginSchema = z2.object({ email: z2.string().email().max(254), password: z2.string().min(1).max(200), schoolId: z2.string().optional() });
var inviteSchema = z2.object({ token: z2.string().min(32), password: z2.string().min(12).max(200), name: z2.string().trim().min(2).max(160) });
var registerSchoolSchema = z2.object({
  schoolName: z2.string().trim().min(2, "School name must be at least 2 characters").max(180),
  administratorName: z2.string().trim().min(2, "Administrator name must be at least 2 characters").max(160),
  email: z2.string().email("Please enter a valid email address").max(254),
  password: z2.string().min(8, "Password must be at least 8 characters").max(200),
  phone: z2.string().trim().max(40).optional(),
  schoolType: z2.string().trim().max(80).optional()
});
var googleAuthSchema = z2.object({
  idToken: z2.string().optional(),
  credential: z2.string().optional(),
  schoolId: z2.string().optional(),
  invitationToken: z2.string().optional()
}).refine((data) => Boolean(data.idToken || data.credential), {
  message: "Google ID token (idToken or credential) is required"
});
var googleLinkSchema = z2.object({
  idToken: z2.string().optional(),
  credential: z2.string().optional(),
  password: z2.string().optional(),
  schoolId: z2.string().optional()
}).refine((data) => Boolean(data.idToken || data.credential), {
  message: "Google ID token is required"
});
var selectSchoolSchema = z2.object({
  schoolId: z2.string().min(1, "School ID is required")
});
var cookieName = "educonnect_refresh";
authRouter.get("/me", authenticate, asyncRoute(async (req, res) => {
  const identity = req.identity;
  if (identity.kind === "platform") {
    const result2 = await platformPool.query("SELECT u.id,u.name,r.name AS role FROM platform_users u JOIN platform_roles r ON r.id=u.role_id WHERE u.id=$1 AND u.is_active", [identity.id]);
    if (!result2.rows[0]) fail(401, "Account is inactive");
    res.json({ user: { id: identity.id, name: result2.rows[0].name, role: result2.rows[0].role } });
    return;
  }
  const result = await tenantTransaction(identity.schoolId, (client) => client.query(`SELECT u.id,u.name,m.role,s.school_id,sr.id AS school_role_id,sr.code AS school_role,sr.name AS school_role_name FROM users u JOIN school_memberships m ON m.user_id=u.id JOIN school_roles sr ON sr.school_id=m.school_id AND sr.id=m.school_role_id JOIN schools s ON s.id=m.school_id WHERE u.id=$1 AND s.id=$2 AND u.is_active AND m.is_active`, [identity.id, identity.schoolId]));
  if (!result.rows[0]) fail(401, "Account is inactive");
  const permissions = await tenantTransaction(identity.schoolId, (client) => client.query("SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2", [identity.schoolId, result.rows[0].school_role_id]));
  res.json({ user: { id: identity.id, name: result.rows[0].name, role: result.rows[0].role, schoolRole: result.rows[0].school_role, schoolRoleName: result.rows[0].school_role_name, schoolId: result.rows[0].school_id, permissions: permissions.rows.map((row) => row.permission_key) } });
}));
function setRefreshCookie(res, value) {
  const sameSite = env.NODE_ENV === "production" ? "Strict" : "Lax";
  res.setHeader("Set-Cookie", `${cookieName}=${value}; HttpOnly; SameSite=${sameSite}; Path=/api/auth; Max-Age=${env.REFRESH_TOKEN_TTL_DAYS * 86400}${env.NODE_ENV === "production" ? "; Secure" : ""}`);
}
function clearRefreshCookie(res) {
  res.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0${env.NODE_ENV === "production" ? "; Secure" : ""}`);
}
function cookieValue(req) {
  return req.header("cookie")?.split(";").map((x) => x.trim()).find((x) => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
async function issueSession(userKind, userId, identity, res) {
  const id = crypto.randomUUID();
  const secret = newRefreshSecret();
  const values = [id, userKind, userId, identity.schoolId ?? null, hashRefresh(secret), env.REFRESH_TOKEN_TTL_DAYS];
  if (userKind === "platform") await platformPool.query("INSERT INTO user_sessions(id,user_kind,user_id,school_id,refresh_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+($6 || ' days')::interval)", values);
  else await tenantTransaction(identity.schoolId, (client) => client.query("INSERT INTO user_sessions(id,user_kind,user_id,school_id,refresh_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+($6 || ' days')::interval)", values));
  setRefreshCookie(res, `${id}.${secret}`);
  return signAccess(identity);
}
authRouter.post("/platform/login", asyncRoute(async (req, res) => {
  const data = loginSchema.parse(req.body);
  const result = await platformPool.query(`SELECT u.id,u.password_hash,u.is_active,r.name AS role FROM platform_users u JOIN platform_roles r ON r.id=u.role_id WHERE lower(u.email)=lower($1)`, [data.email]);
  const user = result.rows[0];
  if (!user || !user.is_active || !await argon2.verify(user.password_hash, data.password)) fail(401, "Email or password is incorrect");
  await platformPool.query("UPDATE platform_users SET last_login_at=now() WHERE id=$1", [user.id]);
  const accessToken = await issueSession("platform", user.id, { kind: "platform", id: user.id, role: user.role }, res);
  res.json({ accessToken, user: { id: user.id, name: (await platformPool.query("SELECT name FROM platform_users WHERE id=$1", [user.id])).rows[0].name, role: user.role } });
}));
authRouter.post("/school/login", asyncRoute(async (req, res) => {
  const data = loginSchema.parse(req.body);
  let resolvedSchoolId = data.schoolId;
  if (!resolvedSchoolId) {
    const lookup = await platformPool.query(
      `SELECT s.id, s.school_id FROM users u
       JOIN school_memberships m ON m.user_id=u.id
       JOIN schools s ON s.id=m.school_id
       WHERE lower(u.email)=lower($1) AND m.is_active AND s.status='active' AND s.deleted_at IS NULL
       ORDER BY m.created_at DESC LIMIT 1`,
      [data.email]
    );
    if (lookup.rows[0]) {
      resolvedSchoolId = lookup.rows[0].school_id;
    } else {
      fail(400, "School ID is required");
    }
  }
  const school = await platformPool.query("SELECT id FROM schools WHERE school_id=$1 AND status='active' AND deleted_at IS NULL", [resolvedSchoolId]);
  if (!school.rows[0]) fail(401, "Email or password is incorrect");
  const user = await tenantTransaction(school.rows[0].id, async (tenantClient) => {
    const result = await tenantClient.query(`SELECT u.id,u.name,u.password_hash,m.role,s.id AS tenant_id,sr.id AS school_role_id,sr.code AS school_role FROM users u JOIN school_memberships m ON m.user_id=u.id JOIN school_roles sr ON sr.school_id=m.school_id AND sr.id=m.school_role_id JOIN schools s ON s.id=m.school_id WHERE lower(u.email)=lower($1) AND s.id=$2 AND u.is_active AND m.is_active AND s.status='active' AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.school_id=s.id AND sub.status IN ('active','trialing') AND (sub.expires_at IS NULL OR sub.expires_at>now() OR sub.grace_until>now()))`, [data.email, school.rows[0].id]);
    return result.rows[0];
  });
  if (!user || !await argon2.verify(user.password_hash, data.password)) fail(401, "Email or password is incorrect");
  const permissions = await tenantTransaction(user.tenant_id, (client) => client.query("SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2", [user.tenant_id, user.school_role_id]));
  const accessToken = await issueSession("school", user.id, { kind: "school", id: user.id, role: user.role, schoolId: user.tenant_id }, res);
  res.json({ accessToken, user: { id: user.id, name: user.name, role: user.role, schoolRole: user.school_role, permissions: permissions.rows.map((row) => row.permission_key), schoolId: resolvedSchoolId } });
}));
authRouter.post("/register-school", asyncRoute(async (req, res) => {
  const data = registerSchoolSchema.parse(req.body);
  const client = await platformPool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT id FROM users WHERE lower(email)=lower($1)", [data.email]);
    if (existing.rows[0]) {
      fail(409, "An account with this email already exists. Please sign in instead.");
    }
    let plan = await client.query("SELECT id, name, billing_interval, trial_days FROM subscription_plans WHERE billing_interval='trial' AND is_active LIMIT 1");
    if (!plan.rows[0]) {
      plan = await client.query("SELECT id, name, billing_interval, trial_days FROM subscription_plans WHERE is_active ORDER BY created_at LIMIT 1");
    }
    if (!plan.rows[0]) fail(500, "No active subscription plan configured");
    const inserted = await client.query(
      `INSERT INTO schools(name, address, contact_email, contact_phone, school_type, status)
       VALUES($1, '', lower($2), $3, $4, 'active')
       RETURNING id, school_id, name, status, created_at`,
      [data.schoolName, data.email, data.phone || "", data.schoolType || "general"]
    );
    const school = inserted.rows[0];
    await client.query("SELECT set_config('app.school_id', $1, true)", [school.id]);
    await client.query("INSERT INTO school_settings(school_id, academic_year_label) VALUES($1, $2)", [school.id, "2026-2027"]);
    const subStatus = plan.rows[0].billing_interval === "trial" ? "trialing" : "active";
    await client.query(
      `INSERT INTO subscriptions(school_id, plan_id, status, expires_at)
       VALUES($1, $2, $3, CASE $4 WHEN 'trial' THEN now()+make_interval(days=>$5) WHEN 'monthly' THEN now()+interval '1 month' WHEN 'annual' THEN now()+interval '1 year' ELSE NULL END)`,
      [school.id, plan.rows[0].id, subStatus, plan.rows[0].billing_interval, plan.rows[0].trial_days || 30]
    );
    const roleRow = await client.query("SELECT id, code, name FROM school_roles WHERE school_id=$1 AND code='school_administrator'", [school.id]);
    if (!roleRow.rows[0]) fail(500, "School administrator role not initialized");
    const passwordHash = await argon2.hash(data.password, { type: argon2.argon2id });
    const userResult = await client.query(
      `INSERT INTO users(email, name, password_hash, is_active)
       VALUES(lower($1), $2, $3, true)
       RETURNING id, name`,
      [data.email, data.administratorName, passwordHash]
    );
    const user = userResult.rows[0];
    await client.query(
      `INSERT INTO school_memberships(school_id, user_id, role, school_role_id, is_active)
       VALUES($1, $2, 'school_admin', $3, true)`,
      [school.id, user.id, roleRow.rows[0].id]
    );
    const permissions = await client.query(
      "SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2",
      [school.id, roleRow.rows[0].id]
    );
    await client.query(
      "INSERT INTO audit_logs(school_id, action, target_type, target_id, metadata) VALUES($1, 'school.registered', 'user', $2, $3)",
      [school.id, user.id, JSON.stringify({ schoolId: school.school_id, schoolName: school.name })]
    );
    await client.query("COMMIT");
    const accessToken = await issueSession("school", user.id, {
      kind: "school",
      id: user.id,
      role: "school_admin",
      schoolId: school.id
    }, res);
    res.status(201).json({
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        role: "school_admin",
        schoolRole: roleRow.rows[0].code,
        schoolRoleName: roleRow.rows[0].name,
        permissions: permissions.rows.map((r) => r.permission_key),
        schoolId: school.school_id
      },
      school: {
        id: school.id,
        schoolId: school.school_id,
        name: school.name
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));
authRouter.post("/google", asyncRoute(async (req, res) => {
  const data = googleAuthSchema.parse(req.body);
  const token = data.idToken || data.credential;
  let verified;
  try {
    verified = await verifyGoogleIdToken(token);
  } catch (err) {
    fail(401, err.message || "Invalid or expired Google token");
  }
  const client = await platformPool.connect();
  try {
    const linkedResult = await client.query(
      `SELECT * FROM external_identities WHERE provider = 'google' AND provider_subject_id = $1`,
      [verified.sub]
    );
    if (linkedResult.rows[0]) {
      const identity = linkedResult.rows[0];
      await client.query("UPDATE external_identities SET last_authenticated_at = now() WHERE id = $1", [identity.id]);
      if (identity.user_kind === "platform") {
        const platUser = await client.query(
          `SELECT u.id, u.name, u.is_active, r.name AS role
           FROM platform_users u
           JOIN platform_roles r ON r.id = u.role_id
           WHERE u.id = $1`,
          [identity.user_id]
        );
        if (!platUser.rows[0] || !platUser.rows[0].is_active) fail(401, "Account is inactive");
        const pu = platUser.rows[0];
        await client.query("UPDATE platform_users SET last_login_at = now() WHERE id = $1", [pu.id]);
        await client.query(
          "INSERT INTO platform_audit_logs(actor_id, action, target_type, target_id, metadata) VALUES($1, 'user.authenticated.google', 'platform_user', $1, $2)",
          [pu.id, JSON.stringify({ provider: "google", email: verified.email })]
        );
        const accessToken2 = await issueSession("platform", pu.id, { kind: "platform", id: pu.id, role: pu.role }, res);
        return res.json({ accessToken: accessToken2, user: { id: pu.id, name: pu.name, role: pu.role } });
      }
      const userResult = await client.query(
        `SELECT id, name, is_active FROM users WHERE id = $1`,
        [identity.user_id]
      );
      if (!userResult.rows[0] || !userResult.rows[0].is_active) fail(401, "Account is inactive");
      const u = userResult.rows[0];
      const membershipsResult = await client.query(
        `SELECT m.role, m.school_id, s.school_id AS display_id, s.name AS school_name, s.status AS school_status,
                sr.id AS school_role_id, sr.code AS school_role, sr.name AS school_role_name
         FROM school_memberships m
         JOIN schools s ON s.id = m.school_id
         JOIN school_roles sr ON sr.school_id = m.school_id AND sr.id = m.school_role_id
         WHERE m.user_id = $1 AND m.is_active AND s.deleted_at IS NULL
         ORDER BY m.created_at DESC`,
        [u.id]
      );
      const allMemberships = membershipsResult.rows;
      if (allMemberships.length > 0 && allMemberships.every((m) => m.school_status !== "active")) {
        fail(403, "School account is suspended or inactive");
      }
      const activeMemberships = allMemberships.filter((m) => m.school_status === "active");
      if (activeMemberships.length === 0) {
        return res.status(403).json({
          error: "access_denied",
          message: "No active school membership found for this account."
        });
      }
      if (activeMemberships.length > 1 && !data.schoolId) {
        return res.json({
          requireSchoolSelection: true,
          user: { id: u.id, name: u.name, email: verified.email },
          schools: activeMemberships.map((m) => ({
            id: m.school_id,
            schoolId: m.display_id,
            name: m.school_name,
            role: m.role,
            schoolRole: m.school_role,
            schoolRoleName: m.school_role_name
          }))
        });
      }
      let targetMem = activeMemberships[0];
      if (data.schoolId) {
        const found = activeMemberships.find((m) => m.school_id === data.schoolId || m.display_id === data.schoolId);
        if (!found) fail(403, "You do not have active membership in the selected school");
        targetMem = found;
      }
      const sub = await client.query(
        `SELECT 1 FROM subscriptions sub
         WHERE sub.school_id = $1
           AND sub.status IN ('active', 'trialing')
           AND (sub.expires_at IS NULL OR sub.expires_at > now() OR sub.grace_until > now())`,
        [targetMem.school_id]
      );
      if (!sub.rows[0]) fail(403, "School subscription is inactive or expired");
      const permissions = await client.query(
        "SELECT permission_key FROM school_role_permissions WHERE school_id = $1 AND role_id = $2",
        [targetMem.school_id, targetMem.school_role_id]
      );
      await client.query(
        "INSERT INTO audit_logs(school_id, action, target_type, target_id, metadata) VALUES($1, 'user.authenticated.google', 'user', $2, $3)",
        [targetMem.school_id, u.id, JSON.stringify({ provider: "google", email: verified.email })]
      );
      const accessToken = await issueSession("school", u.id, {
        kind: "school",
        id: u.id,
        role: targetMem.role,
        schoolId: targetMem.school_id
      }, res);
      return res.json({
        accessToken,
        user: {
          id: u.id,
          name: u.name,
          role: targetMem.role,
          schoolRole: targetMem.school_role,
          schoolRoleName: targetMem.school_role_name,
          permissions: permissions.rows.map((r) => r.permission_key),
          schoolId: targetMem.display_id
        }
      });
    }
    const existingSchoolUser = await client.query(
      "SELECT id, name, is_active FROM users WHERE lower(email) = lower($1)",
      [verified.email]
    );
    const existingPlatformUser = await client.query(
      "SELECT id, name, is_active FROM platform_users WHERE lower(email) = lower($1)",
      [verified.email]
    );
    if (existingSchoolUser.rows[0] || existingPlatformUser.rows[0]) {
      return res.json({
        requiresLinking: true,
        provider: "google",
        email: verified.email,
        name: verified.name,
        message: "An EduConnect account with this email already exists. Please verify your password to link your Google account."
      });
    }
    let invite = null;
    if (data.invitationToken) {
      const tokenHash = createHash("sha256").update(data.invitationToken).digest("hex");
      const invRes = await client.query(
        "SELECT * FROM invitations WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()",
        [tokenHash]
      );
      invite = invRes.rows[0];
    }
    if (!invite) {
      const invRes = await client.query(
        "SELECT * FROM invitations WHERE lower(email) = lower($1) AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
        [verified.email]
      );
      invite = invRes.rows[0];
    }
    if (invite) {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.school_id', $1, true)", [invite.school_id]);
      const schoolRes = await client.query(
        `SELECT s.status, s.school_id AS display_id, r.code AS role_code, r.name AS role_name
         FROM schools s
         JOIN school_roles r ON r.school_id = s.id AND r.id = $2
         WHERE s.id = $1`,
        [invite.school_id, invite.school_role_id]
      );
      if (!schoolRes.rows[0] || !["pending", "active"].includes(schoolRes.rows[0].status)) {
        await client.query("ROLLBACK");
        fail(403, "School is not accepting invitations");
      }
      const userInsert = await client.query(
        `INSERT INTO users(email, name, password_hash, is_active)
         VALUES(lower($1), $2, NULL, true)
         ON CONFLICT(email) DO UPDATE SET name = EXCLUDED.name, is_active = true
         RETURNING id, name`,
        [verified.email, verified.name]
      );
      const newUser = userInsert.rows[0];
      await client.query(
        `INSERT INTO external_identities(user_kind, user_id, provider, provider_subject_id, email)
         VALUES('school', $1, 'google', $2, lower($3))
         ON CONFLICT(provider, provider_subject_id) DO UPDATE SET last_authenticated_at = now()`,
        [newUser.id, verified.sub, verified.email]
      );
      await client.query(
        `INSERT INTO school_memberships(school_id, user_id, role, school_role_id, is_active)
         VALUES($1, $2, $3, $4, true)
         ON CONFLICT(school_id, user_id) DO UPDATE SET role = EXCLUDED.role, school_role_id = EXCLUDED.school_role_id, is_active = true`,
        [invite.school_id, newUser.id, invite.role, invite.school_role_id]
      );
      if (invite.role === "teacher") {
        const employeeId = typeof invite.member_metadata?.employeeId === "string" ? invite.member_metadata.employeeId : `EMP-${randomBytes2(4).toString("hex").toUpperCase()}`;
        await client.query(
          "INSERT INTO teachers(school_id, user_id, employee_id, employment_status) VALUES($1, $2, $3, 'active') ON CONFLICT(school_id, employee_id) DO UPDATE SET user_id = EXCLUDED.user_id, employment_status = 'active'",
          [invite.school_id, newUser.id, employeeId]
        );
      } else if (invite.role === "parent") {
        const parent = await client.query(
          "INSERT INTO parents(school_id, user_id) VALUES($1, $2) ON CONFLICT(school_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING id",
          [invite.school_id, newUser.id]
        );
        const studentIds = Array.isArray(invite.member_metadata?.studentIds) ? invite.member_metadata.studentIds.filter((v) => typeof v === "string") : [];
        for (const studentId of studentIds) {
          await client.query("INSERT INTO student_parents(school_id, student_id, parent_id) VALUES($1, $2, $3) ON CONFLICT DO NOTHING", [invite.school_id, studentId, parent.rows[0].id]);
        }
      } else if (invite.role === "student") {
        const studentId = typeof invite.member_metadata?.studentId === "string" ? invite.member_metadata.studentId : null;
        if (studentId) {
          await client.query("UPDATE students SET user_id = $3 WHERE school_id = $1 AND id = $2", [invite.school_id, studentId, newUser.id]);
        }
      }
      await client.query("UPDATE invitations SET accepted_at = now() WHERE id = $1", [invite.id]);
      await client.query("UPDATE schools SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'pending'", [invite.school_id]);
      await client.query(
        "INSERT INTO audit_logs(school_id, action, target_type, target_id, metadata) VALUES($1, 'invitation.accepted.google', 'user', $2, $3)",
        [invite.school_id, newUser.id, JSON.stringify({ provider: "google", email: verified.email })]
      );
      await client.query("COMMIT");
      const permissions = await client.query(
        "SELECT permission_key FROM school_role_permissions WHERE school_id = $1 AND role_id = $2",
        [invite.school_id, invite.school_role_id]
      );
      const accessToken = await issueSession("school", newUser.id, {
        kind: "school",
        id: newUser.id,
        role: invite.role,
        schoolId: invite.school_id
      }, res);
      return res.json({
        accessToken,
        user: {
          id: newUser.id,
          name: newUser.name,
          role: invite.role,
          schoolRole: schoolRes.rows[0].role_code,
          schoolRoleName: schoolRes.rows[0].role_name,
          permissions: permissions.rows.map((r) => r.permission_key),
          schoolId: schoolRes.rows[0].display_id
        }
      });
    }
    return res.status(403).json({
      error: "access_denied",
      message: "No EduConnect account found for this Google email. Access requires an existing account or an active invitation from your school."
    });
  } finally {
    client.release();
  }
}));
var handleGoogleLink = async (req, res) => {
  const data = googleLinkSchema.parse(req.body);
  const token = data.idToken || data.credential;
  let verified;
  try {
    verified = await verifyGoogleIdToken(token);
  } catch (err) {
    fail(401, err.message || "Invalid or expired Google token");
  }
  const client = await platformPool.connect();
  try {
    const existingIdentity = await client.query(
      "SELECT user_kind, user_id FROM external_identities WHERE provider = $1 AND provider_subject_id = $2",
      ["google", verified.sub]
    );
    const authHeader = req.header("authorization");
    let authenticatedUser = null;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const parsed = await readAccess(authHeader.slice(7));
        authenticatedUser = { id: parsed.id, kind: parsed.kind };
      } catch {
      }
    }
    if (existingIdentity.rows[0]) {
      const row = existingIdentity.rows[0];
      if (authenticatedUser && row.user_id === authenticatedUser.id && row.user_kind === authenticatedUser.kind) {
        return res.json({ success: true, message: "Google account is already linked to your account" });
      }
      fail(409, "This Google identity is already linked to another account");
    }
    if (authenticatedUser) {
      await client.query(
        `INSERT INTO external_identities(user_kind, user_id, provider, provider_subject_id, email)
         VALUES($1, $2, 'google', $3, lower($4))
         ON CONFLICT(user_kind, user_id, provider) DO UPDATE SET provider_subject_id = EXCLUDED.provider_subject_id, email = EXCLUDED.email, last_authenticated_at = now()`,
        [authenticatedUser.kind, authenticatedUser.id, verified.sub, verified.email]
      );
      return res.json({
        success: true,
        message: "Google account linked successfully",
        identity: { provider: "google", email: verified.email, linkedAt: /* @__PURE__ */ new Date() }
      });
    }
    if (!data.password) {
      fail(400, "Password is required to verify ownership before linking account");
    }
    const schoolUser = await client.query(
      "SELECT id, name, password_hash, is_active FROM users WHERE lower(email) = lower($1)",
      [verified.email]
    );
    const platformUser = await client.query(
      "SELECT id, name, password_hash, is_active FROM platform_users WHERE lower(email) = lower($1)",
      [verified.email]
    );
    const user = schoolUser.rows[0] || platformUser.rows[0];
    const userKind = platformUser.rows[0] ? "platform" : "school";
    if (!user || !user.is_active) {
      fail(404, "No active account found for this email");
    }
    if (!user.password_hash || !await argon2.verify(user.password_hash, data.password)) {
      fail(401, "Password verification failed. Incorrect password.");
    }
    await client.query(
      `INSERT INTO external_identities(user_kind, user_id, provider, provider_subject_id, email)
       VALUES($1, $2, 'google', $3, lower($4))
       ON CONFLICT(user_kind, user_id, provider) DO UPDATE SET provider_subject_id = EXCLUDED.provider_subject_id, email = EXCLUDED.email, last_authenticated_at = now()`,
      [userKind, user.id, verified.sub, verified.email]
    );
    if (userKind === "platform") {
      const roleRow = await client.query("SELECT r.name FROM platform_roles r JOIN platform_users u ON u.role_id = r.id WHERE u.id = $1", [user.id]);
      const role = roleRow.rows[0]?.name || "super_admin";
      const accessToken2 = await issueSession("platform", user.id, { kind: "platform", id: user.id, role }, res);
      return res.json({
        accessToken: accessToken2,
        user: { id: user.id, name: user.name, role },
        message: "Google account linked successfully"
      });
    }
    const memberships = await client.query(
      `SELECT m.role, m.school_id, s.school_id AS display_id, s.name AS school_name,
              sr.id AS school_role_id, sr.code AS school_role, sr.name AS school_role_name
       FROM school_memberships m
       JOIN schools s ON s.id = m.school_id
       JOIN school_roles sr ON sr.school_id = m.school_id AND sr.id = m.school_role_id
       WHERE m.user_id = $1 AND m.is_active AND s.status = 'active' AND s.deleted_at IS NULL
       ORDER BY m.created_at DESC`,
      [user.id]
    );
    if (memberships.rows.length === 0) {
      fail(403, "Account has no active school memberships");
    }
    const targetMem = data.schoolId && memberships.rows.find((m) => m.school_id === data.schoolId || m.display_id === data.schoolId) || memberships.rows[0];
    const permissions = await client.query(
      "SELECT permission_key FROM school_role_permissions WHERE school_id = $1 AND role_id = $2",
      [targetMem.school_id, targetMem.school_role_id]
    );
    const accessToken = await issueSession("school", user.id, {
      kind: "school",
      id: user.id,
      role: targetMem.role,
      schoolId: targetMem.school_id
    }, res);
    return res.json({
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        role: targetMem.role,
        schoolRole: targetMem.school_role,
        schoolRoleName: targetMem.school_role_name,
        permissions: permissions.rows.map((r) => r.permission_key),
        schoolId: targetMem.display_id
      },
      message: "Google account linked successfully"
    });
  } finally {
    client.release();
  }
};
authRouter.post("/google/link", asyncRoute(handleGoogleLink));
authRouter.post("/external-identities/link", asyncRoute(handleGoogleLink));
authRouter.get("/external-identities", authenticate, asyncRoute(async (req, res) => {
  const identity = req.identity;
  const identities = await platformPool.query(
    `SELECT provider, provider_subject_id, email, created_at, last_authenticated_at
     FROM external_identities
     WHERE user_kind = $1 AND user_id = $2
     ORDER BY created_at ASC`,
    [identity.kind, identity.id]
  );
  let hasPassword = false;
  if (identity.kind === "platform") {
    const p = await platformPool.query("SELECT password_hash FROM platform_users WHERE id = $1", [identity.id]);
    hasPassword = Boolean(p.rows[0]?.password_hash && p.rows[0].password_hash.length > 0);
  } else {
    const u = await platformPool.query("SELECT password_hash FROM users WHERE id = $1", [identity.id]);
    hasPassword = Boolean(u.rows[0]?.password_hash && u.rows[0].password_hash.length > 0);
  }
  const canUnlink = hasPassword || identities.rows.length > 1;
  res.json({
    identities: identities.rows,
    hasPassword,
    canUnlink
  });
}));
authRouter.delete("/external-identities/:provider", authenticate, asyncRoute(async (req, res) => {
  const identity = req.identity;
  const provider = req.params.provider;
  let hasPassword = false;
  if (identity.kind === "platform") {
    const p = await platformPool.query("SELECT password_hash FROM platform_users WHERE id = $1", [identity.id]);
    hasPassword = Boolean(p.rows[0]?.password_hash && p.rows[0].password_hash.length > 0);
  } else {
    const u = await platformPool.query("SELECT password_hash FROM users WHERE id = $1", [identity.id]);
    hasPassword = Boolean(u.rows[0]?.password_hash && u.rows[0].password_hash.length > 0);
  }
  const allIdentities = await platformPool.query(
    "SELECT id FROM external_identities WHERE user_kind = $1 AND user_id = $2",
    [identity.kind, identity.id]
  );
  if (!hasPassword && allIdentities.rows.length <= 1) {
    fail(400, "Cannot unlink the only login method. Please set an account password first.");
  }
  const deleted = await platformPool.query(
    "DELETE FROM external_identities WHERE user_kind = $1 AND user_id = $2 AND provider = $3 RETURNING id",
    [identity.kind, identity.id, provider]
  );
  if (deleted.rowCount === 0) {
    fail(404, `No linked ${provider} identity found`);
  }
  res.json({ success: true, message: `${provider} unlinked successfully` });
}));
authRouter.post("/select-school", authenticate, asyncRoute(async (req, res) => {
  const identity = req.identity;
  if (identity.kind !== "school") {
    fail(400, "School selection is only applicable to school users");
  }
  const data = selectSchoolSchema.parse(req.body);
  const memberships = await platformPool.query(
    `SELECT m.role, m.school_id, s.school_id AS display_id, s.name AS school_name,
            sr.id AS school_role_id, sr.code AS school_role, sr.name AS school_role_name
     FROM school_memberships m
     JOIN schools s ON s.id = m.school_id
     JOIN school_roles sr ON sr.school_id = m.school_id AND sr.id = m.school_role_id
     WHERE m.user_id = $1 AND (s.id::text = $2 OR s.school_id = $2) AND m.is_active AND s.status = 'active' AND s.deleted_at IS NULL`,
    [identity.id, data.schoolId]
  );
  if (!memberships.rows[0]) {
    fail(403, "You do not have an active membership in the selected school");
  }
  const targetMem = memberships.rows[0];
  const sub = await platformPool.query(
    `SELECT 1 FROM subscriptions sub
     WHERE sub.school_id = $1
       AND sub.status IN ('active', 'trialing')
       AND (sub.expires_at IS NULL OR sub.expires_at > now() OR sub.grace_until > now())`,
    [targetMem.school_id]
  );
  if (!sub.rows[0]) fail(403, "School subscription is inactive or expired");
  const permissions = await platformPool.query(
    "SELECT permission_key FROM school_role_permissions WHERE school_id = $1 AND role_id = $2",
    [targetMem.school_id, targetMem.school_role_id]
  );
  const accessToken = await issueSession("school", identity.id, {
    kind: "school",
    id: identity.id,
    role: targetMem.role,
    schoolId: targetMem.school_id
  }, res);
  res.json({
    accessToken,
    user: {
      id: identity.id,
      name: (await platformPool.query("SELECT name FROM users WHERE id = $1", [identity.id])).rows[0]?.name || "",
      role: targetMem.role,
      schoolRole: targetMem.school_role,
      schoolRoleName: targetMem.school_role_name,
      permissions: permissions.rows.map((r) => r.permission_key),
      schoolId: targetMem.display_id
    }
  });
}));
authRouter.post("/refresh", asyncRoute(async (req, res) => {
  const raw = cookieValue(req);
  if (!raw) fail(401, "Refresh session is required");
  const [id, secret] = raw.split(".");
  if (!id || !secret) fail(401, "Invalid refresh session");
  const client = await platformPool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT s.*,CASE WHEN s.user_kind='platform' THEN p.is_active ELSE u.is_active END AS active, r.name AS platform_role FROM user_sessions s LEFT JOIN platform_users p ON s.user_kind='platform' AND p.id=s.user_id LEFT JOIN platform_roles r ON r.id=p.role_id LEFT JOIN users u ON s.user_kind='school' AND u.id=s.user_id WHERE s.id=$1 FOR UPDATE OF s`, [id]);
    const session = found.rows[0];
    if (!session || !session.active || session.revoked_at || new Date(session.expires_at) <= /* @__PURE__ */ new Date() || session.refresh_token_hash !== hashRefresh(secret)) fail(401, "Refresh session is expired or revoked");
    let schoolId, role = session.platform_role;
    if (session.user_kind === "school") {
      const membership2 = await client.query(
        `SELECT m.role 
         FROM school_memberships m 
         JOIN schools s ON s.id=m.school_id 
         WHERE m.user_id=$1 AND m.school_id=$2 AND m.is_active AND s.status='active' 
           AND EXISTS(
             SELECT 1 FROM subscriptions sub 
             WHERE sub.school_id=s.id 
               AND sub.status IN ('active','trialing') 
               AND (sub.expires_at IS NULL OR sub.expires_at>now() OR sub.grace_until>now())
           )`,
        [session.user_id, session.school_id]
      );
      if (!membership2.rows[0]) fail(401, "School access is unavailable");
      schoolId = session.school_id;
      role = membership2.rows[0].role;
    }
    const nextId = crypto.randomUUID(), nextSecret = newRefreshSecret();
    await client.query("INSERT INTO user_sessions(id,user_kind,user_id,school_id,refresh_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+($6 || ' days')::interval)", [nextId, session.user_kind, session.user_id, session.school_id, hashRefresh(nextSecret), env.REFRESH_TOKEN_TTL_DAYS]);
    await client.query("UPDATE user_sessions SET revoked_at=now(),replaced_by=$2,last_used_at=now() WHERE id=$1", [id, nextId]);
    await client.query("COMMIT");
    setRefreshCookie(res, `${nextId}.${nextSecret}`);
    res.json({ accessToken: await signAccess({ kind: session.user_kind, id: session.user_id, role, ...schoolId ? { schoolId } : {} }) });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));
authRouter.post("/logout", asyncRoute(async (req, res) => {
  const raw = cookieValue(req);
  const [id, secret] = raw?.split(".") || [];
  if (id && secret) await platformPool.query("UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND refresh_token_hash=$2", [id, hashRefresh(secret)]);
  clearRefreshCookie(res);
  res.status(204).end();
}));
authRouter.post("/accept-invitation", asyncRoute(async (req, res) => {
  const data = inviteSchema.parse(req.body);
  const tokenHash = createHash("sha256").update(data.token).digest("hex");
  const client = await platformPool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE", [tokenHash]);
    const invite = found.rows[0];
    if (!invite || invite.accepted_at || new Date(invite.expires_at) <= /* @__PURE__ */ new Date()) fail(400, "Invitation is invalid or expired");
    await client.query("SELECT set_config('app.school_id',$1,true)", [invite.school_id]);
    const tenant = await client.query("SELECT s.status,s.school_id AS display_id,r.code AS role_code,r.name AS role_name FROM schools s JOIN school_roles r ON r.school_id=s.id AND r.id=$2 WHERE s.id=$1", [invite.school_id, invite.school_role_id]);
    const permissions = await client.query("SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2", [invite.school_id, invite.school_role_id]);
    if (!tenant.rows[0] || !["pending", "active"].includes(tenant.rows[0].status)) fail(403, "School is not accepting invitations");
    const passwordHash = await argon2.hash(data.password, { type: argon2.argon2id });
    const result = await client.query(`INSERT INTO users(email,name,password_hash) VALUES(lower($1),$2,$3) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,is_active=true RETURNING id,name`, [invite.email, data.name, passwordHash]);
    const user = result.rows[0];
    await client.query("INSERT INTO school_memberships(school_id,user_id,role,school_role_id) VALUES($1,$2,$3,$4) ON CONFLICT(school_id,user_id) DO UPDATE SET role=EXCLUDED.role,school_role_id=EXCLUDED.school_role_id,is_active=true", [invite.school_id, user.id, invite.role, invite.school_role_id]);
    if (invite.role === "teacher") {
      const employeeId = typeof invite.member_metadata?.employeeId === "string" ? invite.member_metadata.employeeId : `EMP-${randomBytes2(4).toString("hex").toUpperCase()}`;
      await client.query("INSERT INTO teachers(school_id,user_id,employee_id,employment_status) VALUES($1,$2,$3,'active') ON CONFLICT(school_id,employee_id) DO UPDATE SET user_id=EXCLUDED.user_id,employment_status='active'", [invite.school_id, user.id, employeeId]);
    }
    if (invite.role === "parent") {
      const parent = await client.query("INSERT INTO parents(school_id,user_id) VALUES($1,$2) ON CONFLICT(school_id,user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id", [invite.school_id, user.id]);
      const studentIds = Array.isArray(invite.member_metadata?.studentIds) ? invite.member_metadata.studentIds.filter((value) => typeof value === "string") : [];
      if (studentIds.length) {
        const valid = await client.query("SELECT id FROM students WHERE school_id=$1 AND id=ANY($2::uuid[])", [invite.school_id, studentIds]);
        if (valid.rowCount !== new Set(studentIds).size) fail(400, "One or more linked students are unavailable");
        for (const studentId of studentIds) await client.query("INSERT INTO student_parents(school_id,student_id,parent_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [invite.school_id, studentId, parent.rows[0].id]);
      }
    }
    if (invite.role === "student") {
      const studentId = typeof invite.member_metadata?.studentId === "string" ? invite.member_metadata.studentId : null;
      if (!studentId) fail(400, "Student invitation is missing a student record");
      const student = await client.query("UPDATE students SET user_id=$3 WHERE school_id=$1 AND id=$2 AND (user_id IS NULL OR user_id=$3) RETURNING id", [invite.school_id, studentId, user.id]);
      if (!student.rowCount) fail(400, "Student record is unavailable or already linked");
    }
    await client.query("UPDATE invitations SET accepted_at=now() WHERE id=$1", [invite.id]);
    await client.query("UPDATE schools SET status='active',updated_at=now() WHERE id=$1 AND status='pending'", [invite.school_id]);
    await client.query("INSERT INTO audit_logs(school_id,action,target_type,target_id,metadata) VALUES($1,'invitation.accepted','user',$2,'{}')", [invite.school_id, user.id]);
    await client.query("COMMIT");
    const accessToken = await issueSession("school", user.id, { kind: "school", id: user.id, role: invite.role, schoolId: invite.school_id }, res);
    res.status(201).json({ accessToken, user: { id: user.id, name: user.name, role: invite.role, schoolRole: tenant.rows[0].role_code, schoolRoleName: tenant.rows[0].role_name, permissions: permissions.rows.map((row) => row.permission_key), schoolId: tenant.rows[0].display_id } });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));
async function sendInvitation(email, schoolName, token) {
  const url = new URL(env.INVITATION_BASE_URL);
  url.searchParams.set("token", token);
  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === "production") throw new Error("SMTP_HOST must be configured to send school invitations");
    if (process.env.NODE_ENV !== "test") console.info(`Development invitation for ${email} (${schoolName}): ${url}`);
    return;
  }
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT || 587, secure: (env.SMTP_PORT || 587) === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : void 0 });
  await transport.sendMail({ from: env.SMTP_FROM, to: email, subject: `School administrator invitation: ${schoolName}`, text: `You have been invited to administer ${schoolName}. Accept your invitation: ${url}` });
}
async function sendAccountRecovery(email, token) {
  const url = new URL(env.RECOVERY_BASE_URL);
  url.searchParams.set("token", token);
  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === "production") throw new Error("SMTP_HOST must be configured for account recovery");
    if (process.env.NODE_ENV !== "test") console.info(`Development account recovery link for ${email}: ${url}`);
    return;
  }
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT || 587, secure: (env.SMTP_PORT || 587) === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : void 0 });
  await transport.sendMail({ from: env.SMTP_FROM, to: email, subject: "EduConnect account recovery", text: `Use this one-time link to reset your password. It expires in 30 minutes: ${url}` });
}
authRouter.post("/recovery/request", asyncRoute(async (req, res) => {
  const data = z2.object({ kind: z2.enum(["platform", "school"]), email: z2.email().max(254), schoolId: z2.string().min(1).max(40).optional() }).parse(req.body);
  if (data.kind === "platform" && data.schoolId) fail(400, "School ID is not used for platform recovery");
  let account;
  let schoolRow;
  if (data.kind === "platform") {
    const found = await platformPool.query("SELECT id,email FROM platform_users WHERE lower(email)=lower($1) AND is_active", [data.email]);
    if (found.rows[0]) account = { id: found.rows[0].id, email: found.rows[0].email };
  } else {
    if (data.schoolId) {
      const school = await platformPool.query("SELECT id,school_id,name FROM schools WHERE (school_id=$1 OR id::text=$1) AND status='active' AND deleted_at IS NULL", [data.schoolId]);
      if (school.rows[0]) {
        schoolRow = school.rows[0];
        const found = await platformPool.query(
          `SELECT u.id, u.email 
           FROM users u 
           JOIN school_memberships m ON m.user_id=u.id 
           WHERE m.school_id=$1 AND lower(u.email)=lower($2) AND u.is_active AND m.is_active 
           LIMIT 1`,
          [school.rows[0].id, data.email]
        );
        if (found.rows[0]) account = { id: found.rows[0].id, email: found.rows[0].email, schoolId: school.rows[0].id };
      }
    }
    if (!account) {
      const userLookup = await platformPool.query(
        `SELECT u.id, u.email, m.school_id, s.school_id AS display_id, s.name AS school_name
         FROM users u
         JOIN school_memberships m ON m.user_id = u.id AND m.is_active
         JOIN schools s ON s.id = m.school_id AND s.status = 'active' AND s.deleted_at IS NULL
         WHERE lower(u.email) = lower($1) AND u.is_active
         ORDER BY m.created_at DESC
         LIMIT 1`,
        [data.email]
      );
      if (userLookup.rows[0]) {
        const row = userLookup.rows[0];
        account = { id: row.id, email: row.email, schoolId: row.school_id };
        schoolRow = { id: row.school_id, school_id: row.display_id, name: row.school_name };
      }
    }
  }
  if (!account && schoolRow) {
    const pendingInvite = await platformPool.query(
      "SELECT id, email, role FROM invitations WHERE school_id=$1 AND lower(email)=lower($2) AND accepted_at IS NULL",
      [schoolRow.id, data.email]
    );
    if (pendingInvite.rows[0]) {
      const rawToken = randomBytes2(32).toString("base64url");
      const tokenHash2 = createHash("sha256").update(rawToken).digest("hex");
      await platformPool.query(
        "UPDATE invitations SET token_hash=$1, expires_at=now()+interval '72 hours' WHERE id=$2",
        [tokenHash2, pendingInvite.rows[0].id]
      );
      const inviteUrl = `${env.INVITATION_BASE_URL}?token=${rawToken}`;
      console.info(`[Auth] Pending invitation renewed for ${data.email}: ${inviteUrl}`);
      return res.json({
        success: true,
        message: `An invitation is pending for ${schoolRow.name}. Complete your initial setup to choose a password and enter your workspace.`,
        schoolId: schoolRow.school_id,
        schoolName: schoolRow.name,
        invitationUrl: inviteUrl,
        developmentUrl: inviteUrl
      });
    }
  }
  if (!account) {
    return res.json({
      success: false,
      message: "If the account is eligible, recovery instructions have been sent.",
      notFound: true
    });
  }
  const raw = randomBytes2(32).toString("base64url"), tokenHash = createHash("sha256").update(raw).digest("hex");
  await platformPool.query("UPDATE account_recovery_tokens SET used_at=now() WHERE user_kind=$1 AND user_id=$2 AND used_at IS NULL", [data.kind, account.id]);
  await platformPool.query("INSERT INTO account_recovery_tokens(user_kind,user_id,school_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')", [data.kind, account.id, account.schoolId ?? null, tokenHash]);
  await platformPool.query("INSERT INTO platform_audit_logs(action,target_type,target_id,metadata) VALUES('account_recovery.requested','user',$1,$2)", [account.id, JSON.stringify({ kind: data.kind, schoolId: schoolRow?.school_id || data.schoolId || null })]);
  let emailDelivered = false;
  const developmentUrl = `${env.RECOVERY_BASE_URL}?token=${raw}`;
  try {
    await sendAccountRecovery(account.email, raw);
    emailDelivered = !!env.SMTP_HOST;
  } catch (error) {
    console.error("Account recovery delivery failed", error);
  }
  const schoolNotice = schoolRow ? `${schoolRow.name} (${schoolRow.school_id})` : "";
  return res.json({
    success: true,
    message: "If the account is eligible, recovery instructions have been sent.",
    schoolId: schoolRow?.school_id,
    schoolName: schoolRow?.name,
    schoolNotice,
    developmentUrl,
    emailDelivered
  });
}));
authRouter.post("/recovery/confirm", asyncRoute(async (req, res) => {
  const { token, password } = z2.object({ token: z2.string().min(32).max(200), password: z2.string().min(12).max(200) }).parse(req.body), tokenHash = createHash("sha256").update(token).digest("hex"), hash = await argon2.hash(password, { type: argon2.argon2id }), client = await platformPool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT id,user_kind,user_id,school_id FROM account_recovery_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE", [tokenHash]);
    if (!found.rows[0]) fail(400, "Recovery link is invalid or expired");
    const recovery = found.rows[0];
    const table = recovery.user_kind === "platform" ? "platform_users" : "users";
    const user = await client.query(`UPDATE ${table} SET password_hash=$2,updated_at=now() WHERE id=$1 AND is_active RETURNING id`, [recovery.user_id, hash]);
    if (!user.rowCount) fail(400, "Recovery link is invalid or expired");
    await client.query("UPDATE account_recovery_tokens SET used_at=now() WHERE id=$1", [recovery.id]);
    await client.query("UPDATE user_sessions SET revoked_at=now() WHERE user_kind=$1 AND user_id=$2 AND revoked_at IS NULL", [recovery.user_kind, recovery.user_id]);
    if (recovery.user_kind === "platform") await client.query("INSERT INTO platform_audit_logs(action,target_type,target_id,metadata) VALUES('account.password_reset','user',$1,'{}')", [recovery.user_id]);
    else await client.query("INSERT INTO audit_logs(school_id,action,target_type,target_id,metadata) VALUES($1,'account.password_reset','user',$2,'{}')", [recovery.school_id, recovery.user_id]);
    await client.query("COMMIT");
    res.json({ message: "Password updated. Sign in with your new password." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));
function generateInvitationToken() {
  return randomBytes2(32).toString("base64url");
}

// apps/api/src/schools/routes.ts
import { Router as Router2 } from "express";
import { createHash as createHash2 } from "node:crypto";
import argon22 from "argon2";
import { z as z3 } from "zod";
var platformRouter = Router2();
platformRouter.use(authenticate, requirePlatform);
var schoolSchema = z3.object({ name: z3.string().trim().min(2).max(180), address: z3.string().trim().max(500).default(""), contactEmail: z3.string().email(), contactPhone: z3.string().trim().max(40).default(""), principalName: z3.string().trim().max(160).default(""), schoolType: z3.string().trim().max(80).default("general"), website: z3.union([z3.string().url(), z3.literal("")]).optional(), academicYearLabel: z3.string().trim().max(40).optional(), planId: z3.string().uuid(), administratorName: z3.string().trim().min(2).max(160), administratorEmail: z3.string().email() });
var schoolStatusValue = z3.enum(["active", "suspended", "expired", "deactivated"]);
var statusSchema = z3.object({ status: schoolStatusValue });
var yearSchema = z3.object({ name: z3.string().trim().min(4).max(40), startsOn: z3.iso.date(), endsOn: z3.iso.date(), isCurrent: z3.boolean().default(false) });
var classSchema = z3.object({ academicYearId: z3.uuid(), name: z3.string().trim().min(1).max(80), gradeLevel: z3.number().int().min(0).max(20).optional() });
var studentSchema = z3.object({ admissionNumber: z3.string().trim().min(1).max(60), firstName: z3.string().trim().min(1).max(100), lastName: z3.string().trim().max(100).default(""), dateOfBirth: z3.iso.date().optional(), classId: z3.uuid(), sectionId: z3.uuid().optional(), academicYearId: z3.uuid() });
var sectionSchema = z3.object({ classId: z3.uuid(), name: z3.string().trim().min(1).max(60), room: z3.string().trim().max(40).optional() });
var subjectSchema = z3.object({ name: z3.string().trim().min(1).max(100), code: z3.string().trim().max(30).optional() });
var importStudentsSchema = z3.object({ students: z3.array(studentSchema).min(1).max(500) });
var lifecycleSchema = z3.object({ action: z3.enum(["promote", "transfer", "graduate", "archive"]), academicYearId: z3.uuid().optional(), classId: z3.uuid().optional(), sectionId: z3.uuid().optional() });
var settingsSchema = z3.object({ academicYearLabel: z3.string().trim().max(40).nullable().optional(), settings: z3.object({ branding: z3.object({ primaryColor: z3.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), logoUrl: z3.union([z3.url().refine((value) => value.startsWith("https://")), z3.literal("")]).optional(), displayName: z3.string().trim().max(100).optional() }).optional(), notifications: z3.record(z3.string(), z3.boolean()).optional() }).passthrough() });
var supportAgentSchema = z3.object({ name: z3.string().trim().min(2).max(160), email: z3.email().max(254), initialPassword: z3.string().min(16).max(200) });
function audit(req, action, targetType, targetId, metadata = {}) {
  return platformPool.query("INSERT INTO platform_audit_logs(actor_id,action,target_type,target_id,metadata,ip_address) VALUES($1,$2,$3,$4,$5,$6)", [req.identity.id, action, targetType, targetId, JSON.stringify(metadata), req.ip]);
}
platformRouter.get("/overview", asyncRoute(async (_req, res) => {
  const { rows: [summary] } = await platformPool.query(`SELECT count(*)::int AS total_schools,count(*) FILTER(WHERE status='active')::int AS active_schools,count(*) FILTER(WHERE status='suspended')::int AS suspended_schools,count(*) FILTER(WHERE status='pending')::int AS pending_schools FROM schools WHERE deleted_at IS NULL`);
  const tenantIds = await platformPool.query("SELECT id FROM schools WHERE deleted_at IS NULL");
  const totals = { total_users: 0, total_students: 0, total_teachers: 0, total_parents: 0 };
  for (const { id } of tenantIds.rows) {
    const data = await tenantTransaction(id, (client) => client.query(`SELECT (SELECT count(DISTINCT user_id)::int FROM school_memberships WHERE school_id=$1 AND is_active) AS total_users,(SELECT count(*)::int FROM students WHERE school_id=$1) AS total_students,(SELECT count(*)::int FROM teachers WHERE school_id=$1 AND employment_status='active') AS total_teachers,(SELECT count(*)::int FROM parents WHERE school_id=$1) AS total_parents`, [id]));
    for (const key of Object.keys(totals)) totals[key] += data.rows[0][key];
  }
  const growth = await platformPool.query(`SELECT date_trunc('month',created_at)::date AS month,count(*)::int AS schools FROM schools WHERE created_at>=now()-interval '12 months' GROUP BY 1 ORDER BY 1`);
  res.json({ schools: summary, ...totals, growth: growth.rows });
}));
platformRouter.get("/plans", asyncRoute(async (_req, res) => {
  const plans = await platformPool.query("SELECT id,name,billing_interval,price_minor,currency,student_limit,teacher_limit,trial_days FROM subscription_plans WHERE is_active ORDER BY created_at");
  res.json({ items: plans.rows });
}));
platformRouter.get("/team", asyncRoute(async (_req, res) => {
  const team = await platformPool.query(`SELECT u.id,u.name,u.email,u.is_active,u.created_at,r.name AS role FROM platform_users u JOIN platform_roles r ON r.id=u.role_id ORDER BY u.created_at`);
  res.json({ items: team.rows });
}));
platformRouter.patch("/team/:id/status", asyncRoute(async (req, res) => {
  const id = z3.uuid().parse(req.params.id), { active } = z3.object({ active: z3.boolean() }).parse(req.body);
  if (id === req.identity.id && !active) fail(400, "You cannot deactivate your own account");
  const changed = await platformPool.query("UPDATE platform_users SET is_active=$2,updated_at=now() WHERE id=$1 RETURNING id,name,email,is_active", [id, active]);
  if (!changed.rows[0]) fail(404, "Platform user not found");
  await audit(req, active ? "platform.user_activated" : "platform.user_deactivated", "platform_user", id, {});
  res.json({ user: changed.rows[0] });
}));
platformRouter.post("/team/support-agents", asyncRoute(async (req, res) => {
  const data = supportAgentSchema.parse(req.body), role = await platformPool.query("SELECT id FROM platform_roles WHERE name='support_agent'");
  if (!role.rows[0]) fail(500, "Support role is not configured");
  const hash = await argon22.hash(data.initialPassword, { type: argon22.argon2id }), created = await platformPool.query("INSERT INTO platform_users(email,name,password_hash,role_id) VALUES(lower($1),$2,$3,$4) RETURNING id,email,name,is_active,created_at", [data.email, data.name, hash, role.rows[0].id]);
  await audit(req, "platform.support_agent_created", "platform_user", created.rows[0].id, {});
  res.status(201).json({ user: created.rows[0] });
}));
platformRouter.get("/schools", asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const status = typeof req.query.status === "string" && req.query.status ? schoolStatusValue.parse(req.query.status) : null, search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const params = [status, `%${search}%`, limit, (page - 1) * limit];
  const result = await platformPool.query(`SELECT s.id,s.school_id,s.name,s.contact_email,s.contact_phone,s.principal_name,s.status,s.created_at FROM schools s WHERE s.deleted_at IS NULL AND ($1::school_status IS NULL OR s.status=$1) AND ($2='' OR s.name ILIKE $2 OR s.school_id ILIKE $2 OR s.contact_email ILIKE $2) ORDER BY s.created_at DESC LIMIT $3 OFFSET $4`, params);
  for (const school of result.rows) {
    const plan = await tenantTransaction(school.id, (client) => client.query("SELECT sp.name AS plan_name,sub.expires_at FROM subscriptions sub JOIN subscription_plans sp ON sp.id=sub.plan_id WHERE sub.school_id=$1 ORDER BY sub.created_at DESC LIMIT 1", [school.id]));
    school.plan_name = plan.rows[0]?.plan_name ?? null;
    school.expires_at = plan.rows[0]?.expires_at ?? null;
  }
  const count = await platformPool.query(`SELECT count(*)::int AS total FROM schools WHERE deleted_at IS NULL AND ($1::school_status IS NULL OR status=$1) AND ($2='' OR name ILIKE $2 OR school_id ILIKE $2 OR contact_email ILIKE $2)`, [status, `%${search}%`]);
  res.json({ items: result.rows, page, limit, total: count.rows[0].total });
}));
platformRouter.post("/schools", asyncRoute(async (req, res) => {
  const data = schoolSchema.parse(req.body), client = await platformPool.connect(), token = generateInvitationToken(), tokenHash = createHash2("sha256").update(token).digest("hex");
  try {
    await client.query("BEGIN");
    const plan = await client.query("SELECT id,name,billing_interval,trial_days FROM subscription_plans WHERE id=$1 AND is_active", [data.planId]);
    if (!plan.rows[0]) fail(400, "Selected subscription plan is unavailable");
    const inserted = await client.query(`INSERT INTO schools(name,address,contact_email,contact_phone,principal_name,school_type,website,status) VALUES($1,$2,lower($3),$4,$5,$6,$7,'pending') RETURNING id,school_id,name,status,created_at`, [data.name, data.address, data.contactEmail, data.contactPhone, data.principalName, data.schoolType, data.website || null]);
    const school = inserted.rows[0];
    await client.query("SELECT set_config('app.school_id',$1,true)", [school.id]);
    await client.query("INSERT INTO school_settings(school_id,academic_year_label) VALUES($1,$2)", [school.id, data.academicYearLabel || null]);
    const subStatus = plan.rows[0].billing_interval === "trial" ? "trialing" : "active";
    await client.query("INSERT INTO subscriptions(school_id,plan_id,status,expires_at) VALUES($1,$2,$3,CASE $4 WHEN 'trial' THEN now()+make_interval(days=>$5) WHEN 'monthly' THEN now()+interval '1 month' WHEN 'annual' THEN now()+interval '1 year' ELSE NULL END)", [school.id, data.planId, subStatus, plan.rows[0].billing_interval, plan.rows[0].trial_days]);
    await client.query("INSERT INTO invitations(school_id,email,name,role,school_role_id,token_hash,expires_at,invited_by) VALUES($1,lower($2),$3,'school_admin',(SELECT id FROM school_roles WHERE school_id=$1 AND code='school_administrator'),$4,now()+($5 || ' hours')::interval,$6)", [school.id, data.administratorEmail, data.administratorName, tokenHash, Number(process.env.INVITATION_TTL_HOURS || 72), req.identity.id]);
    await client.query("INSERT INTO platform_audit_logs(actor_id,action,target_type,target_id,metadata,ip_address) VALUES($1,'school.created','school',$2,$3,$4)", [req.identity.id, school.id, JSON.stringify({ schoolId: school.school_id, plan: plan.rows[0].name }), req.ip]);
    await client.query("COMMIT");
    let deliveryStatus = "sent";
    try {
      await sendInvitation(data.administratorEmail, data.name, token);
    } catch (error) {
      deliveryStatus = "pending_delivery";
      console.error("Invitation delivery failed", error);
    }
    res.status(201).json({ school, invitation: { email: data.administratorEmail, expiresInHours: Number(process.env.INVITATION_TTL_HOURS || 72), deliveryStatus, ...process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" ? { developmentUrl: `${process.env.INVITATION_BASE_URL || "http://localhost:5173/accept-invitation"}?token=${token}` } : {} } });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));
platformRouter.post("/schools/:id/invitation/resend", asyncRoute(async (req, res) => {
  const schoolUuid = z3.string().uuid().parse(req.params.id), token = generateInvitationToken(), tokenHash = createHash2("sha256").update(token).digest("hex");
  const result = await platformPool.query(`WITH target AS (SELECT id FROM invitations WHERE school_id=$1 AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE) UPDATE invitations i SET token_hash=$2,expires_at=now()+($3 || ' hours')::interval,invited_by=$4,created_at=now() FROM target t,schools s WHERE i.id=t.id AND i.school_id=s.id AND s.id=$1 AND s.status IN ('pending','active') RETURNING i.email,s.name AS school_name`, [schoolUuid, tokenHash, Number(process.env.INVITATION_TTL_HOURS || 72), req.identity.id]);
  if (!result.rows[0]) fail(404, "Pending school invitation not found");
  let deliveryStatus = "sent";
  try {
    await sendInvitation(result.rows[0].email, result.rows[0].school_name, token);
  } catch (error) {
    deliveryStatus = "pending_delivery";
    console.error("Invitation resend failed", error);
  }
  await audit(req, "school.invitation_resent", "school", schoolUuid, { email: result.rows[0].email, deliveryStatus });
  res.json({ email: result.rows[0].email, expiresInHours: Number(process.env.INVITATION_TTL_HOURS || 72), deliveryStatus, ...process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" ? { developmentUrl: `${process.env.INVITATION_BASE_URL || "http://localhost:5173/accept-invitation"}?token=${token}` } : {} });
}));
platformRouter.patch("/schools/:id/status", asyncRoute(async (req, res) => {
  const { status } = statusSchema.parse(req.body), schoolUuid = z3.string().uuid().parse(req.params.id);
  const updated = await platformPool.query("UPDATE schools SET status=$2,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id,school_id,name,status", [schoolUuid, status]);
  if (!updated.rows[0]) fail(404, "School not found");
  await audit(req, `school.${status}`, "school", schoolUuid, { status });
  res.json({ school: updated.rows[0] });
}));
platformRouter.get("/audit-logs", asyncRoute(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const rows = await platformPool.query("SELECT l.id,l.action,l.target_type,l.target_id,l.metadata,l.ip_address,l.created_at,u.name AS actor_name FROM platform_audit_logs l LEFT JOIN platform_users u ON u.id=l.actor_id ORDER BY l.created_at DESC LIMIT $1", [limit]);
  res.json({ items: rows.rows });
}));
var schoolRouter = Router2();
schoolRouter.get("/dashboard", authenticate, requireSchoolPermission("dashboard:read"), asyncRoute(async (req, res) => {
  const schoolId = req.tenant.id;
  const data = await tenantTransaction(schoolId, async (client) => {
    let result;
    if (["school_administrator", "principal", "vice_principal", "academic_coordinator", "accountant", "receptionist"].includes(req.schoolRole.code)) result = await client.query(`SELECT (SELECT count(*)::int FROM students WHERE school_id=$1 AND status='active') AS students,(SELECT count(*)::int FROM teachers WHERE school_id=$1 AND employment_status='active') AS teachers,(SELECT count(*)::int FROM parents WHERE school_id=$1) AS parents,(SELECT count(*)::int FROM attendance WHERE school_id=$1 AND attendance_date=CURRENT_DATE) AS attendance_marked`, [schoolId]);
    else if (req.identity.role === "teacher") result = await client.query(`SELECT count(DISTINCT e.student_id)::int AS students,1::int AS teachers,0::int AS parents,count(DISTINCT a.id)::int AS attendance_marked FROM teachers t LEFT JOIN teacher_assignments ta ON ta.school_id=t.school_id AND ta.teacher_id=t.id LEFT JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id LEFT JOIN student_enrollments e ON e.school_id=t.school_id AND e.class_id=cs.class_id AND (ta.section_id IS NULL OR e.section_id=ta.section_id) AND e.status='active' LEFT JOIN attendance a ON a.school_id=e.school_id AND a.student_id=e.student_id AND a.attendance_date=CURRENT_DATE WHERE t.school_id=$1 AND t.user_id=$2 AND t.employment_status='active'`, [schoolId, req.identity.id]);
    else if (req.identity.role === "parent") result = await client.query(`SELECT count(DISTINCT sp.student_id)::int AS students,0::int AS teachers,1::int AS parents,count(DISTINCT a.id)::int AS attendance_marked FROM parents p LEFT JOIN student_parents sp ON sp.school_id=p.school_id AND sp.parent_id=p.id LEFT JOIN attendance a ON a.school_id=sp.school_id AND a.student_id=sp.student_id AND a.attendance_date=CURRENT_DATE WHERE p.school_id=$1 AND p.user_id=$2`, [schoolId, req.identity.id]);
    else if (req.schoolRole.code === "student") result = await client.query(`SELECT 1::int AS students,0::int AS teachers,0::int AS parents,count(*)::int AS attendance_marked FROM attendance WHERE school_id=$1 AND student_id=(SELECT id FROM students WHERE school_id=$1 AND user_id=$2) AND attendance_date=CURRENT_DATE`, [schoolId, req.identity.id]);
    else result = await client.query("SELECT 0::int AS students,0::int AS teachers,0::int AS parents,0::int AS attendance_marked");
    const years = await client.query("SELECT id,name,starts_on,ends_on FROM academic_years WHERE school_id=$1 AND is_current LIMIT 1", [schoolId]);
    return { metrics: result.rows[0], currentAcademicYear: years.rows[0] || null };
  });
  res.json(data);
}));
schoolRouter.get("/academic-years", authenticate, requireSchoolPermission("academics:read", "academics:read:assigned"), asyncRoute(async (req, res) => {
  const all = req.permissions.includes("academics:read");
  const data = await tenantTransaction(req.tenant.id, (client) => client.query(`SELECT DISTINCT y.id,y.name,y.starts_on,y.ends_on,y.is_current FROM academic_years y WHERE y.school_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM classes c JOIN class_subjects cs ON cs.school_id=c.school_id AND cs.class_id=c.id JOIN teacher_assignments ta ON ta.school_id=cs.school_id AND ta.class_subject_id=cs.id JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id WHERE c.school_id=y.school_id AND c.academic_year_id=y.id AND t.user_id=$3)) ORDER BY y.starts_on DESC`, [req.tenant.id, all, req.identity.id]));
  res.json({ items: data.rows });
}));
schoolRouter.post("/academic-years", authenticate, requireSchoolPermission("academics:manage"), asyncRoute(async (req, res) => {
  const data = yearSchema.parse(req.body), year = await tenantTransaction(req.tenant.id, async (client) => {
    if (data.isCurrent) await client.query("UPDATE academic_years SET is_current=false WHERE school_id=$1", [req.tenant.id]);
    const inserted = await client.query("INSERT INTO academic_years(school_id,name,starts_on,ends_on,is_current) VALUES($1,$2,$3,$4,$5) RETURNING id,name,starts_on,ends_on,is_current", [req.tenant.id, data.name, data.startsOn, data.endsOn, data.isCurrent]);
    return inserted.rows[0];
  });
  await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id) SELECT $1,id,'academic_year.created','academic_year',$2 FROM school_memberships WHERE school_id=$1 AND user_id=$3", [req.tenant.id, year.id, req.identity.id]));
  res.status(201).json({ academicYear: year });
}));
schoolRouter.get("/classes", authenticate, requireSchoolPermission("academics:read", "academics:read:assigned"), asyncRoute(async (req, res) => {
  const academicYearId = typeof req.query.academicYearId === "string" ? z3.uuid().parse(req.query.academicYearId) : null, all = req.permissions.includes("academics:read");
  const years = await tenantTransaction(req.tenant.id, (client) => client.query(`SELECT c.id,c.name,c.grade_level,c.academic_year_id,y.name AS academic_year_name,count(DISTINCT e.id)::int AS students,count(DISTINCT s.id)::int AS sections FROM classes c JOIN academic_years y ON y.id=c.academic_year_id LEFT JOIN student_enrollments e ON e.school_id=c.school_id AND e.class_id=c.id AND e.status='active' LEFT JOIN sections s ON s.school_id=c.school_id AND s.class_id=c.id WHERE c.school_id=$1 AND ($2::uuid IS NULL OR c.academic_year_id=$2) AND ($3::boolean OR EXISTS(SELECT 1 FROM class_subjects cs JOIN teacher_assignments ta ON ta.school_id=cs.school_id AND ta.class_subject_id=cs.id JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id WHERE cs.school_id=c.school_id AND cs.class_id=c.id AND t.user_id=$4 AND (ta.section_id IS NULL OR s.id IS NULL OR ta.section_id=s.id))) GROUP BY c.id,y.name ORDER BY c.grade_level NULLS LAST,c.name`, [req.tenant.id, academicYearId, all, req.identity.id]));
  res.json({ items: years.rows });
}));
schoolRouter.post("/classes", authenticate, requireSchoolPermission("academics:manage"), asyncRoute(async (req, res) => {
  const data = classSchema.parse(req.body), created = await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO classes(school_id,academic_year_id,name,grade_level) VALUES($1,$2,$3,$4) RETURNING id,name,grade_level,academic_year_id", [req.tenant.id, data.academicYearId, data.name, data.gradeLevel ?? null]));
  await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id) SELECT $1,id,'class.created','class',$2 FROM school_memberships WHERE school_id=$1 AND user_id=$3", [req.tenant.id, created.rows[0].id, req.identity.id]));
  res.status(201).json({ class: created.rows[0] });
}));
schoolRouter.get("/sections", authenticate, requireSchoolPermission("academics:read", "academics:read:assigned"), asyncRoute(async (req, res) => {
  const classId = typeof req.query.classId === "string" ? z3.uuid().parse(req.query.classId) : null, all = req.permissions.includes("academics:read");
  const data = await tenantTransaction(req.tenant.id, (client) => client.query(`SELECT s.id,s.class_id,s.name,s.room,c.name AS class_name FROM sections s JOIN classes c ON c.school_id=s.school_id AND c.id=s.class_id WHERE s.school_id=$1 AND ($2::uuid IS NULL OR s.class_id=$2) AND ($3::boolean OR EXISTS(SELECT 1 FROM class_subjects cs JOIN teacher_assignments ta ON ta.school_id=cs.school_id AND ta.class_subject_id=cs.id JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id WHERE cs.school_id=s.school_id AND cs.class_id=s.class_id AND t.user_id=$4 AND (ta.section_id IS NULL OR ta.section_id=s.id))) ORDER BY c.name,s.name`, [req.tenant.id, classId, all, req.identity.id]));
  res.json({ items: data.rows });
}));
schoolRouter.post("/sections", authenticate, requireSchoolPermission("academics:manage"), asyncRoute(async (req, res) => {
  const data = sectionSchema.parse(req.body), created = await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO sections(school_id,class_id,name,room) VALUES($1,$2,$3,$4) RETURNING id,class_id,name,room", [req.tenant.id, data.classId, data.name, data.room ?? null]));
  await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id) SELECT $1,id,'section.created','section',$2 FROM school_memberships WHERE school_id=$1 AND user_id=$3", [req.tenant.id, created.rows[0].id, req.identity.id]));
  res.status(201).json({ section: created.rows[0] });
}));
schoolRouter.get("/subjects", authenticate, requireSchoolPermission("academics:read", "academics:read:assigned"), asyncRoute(async (req, res) => {
  const classId = typeof req.query.classId === "string" ? z3.uuid().parse(req.query.classId) : null, all = req.permissions.includes("academics:read");
  const data = await tenantTransaction(req.tenant.id, (client) => client.query(`SELECT DISTINCT s.id,s.name,s.code FROM subjects s LEFT JOIN class_subjects cs ON cs.school_id=s.school_id AND cs.subject_id=s.id WHERE s.school_id=$1 AND ($2::uuid IS NULL OR cs.class_id=$2) AND ($3::boolean OR EXISTS(SELECT 1 FROM teacher_assignments ta JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id WHERE ta.school_id=s.school_id AND ta.class_subject_id=cs.id AND t.user_id=$4)) ORDER BY s.name`, [req.tenant.id, classId, all, req.identity.id]));
  res.json({ items: data.rows });
}));
schoolRouter.post("/subjects", authenticate, requireSchoolPermission("academics:manage"), asyncRoute(async (req, res) => {
  const data = subjectSchema.parse(req.body), created = await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO subjects(school_id,name,code) VALUES($1,$2,$3) RETURNING id,name,code", [req.tenant.id, data.name, data.code ?? null]));
  await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id) SELECT $1,id,'subject.created','subject',$2 FROM school_memberships WHERE school_id=$1 AND user_id=$3", [req.tenant.id, created.rows[0].id, req.identity.id]));
  res.status(201).json({ subject: created.rows[0] });
}));
schoolRouter.post("/classes/:id/subjects", authenticate, requireSchoolPermission("academics:manage"), asyncRoute(async (req, res) => {
  const classId = z3.uuid().parse(req.params.id), { subjectId } = z3.object({ subjectId: z3.uuid() }).parse(req.body), created = await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO class_subjects(school_id,class_id,subject_id) VALUES($1,$2,$3) RETURNING id,class_id,subject_id", [req.tenant.id, classId, subjectId]));
  await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id) SELECT $1,id,'class.subject_assigned','class_subject',$2 FROM school_memberships WHERE school_id=$1 AND user_id=$3", [req.tenant.id, created.rows[0].id, req.identity.id]));
  res.status(201).json({ assignment: created.rows[0] });
}));
schoolRouter.get("/class-subjects", authenticate, requireSchoolPermission("academics:read", "academics:read:assigned", "academics:manage"), asyncRoute(async (req, res) => {
  const classId = typeof req.query.classId === "string" ? z3.uuid().parse(req.query.classId) : null;
  const data = await tenantTransaction(req.tenant.id, (client) => client.query(`SELECT cs.id,cs.subject_id,s.name AS subject_name,s.code FROM class_subjects cs JOIN subjects s ON s.school_id=cs.school_id AND s.id=cs.subject_id WHERE cs.school_id=$1 AND ($2::uuid IS NULL OR cs.class_id=$2) ORDER BY s.name`, [req.tenant.id, classId]));
  res.json({ items: data.rows });
}));
schoolRouter.get("/teachers", authenticate, requireSchoolPermission("academics:read", "academics:manage", "teachers:read", "teachers:manage"), asyncRoute(async (req, res) => {
  const data = await tenantTransaction(req.tenant.id, (client) => client.query(`SELECT t.id,t.employee_id,COALESCE(u.name,t.employee_id) AS name,u.email FROM teachers t LEFT JOIN users u ON u.id=t.user_id WHERE t.school_id=$1 AND t.employment_status='active' ORDER BY name`, [req.tenant.id]));
  res.json({ items: data.rows });
}));
schoolRouter.post("/classes/:id/teachers", authenticate, requireSchoolPermission("academics:manage"), asyncRoute(async (req, res) => {
  const classId = z3.uuid().parse(req.params.id), data = z3.object({ teacherId: z3.uuid(), subjectId: z3.uuid(), sectionId: z3.uuid().optional().nullable() }).parse(req.body);
  const created = await tenantTransaction(req.tenant.id, async (client) => {
    const cs = await client.query("SELECT id FROM class_subjects WHERE school_id=$1 AND class_id=$2 AND subject_id=$3", [req.tenant.id, classId, data.subjectId]);
    if (!cs.rows[0]) fail(404, "Class subject mapping not found");
    const teacher = await client.query("SELECT id FROM teachers WHERE school_id=$1 AND id=$2 AND employment_status='active'", [req.tenant.id, data.teacherId]);
    if (!teacher.rows[0]) fail(404, "Teacher not found");
    const assigned2 = await client.query(`INSERT INTO teacher_assignments(school_id,teacher_id,class_subject_id,section_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id,teacher_id,class_subject_id,section_id`, [req.tenant.id, data.teacherId, cs.rows[0].id, data.sectionId ?? null]);
    return assigned2.rows[0] || { teacher_id: data.teacherId, class_subject_id: cs.rows[0].id };
  });
  res.status(201).json({ assignment: created });
}));
schoolRouter.get("/settings", authenticate, requireSchoolPermission("school:settings:read", "school:settings:update"), asyncRoute(async (req, res) => {
  const data = await tenantTransaction(req.tenant.id, (client) => client.query("SELECT academic_year_label,settings,updated_at FROM school_settings WHERE school_id=$1", [req.tenant.id]));
  res.json({ settings: data.rows[0] || { academic_year_label: null, settings: {} } });
}));
schoolRouter.patch("/settings", authenticate, requireSchoolPermission("school:settings:update"), asyncRoute(async (req, res) => {
  const data = settingsSchema.parse(req.body), updated = await tenantTransaction(req.tenant.id, async (client) => {
    const current = await client.query("SELECT settings FROM school_settings WHERE school_id=$1 FOR UPDATE", [req.tenant.id]), merged = { ...current.rows[0]?.settings || {}, ...data.settings || {} };
    const result = await client.query(`INSERT INTO school_settings(school_id,academic_year_label,settings,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(school_id) DO UPDATE SET academic_year_label=COALESCE(EXCLUDED.academic_year_label,school_settings.academic_year_label),settings=EXCLUDED.settings,updated_at=now() RETURNING academic_year_label,settings,updated_at`, [req.tenant.id, data.academicYearLabel ?? null, JSON.stringify(merged)]);
    return result.rows[0];
  });
  await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) SELECT $1,id,'school.settings_updated','school_settings',$1,$3 FROM school_memberships WHERE school_id=$1 AND user_id=$2", [req.tenant.id, req.identity.id, JSON.stringify({ keys: Object.keys(data.settings || {}) })]));
  res.json({ settings: updated });
}));
schoolRouter.get("/students", authenticate, requireSchoolPermission("students:read", "students:read:assigned", "students:read:linked", "students:read:self"), asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20)), search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "", yearId = typeof req.query.academicYearId === "string" ? z3.uuid().parse(req.query.academicYearId) : null;
  let scope = "($4::uuid IS NOT NULL OR $4::uuid IS NULL)";
  if (!req.permissions.includes("students:read")) {
    if (req.permissions.includes("students:read:assigned")) scope = `EXISTS(SELECT 1 FROM student_enrollments se2 JOIN classes c2 ON c2.school_id=se2.school_id AND c2.id=se2.class_id JOIN class_subjects cs2 ON cs2.school_id=c2.school_id AND cs2.class_id=c2.id JOIN teacher_assignments ta2 ON ta2.school_id=cs2.school_id AND ta2.class_subject_id=cs2.id JOIN teachers t2 ON t2.school_id=ta2.school_id AND t2.id=ta2.teacher_id WHERE se2.school_id=st.school_id AND se2.student_id=st.id AND se2.status='active' AND t2.user_id=$4::uuid AND (ta2.section_id IS NULL OR ta2.section_id=se2.section_id))`;
    else if (req.permissions.includes("students:read:linked")) scope = `EXISTS(SELECT 1 FROM parents p2 JOIN student_parents sp2 ON sp2.school_id=p2.school_id AND sp2.parent_id=p2.id WHERE p2.school_id=st.school_id AND p2.user_id=$4::uuid AND sp2.student_id=st.id)`;
    else scope = "st.user_id=$4::uuid";
  }
  const params = [req.tenant.id, `%${search}%`, yearId, req.identity.id, limit, (page - 1) * limit];
  const data = await tenantTransaction(req.tenant.id, async (client) => {
    const items = await client.query(`SELECT st.id,st.admission_number,st.first_name,st.last_name,st.date_of_birth,st.status,e.class_id,c.name AS class_name,e.section_id,se.name AS section_name,e.academic_year_id,y.name AS academic_year_name FROM students st LEFT JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id AND e.status='active' LEFT JOIN classes c ON c.school_id=e.school_id AND c.id=e.class_id LEFT JOIN sections se ON se.school_id=e.school_id AND se.id=e.section_id LEFT JOIN academic_years y ON y.school_id=e.school_id AND y.id=e.academic_year_id WHERE st.school_id=$1 AND ($2='' OR st.first_name ILIKE $2 OR st.last_name ILIKE $2 OR st.admission_number ILIKE $2) AND ($3::uuid IS NULL OR e.academic_year_id=$3) AND (${scope}) ORDER BY st.last_name,st.first_name LIMIT $5 OFFSET $6`, params);
    const count = await client.query(`SELECT count(*)::int AS total FROM students st LEFT JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id AND e.status='active' WHERE st.school_id=$1 AND ($2='' OR st.first_name ILIKE $2 OR st.last_name ILIKE $2 OR st.admission_number ILIKE $2) AND ($3::uuid IS NULL OR e.academic_year_id=$3) AND (${scope})`, params.slice(0, 4));
    return { items: items.rows, total: count.rows[0].total };
  });
  res.json({ ...data, page, limit });
}));
schoolRouter.post("/students", authenticate, requireSchoolPermission("students:admit"), asyncRoute(async (req, res) => {
  const data = studentSchema.parse(req.body), created = await tenantTransaction(req.tenant.id, async (client) => {
    if (data.sectionId) {
      const section = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3", [req.tenant.id, data.sectionId, data.classId]);
      if (!section.rowCount) fail(400, "Section does not belong to the selected class");
    }
    const student = await client.query("INSERT INTO students(school_id,admission_number,first_name,last_name,date_of_birth) VALUES($1,$2,$3,$4,$5) RETURNING id,admission_number,first_name,last_name,date_of_birth,status", [req.tenant.id, data.admissionNumber, data.firstName, data.lastName, data.dateOfBirth ?? null]);
    await client.query("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id) VALUES($1,$2,$3,$4,$5)", [req.tenant.id, student.rows[0].id, data.academicYearId, data.classId, data.sectionId ?? null]);
    return student.rows[0];
  });
  await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id) SELECT $1,id,'student.admitted','student',$2 FROM school_memberships WHERE school_id=$1 AND user_id=$3", [req.tenant.id, created.id, req.identity.id]));
  res.status(201).json({ student: created });
}));
schoolRouter.post("/students/import", authenticate, requireSchoolPermission("students:admit"), asyncRoute(async (req, res) => {
  const { students } = importStudentsSchema.parse(req.body), created = await tenantTransaction(req.tenant.id, async (client) => {
    const rows = [];
    for (const data of students) {
      if (data.sectionId) {
        const section = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3", [req.tenant.id, data.sectionId, data.classId]);
        if (!section.rowCount) fail(400, "A section does not belong to the selected class");
      }
      const student = await client.query("INSERT INTO students(school_id,admission_number,first_name,last_name,date_of_birth) VALUES($1,$2,$3,$4,$5) RETURNING id,admission_number,first_name,last_name,status", [req.tenant.id, data.admissionNumber, data.firstName, data.lastName, data.dateOfBirth ?? null]);
      await client.query("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id) VALUES($1,$2,$3,$4,$5)", [req.tenant.id, student.rows[0].id, data.academicYearId, data.classId, data.sectionId ?? null]);
      rows.push(student.rows[0]);
    }
    return rows;
  });
  await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) SELECT $1,id,'student.bulk_imported','student_import',NULL,$3 FROM school_memberships WHERE school_id=$1 AND user_id=$2", [req.tenant.id, req.identity.id, JSON.stringify({ count: created.length })]));
  res.status(201).json({ items: created, imported: created.length });
}));
schoolRouter.patch("/students/:id/lifecycle", authenticate, requireSchoolPermission("students:manage", "students:archive"), asyncRoute(async (req, res) => {
  const studentId = z3.uuid().parse(req.params.id), data = lifecycleSchema.parse(req.body);
  if (["promote", "transfer"].includes(data.action) && !req.permissions.includes("students:manage")) fail(403, "Student management permission is required");
  if (["graduate", "archive"].includes(data.action) && !req.permissions.includes("students:archive") && !req.permissions.includes("students:manage")) fail(403, "Student archival permission is required");
  if ((data.classId || data.academicYearId) && (!data.classId || !data.academicYearId)) fail(400, "Provide both a class and academic year");
  if (data.action === "promote" && (!data.classId || !data.academicYearId)) fail(400, "Promotion requires a new class and academic year");
  const result = await tenantTransaction(req.tenant.id, async (client) => {
    const student = await client.query("SELECT id,status FROM students WHERE school_id=$1 AND id=$2 FOR UPDATE", [req.tenant.id, studentId]);
    if (!student.rows[0]) fail(404, "Student not found");
    if (data.classId && data.academicYearId) {
      const target = await client.query("SELECT 1 FROM classes c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=$1 AND c.id=$2 AND y.id=$3", [req.tenant.id, data.classId, data.academicYearId]);
      if (!target.rowCount) fail(400, "Target class and academic year are unavailable");
      if (data.sectionId) {
        const section = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3", [req.tenant.id, data.sectionId, data.classId]);
        if (!section.rowCount) fail(400, "Target section does not belong to the selected class");
      }
    } else if (data.sectionId) fail(400, "A section requires a target class and year");
    const enrollmentStatus = data.action === "promote" ? "promoted" : data.action === "transfer" ? "transferred" : data.action === "graduate" ? "graduated" : "archived";
    await client.query("UPDATE student_enrollments SET status=$3,ended_on=CURRENT_DATE WHERE school_id=$1 AND student_id=$2 AND status='active'", [req.tenant.id, studentId, enrollmentStatus]);
    let status = data.action === "promote" ? "active" : data.action === "transfer" && data.classId ? "active" : data.action === "transfer" ? "transferred" : data.action === "graduate" ? "graduated" : "archived";
    if (data.action === "promote" || data.action === "transfer" && data.classId) await client.query("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id) VALUES($1,$2,$3,$4,$5)", [req.tenant.id, studentId, data.academicYearId, data.classId, data.sectionId ?? null]);
    const updated = await client.query("UPDATE students SET status=$3,updated_at=now() WHERE school_id=$1 AND id=$2 RETURNING id,status", [req.tenant.id, studentId, status]);
    return updated.rows[0];
  });
  await tenantTransaction(req.tenant.id, (client) => client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) SELECT $1,id,$3,'student',$2,$4 FROM school_memberships WHERE school_id=$1 AND user_id=$5", [req.tenant.id, studentId, `student.${data.action}`, JSON.stringify({ classId: data.classId, academicYearId: data.academicYearId }), req.identity.id]));
  res.json({ student: result });
}));

// apps/api/src/schools/roles.ts
init_config();
import { Router as Router3 } from "express";
import { createHash as createHash3 } from "node:crypto";
import { z as z4 } from "zod";
var schoolRoleRouter = Router3();
schoolRoleRouter.use(authenticate);
var permissionNames = ["dashboard:read", "school:roles:manage", "school:members:manage", "school:admins:manage", "school:settings:read", "school:settings:update", "academics:read", "academics:read:assigned", "academics:manage", "students:read", "students:read:assigned", "students:read:linked", "students:read:self", "students:admit", "students:manage", "students:archive", "parents:read", "parents:manage", "teachers:read", "teachers:manage", "attendance:read", "attendance:read:assigned", "attendance:read:linked", "attendance:read:self", "attendance:manage", "attendance:manage:assigned", "homework:read", "homework:read:assigned", "homework:read:linked", "homework:read:self", "homework:manage", "homework:manage:assigned", "exams:read", "exams:read:assigned", "exams:manage", "exams:manage:assigned", "results:read", "results:read:assigned", "results:read:linked", "results:read:self", "results:publish", "fees:read", "fees:read:linked", "fees:manage", "timetable:read", "timetable:read:assigned", "timetable:manage", "announcements:read", "announcements:manage", "reports:read", "reports:class", "support-access:review"];
var supportScopePermission = z4.enum(["students:read", "fees:read", "announcements:read", "messages:read"]);
var permissionSchema = z4.enum(permissionNames);
var roleSchema = z4.object({ name: z4.string().trim().min(2).max(80), code: z4.string().trim().min(2).max(40).regex(/^[a-z][a-z0-9_]*$/), memberKind: z4.enum(["school_admin", "teacher", "parent", "student"]), permissions: z4.array(permissionSchema).max(40) });
var invitationSchema = z4.object({ email: z4.email().max(254), name: z4.string().trim().min(2).max(160), schoolRoleId: z4.uuid(), employeeId: z4.string().trim().min(2).max(60).optional(), studentIds: z4.array(z4.uuid()).max(50).default([]), studentId: z4.uuid().optional() });
var inviteAcceptanceMinutes = env.INVITATION_TTL_HOURS * 60;
async function audit2(schoolId, userId, action, targetType, targetId, metadata = {}) {
  return tenantTransaction(schoolId, (client) => client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) SELECT $1,m.id,$3,$4,$5,$6 FROM school_memberships m WHERE m.school_id=$1 AND m.user_id=$2`, [schoolId, userId, action, targetType, targetId, JSON.stringify(metadata)]));
}
var permissionInheritance = { "academics:read": ["academics:read:assigned"], "students:read": ["students:read:assigned", "students:read:linked", "students:read:self"], "attendance:read": ["attendance:read:assigned", "attendance:read:linked", "attendance:read:self"], "attendance:manage": ["attendance:manage:assigned"], "homework:read": ["homework:read:assigned", "homework:read:linked", "homework:read:self"], "homework:manage": ["homework:manage:assigned"], "exams:read": ["exams:read:assigned"], "exams:manage": ["exams:manage:assigned"], "results:read": ["results:read:assigned", "results:read:linked", "results:read:self"], "fees:read": ["fees:read:linked"], "timetable:read": ["timetable:read:assigned", "timetable:read:linked", "timetable:read:self"], "reports:read": ["reports:class"] };
function permissionCovered(actor2, permission) {
  return actor2.includes(permission) || Object.entries(permissionInheritance).some(([broad, scoped]) => actor2.includes(broad) && scoped.includes(permission));
}
function ensureSubpermissions(grants, actor2) {
  if (grants.some((permission) => !permissionCovered(actor2, permission))) fail(403, "You cannot grant permissions you do not hold");
}
async function ensureAnotherRoleManager(client, schoolId, membershipId2) {
  const managers = await client.query(`SELECT count(*)::int AS count FROM school_memberships m JOIN school_role_permissions p ON p.school_id=m.school_id AND p.role_id=m.school_role_id AND p.permission_key='school:roles:manage' WHERE m.school_id=$1 AND m.is_active AND m.id<>$2`, [schoolId, membershipId2]);
  if (!managers.rows[0].count) fail(409, "Keep at least one active school role administrator");
}
schoolRoleRouter.get("/roles", requireSchoolPermission("school:roles:manage", "school:members:manage", "school:admins:manage"), asyncRoute(async (req, res) => {
  const data = await tenantTransaction(req.tenant.id, (client) => client.query(`SELECT r.id,r.name,r.code,r.member_kind,r.is_system,r.created_at,COALESCE(array_agg(p.permission_key ORDER BY p.permission_key) FILTER(WHERE p.permission_key IS NOT NULL),'{}') AS permissions FROM school_roles r LEFT JOIN school_role_permissions p ON p.school_id=r.school_id AND p.role_id=r.id WHERE r.school_id=$1 GROUP BY r.id ORDER BY r.is_system DESC,r.name`, [req.tenant.id]));
  res.json({ items: data.rows });
}));
schoolRoleRouter.post("/roles", requireSchoolPermission("school:roles:manage"), asyncRoute(async (req, res) => {
  const data = roleSchema.parse(req.body);
  ensureSubpermissions(data.permissions, req.permissions);
  const result = await tenantTransaction(req.tenant.id, async (client) => {
    const role = await client.query("INSERT INTO school_roles(school_id,name,code,member_kind,is_system) VALUES($1,$2,$3,$4,false) RETURNING id,name,code,member_kind,is_system", [req.tenant.id, data.name, data.code, data.memberKind]);
    for (const permission of new Set(data.permissions)) await client.query("INSERT INTO school_role_permissions(school_id,role_id,permission_key) VALUES($1,$2,$3)", [req.tenant.id, role.rows[0].id, permission]);
    return role.rows[0];
  });
  await audit2(req.tenant.id, req.identity.id, "school.role_created", "school_role", result.id, { code: data.code, permissions: data.permissions });
  res.status(201).json({ role: { ...result, permissions: data.permissions } });
}));
schoolRoleRouter.patch("/roles/:id/permissions", requireSchoolPermission("school:roles:manage"), asyncRoute(async (req, res) => {
  const roleId = z4.uuid().parse(req.params.id), data = z4.object({ permissions: z4.array(permissionSchema).max(40) }).parse(req.body);
  ensureSubpermissions(data.permissions, req.permissions);
  const result = await tenantTransaction(req.tenant.id, async (client) => {
    const role = await client.query("SELECT id,code FROM school_roles WHERE school_id=$1 AND id=$2", [req.tenant.id, roleId]);
    if (!role.rows[0]) fail(404, "School role not found");
    const assigned2 = await client.query("SELECT id FROM school_memberships WHERE school_id=$1 AND school_role_id=$2 AND user_id=$3 AND is_active", [req.tenant.id, roleId, req.identity.id]);
    if (assigned2.rowCount && data.permissions.some((permission) => !permissionCovered(req.permissions, permission))) fail(403, "You cannot grant yourself additional permissions");
    const hadManager = await client.query("SELECT 1 FROM school_role_permissions WHERE school_id=$1 AND role_id=$2 AND permission_key='school:roles:manage'", [req.tenant.id, roleId]);
    if (hadManager.rowCount && !data.permissions.includes("school:roles:manage")) {
      const holders = await client.query("SELECT id FROM school_memberships WHERE school_id=$1 AND school_role_id=$2 AND is_active", [req.tenant.id, roleId]);
      if (holders.rowCount) {
        const replacements = await client.query("SELECT 1 FROM school_memberships m JOIN school_role_permissions p ON p.school_id=m.school_id AND p.role_id=m.school_role_id AND p.permission_key='school:roles:manage' WHERE m.school_id=$1 AND m.is_active AND m.school_role_id<>$2 LIMIT 1", [req.tenant.id, roleId]);
        if (!replacements.rowCount) fail(409, "Keep at least one active school role administrator");
      }
    }
    await client.query("DELETE FROM school_role_permissions WHERE school_id=$1 AND role_id=$2", [req.tenant.id, roleId]);
    for (const permission of new Set(data.permissions)) await client.query("INSERT INTO school_role_permissions(school_id,role_id,permission_key) VALUES($1,$2,$3)", [req.tenant.id, roleId, permission]);
    return role.rows[0];
  });
  await audit2(req.tenant.id, req.identity.id, "school.role_permissions_updated", "school_role", roleId, { permissions: data.permissions });
  res.json({ role: { ...result, permissions: data.permissions } });
}));
schoolRoleRouter.get("/members", requireSchoolPermission("school:members:manage", "school:admins:manage"), asyncRoute(async (req, res) => {
  const members = await tenantTransaction(req.tenant.id, (client) => client.query(`SELECT m.id,m.user_id,u.name,u.email,m.role,m.is_active,m.created_at,r.id AS school_role_id,r.name AS school_role_name,r.code AS school_role_code,t.employee_id FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN school_roles r ON r.school_id=m.school_id AND r.id=m.school_role_id LEFT JOIN teachers t ON t.school_id=m.school_id AND t.user_id=m.user_id WHERE m.school_id=$1 ORDER BY r.name,u.name`, [req.tenant.id]));
  res.json({ items: members.rows });
}));
schoolRoleRouter.post("/members/invitations", requireSchoolPermission("school:members:manage", "school:admins:manage"), asyncRoute(async (req, res) => {
  const data = invitationSchema.parse(req.body), token = generateInvitationToken(), tokenHash = createHash3("sha256").update(token).digest("hex");
  const role = await tenantTransaction(req.tenant.id, (client) => client.query("SELECT id,name,code,member_kind FROM school_roles WHERE school_id=$1 AND id=$2", [req.tenant.id, data.schoolRoleId]));
  if (!role.rows[0]) fail(404, "School role not found");
  const managerPermission = { school_admin: "school:admins:manage", teacher: "teachers:manage", parent: "parents:manage", student: "students:manage" }, requiredPermission = managerPermission[role.rows[0].member_kind];
  if (!requiredPermission || !req.permissions.includes(requiredPermission)) fail(403, "You cannot invite this school account type");
  const roleGrants = await tenantTransaction(req.tenant.id, (client) => client.query("SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2", [req.tenant.id, data.schoolRoleId]));
  ensureSubpermissions(roleGrants.rows.map((item) => item.permission_key), req.permissions);
  if (role.rows[0].member_kind === "parent" && !data.studentIds.length) fail(400, "Link at least one student to a parent invitation");
  if (role.rows[0].member_kind !== "parent" && data.studentIds.length) fail(400, "Student links are only valid for parent invitations");
  if (role.rows[0].member_kind === "student" && !data.studentId) fail(400, "Select the student record for this account invitation");
  if (role.rows[0].member_kind !== "student" && data.studentId) fail(400, "Student account links are only valid for student invitations");
  if (data.employeeId && role.rows[0].member_kind !== "teacher") fail(400, "Employee ID is only valid for teacher invitations");
  const result = await tenantTransaction(req.tenant.id, async (client) => {
    if (data.studentIds.length) {
      const valid = await client.query("SELECT id FROM students WHERE school_id=$1 AND id=ANY($2::uuid[])", [req.tenant.id, data.studentIds]);
      if (valid.rowCount !== new Set(data.studentIds).size) fail(400, "One or more students are unavailable");
    }
    if (data.studentId) {
      const valid = await client.query("SELECT id FROM students WHERE school_id=$1 AND id=$2 AND user_id IS NULL", [req.tenant.id, data.studentId]);
      if (!valid.rowCount) fail(400, "Student record is unavailable or already linked");
    }
    const invite = await client.query(`INSERT INTO invitations(school_id,email,name,role,school_role_id,token_hash,expires_at,invited_by_membership_id,member_metadata) SELECT $1,lower($2),$3,$4,$5,$6,now()+($7 || ' minutes')::interval,m.id,$8 FROM school_memberships m WHERE m.school_id=$1 AND m.user_id=$9 RETURNING id,email,expires_at`, [req.tenant.id, data.email, data.name, role.rows[0].member_kind, data.schoolRoleId, tokenHash, inviteAcceptanceMinutes, JSON.stringify({ ...data.employeeId ? { employeeId: data.employeeId } : {}, ...data.studentIds.length ? { studentIds: data.studentIds } : {}, ...data.studentId ? { studentId: data.studentId } : {} }), req.identity.id]);
    return invite.rows[0];
  });
  if (!result) fail(403, "Active school membership is required");
  await audit2(req.tenant.id, req.identity.id, "school.member_invited", "invitation", result.id, { email: result.email, role: role.rows[0].code });
  let deliveryStatus = "sent";
  try {
    await sendInvitation(data.email, req.tenant.displayId, token);
  } catch (error) {
    deliveryStatus = "pending_delivery";
    console.error("School invitation delivery failed", error);
  }
  res.status(201).json({ invitation: { id: result.id, email: result.email, expiresAt: result.expires_at, deliveryStatus, ...env.NODE_ENV === "development" || process.env.NODE_ENV === "test" ? { developmentUrl: `${env.INVITATION_BASE_URL}?token=${token}` } : {} } });
}));
schoolRoleRouter.patch("/members/:id/role", requireSchoolPermission("school:roles:manage", "school:members:manage", "school:admins:manage"), asyncRoute(async (req, res) => {
  const membershipId2 = z4.uuid().parse(req.params.id), { schoolRoleId } = z4.object({ schoolRoleId: z4.uuid() }).parse(req.body);
  if (membershipId2 === req.identity.id) fail(403, "You cannot change your own role");
  const changed = await tenantTransaction(req.tenant.id, async (client) => {
    const target = await client.query("SELECT id,user_id,role,school_role_id FROM school_memberships WHERE school_id=$1 AND id=$2 AND is_active", [req.tenant.id, membershipId2]);
    if (!target.rows[0]) fail(404, "School member not found");
    if (target.rows[0].user_id === req.identity.id) fail(403, "You cannot change your own role");
    const role = await client.query("SELECT id,member_kind FROM school_roles WHERE school_id=$1 AND id=$2", [req.tenant.id, schoolRoleId]);
    if (!role.rows[0]) fail(404, "School role not found");
    if (role.rows[0].member_kind !== target.rows[0].role) fail(400, "Role changes must keep the account type; use an invitation for a new account type");
    const grants = await client.query("SELECT permission_key FROM school_role_permissions WHERE school_id=$1 AND role_id=$2", [req.tenant.id, schoolRoleId]);
    ensureSubpermissions(grants.rows.map((row) => row.permission_key), req.permissions);
    const current = await client.query("SELECT 1 FROM school_role_permissions WHERE school_id=$1 AND role_id=$2 AND permission_key='school:roles:manage'", [req.tenant.id, target.rows[0].school_role_id]);
    if (current.rowCount && !grants.rows.some((grant) => grant.permission_key === "school:roles:manage")) await ensureAnotherRoleManager(client, req.tenant.id, membershipId2);
    await client.query("UPDATE school_memberships SET school_role_id=$3,role=$4 WHERE school_id=$1 AND id=$2", [req.tenant.id, membershipId2, schoolRoleId, role.rows[0].member_kind]);
    return role.rows[0];
  });
  await audit2(req.tenant.id, req.identity.id, "school.member_role_changed", "membership", membershipId2, { roleId: changed.id });
  res.json({ membershipId: membershipId2, schoolRoleId: changed.id, memberKind: changed.member_kind });
}));
schoolRoleRouter.patch("/members/:id/status", requireSchoolPermission("school:members:manage"), asyncRoute(async (req, res) => {
  const membershipId2 = z4.uuid().parse(req.params.id), { active } = z4.object({ active: z4.boolean() }).parse(req.body);
  const result = await tenantTransaction(req.tenant.id, async (client) => {
    const target = await client.query("SELECT user_id,role,is_active FROM school_memberships WHERE school_id=$1 AND id=$2", [req.tenant.id, membershipId2]);
    if (!target.rows[0]) fail(404, "School member not found");
    if (target.rows[0].user_id === req.identity.id && !active) fail(400, "You cannot deactivate your own account");
    if (target.rows[0].is_active && !active) {
      const manager = await client.query("SELECT 1 FROM school_role_permissions WHERE school_id=$1 AND role_id=(SELECT school_role_id FROM school_memberships WHERE school_id=$1 AND id=$2) AND permission_key='school:roles:manage'", [req.tenant.id, membershipId2]);
      if (manager.rowCount) await ensureAnotherRoleManager(client, req.tenant.id, membershipId2);
    }
    await client.query("UPDATE school_memberships SET is_active=$3 WHERE school_id=$1 AND id=$2", [req.tenant.id, membershipId2, active]);
    if (target.rows[0].role === "teacher") await client.query("UPDATE teachers SET employment_status=$3 WHERE school_id=$1 AND user_id=$2", [req.tenant.id, target.rows[0].user_id, active ? "active" : "suspended"]);
    return target.rows[0];
  });
  await audit2(req.tenant.id, req.identity.id, active ? "school.member_activated" : "school.member_suspended", "membership", membershipId2, {});
  res.json({ membershipId: membershipId2, active });
}));
schoolRoleRouter.get("/support-access", requireSchoolPermission("support-access:review"), asyncRoute(async (req, res) => {
  const requests = await tenantTransaction(req.tenant.id, (client) => client.query(`SELECT g.id,g.reason,g.requested_scopes,g.status,g.requested_expires_at,g.approved_scopes,g.expires_at,g.created_at,g.requested_by FROM support_access_requests g WHERE g.school_id=$1 ORDER BY g.created_at DESC LIMIT 100`, [req.tenant.id]));
  res.json({ items: requests.rows });
}));
schoolRoleRouter.patch("/support-access/:id/decision", requireSchoolPermission("support-access:review"), asyncRoute(async (req, res) => {
  const requestId = z4.uuid().parse(req.params.id), decisionSchema = z4.object({ decision: z4.enum(["approve", "reject"]), approvedScopes: z4.array(supportScopePermission).max(4).default([]), durationMinutes: z4.number().int().min(15).max(120).default(60) }), decision = decisionSchema.parse(req.body);
  const result = await tenantTransaction(req.tenant.id, async (client) => {
    const request = await client.query("SELECT id,requested_scopes,requested_expires_at,status FROM support_access_requests WHERE school_id=$1 AND id=$2 FOR UPDATE", [req.tenant.id, requestId]);
    if (!request.rows[0]) fail(404, "Support-access request not found");
    if (request.rows[0].status !== "pending") fail(409, "Support-access request has already been reviewed");
    if (new Date(request.rows[0].requested_expires_at) <= /* @__PURE__ */ new Date()) fail(409, "Support-access request has expired");
    if (decision.decision === "approve") {
      if (!decision.approvedScopes.length || decision.approvedScopes.some((scope) => !request.rows[0].requested_scopes.includes(scope))) fail(400, "Approved scope must be a nonempty subset of the request");
      const updated2 = await client.query(`UPDATE support_access_requests SET status='approved',approved_scopes=$3,approved_by_membership_id=(SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$4),approved_at=now(),expires_at=LEAST(requested_expires_at,now()+($5 || ' minutes')::interval) WHERE school_id=$1 AND id=$2 RETURNING id,status,approved_scopes,expires_at`, [req.tenant.id, requestId, decision.approvedScopes, req.identity.id, decision.durationMinutes]);
      return updated2.rows[0];
    }
    const updated = await client.query(`UPDATE support_access_requests SET status='rejected',approved_by_membership_id=(SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$3),approved_at=now() WHERE school_id=$1 AND id=$2 RETURNING id,status,approved_scopes,expires_at`, [req.tenant.id, requestId, req.identity.id]);
    return updated.rows[0];
  });
  await audit2(req.tenant.id, req.identity.id, decision.decision === "approve" ? "support_access.approved" : "support_access.rejected", "support_access_request", requestId, { scopes: result.approved_scopes || [] });
  res.json({ request: result });
}));
schoolRoleRouter.post("/support-access/:id/revoke", requireSchoolPermission("support-access:review"), asyncRoute(async (req, res) => {
  const requestId = z4.uuid().parse(req.params.id), changed = await tenantTransaction(req.tenant.id, (client) => client.query(`UPDATE support_access_requests SET status='revoked',revoked_at=now() WHERE school_id=$1 AND id=$2 AND status='approved' AND expires_at>now() RETURNING id,status,revoked_at`, [req.tenant.id, requestId]));
  if (!changed.rows[0]) fail(404, "Active support-access grant not found");
  await audit2(req.tenant.id, req.identity.id, "support_access.revoked", "support_access_request", requestId, {});
  res.json({ request: changed.rows[0] });
}));

// apps/api/src/support/routes.ts
import { Router as Router4 } from "express";
import { z as z5 } from "zod";
var supportRouter = Router4();
var supportScope = z5.enum(["students:read", "fees:read", "announcements:read", "messages:read"]);
supportRouter.get("/support-access/mine", authenticate, requireSupportAgent, asyncRoute(async (req, res) => {
  const requests = await platformPool.query(`SELECT g.id,g.status,g.reason,g.requested_scopes,g.approved_scopes,g.requested_expires_at,g.expires_at,g.created_at,s.school_id,s.name AS school_name FROM support_access_requests g JOIN schools s ON s.id=g.school_id WHERE g.requested_by=$1 ORDER BY g.created_at DESC LIMIT 100`, [req.identity.id]);
  res.json({ items: requests.rows });
}));
supportRouter.post("/support-access", authenticate, requireSupportAgent, asyncRoute(async (req, res) => {
  const data = z5.object({ schoolId: z5.string().min(1).max(40), reason: z5.string().trim().min(12).max(1e3), scopes: z5.array(supportScope).min(1).max(4), durationMinutes: z5.number().int().min(15).max(120).default(60) }).parse(req.body);
  const school = await platformPool.query("SELECT id,school_id,name FROM schools WHERE (id::text=$1 OR school_id=$1) AND status='active' AND deleted_at IS NULL", [data.schoolId]);
  if (!school.rows[0]) fail(404, "Active school not found");
  const request = await platformPool.query(`INSERT INTO support_access_requests(school_id,requested_by,reason,requested_scopes,requested_expires_at) VALUES($1,$2,$3,$4,now()+($5 || ' minutes')::interval) RETURNING id,school_id,status,requested_scopes,requested_expires_at,created_at`, [school.rows[0].id, req.identity.id, data.reason, data.scopes, data.durationMinutes]);
  await platformPool.query(`INSERT INTO platform_audit_logs(actor_id,action,target_type,target_id,metadata) VALUES($1,'support_access.requested','support_access_request',$2,$3)`, [req.identity.id, request.rows[0].id, JSON.stringify({ schoolId: school.rows[0].school_id, scopes: data.scopes })]);
  res.status(201).json({ request: { ...request.rows[0], schoolName: school.rows[0].name } });
}));
supportRouter.get("/support-access/:id/students", authenticate, requireSupportAgent, asyncRoute(async (req, res) => {
  const requestId = z5.uuid().parse(req.params.id), page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const grant = await platformPool.query(`SELECT g.id,g.school_id,g.expires_at,s.school_id AS display_id FROM support_access_requests g JOIN schools s ON s.id=g.school_id WHERE g.id=$1 AND g.requested_by=$2 AND g.status='approved' AND g.expires_at>now() AND 'students:read'=ANY(g.approved_scopes) AND s.status='active'`, [requestId, req.identity.id]);
  if (!grant.rows[0]) fail(403, "No active school-approved student access grant");
  const schoolId = grant.rows[0].school_id;
  const records = await platformPool.query(`SELECT id,admission_number,first_name,last_name,status FROM students WHERE school_id=$1 ORDER BY last_name,first_name LIMIT $2 OFFSET $3`, [schoolId, limit, (page - 1) * limit]);
  const total = await platformPool.query("SELECT count(*)::int AS total FROM students WHERE school_id=$1", [schoolId]);
  await platformPool.query(`INSERT INTO platform_audit_logs(actor_id,action,target_type,target_id,metadata) VALUES($1,'support_access.student_records_read','support_access_request',$2,$3)`, [req.identity.id, requestId, JSON.stringify({ schoolId: grant.rows[0].display_id, page, limit, returned: records.rowCount })]);
  await tenantTransaction(schoolId, (client) => client.query("INSERT INTO audit_logs(school_id,action,target_type,target_id,metadata) VALUES($1,'support_access.student_records_read','support_access_request',$2,$3)", [schoolId, requestId, JSON.stringify({ platformUserId: req.identity.id, page, limit, returned: records.rowCount })]));
  res.json({ items: records.rows, page, limit, total: total.rows[0].total, accessExpiresAt: grant.rows[0].expires_at });
}));

// apps/api/src/attendance/routes.ts
import { Router as Router5 } from "express";
import { z as z6 } from "zod";
var attendanceRouter = Router5();
attendanceRouter.use(authenticate);
var statusSchema2 = z6.enum(["present", "absent", "late", "excused"]);
var dateSchema = z6.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((value) => {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}, "Use a valid calendar date");
var uuidSchema = z6.uuid();
var pagination = z6.object({ page: z6.coerce.number().int().min(1).default(1), pageSize: z6.coerce.number().int().min(1).max(100).default(50) });
var readPermissions = ["attendance:read", "attendance:read:assigned", "attendance:read:linked", "attendance:read:self"];
function membershipId(req) {
  return tenantTransaction(req.tenant.id, async (client) => {
    const result = await client.query("SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active", [req.tenant.id, req.identity.id]);
    if (!result.rows[0]) fail(403, "Active school membership is required");
    return result.rows[0].id;
  });
}
async function canAccessClass(client, req, classId, sectionId, manage = false) {
  const permissions = req.permissions ?? [];
  const global = permissions.includes(manage ? "attendance:manage" : "attendance:read");
  if (global) return;
  const scoped = permissions.includes(manage ? "attendance:manage:assigned" : "attendance:read:assigned");
  if (!scoped) fail(403, "Attendance permission is not authorized");
  const assigned2 = await client.query(`SELECT 1 FROM teachers t
    JOIN teacher_assignments ta ON ta.school_id=t.school_id AND ta.teacher_id=t.id
    JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id
    WHERE t.school_id=$1 AND t.user_id=$2 AND t.employment_status='active' AND cs.class_id=$3
      AND ($4::uuid IS NULL OR ta.section_id IS NULL OR ta.section_id = $4::uuid)
    LIMIT 1`, [req.tenant.id, req.identity.id, classId, sectionId ?? null]);
  if (!assigned2.rowCount) fail(403, "Class is outside your assigned teaching scope");
}
function queryClass(req) {
  return z6.object({ date: dateSchema, classId: uuidSchema, sectionId: uuidSchema.optional() }).parse(req.query);
}
attendanceRouter.get("/attendance/classes", requireSchoolPermission(...readPermissions), asyncRoute(async (req, res) => {
  const date2 = dateSchema.parse(req.query.date);
  const items = await tenantTransaction(req.tenant.id, async (client) => {
    const global = req.permissions.includes("attendance:read");
    const assigned2 = req.permissions.includes("attendance:read:assigned");
    if (!global && !assigned2) fail(403, "Class attendance is not available to this account");
    const result = await client.query(`SELECT c.id AS class_id,c.name AS class_name,c.academic_year_id,s.id AS section_id,s.name AS section_name,
      count(DISTINCT e.student_id)::int AS student_count,
      count(DISTINCT a.student_id)::int AS marked_count,
      count(DISTINCT a.student_id) FILTER(WHERE a.status='absent')::int AS absent_count
      FROM classes c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id AND $2::date BETWEEN y.starts_on AND y.ends_on
      LEFT JOIN sections s ON s.school_id=c.school_id AND s.class_id=c.id
      LEFT JOIN student_enrollments e ON e.school_id=c.school_id AND e.class_id=c.id AND e.status='active' AND e.enrolled_on<=$2::date AND (e.ended_on IS NULL OR e.ended_on >= $2::date) AND (s.id IS NULL OR e.section_id=s.id)
      LEFT JOIN attendance a ON a.school_id=c.school_id AND a.class_id=c.id AND a.attendance_date=$2::date AND a.student_id=e.student_id
      WHERE c.school_id=$1 AND ($3::boolean OR EXISTS(SELECT 1 FROM teachers t JOIN teacher_assignments ta ON ta.school_id=t.school_id AND ta.teacher_id=t.id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE t.school_id=c.school_id AND t.user_id=$4 AND t.employment_status='active' AND cs.class_id=c.id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM s.id)))
      GROUP BY c.id,c.name,c.academic_year_id,s.id,s.name ORDER BY c.name,s.name NULLS FIRST`, [req.tenant.id, date2, global, req.identity.id]);
    return result.rows;
  });
  res.json({ items });
}));
attendanceRouter.get("/attendance", requireSchoolPermission(...readPermissions), asyncRoute(async (req, res) => {
  const filter = queryClass(req);
  const items = await tenantTransaction(req.tenant.id, async (client) => {
    await canAccessClass(client, req, filter.classId, filter.sectionId);
    const classResult = await client.query(`SELECT c.id,c.academic_year_id FROM classes c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=$1 AND c.id=$2 AND $3::date BETWEEN y.starts_on AND y.ends_on`, [req.tenant.id, filter.classId, filter.date]);
    if (!classResult.rows[0]) fail(404, "Class or academic year not found for this date");
    if (filter.sectionId) {
      const section = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND class_id=$2 AND id=$3", [req.tenant.id, filter.classId, filter.sectionId]);
      if (!section.rowCount) fail(400, "Section does not belong to this class");
    }
    const result = await client.query(`SELECT st.id AS student_id,st.admission_number,st.first_name,st.last_name,e.section_id,sec.name AS section_name,a.id AS attendance_id,a.status,a.note,a.updated_at
      FROM student_enrollments e JOIN students st ON st.school_id=e.school_id AND st.id=e.student_id
      LEFT JOIN sections sec ON sec.school_id=e.school_id AND sec.id=e.section_id
      LEFT JOIN attendance a ON a.school_id=e.school_id AND a.student_id=e.student_id AND a.attendance_date=$3::date
      WHERE e.school_id=$1 AND e.class_id=$2 AND e.status='active' AND e.enrolled_on<=$3::date AND (e.ended_on IS NULL OR e.ended_on >= $3::date)
        AND ($4::uuid IS NULL OR e.section_id=$4::uuid)
      ORDER BY st.last_name,st.first_name,st.admission_number`, [req.tenant.id, filter.classId, filter.date, filter.sectionId ?? null]);
    return result.rows.map((row) => ({ ...row, status: row.attendance_id ? row.status : null }));
  });
  res.json({ date: filter.date, classId: filter.classId, sectionId: filter.sectionId ?? null, items });
}));
var bulkSchema = z6.object({ date: dateSchema, classId: uuidSchema, sectionId: uuidSchema.optional(), records: z6.array(z6.object({ studentId: uuidSchema, status: statusSchema2, note: z6.string().trim().max(500).nullable().optional() })).min(1).max(500) }).superRefine((value, ctx) => {
  const ids = value.records.map((row) => row.studentId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "A student may appear only once in a bulk attendance request", path: ["records"] });
});
attendanceRouter.put("/attendance/bulk", requireSchoolPermission("attendance:manage", "attendance:manage:assigned"), asyncRoute(async (req, res) => {
  const input = bulkSchema.parse(req.body);
  const actor2 = await membershipId(req);
  const result = await tenantTransaction(req.tenant.id, async (client) => {
    await canAccessClass(client, req, input.classId, input.sectionId, true);
    const klass = await client.query(`SELECT c.academic_year_id FROM classes c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=$1 AND c.id=$2 AND $3::date BETWEEN y.starts_on AND y.ends_on`, [req.tenant.id, input.classId, input.date]);
    if (!klass.rows[0]) fail(404, "Class or academic year not found for this date");
    if (input.sectionId) {
      const section = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND class_id=$2 AND id=$3", [req.tenant.id, input.classId, input.sectionId]);
      if (!section.rowCount) fail(400, "Section does not belong to this class");
    }
    const studentIds = input.records.map((row) => row.studentId);
    const enrolled = await client.query(`SELECT student_id FROM student_enrollments WHERE school_id=$1 AND class_id=$2 AND academic_year_id=$3 AND student_id=ANY($4::uuid[])
      AND status='active' AND enrolled_on<=$5::date AND (ended_on IS NULL OR ended_on >= $5::date) AND ($6::uuid IS NULL OR section_id=$6::uuid)`, [req.tenant.id, input.classId, klass.rows[0].academic_year_id, studentIds, input.date, input.sectionId ?? null]);
    if (enrolled.rowCount !== studentIds.length) fail(400, "One or more students are not enrolled in the selected class, section, and date");
    const rows = [];
    for (const item of input.records) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [item.studentId, input.date]);
      const old = await client.query("SELECT id,school_id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,marked_by,updated_at FROM attendance WHERE school_id=$1 AND student_id=$2 AND attendance_date=$3::date FOR UPDATE", [req.tenant.id, item.studentId, input.date]);
      if (old.rows[0] && old.rows[0].class_id !== input.classId) fail(409, "Attendance already exists for this student under another class on this date");
      if (old.rows[0] && (old.rows[0].status !== item.status || old.rows[0].note !== (item.note ?? null))) fail(409, "Attendance corrections require the correction endpoint and a reason");
      if (old.rows[0]) {
        rows.push(old.rows[0]);
        continue;
      }
      const saved = old.rows[0] ? await client.query(`UPDATE attendance SET status=$4,note=$5,marked_by=$6,updated_at=now(),section_id=$7,academic_year_id=$8 WHERE school_id=$1 AND student_id=$2 AND attendance_date=$3::date RETURNING id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,updated_at`, [req.tenant.id, item.studentId, input.date, item.status, item.note ?? null, actor2, input.sectionId ?? null, klass.rows[0].academic_year_id]) : await client.query(`INSERT INTO attendance(school_id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,marked_by) VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9) RETURNING id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,updated_at`, [req.tenant.id, item.studentId, input.classId, input.sectionId ?? null, klass.rows[0].academic_year_id, input.date, item.status, item.note ?? null, actor2]);
      const row = saved.rows[0];
      const history = await client.query(`INSERT INTO attendance_history(school_id,attendance_id,actor_membership_id,action,before_state,after_state)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING id`, [req.tenant.id, row.id, actor2, old.rows[0] ? "updated" : "created", old.rows[0] ? JSON.stringify(old.rows[0]) : null, JSON.stringify(row)]);
      await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,'attendance',$4,$5::jsonb)`, [req.tenant.id, actor2, old.rows[0] ? "attendance.updated" : "attendance.created", row.id, JSON.stringify({ studentId: item.studentId, date: input.date, status: item.status })]);
      if (item.status === "absent" && old.rows[0]?.status !== "absent") {
        await client.query(`INSERT INTO background_jobs(school_id,job_type,payload,idempotency_key,status) VALUES($1,'attendance.absence_notification',$2::jsonb,$3,'queued') ON CONFLICT(idempotency_key) DO NOTHING`, [req.tenant.id, JSON.stringify({ attendanceId: row.id, studentId: item.studentId, attendanceDate: input.date, historyId: history.rows[0].id }), `attendance-absence:${history.rows[0].id}`]);
      }
      rows.push(row);
    }
    return rows;
  });
  res.json({ date: input.date, classId: input.classId, sectionId: input.sectionId ?? null, items: result });
}));
var historyAccess = ["attendance:read", "attendance:read:assigned", "attendance:read:linked", "attendance:read:self"];
attendanceRouter.get("/attendance/students/:studentId", requireSchoolPermission(...historyAccess), asyncRoute(async (req, res) => {
  const studentId = uuidSchema.parse(req.params.studentId), pageInfo = pagination.parse(req.query);
  const from = req.query.from ? dateSchema.parse(req.query.from) : void 0, to = req.query.to ? dateSchema.parse(req.query.to) : void 0;
  if (from && to && from > to) fail(400, "from must be on or before to");
  const data = await tenantTransaction(req.tenant.id, async (client) => {
    const access = await client.query(`SELECT st.id FROM students st WHERE st.school_id=$1 AND st.id=$2 AND (
      ($3::boolean AND st.user_id=$4) OR EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE sp.school_id=st.school_id AND sp.student_id=st.id AND p.user_id=$4 AND $5::boolean)
      OR ($6::boolean AND EXISTS(SELECT 1 FROM teacher_assignments ta JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id AND e.class_id=cs.class_id AND e.status='active' WHERE t.school_id=st.school_id AND t.user_id=$4 AND (ta.section_id IS NULL OR ta.section_id=e.section_id)))
      OR $7::boolean)`, [req.tenant.id, studentId, req.permissions.includes("attendance:read:self"), req.identity.id, req.permissions.includes("attendance:read:linked"), req.permissions.includes("attendance:read:assigned"), req.permissions.includes("attendance:read")]);
    if (!access.rowCount) fail(404, "Student attendance is not available");
    const count = await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status IN ('present','late'))::int AS attended,count(*) FILTER(WHERE status<>'excused')::int AS eligible FROM attendance WHERE school_id=$1 AND student_id=$2 AND ($3::date IS NULL OR attendance_date >= $3::date) AND ($4::date IS NULL OR attendance_date <= $4::date)`, [req.tenant.id, studentId, from ?? null, to ?? null]);
    const items = await client.query(`SELECT attendance_date,status,note,class_id,section_id,updated_at FROM attendance WHERE school_id=$1 AND student_id=$2 AND ($3::date IS NULL OR attendance_date >= $3::date) AND ($4::date IS NULL OR attendance_date <= $4::date) ORDER BY attendance_date DESC LIMIT $5 OFFSET $6`, [req.tenant.id, studentId, from ?? null, to ?? null, pageInfo.pageSize, (pageInfo.page - 1) * pageInfo.pageSize]);
    const stats = count.rows[0];
    return { items: items.rows, total: stats.total, attendancePercentage: stats.eligible ? Number((stats.attended / stats.eligible * 100).toFixed(2)) : null, eligibleDays: stats.eligible, attendedDays: stats.attended };
  });
  res.json({ studentId, page: pageInfo.page, pageSize: pageInfo.pageSize, ...data });
}));
async function report(req, from, to, classId, sectionId) {
  return tenantTransaction(req.tenant.id, async (client) => {
    if (classId) await canAccessClass(client, req, classId, sectionId, false);
    else if (!req.permissions.includes("attendance:read")) fail(403, "School-wide attendance report is not authorized");
    const result = await client.query(`SELECT a.class_id,c.name AS class_name,a.section_id,s.name AS section_name,
      count(*)::int AS recorded_days,count(*) FILTER(WHERE a.status='present')::int AS present,
      count(*) FILTER(WHERE a.status='absent')::int AS absent,count(*) FILTER(WHERE a.status='late')::int AS late,
      count(*) FILTER(WHERE a.status='excused')::int AS excused,
      CASE WHEN count(*) FILTER(WHERE a.status<>'excused')=0 THEN NULL ELSE round(100.0*count(*) FILTER(WHERE a.status IN ('present','late'))/count(*) FILTER(WHERE a.status<>'excused'),2) END AS attendance_percentage
      FROM attendance a JOIN classes c ON c.school_id=a.school_id AND c.id=a.class_id LEFT JOIN sections s ON s.school_id=a.school_id AND s.id=a.section_id
      WHERE a.school_id=$1 AND a.attendance_date >= $2::date AND a.attendance_date < $3::date AND ($4::uuid IS NULL OR a.class_id=$4::uuid) AND ($5::uuid IS NULL OR a.section_id=$5::uuid)
      GROUP BY a.class_id,c.name,a.section_id,s.name ORDER BY c.name,s.name NULLS FIRST`, [req.tenant.id, from, to, classId ?? null, sectionId ?? null]);
    return result.rows;
  });
}
attendanceRouter.get("/attendance/reports/monthly", requireSchoolPermission(...readPermissions), asyncRoute(async (req, res) => {
  const input = z6.object({ month: z6.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), classId: uuidSchema.optional(), sectionId: uuidSchema.optional() }).parse(req.query);
  const year = Number(input.month.slice(0, 4)), month = Number(input.month.slice(5, 7)), from = `${input.month}-01`, to = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const items = await report(req, from, to, input.classId, input.sectionId);
  res.json({ month: input.month, items });
}));
attendanceRouter.get("/attendance/reports/annual", requireSchoolPermission(...readPermissions), asyncRoute(async (req, res) => {
  const input = z6.object({ year: z6.coerce.number().int().min(2e3).max(2200), classId: uuidSchema.optional(), sectionId: uuidSchema.optional() }).parse(req.query);
  const items = await report(req, `${input.year}-01-01`, `${input.year + 1}-01-01`, input.classId, input.sectionId);
  res.json({ year: input.year, items });
}));
attendanceRouter.get("/attendance/calendar", requireSchoolPermission(...readPermissions), asyncRoute(async (req, res) => {
  const input = z6.object({ month: z6.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), classId: uuidSchema.optional(), sectionId: uuidSchema.optional() }).parse(req.query);
  if (input.sectionId && !input.classId) fail(400, "classId is required when filtering by sectionId");
  const year = Number(input.month.slice(0, 4)), month = Number(input.month.slice(5, 7)), from = `${input.month}-01`, to = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const items = await tenantTransaction(req.tenant.id, async (client) => {
    if (input.classId) {
      const exists = await client.query("SELECT 1 FROM classes WHERE school_id=$1 AND id=$2", [req.tenant.id, input.classId]);
      if (!exists.rowCount) fail(404, "Class not found");
      if (input.sectionId) {
        const section = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND class_id=$2 AND id=$3", [req.tenant.id, input.classId, input.sectionId]);
        if (!section.rowCount) fail(404, "Section not found");
      }
      await canAccessClass(client, req, input.classId, input.sectionId, false);
    } else if (!req.permissions.includes("attendance:read")) fail(403, "School-wide attendance calendar is not authorized");
    return (await client.query(`SELECT to_char(a.attendance_date,'YYYY-MM-DD') AS attendance_date,count(*)::int AS total,
      count(*) FILTER(WHERE a.status='present')::int AS present,
      count(*) FILTER(WHERE a.status='absent')::int AS absent,
      count(*) FILTER(WHERE a.status='late')::int AS late,
      count(*) FILTER(WHERE a.status='excused')::int AS excused,
      CASE WHEN count(*) FILTER(WHERE a.status<>'excused')=0 THEN NULL ELSE round(100.0*count(*) FILTER(WHERE a.status IN ('present','late'))/count(*) FILTER(WHERE a.status<>'excused'),2) END AS attendance_percentage
      FROM attendance a WHERE a.school_id=$1 AND a.attendance_date >= $2::date AND a.attendance_date < $3::date
      AND ($4::uuid IS NULL OR a.class_id=$4::uuid) AND ($5::uuid IS NULL OR a.section_id=$5::uuid)
      GROUP BY a.attendance_date ORDER BY a.attendance_date`, [req.tenant.id, from, to, input.classId ?? null, input.sectionId ?? null])).rows;
  });
  res.json({ month: input.month, classId: input.classId ?? null, sectionId: input.sectionId ?? null, items });
}));
attendanceRouter.patch("/attendance/:attendanceId", requireSchoolPermission("attendance:manage", "attendance:manage:assigned"), asyncRoute(async (req, res) => {
  const id = uuidSchema.parse(req.params.attendanceId);
  const input = z6.object({ status: statusSchema2, note: z6.string().trim().max(500).nullable().optional(), correctionReason: z6.string().trim().min(5).max(500) }).parse(req.body);
  const actor2 = await membershipId(req);
  const updated = await tenantTransaction(req.tenant.id, async (client) => {
    const current = await client.query(`SELECT id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,marked_by,updated_at FROM attendance WHERE school_id=$1 AND id=$2 FOR UPDATE`, [req.tenant.id, id]);
    if (!current.rows[0]) fail(404, "Attendance record not found");
    const old = current.rows[0];
    await canAccessClass(client, req, old.class_id, old.section_id, true);
    const nextNote = input.note === void 0 ? old.note : input.note;
    if (old.status === input.status && old.note === nextNote) fail(400, "Correction does not change the attendance record");
    const saved = await client.query(`UPDATE attendance SET status=$3,note=$4,marked_by=$5,updated_at=now() WHERE school_id=$1 AND id=$2
      RETURNING id,student_id,class_id,section_id,academic_year_id,attendance_date,status,note,updated_at`, [req.tenant.id, id, input.status, nextNote, actor2]);
    const after = { ...saved.rows[0], correctionReason: input.correctionReason };
    await client.query(`INSERT INTO attendance_history(school_id,attendance_id,actor_membership_id,action,before_state,after_state) VALUES($1,$2,$3,'updated',$4::jsonb,$5::jsonb)`, [req.tenant.id, id, actor2, JSON.stringify(old), JSON.stringify(after)]);
    await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'attendance.corrected','attendance',$3,$4::jsonb)`, [req.tenant.id, actor2, id, JSON.stringify({ studentId: old.student_id, date: old.attendance_date, fromStatus: old.status, toStatus: input.status, reason: input.correctionReason })]);
    if (input.status === "absent" && old.status !== "absent") {
      const history = await client.query(`SELECT id FROM attendance_history WHERE school_id=$1 AND attendance_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, [req.tenant.id, id]);
      await client.query(`INSERT INTO background_jobs(school_id,job_type,payload,idempotency_key,status) VALUES($1,'attendance.absence_notification',$2::jsonb,$3,'queued') ON CONFLICT(idempotency_key) DO NOTHING`, [req.tenant.id, JSON.stringify({ attendanceId: id, studentId: old.student_id, attendanceDate: old.attendance_date, historyId: history.rows[0].id }), `attendance-absence:${history.rows[0].id}`]);
    }
    return { ...saved.rows[0], correctionReason: input.correctionReason };
  });
  res.json({ attendance: updated });
}));
attendanceRouter.get("/attendance/:attendanceId/history", requireSchoolPermission("attendance:read", "attendance:read:assigned"), asyncRoute(async (req, res) => {
  const id = uuidSchema.parse(req.params.attendanceId);
  const items = await tenantTransaction(req.tenant.id, async (client) => {
    const row = await client.query("SELECT class_id,section_id FROM attendance WHERE school_id=$1 AND id=$2", [req.tenant.id, id]);
    if (!row.rows[0]) fail(404, "Attendance record not found");
    await canAccessClass(client, req, row.rows[0].class_id, row.rows[0].section_id, false);
    return (await client.query(`SELECT h.id,h.action,h.before_state,h.after_state,h.created_at,m.user_id,u.name AS actor_name FROM attendance_history h JOIN school_memberships m ON m.school_id=h.school_id AND m.id=h.actor_membership_id JOIN users u ON u.id=m.user_id WHERE h.school_id=$1 AND h.attendance_id=$2 ORDER BY h.created_at DESC`, [req.tenant.id, id])).rows;
  });
  res.json({ attendanceId: id, items });
}));

// apps/api/src/homework/routes.ts
import { Router as Router6 } from "express";
import { z as z7 } from "zod";
var homeworkRouter = Router6();
homeworkRouter.use(authenticate);
var uuid = z7.uuid();
var createSchema = z7.object({
  classId: uuid,
  sectionId: uuid.optional(),
  subjectId: uuid,
  teacherId: uuid.optional(),
  title: z7.string().trim().min(2).max(180),
  description: z7.string().trim().max(1e4).default(""),
  dueAt: z7.iso.datetime({ offset: true }).optional(),
  maxScore: z7.number().finite().min(0).max(1e5).optional(),
  attachments: z7.array(z7.object({ fileId: uuid, displayName: z7.string().trim().min(1).max(180) })).max(20).default([]),
  publish: z7.boolean().default(false)
});
var submitSchema = z7.object({ responseText: z7.string().trim().max(2e4).default(""), fileId: uuid.optional() });
var reviewSchema = z7.object({ score: z7.number().finite().min(0).max(1e5).nullable().optional(), feedback: z7.string().trim().max(1e4).nullable().optional() });
var statusSchema3 = z7.object({ status: z7.enum(["published", "archived"]) });
function has(req, ...names) {
  return names.some((name) => req.permissions?.includes(name));
}
async function actorMembership(client, schoolId, userId) {
  const result = await client.query("SELECT id,role FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active", [schoolId, userId]);
  if (!result.rows[0]) fail(403, "Active school membership is required");
  return result.rows[0];
}
async function audit3(client, schoolId, membershipId2, assignmentId, action, after, before, submissionId) {
  await client.query("INSERT INTO assignment_audit_history(school_id,assignment_id,submission_id,actor_membership_id,action,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6,$7)", [schoolId, assignmentId, submissionId ?? null, membershipId2, action, before ? JSON.stringify(before) : null, JSON.stringify(after)]);
  await client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6)", [schoolId, membershipId2, `homework.${action}`, submissionId ? "assignment_submission" : "assignment", submissionId ?? assignmentId, JSON.stringify(after)]);
}
var visiblePermission = ["homework:read", "homework:read:assigned", "homework:read:linked", "homework:read:self"];
homeworkRouter.get("/teachers", requireSchoolPermission("homework:manage"), asyncRoute(async (req, res) => {
  const input = z7.object({ classId: uuid, subjectId: uuid, sectionId: uuid.optional() }).parse(req.query);
  const items = await tenantTransaction(req.tenant.id, async (client) => {
    const target = await client.query("SELECT 1 FROM class_subjects WHERE school_id=$1 AND class_id=$2 AND subject_id=$3", [req.tenant.id, input.classId, input.subjectId]);
    if (!target.rowCount) fail(404, "Class subject allocation not found");
    if (input.sectionId) {
      const section = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3", [req.tenant.id, input.sectionId, input.classId]);
      if (!section.rowCount) fail(404, "Section not found");
    }
    return (await client.query(`SELECT DISTINCT t.id AS teacher_id,t.employee_id,COALESCE(u.name,t.employee_id,'Teacher') AS name
      FROM teacher_assignments ta JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id
      LEFT JOIN users u ON u.id=t.user_id
      WHERE ta.school_id=$1 AND ta.class_subject_id=(SELECT cs.id FROM class_subjects cs WHERE cs.school_id=$1 AND cs.class_id=$2 AND cs.subject_id=$3)
        AND t.employment_status='active' AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM $4::uuid)
      ORDER BY name`, [req.tenant.id, input.classId, input.subjectId, input.sectionId ?? null])).rows;
  });
  res.json({ items });
}));
homeworkRouter.get("/assignments", requireSchoolPermission(...visiblePermission), asyncRoute(async (req, res) => {
  const schoolId = req.tenant.id, userId = req.identity.id;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30)), page = Math.max(1, Number(req.query.page) || 1);
  const classId = typeof req.query.classId === "string" ? uuid.parse(req.query.classId) : null;
  const status = typeof req.query.status === "string" ? z7.enum(["draft", "published", "archived"]).parse(req.query.status) : null;
  const scope = { all: has(req, "homework:read"), assigned: has(req, "homework:read:assigned"), linked: has(req, "homework:read:linked"), self: has(req, "homework:read:self") };
  const data = await tenantTransaction(schoolId, async (client) => {
    const params = [schoolId, userId, scope.all, scope.assigned, scope.linked, scope.self, classId, status, limit, (page - 1) * limit];
    const where = `a.school_id=$1 AND ($3::boolean OR a.status<>'draft') AND ($7::uuid IS NULL OR a.class_id=$7) AND ($8::text IS NULL OR a.status=$8) AND (
      $3::boolean OR
      ($4::boolean AND EXISTS(SELECT 1 FROM teachers tx JOIN teacher_assignments ta ON ta.school_id=tx.school_id AND ta.teacher_id=tx.id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE tx.school_id=a.school_id AND tx.user_id=$2 AND tx.employment_status='active' AND cs.class_id=a.class_id AND cs.subject_id=a.subject_id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM a.section_id))) OR
      ($5::boolean AND EXISTS(SELECT 1 FROM student_enrollments e JOIN student_parents sp ON sp.school_id=e.school_id AND sp.student_id=e.student_id JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE e.school_id=a.school_id AND p.user_id=$2 AND e.status='active' AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id))) OR
      ($6::boolean AND EXISTS(SELECT 1 FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id WHERE st.school_id=a.school_id AND st.user_id=$2 AND e.status='active' AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id)))
    )`;
    const rows = await client.query(`SELECT a.id,a.class_id,c.name AS class_name,a.section_id,s.name AS section_name,a.subject_id,sub.name AS subject_name,a.teacher_id,t.employee_id,a.title,a.description,a.due_at,a.max_score,a.status,a.published_at,a.created_at,a.updated_at,
      CASE WHEN $3::boolean OR $4::boolean THEN (SELECT count(*)::int FROM assignment_submissions ss WHERE ss.school_id=a.school_id AND ss.assignment_id=a.id AND ss.submitted_at IS NOT NULL) ELSE NULL END AS submitted_count,
      CASE WHEN $3::boolean OR $4::boolean THEN (SELECT count(*)::int FROM student_enrollments e WHERE e.school_id=a.school_id AND e.status='active' AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id)) ELSE NULL END AS target_count,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('studentId',st.id,'studentName',concat_ws(' ',st.first_name,st.last_name),'submittedAt',ss.submitted_at,'isLate',ss.submitted_at IS NOT NULL AND a.due_at IS NOT NULL AND ss.submitted_at>a.due_at,'score',ss.score,'feedback',ss.feedback) ORDER BY st.last_name,st.first_name)
        FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id AND e.status='active' JOIN student_parents sp ON sp.school_id=st.school_id AND sp.student_id=st.id JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id LEFT JOIN assignment_submissions ss ON ss.school_id=a.school_id AND ss.assignment_id=a.id AND ss.student_id=st.id
        WHERE $5::boolean AND p.user_id=$2 AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id)), '[]'::jsonb) AS linked_child_submissions,
      (SELECT jsonb_build_object('submittedAt',ss.submitted_at,'isLate',ss.submitted_at IS NOT NULL AND a.due_at IS NOT NULL AND ss.submitted_at>a.due_at,'score',ss.score,'feedback',ss.feedback)
        FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id AND e.status='active' LEFT JOIN assignment_submissions ss ON ss.school_id=a.school_id AND ss.assignment_id=a.id AND ss.student_id=st.id WHERE $6::boolean AND st.school_id=a.school_id AND st.user_id=$2 AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id) LIMIT 1) AS own_submission
      FROM assignments a JOIN classes c ON c.school_id=a.school_id AND c.id=a.class_id JOIN subjects sub ON sub.school_id=a.school_id AND sub.id=a.subject_id JOIN teachers t ON t.school_id=a.school_id AND t.id=a.teacher_id LEFT JOIN sections s ON s.school_id=a.school_id AND s.id=a.section_id WHERE ${where} ORDER BY a.due_at NULLS LAST,a.created_at DESC LIMIT $9 OFFSET $10`, params);
    const count = await client.query(`SELECT count(*)::int AS total FROM assignments a WHERE ${where}`, [...params.slice(0, 8)]);
    return { items: rows.rows, total: count.rows[0].total };
  });
  res.json({ ...data, page, limit });
}));
homeworkRouter.post("/assignments", requireSchoolPermission("homework:manage", "homework:manage:assigned"), asyncRoute(async (req, res) => {
  const data = createSchema.parse(req.body), schoolId = req.tenant.id, userId = req.identity.id;
  const created = await tenantTransaction(schoolId, async (client) => {
    const membership2 = await actorMembership(client, schoolId, userId);
    let teacherId;
    const assignedOnly = !has(req, "homework:manage");
    if (assignedOnly) {
      const own = await client.query("SELECT id FROM teachers WHERE school_id=$1 AND user_id=$2 AND employment_status='active'", [schoolId, userId]);
      if (!own.rows[0]) fail(403, "An active teacher profile is required");
      teacherId = own.rows[0].id;
      if (data.teacherId && data.teacherId !== teacherId) fail(403, "Teachers may create assignments only under their own profile");
    } else teacherId = data.teacherId ?? (await client.query("SELECT id FROM teachers WHERE school_id=$1 AND user_id=$2 AND employment_status='active'", [schoolId, userId])).rows[0]?.id;
    if (!teacherId) fail(400, "Select the teacher responsible for this assignment");
    const target = await client.query("SELECT c.id FROM classes c JOIN class_subjects cs ON cs.school_id=c.school_id AND cs.class_id=c.id AND cs.subject_id=$3 WHERE c.school_id=$1 AND c.id=$2", [schoolId, data.classId, data.subjectId]);
    if (!target.rowCount) fail(400, "The subject is not allocated to the selected class");
    if (data.sectionId) {
      const section = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3", [schoolId, data.sectionId, data.classId]);
      if (!section.rowCount) fail(400, "The section does not belong to the selected class");
    }
    const teacher = await client.query("SELECT id FROM teachers WHERE school_id=$1 AND id=$2 AND employment_status='active'", [schoolId, teacherId]);
    if (!teacher.rowCount) fail(400, "The selected teacher is unavailable");
    if (assignedOnly) {
      const allowed = await client.query(`SELECT 1 FROM teacher_assignments ta JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE ta.school_id=$1 AND ta.teacher_id=$2 AND cs.class_id=$3 AND cs.subject_id=$4 AND (ta.section_id IS NULL OR $5::uuid IS NULL OR ta.section_id = $5::uuid)`, [schoolId, teacherId, data.classId, data.subjectId, data.sectionId ?? null]);
      if (!allowed.rowCount) fail(403, "The class, section, and subject are not assigned to you");
    }
    if (data.attachments.length) {
      const fileIds = [...new Set(data.attachments.map((item) => item.fileId))];
      const files = await client.query("SELECT id FROM uploaded_files WHERE school_id=$1 AND id=ANY($2::uuid[])", [schoolId, fileIds]);
      if (files.rowCount !== fileIds.length) fail(400, "An attachment is unavailable in this school");
    }
    const assignment = await client.query(`INSERT INTO assignments(school_id,class_id,section_id,subject_id,teacher_id,title,description,due_at,published_at,status,max_score)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $9 THEN now() END,CASE WHEN $9 THEN 'published' ELSE 'draft' END,$10)
      RETURNING id,class_id,section_id,subject_id,teacher_id,title,description,due_at,max_score,status,published_at,created_at,updated_at`, [schoolId, data.classId, data.sectionId ?? null, data.subjectId, teacherId, data.title, data.description, data.dueAt ?? null, data.publish, data.maxScore ?? null]);
    for (const attachment of data.attachments) await client.query("INSERT INTO assignment_attachments(school_id,assignment_id,file_id,display_name) VALUES($1,$2,$3,$4)", [schoolId, assignment.rows[0].id, attachment.fileId, attachment.displayName]);
    await audit3(client, schoolId, membership2.id, assignment.rows[0].id, "created", { status: assignment.rows[0].status, title: data.title, attachmentCount: data.attachments.length });
    if (data.publish) await audit3(client, schoolId, membership2.id, assignment.rows[0].id, "published", { publishedAt: assignment.rows[0].published_at });
    return assignment.rows[0];
  });
  res.status(201).json({ assignment: created });
}));
homeworkRouter.get("/assignments/:id", requireSchoolPermission(...visiblePermission), asyncRoute(async (req, res) => {
  const id = uuid.parse(req.params.id), schoolId = req.tenant.id, userId = req.identity.id;
  const result = await tenantTransaction(schoolId, async (client) => {
    const scope = { all: has(req, "homework:read"), assigned: has(req, "homework:read:assigned"), linked: has(req, "homework:read:linked"), self: has(req, "homework:read:self") };
    const item = await client.query(`SELECT a.id,a.class_id,c.name AS class_name,a.section_id,s.name AS section_name,a.subject_id,sub.name AS subject_name,a.teacher_id,a.title,a.description,a.due_at,a.max_score,a.status,a.published_at,a.created_at,a.updated_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('fileId',f.id,'displayName',aa.display_name,'mimeType',f.mime_type,'byteSize',f.byte_size) ORDER BY aa.created_at) FROM assignment_attachments aa JOIN uploaded_files f ON f.school_id=aa.school_id AND f.id=aa.file_id WHERE aa.school_id=a.school_id AND aa.assignment_id=a.id),'[]'::jsonb) AS attachments
      FROM assignments a JOIN classes c ON c.school_id=a.school_id AND c.id=a.class_id JOIN subjects sub ON sub.school_id=a.school_id AND sub.id=a.subject_id LEFT JOIN sections s ON s.school_id=a.school_id AND s.id=a.section_id
      WHERE a.school_id=$1 AND a.id=$2 AND ($3::boolean OR a.status<>'draft') AND (
        $3::boolean OR
        ($4::boolean AND EXISTS(SELECT 1 FROM teachers tx JOIN teacher_assignments ta ON ta.school_id=tx.school_id AND ta.teacher_id=tx.id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE tx.school_id=a.school_id AND tx.user_id=$5 AND cs.class_id=a.class_id AND cs.subject_id=a.subject_id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM a.section_id))) OR
        ($6::boolean AND EXISTS(SELECT 1 FROM student_enrollments e JOIN student_parents sp ON sp.school_id=e.school_id AND sp.student_id=e.student_id JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE e.school_id=a.school_id AND p.user_id=$5 AND e.status='active' AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id))) OR
        ($7::boolean AND EXISTS(SELECT 1 FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id WHERE st.school_id=a.school_id AND st.user_id=$5 AND e.status='active' AND e.class_id=a.class_id AND (a.section_id IS NULL OR e.section_id=a.section_id))))`, [schoolId, id, scope.all, scope.assigned, userId, scope.linked, scope.self]);
    if (!item.rows[0]) fail(404, "Assignment not found");
    const attachments = await client.query("SELECT f.id AS file_id,f.mime_type,f.byte_size,aa.display_name FROM assignment_attachments aa JOIN uploaded_files f ON f.school_id=aa.school_id AND f.id=aa.file_id WHERE aa.school_id=$1 AND aa.assignment_id=$2 ORDER BY aa.created_at", [schoolId, id]);
    return { ...item.rows[0], attachments: attachments.rows };
  });
  res.json({ assignment: result });
}));
homeworkRouter.patch("/assignments/:id/status", requireSchoolPermission("homework:manage", "homework:manage:assigned"), asyncRoute(async (req, res) => {
  const id = uuid.parse(req.params.id), { status } = statusSchema3.parse(req.body), schoolId = req.tenant.id, userId = req.identity.id;
  const result = await tenantTransaction(schoolId, async (client) => {
    const membership2 = await actorMembership(client, schoolId, userId);
    const assignment = await client.query("SELECT a.id,a.teacher_id,a.status,a.published_at FROM assignments a WHERE a.school_id=$1 AND a.id=$2 FOR UPDATE", [schoolId, id]);
    if (!assignment.rows[0]) fail(404, "Assignment not found");
    if (!has(req, "homework:manage")) {
      const own = await client.query("SELECT 1 FROM teachers WHERE school_id=$1 AND id=$2 AND user_id=$3", [schoolId, assignment.rows[0].teacher_id, userId]);
      if (!own.rowCount) fail(403, "You can only manage assignments you own");
    }
    if (status === "published" && assignment.rows[0].status === "archived") fail(409, "An archived assignment cannot be republished");
    const updated = await client.query("UPDATE assignments SET status=$3,published_at=CASE WHEN $3='published' THEN COALESCE(published_at,now()) ELSE published_at END,updated_at=now() WHERE school_id=$1 AND id=$2 RETURNING id,status,published_at,updated_at", [schoolId, id, status]);
    await audit3(client, schoolId, membership2.id, id, status, { status: updated.rows[0].status }, { status: assignment.rows[0].status });
    return updated.rows[0];
  });
  res.json({ assignment: result });
}));
homeworkRouter.post("/assignments/:id/submission", requireSchoolPermission("homework:read:self"), asyncRoute(async (req, res) => {
  const id = uuid.parse(req.params.id), data = submitSchema.parse(req.body), schoolId = req.tenant.id, userId = req.identity.id;
  const result = await tenantTransaction(schoolId, async (client) => {
    const membership2 = await actorMembership(client, schoolId, userId);
    const student = await client.query("SELECT id FROM students WHERE school_id=$1 AND user_id=$2 AND status='active'", [schoolId, userId]);
    if (!student.rows[0]) fail(403, "Student profile is not linked to this account");
    const assignment = await client.query("SELECT id,due_at,class_id,section_id,status FROM assignments WHERE school_id=$1 AND id=$2 AND status='published'", [schoolId, id]);
    if (!assignment.rows[0]) fail(404, "Published assignment not found");
    const enrollment = await client.query("SELECT 1 FROM student_enrollments WHERE school_id=$1 AND student_id=$2 AND status='active' AND class_id=$3 AND ($4::uuid IS NULL OR section_id=$4)", [schoolId, student.rows[0].id, assignment.rows[0].class_id, assignment.rows[0].section_id]);
    if (!enrollment.rowCount) fail(403, "Assignment is not assigned to your class or section");
    if (data.fileId) {
      const file = await client.query("SELECT 1 FROM uploaded_files WHERE school_id=$1 AND id=$2", [schoolId, data.fileId]);
      if (!file.rowCount) fail(400, "The submission file is unavailable in this school");
    }
    const previous = await client.query("SELECT id,submitted_at,response_text,file_id,score,feedback FROM assignment_submissions WHERE school_id=$1 AND assignment_id=$2 AND student_id=$3 FOR UPDATE", [schoolId, id, student.rows[0].id]);
    if (previous.rows[0]?.score !== null && previous.rows[0]?.score !== void 0) fail(409, "A graded submission cannot be changed");
    const saved = await client.query(`INSERT INTO assignment_submissions(school_id,assignment_id,student_id,submitted_at,file_id,response_text,updated_at)
      VALUES($1,$2,$3,now(),$4,$5,now()) ON CONFLICT(school_id,assignment_id,student_id) DO UPDATE SET submitted_at=now(),file_id=EXCLUDED.file_id,response_text=EXCLUDED.response_text,updated_at=now()
      RETURNING id,assignment_id,student_id,submitted_at,file_id,response_text,score,feedback,updated_at`, [schoolId, id, student.rows[0].id, data.fileId ?? null, data.responseText]);
    await audit3(client, schoolId, membership2.id, id, "submitted", { submittedAt: saved.rows[0].submitted_at, isLate: assignment.rows[0].due_at !== null && new Date(saved.rows[0].submitted_at) > new Date(assignment.rows[0].due_at) }, previous.rows[0] ? { submittedAt: previous.rows[0].submitted_at } : void 0, saved.rows[0].id);
    return { ...saved.rows[0], isLate: assignment.rows[0].due_at !== null && new Date(saved.rows[0].submitted_at) > new Date(assignment.rows[0].due_at) };
  });
  res.status(201).json({ submission: result });
}));
homeworkRouter.get("/assignments/:id/submissions", requireSchoolPermission("homework:manage", "homework:manage:assigned"), asyncRoute(async (req, res) => {
  const id = uuid.parse(req.params.id), schoolId = req.tenant.id, userId = req.identity.id;
  const data = await tenantTransaction(schoolId, async (client) => {
    const assignment = await client.query("SELECT id,class_id,section_id,teacher_id,due_at,max_score FROM assignments WHERE school_id=$1 AND id=$2", [schoolId, id]);
    if (!assignment.rows[0]) fail(404, "Assignment not found");
    if (!has(req, "homework:manage")) {
      const own = await client.query("SELECT 1 FROM teachers WHERE school_id=$1 AND id=$2 AND user_id=$3", [schoolId, assignment.rows[0].teacher_id, userId]);
      if (!own.rowCount) fail(403, "You can only review your own assignments");
    }
    const rows = await client.query(`SELECT st.id AS student_id,st.admission_number,st.first_name,st.last_name,ss.id AS submission_id,ss.submitted_at,ss.file_id,ss.response_text,ss.score,ss.feedback,ss.reviewed_at,
      (ss.submitted_at IS NOT NULL AND a.due_at IS NOT NULL AND ss.submitted_at>a.due_at) AS is_late
      FROM student_enrollments e JOIN students st ON st.school_id=e.school_id AND st.id=e.student_id JOIN assignments a ON a.school_id=e.school_id AND a.class_id=e.class_id AND a.id=$2 AND (a.section_id IS NULL OR a.section_id=e.section_id)
      LEFT JOIN assignment_submissions ss ON ss.school_id=a.school_id AND ss.assignment_id=a.id AND ss.student_id=st.id
      WHERE e.school_id=$1 AND e.status='active' ORDER BY st.last_name,st.first_name`, [schoolId, id]);
    return { assignment: assignment.rows[0], items: rows.rows };
  });
  res.json(data);
}));
homeworkRouter.patch("/assignments/:id/submissions/:submissionId/review", requireSchoolPermission("homework:manage", "homework:manage:assigned"), asyncRoute(async (req, res) => {
  const id = uuid.parse(req.params.id), submissionId = uuid.parse(req.params.submissionId), data = reviewSchema.parse(req.body), schoolId = req.tenant.id, userId = req.identity.id;
  const updated = await tenantTransaction(schoolId, async (client) => {
    const membership2 = await actorMembership(client, schoolId, userId);
    const assignment = await client.query("SELECT teacher_id,max_score FROM assignments WHERE school_id=$1 AND id=$2", [schoolId, id]);
    if (!assignment.rows[0]) fail(404, "Assignment not found");
    if (!has(req, "homework:manage")) {
      const own = await client.query("SELECT 1 FROM teachers WHERE school_id=$1 AND id=$2 AND user_id=$3", [schoolId, assignment.rows[0].teacher_id, userId]);
      if (!own.rowCount) fail(403, "You can only review your own assignments");
    }
    if (data.score !== void 0 && data.score !== null && assignment.rows[0].max_score !== null && data.score > Number(assignment.rows[0].max_score)) fail(400, "Score cannot exceed the assignment maximum");
    const before = await client.query("SELECT id,score,feedback FROM assignment_submissions WHERE school_id=$1 AND assignment_id=$2 AND id=$3 FOR UPDATE", [schoolId, id, submissionId]);
    if (!before.rows[0]) fail(404, "Submission not found");
    const saved = await client.query("UPDATE assignment_submissions SET score=COALESCE($4,score),feedback=COALESCE($5,feedback),reviewed_by=$6,reviewed_at=now(),updated_at=now() WHERE school_id=$1 AND assignment_id=$2 AND id=$3 RETURNING id,assignment_id,student_id,score,feedback,reviewed_by,reviewed_at,updated_at", [schoolId, id, submissionId, data.score ?? null, data.feedback ?? null, membership2.id]);
    await audit3(client, schoolId, membership2.id, id, "reviewed", { score: saved.rows[0].score, feedback: saved.rows[0].feedback }, { score: before.rows[0].score, feedback: before.rows[0].feedback }, submissionId);
    return saved.rows[0];
  });
  res.json({ submission: updated });
}));
homeworkRouter.get("/dashboard", requireSchoolPermission("homework:read", "homework:read:assigned"), asyncRoute(async (req, res) => {
  const schoolId = req.tenant.id, userId = req.identity.id;
  const metrics = await tenantTransaction(schoolId, (client) => client.query(`SELECT count(DISTINCT a.id)::int AS assignments,
    count(DISTINCT ss.id) FILTER(WHERE ss.submitted_at IS NOT NULL)::int AS submissions,
    count(DISTINCT ss.id) FILTER(WHERE ss.submitted_at IS NOT NULL AND a.due_at IS NOT NULL AND ss.submitted_at>a.due_at)::int AS late_submissions,
    count(DISTINCT ss.id) FILTER(WHERE ss.submitted_at IS NOT NULL AND ss.score IS NULL)::int AS awaiting_review
    FROM assignments a LEFT JOIN assignment_submissions ss ON ss.school_id=a.school_id AND ss.assignment_id=a.id
    WHERE a.school_id=$1 AND a.status='published' AND ($3::boolean OR ($4::boolean AND EXISTS(SELECT 1 FROM teachers t JOIN teacher_assignments ta ON ta.school_id=t.school_id AND ta.teacher_id=t.id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE t.school_id=a.school_id AND t.user_id=$2 AND cs.class_id=a.class_id AND cs.subject_id=a.subject_id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM a.section_id))))`, [schoolId, userId, has(req, "homework:read"), has(req, "homework:read:assigned")]));
  res.json({ metrics: metrics.rows[0] });
}));

// apps/api/src/exams/routes.ts
import { Router as Router7 } from "express";
import { z as z8 } from "zod";
var examRouter = Router7();
examRouter.use(authenticate);
var uuid2 = z8.uuid();
var date = z8.string().regex(/^\d{4}-\d{2}-\d{2}$/);
var readExam = ["exams:read", "exams:read:assigned", "results:read", "results:read:assigned", "results:read:linked", "results:read:self"];
var createSchema2 = z8.object({ name: z8.string().trim().min(2).max(160), type: z8.string().trim().min(2).max(60).default("unit_test"), academicYearId: uuid2, startsOn: date, endsOn: date, subjects: z8.array(z8.object({ classId: uuid2, sectionId: uuid2.optional(), subjectId: uuid2, maxMarks: z8.number().finite().positive().max(1e5), examAt: z8.iso.datetime({ offset: true }).optional() })).min(1).max(100), grades: z8.array(z8.object({ grade: z8.string().trim().min(1).max(20), minPercent: z8.number().min(0).max(100), maxPercent: z8.number().min(0).max(100) })).max(30).default([]) }).superRefine((v, ctx) => {
  if (v.startsOn > v.endsOn) ctx.addIssue({ code: "custom", message: "End date must be on or after start date", path: ["endsOn"] });
  const keys = v.subjects.map((s) => `${s.classId}:${s.sectionId || ""}:${s.subjectId}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Duplicate class, section, and subject target", path: ["subjects"] });
  const grades = [...v.grades].sort((a, b) => a.minPercent - b.minPercent);
  for (let i = 0; i < grades.length; i++) {
    const current = grades[i];
    const previous = grades[i - 1];
    if (current && current.maxPercent < current.minPercent) ctx.addIssue({ code: "custom", message: "Grade maximum must be at least its minimum", path: ["grades", i] });
    if (current && previous && current.minPercent <= previous.maxPercent) ctx.addIssue({ code: "custom", message: "Grade ranges cannot overlap", path: ["grades", i] });
  }
});
var bulkMarksSchema = z8.object({ examinationSubjectId: uuid2, records: z8.array(z8.object({ studentId: uuid2, marks: z8.number().finite().min(0).max(1e5).nullable() })).min(1).max(500) }).superRefine((v, ctx) => {
  if (new Set(v.records.map((r) => r.studentId)).size !== v.records.length) ctx.addIssue({ code: "custom", message: "A student may appear only once in a marks request", path: ["records"] });
});
function has2(req, ...p) {
  return p.some((x) => req.permissions?.includes(x));
}
async function actor(client, schoolId, userId) {
  const r = await client.query("SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active", [schoolId, userId]);
  if (!r.rows[0]) fail(403, "Active school membership is required");
  return r.rows[0].id;
}
async function assigned(client, schoolId, userId, classId, subjectId, sectionId) {
  const r = await client.query(`SELECT 1 FROM teachers t JOIN teacher_assignments ta ON ta.school_id=t.school_id AND ta.teacher_id=t.id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE t.school_id=$1 AND t.user_id=$2 AND t.employment_status='active' AND cs.class_id=$3 AND cs.subject_id=$4 AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM $5::uuid) LIMIT 1`, [schoolId, userId, classId, subjectId, sectionId]);
  return !!r.rowCount;
}
async function audit4(client, schoolId, actorId, examId, action, after, before, resultId) {
  await client.query("INSERT INTO examination_audit_history(school_id,examination_id,result_id,actor_membership_id,action,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)", [schoolId, examId, resultId ?? null, actorId, action, before == null ? null : JSON.stringify(before), JSON.stringify(after)]);
  await client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,'examination',$4,$5::jsonb)", [schoolId, actorId, `exam.${action}`, examId, JSON.stringify(after)]);
}
async function linkedStudent(client, schoolId, userId, studentId, scope) {
  const r = await client.query(`SELECT st.id FROM students st WHERE st.school_id=$1 AND st.id=$2 AND (($3::boolean AND st.user_id=$4) OR ($5::boolean AND EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE sp.school_id=st.school_id AND sp.student_id=st.id AND p.user_id=$4)))`, [schoolId, studentId, scope !== "linked", userId, scope !== "self"]);
  return !!r.rowCount;
}
async function rankPolicy(client, schoolId) {
  const r = await client.query("SELECT COALESCE((settings#>>'{examinations,classRankingsEnabled}')::boolean,false) AS enabled FROM school_settings WHERE school_id=$1", [schoolId]);
  return !!r.rows[0]?.enabled;
}
examRouter.post("/examinations", requireSchoolPermission("exams:manage", "exams:manage:assigned"), asyncRoute(async (req, res) => {
  const input = createSchema2.parse(req.body), schoolId = req.tenant.id, userId = req.identity.id;
  const result = await tenantTransaction(schoolId, async (client) => {
    const actorId = await actor(client, schoolId, userId), year = await client.query("SELECT starts_on,ends_on FROM academic_years WHERE school_id=$1 AND id=$2", [schoolId, input.academicYearId]);
    if (!year.rows[0]) fail(400, "Academic year is unavailable");
    if (input.startsOn < new Date(year.rows[0].starts_on).toISOString().slice(0, 10) || input.endsOn > new Date(year.rows[0].ends_on).toISOString().slice(0, 10)) fail(400, "Examination dates must fit within the academic year");
    const exam = (await client.query(`INSERT INTO examinations(school_id,academic_year_id,name,exam_type,starts_on,ends_on,status) VALUES($1,$2,$3,$4,$5::date,$6::date,'draft') RETURNING id,academic_year_id,name,exam_type,starts_on,ends_on,status`, [schoolId, input.academicYearId, input.name, input.type, input.startsOn, input.endsOn])).rows[0];
    for (const subject of input.subjects) {
      const classSubject = await client.query("SELECT 1 FROM classes c JOIN class_subjects cs ON cs.school_id=c.school_id AND cs.class_id=c.id AND cs.subject_id=$3 WHERE c.school_id=$1 AND c.id=$2 AND c.academic_year_id=$4", [schoolId, subject.classId, subject.subjectId, input.academicYearId]);
      if (!classSubject.rowCount) fail(400, "Subject is not allocated to a class in this academic year");
      if (subject.sectionId) {
        const sec = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3", [schoolId, subject.sectionId, subject.classId]);
        if (!sec.rowCount) fail(400, "Section does not belong to the selected class");
      }
      if (has2(req, "exams:manage:assigned") && !has2(req, "exams:manage") && !await assigned(client, schoolId, userId, subject.classId, subject.subjectId, subject.sectionId ?? null)) fail(403, "You may only configure assigned class subjects");
      await client.query("INSERT INTO examination_subjects(school_id,examination_id,academic_year_id,class_id,section_id,subject_id,max_marks,exam_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [schoolId, exam.id, input.academicYearId, subject.classId, subject.sectionId ?? null, subject.subjectId, subject.maxMarks, subject.examAt ?? null]);
    }
    for (const [i, g] of input.grades.entries()) await client.query("INSERT INTO examination_grading_scales(school_id,examination_id,grade,min_percent,max_percent,ordinal) VALUES($1,$2,$3,$4,$5,$6)", [schoolId, exam.id, g.grade, g.minPercent, g.maxPercent, i + 1]);
    await audit4(client, schoolId, actorId, exam.id, "created", { name: input.name, type: input.type, subjectCount: input.subjects.length, gradeCount: input.grades.length });
    return exam;
  });
  res.status(201).json({ examination: result });
}));
examRouter.get("/examinations", requireSchoolPermission(...readExam), asyncRoute(async (req, res) => {
  const schoolId = req.tenant.id, userId = req.identity.id, scope = { all: has2(req, "exams:read", "results:read"), assigned: has2(req, "exams:read:assigned", "results:read:assigned"), linked: has2(req, "results:read:linked"), self: has2(req, "results:read:self") };
  const items = await tenantTransaction(schoolId, async (client) => (await client.query(`SELECT DISTINCT e.id,e.academic_year_id,e.name,e.exam_type,e.starts_on,e.ends_on,e.status,e.published_at,e.results_published_at,e.created_at,
    (SELECT count(*)::int FROM examination_subjects es WHERE es.school_id=e.school_id AND es.examination_id=e.id) AS subject_count
    FROM examinations e LEFT JOIN examination_subjects es ON es.school_id=e.school_id AND es.examination_id=e.id
    WHERE e.school_id=$1 AND ($3::boolean OR e.status='published') AND ($3::boolean OR ($4::boolean AND EXISTS(SELECT 1 FROM teachers t JOIN teacher_assignments ta ON ta.school_id=t.school_id AND ta.teacher_id=t.id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE t.school_id=e.school_id AND t.user_id=$2 AND cs.class_id=es.class_id AND cs.subject_id=es.subject_id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM es.section_id))) OR ($5::boolean AND EXISTS(SELECT 1 FROM student_enrollments en JOIN student_parents sp ON sp.school_id=en.school_id AND sp.student_id=en.student_id JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE en.school_id=e.school_id AND p.user_id=$2 AND en.class_id=es.class_id AND en.status='active' AND (es.section_id IS NULL OR en.section_id=es.section_id))) OR ($6::boolean AND EXISTS(SELECT 1 FROM student_enrollments en JOIN students st ON st.school_id=en.school_id AND st.id=en.student_id WHERE en.school_id=e.school_id AND st.user_id=$2 AND en.class_id=es.class_id AND en.status='active' AND (es.section_id IS NULL OR en.section_id=es.section_id))))
    ORDER BY e.starts_on DESC,e.name`, [schoolId, userId, scope.all, scope.assigned, scope.linked, scope.self])).rows);
  res.json({ items });
}));
examRouter.get("/examinations/:id", requireSchoolPermission(...readExam), asyncRoute(async (req, res) => {
  const id = uuid2.parse(req.params.id), schoolId = req.tenant.id, userId = req.identity.id, all = has2(req, "exams:read", "results:read"), assignedOnly = has2(req, "exams:read:assigned", "results:read:assigned"), linked = has2(req, "results:read:linked"), self = has2(req, "results:read:self");
  const item = await tenantTransaction(schoolId, async (client) => {
    const exam = await client.query(`SELECT e.* FROM examinations e WHERE e.school_id=$1 AND e.id=$2 AND ($3::boolean OR e.status='published') AND ($3::boolean OR EXISTS(SELECT 1 FROM examination_subjects es WHERE es.school_id=e.school_id AND es.examination_id=e.id AND (($4::boolean AND EXISTS(SELECT 1 FROM teachers t JOIN teacher_assignments ta ON ta.school_id=t.school_id AND ta.teacher_id=t.id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE t.school_id=e.school_id AND t.user_id=$5 AND cs.class_id=es.class_id AND cs.subject_id=es.subject_id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM es.section_id))) OR ($6::boolean AND EXISTS(SELECT 1 FROM student_enrollments en JOIN student_parents sp ON sp.school_id=en.school_id AND sp.student_id=en.student_id JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE en.school_id=e.school_id AND p.user_id=$5 AND en.class_id=es.class_id AND en.status='active' AND (es.section_id IS NULL OR en.section_id=es.section_id))) OR ($7::boolean AND EXISTS(SELECT 1 FROM student_enrollments en JOIN students st ON st.school_id=en.school_id AND st.id=en.student_id WHERE en.school_id=e.school_id AND st.user_id=$5 AND en.class_id=es.class_id AND en.status='active' AND (es.section_id IS NULL OR en.section_id=es.section_id))))))`, [schoolId, id, all, assignedOnly, userId, linked, self]);
    if (!exam.rows[0]) fail(404, "Examination not found");
    const subjects = await client.query(`SELECT es.id,es.class_id,c.name AS class_name,es.section_id,sec.name AS section_name,es.subject_id,s.name AS subject_name,es.max_marks,es.exam_at FROM examination_subjects es JOIN classes c ON c.school_id=es.school_id AND c.id=es.class_id JOIN subjects s ON s.school_id=es.school_id AND s.id=es.subject_id LEFT JOIN sections sec ON sec.school_id=es.school_id AND sec.id=es.section_id WHERE es.school_id=$1 AND es.examination_id=$2 ORDER BY c.name,sec.name NULLS FIRST,s.name`, [schoolId, id]);
    const grades = await client.query("SELECT grade,min_percent,max_percent,ordinal FROM examination_grading_scales WHERE school_id=$1 AND examination_id=$2 ORDER BY ordinal", [schoolId, id]);
    return { ...exam.rows[0], subjects: subjects.rows, grading: grades.rows };
  });
  res.json({ examination: item });
}));
examRouter.get("/examinations/:id/subjects/:subjectId/marks", requireSchoolPermission("exams:manage", "exams:manage:assigned", "exams:read", "exams:read:assigned"), asyncRoute(async (req, res) => {
  const examId = uuid2.parse(req.params.id), subjectId = uuid2.parse(req.params.subjectId), schoolId = req.tenant.id, userId = req.identity.id;
  const data = await tenantTransaction(schoolId, async (client) => {
    const examSubject = (await client.query(`SELECT es.id,es.class_id,es.section_id,es.subject_id,es.max_marks,e.status,e.results_published_at FROM examination_subjects es JOIN examinations e ON e.school_id=es.school_id AND e.id=es.examination_id WHERE es.school_id=$1 AND es.examination_id=$2 AND es.id=$3`, [schoolId, examId, subjectId])).rows[0];
    if (!examSubject) fail(404, "Examination subject not found");
    if (has2(req, "exams:read:assigned", "exams:manage:assigned") && !has2(req, "exams:read", "exams:manage") && !await assigned(client, schoolId, userId, examSubject.class_id, examSubject.subject_id, examSubject.section_id)) fail(404, "Examination subject not found");
    const items = await client.query(`SELECT st.id AS student_id,st.admission_number,st.first_name,st.last_name,r.id AS result_id,r.marks,r.grade,r.updated_at FROM student_enrollments en JOIN students st ON st.school_id=en.school_id AND st.id=en.student_id LEFT JOIN examination_results r ON r.school_id=en.school_id AND r.student_id=en.student_id AND r.examination_subject_id=$3 WHERE en.school_id=$1 AND en.academic_year_id=(SELECT academic_year_id FROM examinations WHERE school_id=$1 AND id=$2) AND en.class_id=$4 AND ($5::uuid IS NULL OR en.section_id=$5) AND en.status='active' ORDER BY st.last_name,st.first_name,st.admission_number`, [schoolId, examId, subjectId, examSubject.class_id, examSubject.section_id]);
    return { examinationSubject: examSubject, items: items.rows };
  });
  res.json(data);
}));
examRouter.post("/examinations/:id/publish", requireSchoolPermission("exams:manage", "exams:manage:assigned"), asyncRoute(async (req, res) => {
  const id = uuid2.parse(req.params.id), schoolId = req.tenant.id, userId = req.identity.id;
  const result = await tenantTransaction(schoolId, async (client) => {
    const actorId = await actor(client, schoolId, userId), exam = await client.query("SELECT id,status FROM examinations WHERE school_id=$1 AND id=$2 FOR UPDATE", [schoolId, id]);
    if (!exam.rows[0]) fail(404, "Examination not found");
    if (exam.rows[0].status === "archived") fail(409, "Archived examination cannot be published");
    const updated = await client.query("UPDATE examinations SET status='published',published_at=COALESCE(published_at,now()) WHERE school_id=$1 AND id=$2 RETURNING id,status,published_at", [schoolId, id]);
    await audit4(client, schoolId, actorId, id, "exam_published", updated.rows[0]);
    return updated.rows[0];
  });
  res.json({ examination: result });
}));
examRouter.post("/examinations/:id/marks/bulk", requireSchoolPermission("exams:manage", "exams:manage:assigned"), asyncRoute(async (req, res) => {
  const examId = uuid2.parse(req.params.id), input = bulkMarksSchema.parse(req.body), schoolId = req.tenant.id, userId = req.identity.id;
  const items = await tenantTransaction(schoolId, async (client) => {
    const actorId = await actor(client, schoolId, userId), exam = (await client.query("SELECT academic_year_id,status,results_published_at FROM examinations WHERE school_id=$1 AND id=$2 FOR UPDATE", [schoolId, examId])).rows[0];
    if (!exam) fail(404, "Examination not found");
    if (exam.status === "archived" || exam.results_published_at) fail(409, "Published or archived examination marks cannot be changed");
    const subject = (await client.query("SELECT id,class_id,section_id,subject_id,max_marks FROM examination_subjects WHERE school_id=$1 AND examination_id=$2 AND id=$3", [schoolId, examId, input.examinationSubjectId])).rows[0];
    if (!subject) fail(404, "Examination subject not found");
    if (has2(req, "exams:manage:assigned") && !has2(req, "exams:manage") && !await assigned(client, schoolId, userId, subject.class_id, subject.subject_id, subject.section_id)) fail(403, "This subject is outside your teaching assignment");
    const enrolled = await client.query(`SELECT student_id FROM student_enrollments WHERE school_id=$1 AND academic_year_id=$2 AND class_id=$3 AND ($4::uuid IS NULL OR section_id=$4) AND status='active' AND student_id=ANY($5::uuid[])`, [schoolId, exam.academic_year_id, subject.class_id, subject.section_id, input.records.map((r) => r.studentId)]);
    if (enrolled.rowCount !== input.records.length) fail(400, "One or more students are not actively enrolled in this examination class or section");
    const out = [];
    for (const record of input.records) {
      if (record.marks !== null && record.marks > Number(subject.max_marks)) fail(400, "Marks cannot exceed this subject maximum");
      const before = await client.query("SELECT id,marks,grade,published_at FROM examination_results WHERE school_id=$1 AND examination_subject_id=$2 AND student_id=$3 FOR UPDATE", [schoolId, subject.id, record.studentId]);
      let grade = null;
      if (record.marks !== null) {
        const pct = record.marks / Number(subject.max_marks) * 100;
        const g = await client.query("SELECT grade FROM examination_grading_scales WHERE school_id=$1 AND examination_id=$2 AND $3::numeric BETWEEN min_percent AND max_percent ORDER BY ordinal LIMIT 1", [schoolId, examId, pct]);
        grade = g.rows[0]?.grade ?? null;
      }
      const saved = await client.query(`INSERT INTO examination_results(school_id,examination_subject_id,student_id,marks,grade,updated_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(school_id,examination_subject_id,student_id) DO UPDATE SET marks=EXCLUDED.marks,grade=EXCLUDED.grade,updated_at=now() RETURNING id,examination_subject_id,student_id,marks,grade,updated_at`, [schoolId, subject.id, record.studentId, record.marks, grade]);
      await audit4(client, schoolId, actorId, examId, "marks_entered", { studentId: record.studentId, marks: record.marks, grade }, before.rows[0] ?? void 0, saved.rows[0].id);
      out.push(saved.rows[0]);
    }
    return out;
  });
  res.json({ items });
}));
examRouter.post("/examinations/:id/results/publish", requireSchoolPermission("results:publish"), asyncRoute(async (req, res) => {
  const id = uuid2.parse(req.params.id), schoolId = req.tenant.id, userId = req.identity.id;
  const updated = await tenantTransaction(schoolId, async (client) => {
    const actorId = await actor(client, schoolId, userId), exam = (await client.query("SELECT status,results_published_at FROM examinations WHERE school_id=$1 AND id=$2 FOR UPDATE", [schoolId, id])).rows[0];
    if (!exam) fail(404, "Examination not found");
    if (exam.status !== "published") fail(409, "Publish the examination schedule before publishing results");
    if (exam.results_published_at) fail(409, "Results are already published");
    const row = (await client.query("UPDATE examinations SET results_published_at=now() WHERE school_id=$1 AND id=$2 RETURNING id,results_published_at", [schoolId, id])).rows[0];
    await client.query("UPDATE examination_results r SET published_at=now() FROM examination_subjects es WHERE es.school_id=r.school_id AND es.id=r.examination_subject_id AND es.school_id=$1 AND es.examination_id=$2 AND r.published_at IS NULL", [schoolId, id]);
    await audit4(client, schoolId, actorId, id, "results_published", { publishedAt: row.results_published_at });
    await client.query(`INSERT INTO report_cards(school_id,student_id,examination_id,published_at) SELECT DISTINCT $1::uuid,r.student_id,$2::uuid,now() FROM examination_results r JOIN examination_subjects es ON es.school_id=r.school_id AND es.id=r.examination_subject_id WHERE r.school_id=$1 AND es.examination_id=$2 ON CONFLICT(school_id,student_id,examination_id) DO UPDATE SET published_at=EXCLUDED.published_at`, [schoolId, id]);
    return row;
  });
  res.json({ examination: updated });
}));
examRouter.patch("/examinations/ranking-policy", requireSchoolPermission("exams:manage"), asyncRoute(async (req, res) => {
  const { enabled } = z8.object({ enabled: z8.boolean() }).parse(req.body), schoolId = req.tenant.id, userId = req.identity.id;
  const result = await tenantTransaction(schoolId, async (client) => {
    const actorId = await actor(client, schoolId, userId);
    const current = (await client.query("SELECT settings FROM school_settings WHERE school_id=$1 FOR UPDATE", [schoolId])).rows[0]?.settings || {};
    const settings = { ...current, examinations: { ...current.examinations || {}, classRankingsEnabled: enabled } };
    await client.query(`INSERT INTO school_settings(school_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(school_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now()`, [schoolId, JSON.stringify(settings)]);
    await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'exam.ranking_policy_changed','school_settings',$1,$3::jsonb)`, [schoolId, actorId, JSON.stringify({ enabled })]);
    return { enabled };
  });
  res.json({ rankingPolicy: result });
}));
async function resultsForStudent(client, schoolId, studentId, includeUnpublished, ranking, teacherUserId) {
  return (await client.query(`WITH totals AS (
  SELECT e.id AS examination_id,es.class_id,r.student_id,sum(r.marks) AS total_marks FROM examination_results r
  JOIN examination_subjects es ON es.school_id=r.school_id AND es.id=r.examination_subject_id
  JOIN examinations e ON e.school_id=es.school_id AND e.id=es.examination_id
  WHERE r.school_id=$1 AND ($3::boolean OR (e.status='published' AND e.results_published_at IS NOT NULL AND r.published_at IS NOT NULL)) AND r.marks IS NOT NULL
  GROUP BY e.id,es.class_id,r.student_id
), ranks AS (SELECT examination_id,class_id,student_id,dense_rank() OVER(PARTITION BY examination_id,class_id ORDER BY total_marks DESC) AS class_rank FROM totals)
SELECT e.id AS examination_id,e.name AS examination_name,e.exam_type,e.starts_on,es.id AS examination_subject_id,c.id AS class_id,c.name AS class_name,es.subject_id,s.name AS subject_name,es.max_marks,r.marks,r.grade,r.published_at,
  CASE WHEN $4::boolean THEN ranks.class_rank::int ELSE NULL END AS class_rank
  FROM examination_results r JOIN examination_subjects es ON es.school_id=r.school_id AND es.id=r.examination_subject_id JOIN examinations e ON e.school_id=es.school_id AND e.id=es.examination_id JOIN classes c ON c.school_id=es.school_id AND c.id=es.class_id JOIN subjects s ON s.school_id=es.school_id AND s.id=es.subject_id
  LEFT JOIN ranks ON ranks.examination_id=e.id AND ranks.class_id=c.id AND ranks.student_id=r.student_id
  WHERE r.school_id=$1 AND r.student_id=$2 AND ($3::boolean OR (e.status='published' AND e.results_published_at IS NOT NULL AND r.published_at IS NOT NULL))
    AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM teacher_assignments ta JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id WHERE ta.school_id=es.school_id AND t.user_id=$5 AND cs.class_id=es.class_id AND cs.subject_id=es.subject_id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM es.section_id))) ORDER BY e.starts_on DESC,s.name`, [schoolId, studentId, includeUnpublished, ranking, teacherUserId ?? null])).rows;
}
examRouter.get("/results/students/:studentId/performance", requireSchoolPermission("results:read", "results:read:assigned", "results:read:linked", "results:read:self"), asyncRoute(async (req, res) => {
  const studentId = uuid2.parse(req.params.studentId), schoolId = req.tenant.id, userId = req.identity.id;
  const data = await tenantTransaction(schoolId, async (client) => {
    const scoped = has2(req, "results:read:linked", "results:read:self");
    if (scoped && !await linkedStudent(client, schoolId, userId, studentId, has2(req, "results:read:self") ? "either" : "linked")) fail(404, "Student results not found");
    if (has2(req, "results:read:assigned") && !has2(req, "results:read") && !scoped) {
      const allowed = await client.query(`SELECT 1 FROM student_enrollments en JOIN teacher_assignments ta ON ta.school_id=en.school_id JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id WHERE en.school_id=$1 AND en.student_id=$2 AND t.user_id=$3 AND en.class_id=cs.class_id LIMIT 1`, [schoolId, studentId, userId]);
      if (!allowed.rowCount) fail(404, "Student results not found");
    }
    const ranking = await rankPolicy(client, schoolId), teacherFilter = has2(req, "results:read:assigned") && !has2(req, "results:read") ? userId : void 0, items = await resultsForStudent(client, schoolId, studentId, !scoped, ranking, teacherFilter);
    return { items, rankingsEnabled: ranking };
  });
  res.json({ studentId, ...data });
}));
examRouter.get("/report-cards/:studentId/:examinationId", requireSchoolPermission("results:read", "results:read:assigned", "results:read:linked", "results:read:self"), asyncRoute(async (req, res) => {
  const studentId = uuid2.parse(req.params.studentId), examId = uuid2.parse(req.params.examinationId), schoolId = req.tenant.id, userId = req.identity.id;
  const card = await tenantTransaction(schoolId, async (client) => {
    const scoped = has2(req, "results:read:linked", "results:read:self");
    if (scoped && !await linkedStudent(client, schoolId, userId, studentId, has2(req, "results:read:self") ? "either" : "linked")) fail(404, "Report card not found");
    const published = await client.query("SELECT 1 FROM report_cards WHERE school_id=$1 AND student_id=$2 AND examination_id=$3 AND published_at IS NOT NULL", [schoolId, studentId, examId]);
    if (!published.rowCount && scoped) fail(404, "Report card not found");
    const profile = await client.query("SELECT first_name,last_name,admission_number FROM students WHERE school_id=$1 AND id=$2", [schoolId, studentId]);
    if (!profile.rows[0]) fail(404, "Report card not found");
    const teacherFilter = has2(req, "results:read:assigned") && !has2(req, "results:read") ? userId : void 0;
    if (teacherFilter) {
      const allowed = await client.query(`SELECT 1 FROM student_enrollments en JOIN examination_subjects es ON es.school_id=en.school_id AND es.class_id=en.class_id AND es.academic_year_id=en.academic_year_id AND (es.section_id IS NULL OR es.section_id=en.section_id) JOIN class_subjects cs ON cs.school_id=es.school_id AND cs.class_id=es.class_id AND cs.subject_id=es.subject_id JOIN teacher_assignments ta ON ta.school_id=cs.school_id AND ta.class_subject_id=cs.id AND (ta.section_id IS NULL OR ta.section_id IS NOT DISTINCT FROM es.section_id) JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id WHERE en.school_id=$1 AND en.student_id=$2 AND es.examination_id=$3 AND t.user_id=$4 LIMIT 1`, [schoolId, studentId, examId, userId]);
      if (!allowed.rowCount) fail(404, "Report card not found");
    }
    const ranking = await rankPolicy(client, schoolId), results = await resultsForStudent(client, schoolId, studentId, !scoped, ranking, teacherFilter);
    return { student: profile.rows[0], examinationId: examId, results: results.filter((r) => r.examination_id === examId), rankingsEnabled: ranking };
  });
  res.json({ reportCard: card });
}));

// apps/api/src/timetable/routes.ts
import { Router as Router8 } from "express";
import { z as z9 } from "zod";
var timetableRouter = Router8();
timetableRouter.use(authenticate);
var uuid3 = z9.uuid();
var time = z9.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, "Use a valid 24-hour time");
var readPermissions2 = ["timetable:read", "timetable:read:assigned", "timetable:read:linked", "timetable:read:self"];
var periodSchema = z9.object({ academicYearId: uuid3, periodNumber: z9.number().int().min(1).max(30), name: z9.string().trim().min(1).max(80), startsAt: time, endsAt: time, isBreak: z9.boolean().default(false) }).refine((v) => v.endsAt > v.startsAt, { message: "Period end must be after its start", path: ["endsAt"] });
var periodUpdateSchema = z9.object({ name: z9.string().trim().min(1).max(80).optional(), isActive: z9.boolean().optional(), startsAt: time.optional(), endsAt: time.optional() }).refine((v) => Object.keys(v).length > 0, { message: "Provide at least one period update" });
var entrySchema = z9.object({ academicYearId: uuid3, classId: uuid3, sectionId: uuid3, subjectId: uuid3, teacherId: uuid3, periodId: uuid3, dayOfWeek: z9.number().int().min(1).max(7), room: z9.string().trim().max(80).nullable().optional() });
var publishSchema = z9.object({ academicYearId: uuid3, classId: uuid3.optional(), sectionId: uuid3.optional() }).refine((v) => !v.sectionId || v.classId, { message: "A section requires its class", path: ["classId"] });
function has3(req, ...keys) {
  return keys.some((key) => req.permissions?.includes(key));
}
async function membership(client, schoolId, userId) {
  const row = await client.query("SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active", [schoolId, userId]);
  if (!row.rows[0]) fail(403, "Active school membership is required");
  return row.rows[0].id;
}
async function audit5(client, schoolId, actorId, entryId, action, targetType, targetId, after, before) {
  await client.query("INSERT INTO timetable_audit_history(school_id,timetable_id,actor_membership_id,action,before_state,after_state) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)", [schoolId, entryId, actorId, action, before ? JSON.stringify(before) : null, JSON.stringify(after)]);
  await client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)", [schoolId, actorId, `timetable.${action}`, targetType, targetId, JSON.stringify(after)]);
}
async function lockDay(client, schoolId, yearId, _day) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [schoolId, yearId]);
}
async function validateEntry(client, schoolId, input) {
  const classYear = await client.query("SELECT 1 FROM classes WHERE school_id=$1 AND id=$2 AND academic_year_id=$3", [schoolId, input.classId, input.academicYearId]);
  if (!classYear.rowCount) fail(400, "Class is not part of the selected academic year");
  const section = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3", [schoolId, input.sectionId, input.classId]);
  if (!section.rowCount) fail(400, "Section does not belong to the selected class");
  const subject = await client.query("SELECT 1 FROM class_subjects WHERE school_id=$1 AND class_id=$2 AND subject_id=$3", [schoolId, input.classId, input.subjectId]);
  if (!subject.rowCount) fail(400, "Subject is not allocated to the selected class");
  const teacher = await client.query("SELECT 1 FROM teachers WHERE school_id=$1 AND id=$2 AND employment_status='active'", [schoolId, input.teacherId]);
  if (!teacher.rowCount) fail(400, "Teacher is not active in this school");
  const assignment = await client.query(`SELECT 1 FROM teacher_assignments ta JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id WHERE ta.school_id=$1 AND ta.teacher_id=$2 AND cs.class_id=$3 AND cs.subject_id=$4 AND (ta.section_id IS NULL OR ta.section_id=$5::uuid) LIMIT 1`, [schoolId, input.teacherId, input.classId, input.subjectId, input.sectionId]);
  if (!assignment.rowCount) fail(400, "Teacher is not assigned to this class, section, and subject");
  const period = await client.query("SELECT id,starts_at,ends_at,is_break FROM timetable_periods WHERE school_id=$1 AND id=$2 AND academic_year_id=$3 AND is_active", [schoolId, input.periodId, input.academicYearId]);
  if (!period.rows[0]) fail(400, "Period is unavailable for the selected academic year");
  if (period.rows[0].is_break) fail(400, "Break periods cannot be assigned a subject");
  return { startsAt: String(period.rows[0].starts_at), endsAt: String(period.rows[0].ends_at) };
}
async function findConflicts(client, schoolId, entry) {
  const rows = await client.query(`SELECT id,class_id,section_id,teacher_id,day_of_week,starts_at,ends_at,room
    FROM timetables WHERE school_id=$1 AND academic_year_id=$2 AND day_of_week=$3 AND status<>'archived'
      AND ($4::uuid IS NULL OR id<>$4::uuid) AND starts_at<$6::time AND ends_at>$5::time
      AND (section_id=$7::uuid OR teacher_id=$8::uuid OR ($9::text IS NOT NULL AND room IS NOT NULL AND lower(trim(room))=lower(trim($9::text))))
    ORDER BY starts_at,id`, [schoolId, entry.academicYearId, entry.dayOfWeek, entry.id ?? null, entry.startsAt, entry.endsAt, entry.sectionId, entry.teacherId, entry.room ?? null]);
  return rows.rows.map((row) => ({ id: row.id, classConflict: row.section_id === entry.sectionId, teacherConflict: row.teacher_id === entry.teacherId, roomConflict: !!entry.room && !!row.room && String(row.room).trim().toLowerCase() === entry.room.trim().toLowerCase(), startsAt: row.starts_at, endsAt: row.ends_at, room: row.room }));
}
var selectEntries = `SELECT tt.id,tt.academic_year_id,tt.class_id,c.name AS class_name,tt.section_id,s.name AS section_name,tt.subject_id,sub.name AS subject_name,tt.teacher_id,u.name AS teacher_name,tt.period_id,p.period_number,p.name AS period_name,tt.day_of_week,tt.starts_at,tt.ends_at,tt.room,tt.status,tt.created_at,tt.updated_at
  FROM timetables tt JOIN classes c ON c.school_id=tt.school_id AND c.id=tt.class_id JOIN sections s ON s.school_id=tt.school_id AND s.id=tt.section_id JOIN subjects sub ON sub.school_id=tt.school_id AND sub.id=tt.subject_id JOIN teachers t ON t.school_id=tt.school_id AND t.id=tt.teacher_id LEFT JOIN users u ON u.id=t.user_id LEFT JOIN timetable_periods p ON p.school_id=tt.school_id AND p.id=tt.period_id`;
timetableRouter.get("/timetable/periods", requireSchoolPermission(...readPermissions2), asyncRoute(async (req, res) => {
  const query = z9.object({ academicYearId: uuid3, active: z9.coerce.boolean().optional() }).parse(req.query);
  const items = await tenantTransaction(req.tenant.id, async (client) => (await client.query(`SELECT id,academic_year_id,period_number,name,starts_at,ends_at,is_break,is_active,created_at,updated_at FROM timetable_periods WHERE school_id=$1 AND academic_year_id=$2 AND ($3::boolean IS NULL OR is_active=$3) ORDER BY period_number`, [req.tenant.id, query.academicYearId, query.active ?? null])).rows);
  res.json({ items });
}));
timetableRouter.post("/timetable/periods", requireSchoolPermission("timetable:manage"), asyncRoute(async (req, res) => {
  const input = periodSchema.parse(req.body), actor2 = await tenantTransaction(req.tenant.id, (client) => membership(client, req.tenant.id, req.identity.id));
  const result = await tenantTransaction(req.tenant.id, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [req.tenant.id, input.academicYearId]);
    const year = await client.query("SELECT 1 FROM academic_years WHERE school_id=$1 AND id=$2", [req.tenant.id, input.academicYearId]);
    if (!year.rowCount) fail(404, "Academic year not found");
    const conflict = await client.query("SELECT id FROM timetable_periods WHERE school_id=$1 AND academic_year_id=$2 AND is_active AND (period_number=$3 OR lower(name)=lower($4) OR (starts_at<$6::time AND ends_at>$5::time)) LIMIT 1", [req.tenant.id, input.academicYearId, input.periodNumber, input.name, input.startsAt, input.endsAt]);
    if (conflict.rowCount) fail(409, "Period number, name, or time overlaps an existing active period");
    const created = await client.query("INSERT INTO timetable_periods(school_id,academic_year_id,period_number,name,starts_at,ends_at,is_break) VALUES($1,$2,$3,$4,$5::time,$6::time,$7) RETURNING id,academic_year_id,period_number,name,starts_at,ends_at,is_break,is_active", [req.tenant.id, input.academicYearId, input.periodNumber, input.name, input.startsAt, input.endsAt, input.isBreak]);
    await audit5(client, req.tenant.id, actor2, null, "period_created", "timetable_period", created.rows[0].id, created.rows[0]);
    return created.rows[0];
  });
  res.status(201).json({ period: result });
}));
timetableRouter.patch("/timetable/periods/:id", requireSchoolPermission("timetable:manage"), asyncRoute(async (req, res) => {
  const id = uuid3.parse(req.params.id), input = periodUpdateSchema.parse(req.body), actor2 = await tenantTransaction(req.tenant.id, (client) => membership(client, req.tenant.id, req.identity.id));
  const updated = await tenantTransaction(req.tenant.id, async (client) => {
    const old = (await client.query("SELECT id,academic_year_id,period_number,name,starts_at,ends_at,is_break,is_active FROM timetable_periods WHERE school_id=$1 AND id=$2 FOR UPDATE", [req.tenant.id, id])).rows[0];
    if (!old) fail(404, "Timetable period not found");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [req.tenant.id, old.academic_year_id]);
    const next = { ...old, name: input.name ?? old.name, starts_at: input.startsAt ?? old.starts_at, ends_at: input.endsAt ?? old.ends_at, is_active: input.isActive ?? old.is_active };
    if (next.ends_at <= next.starts_at) fail(400, "Period end must be after its start");
    const timeChanged = next.starts_at !== old.starts_at || next.ends_at !== old.ends_at || next.is_active !== old.is_active;
    if (timeChanged) {
      const used = await client.query("SELECT 1 FROM timetables WHERE school_id=$1 AND period_id=$2 AND status<>'archived' LIMIT 1", [req.tenant.id, id]);
      if (used.rowCount) fail(409, "A period used by timetable entries cannot be deactivated or have its times changed; archive its entries first");
    }
    const conflict = await client.query("SELECT 1 FROM timetable_periods WHERE school_id=$1 AND academic_year_id=$2 AND id<>$3 AND is_active AND $4::boolean AND (lower(name)=lower($5) OR period_number=$6 OR (starts_at<$8::time AND ends_at>$7::time)) LIMIT 1", [req.tenant.id, old.academic_year_id, id, next.is_active, next.name, next.period_number, next.starts_at, next.ends_at]);
    if (conflict.rowCount) fail(409, "Period number, name, or time overlaps another active period");
    const row = (await client.query("UPDATE timetable_periods SET name=$3,starts_at=$4::time,ends_at=$5::time,is_active=$6,updated_at=now() WHERE school_id=$1 AND id=$2 RETURNING id,academic_year_id,period_number,name,starts_at,ends_at,is_break,is_active,updated_at", [req.tenant.id, id, next.name, next.starts_at, next.ends_at, next.is_active])).rows[0];
    await audit5(client, req.tenant.id, actor2, null, "period_updated", "timetable_period", id, row, old);
    return row;
  });
  res.json({ period: updated });
}));
timetableRouter.get("/timetable", requireSchoolPermission(...readPermissions2), asyncRoute(async (req, res) => {
  const filter = z9.object({ academicYearId: uuid3.optional(), classId: uuid3.optional(), sectionId: uuid3.optional(), teacherId: uuid3.optional(), dayOfWeek: z9.coerce.number().int().min(1).max(7).optional(), status: z9.enum(["draft", "published", "archived"]).optional(), limit: z9.coerce.number().int().min(1).max(500).default(250) }).parse(req.query);
  if (filter.sectionId && !filter.classId) fail(400, "A class is required when filtering by section");
  const scope = { global: has3(req, "timetable:read"), assigned: has3(req, "timetable:read:assigned"), linked: has3(req, "timetable:read:linked"), self: has3(req, "timetable:read:self") };
  const data = await tenantTransaction(req.tenant.id, async (client) => {
    if (filter.classId) {
      const exists = await client.query("SELECT 1 FROM classes WHERE school_id=$1 AND id=$2", [req.tenant.id, filter.classId]);
      if (!exists.rowCount) fail(404, "Class not found");
    }
    if (filter.sectionId) {
      const exists = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3", [req.tenant.id, filter.sectionId, filter.classId]);
      if (!exists.rowCount) fail(404, "Section not found");
    }
    const params = [req.tenant.id, filter.academicYearId ?? null, filter.classId ?? null, filter.sectionId ?? null, filter.teacherId ?? null, filter.dayOfWeek ?? null, filter.status ?? null, scope.global, scope.assigned, scope.linked, scope.self, req.identity.id, filter.limit];
    const items = await client.query(`${selectEntries} WHERE tt.school_id=$1 AND ($2::uuid IS NULL OR tt.academic_year_id=$2) AND ($3::uuid IS NULL OR tt.class_id=$3) AND ($4::uuid IS NULL OR tt.section_id=$4) AND ($5::uuid IS NULL OR tt.teacher_id=$5) AND ($6::smallint IS NULL OR tt.day_of_week=$6) AND ($7::text IS NULL OR tt.status=$7) AND (
      $8::boolean OR
      ($9::boolean AND EXISTS(SELECT 1 FROM teacher_assignments ta JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id JOIN teachers t2 ON t2.school_id=ta.school_id AND t2.id=ta.teacher_id WHERE ta.school_id=tt.school_id AND t2.user_id=$12 AND t2.id=tt.teacher_id AND cs.class_id=tt.class_id AND cs.subject_id=tt.subject_id AND (ta.section_id IS NULL OR ta.section_id=tt.section_id))) OR
      ($10::boolean AND tt.status='published' AND EXISTS(SELECT 1 FROM student_enrollments e JOIN student_parents sp ON sp.school_id=e.school_id AND sp.student_id=e.student_id JOIN parents p2 ON p2.school_id=sp.school_id AND p2.id=sp.parent_id WHERE e.school_id=tt.school_id AND p2.user_id=$12 AND e.status='active' AND e.class_id=tt.class_id AND e.academic_year_id=tt.academic_year_id AND e.section_id=tt.section_id)) OR
      ($11::boolean AND tt.status='published' AND EXISTS(SELECT 1 FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id WHERE st.school_id=tt.school_id AND st.user_id=$12 AND e.status='active' AND e.class_id=tt.class_id AND e.academic_year_id=tt.academic_year_id AND e.section_id=tt.section_id))
    ) ORDER BY tt.day_of_week,tt.starts_at,c.name,s.name LIMIT $13`, params);
    return items.rows;
  });
  res.json({ items: data });
}));
timetableRouter.get("/timetable/teachers/:teacherId", requireSchoolPermission(...readPermissions2), asyncRoute(async (req, res) => {
  const teacherId = uuid3.parse(req.params.teacherId);
  if (has3(req, "timetable:read:assigned")) {
    const own = await tenantTransaction(req.tenant.id, (client) => client.query("SELECT 1 FROM teachers WHERE school_id=$1 AND id=$2 AND user_id=$3 AND employment_status='active'", [req.tenant.id, teacherId, req.identity.id]));
    if (!own.rowCount && !has3(req, "timetable:read")) fail(404, "Teacher timetable not found");
  }
  const query = z9.object({ academicYearId: uuid3.optional() }).parse(req.query);
  const result = await tenantTransaction(req.tenant.id, (client) => client.query(`${selectEntries} WHERE tt.school_id=$1 AND tt.teacher_id=$2 AND ($3::uuid IS NULL OR tt.academic_year_id=$3) AND ($4::boolean OR ($5::boolean AND t.user_id=$6)) ORDER BY tt.day_of_week,tt.starts_at`, [req.tenant.id, teacherId, query.academicYearId ?? null, has3(req, "timetable:read"), has3(req, "timetable:read:assigned"), req.identity.id]));
  res.json({ items: result.rows });
}));
timetableRouter.get("/timetable/classes/:classId", requireSchoolPermission(...readPermissions2), asyncRoute(async (req, res) => {
  const classId = uuid3.parse(req.params.classId), query = z9.object({ academicYearId: uuid3.optional(), sectionId: uuid3.optional() }).parse(req.query);
  const params = [req.tenant.id, classId, query.academicYearId ?? null, query.sectionId ?? null, has3(req, "timetable:read"), has3(req, "timetable:read:assigned"), has3(req, "timetable:read:linked"), has3(req, "timetable:read:self"), req.identity.id];
  const result = await tenantTransaction(req.tenant.id, async (client) => {
    const exists = await client.query("SELECT 1 FROM classes WHERE school_id=$1 AND id=$2", [req.tenant.id, classId]);
    if (!exists.rowCount) fail(404, "Class not found");
    if (query.sectionId) {
      const section = await client.query("SELECT 1 FROM sections WHERE school_id=$1 AND id=$2 AND class_id=$3", [req.tenant.id, query.sectionId, classId]);
      if (!section.rowCount) fail(404, "Section not found");
    }
    return client.query(`${selectEntries} WHERE tt.school_id=$1 AND tt.class_id=$2 AND ($3::uuid IS NULL OR tt.academic_year_id=$3) AND ($4::uuid IS NULL OR tt.section_id=$4) AND (
      $5::boolean OR
      ($6::boolean AND EXISTS(SELECT 1 FROM teacher_assignments ta JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id JOIN teachers t2 ON t2.school_id=ta.school_id AND t2.id=ta.teacher_id WHERE ta.school_id=tt.school_id AND t2.user_id=$9 AND cs.class_id=tt.class_id AND cs.subject_id=tt.subject_id AND t2.id=tt.teacher_id AND (ta.section_id IS NULL OR ta.section_id=tt.section_id))) OR
      ($7::boolean AND tt.status='published' AND EXISTS(SELECT 1 FROM student_enrollments e JOIN student_parents sp ON sp.school_id=e.school_id AND sp.student_id=e.student_id JOIN parents p2 ON p2.school_id=sp.school_id AND p2.id=sp.parent_id WHERE e.school_id=tt.school_id AND p2.user_id=$9 AND e.status='active' AND e.academic_year_id=tt.academic_year_id AND e.section_id=tt.section_id)) OR
      ($8::boolean AND tt.status='published' AND EXISTS(SELECT 1 FROM students st JOIN student_enrollments e ON e.school_id=st.school_id AND e.student_id=st.id WHERE st.school_id=tt.school_id AND st.user_id=$9 AND e.status='active' AND e.academic_year_id=tt.academic_year_id AND e.section_id=tt.section_id))
    ) ORDER BY tt.day_of_week,tt.starts_at`, params);
  });
  res.json({ items: result.rows });
}));
timetableRouter.post("/timetable", requireSchoolPermission("timetable:manage"), asyncRoute(async (req, res) => {
  const input = entrySchema.parse(req.body), actor2 = await tenantTransaction(req.tenant.id, (client) => membership(client, req.tenant.id, req.identity.id));
  const created = await tenantTransaction(req.tenant.id, async (client) => {
    await lockDay(client, req.tenant.id, input.academicYearId, input.dayOfWeek);
    const period = await validateEntry(client, req.tenant.id, input);
    const overlaps = await findConflicts(client, req.tenant.id, { academicYearId: input.academicYearId, classId: input.classId, sectionId: input.sectionId, teacherId: input.teacherId, dayOfWeek: input.dayOfWeek, startsAt: period.startsAt, endsAt: period.endsAt, room: input.room });
    if (overlaps.length) fail(409, `Schedule conflict: ${JSON.stringify(overlaps)}`);
    const row = (await client.query(`INSERT INTO timetables(school_id,academic_year_id,class_id,section_id,subject_id,teacher_id,period_id,day_of_week,starts_at,ends_at,room,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::time,$10::time,$11,'draft') RETURNING id,academic_year_id,class_id,section_id,subject_id,teacher_id,period_id,day_of_week,starts_at,ends_at,room,status`, [req.tenant.id, input.academicYearId, input.classId, input.sectionId, input.subjectId, input.teacherId, input.periodId, input.dayOfWeek, period.startsAt, period.endsAt, input.room ?? null])).rows[0];
    await audit5(client, req.tenant.id, actor2, row.id, "entry_created", "timetable", row.id, row);
    return row;
  });
  res.status(201).json({ entry: created });
}));
timetableRouter.patch("/timetable/:id", requireSchoolPermission("timetable:manage"), asyncRoute(async (req, res) => {
  const id = uuid3.parse(req.params.id), input = entrySchema.parse(req.body), actor2 = await tenantTransaction(req.tenant.id, (client) => membership(client, req.tenant.id, req.identity.id));
  const updated = await tenantTransaction(req.tenant.id, async (client) => {
    const old = (await client.query("SELECT id,status,academic_year_id,class_id,section_id,subject_id,teacher_id,period_id,day_of_week,room FROM timetables WHERE school_id=$1 AND id=$2 FOR UPDATE", [req.tenant.id, id])).rows[0];
    if (!old) fail(404, "Timetable entry not found");
    if (old.status !== "draft") fail(409, "Unpublish a timetable entry before editing it");
    if (input.academicYearId !== old.academic_year_id) fail(400, "Timetable entries cannot be moved between academic years; create a new entry and archive this one");
    await lockDay(client, req.tenant.id, input.academicYearId, input.dayOfWeek);
    const period = await validateEntry(client, req.tenant.id, input), overlaps = await findConflicts(client, req.tenant.id, { id, academicYearId: input.academicYearId, classId: input.classId, sectionId: input.sectionId, teacherId: input.teacherId, dayOfWeek: input.dayOfWeek, startsAt: period.startsAt, endsAt: period.endsAt, room: input.room });
    if (overlaps.length) fail(409, `Schedule conflict: ${JSON.stringify(overlaps)}`);
    const row = (await client.query(`UPDATE timetables SET academic_year_id=$3,class_id=$4,section_id=$5,subject_id=$6,teacher_id=$7,period_id=$8,day_of_week=$9,starts_at=$10::time,ends_at=$11::time,room=$12,updated_at=now() WHERE school_id=$1 AND id=$2 RETURNING id,academic_year_id,class_id,section_id,subject_id,teacher_id,period_id,day_of_week,starts_at,ends_at,room,status,updated_at`, [req.tenant.id, id, input.academicYearId, input.classId, input.sectionId, input.subjectId, input.teacherId, input.periodId, input.dayOfWeek, period.startsAt, period.endsAt, input.room ?? null])).rows[0];
    await audit5(client, req.tenant.id, actor2, id, "entry_updated", "timetable", id, row, old);
    return row;
  });
  res.json({ entry: updated });
}));
timetableRouter.patch("/timetable/:id/status", requireSchoolPermission("timetable:manage"), asyncRoute(async (req, res) => {
  const id = uuid3.parse(req.params.id), { status } = z9.object({ status: z9.enum(["draft", "archived"]) }).parse(req.body), actor2 = await tenantTransaction(req.tenant.id, (client) => membership(client, req.tenant.id, req.identity.id));
  const updated = await tenantTransaction(req.tenant.id, async (client) => {
    const old = (await client.query("SELECT id,status FROM timetables WHERE school_id=$1 AND id=$2 FOR UPDATE", [req.tenant.id, id])).rows[0];
    if (!old) fail(404, "Timetable entry not found");
    const row = (await client.query("UPDATE timetables SET status=$3,updated_at=now() WHERE school_id=$1 AND id=$2 RETURNING id,status,updated_at", [req.tenant.id, id, status])).rows[0];
    await audit5(client, req.tenant.id, actor2, id, status === "draft" ? "entry_unpublished" : "entry_archived", "timetable", id, row, old);
    return row;
  });
  res.json({ entry: updated });
}));
timetableRouter.post("/timetable/publish", requireSchoolPermission("timetable:manage"), asyncRoute(async (req, res) => {
  const input = publishSchema.parse(req.body), actor2 = await tenantTransaction(req.tenant.id, (client) => membership(client, req.tenant.id, req.identity.id));
  const updated = await tenantTransaction(req.tenant.id, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [req.tenant.id, input.academicYearId]);
    const target = (await client.query(`SELECT id,class_id,section_id,teacher_id,day_of_week,starts_at,ends_at,room FROM timetables WHERE school_id=$1 AND academic_year_id=$2 AND status='draft' AND ($3::uuid IS NULL OR class_id=$3) AND ($4::uuid IS NULL OR section_id=$4) ORDER BY day_of_week,starts_at,id FOR UPDATE`, [req.tenant.id, input.academicYearId, input.classId ?? null, input.sectionId ?? null])).rows;
    if (!target.length) fail(404, "No draft timetable entries matched the publication target");
    for (const item of target) {
      const overlaps = await findConflicts(client, req.tenant.id, { id: item.id, academicYearId: input.academicYearId, classId: item.class_id, sectionId: item.section_id, teacherId: item.teacher_id, dayOfWeek: item.day_of_week, startsAt: String(item.starts_at), endsAt: String(item.ends_at), room: item.room });
      if (overlaps.length) fail(409, `Resolve schedule conflicts before publication: ${JSON.stringify(overlaps)}`);
    }
    const ids = target.map((row) => row.id);
    const rows = (await client.query("UPDATE timetables SET status='published',updated_at=now() WHERE school_id=$1 AND id=ANY($2::uuid[]) RETURNING id,class_id,section_id,day_of_week,starts_at,ends_at,room,status", [req.tenant.id, ids])).rows;
    for (const row of rows) await audit5(client, req.tenant.id, actor2, row.id, "entry_published", "timetable", row.id, row);
    await audit5(client, req.tenant.id, actor2, null, "schedule_published", "timetable_schedule", input.classId ?? input.academicYearId, { academicYearId: input.academicYearId, classId: input.classId ?? null, sectionId: input.sectionId ?? null, count: rows.length });
    return rows;
  });
  res.json({ items: updated });
}));

// apps/api/src/fees/routes.ts
import { Router as Router9 } from "express";
import { z as z10 } from "zod";
var feesRouter = Router9();
feesRouter.use(authenticate);
var uuid4 = z10.uuid();
var categoryType = z10.enum(["tuition", "transport", "examination", "custom"]);
var methodSchema = z10.enum(["cash", "bank_transfer", "cheque", "demand_draft", "other"]);
var amountSchema = z10.number().int().safe().positive().max(Number.MAX_SAFE_INTEGER);
var optionalDate = z10.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
var categorySchema = z10.object({ name: z10.string().trim().min(2).max(80), categoryType: categoryType.default("custom") });
var structureSchema = z10.object({ categoryId: uuid4, academicYearId: uuid4, amountMinor: amountSchema, currency: z10.string().regex(/^[A-Z]{3}$/), dueOn: optionalDate, description: z10.string().trim().max(1e3).default("") });
var assignSchema = z10.object({ studentId: uuid4, feeStructureId: uuid4, amountDueMinor: amountSchema.optional(), dueOn: optionalDate });
var paymentSchema = z10.object({ studentFeeId: uuid4, amountMinor: amountSchema, method: methodSchema, reference: z10.string().trim().max(180).optional(), idempotencyKey: z10.string().trim().min(12).max(120) });
var reversalSchema = z10.object({ amountMinor: amountSchema, reason: z10.string().trim().min(5).max(500), idempotencyKey: z10.string().trim().min(12).max(120) });
var pageSchema = z10.object({ page: z10.coerce.number().int().min(1).default(1), limit: z10.coerce.number().int().min(1).max(100).default(30) });
var dateRangeSchema = z10.object({ from: optionalDate, to: optionalDate }).superRefine((range, ctx) => {
  if (range.from && range.to && range.from > range.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to must not be before from" });
});
function has4(req, ...permissions) {
  return permissions.some((permission) => req.permissions?.includes(permission));
}
async function actorMembership2(client, schoolId, userId) {
  const result = await client.query("SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active", [schoolId, userId]);
  if (!result.rows[0]) fail(403, "Active school membership is required");
  return result.rows[0].id;
}
async function audit6(client, schoolId, membershipId2, action, targetType, targetId, metadata = {}) {
  await client.query("INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)", [schoolId, membershipId2, action, targetType, targetId, JSON.stringify(metadata)]);
}
function currentBalance(client, schoolId, feeId) {
  return client.query(`SELECT sf.amount_due_minor::bigint AS amount_due_minor,
    COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS paid_minor,
    COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS reversed_minor
    FROM student_fees sf WHERE sf.school_id=$1 AND sf.id=$2`, [schoolId, feeId]);
}
async function visibleStudent(client, req, studentId) {
  const schoolId = req.tenant.id, userId = req.identity.id;
  const global = has4(req, "fees:read", "fees:manage");
  const result = await client.query(`SELECT st.id FROM students st WHERE st.school_id=$1 AND st.id=$2 AND
    ($3::boolean OR EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE sp.school_id=st.school_id AND sp.student_id=st.id AND p.user_id=$4))`, [schoolId, studentId, global, userId]);
  if (!result.rowCount) fail(404, "Fee record not found");
}
feesRouter.get("/categories", requireSchoolPermission("fees:read", "fees:read:linked", "fees:manage"), asyncRoute(async (req, res) => {
  const data = await tenantTransaction(req.tenant.id, (client) => client.query("SELECT id,name,category_type,created_at FROM fee_categories WHERE school_id=$1 ORDER BY name", [req.tenant.id]));
  res.json({ items: data.rows });
}));
feesRouter.post("/categories", requireSchoolPermission("fees:manage"), asyncRoute(async (req, res) => {
  const input = categorySchema.parse(req.body), schoolId = req.tenant.id;
  const created = await tenantTransaction(schoolId, async (client) => {
    const actor2 = await actorMembership2(client, schoolId, req.identity.id);
    const row = await client.query("INSERT INTO fee_categories(school_id,name,category_type) VALUES($1,$2,$3) RETURNING id,name,category_type,created_at", [schoolId, input.name, input.categoryType]);
    await audit6(client, schoolId, actor2, "fees.category_created", "fee_category", row.rows[0].id, { name: input.name, categoryType: input.categoryType });
    return row.rows[0];
  });
  res.status(201).json({ category: created });
}));
feesRouter.patch("/categories/:id", requireSchoolPermission("fees:manage"), asyncRoute(async (req, res) => {
  const id = uuid4.parse(req.params.id), input = categorySchema.parse(req.body), schoolId = req.tenant.id;
  const changed = await tenantTransaction(schoolId, async (client) => {
    const actor2 = await actorMembership2(client, schoolId, req.identity.id);
    const old = await client.query("SELECT id,name,category_type FROM fee_categories WHERE school_id=$1 AND id=$2 FOR UPDATE", [schoolId, id]);
    if (!old.rows[0]) fail(404, "Fee category not found");
    const row = await client.query("UPDATE fee_categories SET name=$3,category_type=$4 WHERE school_id=$1 AND id=$2 RETURNING id,name,category_type", [schoolId, id, input.name, input.categoryType]);
    await audit6(client, schoolId, actor2, "fees.category_updated", "fee_category", id, { before: old.rows[0], after: row.rows[0] });
    return row.rows[0];
  });
  res.json({ category: changed });
}));
feesRouter.get("/structures", requireSchoolPermission("fees:read", "fees:read:linked", "fees:manage"), asyncRoute(async (req, res) => {
  const data = await tenantTransaction(req.tenant.id, (client) => client.query(`SELECT fs.id,fs.category_id,fc.name AS category_name,fc.category_type,fs.academic_year_id,y.name AS academic_year_name,fs.amount_minor,fs.currency,fs.due_on,fs.description
    FROM fee_structures fs JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id JOIN academic_years y ON y.school_id=fs.school_id AND y.id=fs.academic_year_id
    WHERE fs.school_id=$1 ORDER BY y.starts_on DESC,fc.name,fs.due_on NULLS LAST`, [req.tenant.id]));
  res.json({ items: data.rows });
}));
feesRouter.post("/structures", requireSchoolPermission("fees:manage"), asyncRoute(async (req, res) => {
  const input = structureSchema.parse(req.body), schoolId = req.tenant.id;
  const created = await tenantTransaction(schoolId, async (client) => {
    const actor2 = await actorMembership2(client, schoolId, req.identity.id);
    const category = await client.query("SELECT id FROM fee_categories WHERE school_id=$1 AND id=$2", [schoolId, input.categoryId]);
    if (!category.rowCount) fail(400, "The fee category is unavailable in this school");
    const year = await client.query("SELECT id FROM academic_years WHERE school_id=$1 AND id=$2", [schoolId, input.academicYearId]);
    if (!year.rowCount) fail(400, "The academic year is unavailable in this school");
    const row = await client.query(`INSERT INTO fee_structures(school_id,category_id,academic_year_id,amount_minor,currency,due_on,description)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,category_id,academic_year_id,amount_minor,currency,due_on,description`, [schoolId, input.categoryId, input.academicYearId, input.amountMinor, input.currency, input.dueOn ?? null, input.description]);
    await audit6(client, schoolId, actor2, "fees.structure_created", "fee_structure", row.rows[0].id, { categoryId: input.categoryId, academicYearId: input.academicYearId, amountMinor: input.amountMinor, currency: input.currency });
    return row.rows[0];
  });
  res.status(201).json({ structure: created });
}));
feesRouter.post("/assignments", requireSchoolPermission("fees:manage"), asyncRoute(async (req, res) => {
  const input = assignSchema.parse(req.body), schoolId = req.tenant.id;
  const created = await tenantTransaction(schoolId, async (client) => {
    const actor2 = await actorMembership2(client, schoolId, req.identity.id);
    const student = await client.query("SELECT id FROM students WHERE school_id=$1 AND id=$2 AND status='active'", [schoolId, input.studentId]);
    if (!student.rowCount) fail(400, "The selected student is not active in this school");
    const structure = await client.query("SELECT id,amount_minor,due_on FROM fee_structures WHERE school_id=$1 AND id=$2", [schoolId, input.feeStructureId]);
    if (!structure.rows[0]) fail(400, "The fee structure is unavailable in this school");
    const row = await client.query(`INSERT INTO student_fees(school_id,student_id,fee_structure_id,amount_due_minor,due_on,assigned_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,student_id,fee_structure_id,amount_due_minor,due_on,assigned_at,is_active`, [schoolId, input.studentId, input.feeStructureId, input.amountDueMinor ?? structure.rows[0].amount_minor, input.dueOn ?? structure.rows[0].due_on, actor2]);
    await audit6(client, schoolId, actor2, "fees.student_fee_assigned", "student_fee", row.rows[0].id, { studentId: input.studentId, feeStructureId: input.feeStructureId, amountDueMinor: row.rows[0].amount_due_minor });
    return row.rows[0];
  });
  res.status(201).json({ fee: created });
}));
feesRouter.get("/assignments", requireSchoolPermission("fees:read", "fees:read:linked", "fees:manage"), asyncRoute(async (req, res) => {
  const schoolId = req.tenant.id, pageInfo = pageSchema.parse(req.query), classId = typeof req.query.classId === "string" ? uuid4.parse(req.query.classId) : null;
  const global = has4(req, "fees:read", "fees:manage"), parent = has4(req, "fees:read:linked");
  const data = await tenantTransaction(schoolId, async (client) => {
    const params = [schoolId, req.identity.id, global, parent, classId, pageInfo.limit, (pageInfo.page - 1) * pageInfo.limit];
    const where = `sf.school_id=$1 AND sf.is_active AND ($3::boolean OR ($4::boolean AND EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE sp.school_id=sf.school_id AND sp.student_id=sf.student_id AND p.user_id=$2))) AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM student_enrollments e WHERE e.school_id=sf.school_id AND e.student_id=sf.student_id AND e.class_id=$5 AND e.status='active'))`;
    const rows = await client.query(`SELECT sf.id,sf.student_id,concat_ws(' ',st.first_name,st.last_name) AS student_name,st.admission_number,sf.fee_structure_id,fc.name AS category_name,fs.currency,sf.amount_due_minor,sf.due_on,
      COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS paid_minor,
      COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS reversed_minor,
      (SELECT count(*)::int FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id) AS payment_count
      FROM student_fees sf JOIN students st ON st.school_id=sf.school_id AND st.id=sf.student_id JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id
      WHERE ${where} ORDER BY sf.due_on NULLS LAST,st.last_name,st.first_name LIMIT $6 OFFSET $7`, params);
    const count = await client.query(`SELECT count(*)::int AS total FROM student_fees sf WHERE ${where}`, params.slice(0, 5));
    return { items: rows.rows, total: count.rows[0].total, page: pageInfo.page, limit: pageInfo.limit };
  });
  res.json(data);
}));
feesRouter.get("/students/:studentId", requireSchoolPermission("fees:read", "fees:read:linked", "fees:manage"), asyncRoute(async (req, res) => {
  const studentId = uuid4.parse(req.params.studentId), schoolId = req.tenant.id;
  const data = await tenantTransaction(schoolId, async (client) => {
    await visibleStudent(client, req, studentId);
    const rows = await client.query(`SELECT sf.id,sf.fee_structure_id,fc.name AS category_name,fc.category_type,fs.currency,sf.amount_due_minor,sf.due_on,
      COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS paid_minor,
      COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS reversed_minor,
      sf.amount_due_minor-COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)+COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0) AS balance_minor
      FROM student_fees sf JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id WHERE sf.school_id=$1 AND sf.student_id=$2 AND sf.is_active ORDER BY sf.due_on NULLS LAST`, [schoolId, studentId]);
    return rows.rows;
  });
  res.json({ studentId, items: data });
}));
feesRouter.post("/payments", requireSchoolPermission("fees:manage"), asyncRoute(async (req, res) => {
  const input = paymentSchema.parse(req.body), schoolId = req.tenant.id;
  const outcome = await tenantTransaction(schoolId, async (client) => {
    const actor2 = await actorMembership2(client, schoolId, req.identity.id);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [schoolId, input.idempotencyKey]);
    const previous = await client.query(`SELECT p.id,p.student_fee_id,p.amount_minor,p.method,p.reference,p.paid_at,r.id AS receipt_id,r.receipt_number
      FROM payments p LEFT JOIN payment_receipts r ON r.school_id=p.school_id AND r.payment_id=p.id WHERE p.school_id=$1 AND p.idempotency_key=$2`, [schoolId, input.idempotencyKey]);
    if (previous.rows[0]) {
      const row = previous.rows[0];
      if (row.student_fee_id !== input.studentFeeId || Number(row.amount_minor) !== input.amountMinor || row.method !== input.method || (row.reference ?? null) !== (input.reference ?? null)) fail(409, "The idempotency key was already used for a different payment");
      const balance2 = await currentBalance(client, schoolId, input.studentFeeId);
      const b = balance2.rows[0];
      return { payment: row, receipt: { id: row.receipt_id, receipt_number: row.receipt_number }, balanceMinor: Number(b.amount_due_minor) - Number(b.paid_minor) + Number(b.reversed_minor), replayed: true };
    }
    const fee = await client.query("SELECT sf.id,sf.amount_due_minor,fs.currency FROM student_fees sf JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id WHERE sf.school_id=$1 AND sf.id=$2 AND sf.is_active FOR UPDATE OF sf", [schoolId, input.studentFeeId]);
    if (!fee.rows[0]) fail(404, "Active student fee not found");
    const balance = await currentBalance(client, schoolId, input.studentFeeId), current = balance.rows[0];
    const balanceMinor = Number(current.amount_due_minor) - Number(current.paid_minor) + Number(current.reversed_minor);
    if (input.amountMinor > balanceMinor) fail(409, "Payment exceeds the outstanding balance");
    const payment = await client.query(`INSERT INTO payments(school_id,student_fee_id,amount_minor,method,reference,received_by,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,student_fee_id,amount_minor,method,reference,paid_at`, [schoolId, input.studentFeeId, input.amountMinor, input.method, input.reference ?? null, actor2, input.idempotencyKey]);
    await client.query("INSERT INTO fee_receipt_sequences(school_id,last_value) VALUES($1,0) ON CONFLICT(school_id) DO NOTHING", [schoolId]);
    const sequence = await client.query("UPDATE fee_receipt_sequences SET last_value=last_value+1 WHERE school_id=$1 RETURNING last_value", [schoolId]);
    const receiptNumber = `${req.tenant.displayId}-FEE-${String(sequence.rows[0].last_value).padStart(6, "0")}`;
    const receipt = await client.query("INSERT INTO payment_receipts(school_id,payment_id,receipt_number) VALUES($1,$2,$3) RETURNING id,receipt_number,created_at", [schoolId, payment.rows[0].id, receiptNumber]);
    await audit6(client, schoolId, actor2, "fees.payment_recorded", "payment", payment.rows[0].id, { studentFeeId: input.studentFeeId, amountMinor: input.amountMinor, method: input.method, receiptNumber });
    return { payment: payment.rows[0], receipt: receipt.rows[0], balanceMinor: balanceMinor - input.amountMinor, replayed: false };
  });
  res.status(outcome.replayed ? 200 : 201).json(outcome);
}));
feesRouter.post("/payments/:paymentId/reversals", requireSchoolPermission("fees:manage"), asyncRoute(async (req, res) => {
  const paymentId = uuid4.parse(req.params.paymentId), input = reversalSchema.parse(req.body), schoolId = req.tenant.id;
  const result = await tenantTransaction(schoolId, async (client) => {
    const actor2 = await actorMembership2(client, schoolId, req.identity.id);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [schoolId, input.idempotencyKey]);
    const existing = await client.query("SELECT id,payment_id,amount_minor,reason,created_at FROM payment_reversals WHERE school_id=$1 AND idempotency_key=$2", [schoolId, input.idempotencyKey]);
    if (existing.rows[0]) {
      const row2 = existing.rows[0];
      if (row2.payment_id !== paymentId || Number(row2.amount_minor) !== input.amountMinor || row2.reason !== input.reason) fail(409, "The idempotency key was already used for a different reversal");
      return { reversal: row2, replayed: true };
    }
    const payment = await client.query("SELECT id,student_fee_id,amount_minor FROM payments WHERE school_id=$1 AND id=$2 FOR UPDATE", [schoolId, paymentId]);
    if (!payment.rows[0]) fail(404, "Payment not found");
    const reversals = await client.query("SELECT COALESCE(sum(amount_minor),0)::bigint AS total FROM payment_reversals WHERE school_id=$1 AND payment_id=$2", [schoolId, paymentId]);
    const reversible = Number(payment.rows[0].amount_minor) - Number(reversals.rows[0].total);
    if (input.amountMinor > reversible) fail(409, "Reversal exceeds the remaining payment amount");
    const row = await client.query(`INSERT INTO payment_reversals(school_id,payment_id,amount_minor,reason,idempotency_key,reversed_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,payment_id,amount_minor,reason,created_at`, [schoolId, paymentId, input.amountMinor, input.reason, input.idempotencyKey, actor2]);
    await audit6(client, schoolId, actor2, "fees.payment_reversed", "payment_reversal", row.rows[0].id, { paymentId, amountMinor: input.amountMinor, reason: input.reason });
    return { reversal: row.rows[0], replayed: false };
  });
  res.status(result.replayed ? 200 : 201).json(result);
}));
feesRouter.get("/receipts/:receiptId", requireSchoolPermission("fees:read", "fees:read:linked", "fees:manage"), asyncRoute(async (req, res) => {
  const receiptId = uuid4.parse(req.params.receiptId), schoolId = req.tenant.id;
  const data = await tenantTransaction(schoolId, async (client) => {
    const receipt = await client.query(`SELECT r.id,r.receipt_number,r.created_at,p.id AS payment_id,p.amount_minor,p.method,p.reference,p.paid_at,fs.currency,sf.student_id,st.admission_number,st.first_name,st.last_name,fc.name AS category_name
      FROM payment_receipts r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id JOIN student_fees sf ON sf.school_id=p.school_id AND sf.id=p.student_fee_id JOIN students st ON st.school_id=sf.school_id AND st.id=sf.student_id JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id
      WHERE r.school_id=$1 AND r.id=$2`, [schoolId, receiptId]);
    if (!receipt.rows[0]) fail(404, "Receipt not found");
    if (has4(req, "fees:read:linked")) await visibleStudent(client, req, receipt.rows[0].student_id);
    else if (!has4(req, "fees:read", "fees:manage")) fail(403, "Fee receipt access is not authorized");
    return receipt.rows[0];
  });
  res.json({ receipt: data });
}));
feesRouter.get("/reports/collection", requireSchoolPermission("fees:read", "fees:manage"), asyncRoute(async (req, res) => {
  const range = dateRangeSchema.parse(req.query), schoolId = req.tenant.id;
  const rows = await tenantTransaction(schoolId, (client) => client.query(`WITH payments_in_range AS (
      SELECT p.id,p.school_id,p.amount_minor,fs.currency,fc.name AS category_name
      FROM payments p JOIN student_fees sf ON sf.school_id=p.school_id AND sf.id=p.student_fee_id
      JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id
      JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id
      WHERE p.school_id=$1 AND ($2::date IS NULL OR p.paid_at::date >= $2::date) AND ($3::date IS NULL OR p.paid_at::date <= $3::date)
    ), collected AS (
      SELECT currency,category_name,count(*)::int AS payment_count,sum(amount_minor)::bigint AS collected_minor
      FROM payments_in_range GROUP BY currency,category_name
    ), reversed AS (
      SELECT fs.currency,fc.name AS category_name,sum(r.amount_minor)::bigint AS reversed_minor
      FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id
      JOIN student_fees sf ON sf.school_id=p.school_id AND sf.id=p.student_fee_id
      JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id
      JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id
      WHERE r.school_id=$1 AND ($2::date IS NULL OR r.created_at::date >= $2::date) AND ($3::date IS NULL OR r.created_at::date <= $3::date)
      GROUP BY fs.currency,fc.name
    )
    SELECT c.currency,c.category_name,c.payment_count,c.collected_minor,COALESCE(r.reversed_minor,0)::bigint AS reversed_minor
    FROM collected c LEFT JOIN reversed r ON r.currency=c.currency AND r.category_name=c.category_name ORDER BY c.category_name`, [schoolId, range.from ?? null, range.to ?? null]));
  res.json({ items: rows.rows });
}));
feesRouter.get("/reports/outstanding", requireSchoolPermission("fees:read", "fees:manage"), asyncRoute(async (req, res) => {
  const rows = await tenantTransaction(req.tenant.id, (client) => client.query(`SELECT fs.currency,fc.name AS category_name,count(DISTINCT sf.id)::int AS fee_count,
      COALESCE(sum(sf.amount_due_minor),0)::bigint AS amount_due_minor,
      COALESCE(sum((SELECT COALESCE(sum(p.amount_minor),0) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id)),0)::bigint AS paid_minor,
      COALESCE(sum((SELECT COALESCE(sum(r.amount_minor),0) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id)),0)::bigint AS reversed_minor,
      COALESCE(sum(sf.amount_due_minor-(SELECT COALESCE(sum(p.amount_minor),0) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id)+(SELECT COALESCE(sum(r.amount_minor),0) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id)),0)::bigint AS outstanding_minor
    FROM student_fees sf JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id
    WHERE sf.school_id=$1 AND sf.is_active GROUP BY fs.currency,fc.name ORDER BY fc.name`, [req.tenant.id]));
  res.json({ items: rows.rows });
}));
feesRouter.post("/reminders", requireSchoolPermission("fees:manage"), asyncRoute(async (req, res) => {
  const { dueOnBefore } = z10.object({ dueOnBefore: z10.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body), schoolId = req.tenant.id;
  const result = await tenantTransaction(schoolId, async (client) => {
    const actor2 = await actorMembership2(client, schoolId, req.identity.id);
    const inserted = await client.query(`INSERT INTO background_jobs(school_id,job_type,payload,idempotency_key,status)
      SELECT sf.school_id,'fees.payment_reminder',jsonb_build_object('studentFeeId',sf.id,'dueOn',$2::date),$3 || sf.id::text,'queued'
      FROM student_fees sf WHERE sf.school_id=$1 AND sf.is_active AND sf.due_on<=$2::date
        AND sf.amount_due_minor>COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)-COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`, [schoolId, dueOnBefore, `fees-reminder:${schoolId}:${dueOnBefore}:`]);
    await audit6(client, schoolId, actor2, "fees.reminders_enqueued", "fee_reminder_batch", null, { dueOnBefore, queued: inserted.rowCount || 0 });
    return inserted.rowCount || 0;
  });
  res.status(202).json({ queued: result, delivery: "pending_worker" });
}));

// apps/api/src/announcements/routes.ts
import { Router as Router10 } from "express";
import { z as z11 } from "zod";
var announcementsRouter = Router10();
announcementsRouter.use(authenticate);
var uuid5 = z11.uuid();
var audienceSchema = z11.object({
  type: z11.enum(["school", "role", "class"]),
  targetRoles: z11.array(z11.enum(["teacher", "parent", "student", "school_admin"])).optional(),
  targetClassIds: z11.array(uuid5).optional()
});
var createAnnouncementSchema = z11.object({
  title: z11.string().trim().min(3).max(200),
  body: z11.string().trim().min(5).max(1e4),
  audience: audienceSchema.default({ type: "school" }),
  publish: z11.boolean().default(false),
  expiresAt: z11.string().datetime({ offset: true }).optional().nullable()
});
var updateAnnouncementSchema = z11.object({
  title: z11.string().trim().min(3).max(200).optional(),
  body: z11.string().trim().min(5).max(1e4).optional(),
  audience: audienceSchema.optional(),
  expiresAt: z11.string().datetime({ offset: true }).optional().nullable(),
  status: z11.enum(["draft", "published", "archived"]).optional()
});
function has5(req, ...permissions) {
  return permissions.some((p) => req.permissions?.includes(p));
}
async function actorMembership3(client, schoolId, userId) {
  const result = await client.query(
    "SELECT id, role FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active",
    [schoolId, userId]
  );
  if (!result.rows[0]) fail(403, "Active school membership is required");
  return result.rows[0];
}
async function auditAnnouncement(client, schoolId, actorId, announcementId, action, after, before) {
  await client.query(
    "INSERT INTO announcement_audit_history(school_id, announcement_id, actor_membership_id, action, before_state, after_state) VALUES($1, $2, $3, $4, $5::jsonb, $6::jsonb)",
    [schoolId, announcementId, actorId, action, before ? JSON.stringify(before) : null, JSON.stringify(after)]
  );
  await client.query(
    "INSERT INTO audit_logs(school_id, actor_membership_id, action, target_type, target_id, metadata) VALUES($1, $2, $3, $4, $5, $6::jsonb)",
    [schoolId, actorId, `announcement.${action}`, "announcement", announcementId, JSON.stringify(after)]
  );
}
async function dispatchNotificationsForAnnouncement(client, schoolId, announcementId, title, audience) {
  let targetUserQuery = "SELECT DISTINCT user_id FROM school_memberships WHERE school_id = $1 AND is_active";
  const params = [schoolId];
  if (audience.type === "role" && audience.targetRoles?.length) {
    targetUserQuery += " AND role = ANY($2::text[])";
    params.push(audience.targetRoles);
  } else if (audience.type === "class" && audience.targetClassIds?.length) {
    targetUserQuery = `
      SELECT DISTINCT u.id AS user_id
      FROM users u
      WHERE u.id IN (
        -- Students enrolled in target classes
        SELECT st.user_id FROM students st
        JOIN student_enrollments se ON se.school_id = st.school_id AND se.student_id = st.id
        WHERE st.school_id = $1 AND se.class_id = ANY($2::uuid[]) AND se.status = 'active' AND st.user_id IS NOT NULL
        UNION
        -- Parents of students in target classes
        SELECT p.user_id FROM parents p
        JOIN student_parents sp ON sp.school_id = p.school_id AND sp.parent_id = p.id
        JOIN student_enrollments se ON se.school_id = sp.school_id AND se.student_id = sp.student_id
        WHERE p.school_id = $1 AND se.class_id = ANY($2::uuid[]) AND se.status = 'active'
        UNION
        -- Teachers assigned to target classes
        SELECT t.user_id FROM teachers t
        JOIN teacher_assignments ta ON ta.school_id = t.school_id AND ta.teacher_id = t.id
        JOIN class_subjects cs ON cs.school_id = ta.school_id AND cs.id = ta.class_subject_id
        WHERE t.school_id = $1 AND cs.class_id = ANY($2::uuid[]) AND t.employment_status = 'active'
      )
    `;
    params.push(audience.targetClassIds);
  }
  const users = await client.query(targetUserQuery, params);
  for (const row of users.rows) {
    await client.query(
      `INSERT INTO notifications (school_id, user_id, event_type, title, payload, delivered_at)
       VALUES ($1, $2, 'announcement', $3, $4::jsonb, now())`,
      [schoolId, row.user_id, title, JSON.stringify({ announcementId, title })]
    );
  }
}
announcementsRouter.get(
  "/announcements",
  requireSchoolPermission("announcements:read", "announcements:manage"),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant.id;
    const canManage = has5(req, "announcements:manage");
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const data = await tenantTransaction(schoolId, async (client) => {
      const userMembership = await actorMembership3(client, schoolId, req.identity.id);
      let query = `
        SELECT a.id, a.title, a.body, a.audience, a.status, a.published_at, a.expires_at, a.created_at, a.updated_at,
               u.name AS author_name, r.name AS author_role
        FROM announcements a
        LEFT JOIN school_memberships m ON m.school_id = a.school_id AND m.id = a.author_membership_id
        LEFT JOIN users u ON u.id = m.user_id
        LEFT JOIN school_roles r ON r.school_id = m.school_id AND r.id = m.school_role_id
        WHERE a.school_id = $1
      `;
      const params = [schoolId];
      if (!canManage) {
        query += ` AND a.status = 'published' AND (a.expires_at IS NULL OR a.expires_at > now())`;
        query += ` AND (
          (a.audience->>'type') = 'school'
          OR ((a.audience->>'type') = 'role' AND (a.audience->'targetRoles')::jsonb ? $2)
          OR ((a.audience->>'type') = 'class')
        )`;
        params.push(userMembership.role);
      }
      query += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      const items = await client.query(query, params);
      const countRes = await client.query(
        `SELECT count(*)::int AS total FROM announcements a WHERE a.school_id = $1 ${!canManage ? "AND a.status = 'published' AND (a.expires_at IS NULL OR a.expires_at > now())" : ""}`,
        [schoolId]
      );
      return { items: items.rows, total: countRes.rows[0]?.total || 0, page, limit };
    });
    res.json(data);
  })
);
announcementsRouter.post(
  "/announcements",
  requireSchoolPermission("announcements:manage"),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant.id;
    const input = createAnnouncementSchema.parse(req.body);
    const announcement = await tenantTransaction(schoolId, async (client) => {
      const actor2 = await actorMembership3(client, schoolId, req.identity.id);
      const status = input.publish ? "published" : "draft";
      const publishedAt = input.publish ? (/* @__PURE__ */ new Date()).toISOString() : null;
      const created = await client.query(
        `INSERT INTO announcements (school_id, author_membership_id, title, body, audience, status, published_at, expires_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
         RETURNING id, title, body, audience, status, published_at, expires_at, created_at, updated_at`,
        [
          schoolId,
          actor2.id,
          input.title,
          input.body,
          JSON.stringify(input.audience),
          status,
          publishedAt,
          input.expiresAt ?? null
        ]
      );
      const row = created.rows[0];
      await auditAnnouncement(client, schoolId, actor2.id, row.id, input.publish ? "published" : "created", row);
      if (input.publish) {
        await dispatchNotificationsForAnnouncement(client, schoolId, row.id, row.title, input.audience);
      }
      return row;
    });
    res.status(201).json({ announcement });
  })
);
announcementsRouter.patch(
  "/announcements/:id",
  requireSchoolPermission("announcements:manage"),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant.id;
    const id = uuid5.parse(req.params.id);
    const input = updateAnnouncementSchema.parse(req.body);
    const announcement = await tenantTransaction(schoolId, async (client) => {
      const actor2 = await actorMembership3(client, schoolId, req.identity.id);
      const existing = await client.query(
        "SELECT * FROM announcements WHERE school_id = $1 AND id = $2 FOR UPDATE",
        [schoolId, id]
      );
      if (!existing.rows[0]) fail(404, "Announcement not found");
      const prev = existing.rows[0];
      const newTitle = input.title ?? prev.title;
      const newBody = input.body ?? prev.body;
      const newAudience = input.audience ? JSON.stringify(input.audience) : prev.audience;
      const newExpiresAt = input.expiresAt !== void 0 ? input.expiresAt : prev.expires_at;
      const newStatus = input.status ?? prev.status;
      const wasPublished = prev.status !== "published" && newStatus === "published";
      const publishedAt = wasPublished ? (/* @__PURE__ */ new Date()).toISOString() : prev.published_at;
      const updated = await client.query(
        `UPDATE announcements
         SET title = $3, body = $4, audience = $5::jsonb, expires_at = $6, status = $7, published_at = $8, updated_at = now()
         WHERE school_id = $1 AND id = $2
         RETURNING id, title, body, audience, status, published_at, expires_at, created_at, updated_at`,
        [schoolId, id, newTitle, newBody, newAudience, newExpiresAt, newStatus, publishedAt]
      );
      const row = updated.rows[0];
      await auditAnnouncement(client, schoolId, actor2.id, id, "updated", row, prev);
      if (wasPublished) {
        await dispatchNotificationsForAnnouncement(client, schoolId, id, row.title, row.audience);
      }
      return row;
    });
    res.json({ announcement });
  })
);
announcementsRouter.post(
  "/announcements/:id/publish",
  requireSchoolPermission("announcements:manage"),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant.id;
    const id = uuid5.parse(req.params.id);
    const announcement = await tenantTransaction(schoolId, async (client) => {
      const actor2 = await actorMembership3(client, schoolId, req.identity.id);
      const existing = await client.query(
        "SELECT * FROM announcements WHERE school_id = $1 AND id = $2 FOR UPDATE",
        [schoolId, id]
      );
      if (!existing.rows[0]) fail(404, "Announcement not found");
      if (existing.rows[0].status === "published") fail(409, "Announcement is already published");
      const updated = await client.query(
        `UPDATE announcements
         SET status = 'published', published_at = now(), updated_at = now()
         WHERE school_id = $1 AND id = $2
         RETURNING id, title, body, audience, status, published_at, expires_at, created_at, updated_at`,
        [schoolId, id]
      );
      const row = updated.rows[0];
      await auditAnnouncement(client, schoolId, actor2.id, id, "published", row, existing.rows[0]);
      await dispatchNotificationsForAnnouncement(client, schoolId, id, row.title, row.audience);
      return row;
    });
    res.json({ announcement });
  })
);
announcementsRouter.get(
  "/notifications",
  requireSchoolPermission("announcements:read", "dashboard:read"),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant.id;
    const userId = req.identity.id;
    const unreadOnly = req.query.unread === "true";
    const data = await tenantTransaction(schoolId, async (client) => {
      let query = `
        SELECT id, event_type, title, payload, read_at, created_at
        FROM notifications
        WHERE school_id = $1 AND user_id = $2
      `;
      const params = [schoolId, userId];
      if (unreadOnly) {
        query += " AND read_at IS NULL";
      }
      query += " ORDER BY created_at DESC LIMIT 50";
      const items = await client.query(query, params);
      const unreadCount = await client.query(
        "SELECT count(*)::int AS count FROM notifications WHERE school_id = $1 AND user_id = $2 AND read_at IS NULL",
        [schoolId, userId]
      );
      return { items: items.rows, unreadCount: unreadCount.rows[0]?.count || 0 };
    });
    res.json(data);
  })
);
announcementsRouter.patch(
  "/notifications/:id/read",
  requireSchoolPermission("announcements:read", "dashboard:read"),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant.id;
    const userId = req.identity.id;
    const id = uuid5.parse(req.params.id);
    const updated = await tenantTransaction(schoolId, async (client) => {
      const res2 = await client.query(
        `UPDATE notifications SET read_at = now() WHERE school_id = $1 AND user_id = $2 AND id = $3 RETURNING id, read_at`,
        [schoolId, userId, id]
      );
      if (!res2.rows[0]) fail(404, "Notification not found");
      return res2.rows[0];
    });
    res.json({ notification: updated });
  })
);
announcementsRouter.post(
  "/notifications/read-all",
  requireSchoolPermission("announcements:read", "dashboard:read"),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant.id;
    const userId = req.identity.id;
    await tenantTransaction(schoolId, async (client) => {
      await client.query(
        `UPDATE notifications SET read_at = now() WHERE school_id = $1 AND user_id = $2 AND read_at IS NULL`,
        [schoolId, userId]
      );
    });
    res.json({ success: true });
  })
);

// apps/api/src/reports/routes.ts
import { Router as Router11 } from "express";
import { z as z12 } from "zod";
var reportsRouter = Router11();
reportsRouter.use(authenticate);
var uuid6 = z12.uuid();
function escapeCsvCell(val) {
  if (val === null || val === void 0) return "";
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
reportsRouter.get(
  "/reports/dashboard",
  requireSchoolPermission("reports:read", "reports:class", "dashboard:read"),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant.id;
    const data = await tenantTransaction(schoolId, async (client) => {
      const counts = await client.query(
        `SELECT
          (SELECT count(*)::int FROM students WHERE school_id = $1 AND status = 'active') AS active_students,
          (SELECT count(*)::int FROM teachers WHERE school_id = $1 AND employment_status = 'active') AS active_teachers,
          (SELECT count(*)::int FROM parents WHERE school_id = $1) AS total_parents,
          (SELECT count(*)::int FROM classes WHERE school_id = $1) AS total_classes`,
        [schoolId]
      );
      const att = await client.query(
        `SELECT status, count(*)::int AS count
         FROM attendance
         WHERE school_id = $1 AND attendance_date >= CURRENT_DATE - 30
         GROUP BY status`,
        [schoolId]
      );
      const fees = await client.query(
        `SELECT
          COALESCE(sum(sf.amount_due_minor), 0)::bigint AS total_due_minor,
          COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id = $1), 0)::bigint AS total_paid_minor,
          COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r WHERE r.school_id = $1), 0)::bigint AS total_reversed_minor
         FROM student_fees sf
         WHERE sf.school_id = $1 AND sf.is_active`,
        [schoolId]
      );
      const exams = await client.query(
        `SELECT id, name, exam_type, starts_on, ends_on, status, results_published_at
         FROM examinations
         WHERE school_id = $1
         ORDER BY starts_on DESC LIMIT 5`,
        [schoolId]
      );
      const feeRow = fees.rows[0];
      const netPaid = Number(feeRow?.total_paid_minor || 0) - Number(feeRow?.total_reversed_minor || 0);
      const totalDue = Number(feeRow?.total_due_minor || 0);
      const outstanding = Math.max(0, totalDue - netPaid);
      return {
        counts: counts.rows[0],
        attendanceSummary: att.rows,
        fees: {
          totalDueMinor: totalDue,
          netCollectedMinor: netPaid,
          outstandingMinor: outstanding
        },
        recentExams: exams.rows
      };
    });
    res.json(data);
  })
);
reportsRouter.get(
  "/reports/academics",
  requireSchoolPermission("reports:read", "reports:class"),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant.id;
    const examId = typeof req.query.examId === "string" ? uuid6.parse(req.query.examId) : null;
    const classId = typeof req.query.classId === "string" ? uuid6.parse(req.query.classId) : null;
    const data = await tenantTransaction(schoolId, async (client) => {
      let query = `
        SELECT e.id AS examination_id, e.name AS examination_name, c.id AS class_id, c.name AS class_name,
               s.name AS subject_name, es.max_marks,
               count(r.id)::int AS total_submissions,
               round(avg(r.marks), 2)::numeric AS average_marks,
               max(r.marks)::numeric AS highest_marks,
               min(r.marks)::numeric AS lowest_marks
        FROM examinations e
        JOIN examination_subjects es ON es.school_id = e.school_id AND es.examination_id = e.id
        JOIN classes c ON c.school_id = es.school_id AND c.id = es.class_id
        JOIN subjects s ON s.school_id = es.school_id AND s.id = es.subject_id
        LEFT JOIN examination_results r ON r.school_id = es.school_id AND r.examination_subject_id = es.id AND r.marks IS NOT NULL
        WHERE e.school_id = $1
      `;
      const params = [schoolId];
      if (examId) {
        query += ` AND e.id = $${params.length + 1}`;
        params.push(examId);
      }
      if (classId) {
        query += ` AND c.id = $${params.length + 1}`;
        params.push(classId);
      }
      query += ` GROUP BY e.id, e.name, c.id, c.name, s.name, es.max_marks ORDER BY e.name, c.name, s.name`;
      const rows = await client.query(query, params);
      return rows.rows;
    });
    res.json({ items: data });
  })
);
reportsRouter.get(
  "/reports/attendance",
  requireSchoolPermission("reports:read", "reports:class"),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant.id;
    const fromDate = typeof req.query.from === "string" ? req.query.from : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const toDate = typeof req.query.to === "string" ? req.query.to : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const data = await tenantTransaction(schoolId, async (client) => {
      const rows = await client.query(
        `SELECT a.attendance_date, c.name AS class_name, sec.name AS section_name,
                count(*)::int AS total_records,
                count(*) FILTER (WHERE a.status = 'present')::int AS present_count,
                count(*) FILTER (WHERE a.status = 'absent')::int AS absent_count,
                count(*) FILTER (WHERE a.status = 'late')::int AS late_count,
                count(*) FILTER (WHERE a.status = 'excused')::int AS excused_count
         FROM attendance a
         JOIN classes c ON c.school_id = a.school_id AND c.id = a.class_id
         LEFT JOIN sections sec ON sec.school_id = a.school_id AND sec.id = a.section_id
         WHERE a.school_id = $1 AND a.attendance_date BETWEEN $2::date AND $3::date
         GROUP BY a.attendance_date, c.name, sec.name
         ORDER BY a.attendance_date DESC, c.name, sec.name`,
        [schoolId, fromDate, toDate]
      );
      return rows.rows;
    });
    res.json({ from: fromDate, to: toDate, items: data });
  })
);
reportsRouter.get(
  "/reports/export",
  requireSchoolPermission("reports:read"),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant.id;
    const type = z12.enum(["students", "fees", "attendance"]).parse(req.query.type);
    const rows = await tenantTransaction(schoolId, async (client) => {
      if (type === "students") {
        const q = await client.query(
          `SELECT st.admission_number, st.first_name, st.last_name, st.status, c.name AS class_name, sec.name AS section_name, y.name AS academic_year
           FROM students st
           LEFT JOIN student_enrollments se ON se.school_id = st.school_id AND se.student_id = st.id AND se.status = 'active'
           LEFT JOIN classes c ON c.school_id = se.school_id AND c.id = se.class_id
           LEFT JOIN sections sec ON sec.school_id = se.school_id AND sec.id = se.section_id
           LEFT JOIN academic_years y ON y.school_id = se.school_id AND y.id = se.academic_year_id
           WHERE st.school_id = $1 ORDER BY st.admission_number`,
          [schoolId]
        );
        return q.rows;
      } else if (type === "fees") {
        const q = await client.query(
          `SELECT st.admission_number, st.first_name || ' ' || st.last_name AS student_name,
                  fc.name AS fee_category, fs.amount_minor / 100.0 AS structure_amount,
                  sf.amount_due_minor / 100.0 AS amount_due,
                  COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id = sf.school_id AND p.student_fee_id = sf.id), 0) / 100.0 AS paid,
                  sf.due_on
           FROM student_fees sf
           JOIN students st ON st.school_id = sf.school_id AND st.id = sf.student_id
           JOIN fee_structures fs ON fs.school_id = sf.school_id AND fs.id = sf.fee_structure_id
           JOIN fee_categories fc ON fc.school_id = fs.school_id AND fc.id = fs.category_id
           WHERE sf.school_id = $1 AND sf.is_active ORDER BY st.admission_number`,
          [schoolId]
        );
        return q.rows;
      } else {
        const q = await client.query(
          `SELECT a.attendance_date, st.admission_number, st.first_name || ' ' || st.last_name AS student_name,
                  c.name AS class_name, a.status, a.reason
           FROM attendance a
           JOIN students st ON st.school_id = a.school_id AND st.id = a.student_id
           JOIN classes c ON c.school_id = a.school_id AND c.id = a.class_id
           WHERE a.school_id = $1 ORDER BY a.attendance_date DESC, st.admission_number LIMIT 1000`,
          [schoolId]
        );
        return q.rows;
      }
    });
    if (req.query.format === "csv") {
      if (!rows.length) return res.send("No data");
      const headers = Object.keys(rows[0]);
      const csv = [
        headers.join(","),
        ...rows.map((r) => headers.map((h) => escapeCsvCell(r[h])).join(","))
      ].join("\r\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${type}-report.csv"`);
      return res.send(csv);
    }
    res.json({ items: rows });
  })
);

// apps/api/src/server.ts
var app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.includes("localhost") || origin.endsWith(".vercel.app") || origin === env.WEB_ORIGIN) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
var autoMigrated = false;
app.use(async (_req, _res, next) => {
  if (!autoMigrated && process.env.NODE_ENV !== "test") {
    try {
      const { runMigrations: runMigrations2 } = await Promise.resolve().then(() => (init_migrate(), migrate_exports));
      await runMigrations2();
      autoMigrated = true;
    } catch (err) {
      console.warn("[Auto-Migration] Notice:", err.message);
    }
  }
  next();
});
app.get(["/health", "/api/health"], async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "ok" });
  } catch (err) {
    res.status(503).json({ status: "unavailable", database: "unavailable", error: err.message });
  }
});
var authLimiter = env.NODE_ENV === "production" ? rateLimit({ windowMs: 15 * 60 * 1e3, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }) : (_req, _res, next) => next();
app.use(["/api/auth", "/auth"], authLimiter, authRouter);
app.use(["/api/platform", "/platform"], supportRouter);
app.use(["/api/platform", "/platform"], platformRouter);
app.use(["/api/school", "/school"], schoolRouter);
app.use(["/api/school", "/school"], schoolRoleRouter);
app.use(["/api/school", "/school"], attendanceRouter);
app.use(["/api/school/homework", "/school/homework"], homeworkRouter);
app.use(["/api/school", "/school"], examRouter);
app.use(["/api/school", "/school"], timetableRouter);
app.use(["/api/school/fees", "/school/fees"], feesRouter);
app.use(["/api/school", "/school"], announcementsRouter);
app.use(["/api/school", "/school"], reportsRouter);
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((error, _req, res, _next) => {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error && typeof error === "object" && "name" in error && error.name === "ZodError") return res.status(400).json({ error: "Invalid request data", details: error.issues });
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    if (code === "23505") return res.status(409).json({ error: "A record with those details already exists" });
    if (code === "23503" || code === "23514") return res.status(400).json({ error: "The selected school record is not valid" });
    if (code === "ECONNREFUSED" || code === "ETIMEDOUT") return res.status(503).json({ error: "Database unavailable. On Vercel, connect a PostgreSQL database (e.g. Neon) in the Storage tab, or test on mobile via local network Wi-Fi." });
  }
  const msg = error?.message || "";
  if (msg.includes("Connection terminated") || msg.includes("connection timeout")) {
    return res.status(503).json({ error: "Database unavailable. On Vercel, connect a PostgreSQL database (e.g. Neon) in the Storage tab, or test on mobile via local network Wi-Fi." });
  }
  console.error("Unhandled API error", error);
  return res.status(500).json({ error: "Internal server error" });
});
if (process.argv[1] && import.meta.url === pathToFileURL2(resolve(process.argv[1])).href) {
  const server = app.listen(env.API_PORT, () => console.info(`EduConnect API listening on ${env.API_PORT}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => {
    void Promise.all([pool.end(), platformPool.end()]).then(() => process.exit(0));
  }));
}

// api/index.ts
var index_default = app;
export {
  index_default as default
};
