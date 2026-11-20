# CalmStacks EduConnect — Automated Test Execution & Quality Report

**Execution Date:** November 20, 2026  
**Auditor:** Principal QA Engineer & Test Automation Lead  
**Execution Environment:** Node.js v22.17.1, Windows x64, TypeScript 5.7.2  
**Target Database:** Supabase PostgreSQL 16 (Remote SSL) & PGlite v0.2.14 (In-Memory POSIX)  

---

## 1. Executive Summary

| Test Suite / Quality Gate | Command Executed | Result | Duration | Tests Executed | Passed | Failed | Skipped |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **API Production Build** | `npm run build --workspace apps/api` | **PASS** | 2.1s | N/A | N/A | 0 | 0 |
| **Web Production Build** | `npm run build --workspace apps/web` | **PASS** | 4.7s | N/A | N/A | 0 | 0 |
| **Backend Integration Suite** | `npm test` | **PASS** | 42.1s | 11 | 11 | 0 | 0 |
| **Full Lifecycle E2E Suite** | `npm run test:e2e --workspace apps/api` | **PASS** | 3.1s | 1 (14 phases) | 1 | 0 | 0 |
| **Dependency Vulnerability Audit** | `npm audit` | **FAIL (4 High)** | 4.2s | 468 pkgs | 464 | 4 | 0 |
| **Docker Compose Config Check** | `docker compose config` | **PASS** | 1.2s | 3 services | Valid | 0 | 0 |

---

## 2. Granular Test Execution Logs

---

### Test Suite 1: Backend Integration Tests (`npm test`)

- **Command:** `npm test` (which triggers `tsx --test --test-concurrency=1 src/auth/security.test.ts src/auth/google-auth.integration.test.ts src/db/tenant-isolation.test.ts src/homework/homework.integration.test.ts src/exams/exams.integration.test.ts src/timetable/timetable.integration.test.ts src/fees/fees.integration.test.ts src/announcements/announcements.integration.test.ts src/reports/reports.integration.test.ts`)
- **Framework:** Node.js Native Test Runner (`node:test`, TAP version 13)
- **Target DB:** Remote Supabase Pooler (`DATABASE_URL`) with `{ rejectUnauthorized: false }` TLS
- **Status:** **PASS (11/11 Passed, 0 Failed, 0 Skipped)**
- **Total Duration:** 42,060 ms (~42 seconds)

#### Detailed Results Breakdown

| # | Test File | Subtest Description | Status | Duration |
|:---:|---|---|:---:|:---:|
| 1 | `src/announcements/announcements.integration.test.ts` | announcements publishing, audience targeting, in-app notifications and school isolation use PostgreSQL | **PASS** | 1,885 ms |
| 2 | `src/auth/google-auth.integration.test.ts` | Google Authentication integration, token verification, account linking, school access and revocation | **PASS** | 2,150 ms |
| 3 | `src/auth/security.test.ts` | refresh secrets are opaque and hashed with a separate server secret | **PASS** | 1.0 ms |
| 4 | `src/auth/security.test.ts` | access tokens retain the server-selected tenant and role | **PASS** | 2.1 ms |
| 5 | `src/auth/security.test.ts` | invalid access tokens are rejected | **PASS** | 0.3 ms |
| 6 | `src/db/tenant-isolation.test.ts` | school authority, tenant isolation, parent and teacher scopes, and approved support access use PostgreSQL | **PASS** | 3,008 ms |
| 7 | `src/exams/exams.integration.test.ts` | examination marks, publication, rankings, linked/self scopes and school isolation use PostgreSQL | **PASS** | 13,383 ms |
| 8 | `src/fees/fees.integration.test.ts` | fee structures, assignments, ledger idempotency, reversals, linked scopes and school isolation use PostgreSQL | **PASS** | 1,931 ms |
| 9 | `src/homework/homework.integration.test.ts` | homework creation, assigned/student/parent scopes, submissions, grading and tenant isolation use PostgreSQL | **PASS** | 1,797 ms |
| 10 | `src/reports/reports.integration.test.ts` | reports dashboard metrics, academic aggregates, attendance breakdown, export and school isolation use PostgreSQL | **PASS** | 1,558 ms |
| 11 | `src/timetable/timetable.integration.test.ts` | timetable periods, conflict prevention, publishing, role scopes and school isolation use PostgreSQL | **PASS** | 1,843 ms |

