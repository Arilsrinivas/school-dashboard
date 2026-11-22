# CalmStacks EduConnect — Comprehensive Security & Compliance Audit

**Audit Date:** November 20, 2026  
**Auditor:** Principal SaaS Security Auditor & Database Architect  
**Classification:** Confidential Security Assessment  
**Codebase Evaluated:** `apps/api` (Express, PostgreSQL, Argon2id, jose), `apps/web` (React 18, Vite)  
**Live Target:** `https://school-dashboard-nine-rho.vercel.app`  

---

## Executive Summary

A comprehensive, zero-trust security audit of the **CalmStacks EduConnect** repository and its live production environment was conducted. The application exhibits strong foundational security practices in password hashing (Argon2id), cryptographic token generation (`jose` JWT and HMAC-SHA256 hashed refresh tokens), strict composite foreign keys for multi-tenancy, and immutable PL/pgSQL audit triggers.

However, the audit revealed **1 Critical vulnerability**, **2 High-severity vulnerabilities**, **2 Medium-severity risks**, and **1 DPDP Act (India) compliance gap** that require immediate remediation before wide public release. Most notably, a test-token parsing backdoor in the Google authentication handler allows full authentication bypass in production environments if unconditioned.

---

## 1. Security Findings Register

| ID | Title | Severity | CWE | Status | Location |
|---|---|:---:|---|:---:|---|
| **SEC-001** | Mock Google Token Backdoor Active in Production Environment | **CRITICAL** | CWE-287 / CWE-306 | Confirmed & Reproducible | `apps/api/src/auth/google.ts:28-67` |
| **SEC-002** | Permissive CORS Configuration with Reflected Origin & Credentials | **MEDIUM** | CWE-942 | Confirmed | `apps/api/src/server.ts:26-36` |
| **SEC-003** | Row-Level Security (RLS) Bypass for Table Owner / Superuser Connections | **HIGH** | CWE-284 / CWE-1220 | Confirmed | `apps/api/src/db/pool.ts:21-35`, `apps/api/migrations/*` |
| **SEC-004** | DPDP Act (India) Non-Compliance on Children's Personal & Health Data | **HIGH** | CWE-359 / Regulatory | Confirmed | `apps/api/migrations/001_initial.sql:24`, `apps/api/src/schools/routes.ts` |
| **SEC-005** | High-Severity Vulnerabilities in Deprecated Firebase Dependency | **MEDIUM** | CWE-295 / CWE-200 | Confirmed | `node_modules/@grpc/grpc-js`, `apps/web/package.json:13` |
| **SEC-006** | Lack of Rate Limiting on Mutation Endpoints Beyond Auth | **LOW** | CWE-770 | Confirmed | `apps/api/src/server.ts:65-79` |
| **SEC-007** | Plaintext Student Health & Emergency Data Exposure Across Faculty | **MEDIUM** | CWE-200 | Confirmed | `apps/api/src/schools/routes.ts:180-240` |

---

## 2. In-Depth Vulnerability Analysis

---

### SEC-001: Mock Google Token Backdoor Active in Production Environment

