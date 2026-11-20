# Supabase Private Storage Setup

## Status and scope

The API has school-scoped student document routes for listing, upload, signed download, and controlled deletion. Files are streamed through the authenticated API to Supabase Storage; the browser never receives the service-role key or a permanent public object URL. The API verifies that the configured bucket exists and is private on storage operations, restricts file type/size, checks file magic bytes, and audits upload/download/delete events.

No Supabase console access or storage credentials are present in this workspace. The code and PGlite authorization tests are implemented; a real private bucket, Supabase access policies, provider CORS/limits, and live upload/download tests remain unverified.

## Provision the bucket

1. In the existing Supabase project, confirm the project is intended for EduConnect and keep its current PostgreSQL database. EduConnect continues to connect to PostgreSQL through its existing `DATABASE_URL`, `PLATFORM_DATABASE_URL`, and `MIGRATION_DATABASE_URL`; it does not replace those connections with a Supabase database client.
2. In **Storage**, create one bucket named `school-private-documents` (or set `SUPABASE_STORAGE_BUCKET` to the chosen name) and leave **Public bucket** disabled.
3. Set the bucket's file-size limit to **10 MiB**. Allow only `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, and `text/plain`.
4. Enable the Supabase project's encryption-at-rest and backup/retention policies. Use a dedicated, least-privilege service credential where supported; rotate it through the secret manager.
5. Do not add public `SELECT`, `INSERT`, or `UPDATE` policies for `anon` or `authenticated` roles. The current app uploads through its backend with its private service credential after verifying EduConnect membership/permission. Supabase's `service_role` key bypasses Storage RLS and must remain server-only.
6. Use the organization-approved project region/retention rules for child and student records. Do not use a public bucket, `getPublicUrl`, or a permanent object URL.

## Configure credentials

Server-only API variables:

- `SUPABASE_URL=https://<project-ref>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=<secret service key>`
- `SUPABASE_STORAGE_BUCKET=school-private-documents`
- `SUPABASE_STORAGE_ENABLED=true` only after the bucket is provisioned and checked private

`SUPABASE_ANON_KEY` is optional for the current backend-proxied upload design and is not needed by browser code. If set for other Supabase client features, treat it as public and continue to protect data with RLS. Never place `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_` variable.

## Object and metadata model

The API generates keys such as:

```text
schools/{internal-school-uuid}/students/{student-uuid}/documents/{file-uuid}.pdf
```

The path is an organizational key, not the security boundary. Authorization is checked against the authenticated user, active membership, role permissions, school, linked parent/student relationship, and (for teachers) assigned class before metadata or object access. PostgreSQL `uploaded_files` and `student_documents` remain the source of truth; migration 013 adds display-name and upload lifecycle state.

## File workflow

1. The client requests an upload authorization from the school API. The API checks access, validates extension/name/type/size, writes pending metadata, and audits the request.
2. The client streams the file to the API using the still-authenticated Firebase ID token. API body limits cap the upload at 10 MiB.
3. The API validates byte signatures (not only the browser-supplied MIME type), uploads with the service role to the private bucket, then marks metadata ready and audits completion. On failure, the client requests controlled cleanup; inaccessible pending rows remain non-downloadable.
4. The client lists documents through the school API. Each download request is authorized again and returns a **120-second** signed URL. The backend audits URL issuance; users never receive permanent public links.
5. Deletion requires `students:manage` or `students:admit`, writes an audit event, removes tenant metadata, then removes the private object. Failed provider deletion is logged as an inaccessible orphan for cleanup.

## Security verification before enabling storage

- Verify the bucket API reports `public=false`; the application refuses a bucket reported as public.
- Using the anon key, verify unauthenticated object GET/PUT/DELETE is denied.
- Upload the same file through an authorized school user; confirm MIME, actual byte size, metadata, and audit event.
- Verify an invalid PDF signature, mismatched MIME type, file over 10 MiB, and path/name traversal attempts are rejected.
- Confirm School A cannot list, download, upload against, or delete School B records.
- Confirm a parent can access a linked child's records and cannot access an unrelated child; confirm an assigned teacher cannot access unassigned student records.
- Confirm signed URLs expire after 120 seconds and do not expose service credentials.
- Test provider outage after pending metadata creation and confirm retry/cleanup procedures; audit pending uploads older than the retention threshold before removing them.

Do not store real student files until the external bucket checks and cross-school live tests have passed.
