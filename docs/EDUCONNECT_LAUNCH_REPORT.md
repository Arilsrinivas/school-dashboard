# EduConnect Launch Report

**Status:** Not launch-ready. Firebase Storage code and rules are prepared locally; real Firebase, PostgreSQL and isolated deployment verification remain outstanding.

## Architecture changes

- Firebase project `educonnect-44f2b` is the identity and object-storage provider.
- PostgreSQL remains the source of truth for schools, users, memberships, roles, permissions, status and file metadata.
- File operations pass through authenticated API routes. The API checks active tenant membership, existing permissions, student/parent/teacher relationships, file type and size before using Firebase Admin Storage. No client-provided school ID grants access.
- Firebase Storage Rules deny unmatched paths and limit direct access by school path, trusted claims, roles, content types and 10 MiB size. Admin SDK operations bypass these rules by design and must retain backend PostgreSQL checks.
- No files or school data were migrated from the old product.

## Changed files

`apps/api/src/storage/supabase.ts` was replaced by `apps/api/src/storage/firebase.ts`; `apps/api/src/storage/routes.ts`, `apps/api/src/config.ts`, `apps/api/src/homework/homework.integration.test.ts`, `apps/api/src/db/migrationsData.ts`, `apps/api/package.json`, `package-lock.json`, `.env.example`, `firebase.json`, and `storage.rules` were updated. Supabase Storage setup documentation was removed and replaced with `docs/FIREBASE_STORAGE_SETUP.md`; launch/runbook and migration documentation was updated. PostgreSQL migration 013 was renamed to `013_private_file_storage.sql`; it stores metadata only, not object bytes.

## Dependencies

- Removed `@supabase/supabase-js` from the API workspace.
- Firebase Admin SDK remains the server-side provider; Firebase web Auth remains the browser identity provider.
- No other object-storage provider was added.

## Configuration required

Set server-only `FIREBASE_PROJECT_ID=educonnect-44f2b`, `FIREBASE_SERVICE_ACCOUNT_JSON`, and `FIREBASE_STORAGE_BUCKET` in the isolated EduConnect API deployment. Set the five `VITE_FIREBASE_*` web values for the same project. Configure the new PostgreSQL database URLs separately and verify their database identity before bootstrapping the initial CalmStacks Super Admin. Create a private Firebase bucket, prevent public IAM access, and deploy `storage.rules`. Exact steps are in `FIREBASE_STORAGE_SETUP.md`.

## Tests executed

- `npm install --package-lock-only --ignore-scripts`: completed; dependency audit reported 0 vulnerabilities. npm warned that installed Firebase Realtime Database transitive packages declare Node >=24.12, while the local runtime is Node 22.17.1. This unrelated Firebase RTDB engine warning needs resolution or confirmation against the target Vercel runtime.
- `npm run build`: passed for API and web.
- `npm test`: 15/15 API suites passed. The storage integration uses a mocked provider adapter with PGlite metadata/authorization checks, including authorized upload, unauthorized roles, cross-school access, unrelated parent denial, invalid type, size limit and missing auth.
- `npm run test:e2e`: 1/1 test, all 14 lifecycle phases passed using PGlite.
- Tests did **not** call Firebase Storage. Firebase Storage Rules have not been compiled or run in the Firebase Emulator; no live Firebase Storage requests, real PostgreSQL RLS verification, fresh database installation, or isolated Vercel deployment has been performed. Do not infer provider success from mock adapter tests.

## Remaining launch blockers

- Provision and verify a new empty PostgreSQL database with least-privilege runtime roles; run migrations and the guarded real-PostgreSQL RLS checks there only.
- Create and verify the private Firebase Storage bucket and run Firebase Rules Emulator plus provider-backed API tests.
- Verify Firebase rules project/bucket selection and confirm bucket IAM denies public access.
- Confirm backend service-account and bucket environment configuration without exposing credentials.
- Verify a separate Vercel project/deployment points exclusively at the new database; do not reuse or overwrite the Schoollog deployment.
- Bootstrap the first CalmStacks Super Admin securely, then verify Firebase Google and email/password sign-in, invitations, school creation and tenant isolation.
- Verify mobile layouts and critical routes on the isolated deployment.

Fresh database setup uses one consolidated initial schema (`apps/api/schema/educonnect.initial.sql`), not execution of migrations 001–013. `npm run db:migrate` requires `EDUCONNECT_DATABASE_PROJECT_REF`, validates that application and migration URLs identify the same project/database, requires database `postgres`, refuses a non-empty public schema, and validates remote TLS certificates. Runtime roles still need secure provisioning so migration 012 can harden them. The local `.env` continues to point to loopback, so initialization was not run.

No push, merge, deployment, database modification, or old data copy was performed.
