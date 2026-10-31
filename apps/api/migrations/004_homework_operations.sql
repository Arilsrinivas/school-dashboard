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
