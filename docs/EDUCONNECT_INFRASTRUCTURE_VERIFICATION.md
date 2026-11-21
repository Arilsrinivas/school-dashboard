# EduConnect Infrastructure Verification

**Date:** 2026-11-21
**Code revision:** `49585fe1f183e1216e6989934f382a8d5667aa90`
**Branch:** `codex/firebase-production-release`
**Decision:** Infrastructure is not provisioned or production-verified. No remote infrastructure, database, deployment or records were modified.

## Resource inventory

| Resource/check | Classification | Evidence |
|---|---|---|
| EduConnect application code | **Verified** | Worktree is on the stated branch and commit; build and local suites passed below. |
| Existing Schoollog repository/deployment association | **Verified** | `git remote -v` points to `https://github.com/Arilsrinivas/school-dashboard.git`; repository history identifies the existing `school-dashboard` project. No changes were made to it. |
| Separate Vercel project | **Not configured** | `Test-Path .vercel/project.json` returned `False`; Vercel CLI is not installed and no Vercel-related environment variables are present in the current process. Project dashboard access cannot be verified from this workspace. |
| New EduConnect PostgreSQL instance | **Blocked** | No PostgreSQL CLI (`psql`, `postgres`, `pg_ctl`) is installed, Docker daemon is unavailable, and no database URL is present in the current process. `.env` exists but is ignored; its values were not read. Its identity and safety therefore cannot be established. |
| Existing Schoollog database | **Untouched** | No database connection was attempted. No migrations or bootstrap commands were run. |
| Firebase project selection | **Implemented but not verified** | Application defaults and setup docs name `educonnect-44f2b`; `firebase.json` points to `storage.rules`. Firebase CLI is not installed, and no Firebase credentials/config values are present in the current process. |
| Firebase Admin SDK local wiring | **Implemented but not verified live** | Unit/integration tests initialize Admin with a generated ephemeral key and inject a test token verifier. They do not contact Firebase or verify a real project service account or ID token. |
| Firebase Cloud Storage bucket | **Not configured** | No bucket name is available in the current process; no Firebase CLI or authenticated provider access is available to inspect or create one. |
| Firebase Storage Rules | **Implemented but not verified** | `storage.rules` is included by `firebase.json`. Firebase CLI/Rules Emulator are unavailable, so rules were neither compiled nor exercised. |
| Initial CalmStacks Super Admin | **Not configured** | Bootstrap utility exists (`npm run db:bootstrap-admin`), but no verified fresh DB or one-time secret is available. It was not run. No public administrator registration was enabled. |
| Fresh schema, least-privilege roles and RLS | **Implemented but not verified on PostgreSQL** | Migrations 001–013 and the guarded verifier exist. No database was available. PGlite runs are not accepted as actual PostgreSQL proof. |

## Fresh PostgreSQL provisioning attempt (2026-11-21)

The supplied project reference is `jnhcomdjezlvmxpjkoot` and the operator reports PostgreSQL 17.12, database `postgres`, zero public application tables, and exclusive EduConnect intent. These provider facts are user-supplied; they were not independently confirmed through Supabase.

Before any connection, I inspected the configured URL without emitting its credentials. The ignored local `.env` currently resolves to host `127.0.0.1` and database `postgres`; the expected project reference was absent. The current process has no `DATABASE_URL`. **The target could not be positively verified, so no database connection or SQL was attempted and no migration ran.** The local `.env` was not changed, and no connection string or credential was printed or committed. The prior Schoollog database was not contacted.

### Migration review, execution order 001–013

| Migration | Review findings | Execution result |
|---|---|---|
| `001_initial.sql` | Creates `pgcrypto`, sequence, base platform/school/identity/academic/finance tables, indexes, enums, and initial RLS policies. Requires permission to create the extension if unavailable. | **Not run** |
| `002_school_authority.sql` | Adds school role/permission authority, constraints, triggers/functions and role backfill `UPDATE`s. Assumes base schema and appropriate schema privileges. | **Not run** |
| `003_attendance_operations.sql` | Adds attendance/history structures, policies, indexes and mutation-protection trigger/function. | **Not run** |
| `004_homework_operations.sql` | Adds assignments/submissions/attachments/audit structures, policies and append-only protection. | **Not run** |
| `005_examinations_operations.sql` | Adds exam/results/grading structures and performs a data backfill `UPDATE` from examination rows. | **Not run** |
| `006_timetable_operations.sql` | Adds periods/audit structures and backfills class/academic-year fields with `UPDATE`s. | **Not run** |
| `007_fees_operations.sql` | Adds fees, receipt sequences and immutable payment/reversal triggers; includes tenant policies. | **Not run** |
| `008_announcements_operations.sql` | Adds notification/audit fields, uses `DROP POLICY IF EXISTS` then recreates the tenant policy, and adds foreign keys/indexes. Review this policy replacement against the fresh target before execution. | **Not run** |
| `009_external_identities.sql` | Adds OAuth/Firebase UID mapping, nullable legacy password support and RLS. No memberships are created. | **Not run** |
| `010_tenant_security_hardening.sql` | Applies FORCE RLS to a fixed table list, adds a permission, indexes and child-consent table/policy. Requires each listed relation to exist. | **Not run** |
| `011_operations_rls_hardening.sql` | Enables and forces RLS on later-added tenant tables; assumes preceding migrations created all listed tables. | **Not run** |
| `012_runtime_role_rls.sql` | Alters `educonnect_app`/`educonnect_platform` only if they already exist; it does **not create them**. Forces RLS on existing RLS tables, adds a platform-only policy, and fails if any `school_id` table lacks a tenant policy. Manual role/grant review is required for Supabase. | **Not run** |
| `013_private_file_storage.sql` | Adds file metadata status/display fields and an index; no object bytes or external data are moved. | **Not run** |

