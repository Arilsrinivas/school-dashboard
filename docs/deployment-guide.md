# CalmStacks EduConnect — Production Deployment & Operations Guide

This guide describes how to deploy, configure, secure, and operate **CalmStacks EduConnect** in production environments.

---

## 1. Architecture Overview

```
                        +----------------------------------------+
                        |            Internet / DNS              |
                        |      https://school.yourdomain.com     |
                        +----------------------------------------+
                                            |
                                            v
                        +----------------------------------------+
                        |       Reverse Proxy / Cloud CDN        |
                        |   (Cloudflare / Traefik / Nginx / ALB) |
                        +----------------------------------------+
                                            |
                    +-----------------------+-----------------------+
                    |                                               |
                    v (Port 80/443)                                 v (Proxied via /api/*)
    +-------------------------------+               +-------------------------------+
    |         Web Container         |               |         API Container         |
    |      (Nginx Alpine + SPA)     | ------------> |    (Node.js 22 + Express)     |
    |   - Immutable asset caching   |               |   - Row-Level Security auth   |
    |   - SPA fallback (index.html) |               |   - Rate limiting & Helmet    |
    |   - Gzip compression          |               |   - Least-privilege roles     |
    +-------------------------------+               +-------------------------------+
                                                            |               |
                                            +---------------+               +---------------+
                                            |                                               |
                                            v                                               v
                        +-------------------------------+               +-------------------------------+
                        |       PostgreSQL 16 DB        |               |            Redis 7            |
                        |   - Multi-tenant RLS          |               |   - Rate limit state          |
                        |   - educonnect_app (NOBYPASS) |               |   - Pub/Sub notifications     |
                        |   - educonnect_platform       |               |   - Session tracking          |
                        +-------------------------------+               +-------------------------------+
```

---

## 2. Production Deployment Options

### Option A: Single-Command Docker Compose (Recommended for VPS / Dedicated Servers)

EduConnect provides an automated production Docker Compose bundle with healthchecks, persistent volumes, and initialization hooks.

#### Prerequisites
- Docker Engine 24.0+ and Docker Compose v2.20+
- A registered domain with an A/CNAME record pointed to your server IP.

#### Step 1: Clone Repository & Prepare Environment
```bash
git clone https://github.com/Arilsrinivas/school-dashboard.git /opt/educonnect
cd /opt/educonnect

# Copy production template
cp .env.production.example .env
```

#### Step 2: Configure Production Secrets in `.env`
Generate cryptographically random secrets for database roles and JWT authentication:
```bash
# Example secret generation (Linux/macOS)
openssl rand -hex 32
```
Update `.env` with:
- `POSTGRES_PASSWORD`: Superuser password for database provisioning.
- `EDUCONNECT_APP_PASSWORD`: Password for the restricted application database user (`NOBYPASSRLS`).
- `EDUCONNECT_PLATFORM_PASSWORD`: Password for the platform administrator role (`BYPASSRLS`).
- `ACCESS_TOKEN_SECRET`: At least 32 bytes (e.g. 64-char hex) for JWT access token signing.
- `REFRESH_TOKEN_SECRET`: At least 32 bytes (different from access token secret).
- `WEB_ORIGIN`: Your public frontend domain (e.g., `https://school.yourdomain.com`).
- `BOOTSTRAP_ADMIN_EMAIL`: Initial platform super-administrator email.
- `BOOTSTRAP_ADMIN_PASSWORD`: Strong password (12+ characters).

#### Step 3: Launch Production Stack
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

#### Step 4: Verify Deployment Health
```bash
# Check running container statuses
docker compose -f docker-compose.prod.yml ps

# Verify API healthcheck
curl -s http://localhost:4000/health
# Output: {"status":"ok","database":"ok"}

# Verify Web frontend
curl -I http://localhost/health
# Output: HTTP/1.1 200 OK
```

---

### Option B: Cloud Platform as a Service (Render / Railway / Fly.io)

For fully managed serverless infrastructure:

1. **Database**: Provision a managed PostgreSQL 16 database. Run `infra/postgres-init/01-runtime-role.sh` to configure runtime user roles.
2. **API Service**:
   - Environment: Docker or Node.js 22 runtime
   - Build command: `npm install && npm run build --workspace apps/api`
   - Start command: `node apps/api/dist/server.js`
   - Health check path: `/health`
   - Bind to: `0.0.0.0`, port defined by `$PORT`.
