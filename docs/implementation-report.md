# CalmStacks EduConnect — Repository Verification Report

**Review date:** 2026-11-21  
**Scope:** Fresh review of the current repository, production build, API integration tests, lifecycle E2E, dependency audit, migration bundle, and tenant security.

## Verified in this checkout

The repository contains real school-scoped APIs and React workspaces for attendance, homework, examinations, timetable, fees, announcements/in-app notifications, reports, and school settings/branding. Routes use the existing school identity and permission checks, tenant transactions, and PostgreSQL migrations. API integration tests exercise workflow behavior and cross-school isolation.

A fresh security review found that the initial RLS hardening migration omitted several tables created by later operations migrations. Migration `011_operations_rls_hardening.sql` now forces RLS on those tables, and integration coverage checks both `relrowsecurity` and `relforcerowsecurity`. A second issue allowed production to fall back to known development signing secrets and a local database URL. Production configuration now fails closed unless a PostgreSQL URL and separate, explicit 32-character signing secrets are provided.

## Verification results

- `npm run build` — passed for API and web.
- `npm test` — passed, 12 tests, including PostgreSQL-engine integration coverage and migration-bundle parity.
- `npm run test:e2e --workspace apps/api` — passed, one end-to-end lifecycle test covering 14 phases and cross-school isolation. The latest E2E run applied migrations through `011`.
- `npm audit` — zero known vulnerabilities in the current dependency tree.
- Database tests use PGlite's PostgreSQL engine; this review did not connect to a separately managed PostgreSQL deployment.

## Known gaps and limits

The implementation is not fully complete against the original operations brief. Absence and fee reminder events are queued, but there is no background worker to deliver them. Homework attachments and school logos can reference file metadata, but private binary upload/download storage is not configured. Reports currently export CSV; PDF and Excel exports and generated downloadable report cards are not implemented. Push delivery, notification preferences, and live SMTP delivery have not been verified. Payment gateway integration remains deferred as requested.

Operational workspaces are loaded on demand, and shared React/UI libraries are split into vendor chunks. The latest web build has a 222 kB entry chunk and no oversized-chunk warning. Vite still emits non-fatal annotation warnings from the installed Zod package. The API test suite also emits a `pg` client-query concurrency deprecation warning from the PostgreSQL socket test harness.

## Local changes in this review

- Added the forward-only RLS migration `011_operations_rls_hardening.sql` and included it in the production migration bundle.
- Added integration assertions that check RLS enable/force state and confirm migration files match the SQL embedded for production deployment.
- Added fail-closed production configuration validation for the database connection and token signing secrets, with regression coverage.
- Split operational React workspaces and shared vendor libraries into on-demand web bundles.

No production deployment, external email delivery, object-storage upload, or managed PostgreSQL database was exercised during this review.
