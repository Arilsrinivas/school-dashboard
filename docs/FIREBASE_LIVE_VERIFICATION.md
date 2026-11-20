# EduConnect Production Firebase Verification

**Date:** 2026-11-21  
**Firebase project:** `educonnect-44f2b`  
**Overall result:** Production metadata and Vercel variable names were inspected. The current Production deployment does **not** contain the Firebase Admin integration present in the local working tree. Firebase authentication was not tested. No Production records or settings were changed.

## Release candidate follow-up (2026-11-21)

The repository now contains the Firebase implementation and a local Vercel proxy fix on `codex/firebase-production-release`; this is not pushed or deployed. Verification of the candidate completed with `npm run build`, `npm test` (15/15 tests), `npm run test:e2e` (14/14 lifecycle phases), and `npm audit --omit=dev` (0 vulnerabilities). Firebase tests use a generated local service-account key and injected token verifier; these results do not establish that Vercel's secret initializes or that live Firebase sign-in works.

The API now trusts exactly one Express proxy hop only when `VERCEL=1`; local runs trust no forwarded headers. A test ingress removes caller-supplied XFF, then checks rate-limit identity and the real `/api/auth/refresh` session rotation/replay behavior. Vercel's documented edge behavior is the basis for the one-hop setting. The production runtime log has not been rechecked because this candidate has not been deployed.

This host has no running Docker daemon and no isolated PostgreSQL URL. The guarded PostgreSQL verifier was not run, so actual PostgreSQL roles, migrations 010–013, FORCE RLS, connection-pool reuse, and two-school read/write/delete isolation remain unverified on PostgreSQL. The previous Production deployment metadata and Firebase variable inventory below remain unchanged; no production setting or data was accessed or modified during candidate verification.

## Deployment metadata and intended revision

Vercel Overview and Deployment Details showed the current/latest deployment as **Production**, **Ready**, and **Current**, from branch `main`. Deployment ID: `dpl_36KsYR7t4GVDQb2KiQaQCdY5FyBY`. Its linked source commit is:

```text
1982d9080b87fed3dda9cf55bc0d535014f36d6f
feat(schoollog): recreate schoollog.in design system, marketing, admissions CRM and bus GPS fleet tracker
```

The local repository `HEAD` is the same commit on `main`, but the local Firebase integration changes are uncommitted/untracked. Inspection of the deployed commit tree confirmed:

- `apps/api/src/auth/firebase-admin.ts` is not present.
- The `firebase-admin` API dependency is not present in that commit's `apps/api/package.json`.
- `FIREBASE_SERVICE_ACCOUNT_JSON` and `AUTH_PROVIDER` are not present in that commit's backend config.

Therefore the claim that this deployment contains the Firebase integration is **not verified and is contradicted by the deployed source commit**. Do not treat the configured environment variables as evidence that the application code initializes Firebase Admin.

## Vercel environment-variable inventory

The project Environment Variables page was inspected. Names and environment scopes were read; the Firebase service-account JSON and other secret values were not revealed.

