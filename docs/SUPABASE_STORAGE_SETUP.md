# EduConnect Supabase Storage

EduConnect keeps Firebase Authentication for user identity and uses the existing Supabase project `jnhcomdjezlvmxpjkoot` exclusively for private file objects. PostgreSQL remains the source of truth for schools, memberships, roles, student relationships, and `uploaded_files` metadata. File-object storage does not require a schema migration: the existing `uploaded_files.object_key` stores `bucket:path`, while the existing student document, student photo, and assignment attachment relations identify the resource.

Supabase private buckets are subject to Storage RLS and can be read with time-limited signed URLs. The backend uses the service-role key only after checking the Firebase identity against PostgreSQL school authorization. Supabase documents that service keys bypass Storage RLS, so authorization must remain in this API; see [Storage access control](https://supabase.com/docs/guides/storage/security/access-control) and [private downloads and signed URLs](https://supabase.com/docs/guides/storage/serving/downloads).

## Required API environment

Configure these only in ignored `apps/api/.env` locally and server-only Vercel API settings:

```env
SUPABASE_URL=https://jnhcomdjezlvmxpjkoot.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only Supabase service-role or secret key>
SUPABASE_STUDENT_DOCUMENTS_BUCKET=student-documents
SUPABASE_PROFILE_IMAGES_BUCKET=profile-images
SUPABASE_ASSIGNMENTS_BUCKET=assignments
SUPABASE_SCHOOL_DOCUMENTS_BUCKET=school-documents
```

Retrieve the service-role/secret key in Supabase Dashboard → Project Settings → API Keys. Do not put it in `apps/web/.env`, a `VITE_` variable, source code, logs, or repository history. Firebase service-account credentials remain exclusively for Firebase Authentication on the API.

## Create and configure buckets

With the server-only key in ignored `apps/api/.env`, run:

```powershell
npm run storage:provision:supabase --workspace apps/api
```

The command is guarded to the EduConnect Supabase URL and creates or verifies four distinct private buckets:

| Bucket | Use | Allowed content |
|---|---|---|
| `student-documents` | Student records and certificates | PDF, JPEG, PNG, WebP, plain text |
| `profile-images` | Student profile photos | JPEG, PNG, WebP |
| `assignments` | Assignment attachments | PDF, JPEG, PNG, WebP, plain text |
| `school-documents` | School policies and records | PDF, JPEG, PNG, WebP, plain text |

Every bucket is set private with a 10 MiB per-file limit and MIME restrictions. Leave `storage.objects` without policies that grant `anon` or `authenticated` access. Supabase Storage signed downloads are issued only by the API after authorization; no client receives the service-role key.

## Authorization and API behavior

- Firebase ID tokens are still verified by Firebase Admin; the API resolves the Firebase UID to the existing PostgreSQL identity and active school membership.
- School IDs come from verified membership context, not from upload request bodies.
- Student documents, certificates, and profile photos require student relationship or management permissions. Parents can only access linked students; teachers must be assigned to the student.
- Assignment attachments require homework-management permission to upload and are downloadable only when linked to a published assignment visible to that teacher, student, or parent.
- School documents require school settings/management permission.
- Upload metadata is written to existing PostgreSQL tables, content type is sniffed, and the request is capped at 10 MiB. Sensitive file access is audited.
- Downloads return 120-second Supabase signed URLs only after authorization. Signed URLs are bearer links while valid; keep their lifetime short and never log or persist them.
- Delete operations authorize first, remove the private object, and then remove the tenant-scoped metadata/links.

## Verification

Run the API/tenant integration suite with:

```powershell
$env:AUTH_PROVIDER = 'legacy'
npm test --workspace apps/api
```

Those tests exercise the API and PostgreSQL-compatible PGlite tenant fixture with an injected storage adapter; they are not live Supabase evidence. For real bucket operations after provisioning:

```powershell
$env:SUPABASE_STORAGE_LIVE_TEST = '1'
npm run test:storage:live --workspace apps/api
```

The provider-only live check uploads, downloads through a 120-second signed URL, verifies unsigned object requests are denied, and deletes randomized temporary objects in each bucket. The API integration suite also covers unrelated parents, invalid file types, and oversized uploads using its local PostgreSQL-compatible test fixture.

For an end-to-end verification through the real local API, PostgreSQL runtime roles and Supabase Storage provider, run:

```powershell
$env:EDUCONNECT_STORAGE_API_LIVE_TEST = '1'
$env:EDUCONNECT_DATABASE_PROJECT_REF = 'jnhcomdjezlvmxpjkoot'
$env:AUTH_PROVIDER = 'legacy'
npm run test:storage:api:live --workspace apps/api
```

This guarded check first confirms both PostgreSQL URLs identify the EduConnect database and connects as `educonnect_app`/`educonnect_platform`, neither superuser nor `BYPASSRLS`. It verifies `storage.objects` has no policies for `PUBLIC`, `anon`, or `authenticated`, then checks each private bucket's MIME allowlist and 10 MiB cap. It creates two uniquely named test schools and admin users, signs short-lived local legacy test tokens, and exercises the backend's actual membership/tenant authorization path against real PostgreSQL and Supabase. It confirms a foreign-school upload/read/delete is denied, metadata uses the authenticated tenant despite a forged `schoolId`, and authorized upload/download/delete reaches the real provider. The script removes the test objects and only the tenant/user rows it created. This storage test uses local test tokens; it does not constitute a live Firebase sign-in test.

## Latest local provider verification

For the run on 2026-11-22, provisioning created all four private buckets. The real provider test passed upload, signed download, unsigned denial, and deletion in every bucket. The real API test passed database identity/RLS-policy checks, backend authorization, PostgreSQL file metadata, an actual API upload and signed download, School A/B denial, and deletion. It also confirmed the disposable tenant/user/file fixtures were cleaned up. No signed URLs, credentials, or school/student records were written to logs. These checks were run locally and do not verify any Vercel environment or deployment.
