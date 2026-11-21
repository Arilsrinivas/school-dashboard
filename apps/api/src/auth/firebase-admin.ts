import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { env, firebaseServiceAccount } from '../config.js';
import { HttpError } from '../http.js';

let testVerifier:((token:string)=>Promise<DecodedIdToken>)|null=null;
export function setFirebaseTokenVerifierForTest(verifier:((token:string)=>Promise<DecodedIdToken>)|null){if(process.env.NODE_ENV!=='test')throw new Error('Firebase token verifier injection is test-only');testVerifier=verifier;}

export function initializeFirebaseAdmin() {
  if (!firebaseServiceAccount) {
    throw new Error('Firebase Admin is not configured');
  }
  const app = getApps().find(candidate => candidate.name === 'educonnect-firebase') ?? initializeApp({
    credential: cert({
      projectId: firebaseServiceAccount.projectId,
      clientEmail: firebaseServiceAccount.clientEmail,
      privateKey: firebaseServiceAccount.privateKey,
    }),
    projectId: firebaseServiceAccount.projectId,
  }, 'educonnect-firebase');
  return getAuth(app);
}

export async function verifyFirebaseIdToken(token: string): Promise<DecodedIdToken> {
  if (!token || token.length > 10_000) throw new Error('Firebase ID token is invalid');
  if(process.env.NODE_ENV==='test'&&testVerifier)return testVerifier(token);
  try {
    return await initializeFirebaseAdmin().verifyIdToken(token, true);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (['auth/argument-error','auth/id-token-expired','auth/id-token-revoked','auth/invalid-id-token','auth/user-disabled','auth/user-not-found'].includes(code)) {
      throw new HttpError(code === 'auth/user-disabled' ? 403 : 401, 'Firebase ID token is invalid, expired, revoked, or unavailable');
    }
    throw error;
  }
}
export async function revokeFirebaseSessions(uid:string):Promise<void>{await initializeFirebaseAdmin().revokeRefreshTokens(uid);}
