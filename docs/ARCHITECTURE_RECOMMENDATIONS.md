# CalmStacks EduConnect — Architectural Analysis & SaaS Scaling Recommendations

**Author:** Principal Software Architect & Database Systems Lead  
**Scope:** Multi-Tenant SaaS Scaling (Hundreds to Thousands of Schools), Database Architecture, Serverless Workloads, and Operational Roadmap  

---

## 1. Multi-Tenant SaaS Architecture Evaluation

CalmStacks EduConnect implements a **shared-database, shared-schema** multi-tenant model with tenant discrimination using a composite primary/foreign key strategy and PostgreSQL Row-Level Security (RLS).

### Strengths of the Current Architecture
1. **Composite Tenant Key Integrity:** The schema enforces `(school_id, id)` composite uniqueness and foreign key references across all entity tables (e.g. `classes`, `sections`, `students`, `teachers`, `attendance`, `assignments`). This prevents cross-tenant references at the relational engine level.
2. **Transaction-Scoped Tenant Context:** Database transactions run through `tenantTransaction(schoolId, callback)`, which sets `set_config('app.school_id', $1, true)`. The `true` parameter restricts the tenant identifier strictly to the current database transaction.
3. **Immutable Audit Triggers:** Key transactional tables (`attendance_history`, `assignment_audit_history`, `examination_audit_history`, `timetable_audit_history`, `announcement_audit_history`, `payment_reversals`) are protected by PL/pgSQL triggers that disallow `UPDATE`, `DELETE`, and `TRUNCATE`, providing verifiable audit trails.

---

## 2. Key Architectural Bottlenecks & Scaling Risks

---

### Risk 1: Serverless Connection Pool Exhaustion under Scale

```
                           CONCURRENCY IN SERVERLESS
                           
  [ 100 Schools Active ] ────► [ 50 Vercel Lambdas Spawned ]
                                      │
                                (Each Lambda)
                                 pg.Pool(max: 10)
                                      ▼
                        [ 500 Direct Connections ]
                                      ▼
                   💥 [ PostgreSQL Connection Limit: 100 ]
                     (FATAL: remaining connection slots reserved)
```

- **Problem:** Currently, `apps/api/src/db/pool.ts` instantiates `new pg.Pool({ max: 10 })`. In a serverless deployment (such as Vercel AWS Lambda), each concurrent cold/warm instance maintains its own connection pool. If 50 lambda instances spin up during peak morning hours (when schools take attendance at 8:00 AM), the application attempts to open up to 500 direct connections to PostgreSQL. Standard managed database tiers (e.g., Supabase Free/Pro, Neon, AWS db.t4g.small) allow between 60 and 120 maximum connections.
- **Impact:** System experiences `503 Service Unavailable` or `FATAL: remaining connection slots are reserved for non-replication superuser connections`.
- **Solution:**
  1. Route all application database traffic through a transaction-mode connection pooler (**Supabase Supavisor** or **pgBouncer** on port `6543`).
  2. In serverless configuration, set `pg.Pool({ max: 1 })` per lambda instance with immediate connection termination or use `@neondatabase/serverless` / HTTP driver if deploying to edge environments.

---

### Risk 2: Missing Background Queue Daemon (The Unfilled Outbox)

- **Problem:** `apps/api` implements an Outbox pattern by inserting records into `background_jobs` (`attendance.absence_notification`, `fee_receipt`, `announcements.broadcast_notification`). However, **there is zero worker process, consumer, or queue runner in the entire repository.**
- **Impact:**
  - Automated parent notifications for absent students are never sent.
  - Fee receipts are never dispatched.
  - The `background_jobs` table will grow unbounded over time, accumulating millions of dead rows with `status = 'queued'`.
- **Solution:**
  - **Option A (Lightweight / PostgreSQL-native):** Implement **PgBoss** or **Graphile Worker**. These libraries run on top of PostgreSQL using `FOR UPDATE SKIP LOCKED` without requiring separate Redis infrastructure.
  - **Option B (High-Throughput Distributed):** Implement **BullMQ** on Redis. The repository already includes a Redis container in `docker-compose.yml`, which can be utilized for background workers.

---

### Risk 3: Attendance History Table Growth (Partitioning Strategy)

- **Problem:** In a SaaS serving 500 schools with an average of 1,000 students per school:
  $$\text{Daily Attendance Records} = 500 \times 1000 = 500,000\text{ rows/day}$$
  $$\text{Annual Records (200 days)} = 100,000,000\text{ rows/year}$$
  A single unpartitioned `attendance` and `attendance_history` table will suffer massive B-Tree index degradation, slow aggregation queries, and bloat vacuuming operations.
- **Solution:**
  Implement declarative **table partitioning by range (academic year or calendar month)** combined with `school_id`:
  ```sql
  CREATE TABLE attendance (
    school_id uuid NOT NULL,
    attendance_date date NOT NULL,
    ...
  ) PARTITION BY RANGE (attendance_date);
  ```

---

### Risk 4: File Storage Binary Pipeline

- **Problem:** Entities like homework assignments, student admission documents, report cards, and payment receipts reference `uploaded_files`. However, binary files cannot be uploaded through the API.
- **Impact:** Feature is non-functional for real school operations requiring PDFs, photos, and scanned records.
- **Solution:**
  Implement an **S3-compatible Presigned URL Architecture** (AWS S3, Cloudflare R2, or Google Cloud Storage):
  ```
  1. Client -> POST /api/files/presign-upload { filename, mimeType, byteSize }
  2. Server validates tenant limits -> inserts uploaded_files (status='pending') -> returns { uploadUrl, fileId }
  3. Client PUTs binary directly to S3/R2 -> avoids loading large binaries through Express
  4. Client -> POST /api/files/confirm { fileId } -> marks status='ready'
  ```

