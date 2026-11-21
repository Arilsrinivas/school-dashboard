# EduConnect Production Operations Runbook

**Status:** pre-production. Managed PostgreSQL security, provider configuration, durable notification delivery, backup/restore and monitoring still need verification.

## Database and migrations

1. Provision PostgreSQL with `educonnect_app` and `educonnect_platform` as non-superuser, `NOBYPASSRLS` login roles. Do not grant inherited privileged roles. Use TLS and certificate verification.
2. Set `DATABASE_URL` to the app role; `PLATFORM_DATABASE_URL` to the restricted platform role; and `MIGRATION_DATABASE_URL` to the controlled migration identity.
3. Run `npm run db:migrate` from the reviewed release artifact. Take a verified backup first; migrations in `apps/api/migrations/` are ordered and should not be automatically reversed.
4. Run `npm run test:postgres-security` only against a new isolated database named `educonnect_security_verify_YYYYMMDD`, using the guard and environment variables in `FINAL_PRODUCTION_VERIFICATION.md`. Never use production or school records.
5. Bootstrap the platform administrator only through the controlled bootstrap flow; rotate/remove bootstrap credentials afterwards.

## Application and external services

- Production requires explicit PostgreSQL URLs, distinct 32-character token secrets, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `AUTH_PROVIDER=firebase`, and HTTPS `WEB_ORIGIN`. Set Vite Firebase web values at build time; keep Admin credentials server-side. Follow [Firebase setup](FIREBASE_AUTH_SETUP.md).
- Express trusts one forwarded proxy hop only when the Vercel runtime sets `VERCEL=1`; local environments trust no forwarded headers. Do not set blanket `trust proxy=true`. Recheck `/api/auth/refresh` logs and rate-limit behavior after each deployment.
- Firebase Cloud Storage uses a private bucket configured by server-only `FIREBASE_STORAGE_BUCKET` and Firebase Admin credentials. Follow [Firebase Storage setup](FIREBASE_STORAGE_SETUP.md). The API checks PostgreSQL school membership and file permission before every operation; do not expose Admin credentials or make the bucket public.
- SMTP and the durable queue worker are not yet production-ready. Do not report a notification as delivered unless the provider confirms acceptance, and do not assume an outbox row was delivered.
- Push delivery is unavailable until a provider is configured and verified; core operations must continue without it.
- Configure structured error monitoring, alert routing, log retention, database/queue health, owner/on-call routing and secrets rotation before launch.

## Release procedure

1. `npm run build`, `npm test`, `npm run test:e2e`, `npm audit`.
2. Run the real PostgreSQL verifier on a fresh isolated database and retain output, database version, TLS/pooler configuration and role evidence.
3. Verify a current encrypted backup and perform a restore into an isolated environment.
4. Apply reviewed migrations using the controlled release identity, deploy API/web from the same revision, then check `/health`, `/health/ready` where enabled, logs and alert delivery.
5. Verify Firebase login/link/revocation and private storage allowed/denied access using non-production accounts and files.
6. Enable invitations/recovery and queued notifications only after SMTP/worker delivery, retries and failure visibility pass provider-backed tests.

## Backup, recovery and incidents

Provider backup retention, point-in-time recovery, restore time, RTO/RPO and named owners have not been configured or verified in this repository. Record these and an isolated restore drill before launch. Never test restore over production.

- **Tenant data exposure:** restrict the affected route/credentials, preserve audit and structured logs, investigate tenant policies, and resume only after independent isolation tests pass.
- **Database outage:** fail writes safely. Do not route tenant requests through a privileged bypass role.
- **Email/queue failure:** inspect provider acceptance, queued/retry/failed state and worker health. Replays require idempotency review.
- **Document access incident:** disable storage access or rotate credentials, inspect access audit entries and investigate signed URL exposure.
- **Failed deployment/migration:** stop rollout and follow the migration-specific recovery plan; validate restores only in isolation.

See [Final Production Verification](FINAL_PRODUCTION_VERIFICATION.md) for current evidence and required operator actions.
