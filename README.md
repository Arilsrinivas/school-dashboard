# CalmStacks EduConnect

Multi-tenant school management SaaS platform built with strict PostgreSQL Row-Level Security, fine-grained RBAC, and comprehensive operational workflows.

## Features & Operational Workspaces

- **Platform Administration**: School provisioning (`CS-SCH-####`), subscription plans, support agent authorization, audit logging.
- **Academic Foundation**: Multi-session academic years, grade levels, classes, sections, subjects, and teacher assignments.
- **Gate A: Attendance Operations**: Daily marking, bulk upsert (`present`, `absent`, `late`, `excused`, `half_day`), monthly summaries, and student trends.
- **Gate B: Homework & Submissions**: Rich assignment creation, due date management, student submission portal, teacher grading and feedback loops.
- **Gate C: Examinations & Results**: Exam scheduling, multi-subject grading scales (`A`, `B`, `C`, `F`), bulk marks entry, class ranks, and printable report cards.
- **Gate D: Timetable Operations**: Weekly scheduling matrix, period definitions, clash prevention (HTTP 409 collision rejection), and schedule publication.
- **Gate E: Fees & Payments Ledger**: Custom fee structures by grade and category (`tuition`, `lab`, `transport`), student assignments, offline collection receipts, idempotent payments, and reversals.
- **Gate F: Announcements & Notifications**: Targeted broadcasts (school, faculty, parents, students), published alerts, real-time in-app notification bell, and read receipts.
- **Gate G: Reports & Analytics**: KPI executive dashboard, academic performance distributions, attendance trends, and protected CSV exports (`students`, `fees`, `attendance`).
- **Gate H: School Settings & Branding**: Custom school display names, primary theme hex color picker, school logo URLs, active academic year label, and notification preferences.

## Architecture

- `apps/web`: React 18, Vite, TypeScript, Tailwind CSS, Lucide icons, responsive multi-tenant workspaces.
- `apps/api`: Express REST API, TypeScript, PostgreSQL (pg), Argon2id password hashing, signed JWT access tokens, rotating opaque refresh tokens, and transaction-scoped RLS.
- `apps/api/migrations`: Versioned PostgreSQL migrations (`001` through `008`) enforcing composite tenant foreign keys and Row-Level Security policies.

## Getting Started

### Prerequisites

- Node.js 22+
- Docker Desktop (or local PostgreSQL 16+)

### Installation & Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Start PostgreSQL and Redis via Docker
docker compose up -d db redis

# 4. Run database migrations
npm run db:migrate

# 5. Bootstrap the platform super-administrator
npm run db:bootstrap-admin

# 6. Start API (port 4000) and Web app (port 5173) concurrently
npm run dev
```

### Verification & Testing

```bash
# Run unit & domain integration tests (10 test suites covering all modules)
npm test

# Run full 14-phase end-to-end production lifecycle test
npm run test:e2e

# Build production assets for both backend and frontend
npm run build
```

## Security & Multi-Tenant Isolation

1. **Row-Level Security (RLS)**: Enforced via PostgreSQL `app.school_id` transaction variables. All application queries run under `NOBYPASSRLS` role `educonnect_app`.
2. **Dual-Pool Architecture**:
   - `educonnect_app`: Restricted application pool.
   - `educonnect_platform`: Server-only platform pool with `BYPASSRLS` for super-admin provisioning and cross-tenant billing.
3. **Composite Foreign Keys**: All tables reference composite `(school_id, id)` keys to prevent cross-school data association at the database constraint level.