---

## 3. Prioritized Improvement Roadmap

---

### Phase P0 — Critical (Immediate Remediation Before Production)

| Task ID | Item | Why Required | Effort | Recommended Action |
|:---:|---|---|:---:|---|
| **P0-1** | **Fix Google Mock Token Backdoor (SEC-001)** | Eliminates complete authentication bypass vulnerability in production. | **Small** | Add `if (process.env.NODE_ENV === 'test')` guard around `test-google-token:` in `google.ts`. |
| **P0-2** | **Enforce Table-Level RLS (SEC-003)** | Prevents multi-tenant leakage when connecting as database owner. | **Small** | Add `ALTER TABLE ... FORCE ROW LEVEL SECURITY` across all tenant tables in migration 010. |
| **P0-3** | **Fix CORS Fallback (SEC-002)** | Prevents unauthorized credentialed cross-origin requests from external domains. | **Small** | Remove unconditional `callback(null, true)` fallback in `server.ts`. |
| **P0-4** | **Fix "School Workspace Required" Modal CSS (UX-001)** | Fixes visual text overlap glitch on 403 error modal. | **Small** | Wrap modal card header and shield icon inside white container with proper padding. |

---

### Phase P1 — High Priority (Core SaaS Functionality & Compliance)

| Task ID | Item | Why Required | Effort | Recommended Action |
|:---:|---|---|:---:|---|
| **P1-1** | **Wire Official Google Identity Services SDK on Web Frontend** | Allows real users to sign in with Google OAuth instead of test-token prompt. | **Medium** | Call `google.accounts.id.initialize()` and `renderButton()` using configured Google Client ID. |
| **P1-2** | **Implement Transactional Email API (Resend / SES)** | Solves missing invitation delivery issue (`BUG-002`) in serverless environments. | **Medium** | Replace raw SMTP with Resend / Postmark API for invitations and password recovery. |
| **P1-3** | **Build Background Queue Worker Daemon** | Drains transactional outbox `background_jobs` and dispatches notices (`BUG-001`). | **Medium** | Implement PgBoss worker daemon polling `background_jobs` with exponential backoff. |
| **P1-4** | **Implement DPDP Act Compliance & Child Privacy Module** | Legal compliance with India's DPDP Act, 2023 for children under 18 (`SEC-004`). | **Medium** | Add `child_consent_records` table, verify guardian consent, encrypt `medical_notes` via `pgcrypto`. |
| **P1-5** | **Implement Presigned S3/R2 File Storage Pipeline** | Enables actual file uploads for homework, admissions, and receipts. | **Medium** | Add `@aws-sdk/s3-request-presigner` endpoints for direct client-to-cloud uploads. |

---

### Phase P2 — Medium Priority (Maintainability & Performance)

| Task ID | Item | Why Required | Effort | Recommended Action |
|:---:|---|---|:---:|---|
| **P2-1** | **Frontend Code Splitting (React.lazy)** | Reduces monolithic 765kB JS bundle to <150kB initial load on mobile. | **Small** | Wrap `AttendanceWorkspace`, `HomeworkWorkspace`, etc., in `React.lazy()` with Suspense fallbacks. |
| **P2-2** | **Supabase Transaction Pooler Configuration** | Protects PostgreSQL from connection exhaustion during morning attendance spikes. | **Small** | Point `DATABASE_URL` to Supabase port 6543 (transaction pooling mode) and set pool max=1 in serverless. |
| **P2-3** | **Dedicated Parent & Student Portals** | Enhances user experience for non-administrative roles. | **Medium** | Create streamlined parent dashboard focused on child attendance, fees, and homework. |
| **P2-4** | **Remove Deprecated Firebase Dependency** | Cleanses 4 high-severity npm audit vulnerabilities (`SEC-005`). | **Small** | Remove `firebase` and `@grpc/grpc-js` from `apps/web/package.json`. |

---

### Phase P3 — Low Priority (Polish & Extended Features)

| Task ID | Item | Why Required | Effort | Recommended Action |
|:---:|---|---|:---:|---|
| **P3-1** | **Online Payment Gateway Integration (Razorpay)** | Allows parents to pay tuition fees directly through UPI/Cards. | **Large** | Integrate Razorpay Orders and Webhook signature verification for instant receipt generation. |
| **P3-2** | **Live In-App Chat & Messaging** | Activates the `conversations` and `messages` tables present in schema. | **Large** | Build real-time WebSocket / SSE messaging between teachers and parents. |
| **P3-3** | **Automated Playwright E2E UI Test Suite** | Prevents visual regression bugs on desktop and mobile viewports. | **Medium** | Set up GitHub Actions CI running Playwright tests against Vercel preview URLs. |

---

## 4. Architectural Target State Diagram (Post-P1)

```
                            TARGET ARCHITECTURE (POST-P1)
                            
  [ Web Client / Mobile ] ─────────────► [ Vercel CDN / SPA (Lazy Loaded) ]
           │                                          │
           │ (REST / JSON)                            │ (Presigned Direct Upload)
           ▼                                          ▼
  [ Express API on Vercel / Node ]          [ Cloudflare R2 / AWS S3 ]
           │                                          ▲
           │                                          │ (Verify & Link)
           ▼                                          │
  [ Supabase Supavisor (Port 6543) ]                  │
           │                                          │
           ▼                                          │
  [ PostgreSQL 16 (RLS FORCED) ] ─────────────────────┘
           │ (Transactional Outbox)
           ▼
  [ PgBoss / BullMQ Worker ] ───────► [ Resend Email API ] (Invitations / Alerts)
                             ───────► [ SMS / WhatsApp Gateway ]
```