| Variable(s) | Visible scope | Status |
|---|---|---|
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID` | Production and Preview | All five entries present. `VITE_FIREBASE_PROJECT_ID` value was safely checked and equals `educonnect-44f2b`; other values were left masked. |
| `AUTH_PROVIDER` | Production and Preview | Entry present; value safely checked as `firebase`. |
| `FIREBASE_PROJECT_ID` | Separate Production and Preview entries | Both entries present, but marked as secret and value not revealed; project match is not verified. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Separate Production and Preview entries | Both entries present as secrets; contents were not revealed or validated. |

Entries were shown as added before the current Production deployment was created. This establishes that the variables are configured at project level for Production; it does not prove the deployed backend consumed them, especially because the deployed commit lacks the Firebase Admin integration.

## Firebase Admin initialization and live authentication

| Check | Result | Evidence / limitation |
|---|---|---|
| Firebase Admin initialized in Production runtime | **NOT VERIFIED; integration absent from deployed commit** | No Admin module/dependency/config in deployed commit. `/health` is intercepted by Vercel. No Firebase initialization log was observed. |
| ID tokens verified against `educonnect-44f2b` | NOT TESTED | No API request reached EduConnect and no dedicated test token/account was used. |
| Google sign-in | NOT TESTED | Production application login was not attempted. |
| Email/password sign-in | NOT TESTED | Production application login was not attempted. |
| PostgreSQL user resolution, no-membership denial, roles/permissions, suspension and school switching | NOT TESTED live | These would query Production identity/membership records. No isolated production test fixture was available. |
| Invalid/expired token rejection | NOT TESTED live | Vercel protection intercepted requests before the API. |

Do not claim live Firebase Authentication works until Google and email/password sign-in and the associated API authorization checks pass on a deployment that actually contains the integration.

## Vercel protection and request/log observations

- Project Settings → Deployment Protection showed the Vercel Authentication control and the **Standard Protection** profile. No protection control was changed.
- A read-only unauthenticated `GET /health` returned **HTTP 302** to Vercel Authentication with a message that the deployment is protected. The request did not reach the API health handler.
- The project owner can access the protected app by signing into Vercel with an account that is a member of the owning team, then opening the project’s current Production deployment and selecting **Visit**. For command-line access, the Vercel response itself recommends `vercel curl <deployment-url>` from the owner's authenticated CLI. Do not share Vercel credentials, cookies, bypass tokens, Firebase tokens, or service-account JSON.
- Read-only Vercel Runtime Logs for the current deployment (last 30 minutes) contained an `/api/auth/refresh` entry with a `ValidationError` stating that `X-Forwarded-For` is set while Express `trust proxy` is not configured compatibly. The visible message was truncated in the log table; no session values or credentials were opened. This is an operational/auth-refresh issue to investigate. Configure proxy trust narrowly for the actual Vercel topology; do not set blanket trust or weaken deployment protection. Recheck rate-limit client IP behavior after remediation.
- Browser console was not inspected because the protected application was not opened. No Firebase login API response or Admin runtime log was available.

## PostgreSQL tenant-authorization evidence

- Local regression command: `npx tsx --test apps/api/src/db/tenant-isolation.test.ts` — **PASS, 1/1 suite**. The test uses disposable PGlite data and exercises school isolation, parent/teacher scopes, support access, and tenant authorization behavior.
- This is local PGlite evidence only. No Production database was queried and live Production tenant authorization is **not independently verified**.

## Controlled authentication test plan

Run only after a deployment containing the Firebase integration is identified, its backend service-account initialization is confirmed, and the owner provides a secure authenticated route. Use dedicated Firebase identities and a test-only EduConnect school/account fixture that is isolated from real school records. Do not create, edit, suspend, migrate, or delete users or memberships in Production as part of this test.

1. Confirm the deployment commit includes the Admin SDK dependency, service-account JSON parser, `AUTH_PROVIDER=firebase`, Firebase token middleware, and PostgreSQL UID mapping.
2. Confirm the target database is explicitly designated for test data and contains no real school/student records. If that cannot be established, stop and use a separate isolated target.
3. Check Vercel env variable names/scopes and have the owner validate secret values without revealing them. Confirm Firebase project ID is `educonnect-44f2b` and the Admin service account belongs to that project.
4. Confirm Firebase authorized domains and Google OAuth JavaScript origins for the test hostname.
5. With dedicated accounts, verify Google sign-in and email/password sign-in; ensure verified email behavior is enforced.
6. Verify a linked test PostgreSQL user resolves to the existing user ID and existing role/permissions, with no automatic membership creation.
7. Verify a Firebase UID with no EduConnect mapping is denied; verify an inactive/suspended fixture is denied.
8. Verify a multi-school test user can select each authorized school, retains that school's permissions, and is denied for an unrelated school.
9. Verify malformed, invalid-signature, wrong-project, and expired ID tokens are rejected.
10. Inspect browser console, API responses, and Vercel runtime logs. Record statuses and errors only; redact cookies, bearer tokens, credentials, and personal data.

## Required owner actions

1. Ensure the Firebase implementation is committed and pushed to the intended branch, then confirm Vercel Production is built from that exact commit. Current Production commit `1982d90` does not include it. Do not trigger another deployment through this verification task.
2. Confirm secret variable values privately in Vercel. The current report only confirms names/scopes, not the contents of `FIREBASE_PROJECT_ID` or `FIREBASE_SERVICE_ACCOUNT_JSON`.
3. Investigate the `/api/auth/refresh` `X-Forwarded-For` / Express `trust proxy` validation log and verify rate limiter IP handling before relying on production authentication flows.
4. Provide a dedicated isolated test data source and Firebase accounts, or an authorized test deployment backed by isolated non-production PostgreSQL. No such fixtures were available to this verification run.
5. Have an authorized project owner access the protected deployment through Vercel as described above. Keep deployment protection enabled.

No destructive or irreversible Production operation was performed. No users were migrated, no Production settings were modified, and no real school/student records were accessed.