3. **Web Service**:
   - Deploy as a Static Site or Dockerized Nginx.
   - Build command: `npm install && npm run build --workspace apps/web`
   - Publish directory: `apps/web/dist`
   - Build environment variable: `VITE_API_URL=https://api.yourdomain.com`
   - Redirect all routes to `/index.html` (Single Page App rewrite rule).

---

### Option C: EduConnect on Vercel

EduConnect uses a separate Vercel project named `educonnect` rooted at the repository root. The same project serves the Vite frontend and the Node.js Express API under `/api`. The API uses the dedicated EduConnect PostgreSQL and Supabase Storage services; Firebase Authentication remains the identity provider. Follow [EDUCONNECT_VERCEL_PRODUCTION.md](EDUCONNECT_VERCEL_PRODUCTION.md) for project isolation, environment variables, Firebase domain setup, readiness checks, and rollback steps. Do not reuse Schoollog's Vercel project or its environment variables. `VITE_API_URL` must be empty for this same-origin deployment.

---

## 3. Post-Deployment Database Initialization

### 1. Execute Migrations
Migrations execute automatically inside `apps/api/docker-entrypoint.sh`. To manually run migrations:
```bash
# Inside container or with local node
npm run db:migrate --workspace apps/api
```

### 2. Bootstrap Super Administrator
If not bootstrapped automatically via environment variables:
```bash
BOOTSTRAP_ADMIN_EMAIL="admin@yourdomain.com" \
BOOTSTRAP_ADMIN_PASSWORD="SecurePassword2026!" \
BOOTSTRAP_ADMIN_NAME="Platform Administrator" \
npm run db:bootstrap-admin --workspace apps/api
```

### 3. Seed Example Demonstration School (Optional)
To preload sample demo schools, academic terms, students, teachers, subjects, and report cards:
```bash
npx tsx scripts/seed-example-school.ts
```

### 4. Run Live Multi-Role System Verification
To verify the entire school operation across School Admin, Teacher, Student, and Parent personas:
```bash
npx tsx scripts/school-lifecycle-runner.ts
```

---

## 4. Multi-Tenant Role Matrix & Access Credentials

CalmStacks EduConnect implements rigorous tenant isolation and role-based access control (RBAC):

| Role | Default Email (Demo) | Capabilities |
| :--- | :--- | :--- |
| **Platform Super Admin** | `admin@calmstacks.example` | Provision schools, monitor subscriptions, support tokens, tenant audit |
| **School Administrator** | `arilsrinivas8@gmail.com` | School branding, faculty invites, academic structure, fee ledger, admissions |
| **Teacher** | `teacher@kidzland.edu` | Take daily attendance, create & grade homework assignments, view timetable |
| **Student** | `student@kidzland.edu` | View grades & report cards, submit homework, read circulars, view timetable |
| **Parent** | `parent@kidzland.edu` | View child attendance %, monitor fee ledger & receipts, read circulars |

*All demo accounts default to password:* `Password#2026` *(or `Teacher#2026` / `Student#2026` / `Parent#2026`)*.

---

## 5. Security & Hardening Best Practices

1. **Row Level Security (RLS)**:
   - All tenant queries run inside `tenantTransaction(schoolId, ...)` using the restricted `educonnect_app` database role (`NOBYPASSRLS`).
   - Cross-school tenant leakage is physically blocked at the database engine level.
2. **Reverse Proxy SSL / TLS**:
   - Always place the Web container behind an HTTPS terminating proxy (such as Cloudflare, Traefik, or Caddy).
   - Ensure `WEB_ORIGIN` in the API matches the public HTTPS frontend domain to prevent CORS vulnerabilities.
3. **HTTP Security Headers**:
   - Helmet is enabled on all API routes (`X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`).
   - Nginx handles static asset caching with `Cache-Control: public, max-age=31536000, immutable` and prevents caching of `index.html`.
4. **Rate Limiting**:
   - Authentication endpoints (`/api/auth/*`) are protected by a rate limiter (20 requests per 15 minutes per IP).

---

## 6. Backup and Recovery

### PostgreSQL Database Backup
```bash
# Automated nightly backup command
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U educonnect -d educonnect -Fc > /backups/educonnect-$(date +%F).dump
```

### Database Restore
```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U educonnect -d educonnect --clean --no-owner /backups/educonnect-YYYY-MM-DD.dump
```
