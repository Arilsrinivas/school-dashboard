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
