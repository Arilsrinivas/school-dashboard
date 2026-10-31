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
