# CalmStacks EduConnect — Comprehensive Repository Audit, Verification & Assessment

**Audit Date:** November 20, 2026  
**Auditor:** Principal Software Architect, Senior Full-Stack Engineer, SaaS Security Auditor & Database Architect  
**Codebase:** `CalmStacks EduConnect` (`apps/api`, `apps/web`)  
**Live Production URL:** `https://school-dashboard-nine-rho.vercel.app`  
**Classification:** Complete Technical Repository & Live Deployment Audit  

---

# SECTION 1 — Executive Summary

### Overall Project Health
CalmStacks EduConnect is a **well-structured, highly ambitious multi-tenant educational SaaS platform** built on a TypeScript monorepo (`Express` backend, `PostgreSQL 16` database with Row-Level Security, and `React 18 / Vite` frontend). The engineering of the database schema (67 relational tables) and the backend API routes is exceptionally thorough: core operational logic for **attendance, homework, examinations, timetables, fee collection, announcements, and reports** is implemented with transactional integrity, foreign key constraints, and passing integration test suites.

However, the platform is currently a **Feature Preview / Staging Candidate**, NOT a production-ready application. Critical gaps exist in external service integrations (real Google OAuth, transactional email delivery, background queue processing, and binary file storage), and one critical authentication bypass vulnerability must be remediated immediately.

### What is Genuinely Complete
- **Multi-Tenant Foundation:** Composite tenant foreign keys `(school_id, id)` across all tables, transaction-scoped tenant context (`tenantTransaction`), and platform vs school pool separation.
- **Academic & Operational Engines:** Classes, sections, subjects, daily attendance registers, immutable audit triggers, examination marks entry, grading scales, timetable period conflicts, fee structures, idempotent receipt numbering, and fee reversals.
- **Password Security & JWT Lifecycle:** Argon2id password hashing, 15-minute access tokens (`jose` HS256), and 30-day hashed refresh token rotation in `HttpOnly; SameSite=Strict; Secure` cookies.
- **Platform Governance:** School provisioning with display ID generation (`CS-SCH-xxxx`), subscription plans, trial expiration rules, school suspension, and scoped support impersonation requests.

### What is Partially Complete
- **Google Authentication:** Backend possesses official token verification logic, but also an unconditioned mock token backdoor (`SEC-001`). The web frontend uses a simulated modal prompt rather than the official Google Identity Services popup.
- **Invitations & Password Recovery:** Tokens are generated securely with direct URLs returned to the UI, but automatic background email delivery fails in production because raw SMTP (`nodemailer`) is unconfigured (`BUG-002`).
- **Parent & Student Portals:** Functional backend exists, but frontend renders the same `SchoolWorkspace` filtered by permissions rather than custom parent/student dashboards.
- **PostgreSQL Row-Level Security:** 29 tables have RLS policies, but lack `FORCE ROW LEVEL SECURITY` for superuser connections (`SEC-003`).

### What is Missing
- **Background Worker Daemon:** Asynchronous jobs (`background_jobs` table) are enqueued via a transactional outbox, but no worker daemon exists to drain or dispatch them (`BUG-001`).
- **Binary File Storage Pipeline:** `uploaded_files` metadata exists, but there is no multipart upload route or cloud storage integration (S3/R2/GCS presigned URLs) for student documents or homework files (`BUG-004`).
- **DPDP Act (India) Child Consent Workflow:** No parental consent tracking or field-level encryption for sensitive student medical notes (`SEC-004`).

### Production Readiness Verdict
- **Classification:** **Staging Ready / Feature Preview** (NOT Production Ready).
- **Core Blocker:** `SEC-001` (mock Google token backdoor) must be restricted to `NODE_ENV === 'test'` before opening public access.

---

# SECTION 2 — Live Deployment Audit

**Audited Live URL:** `https://school-dashboard-nine-rho.vercel.app`  
**Hosting Environment:** Vercel Serverless Functions (`@vercel/node`) + Vercel Edge CDN  
**Verification Method:** Interactive Browser Automation Subagent (`webview_browser`) on Desktop (1440x900, 1280x800) and Mobile (375x667) viewports.

