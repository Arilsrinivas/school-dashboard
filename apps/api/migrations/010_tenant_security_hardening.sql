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
