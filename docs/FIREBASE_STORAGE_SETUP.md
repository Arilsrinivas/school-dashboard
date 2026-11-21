# Firebase Cloud Storage setup

EduConnect stores file bytes in a private Firebase Cloud Storage bucket. PostgreSQL remains authoritative for school/user/membership/role state and uploaded-file metadata. API routes authenticate Firebase ID tokens, resolve the linked PostgreSQL user and active membership, apply existing permissions and student relationship checks, then perform storage operations with the server-only Firebase Admin SDK. Clients do not receive Admin credentials or direct upload credentials. Downloads use short-lived V4 signed URLs after authorization.

## Firebase project configuration

1. In Firebase project `educonnect-44f2b`, create a dedicated bucket for the EduConnect launch. Use the project’s recommended location and record the exact bucket name.
2. Keep public access prevention enabled. Do not grant `allUsers` or `allAuthenticatedUsers` bucket access.
3. Configure Vercel API runtime variables: `FIREBASE_PROJECT_ID=educonnect-44f2b`, `FIREBASE_SERVICE_ACCOUNT_JSON` (server-only secret for a service account from this project), and `FIREBASE_STORAGE_BUCKET` (exact bucket name). Keep existing PostgreSQL variables pointed only at the new EduConnect database.
4. Set the five `VITE_FIREBASE_*` web values for the same Firebase project. Never add Admin JSON or private keys to Vite variables.
5. Deploy Storage Rules with `firebase deploy --only storage --project educonnect-44f2b` after reviewing the project alias and bucket.

## Rules and access model

`storage.rules` denies unknown paths and requires authenticated tokens carrying trusted `school_id`, `school_active`, and `school_role` claims for direct access. Reads and writes are restricted by school path and role; writes are limited to approved MIME types and 10 MiB. The API currently uses backend-mediated uploads and downloads, not direct browser access. The API does not trust the `X-EduConnect-School-ID` value by itself: authentication middleware resolves it against active PostgreSQL memberships before storage routes run. Because Firebase Admin bypasses Storage Rules, every privileged storage operation must retain that PostgreSQL authorization check.

Do not mint school claims from browser input. If direct client access is introduced later, a server-side claim issuer must derive claims from PostgreSQL after verifying membership and must refresh/revoke claims on membership or role changes. Until then, direct Firebase SDK access is denied for users without server-issued claims.

## Operational checks

- Verify bucket IAM has no public principals.
- Test API upload/download/delete using dedicated accounts and files in the isolated launch database.
- Verify cross-school, unrelated-parent, inactive-membership and unauthorized-role denials.
- Verify MIME sniffing and the 10 MiB API request limit; confirm over-limit requests return a safe client error.
- Verify signed URLs expire and never appear in logs.
- Test missing bucket, permission errors and provider outages; API should return safe errors without credential disclosure.

No live Firebase Storage bucket or provider request was available during implementation, so provider configuration and live delivery remain unverified. See `EDUCONNECT_LAUNCH_REPORT.md` for exact test evidence and blockers.