### 2.1 Screens & Routes Inspected
1. **Landing & Authentication Portal (`/`):**
   - **Split Screen Layout:** Left dark forest green hero panel (`#1e3a2b`) displaying `calmstacks educonnect · MODERN SCHOOL PLATFORM`, headline `Good schools grow together.`, and social proof avatar badge cluster. Right card housing the authentication forms.
   - **Role Carousel:** Tested all 5 role filter pills: `All Roles`, `School Admin`, `Teacher`, `Parent`, `Student`. Each dynamically reconfigures portal badges, headings, and helper text.
   - **Portal Mode Toggle:** Verified `School account` (with optional School ID) vs. `Platform team` (hiding School ID input).
2. **Register School Tab View:**
   - Accessible via top toggle; displays clean onboarding form for School Name, Admin Full Name, Work Email, and Password.
3. **Google Sign-In Modal Flow:**
   - Clicked `Continue with Google`; observed white modal dialog with Google Full Name and Google Email inputs.
   - **Linked Account Test (`arilsrinivas8@gmail.com`):** Submitted modal; verified HTTP 200 OK from `/api/auth/google`, instant session cookie establishment, and transition to School Administrator workspace for `CS-SCH-0001` (Aril Srinivas).
   - **Unlinked Account Test (`johndoe@example.com`):** Submitted modal; verified **HTTP 403 Forbidden** response with payload:
     `{"error":"access_denied","message":"No EduConnect account found for this Google email. Access requires an existing account or an active invitation from your school."}`.
4. **"School Workspace Required" Error Screen:**
   - Verified that the application gracefully caught the 403 error and rendered the "School Workspace Required" modal with clear guidance for creating a new institution or requesting a school invitation.
5. **Authenticated School Administrator Workspace:**
   - Verified active dashboard tabs: Overview, Classes, Students, Attendance, Homework, Exams & Results, Timetable, Fees & Payments, Announcements, Reports, Settings, Roles & access.
   - Tenant boundary banner confirms: `Row-Level Security Active · School ID: CS-SCH-0001 · 31 granular privileges assigned`.

### 2.2 Live Network & API Health Audit

| Endpoint | Method | Status | Notes |
|---|:---:|:---:|---|
| `/` | `GET` | **200 OK** | Vite SPA shell loaded with DM Sans & Manrope web fonts. |
| `/api/auth/refresh` | `POST` | **200 OK** | Silent background token refresh operational. |
| `/api/auth/google` *(Linked)* | `POST` | **200 OK** | Valid session cookie set, user profile and permissions returned. |
| `/api/auth/google` *(Unlinked)* | `POST` | **403 Forbidden** | Rejected with `access_denied` per specifications. Rate limit header `limit=300, remaining=294`. |
| `/api/auth/logout` | `POST` | **204 No Content** | Invalidates session and clears cookies cleanly. |
| `/api/school/dashboard` | `GET` | **200 OK** | Queries school metrics (0 students, 0 faculty, 0 attendance records) for `CS-SCH-0001`. |
| `/api/school/notifications` | `GET` | **200 OK** | Queries in-app notifications for authenticated administrator. |
| `/api/health` | `GET` | **200 OK** | Returns `{"status":"ok","database":"ok"}`. |

### 2.3 Broken Functionality & UI Defects Discovered on Live Deployment
1. **Modal Text Overlap Glitch (`UX-001`):**
   - On the "School Workspace Required" 403 error modal, the outer wrapper lacks a solid background color. The red alert shield icon, `School Workspace Required` heading, and email text render transparently, directly overlapping the darkened landing page background text (`Welcome back`).
2. **Aborted Logout Calls in Network Log:**
   - When signing out, in-flight background requests to `/api/school/notifications` are aborted (`net::ERR_ABORTED`), which is normal browser behavior during unmount but should be handled cleanly with `AbortController`.
3. **Simulated Google Modal vs Official Popup:**
   - The live site presents a custom text form asking for name/email rather than launching the official Google One Tap or OAuth popup.

