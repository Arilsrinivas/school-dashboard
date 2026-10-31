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