The ordered migration runner wraps each file in a transaction and records it in `schema_migrations`, but creates that tracking table before applying migrations. `infra/postgres-init/01-runtime-role.sh` is a local-container provisioning script targeting the database name `educonnect`; it should not be run against Supabase as-is. It creates roles and broad table/sequence grants. For Supabase, first verify current role names/attributes and required grants through an authorized administrative connection, then provision the two runtime logins with least privilege. Migration 012 will harden existing roles but cannot replace role creation. The separate security verifier intentionally creates test schools and rows; per instruction, it was not run.

### Verification status after inspection

| Item | Classification | Result |
|---|---|---|
| Supplied target string safely checked before connection | **Verified** | Local configured host was `127.0.0.1`; it did not match the provided project reference. |
| New Supabase project connection configured in `DATABASE_URL` | **Blocked** | Process variable missing; ignored `.env` points to local loopback. No credentials were supplied through a verified secure channel. |
| Migrations applied to new project | **Blocked** | Stopped before connection because target identity did not match. No migrations applied. |
| PostgreSQL 17.12 runtime role attributes | **Not verified** | No live SQL connection; cannot report `rolsuper`, `rolbypassrls`, memberships or grants. |
| Live PostgreSQL RLS/FORCE RLS inventory and two-tenant authorization | **Not verified** | No live connection. Local PGlite tests are not evidence for managed PostgreSQL. |
| Initial Super Admin | **Not configured** | Bootstrap not run. No default credentials created. |

To continue, configure the new project's connection string as `DATABASE_URL` in the ignored local secret file or a secret manager. Before running anything, independently confirm the URL host contains project ref `jnhcomdjezlvmxpjkoot`, database is `postgres`, and authenticated role is the intended migration owner. Then run the ordered migrations, inspect actual role flags/grants and RLS catalogs, and verify tenant isolation with a separately prepared non-destructive test plan. Do not run the destructive verifier against this application database.

## Local verification evidence

| Command | Result | Scope/limitations |
|---|---|---|
| `npm run build` | **PASS** | API TypeScript build and Vite production build passed. Vite emitted non-fatal Zod annotation warnings. |
| `npm test` | **PASS: 15/15** | Includes auth, tenant and storage authorization scenarios. Storage provider is mocked and DB fixtures use PGlite. |
| `npm run test:e2e` | **PASS: 1/1; 14 lifecycle phases** | PGlite lifecycle test; not managed PostgreSQL. |
| `npm audit --omit=dev` | **PASS: 0 vulnerabilities** | Local dependency audit only. |
| Firebase Admin / real ID token validation | **Not verified** | Test uses generated credentials and injected verifier. No live Firebase request. |
| Firebase Storage bucket upload/download and denial | **Not verified** | Mocked adapter tests only; no bucket exists/was checked from this environment. |
| Firebase Rules Emulator | **Not run** | Firebase CLI is not installed. |
| Real PostgreSQL security verifier | **Not run** | No verified isolated DB. Docker reports `failed to connect to the docker API`; no local PG tools. It would be unsafe to use an unknown `.env` database. |

## Configuration requirements for later provisioning

1. Provision a **new** database/instance explicitly named for EduConnect. Before connecting, record and independently verify provider/project, host, database name, region and environment. Confirm empty schema. Keep old Schoollog connection values out of the new deployment.
2. Create migration-owner, `educonnect_app`, and `educonnect_platform` roles. Runtime roles must be non-superuser, `NOBYPASSRLS`, and must not inherit privileged roles. Supply connection values through a secret manager only after the target identity is verified.
3. Apply migrations 001–013 to the fresh database using the migration role. Run `npm run test:postgres-security` only against a new empty isolated database named `educonnect_security_verify_YYYYMMDD`, with the explicit guard required by the verifier. Never point it at the old database.
4. Bootstrap the first CalmStacks Super Admin once using a generated, unique secret from a secure secret manager. Remove the bootstrap password from the deployment environment afterward. No credential belongs in Git or this report.
5. In Firebase `educonnect-44f2b`, provision a private Cloud Storage bucket; set public access prevention/IAM; configure `FIREBASE_PROJECT_ID`, server-only `FIREBASE_SERVICE_ACCOUNT_JSON`, and `FIREBASE_STORAGE_BUCKET`. Set only the public `VITE_FIREBASE_*` web configuration for the same project. Do not place Admin values in `VITE_*` variables.
6. Install Firebase CLI in a controlled operator environment, select the verified project explicitly, run Rules Emulator tests, then deploy reviewed `storage.rules`. Test API upload/download/denial using disposable identities and the new DB.
7. Create/authorize a separate Vercel EduConnect project connected to the intended repository/branch. Verify its deployment metadata and every database/Firebase environment scope before any deployment. Keep the old Vercel project and database available and unchanged.

## Required human/operator access

Infrastructure work is blocked until an authorized operator provides or configures: Firebase console/CLI access for project `educonnect-44f2b` (and confirms billing/storage location), a new PostgreSQL provider project/database with billing approval as required, and a separate Vercel project/team association. These are external account and billing actions. Do not send credentials in chat; configure them directly in provider secret managers.

No push, merge, deploy, database connection, database migration, administrator bootstrap, Firebase bucket mutation, or old data copy occurred during this verification.
