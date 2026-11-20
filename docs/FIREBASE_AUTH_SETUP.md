# Firebase Authentication Setup

## Status

The application uses Firebase Web Auth for email/password and Google sign-in when Firebase is configured. The API verifies Firebase ID tokens with Firebase Admin (`verifyIdToken(token, true)`), resolves only `external_identities.provider='firebase'` mappings, and reads account, membership, school, subscription, role, and permission state from PostgreSQL. A valid Firebase account without an EduConnect mapping is denied.

The supplied project details indicate that the web app, Google and Email/Password providers, and Vercel authorized domain are configured for `educonnect-44f2b`. No Admin service-account secret is available to this checkout, so tests use a test-only verifier; live Firebase signatures, verification mail, and revocation have not been verified here.

## Create and configure the Firebase project

1. Confirm the project ID is exactly `educonnect-44f2b`.
2. Confirm **Email/Password** and **Google** are enabled. The UI sends verification mail on account creation and refuses access until `emailVerified` is true.
3. Confirm the production Vercel domain and each approved preview domain appear in **Authentication → Settings → Authorized domains**.
4. Confirm the web app settings (API key, Auth Domain, Project ID, App ID, sender ID) match the Vercel build values. These web values are public identifiers; never place Admin credentials in web configuration.
5. Confirm the downloaded Admin service-account JSON belongs to `educonnect-44f2b` and has Firebase Authentication verification/revocation permissions. Keep it outside the repository. Do not commit it or paste it into tickets; store its complete contents as a server-only Vercel secret.

## Vercel configuration

Set these as **build-time** Vercel environment values for each environment, then rebuild the web app:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID` (informational; not required for current auth flows)

Set these as **server-only runtime secrets** for the API:

- `AUTH_PROVIDER=firebase`
- `FIREBASE_PROJECT_ID=educonnect-44f2b` (must equal the web app project ID)
- `FIREBASE_SERVICE_ACCOUNT_JSON` (the complete service-account JSON contents, stored as a server-only runtime environment variable; not a file path)

Also retain the existing PostgreSQL URLs and token secrets. Production boot intentionally fails if Firebase Admin JSON is absent, malformed, has invalid fields/private key, or names a different project. The backend parses and cryptographically validates the private key during initialization. Validation errors never include credential contents. Never prefix the Admin credential with `VITE_` or expose it to client code.

## Local development

The repository `.gitignore` excludes `.env`, `.env.*`, and app-local env files while allowing `.env.example`. Copy `.env.example` to `.env`, set `AUTH_PROVIDER=firebase`, and replace `FIREBASE_SERVICE_ACCOUNT_JSON` with the complete JSON contents from the downloaded service-account file. Keep the file local and verify it remains ignored by Git. Alternatively, use a local secret manager. Do not add the downloaded JSON file to the repository. For legacy-auth development, leave `AUTH_PROVIDER=legacy`; the Admin credential is not needed.

For Vercel, add the complete JSON as a server-only Environment Variable for the API's Production/Preview/Development environments as appropriate, then redeploy the API. Do not add this value to Vite build-time variables. Public web settings remain separate `VITE_FIREBASE_*` values. Confirm the API runtime has the variable without printing its value.

## Authentication and account migration behavior

- New school access still requires an existing invited account or an approved existing EduConnect account; Firebase signup alone gives no school membership.
- Invitation acceptance creates the existing PostgreSQL account first, then starts Firebase account creation with the invited email. The user must verify that email and sign in again before access is mapped.
- Existing password users claim their account by proving the existing EduConnect password and signing in to the same verified Firebase email. The API requires both the old signed EduConnect token and the verified Firebase token; email equality by itself cannot link records.
- Existing Google identities can be claimed through a verified Firebase Google session and the existing Google identity/password-link process. Configure `GOOGLE_CLIENT_ID` to the same OAuth web client used by the Firebase Google provider during this migration path.
- PostgreSQL user IDs, memberships, and password hashes are retained. Do not delete legacy hashes or disable legacy session code until account migration and rollback evidence are accepted.
- Multi-school users carry a selected display school ID in `X-EduConnect-School-ID`; the API matches it to an active relational membership and loads permissions from PostgreSQL. A Firebase token cannot request an unrelated tenant.
- Logout calls Firebase token revocation and signs out the local browser session. The Admin SDK checks revocation on protected requests; revocation has an additional Firebase Auth network round trip.
- Firebase password recovery sends through Firebase's reset flow. PostgreSQL remains the source of truth for account activation and school authorization.

## Verification checklist

1. Test email verification and password reset using a Firebase test user.
2. Test Google popup authentication on the Vercel origin and authorized preview domain.
3. Verify a Firebase account without an EduConnect mapping receives 403.
4. Link one account through the explicit existing-account proof flow; verify the mapping is unique by Firebase UID and existing user ID.
5. Revoke a Firebase refresh token and confirm the next protected API request is rejected.
6. Deactivate the PostgreSQL user/membership and confirm Firebase sign-in cannot restore EduConnect access.
7. Test a multi-school account with each selected school and an unlinked school ID.

Keep provider console evidence with the release. Do not call Firebase production-verified until these live checks have passed.
