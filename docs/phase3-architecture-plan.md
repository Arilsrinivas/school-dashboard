# Phase 3 School Operations Delivery Plan

## Guardrails inherited from the current application

- Continue using the existing React/Vite client, Express REST API, PostgreSQL schema/migrations, `tenantTransaction`, school roles and permission grants. Do not replace authentication, tenant selection, RLS, invitations, school suspension, or approved support access.
- Derive the school from the authenticated membership. Every tenant query must run in `tenantTransaction`; every new tenant table must have `school_id`, RLS, same-school composite foreign keys, and school-leading indexes. Ignore client-supplied tenant IDs for authority.
- Keep platform control-plane access separate. Routine platform users must not browse operational school records; any exceptional access remains inside the existing limited, approved, time-boxed support workflow.
- Use the existing permission vocabulary (`attendance:*`, `homework:*`, `exams:*`, `results:*`, `fees:*`, `timetable:*`, `announcements:*`, `reports:*`) and add permissions only with a migration, default role grants, UI role editor coverage, and tests.
- Audit edits/publication, financial entries, exports, branding changes and other sensitive mutations. Use Zod validation and stable error responses. Preserve historical records through status/archival transitions.

## Stage-gate method

Each module is a vertical slice: (1) schema/migration and constraints, (2) permission-checked API with tenant scoping and validation, (3) role-aware UI with loading/empty/error states, (4) database-backed integration tests including foreign-school identifiers and denied roles, (5) build and full regression suite. A gate passes only when all five parts pass. Do not label schema inventory or a permission string as delivered functionality.

Use ordered migrations after `002_school_authority.sql`. Every migration must be idempotent where practical, recorded by the migration runner, and applied in the same PostgreSQL-backed test setup that loads all migrations. Unit tests complement API/DB integration tests; they do not replace them. Export endpoints also need authorization, audit, pagination/size limits, and formula-safe spreadsheet output.

## Module stages and proposed API seams

Endpoints below are contract proposals; keep route naming aligned with the existing `/api/school` router and its response conventions.

### Gate A — Attendance

**Data:** `attendance` (or an additive replacement only if inspection shows the existing table is insufficient) uniquely keyed by `(school_id, student_id, attendance_date)`; include status enum/check (`present`, `absent`, `late`, `excused`), class/section context, marker, note/reason, timestamps, and a separate immutable correction history/audit record. Enforce student/enrollment/class same-school consistency. Never permit silent upsert replacement of a prior mark.

**API:** `GET /attendance?date&classId&sectionId`, `POST /attendance/bulk`, `PATCH /attendance/:id`, `GET /students/:id/attendance`, `GET /attendance/calendar`, and `GET /reports/attendance?period=month|year&...`. Restrict teachers to assigned classes; parents/students to linked/self records. Bulk writes validate the entire batch and return per-row validation/conflict details; use a transaction and DB uniqueness as the final duplicate guard. Corrections require reason and audit old/new values. Absence notices must enqueue only after commit.

**UI:** daily class register with bulk status actions, correction flow, calendar, student history, month/year percentages and authorized report views. Percentage denominator rules (e.g. exclude excused days) must be explicit and consistent in reports.

**Gate evidence:** two-school RLS/API test; duplicate same-day mark conflict; assigned-class and linked-child access; correction history; report totals and zero-enrollment behavior; absence queue event created once.

### Gate B — Homework and assignments

**Data:** tenant assignments with creator, description, due time, target class/section and publication state; private file metadata references; submissions unique per assignment/student, with submitted time, attachment references, late state, reviewer, marks, feedback and review timestamps. Foreign keys must ensure student membership in the target class/year.

**API:** `GET/POST /assignments`, `GET/PATCH /assignments/:id`, `POST /assignments/:id/submissions`, `GET /assignments/:id/submissions`, `PATCH /submissions/:id/review`, `GET /reports/homework`. Submit/review authorization is scoped to the student/parent links or assigned teacher. Marks cannot exceed configured maximum. Submissions and review history are audited.

