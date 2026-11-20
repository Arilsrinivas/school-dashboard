import { OAuth2Client } from 'google-auth-library';
import { env } from '../config.js';

export interface VerifiedGooglePayload {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

let oauth2Client: OAuth2Client | null = null;
function getOAuth2Client(): OAuth2Client {
  if (!oauth2Client) {
    oauth2Client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  }
  return oauth2Client;
}

export type GoogleTokenVerifier = (token: string, expectedAudience?: string) => Promise<VerifiedGooglePayload>;

let testVerifier: GoogleTokenVerifier | null = null;

/**
 * Configure a custom Google token verifier for testing purposes.
 * Strictly forbidden outside test environments.
 */
export function setGoogleTokenVerifier(verifier: GoogleTokenVerifier | null): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setGoogleTokenVerifier can only be called in test environment');
  }
  testVerifier = verifier;
}

export function resetGoogleTokenVerifier(): void {
  testVerifier = null;
}

export async function verifyGoogleIdToken(token: string, expectedAudience?: string): Promise<VerifiedGooglePayload> {
  if (!token || typeof token !== 'string') {
    throw new Error('Google ID token is required');
  }

  // In test environment ONLY, allow injected verifier
  if (process.env.NODE_ENV === 'test' && testVerifier) {
    return testVerifier(token, expectedAudience);
  }

  // Official Google token verification via google-auth-library
  const clientId = expectedAudience || env.GOOGLE_CLIENT_ID;
  const client = getOAuth2Client();
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: clientId
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Token payload missing');
  }

  if (!payload.sub) {
    throw new Error('Google sub claim is missing');
  }
  if (!payload.email) {
    throw new Error('Email is missing from Google token');
  }
  if (payload.email_verified !== true) {
    throw new Error('Google email is not verified');
  }

  const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (!payload.iss || !validIssuers.includes(payload.iss)) {
    throw new Error('Invalid token issuer');
  }

  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw new Error('Token is expired');
  }

  const email = payload.email.toLowerCase().trim();
  const fallbackName = email.split('@')[0] || 'User';
  return {
    sub: payload.sub,
    email,
    emailVerified: Boolean(payload.email_verified),
    name: payload.name || fallbackName,
    picture: payload.picture,
  };
}
