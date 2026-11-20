import { createPrivateKey } from 'node:crypto';

export interface FirebaseServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** Parse only the required Admin credential fields and never include raw credential data in errors. */
export function parseFirebaseServiceAccountJson(raw: string, expectedProjectId = 'educonnect-44f2b'): FirebaseServiceAccount {
  if (typeof raw !== 'string' || raw.length < 2 || raw.length > 64_000) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain a valid Firebase service-account JSON document');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON object');
  }
  const account = parsed as Record<string, unknown>;
  const projectId = account.project_id;
  const clientEmail = account.client_email;
  const privateKey = account.private_key;
  if (account.type !== 'service_account' || typeof projectId !== 'string' || !/^[a-z0-9][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
      typeof clientEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail) ||
      typeof privateKey !== 'string' || !privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing valid service-account credentials');
  }
  if (projectId !== expectedProjectId) throw new Error('Firebase service-account project does not match FIREBASE_PROJECT_ID');
  const normalizedKey = privateKey.replace(/\\n/g, '\n');
  try {
    createPrivateKey(normalizedKey);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON contains an invalid private key');
  }
  return { projectId, clientEmail, privateKey: normalizedKey };
}
