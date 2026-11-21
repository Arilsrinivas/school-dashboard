# EduConnect Infrastructure Verification

**Verification date:** 2026-11-21
**Branch:** `codex/firebase-production-release`
**Implementation commit:** `d0112f797074257eb2b1cbd2a787c04e9ca20e13`
**Database:** Supabase project `jnhcomdjezlvmxpjkoot`, PostgreSQL 17.12, database `postgres`
**Overall status:** PostgreSQL schema and tenant controls are live and verified. First administrator provisioning, Firebase live checks, and separate Vercel project setup remain blocked on provider configuration.

## Results at a glance

| Item | Classification | Evidence |
|---|---|---|
| Root CA file and strict TLS | **Verified** | `.secrets/supabase-root.crt` exists, is readable, and was used with `rejectUnauthorized: true`; the certificate parses as a CA and is valid through 2031-04-26. |
| EduConnect target database | **Verified** | The Supabase pooler username included the supplied project reference; live sessions returned database `postgres` and PostgreSQL `17.12`. The session pooler at port `5432` and transaction pooler at port `6543` both connected with certificate verification. |
| Consolidated initial schema | **Verified** | `npm --prefix apps/api run db:migrate` applied `apps/api/schema/educonnect.initial.sql` successfully once to the empty public schema. The code does not replay migrations 001–013 individually. |
| Runtime database roles | **Verified** | `educonnect_app` and `educonnect_platform` are login roles with `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, and no inherited role memberships. |
| RLS and tenant isolation | **Verified** | Catalog inspection found 68 public tables, all with RLS enabled and forced. All 57 tables with `school_id` have a tenant policy. Live two-tenant read/insert/update/delete and missing-context checks passed. |
| Supabase REST role access | **Verified** | `anon`, `authenticated`, and `service_role` have no table/sequence privileges on application data and receive no such defaults for future objects. Runtime access is through the EduConnect API roles. |
| API database connectivity | **Verified** | Local API `/health` returned `status=ok`, `database=ok`, and `platformDatabase=ok` using the configured application pools. |
| Initial CalmStacks Super Admin | **Blocked** | Firebase Admin credentials, `AUTH_PROVIDER=firebase`, and a verified Firebase UID are not configured locally. The bootstrap was not run and no platform user exists. |
| Firebase live identity/storage | **Not configured / not verified** | No Firebase Admin service-account JSON, project ID, or storage bucket configuration is present in the ignored local env files. No live Firebase request or bucket operation was performed. |
| Isolated EduConnect Vercel project | **Not configured** | No separate Vercel project was verified or deployed from this workspace. |
| Existing Schoollog database/deployment | **Untouched** | No Schoollog connection, migration, record copy, push, merge, or deployment occurred. |

## Database identity, TLS, and connection configuration

The correct certificate file is `C:\Users\User\Desktop\school web\.secrets\supabase-root.crt`. It is ignored by Git. The ignored root `.env` and `apps/api/.env` now point at the same EduConnect project and use:

- `DATABASE_URL`: `educonnect_app` through the transaction pooler (port `6543`)
- `PLATFORM_DATABASE_URL`: `educonnect_platform` through the transaction pooler (port `6543`)
- `MIGRATION_DATABASE_URL`: managed `postgres` migration identity through the session pooler (port `5432`)
- `DATABASE_SSL_CA_CERT_PATH`: the local CA certificate path
- `EDUCONNECT_DATABASE_PROJECT_REF`: `jnhcomdjezlvmxpjkoot`

No credentials are included here or in Git. All three connection identities were checked by role, database, port, and project-qualified pooler username. The managed `postgres` identity has elevated RLS bypass capability, so it is reserved for schema work and is not used as either runtime role. Runtime requests use the two separately verified, non-BYPASSRLS logins.

## Schema review and execution

All source files `001_initial.sql` through `013_private_file_storage.sql` were reviewed in order. No `DROP TABLE`, `DROP SCHEMA`, `DROP DATABASE`, or persistent data deletion was found. The consolidated script includes a constraint removal after that constraint is created earlier in the same fresh-install script, and a policy replacement that follows creation of the original policy. Existing operation migrations contain data backfills, but the target had no application records. The schema inserts only platform role/permission definitions and the built-in Trial subscription plan; it creates no school, student, staff, parent, or administrator records.

The first guarded migration attempt rolled back without creating schema: Supabase's managed `postgres` role cannot alter role attributes. The initial schema and migration 012 were corrected to validate pre-provisioned least-privilege roles instead of trying to modify them. The migration was then run successfully once. The consolidated SQL now also grants runtime DML under RLS, revokes direct table/sequence access from Supabase's `anon`, `authenticated`, and `service_role` roles, removes their default privileges for future tables, and removes public-schema `CREATE` access. Those grants and revocations were applied to the live EduConnect database and checked afterward.

## Live PostgreSQL security evidence

Command executed:

```text
npm --prefix apps/api run db:verify-live-tenant
```

Actual result:

```text
PASS: PostgreSQL 17.12; 57 tenant tables; two-tenant read/insert/update/delete denial; missing-context denial; same-connection tenant context reset; temporary records rolled back.
```

The verifier checks the project-qualified migration URL, strict CA-based TLS, both runtime role attributes and inherited memberships, every public table's RLS state, and every `school_id` table's tenant policy. It inserts two temporary schools and students inside a transaction, switches into the actual runtime role identities for the policy checks, and always rolls the transaction back. It also calls the application's `tenantTransactionUsing` helper through the real `educonnect_app` pool, verifies that the same backend connection is reused, and confirms the prior tenant context is absent before the next request context is set.

After the check, database queries confirmed `schools=0`, `students=0`, `users=0`, and `platform_users=0`; the temporary grant of runtime-role membership to the managed migration identity was also rolled back. Catalog checks confirmed the three Supabase API roles have zero table privileges and no future table/sequence ACLs. This provides live PostgreSQL evidence; PGlite results are reported separately below.

## Build and regression results

| Command | Result | Scope |
|---|---|---|
| `npm --prefix apps/api run db:migrate` | **Passed** | Applied only the consolidated fresh-install schema on the verified new database. |
| `npm --prefix apps/api run db:verify-live-tenant` | **Passed** | Real PostgreSQL 17.12, TLS, roles, grants, RLS, cross-school denial, missing tenant context, rollback, and pool reuse. |
| `npm --prefix apps/api test` | **Passed: 17/17** | Application integration suites run on PGlite; useful regression evidence, not live database evidence. |
| `npm --prefix apps/api run build` | **Passed** | TypeScript production build. |
| `npm --prefix apps/api run test:e2e` | **Passed: 1/1, 14 lifecycle phases** | PGlite E2E workflow; not a live Firebase or production deployment test. |
| Local API `GET /health` | **Passed** | Both real application database pools returned healthy. |

## Bootstrap and exact remaining operator actions

The one-time bootstrap code is present and does not use a fixed or public administrator password. It requires a Firebase user with a verified email that matches `BOOTSTRAP_ADMIN_EMAIL`. Its bootstrap record receives a random unusable legacy password hash and a Firebase UID link.

To complete the first administrator setup:

1. In Firebase project `educonnect-44f2b`, create or identify a dedicated email-verified administrator account and obtain its Firebase UID.
2. Add `AUTH_PROVIDER=firebase`, `FIREBASE_PROJECT_ID=educonnect-44f2b`, and the server-only `FIREBASE_SERVICE_ACCOUNT_JSON` to the local ignored environment and later the isolated Vercel project's server environment. Do not use a `VITE_` variable for Admin credentials.
3. Set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_FIREBASE_UID`, and `BOOTSTRAP_ADMIN_NAME` to that same verified Firebase identity.
4. Run `npm --prefix apps/api run db:bootstrap-admin` once, then remove bootstrap-only configuration as appropriate. Confirm one row exists in `platform_users` and its external Firebase identity is linked.

No `platform_users` row has been created yet. Do not treat Firebase authentication or Super Admin access as operational until this action is completed and the bootstrap output is verified.

## Remaining launch blockers

- Firebase Admin environment and a verified bootstrap Firebase UID are not configured, so the first platform administrator is not provisioned.
- Firebase Cloud Storage bucket configuration, Storage Rules Emulator tests, and real bucket upload/download denial checks remain unverified.
- An isolated EduConnect Vercel project and its environment scopes have not been configured or verified.
- The live database smoke test verified schema-level school creation and tenant isolation inside a rolled-back transaction; it did not create a persistent school or exercise an authenticated production school-creation API request.
- No backup/restore test, production deployment, live Firebase authentication test, or live object-storage test was performed in this provisioning run.

No push, merge, or deployment was performed. The existing Schoollog database and deployment were not contacted or modified.