#### Observations & Notices
- **Deprecation Warning:**  
  `DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.`  
  *Root Cause:* Concurrency overlap in nested `tenantTransaction` callbacks within test scripts.
- **Connection Error Handling:**  
  `[DB Pool] Non-fatal client error: Connection terminated unexpectedly`  
  *Root Cause:* Remote Supabase idle connection termination gracefully intercepted by the non-fatal pool error listener in `apps/api/src/db/pool.ts`.

---

### Test Suite 2: End-to-End Production Lifecycle Test (`npm run test:e2e`)

- **Command:** `npm run test:e2e --workspace apps/api` (`tsx --test src/e2e/e2e-workflow.test.ts`)
- **Framework:** Node.js Native Test Runner with `@electric-sql/pglite` and `@electric-sql/pglite-socket`
- **Execution Mode:** Hermetic, fully isolated in-memory PostgreSQL instance with migrations 001 through 009 applied.
- **Status:** **PASS (All 14 Lifecycle Phases Verified)**
- **Total Duration:** 3,102 ms (~3.1 seconds)

#### Detailed Lifecycle Phases Verified

| Phase # | Phase Name | Operations Executed & Verified | Status |
|:---:|---|---|:---:|
| **1** | Super Admin Login & Plans | Seeded platform super admin, authenticated, retrieved subscription plans. | **PASS** |
| **2** | School Creation & Provisioning | Provisioned school `Greenwood High` (`CS-SCH-0001`), initialized trial subscription, generated admin invite. | **PASS** |
| **3** | Accept Invitation | Consumed invitation token, hashed administrator password, verified membership creation. | **PASS** |
| **4** | School Settings & Branding | Updated school address, motto, branding colors, verified tenant persistence. | **PASS** |
| **5** | Academic Setup | Created academic year 2026-2027, Grade 10, Section A, Mathematics & Physics subjects. | **PASS** |
| **6** | Student Admissions | Enrolled students `Aarav Sharma` & `Diya Patel`, assigned roll numbers, linked parents. | **PASS** |
| **7** | Attendance Recording | Recorded daily attendance register, verified append-only `attendance_history` trigger. | **PASS** |
| **8** | Homework Assignment & Grading | Created math homework, student submitted answers, teacher graded and added feedback. | **PASS** |
| **9** | Examinations & Results | Scheduled Mid-Term exams, input scores, published results, computed grade ranks. | **PASS** |
| **10** | Timetable Operations | Slot periods, verified conflict detection preventing teacher/room double-booking. | **PASS** |
| **11** | Fees & Payments | Assigned fee structure, collected tuition payment, verified atomic receipt sequencing. | **PASS** |
| **12** | Announcements & Notifications | Broadcasted school-wide announcement, verified in-app notification queries. | **PASS** |
| **13** | Reports & Analytics | Generated student performance summary, attendance aggregates, and fee collection totals. | **PASS** |
| **14** | Multi-Tenant Zero-Leakage Isolation | Provisioned second school `St. Jude's`, verified complete isolation with zero cross-tenant visibility. | **PASS** |

---

### Test Suite 3: Build & Static Analysis Checks

- **Command:** `npm run build`
- **Sub-commands:**
  1. `npm run build --workspace apps/api` (`tsc -p tsconfig.json`)
  2. `npm run build --workspace apps/web` (`tsc -b && vite build`)
- **Status:** **PASS (0 TypeScript Errors, 0 Rollup Errors)**

#### Build Artifacts & Bundle Distribution

| Workspace | Output Directory | Primary Assets | Size (Uncompressed) | Size (Gzip) |
|---|---|---|:---:|:---:|
| `apps/api` | `apps/api/dist/` | `server.js` and modules | ~180 kB | N/A |
| `apps/web` | `apps/web/dist/` | `index.html`<br>`assets/index-D1l4AEn4.css`<br>`assets/index-BgmcKls8.js` | 0.93 kB<br>78.36 kB<br>**764.75 kB** | 0.49 kB<br>16.23 kB<br>**198.82 kB** |

