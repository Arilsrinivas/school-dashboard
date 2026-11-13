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