**UI:** teacher assignment editor/review queue; student/parent homework list and student submission flow; teacher/class completion dashboard. File references are authorized by tenant and relationship; no public bucket URLs.

**Gate evidence:** targeting validation, late cutoff boundary, repeat submission policy, teacher assignment scoping, linked child access, foreign-school submission denial, review/marks constraints, completion denominator tests.

### Gate C — Examinations and results

**Data:** examination and subject rows scoped to school and academic year, with exam type, dates, class targets, maximum marks and grading configuration version. Results unique per exam-subject-student; use status for absent/exempt rather than ambiguous null marks. Store publication state/timestamp and audit changes. Rankings are calculated only when an explicit school setting enables them.

**API:** `GET/POST /examinations`, `PATCH /examinations/:id`, `POST /examinations/:id/marks/bulk`, `PATCH /results/:id`, `POST /examinations/:id/publish`, `GET /students/:id/performance`, `GET /report-cards/:studentId?yearId=...`. Published result reads must be isolated to self/linked child and return no unpublished marks. Bulk entry validates subject ownership, student enrollment and max marks atomically.

**UI:** exam setup, subject/max-mark configuration, bulk marks grid, grading settings, preview/publish flow, student performance history, policy-gated rankings and printable/downloadable report cards.

**Gate evidence:** marks bounds, grade boundaries, recalculation, publication transition and audit, no unpublished disclosure to parent/student, cross-school result denial, rankings disabled by default, report-card data correctness.

### Gate D — Timetable

**Data:** period definitions and timetable entries scoped to school, academic year, class/section, teacher, subject and optional room. Enforce same-school references. Conflict checks must account for both teacher and room, and overlapping intervals for the same class. Keep draft/published versions or explicit publication state.

**API:** CRUD `/timetable/periods`, CRUD `/timetable/entries`, `POST /timetable/publish`, `GET /timetable/classes/:classId`, `GET /timetable/teachers/:teacherId`, plus self/linked views. Validate time ranges, weekday, assignment and school calendar. Prevent publication with unresolved conflicts.

**UI:** class/teacher weekly views, schedule editor, conflict explanations and publish control; parent/student views read only.

**Gate evidence:** teacher/room/class collision, boundary overlap, cross-school references, unpublished visibility, published role-specific reads.

### Gate E — Fees and payments

**Data:** fee categories, structures, student fee assignments, installments, payments and receipts. Amounts use integer minor units (or PostgreSQL numeric with defined currency/scale), immutable payment ledger, idempotency key and receipt number unique per school. Reversals/refunds are compensating ledger rows, not destructive edits. Payment gateway integration remains an interface seam only.

**API:** category/structure CRUD, student fee assignment, `POST /payments/offline`, `POST /payments/:id/reverse` with permission, `GET /students/:id/fees`, `GET /payments/:id/receipt`, `GET /reports/fees`. Calculate outstanding as assigned charges minus valid payments/credits; never trust client balance. Accountant permissions must not imply exam permissions; parents see linked children only.

**UI:** fee category/structure setup, student ledger, offline payment receipt, reminders and collection/outstanding reports. Do not collect card/bank credentials in this phase.

**Gate evidence:** transaction atomicity, duplicate idempotency, overpayment policy, reversal history, receipt authorization, cross-school denial, parent link boundary, aggregate reconciliation.

### Gate F — Announcements and notifications

**Data:** announcements with school/class/audience, author, schedule/expiry and publish state; notification preferences by channel/type; per-recipient notifications with read timestamps; background job/outbox records with tenant ID, event key, idempotency key, retry count/state. Enforce deduplication and queue tenant validation. Avoid storing secrets/provider payloads or unnecessary child data in jobs.

**API:** CRUD `/announcements`, `POST /announcements/:id/publish`, `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notification-preferences`. Parent/teacher messages remain under existing conversation relationships and require a separate authorization gate. Queue delivery after commit; retry safely. Push/email/SMS adapters must fail closed/configure cleanly when providers are unset.