#### Build Warnings & Performance Notes
- **Rollup Warning on Web Bundle Size:**  
  `(!) Some chunks are larger than 500 kB after minification. (dist/assets/index-BgmcKls8.js: 764.75 kB)`  
  *Assessment:* The frontend application currently bundles all 9 workspace sub-components (`AttendanceWorkspace`, `HomeworkWorkspace`, `ExamsWorkspace`, `TimetableWorkspace`, `FeesWorkspace`, `AnnouncementsWorkspace`, `ReportsWorkspace`, `SettingsWorkspace`) into the main entry bundle. Dynamic code splitting via `React.lazy()` is recommended to reduce initial load time on mobile devices.

---

### Test Suite 4: Dependency Vulnerability Audit (`npm audit`)

- **Command:** `npm audit`
- **Status:** **FAIL (4 High Severity Vulnerabilities Detected)**

```
# npm audit report

@grpc/grpc-js  <=1.13.5
Severity: high
@grpc/grpc-js: In certain configurations, getAuthContext can return unauthorized certificates as though they were authorized - https://github.com/advisories/GHSA-m9gg-hp2v-232j
@grpc/grpc-js: The server transmits some error messages thrown by method handlers to the client in status messages - https://github.com/advisories/GHSA-f596-whhp-79r4
fix available via `npm audit fix --force`
Will install firebase@9.14.0, which is a breaking change
node_modules/@grpc/grpc-js
  @firebase/firestore  1.3.1-0 - 1.3.1-canary.df1b588 || ...
  Depends on vulnerable versions of @grpc/grpc-js
  node_modules/@firebase/firestore
    @firebase/firestore-compat  <=0.0.900-exp.520ca39d0 || ...
    node_modules/@firebase/firestore-compat
      firebase  0.900.22 || 6.0.2-0 - ...
      Depends on vulnerable versions of @firebase/firestore
      Depends on vulnerable versions of @firebase/firestore-compat
      node_modules/firebase

4 high severity vulnerabilities
```

*Finding:* Unused `firebase@13.3.0` dependency in `apps/web/package.json` introduces transitive vulnerabilities in `@grpc/grpc-js`. Recommended fix is to remove `firebase` entirely.

---

## 3. Test Coverage & Gap Analysis

```
                               TEST COVERAGE ANALYSIS
                               
  COMPREHENSIVE BACKEND COVERAGE                   UNTESTED / MANUAL COVERAGE
  ┌─────────────────────────────────────┐         ┌─────────────────────────────────────┐
  │ • Tenant Isolation (Zero Leakage)   │         │ • Real Google GIS OAuth Flow        │
  │ • RBAC Role & Permission Matrix     │         │ • Client-Side React Components (UI) │
  │ • Attendance & History Triggers     │         │ • Binary File Uploads/Downloads     │
  │ • Homework Creation & Grading       │         │ • Transactional Outbox Job Draining │
  │ • Exam Scheduling & Mark Entry      │         │ • SMTP Live Email Dispatch          │
  │ • Timetable Conflict Detection      │         │ • High Concurrency Load Testing     │
  │ • Fee Ledgers, Receipts, Reversals  │         │                                     │
  │ • Reports Aggregation & CSV Export  │         │                                     │
  └─────────────────────────────────────┘         └─────────────────────────────────────┘
```

### Untested Workflows & Rationale
1. **Real Google Identity Services Popup:** The integration test suite uses simulated tokens (`test-google-token:`) to test the token parsing pipeline. The actual browser Google sign-in popup cannot be tested in headless Node without browser automation.
2. **Transactional Outbox Background Draining:** There are no tests for background job execution because the consumer daemon was never implemented.
3. **Live Email Dispatch:** SMTP integration is stubbed or skipped in tests because no mock SMTP server (e.g. MailHog/Mailpit) is included in the test runner.
4. **Client-Side Component UI Testing:** The repository does not include Jest/Vitest or React Testing Library tests for individual React components.
