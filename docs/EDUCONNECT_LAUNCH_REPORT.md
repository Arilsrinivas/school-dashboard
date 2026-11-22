# EduConnect Launch Report

**Storage architecture update:** Firebase Authentication remains the user identity provider. Private file objects use Supabase Storage in the dedicated EduConnect Supabase project `jnhcomdjezlvmxpjkoot`. PostgreSQL remains authoritative for school membership, roles, permissions, student relationships, and existing uploaded-file metadata.

## Implementation

- Added server-only Supabase client integration using `@supabase/supabase-js`; the service-role key is never part of the web bundle.
- Added scoped upload, signed-download, failure cleanup, and delete routes for student documents, certificates, student profile images, assignment attachments, and school documents.
- Added bucket provisioning for `student-documents`, `profile-images`, `assignments`, and `school-documents`; each is private with a 10 MiB size limit and MIME allowlist.
- The API resolves Firebase UID and school membership from the existing identity/database middleware. It ignores client school IDs and validates student/parent/teacher relationships before file operations.
- Authorized downloads use 120-second Supabase signed URLs. Uploads use MIME sniffing, path validation, upload-status metadata and audit events.
- Existing PostgreSQL schema and application rows are retained. `uploaded_files.object_key` stores the bucket and object path; no new schema field is needed. This task's temporary Firebase-only metadata columns were removed after confirming `uploaded_files` contained zero records.
- Firebase Storage rules/config were removed; Firebase Authentication configuration remains unchanged.

## Local verification

- `npm run build`: passed for API TypeScript and the production web bundle.
- `$env:AUTH_PROVIDER='legacy'; npm test --workspace apps/api`: passed, 17/17 tests. This includes PostgreSQL-compatible file authorization tests using an injected provider adapter and Firebase authentication unit/integration tests; it is not evidence of live Supabase object operations.
- `$env:AUTH_PROVIDER='legacy'; npm run test:e2e --workspace apps/api`: passed, including all 14 lifecycle phases and cross-tenant isolation.
- `git diff --check`: passed.
- Database guard and TLS check confirmed the migration target is the EduConnect project. The final schema has no Firebase-only purpose/resource columns, and runtime roles remain non-superuser and `NOBYPASSRLS`.
- `npm run storage:provision:supabase --workspace apps/api`: passed; all four private buckets were created for the EduConnect project.
- `$env:SUPABASE_STORAGE_LIVE_TEST='1'; npm run test:storage:live --workspace apps/api`: passed against the real provider for private bucket checks, upload, signed download, unsigned denial and deletion in all four buckets.
- `$env:EDUCONNECT_STORAGE_API_LIVE_TEST='1'; $env:EDUCONNECT_DATABASE_PROJECT_REF='jnhcomdjezlvmxpjkoot'; $env:AUTH_PROVIDER='legacy'; npm run test:storage:api:live --workspace apps/api`: passed against actual PostgreSQL runtime roles and Supabase Storage. The test verified file metadata, authorized upload/download/delete, unauthenticated denial, and School A/B denial, then removed only its disposable test rows and objects.
- The local live API verification used a signed legacy test token for the request identity; Firebase Authentication remains the configured identity provider, and the test was not a Firebase sign-in test.

## Configuration and launch blockers

Follow [Supabase Storage setup](SUPABASE_STORAGE_SETUP.md) for server-side configuration and repeatable live checks. The local provider is configured and verified. The remaining infrastructure blocker is a separate EduConnect Vercel project and its server-only environment configuration; this change was not deployed.

The first school and CalmStacks Super Admin remain in the existing PostgreSQL database. This storage change does not create, modify, or delete school/student records and does not touch the Schoollog database or deployment.
