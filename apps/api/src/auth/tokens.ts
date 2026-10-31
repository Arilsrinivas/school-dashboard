import { createHmac, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config.js';

const accessKey = new TextEncoder().encode(env.ACCESS_TOKEN_SECRET);
const refreshKey = env.REFRESH_TOKEN_SECRET;
export type Identity = { kind: 'platform' | 'school'; id: string; role: string; schoolId?: string };
export async function signAccess(identity: Identity) {
  return new SignJWT({ kind: identity.kind, role: identity.role, ...(identity.schoolId ? { schoolId: identity.schoolId } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(identity.id).setIssuedAt().setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`).sign(accessKey);
}
export async function readAccess(token: string): Promise<Identity> {
  const { payload } = await jwtVerify(token, accessKey, { algorithms: ['HS256'] });
  if (!payload.sub || (payload.kind !== 'platform' && payload.kind !== 'school') || typeof payload.role !== 'string') throw new Error('Invalid token');
  return { id: payload.sub, kind: payload.kind, role: payload.role, ...(typeof payload.schoolId === 'string' ? { schoolId: payload.schoolId } : {}) };
}
export function newRefreshSecret() { return randomBytes(32).toString('base64url'); }
export function hashRefresh(secret: string) { return createHmac('sha256', refreshKey).update(secret).digest('hex'); }
