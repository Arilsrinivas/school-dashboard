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
- The Supabase service-role key is not configured in `apps/api/.env`; private bucket provisioning and actual Supabase Storage upload/download/delete tests could not be run. No live provider success is claimed.

## Configuration and launch blockers

Follow [Supabase Storage setup](SUPABASE_STORAGE_SETUP.md). An authorized project owner must add `SUPABASE_SERVICE_ROLE_KEY` to the ignored API environment and production server environment, then run the private bucket provisioning command. Afterward run the opt-in live storage test and the API tenant-isolation suite. Do not deploy the application until live provider checks pass.

The first school and CalmStacks Super Admin remain in the existing PostgreSQL database. This storage change does not create, modify, or delete school/student records and does not touch the Schoollog database or deployment.
