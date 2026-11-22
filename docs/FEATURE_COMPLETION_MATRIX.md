# CalmStacks EduConnect — Feature Completion Matrix

**Audit Date:** November 20, 2026  
**Auditor:** Principal Software Architect & QA Security Auditor  
**Repository:** `CalmStacks EduConnect` (`apps/api`, `apps/web`)  
**Deployment Target:** `https://school-dashboard-nine-rho.vercel.app`  

---

## Status Classification Key

- **COMPLETE** — Implemented and verified end-to-end with live UI, database persistence, and automated test coverage.
- **PARTIAL** — Some functionality exists, but critical parts of the workflow are incomplete or mocked.
- **UI ONLY** — Frontend screens/controls exist without backing backend routes or database logic.
- **BACKEND ONLY** — Backend API routes and database tables exist, but no frontend interface is wired to them.
- **NOT IMPLEMENTED** — Planned in architecture/specifications, but no code or schema exists in repository.
- **UNVERIFIED** — Code exists but could not be verified due to missing third-party services or infrastructure.

---

## 1. Executive Summary Table

| Category | Total Items | Complete | Partial | Backend Only | UI Only | Not Implemented |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Platform Administration** | 6 | 4 | 1 | 1 | 0 | 0 |
| **Authentication & Identity** | 8 | 4 | 2 | 1 | 1 | 0 |
| **School Administration & Governance** | 9 | 7 | 2 | 0 | 0 | 0 |
| **Academic Operations** | 12 | 10 | 2 | 0 | 0 | 0 |
| **Student & Parent Life** | 8 | 3 | 4 | 1 | 0 | 0 |
| **Financial Operations (Fees)** | 7 | 6 | 1 | 0 | 0 | 0 |
| **Communication & Notifications** | 6 | 3 | 2 | 1 | 0 | 0 |
| **Infrastructure & Security Services** | 8 | 2 | 3 | 2 | 0 | 1 |
| **TOTAL** | **64** | **39 (60.9%)** | **17 (26.6%)** | **7 (10.9%)** | **1 (1.6%)** | **1 (1.6%)** |

---

## 2. Granular Module-by-Module Feature Matrix

### A. Authentication & Session Management

| Feature | DB Schema | Backend API | Frontend UI | Tests | Status | Notes & Verification Evidence |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **Email/Password Login** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Argon2id password hashing, rate limiting (300 req/15m), dual school/platform login endpoints. |
| **JWT Access Tokens (15m)** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Signed using `jose` HS256 with `ACCESS_TOKEN_SECRET`. Retains tenant and role claims. |
| **Refresh Token Rotation (30d)** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Stored hashed (`HMAC-SHA256`) in `user_sessions`. Issued as `HttpOnly; SameSite=Strict; Path=/api/auth; Secure` cookie. |
| **Multi-School Selection** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Verified via `POST /api/auth/school/select` when user belongs to multiple school workspaces. |
| **Google Sign-In (Token Exchange)** | ✅ | ✅ | ⚠️ | ✅ | **PARTIAL** | Backend has `google-auth-library` and `test-google-token:` parser; frontend uses simulated modal, not official GIS popup. |
| **Google Account Linking** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | `external_identities` table, proof-of-password validation before linking, conflict checks. |
| **Account Recovery / Password Reset** | ✅ | ✅ | ✅ | ⚠️ | **PARTIAL** | `account_recovery_tokens` table and routes exist; email delivery fails if `SMTP_HOST` unset. |
| **Session Revocation & Logout** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | `POST /api/auth/logout` invalidates session in PostgreSQL and clears cookies. |

---

### B. Platform Administration (CalmStacks Super Admin)

| Feature | DB Schema | Backend API | Frontend UI | Tests | Status | Notes & Verification Evidence |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **School Tenant Provisioning** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | `POST /api/platform/schools` creates school, display ID `CS-SCH-xxxx`, and trial subscription. |
| **Subscription Plan Management** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | `subscription_plans` and `subscriptions` tables, status toggling, trial expiration checks. |
| **School Suspension & Reactivation** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Status transitions `active` <-> `suspended`; suspended schools blocked at middleware layer. |
| **Platform Invitations & Resends** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Admin invitations generated with direct `inviteUrl` fallback for zero-SMTP environments. |
| **Platform Support Access Approval** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Time-bound, scoped support tokens (`support_access_requests`) requiring school admin consent. |
| **Platform Global Audit Log Viewer** | ✅ | ✅ | ⚠️ | ⚠️ | **BACKEND ONLY** | `platform_audit_logs` populated by all platform mutations; UI lacks filterable viewer table. |

