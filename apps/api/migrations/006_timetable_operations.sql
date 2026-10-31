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
