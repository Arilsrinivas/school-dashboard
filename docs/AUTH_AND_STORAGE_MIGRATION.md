# Authentication and Storage Migration Plan

## Principles

- PostgreSQL remains the authority for existing EduConnect user IDs, profiles, school memberships, school status, subscriptions, roles, permissions, audit records, and business data.
- Firebase UID is an external identity key stored in the existing `external_identities` table under provider `firebase`.
- No identity is linked because email strings merely match. The claim endpoint requires a valid legacy EduConnect session plus a verified Firebase ID token and enforces a matching account email. Google migration additionally proves Google provider credentials through the existing account-link flow.
- Existing password hashes are retained. Migration 013 adds nullable display/lifecycle metadata to `uploaded_files`; no existing document records or school rows are deleted.
- Storage file paths never grant authority. Every list, upload, signed-download, and delete request is checked against current PostgreSQL tenant membership and school permissions.

## Database changes

- Migration 009 already creates `external_identities`, including uniqueness on `(provider, provider_subject_id)` and `(user_kind, user_id, provider)`. No new identity table or new user-ID domain was introduced.
- Migration 013 adds `uploaded_files.display_name`, `uploaded_files.upload_status`, a status constraint, and a pending-file index. Existing rows default to `ready`, preserving their stored metadata state. It is forward-only and additive.
- `apps/api/src/db/migrationsData.ts` is synchronized with ordered migration files, including 013.
- Apply with the existing controlled migration command `npm run db:migrate`. Use an empty or backed-up non-production environment first; do not run destructive migrations or reset any database.

## Existing account claim

### Password-based accounts

1. Keep the existing account active and retain its PostgreSQL password hash.
2. User proves the existing EduConnect password through the legacy sign-in endpoint and creates/signs in to the Firebase account using the same verified email.
3. The client presents the Firebase ID token separately from the existing EduConnect access token. The backend verifies both, checks PostgreSQL account status/email, and inserts a `firebase` external identity plus an audit entry.
4. On next API calls, the Firebase token resolves the original PostgreSQL user ID; school selection is validated against active memberships and the currently selected school header.
5. Invitation acceptance creates the existing PostgreSQL user/membership first. Firebase account creation then sends verification mail; after verifying and signing in, the user links through the same explicit account-claim process.

### Google accounts

Firebase Google sign-in is primary after configuration. During migration, the existing verified Google identity flow can prove an older account, followed by an explicit Firebase UID mapping. Keep `GOOGLE_CLIENT_ID` available and equal to the configured OAuth web client while this bridge remains active.

### Accounts without an existing Firebase mapping

A verified Firebase token that has no mapping is denied application access. A valid Firebase user by itself cannot provision a school, create membership, assign a role, or pass an invitation. CalmStacks Super Admin remains the only tenant provisioning authority.

## Rollout and rollback

1. Back up PostgreSQL and record current schema version and Firebase/Supabase environment version.
2. Configure a non-production Firebase project and private Supabase bucket. Apply migration 013 to a copied test database; do not remove existing auth records.
3. Test password and Google claims for representative platform, school admin, teacher, parent, and student accounts; test multi-school switching and suspension.
4. Enable `AUTH_PROVIDER=firebase` in a staging deployment only after web and Admin project IDs match. Ensure API and frontend build-time/runtime configuration both refer to the same Firebase project.
5. Preserve legacy auth routes and password hashes during a monitored migration window. Rollback means setting `AUTH_PROVIDER=legacy` in a controlled release and rebuilding/redeploying the matching frontend configuration; do not delete Firebase mappings or existing external identities during rollback.
6. Only plan legacy credential retirement after every account cohort has migrated, password reset/invitation flows have been verified, a restore point exists, and a separate approved migration removes legacy credentials.

Storage rollback: disable document routes through deployment configuration and keep the private Firebase bucket and PostgreSQL object metadata intact. Do not make the bucket public. Existing files remain private and can be restored after IAM or configuration is corrected.

## Tests and verification state

- `firebase-auth.integration.test.ts`: PGlite plus an injectable test-only token verifier checks valid mapped identities, invalid tokens, denied unmapped contexts, active multi-school selection, foreign school selection, inactive account rejection, and the explicit two-session link route.
- `homework.integration.test.ts`: PGlite plus an injected storage client checks student document authorization, a linked parent's access, unrelated parent denial, unassigned teacher denial, cross-school read/insert/delete denial, content signature/size/MIME handling, and private signed-link issuance.
- Tests do not call Firebase Auth or Firebase Cloud Storage live. They do not prove Firebase token verification, live bucket privacy, Storage Rules behavior, provider object operations, or actual production PostgreSQL RLS/connection pool behavior.
- Managed PostgreSQL tenant-isolation verification remains required per `FINAL_PRODUCTION_VERIFICATION.md`.

## Human actions still required

Configure Firebase providers/domains and Vercel environment values; configure the private Firebase Storage bucket and server-only Admin credentials; run live auth and storage tests; confirm PostgreSQL migration 013 on the isolated EduConnect database; then run managed PostgreSQL RLS verification. Do not import old school records.