**UI:** announcement targeting/composer, in-app notification center, unread/read controls and preferences. Channel delivery status must be distinguishable from in-app creation.

**Gate evidence:** audience targeting, preference suppression, once-only enqueue, tenant context validation, retry behavior, read isolation, provider-not-configured behavior, no cross-school delivery.

### Gate G — Reports and analytics

**Data/query layer:** all aggregates begin with active school context and authorized scope. Reuse domain query functions; avoid duplicating calculations in frontend. Add indexes only for measured/paginated access patterns. Do not expose platform-wide student-level analytics to platform roles.

**API:** `GET /reports/dashboard`, plus paginated/filterable attendance, academics, homework, fees and teacher reports. PDF and Excel exports are generated from the same authorized query/filter contract. Large exports run as tenant-scoped background jobs and are downloaded via short-lived, authorization-checked file records.

**UI:** dashboard metrics and filters, export actions, progress/status and retry states.

**Gate evidence:** role-level report scope, aggregates reconcile to source rows, school boundary tests, export audit records, spreadsheet formula escaping, bounded export sizes, PDF/Excel readability and authorization on later download.

### Gate H — School branding

**Data:** extend tenant school settings with logo file reference, name/address/contact fields, validated colors and report-card/announcement display choices. Store logo in private object storage with tenant-owned metadata; do not put image bytes in PostgreSQL. Limit image MIME/size and sanitize SVG or reject active formats.

**API/UI:** `GET/PATCH /settings/branding`, upload-intent/complete APIs integrated with private object storage, and preview for report cards/announcements. Only holders of `school:settings:update` can change it; public-facing school branding must not expose private contact fields unless selected.

**Gate evidence:** per-school settings isolation, permission denial, upload MIME/size validation, authorized private download, report/announcement appearance uses saved data.

## Current infrastructure and verification limits (repository evidence)

- `docker-compose.yml` supplies PostgreSQL 16 and Redis 7; API code currently uses `pg.Pool` and a `tenantTransaction` helper. No Redis/BullMQ worker implementation or queue package is present in the API package at this checkpoint. `REDIS_URL` is documented as reserved. Notification/background delivery is therefore not yet available merely because Redis starts.
- `docs/architecture.md` describes private S3/R2 storage and email/SMS/push as future integrations. The repo currently has Nodemailer dependency/configuration, but no object-store SDK or implemented upload service. Attachment, logo, report download, push, and SMS acceptance must wait on real provider-backed adapters or a deliberately implemented local private-storage adapter with equivalent authorization tests.
- Existing tenant integration tests use PGlite (PostgreSQL WASM) through a wire-protocol socket and load real SQL migrations. They are valuable DB-backed tests but do not substitute for a configured PostgreSQL 16 service test against Docker/production-like runtime roles. Current `npm test` entrypoint does not include all future module tests unless updated.
- Root scripts provide build and API tests; no security-check script or actual Excel/PDF dependency currently appears in the package manifests. Add a reproducible security command and vetted export packages only as part of a module gate, with dependency review.
- At the inspected checkpoint, migration inventory ends at `002_school_authority.sql`; docs list domain tables in the initial schema but explicitly say operational API/UI flows remain phased. The existence of tables/permissions must not be counted as completed workflows.

## Release acceptance checklist

1. All eight gates pass on a clean database migrated from scratch; no stage ships a disconnected dashboard or hardcoded operational records.
2. Every mutation checks the relevant school permission and assignment/relationship scope inside the API; every endpoint has validation and a database-backed authorization test.
3. Each module has both same-school happy-path and School A/School B direct-API denial tests using runtime RLS credentials; parent-child and teacher-assignment boundaries are tested where applicable.
4. Run full build, full unit/integration suite, actual PostgreSQL-backed migrations/integration suite, dependency/security checks, and verify generated reports/downloads before reporting completion. Document any provider or environment prerequisite that prevents a check from running; never substitute a mock and call it verified.
5. Update the README, architecture docs, implementation plan and implementation report with migration numbers, routes/UI, test commands/results, infrastructure prerequisites, and any remaining limitations.