- **Severity:** **CRITICAL** (CVSS 9.8 / Critical)
- **CWE:** CWE-287: Improper Authentication; CWE-306: Missing Authentication for Critical Function
- **Affected File:** [apps/api/src/auth/google.ts](file:///c:/Users/User/Desktop/school%20web/apps/api/src/auth/google.ts#L28-L67)
- **Status:** **Confirmed & Reproducible in Production**

#### Detailed Vulnerability Description
In `verifyGoogleIdToken()`, the backend checks whether the supplied token starts with `test-google-token:` or `mock-google-token:`. When matched, it extracts the JSON payload from the token string and parses it directly without verifying any cryptographic signature:

```typescript
// apps/api/src/auth/google.ts:28
if (token.startsWith('test-google-token:') || token.startsWith('mock-google-token:')) {
  const rawJson = token.replace(/^(test-google-token:|mock-google-token:)/, '');
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Malformed test token');
  }
  // ... basic checks on parsed.exp, parsed.email, parsed.sub ...
  return {
    sub: String(parsed.sub),
    email: String(parsed.email).toLowerCase().trim(),
    emailVerified: parsed.email_verified !== false,
    name: String(parsed.name || parsed.email.split('@')[0]),
    picture: parsed.picture
  };
}
```

**Crucially, there is NO condition checking `env.NODE_ENV === 'test'` or `env.NODE_ENV === 'development'` before executing this block.**

#### Exploitation Scenario
1. An attacker identifies the email address of a School Administrator (e.g. `admin@kidzland.edu` or `arilsrinivas8@gmail.com`).
2. The attacker crafts a simple HTTP POST request using `curl` or Postman targeting the live production deployment:
   ```bash
   curl -X POST https://school-dashboard-nine-rho.vercel.app/api/auth/google \
     -H "Content-Type: application/json" \
     -d '{
       "idToken": "test-google-token:{\"sub\":\"google-attacker-123\",\"email\":\"arilsrinivas8@gmail.com\",\"name\":\"Aril Srinivas\",\"email_verified\":true,\"iss\":\"https://accounts.google.com\"}"
     }'
   ```
3. Because the backend accepts `test-google-token:` in production, it extracts `email: arilsrinivas8@gmail.com`, resolves the existing EduConnect user, creates an active session, issues a valid JWT access token, and sets the `educonnect_refresh` cookie.
4. The attacker achieves **complete account takeover** of any existing administrator, teacher, parent, or student account without knowing their password or possessing their Google credentials.

#### Live Verification Evidence
During the live audit, when submitting the web Google modal on `https://school-dashboard-nine-rho.vercel.app/` with `arilsrinivas8@gmail.com`, the frontend sent:
`test-google-token:{"sub":"...","email":"arilsrinivas8@gmail.com",...}` to `/api/auth/google`.
The live Vercel production server returned **HTTP 200 OK** and granted full administrative session access (`School ID: CS-SCH-0001`).

#### Recommended Correction
Enforce an ironclad environment guard that completely disables mock token processing unless `process.env.NODE_ENV === 'test'`:

```typescript
export async function verifyGoogleIdToken(token: string, expectedAudience?: string): Promise<VerifiedGooglePayload> {
  if (!token || typeof token !== 'string') {
    throw new Error('Google ID token is required');
  }

  // Strictly restrict test tokens to automated test environments
  if (process.env.NODE_ENV === 'test' && (token.startsWith('test-google-token:') || token.startsWith('mock-google-token:'))) {
    // mock verification logic...
  }

  // In production and development, ALWAYS require official Google OAuth2 token verification
  const client = getOAuth2Client();
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: clientId
  });
  // ...
}
```

---

### SEC-002: Permissive CORS Configuration with Reflected Origin & Credentials

- **Severity:** **MEDIUM** (CVSS 6.5 / Medium)
- **CWE:** CWE-942: Permissive Cross-Domain Policy with Untrusted Domains
- **Affected File:** [apps/api/src/server.ts](file:///c:/Users/User/Desktop/school%20web/apps/api/src/server.ts#L26-L39)
- **Status:** **Confirmed**

#### Detailed Vulnerability Description
In `apps/api/src/server.ts`:
```typescript
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests without origin (same-origin, curl, serverless internal)
    if (!origin) return callback(null, true);
    // Allow localhost, any vercel.app preview/production deployment, or configured WEB_ORIGIN
    if (origin.includes('localhost') || origin.endsWith('.vercel.app') || origin === env.WEB_ORIGIN) {
      return callback(null, true);
    }
    return callback(null, true); // <--- UNCONDITIONAL FALLBACK
  },
  credentials: true,
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
```

Notice line 34: regardless of what `origin` is sent by an arbitrary third-party domain (e.g. `https://evil-attacker.com`), the handler executes `return callback(null, true);`. Combined with `credentials: true`, Express responds with:
`Access-Control-Allow-Origin: https://evil-attacker.com`  
`Access-Control-Allow-Credentials: true`

#### Impact
An attacker hosting an external website can entice an authenticated school administrator or staff member to visit their page. Through standard `fetch(..., { credentials: 'include' })` calls to `/api/auth/refresh`, the attacker can trigger session renewals and perform authenticated cross-origin data extraction.

#### Recommended Correction
Replace the permissive fallback with `callback(new Error('CORS not allowed for this origin'))` or return `false`:
```typescript
origin: (origin, callback) => {
  if (!origin) return callback(null, true);
  const allowed = [env.WEB_ORIGIN, 'http://localhost:5173', 'http://localhost:3000'].filter(Boolean);
  if (allowed.includes(origin) || (env.NODE_ENV !== 'production' && origin.includes('localhost')) || origin.endsWith('.vercel.app')) {
    return callback(null, true);
  }
  return callback(new Error('Disallowed origin by CORS policy'));
}
```

---

### SEC-003: Row-Level Security (RLS) Bypass for Table Owner / Superuser Connections

- **Severity:** **HIGH** (CVSS 7.5 / High)
- **CWE:** CWE-284: Improper Access Control; CWE-1220: Insufficient Granularity of Access Control
- **Affected Files:** [apps/api/src/db/pool.ts](file:///c:/Users/User/Desktop/school%20web/apps/api/src/db/pool.ts#L21-L35), `apps/api/migrations/*.sql`
- **Status:** **Confirmed**

#### Detailed Vulnerability Description
In PostgreSQL, `ALTER TABLE tablename ENABLE ROW LEVEL SECURITY;` activates RLS for non-owner roles. However, **the table owner and the `postgres` superuser bypass RLS by default** unless the table is explicitly configured with `FORCE ROW LEVEL SECURITY`.

In the application's migrations (001 through 009):
- `ENABLE ROW LEVEL SECURITY` is executed on 29 tables.
- **`FORCE ROW LEVEL SECURITY` is never executed on any table.**

In managed cloud database services (such as Supabase, Neon, AWS RDS), `DATABASE_URL` typically connects using the `postgres` superuser/table owner account. Under this configuration:
1. `SELECT set_config('app.school_id', $1, true)` is executed inside `tenantTransaction`.
2. However, PostgreSQL completely ignores the `tenant_isolation` RLS policies because the connected role is the table owner!
3. If an engineer inadvertently writes a query without `WHERE school_id = $1` (e.g. `SELECT * FROM students WHERE admission_number = $1`), the query will cross tenant boundaries and return records belonging to other schools.

#### Evidence
In `apps/api/src/e2e/e2e-workflow.test.ts`, the test author explicitly realized this nuance and created two separate roles in PGlite:
```typescript
CREATE ROLE educonnect_app LOGIN NOBYPASSRLS;
CREATE ROLE educonnect_platform LOGIN BYPASSRLS;
```
And configured the pool on acquire:
```typescript
pool.on('acquire', client => { void client.query('SET ROLE educonnect_app'); });
```
**However, `SET ROLE educonnect_app` is NOT present in production `apps/api/src/db/pool.ts`.** Therefore, in production environments connecting as `postgres`, the database-level RLS defense-in-depth is entirely inactive.

#### Recommended Correction
Execute `ALTER TABLE ... FORCE ROW LEVEL SECURITY` across all tenant-scoped tables:
```sql
DO $$ 
DECLARE t text; 
BEGIN
  FOR t IN SELECT unnest(ARRAY['schools','school_memberships','students','teachers','classes','sections','subjects','attendance','assignments','examinations','timetables','fee_structures','student_fees','payments','announcements','notifications','audit_logs']) LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
```

---

### SEC-004: DPDP Act (India) Non-Compliance on Children's Personal & Health Data

- **Severity:** **HIGH** (Regulatory Compliance / Child Privacy Risk)
- **Applicable Framework:** India's Digital Personal Data Protection Act, 2023 (DPDP Act, Section 9)
- **Affected Files:** `apps/api/migrations/001_initial.sql`, [apps/api/src/schools/routes.ts](file:///c:/Users/User/Desktop/school%20web/apps/api/src/schools/routes.ts#L180-L240)
- **Status:** **Confirmed**

#### Detailed Compliance Gap Description
The platform processes personally identifiable information (PII) of minors across Indian schools (configured with `Asia/Kolkata` timezone and `INR` currency). Under Section 9 of the DPDP Act, 2023:
1. **Verifiable Parental Consent (VPC):** A Data Fiduciary must obtain verifiable consent from the parent or lawful guardian before processing any personal data of a child.
   - *Current Codebase:* `students` table has `date_of_birth` and `status`, but zero fields or tables for `parental_consent_verified`, `consent_timestamp`, `consent_proof_file_id`, or `consent_expiry`.
2. **Special Category / Health Data Protection:**
   - *Current Codebase:* `students` table stores `medical_notes text` and `emergency_contact jsonb` in unencrypted plaintext. Any staff member or teacher querying `/api/school/students` receives unmasked medical diagnoses, allergy notes, and emergency phone numbers in cleartext JSON.
3. **Data Principal Rights (DPDP Chapter III):**
   - The platform lacks mechanisms for parents to exercise their statutory rights:
     - Right to access a summary of child's personal data processed.
     - Right to correction, completion, and erasure of outdated data.
     - Right to grievance redressal.

#### Recommended Correction
1. Introduce a dedicated `child_consent_records` table tracking parental verification method (Aadhaar OTP, signed physical mandate, DigiLocker integration) and consent status.
2. Restrict `medical_notes` visibility to authorized medical personnel/school principals using field-level column security or separate `student_medical_records` table with dedicated `students:medical:read` privilege.
3. Encrypt sensitive student columns (`medical_notes`, `emergency_contact`) at rest using PostgreSQL `pgcrypto` (`pgp_sym_encrypt`).

---

### SEC-005: High-Severity Vulnerabilities in Deprecated Firebase Dependency

- **Severity:** **MEDIUM** (CVSS 7.5 / Vulnerable Dependency)
- **CWE:** CWE-295: Improper Certificate Validation; CWE-200: Information Exposure
- **Affected Files:** `apps/web/package.json:13`, `node_modules/@grpc/grpc-js`
- **Advisory References:** `GHSA-m9gg-hp2v-232j`, `GHSA-f596-whhp-79r4`
- **Status:** **Confirmed via `npm audit`**

#### Description
Running `npm audit` reveals 4 high-severity vulnerabilities inside `firebase@13.3.0` -> `@firebase/firestore-compat` -> `@grpc/grpc-js`:
- In certain configurations, `getAuthContext` can return unauthorized certificates as though they were authorized (`GHSA-m9gg-hp2v-232j`).
- Method handlers can leak internal server error messages into client status strings (`GHSA-f596-whhp-79r4`).

Because the project has transitioned away from Firebase in favor of official Google Identity Services (`google-auth-library`), the Firebase SDK in `apps/web/package.json` is legacy bloat that unnecessarily inflates the bundle and exposes the client to vulnerable gRPC dependencies.

#### Recommended Correction
Remove `firebase` from `apps/web/package.json`:
```bash
npm uninstall firebase --workspace apps/web
```

---

## 3. Architecture & Attack Surface Analysis

```
                              ATTACK SURFACE & BOUNDARY AUDIT
                              
  [ Public Web Client ] ──── (HTTPS / Port 443) ────► [ Vercel Edge Router ]
                                                              │
                                                        [ Express Server ]
                                                              │
                     ┌────────────────────────────────────────┼────────────────────────────────────────┐
                     ▼                                        ▼                                        ▼
             [ /api/auth/* ]                          [ /api/school/* ]                       [ /api/platform/* ]
             • Rate Limiter (300/15m)                 • Auth Middleware                       • Require Platform
             • JWT Issue / Refresh Token              • requireSchoolRole / Permission        • Super Admin Only
             • ⚠️ SEC-001 (Mock Token Backdoor)       • tenantTransaction(schoolId)           • platformPool
                     │                                        │                                        │
                     ▼                                        ▼                                        ▼
             ┌─────────────────────────────────────────────────────────────────────────────────────────┐
             │                            PostgreSQL 16 Multi-Tenant Schema                            │
             │  • schools (CS-SCH-xxxx)      • school_memberships           • subscriptions            │
             │  • students, teachers, classes, attendance, homework, exams, timetable, fees, reports │
             │  • 29 Tables with RLS (⚠️ SEC-003: missing FORCE ROW LEVEL SECURITY for postgres user) │
             │  • Composite FKs (school_id, id) enforcing tenant isolation at DB constraint level       │
             └─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Authentication & Token Security Assessment
- **JWT Implementation:** Strong. Uses `jose` library with HS256, strictly validated `sub`, `kind`, `role`, and `schoolId` claims. Access tokens expire in 900 seconds (15 minutes).
- **Refresh Token Storage:** Strong. Stored in `user_sessions` using HMAC-SHA256 hash. The plaintext refresh secret is never persisted in the database, preventing session hijacking from database read dumps.
- **Cookie Security:** Strong. `HttpOnly; SameSite=Strict; Path=/api/auth; Secure`. JavaScript cannot access the refresh cookie via `document.cookie`.

### Authorization & Multi-Tenant Isolation Assessment
- **Role Enforcement:** Rigorous. Roles are not merely UI badges; endpoints validate `req.identity.role` and `req.permissions` against database tables `school_roles` and `school_role_permissions`.
- **Tenant Context:** Derived exclusively from the cryptographically verified JWT (`identity.schoolId`) and cross-checked against active memberships in PostgreSQL. A user cannot access another school by tampering with query strings or request bodies.
- **Database Composite Foreign Keys:** Exemplary. Tables enforce `(school_id, class_id) REFERENCES classes(school_id, id)`. This guarantees that even if application logic were compromised, PostgreSQL would reject any cross-tenant relationship insertion.

---

## 4. Verification & Reproduction Steps

### Reproducing SEC-001 (Mock Token Backdoor)
1. Run `curl` against `http://localhost:4000/api/auth/google` (or the live deployment `https://school-dashboard-nine-rho.vercel.app/api/auth/google`):
   ```bash
   curl -i -X POST http://localhost:4000/api/auth/google \
     -H "Content-Type: application/json" \
     -d '{"idToken":"test-google-token:{\"sub\":\"forged-sub\",\"email\":\"admin@oakridge.edu\",\"name\":\"Admin\",\"email_verified\":true,\"iss\":\"https://accounts.google.com\"}"}'
   ```
2. Observe HTTP 200 response with administrative JWT access token and session cookie, proving token forging is accepted without signature validation.

### Reproducing SEC-002 (CORS Fallback)
1. Send an OPTIONS preflight request with an untrusted origin:
   ```bash
   curl -i -X OPTIONS https://school-dashboard-nine-rho.vercel.app/api/auth/refresh \
     -H "Origin: https://evil.example.com" \
     -H "Access-Control-Request-Method: POST"
   ```
2. Observe response headers:
   `Access-Control-Allow-Origin: https://evil.example.com`  
   `Access-Control-Allow-Credentials: true`

---

## 5. Security Recommendations Matrix

| Finding | Remediation Priority | Recommended Action | Effort |
|---|:---:|---|:---:|
| **SEC-001** | **P0 (Immediate)** | Restrict mock tokens strictly to `NODE_ENV === 'test'`. Wire real Google GIS SDK on frontend. | Small |
| **SEC-002** | **P1 (High)** | Replace open CORS fallback with strict origin whitelist check. | Small |
| **SEC-003** | **P1 (High)** | Execute `ALTER TABLE ... FORCE ROW LEVEL SECURITY` across all 29 tenant tables in migration 010. | Small |
| **SEC-004** | **P1 (High)** | Introduce `parental_consent_records` table and encrypt `medical_notes` column via `pgcrypto`. | Medium |
| **SEC-005** | **P2 (Medium)** | Remove unused `firebase` package from `apps/web/package.json`. | Small |
| **SEC-006** | **P2 (Medium)** | Apply rate limiting to student admissions, fee payments, and homework submission endpoints. | Small |
| **SEC-007** | **P2 (Medium)** | Scope `medical_notes` to a dedicated `students:medical:read` permission. | Small |
