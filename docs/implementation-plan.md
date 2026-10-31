# Implementation plan

## Phase 1 — platform foundation (current)

- Set up the web/API monorepo, shared UI theme, PostgreSQL schema and migrations.
- Build authentication, platform role checks, audit logging, school tenant context, and database RLS.
- Build the CalmStacks control panel, school creation/list/status workflow, unique school IDs, and administrator invitations.
- Establish local Docker services, environment documentation, and foundational authorization tests.

## Phase 2 — school authority and core operations (implemented)

- Tenant-scoped configurable roles and granular permission grants, with default school role templates and manager safeguards.
- School-managed invitations for administrators, teachers, parents, and linked student accounts; member role changes and suspension/reactivation.
- School settings, academic year, class, section, and subject APIs; student admission, batch import, scoped listing, promotion, transfer, graduation, and archival.
- School-facing role and member administration UI, support request review UI, and a dedicated CalmStacks support workspace.
- One-time, expiring password recovery that revokes refresh sessions.
- PostgreSQL-backed integration coverage for two independently created schools, role/membership setup, teacher and parent scoping, cross-tenant denial, platform support approval/revocation, recovery, suspension, and preservation of records.

## Phase 3 — teaching and assessment

- Attendance with duplicate prevention and correction audit history.
- Assignments, submissions, examinations, marks, publication, report cards, and timetable conflict checks.

## Phase 4 — family and finance

- Fees, payments, receipts, announcements, leave requests, parent-teacher messaging, notification delivery, and reports.

## Phase 5 — SaaS operations and launch readiness

- Subscription lifecycle and configurable limits/modules, payment integration, observability, rate limits, security review, privacy/retention workflow, backups/restore drills, CI/CD, deployment hardening, and cross-tenant penetration tests.

Attendance, homework, assessment, fees, timetable, announcements, reporting, and their complete operational UI/API flows remain in Phases 3 and 4. The role permission vocabulary is ready for these modules, but they are not considered delivered until their endpoints and role-specific integration tests are added. Each module is built against the real REST API and database. Production readiness requires a separate security/privacy review and provider configuration.

## Initial project layout

```text
apps/
  api/
    migrations/       ordered PostgreSQL migrations and RLS policies
    src/
      auth/            login, refresh, bootstrap, guards
      db/              pool, migration runner, tenant transaction helper
      schools/         platform school administration/onboarding
      middleware/      auth, role, tenant resolution, errors
      server.ts
  web/
    src/
      app/              router, API client, query provider
      components/       shell, navigation, shared UI
      features/         dashboard, schools, invitations
      pages/
docs/
```
