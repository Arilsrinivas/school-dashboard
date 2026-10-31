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
