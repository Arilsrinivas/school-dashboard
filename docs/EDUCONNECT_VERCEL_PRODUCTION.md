# EduConnect Vercel Production Preparation

**State:** repository configuration prepared locally; Vercel project and Production variables are not configured because this checkout is logged out of Vercel. No deployment was created.

## Deployment shape

Use one new Vercel project named `educonnect`, rooted at the repository root (`./`). The root project serves the Vite build at `apps/web/dist` and routes API requests to the Express application in `api/[...slug].ts`. The function imports the compiled API from `apps/api/dist/server.js`, produced by the repository build command. The SPA fallback rewrite is last; Vercel filesystem routes take precedence over rewrites, so `/api/*` reaches the function while React routes resolve to `index.html`.

This is a single-origin deployment: browser API calls use relative `/api` paths, Firebase Authentication uses the existing `educonnect-44f2b` Web App, and the Express API connects to the existing PostgreSQL and private Supabase Storage project. The Vercel Express integration runs the exported Express application as a Node.js Function; Vercel documents the function entry-point and routing behavior in [Express on Vercel](https://vercel.com/docs/frameworks/backend/express) and [Vercel rewrites](https://vercel.com/docs/routing/rewrites).

## Vercel project isolation

The local CLI check returned `Logged out`, and this checkout has no `.vercel/project.json`. Therefore no project ID, team scope, domain, Production variable, or old-project association was changed or assumed.

After signing into the intended Vercel team:

1. Create a new project named `educonnect` with `vercel project add` or the Vercel dashboard. Do not select, rename, relink, or import settings from the Schoollog project.
2. Verify the new project ID is distinct from Schoollog before continuing. Keep this repository's Root Directory as `./`.
3. Set Framework Preset to Vite, Node.js version to `24.x`, Install Command to `npm install`, Build Command to `npm run vercel-build`, and Output Directory to `apps/web/dist`.
4. Set the Production Branch to the approved release branch after the changes are available in the Git remote. Do not connect a branch in a way that starts a deployment before configuration review.
5. Add environment variables to this new project's Production scope only. Never copy the Schoollog project's variables. Keep Preview variables empty until an isolated non-production database is available.
6. Choose the final production hostname (for example, the available `educonnect.vercel.app` domain or an EduConnect custom domain). Use that exact HTTPS origin for `WEB_ORIGIN` and Firebase configuration.

The Vercel CLI and dashboard can manage projects and environment variables; see [Vercel project commands](https://vercel.com/docs/cli/project) and [environment variables](https://vercel.com/docs/cli/env). Project creation and environment setup are still human actions because Vercel authentication is unavailable in this local session.

## Production environment variables

Set these in the `educonnect` project's **Production** scope. Values marked secret must not be placed in Git, `apps/web/.env`, any `VITE_` variable, build output, or logs.

| Variable | Value/source | Exposure |
|---|---|---|
| `NODE_ENV` | `production` | Server |
| `AUTH_PROVIDER` | `firebase` | Server |
| `WEB_ORIGIN` | Exact HTTPS production site origin | Server |
| `INVITATION_BASE_URL` | `${WEB_ORIGIN}/accept-invitation` | Server |
| `RECOVERY_BASE_URL` | `${WEB_ORIGIN}/recover-account` | Server |
| `ACCESS_TOKEN_SECRET` | New random secret, at least 32 characters | Secret, server only |
| `REFRESH_TOKEN_SECRET` | Different new random secret, at least 32 characters | Secret, server only |
| `DATABASE_URL` | `educonnect_app` Supabase transaction-pooler URL (port 6543) | Secret, server only |
| `PLATFORM_DATABASE_URL` | `educonnect_platform` Supabase transaction-pooler URL (port 6543) | Secret, server only |
| `DATABASE_SSL_CA_CERT` | Contents of the verified Supabase root CA PEM | Server; certificate is public, but keep configuration out of logs |
| `FIREBASE_PROJECT_ID` | `educonnect-44f2b` | Server |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Existing Firebase Admin service account JSON for `educonnect-44f2b` | Secret, server only |
| `SUPABASE_URL` | `https://jnhcomdjezlvmxpjkoot.supabase.co` | Server |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server-only Supabase service-role key | Secret, server only |
| `SUPABASE_STUDENT_DOCUMENTS_BUCKET` | `student-documents` | Server |
| `SUPABASE_PROFILE_IMAGES_BUCKET` | `profile-images` | Server |
| `SUPABASE_ASSIGNMENTS_BUCKET` | `assignments` | Server |
| `SUPABASE_SCHOOL_DOCUMENTS_BUCKET` | `school-documents` | Server |
| `VITE_FIREBASE_API_KEY` | Key for the registered EduConnect Web App | Public frontend config |
| `VITE_FIREBASE_AUTH_DOMAIN` | `educonnect-44f2b.firebaseapp.com` | Public frontend config |
| `VITE_FIREBASE_PROJECT_ID` | `educonnect-44f2b` | Public frontend config |
| `VITE_FIREBASE_APP_ID` | `1:680544077722:web:81875b1be669b7fcd11c23` | Public frontend config |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `680544077722` | Public frontend config |
| `VITE_API_URL` | Leave unset or empty; API is same-origin at `/api` | Public frontend config |

The root `vercel-build` command runs `scripts/verify-vercel-production-env.ts` first. For Production builds it fails closed unless database URLs identify the dedicated EduConnect project, TLS has the configured CA, Firebase Admin and Web App settings match `educonnect-44f2b`, all public app URLs use HTTPS, and `VITE_API_URL` is empty. It also rejects the known legacy Schoollog hostname. The backend repeats production validation at runtime.

The local ignored frontend env currently points at a local API; it is not committed. Vercel's production build guard rejects any non-empty `VITE_API_URL`, including that localhost value, if it is mistakenly entered in Production settings.

If invitation and password-recovery emails must be delivered at launch, configure the selected SMTP provider's server-only `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. SMTP credentials are not present in the current local API environment, so email delivery is not verified by this preparation.

## Firebase Console configuration

After choosing the production hostname:

1. In [Firebase Authentication settings](https://console.firebase.google.com/project/educonnect-44f2b/authentication/settings), add the production hostname (and any custom domain) to Authorized domains.
2. In [Google Cloud OAuth credentials](https://console.cloud.google.com/apis/credentials?project=educonnect-44f2b), add `https://<production-host>` to the Authorized JavaScript origins of the existing OAuth Web Client ID `680544077722-48ohflm900bhfvc5s09og4fq1b88416.apps.googleusercontent.com`.
3. Preserve the existing Firebase handler redirect URI `https://educonnect-44f2b.firebaseapp.com/__/auth/handler`. Do not create another OAuth client for this change.
4. Do not put Firebase Admin JSON, private keys, or Supabase service-role credentials in any `VITE_` variable.

These Firebase Console changes cannot be verified until the exact Vercel hostname exists.

## Routing, cookies, and health checks

- API and web share one HTTPS origin, so frontend requests use `/api/*`; no external API host or CORS wildcard is needed.
- CORS now permits only configured `WEB_ORIGIN`, the exact `VERCEL_URL` deployment origin, and localhost during non-production. The previous hard-coded Schoollog domain and broad team-preview pattern were removed. `PUT` is included for file uploads.
- Express trusts one proxy hop only when `VERCEL=1`. Refresh cookies remain `HttpOnly`, `Secure`, `SameSite=Strict`, and scoped to `/api/auth` in production.
- `GET /api/health` reports application database connectivity. `GET /api/readyz` verifies both non-superuser/non-`BYPASSRLS` PostgreSQL runtime roles, Firebase Admin initialization for the expected project, and all four private storage buckets. Readiness responses do not expose credentials or provider details.
- Post-deployment Firebase token test: sign in with a dedicated authorized test account, obtain an ID token in the browser session, then call `/api/auth/firebase/context` with `Authorization: Bearer <ID token>`. Confirm the expected linked account and school list. Never paste tokens into shell history, screenshots, logs, or this report. This live request cannot be tested before a deployment URL exists.

## Upload-size constraint

EduConnect currently accepts files up to 10 MiB through the API. Vercel's documented default Function request/response body limit is 4.5 MB; Vercel has announced a public-beta 20 MiB option that requires `VERCEL_SUPPORT_LARGE_REQUEST_BODY=1` and 4 GB Function memory. This preparation does not opt into that memory setting or change billing. Before accepting files larger than 4.5 MB on Vercel, either approve/configure the beta memory setting for this new project or move the client upload to a backend-authorized Supabase signed-upload flow. See [Vercel Function limits](https://vercel.com/docs/functions/limitations) and [the large-body beta announcement](https://vercel.com/changelog/vercel-functions-now-support-request-bodies-up-to-20mib). This is a production launch blocker until resolved.

## Readiness, deployment, and rollback

Before the first deployment, confirm the project ID is not Schoollog's, Production variables pass the build guard, the Firebase hostname/origins are authorized, and the database CA/connection roles point to the existing EduConnect Supabase project. No schema migration or database-content change is required for this app deployment.

After deployment, check `/api/health` and `/api/readyz`, then run the Firebase ID-token smoke test above with a dedicated account. Only then consider promoting the approved deployment to the new `educonnect` Production project.

Rollback affects only the `educonnect` project: use its last Ready deployment in Vercel's deployment history/Instant Rollback, or redeploy its previous known-good commit and reassign only the EduConnect production domain. Do not change the Schoollog project's aliases, environment variables, domains, database, or deployments. Since this is the first EduConnect release, there may be no previous Ready EduConnect deployment to promote; in that case keep the new domain unassigned until the corrected deployment passes verification.

## Current manual actions / blockers

- Sign into Vercel and create the isolated `educonnect` project; this session's CLI is logged out and no Vercel project is linked here.
- Confirm the new project's unique Vercel project ID and final Production hostname.
- Add the Production variables from the table in Vercel's encrypted project settings.
- Authorize that hostname in Firebase Authentication and the existing Google OAuth client.
- Decide how to support files above Vercel's default body limit without an unapproved 4 GB memory/billing change.
- Configure SMTP if invitations and account recovery must send email at launch.
- Deploy a controlled Preview/Production only after project isolation and configuration have been independently reviewed. A deployed Firebase ID-token validation check is still pending.
