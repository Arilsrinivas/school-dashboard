-- Runtime roles are provisioned by the operator before schema initialization.
-- Supabase's managed postgres role is not a PostgreSQL superuser and cannot
-- change managed role attributes, so fail closed if either role is missing or
-- has privileges that would defeat tenant RLS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname='educonnect_app' AND rolcanlogin AND NOT rolsuper
       AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit
       AND NOT rolbypassrls AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'educonnect_app must be provisioned as a least-privilege, non-BYPASSRLS login before schema initialization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname='educonnect_platform' AND rolcanlogin AND NOT rolsuper
       AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit
       AND NOT rolbypassrls AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'educonnect_platform must be provisioned as a least-privilege, non-BYPASSRLS login before schema initialization';
  END IF;
END $$;

-- Provider-managed `postgres` owns the initial schema. Grant only DML needed
-- by the APIs; row-level policies remain the authority for row visibility.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO educonnect_app, educonnect_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO educonnect_app, educonnect_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO educonnect_app, educonnect_platform;
DO $$
DECLARE api_role text;
BEGIN
  -- EduConnect uses its own API and Firebase identity. Supabase's PostgREST
  -- roles must not receive a second, direct path to school records.
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', api_role);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', api_role);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I', api_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I', api_role);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO educonnect_app, educonnect_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO educonnect_app, educonnect_platform;

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
