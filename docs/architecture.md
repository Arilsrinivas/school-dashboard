# Architecture and data model

## Service boundaries

```text
Browser clients ── HTTPS/REST ── Express API ── pooled PostgreSQL
                                      ├── Redis/BullMQ workers (future)
                                      ├── private S3/R2 object store (future)
                                      └── email/SMS/push providers (future)
```

The React application is a client of the REST API. It never connects to PostgreSQL. The API owns authentication, authorization, validation, audit events, and tenant selection. Background jobs carry a tenant UUID and are validated before processing. Keep API contracts independent from the web client so mobile clients can reuse them.

## Identity and tenant isolation

`platform_users` is reserved for CalmStacks operators; `users` and `school_memberships` represent school identities. A user can have memberships in more than one tenant, but each request selects a school only after the server verifies an active membership and role. Super-admin endpoints require an active platform account and explicit platform permissions. The initial bootstrap account is created from environment variables by a one-shot CLI; there is no registration endpoint.

Tenant database work is performed in a transaction that sets `app.school_id` locally. RLS policies use this setting and fail closed when it is absent. All tenant tables have `school_id`; unique keys and foreign keys include it to prevent cross-tenant relationships. The normal API role is `NOBYPASSRLS`. A separate `BYPASSRLS` platform connection is used only after live platform-user authorization for control-plane routes; it never handles school module requests. Platform jobs use explicit audited control-plane queries and never silently bypass tenant policies in school-facing routes.

## School authority and role grants

Migration `002_school_authority.sql` creates tenant-owned `school_roles` and `school_role_permissions`. Each new school receives the standard School Administrator, Principal, Vice Principal, Academic Coordinator, Accountant, Receptionist, Teacher, Class Teacher, Parent, and Student role templates. Existing memberships and invitations are backfilled to their matching school role. The legacy `member_role` stays as an account-kind field; it does not grant operational access.

Every school API handler resolves the active membership, school status, subscription, school role, and role permissions inside the tenant transaction. Permission grants are stored in the database and checked on each request. Role managers cannot grant permissions they do not hold, change their own role, promote themselves, or remove the final active role manager. Staff suspension disables their membership and associated teacher record without deleting historical data. Invitations are school-scoped, one-use, time-limited, and carry teacher employee IDs or parent/student links as needed.

School-owned routes currently cover role and member administration, invitation issuance, school settings, academic years/classes/sections/subjects, student admission and bulk import, scoped student listing, and student promotion, transfer, graduation, and archival. Student lifecycle changes close or create enrollment rows and keep prior enrollment history. Sensitive administrative actions are written to tenant audit logs.

## CalmStacks support access

Platform administrators provision a separate support-agent role. A support agent must submit a reason, school, requested scope, and 15–120 minute window. A school member with `support-access:review` must approve or reject the request. Approval cannot exceed the requested scopes or expiry. Grants are tied to the requesting support account, can be revoked, and are checked for active status and expiry on every support data request. The implemented student support view exposes only admission number, first and last name, and status. Each access is recorded in platform and school audit logs. Platform dashboard routes expose aggregate analytics and school/subscription status; they do not provide ordinary student browsing.

## Account recovery

Recovery requests return the same public response for known and unknown accounts. Recovery tokens are random, stored as SHA-256 hashes, expire after 30 minutes, and only the latest outstanding token for an account remains valid. Successful reset changes the Argon2id password, consumes the token, revokes existing refresh sessions, and writes an audit event. Production recovery links are emailed; development and test modes may expose a local recovery URL.

## School ID allocation

`schools.id` is an internal UUID. A PostgreSQL sequence allocates the human-readable `CS-SCH-####` external identifier. A unique constraint makes collisions impossible; allocation and insert happen atomically. Do not use the display ID as a database key or authorization credential.

## Normalized schema inventory

The initial migration establishes:

- Platform control plane: platform users, roles, permissions, audit logs.
- Tenancy and billing foundation: schools, memberships, settings, subscription plans, subscriptions, invitations.
- Identity: users, profiles, revocable sessions.
- Academic setup: academic years, classes, sections, subjects, class subjects, teacher assignments.
- People: students, parents, student-parent links, enrollments, documents, teachers, teacher leave.
- Teaching: attendance, assignments, submissions, examinations, exam subjects, results, report cards, timetables.
- Operations: fee categories and structures, student fees, payments and receipts, announcements, notifications, conversations, messages, leave requests, uploaded files, background-job records, tenant audit logs.

The schema and permission vocabulary include attendance, homework, examinations/results, fees, timetable, announcements, and reporting. Their operational API and UI surfaces remain phased work; permission names alone do not imply those modules are available.

Every tenant-owned table carries `school_id`. High-use lookup indexes begin with that column. Attendance has a date-oriented index; partitioning is a later operational decision driven by measured volume.

## Authentication lifecycle

Passwords use Argon2id. Access tokens are short-lived and signed with a secret outside the database. Refresh tokens are random opaque values with a separate secret boundary, stored as hashes, rotated on use, and revocable by session. Production cookies must be Secure, HttpOnly, and SameSite. CSRF protection is required if refresh credentials are cookie-based. Password recovery and email verification must use one-time hashed tokens and rate limiting before external launch. Platform user credentials and logs have RLS enabled with no runtime-role policies; they are only accessed over the platform connection.

## File and asynchronous work

Files live in private S3-compatible storage. PostgreSQL stores metadata, tenant, uploader, checksum, size, and MIME type; downloads are authorized before short-lived signed URLs are issued. A future worker queue must include `schoolId`, actor, and idempotency key in every tenant job, revalidate the school status, and use tenant-scoped database transactions. Never place student data in generic cache keys or logs.
