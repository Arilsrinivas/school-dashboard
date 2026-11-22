# EduConnect Infrastructure Verification

**Verification date:** 2026-11-22
**Branch:** `codex/firebase-production-release`
**Storage implementation commit:** `983dabedb23f75a8d56e4baf0969b12470709527`
**Database:** Supabase project `jnhcomdjezlvmxpjkoot`, PostgreSQL 17.12, database `postgres`
**Overall status:** PostgreSQL tenant controls, Firebase authentication/admin provisioning (from prior live verification), and local Supabase Storage are verified. A separate EduConnect Vercel project and deployment remain unverified; no deployment was performed.

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
| Initial CalmStacks Super Admin | **Verified (prior live check)** | The first platform administrator was provisioned through the one-time Firebase-linked bootstrap and its platform access was verified. No school membership was added for the platform account. |
| Firebase live identity | **Verified (prior live check)** | Google sign-in and Firebase Admin ID-token verification for project `educonnect-44f2b` were completed previously. This storage verification used local legacy-signed test tokens for the API tenant checks; it was not another Firebase sign-in test. |
| Supabase Storage buckets | **Verified** | Created `student-documents`, `profile-images`, `assignments`, and `school-documents`; live bucket metadata confirmed all are private, have the 10 MiB cap, and match the documented MIME allowlists. |
| Supabase Storage policies | **Verified** | Live PostgreSQL `pg_policies` inspection found no `storage.objects` policies granting access to `PUBLIC`, `anon`, or `authenticated`. Unsigned direct object requests were denied for each bucket. |
| Supabase Storage backend authorization and file operations | **Verified** | Live API test used actual PostgreSQL runtime roles and the actual Supabase provider: authorized upload, tenant-derived metadata, signed download, deletion, unauthenticated denial, and School A/B upload/read/delete denial passed. Disposable test rows and objects were cleaned up. |
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

The first guarded migration attempt rolled back without creating schema: Supabase's managed `postgres` role cannot alter role attributes. The initial schema and migration 012 were corrected to validate pre-provisioned least-privilege roles instead of trying to modify them. The migration was then run successfully once. The consolidated SQL now also grants runtime DML under RLS, revokes direct table/sequence access from Supabase's `anon`, `authenticated`, and `service_role` roles, removes their default privileges for future tables, and removes public-schema `CREATE` access. Those grants and revocations were applied to the live EduConnect database and checked afterward. The Firebase-specific `uploaded_files` metadata columns briefly added during the earlier storage implementation were removed by migration 015 after confirming that table contained zero application rows; the original file metadata schema is retained.

## Live Supabase Storage evidence

The following commands were run locally against the configured EduConnect Supabase project. The provisioning command created all four private buckets. `npm run test:storage:live --workspace apps/api` passed real upload, 120-second signed download, unsigned denial, and deletion checks for each bucket. The live API test (`npm run test:storage:api:live --workspace apps/api`, with `EDUCONNECT_DATABASE_PROJECT_REF=jnhcomdjezlvmxpjkoot`, `EDUCONNECT_STORAGE_API_LIVE_TEST=1`, and `AUTH_PROVIDER=legacy`) checked both actual database runtime roles, private bucket configuration, MIME and size policies, and the absence of client-role `storage.objects` policies. It then exercised the backend authorization path against actual PostgreSQL and Supabase: unauthenticated access and a School B request for School A's student/file were denied, the forged client `schoolId` did not affect School A's database object path, file metadata was correct, authorized upload/download/delete succeeded, and test tenants/users/files were removed. No pre-existing school, student, or user rows were updated or deleted. This local test does not verify a deployed Vercel environment.

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
| `npm --prefix apps/api run storage:provision:supabase` | **Passed** | Created all four private EduConnect buckets with the configured 10 MiB size cap and MIME restrictions. |
| `SUPABASE_STORAGE_LIVE_TEST=1 npm --prefix apps/api run test:storage:live` | **Passed** | Actual Supabase provider upload, signed download, unsigned access denial, and deletion across all four buckets. |
| `EDUCONNECT_STORAGE_API_LIVE_TEST=1 npm --prefix apps/api run test:storage:api:live` | **Passed** | Actual Supabase PostgreSQL and Storage API authorization, metadata, file lifecycle, and cross-school denial; disposable test rows/objects cleaned up. |
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

- An isolated EduConnect Vercel project and its environment scopes have not been configured or verified.
- No backup/restore test or deployment verification was performed during this storage provisioning run.

No push, merge, or deployment was performed. The existing Schoollog database and deployment were not contacted or modified.
