# Final Production Verification

**Review date:** 2026-11-21  
**Decision:** NOT APPROVED FOR PRODUCTION. Live PostgreSQL security, external provider delivery, and recovery controls are not independently verified.

## Test evidence from this checkout

| Check | Result | Evidence and boundary |
|---|---|---|
| Production build | PASS | `npm run build`; API TypeScript and web Vite build completed. Vite printed Zod comment-annotation warnings but exited successfully. |
| API regression suites | PASS | `npm test`; 15/15 suites passed, including Firebase mapping and Admin initialization, proxy rate limiting, refresh rotation/replay, storage authorization, school isolation and XLSX content. Database fixtures use PGlite. |
| Lifecycle E2E | PASS | `npm run test:e2e`; 1 test, 14 lifecycle phases, including tenant isolation, passed on PGlite. |
| Dependency audit | PASS | `npm audit --omit=dev`; 0 known vulnerabilities at scan time. |
| Excel export | PASS in PGlite | XLSX response is a ZIP/OpenXML workbook; integration test opens the archive and checks report headers and student content. PDF/CSV responses also tested. |
| Firebase integration | Implemented; provider test pending | Admin token verification and relational UID mapping are implemented. Unit/integration tests use an injected verifier, not Firebase credentials. |
| Firebase Storage integration | Implemented locally; provider test pending | API checks PostgreSQL tenant/relationship permissions, upload size/type/signature, audit and signed URL lifetime. Tests use PGlite and a mocked storage adapter; Firebase Rules Emulator and live provider are not verified. |
| Migrations and tenant RLS | PGlite regression PASS; real PostgreSQL NOT VERIFIED | Migrations 001–013 apply to PGlite test runs. Existing tests check tenant-policy behavior, missing context and transaction context reuse. This does not prove PostgreSQL's actual role inheritance, FORCE RLS behavior, pooler semantics or connection reuse. |
| Independent PostgreSQL verifier | NOT RUN | The isolated-database confirmation and connection credentials are absent. `postgres` and `psql` are not installed; Docker CLI is present but its daemon is unavailable. |
| Vercel proxy and refresh behavior | PASS locally; production NOT VERIFIED | Express uses one trusted hop only when `VERCEL=1`, otherwise no proxy trust. A simulated edge strips forged XFF; rate limiting and actual refresh route rotation/replay pass locally. Production runtime logs need review after deployment. |
| SMTP, worker, push | NOT production verified | SMTP durable delivery/retry/admin failure management and background worker execution remain incomplete. Push has no configured provider. |
| Backups, restore, monitoring | NOT verified | No provider-specific configuration or isolated restore evidence is available. |

The real PostgreSQL evidence gap is critical. FORCE RLS and PGlite alone are not accepted as proof that production runtime identities or connection pools enforce isolation.

## Database configuration and independent verification

Use a newly created, empty, isolated, non-production PostgreSQL database. Never use production or real school records. The verifier deliberately leaves the disposable test database for inspection; after evidence retention, remove it through the provider's controlled process.

Required connections to the same database:

- `POSTGRES_SECURITY_TEST_ADMIN_URL`: disposable database owner/migration role.
- `POSTGRES_SECURITY_TEST_APP_URL`: actual `educonnect_app` login.
- `POSTGRES_SECURITY_TEST_PLATFORM_URL`: actual `educonnect_platform` login.
- `POSTGRES_SECURITY_TEST_CONFIRM=I_CREATED_EMPTY_ISOLATED_VERIFY_DATABASE`: set only after independently confirming a new empty non-production database.

The database must be named `educonnect_security_verify_YYYYMMDD`. Supply URLs through a secure secret manager and do not print or commit them. PowerShell example:

```powershell
$env:POSTGRES_SECURITY_TEST_ADMIN_URL = '<secure admin URL>'
$env:POSTGRES_SECURITY_TEST_APP_URL = '<secure educonnect_app URL>'
$env:POSTGRES_SECURITY_TEST_PLATFORM_URL = '<secure educonnect_platform URL>'
$env:POSTGRES_SECURITY_TEST_CONFIRM = 'I_CREATED_EMPTY_ISOLATED_VERIFY_DATABASE'
npm run test:postgres-security
```

The runner checks the database name and empty public schema; applies all migrations; validates actual login roles and inherited superuser/BYPASSRLS attributes; enumerates tenant-owned tables and RLS/tenant policies; provisions two disposable schools; and tests unauthorized read, insert, update and delete, missing tenant context, and tenant-context cleanup/reuse with a one-connection pool. Preserve the runner output plus provider/PostgreSQL version, TLS and pooler configuration. A successful test on a direct database connection must not be extrapolated to a transaction pooler without a separate check.

## External services and configuration

- **Firebase Auth:** Follow `FIREBASE_AUTH_SETUP.md`. Configure Firebase web build-time values and server-only `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT_JSON`; set `AUTH_PROVIDER=firebase`. Keep EduConnect users, memberships, roles and permissions in PostgreSQL. Production boot fails closed without Firebase Admin config. Complete live email verification/reset, Google sign-in, account claim, revocation, deactivation, and multi-school tests before launch.
- **Firebase Cloud Storage:** Follow `FIREBASE_STORAGE_SETUP.md`. Create a private bucket in `educonnect-44f2b`, set server-only `FIREBASE_STORAGE_BUCKET`, deploy `storage.rules`, and verify IAM does not grant public access. Complete live upload/download, signed URL expiry, and outage checks before enabling production documents.
- **SMTP:** Configure provider credentials only after the outbox/worker implements confirmed delivery state, bounded retry, failure inspection, invitation expiry/resend, recovery throttling and provider-backed tests. Current implementation is incomplete; a queued notification is not delivered evidence.
- **Background work:** Add durable worker operation, idempotency keys, bounded retries, failed-job/dead-letter inspection, duplicate protection, school context and health/queue-age alerts. Existing outbox rows do not establish delivery.
- **Push:** Unavailable until provider and credentials are selected and delivery is completed. Keep feature disabled and core workflows independent.
- **Operations:** Configure encrypted backups/retention/PITR, perform a restore to an isolated target, record integrity checks and RTO/RPO, connect production errors to monitored alerts, and validate health and migration gates.

## Exact human/operator actions required

1. Provision and supply access to a new, empty, isolated PostgreSQL test database plus the three correctly restricted roles; run the guarded verifier and retain evidence.
2. Configure Firebase in project console and Vercel environments, then perform the live checks above using test accounts.
3. Provision a private Supabase bucket, configure server-side secrets, and complete allow/deny, signed expiry, validation and audit checks using synthetic files.
4. Complete SMTP outbox delivery and worker operations; test accepted, bounced, transient failure, permanent failure and duplicate delivery with provider sandbox credentials.
5. Choose/configure push or leave it unavailable and disabled.
6. Configure production backup/monitoring providers, run an isolated restore drill, and document recovery owner, RTO/RPO, alert routing and rollback process.
7. Repeat build, API, E2E, audit and managed-PostgreSQL checks against the release candidate. Review actual evidence before approving deployment.

No production school records were used for destructive verification. Production readiness is not claimed.
