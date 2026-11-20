# CalmStacks EduConnect — Production Launch Report

**Review date:** 2026-11-21  
**Decision:** NOT PRODUCTION READY. Independent PostgreSQL and live external-service verification are still required.

## Verified in this checkout

- `npm run build` passed: API TypeScript and web Vite production build completed. Vite emitted removable-comment warnings in Zod, but completed successfully.
- `npm test`: 15/15 API suites passed, including Firebase UID/membership authorization, Admin SDK initialization, proxy-aware rate limiting, refresh rotation/replay, and school isolation. PGlite remains the database test engine.
- `npm run test:e2e` passed: the 14-phase school lifecycle and cross-school isolation workflow on PGlite.
- Firebase token verification and explicit account linking are implemented; PGlite integration tests cover active/inactive account mapping, school membership selection, invalid tokens and tenant mismatch. Live Firebase verification is not complete.
- Express trusts exactly one proxy hop only in Vercel (`VERCEL=1`); local mode trusts none. A simulated ingress test verifies arbitrary caller-supplied XFF is discarded before rate limiting. Production behavior remains pending a candidate deployment and log review.
- Supabase private document routes, school/relationship authorization, MIME/signature/size validation, audit events and 120-second signed downloads are implemented. PGlite tests use a mocked Storage provider; no live private bucket verification has occurred.
- CSV, PDF and XLSX exports for students, fees, attendance and published examinations use school-scoped queries. XLSX uses a minimal OpenXML ZIP writer. Report integration tests validate student content in the generated workbook and PDF/CSV response types using PGlite.
- `npm audit --omit=dev` reports 0 vulnerabilities.
- The migration set includes 011 RLS hardening, 012 runtime-role constraints, and 013 document upload lifecycle metadata. PGlite checks exercise policy behavior and pooled transaction context.
- Real PostgreSQL was not verified. Docker is installed but its daemon/isolated test database was unavailable; `psql` and `postgres` executables are not present, and no isolated managed PostgreSQL credentials were provided. PGlite cannot prove runtime roles, provider pooler behavior, TLS, or connection reuse on PostgreSQL.

## External service and operations status

- Firebase: integration implemented; production credentials, authorized origins/providers and live verification remain to be configured.
- Supabase Storage: integration implemented; private bucket, production credentials, provider-side access checks and live upload/download tests remain to be configured.
- SMTP: not complete. Nodemailer is present but durable delivery confirmation, retries/failure administration and provider-tested password recovery/invitation workflows are not verified.
- Background worker: not complete. Outbox production exists for notification workflows; durable execution, idempotency, retry/dead-letter, duplicate suppression and monitoring remain launch blockers.
- Push notifications: unavailable until a provider and credentials are selected and delivery is implemented. Core workflows do not depend on push.
- Backups/restore, production error monitoring and deployment recovery: provider configuration and isolated restore evidence are absent.

## Required before launch

1. Run the guarded two-school verifier against a newly created, empty, isolated PostgreSQL instance with actual `educonnect_app` and `educonnect_platform` logins. See `FINAL_PRODUCTION_VERIFICATION.md`.
2. Configure Firebase and complete live verification of signup/verification, reset, Google sign-in, token revocation, account deactivation and multi-school access.
3. Provision a private Supabase bucket and complete live denied/allowed access, upload validation, signed URL expiry and audit checks.
4. Complete SMTP delivery tracking and the notification worker, including retry/failure administration and duplicate-delivery tests.
5. Configure and verify backups, isolated restore, monitoring, health alerts and release migration procedures.

This report does not declare production readiness. No production school data was used for destructive tests.
