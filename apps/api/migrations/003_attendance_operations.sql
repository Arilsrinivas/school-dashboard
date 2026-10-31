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