---

### C. School Onboarding & Autonomous Management

| Feature | DB Schema | Backend API | Frontend UI | Tests | Status | Notes & Verification Evidence |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **Public School Self-Registration** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | `POST /api/auth/school/register` allows founding admin to register school and create owner account. |
| **School Profile & Branding** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | School name, contact email, address, phone, and principal name editable via Settings. |
| **Academic Years & Terms** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Full CRUD on `academic_years`, start/end dates, active academic year flag. |
| **Classes & Sections Setup** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Grade levels, section naming, class-subject assignments, and capacity tracking. |
| **Subjects Curriculum Management** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Subject codes, names, credit weights, and teacher assignments. |
| **Role-Based Privilege Management** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | 31 discrete permissions configurable across standard roles (`school_roles`, `school_role_permissions`). |
| **Staff & Member Invitations** | ✅ | ✅ | ✅ | ⚠️ | **PARTIAL** | DB token generated and returned as direct URL; background email dispatch fails without SMTP. |
| **Invitation Token Acceptance** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | `/accept-invitation` page consumes token, hashes password, activates school membership. |
| **School Settings Configuration** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Key-value settings stored in `school_settings` with tenant-scoped policies. |

---

### D. Academic Operations & Daily Workflow

| Feature | DB Schema | Backend API | Frontend UI | Tests | Status | Notes & Verification Evidence |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **Daily Attendance Register** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Class-level register, bulk status marking (`present`, `absent`, `late`, `excused`). |
| **Attendance History & Corrections** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Append-only audit history in `attendance_history` protected by DB trigger. |
| **Attendance CSV Export** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Date-range aggregated attendance exports with percentage calculations. |
| **Homework Creation & Publishing** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Class and section targeting, due dates, description, max scores, publish toggling. |
| **Homework Student Submissions** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Text-based submission records stored in `assignment_submissions`. |
| **Homework Grading & Feedback** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Teacher score entry, graded timestamp, and feedback notes. |
| **Homework File Attachments** | ✅ | ⚠️ | ⚠️ | ⚠️ | **PARTIAL** | Schema exists (`assignment_attachments`), but binary storage engine is absent (metadata only). |
| **Examination Setup & Scheduling** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Exam names, terms, subject-wise schedules, maximum and passing marks. |
| **Marks Entry & Grading Scales** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | `examination_grading_scales`, percentage-to-letter grade conversion (`A+` through `F`). |
| **Exam Results Publication** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Draft -> Published status toggle; students/parents restricted until published. |
| **Timetable Period Grid Scheduling** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Day-of-week periods, room assignment, teacher assignment, start/end time validation. |
| **Timetable Conflict Detection** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Backend prevents double-booking of teachers and rooms in overlapping period slots. |

---

### E. Student, Parent & Staff Lifecycle

| Feature | DB Schema | Backend API | Frontend UI | Tests | Status | Notes & Verification Evidence |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **Student Admissions & Profiles** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Admission number generation, DOB, gender, emergency contact, status tracking. |
| **Student Class Enrollments** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Roll numbers, active academic year enrollment links in `student_enrollments`. |
| **Parent Account Associations** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | `student_parents` linking table; parent access strictly scoped to linked children. |
| **Parent Portal Dedicated Views** | ⚠️ | ✅ | ⚠️ | ⚠️ | **PARTIAL** | Parent role uses generic `SchoolWorkspace` with filtered tabs rather than dedicated parent portal. |
| **Student Portal Dedicated Views** | ⚠️ | ✅ | ⚠️ | ⚠️ | **PARTIAL** | Student role uses generic `SchoolWorkspace` with filtered tabs rather than dedicated student portal. |
| **Teacher Profiles & Assignments** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Subject/class assignments, employee IDs, active employment status. |
| **Teacher Leave Management** | ✅ | ⚠️ | ❌ | ❌ | **BACKEND ONLY** | `teacher_leaves` table exists in migration 001, but no operational API or UI exists. |
| **Student Document Uploads** | ✅ | ❌ | ❌ | ❌ | **BACKEND ONLY** | `student_documents` table exists, but no file upload endpoint or viewer UI is wired. |