---

# SECTION 3 — Multi-Tenant Architecture & RBAC Audit

### Tenant Context Derivation & Data Isolation
- **Isolation Mechanism:** The tenant context is never accepted blindly from client request bodies. It is extracted from the cryptographically verified JWT (`identity.schoolId`), cross-referenced against `school_memberships` in PostgreSQL, and set per-transaction via `SELECT set_config('app.school_id', $1, true)`.
- **Database Composite Foreign Keys:** Every child entity enforces composite foreign keys `(school_id, parent_id) REFERENCES parent_table(school_id, id)`. This guarantees mathematical impossibility of cross-tenant foreign key relationships.
- **Tenant Isolation Testing:** In `apps/api/src/db/tenant-isolation.test.ts` and `apps/api/src/e2e/e2e-workflow.test.ts`, two completely separate schools were provisioned concurrently. Cross-tenant reads, updates, and deletes were attempted; all were blocked with zero data leakage.

### Role-Based Access Control (RBAC) Matrix
The backend defines 31 discrete permissions. Verification confirms these are enforced at the API layer:

| Role | Accessible Workspaces | Primary Allowed Operations | Restricted Operations |
|---|---|---|---|
| **CalmStacks Super Admin** | Platform Control Panel | Create schools, manage subscriptions, view platform audit logs. | Routine access to private school academic and student records. |
| **School Administrator** | All 12 School Tabs | Full school setup, class creation, admissions, fee structures, role privilege assignment. | Platform-level tenant provisioning. |
| **Teacher** | Attendance, Homework, Exams, Timetable, Announcements | Take daily attendance for assigned classes, grade homework, enter exam marks. | School financial ledgers, editing other teachers' assignments. |
| **Parent** | Attendance, Homework, Exams, Timetable, Fees, Announcements | View linked children's attendance, grades, report cards, and fee balances. | Accessing unlinked student records, modifying marks or attendance. |
| **Student** | Attendance, Homework, Exams, Timetable, Announcements | View class timetable, submit homework, view published exam report cards. | Viewing unpublished marks, taking attendance, viewing other students' work. |

---

# SECTION 4 — Findings Register

| Finding ID | Severity | Category | Affected File(s) | Summary & Impact |
|---|:---:|:---:|---|---|
| **SEC-001** | **CRITICAL** | Security | `apps/api/src/auth/google.ts:28-67` | Mock token backdoor allows arbitrary authentication bypass in production. |
| **SEC-002** | **MEDIUM** | Security | `apps/api/src/server.ts:26-36` | CORS configuration reflects all origins with `credentials: true`. |
| **SEC-003** | **HIGH** | Security / DB | `apps/api/src/db/pool.ts`, `migrations/*` | Table owners bypass PostgreSQL RLS unless `FORCE ROW LEVEL SECURITY` is applied. |
| **SEC-004** | **HIGH** | Compliance | `001_initial.sql:24`, `schools/routes.ts` | Non-compliance with DPDP Act 2023 regarding child consent and health data. |
| **SEC-005** | **MEDIUM** | Dependency | `apps/web/package.json:13`, `@grpc/grpc-js` | 4 High-severity vulnerabilities in deprecated Firebase dependency. |
| **BUG-001** | **HIGH** | Functionality | `attendance/routes.ts`, `fees/routes.ts` | Background job consumer daemon is missing; transactional outbox is never drained. |
| **BUG-002** | **HIGH** | Functionality | `auth/routes.ts:835-840`, `schools/roles.ts:56` | Invitations and password resets fail to send emails due to missing transactional email API. |
| **BUG-003** | **MEDIUM** | Functionality | `apps/web/src/App.tsx:232-242` | Google Sign-In uses simulated modal rather than official Google Identity Services SDK. |
| **BUG-004** | **MEDIUM** | Functionality | `homework/routes.ts:120`, `001_initial.sql` | Binary file storage pipeline is missing (metadata only in `uploaded_files`). |
| **UX-001** | **MEDIUM** | UI / UX | `apps/web/src/App.tsx:514-566` | "School Workspace Required" 403 modal has transparent header overlapping background text. |
| **ARCH-001** | **HIGH** | Scalability | `apps/api/src/db/pool.ts:21-35` | Serverless direct connection pooling risks PostgreSQL connection exhaustion under high concurrency. |
| **ARCH-002** | **MEDIUM** | Performance | `apps/web/vite.config.ts`, `dist/assets/*` | Monolithic web bundle (765 kB JS) lacks route-based code splitting. |

---

# SECTION 5 — Detailed Findings & Remediation

### Critical & High Severity Summary

1. **Remediate SEC-001 Immediately:** Wrap mock token parsing in `if (process.env.NODE_ENV === 'test')` inside `apps/api/src/auth/google.ts`. Never allow unverified tokens to execute in production.
2. **Execute Migration 010 for FORCE RLS (`SEC-003`):** Add `ALTER TABLE tablename FORCE ROW LEVEL SECURITY;` across all tenant-scoped tables so superuser connections obey RLS.
3. **Replace Nodemailer with Resend API (`BUG-002`):** Cloud serverless runtimes cannot reliably dispatch raw SMTP. Implement Resend or Amazon SES HTTP API.
4. **Implement PgBoss Background Worker (`BUG-001`):** Build a worker daemon that polls `background_jobs` and executes absence alerts and fee receipts.
5. **Address DPDP Act Child Data Requirements (`SEC-004`):** Add parental consent verification records and encrypt student medical notes.

---

# SECTION 6 — Final Verdict & External Reviewer Answers

#### 1. What percentage of the intended product is genuinely complete?
**62% Overall Completion.**  
*Estimation Methodology:* Evaluated across 64 discrete functional capabilities spanning 4 architectural tiers: Database Schema (85%), Backend API Routes (75%), Frontend UI Workspaces (60%), and End-to-End External Integrations (28%). While core school operations are mature, external integrations (email dispatch, file storage, background queues, and live Google GIS) are incomplete.

#### 2. What is working end-to-end?
- School self-registration, display ID assignment (`CS-SCH-xxxx`), and subscription activation.
- Academic setup: years, terms, classes, sections, subjects, and teacher assignments.
- Student admissions and roster directory.
- Daily attendance marking, correction history, and append-only database triggers.
- Homework assignment creation, text submissions, grading, and teacher feedback.
- Examination scheduling, marks recording, letter grade calculation, and report cards.
- Timetable period slotting and conflict double-booking prevention.
- Fee structures, student fee assignments, payment recording, and idempotent receipt numbering.
- School-wide and role-targeted announcements.
- Administrative analytics dashboard and CSV data exports.
- Multi-tenant zero-leakage isolation across separate schools.

#### 3. What is incomplete or only a placeholder?
- **Google Sign-In:** The live frontend uses a simulated modal prompt generating mock tokens; official Google Identity Services popup/one-tap is not wired.
- **Background Job Outbox:** Jobs are enqueued into `background_jobs`, but zero worker daemons exist to process them.
- **Email Delivery:** Invitations and recovery links rely on manual URL copy-pasting because SMTP fails in serverless environments.
- **Binary File Storage:** Uploads for student documents and homework PDFs do not have an active binary storage engine.
- **Parent & Student Custom Portals:** They currently share the administrator workspace filtered by permissions.

#### 4. What are the five most serious issues?
1. **SEC-001 (Critical):** Mock Google token backdoor active in production allows authentication bypass.
2. **ARCH-001 / SEC-003 (High):** PostgreSQL RLS bypassed for table owners without `FORCE ROW LEVEL SECURITY`, and connection pool exhaustion risks under serverless scale.
3. **BUG-001 (High):** Background job worker daemon completely missing; transactional outbox is never drained.
4. **SEC-004 (High):** Children's sensitive health data and emergency contacts stored in plaintext without parental consent tracking (DPDP Act 2023 non-compliance).
5. **BUG-002 (High):** Automated invitation emails fail in production due to lack of a transactional email API.