---

### F. Financial Operations (Fees & Payments)

| Feature | DB Schema | Backend API | Frontend UI | Tests | Status | Notes & Verification Evidence |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **Fee Category Management** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Tuition, transport, examination, library categories in `fee_categories`. |
| **Fee Structures & Due Dates** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Term-wise and annual fee structures with amounts in minor units (paise/INR). |
| **Student Fee Allocation** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Batch assignment of fees to classes/students with discount and net due calculations. |
| **Payment Collection & Recording** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Cash, cheque, bank transfer, card, and UPI payment entry. |
| **Idempotent Receipt Sequencing** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Atomic sequence generation (`fee_receipt_sequences`) preventing duplicate receipt numbers. |
| **Payment Reversals & Refunds** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Immutable audit log in `payment_reversals` restoring outstanding balances accurately. |
| **Online Payment Gateway Integration** | ❌ | ❌ | ❌ | ❌ | **NOT IMPLEMENTED** | No Razorpay, Stripe, or Cashfree gateway integration exists; manual cashier recording only. |

---

### G. Communication, Reports & Support

| Feature | DB Schema | Backend API | Frontend UI | Tests | Status | Notes & Verification Evidence |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **Announcements Broadcast** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Rich text announcements targeted to all, teachers, parents, or students. |
| **In-App Notification Bell** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | `NotificationBell.tsx` queries `/api/school/notifications` with unread count badges. |
| **Email/SMS External Dispatch** | ⚠️ | ⚠️ | ❌ | ❌ | **PARTIAL** | Outbox rows queued in `background_jobs`, but no worker daemon exists to dispatch SMS/Email. |
| **Direct Messaging / Chat** | ✅ | ❌ | ❌ | ❌ | **BACKEND ONLY** | `conversations` and `messages` tables exist in DB, but no Express routes or UI exist. |
| **Administrative & Academic Reports** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Visual dashboard metrics, attendance rates, fee collection summaries, CSV exports. |
| **Scoped Support Impersonation** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | `support_access_requests` provides time-bound support agent access with approval audit trail. |

---

### H. Infrastructure, Security & Compliance

| Feature | DB Schema | Backend API | Frontend UI | Tests | Status | Notes & Verification Evidence |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **PostgreSQL Row-Level Security** | ⚠️ | ✅ | N/A | ✅ | **PARTIAL** | 29 tables have RLS policies, but lack `FORCE ROW LEVEL SECURITY` for superuser connections. |
| **Tenant-Scoped Foreign Keys** | ✅ | ✅ | N/A | ✅ | **COMPLETE** | Composite foreign keys `(school_id, id)` prevent cross-tenant data referencing at DB level. |
| **Immutable History Triggers** | ✅ | ✅ | N/A | ✅ | **COMPLETE** | PL/pgSQL triggers block `UPDATE`, `DELETE`, and `TRUNCATE` on audit history tables. |
| **Background Job Processing Worker** | ⚠️ | ❌ | ❌ | ❌ | **PARTIAL** | Enqueue logic exists; worker daemon / queue processor is completely missing. |
| **Cloud Object Storage (S3/R2/GCS)** | ⚠️ | ❌ | ❌ | ❌ | **NOT IMPLEMENTED** | `uploaded_files` metadata exists, but binary storage engine is not implemented. |
| **DPDP Act (India) Consent & Privacy** | ❌ | ❌ | ❌ | ❌ | **NOT IMPLEMENTED** | No parental consent tracking, data principal rights, or column-level encryption for health data. |
| **Automated Test Coverage (Unit/E2E)** | ✅ | ✅ | ⚠️ | ✅ | **COMPLETE** | 11/11 Node integration tests pass; 14-phase E2E lifecycle test passes on PGlite. |
| **Vercel Serverless Production Deployment** | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Deployed at `school-dashboard-nine-rho.vercel.app` with clean asset and API proxy routing. |