#### 5. Is the multi-tenant isolation trustworthy?
**Yes, at the application and query layer.** Composite foreign keys `(school_id, id)` prevent cross-tenant referencing, and `tenantTransaction` scopes execution to `app.school_id`. However, `FORCE ROW LEVEL SECURITY` must be added to prevent bypass if connecting as table owner.

#### 6. Is role-based authorization enforced correctly?
**Yes.** Authorization is enforced on the Express backend via `requireSchoolRole` and `requireSchoolPermission`. Role checks are backed by database queries against `school_roles` and `school_role_permissions`.

#### 7. Is Google authentication implemented correctly?
**No.** The backend contains cryptographic verification logic for real tokens, but also an unconditioned mock-token backdoor. The frontend does not invoke Google Identity Services SDK, instead collecting name/email in a custom modal and constructing test tokens.

#### 8. Is the architecture suitable for the intended SaaS scale?
**Partially.** The composite tenant schema in PostgreSQL is excellent and can support thousands of schools. However, running direct connection pools on serverless lambdas without an external transaction pooler (Supavisor) will crash under concurrent morning attendance loads, and background tasks need a queue daemon.

#### 9. Is the application safe to deploy?
**No, not in its current state.** It is a **Staging Candidate / Feature Preview**. The mock token bypass (`SEC-001`) and lack of email delivery (`BUG-002`) make public production unsafe.

#### 10. What should be fixed first?
1. Restrict `test-google-token:` strictly to `NODE_ENV === 'test'` in `google.ts`.
2. Fix the visual CSS overlap glitch on the "School Workspace Required" modal (`UX-001`).
3. Add `FORCE ROW LEVEL SECURITY` to all tenant tables in PostgreSQL.
4. Integrate Resend or Postmark API for transactional invitation emails.

#### 11. What should be built next?
1. Wire official Google Identity Services (`google.accounts.id.renderButton`) on the web frontend.
2. Build the PgBoss / BullMQ background queue consumer daemon.
3. Implement presigned S3/R2 cloud object storage for student files and homework attachments.
4. Develop dedicated, simplified parent and student dashboard interfaces.
5. Implement the DPDP Act child consent management module.

#### 12. What should not be changed because it is already working correctly?
- The composite tenant database schema and migration architecture (migrations 001–009).
- The `tenantTransaction` pattern with transaction-local tenant context (`app.school_id`).
- The JWT access token (15m) and HMAC-SHA256 hashed refresh token rotation architecture.
- The core academic modules (Attendance, Homework, Examinations, Timetable, Fees, Reports, Announcements), which have comprehensive database constraints, immutable history triggers, and passing integration test suites.

---

# SECTION 7 — Report Directory & Artifact Index

The complete audit suite consists of 5 dedicated reports in the `docs/` directory:

1. **Comprehensive Audit Report (This File):** [docs/COMPREHENSIVE_AUDIT_REPORT.md](file:///c:/Users/User/Desktop/school%20web/docs/COMPREHENSIVE_AUDIT_REPORT.md)
2. **Feature Completion Matrix:** [docs/FEATURE_COMPLETION_MATRIX.md](file:///c:/Users/User/Desktop/school%20web/docs/FEATURE_COMPLETION_MATRIX.md)
3. **Security Audit & Findings Register:** [docs/SECURITY_AUDIT.md](file:///c:/Users/User/Desktop/school%20web/docs/SECURITY_AUDIT.md)
4. **Test Execution & Quality Report:** [docs/TEST_EXECUTION_REPORT.md](file:///c:/Users/User/Desktop/school%20web/docs/TEST_EXECUTION_REPORT.md)
5. **Architecture & Scaling Recommendations:** [docs/ARCHITECTURE_RECOMMENDATIONS.md](file:///c:/Users/User/Desktop/school%20web/docs/ARCHITECTURE_RECOMMENDATIONS.md)

*Live browser visual evidence and screenshots are archived in:*  
`C:\Users\User\.gemini\antigravity\brain\fbb20928-3fd7-449f-8268-24ab01c990e9\browser_evidence\live_audit\`
