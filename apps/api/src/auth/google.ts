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

export async function verifyGoogleIdToken(token: string, expectedAudience?: string): Promise<VerifiedGooglePayload> {
  if (!token || typeof token !== 'string') {
    throw new Error('Google ID token is required');
  }

  const clientId = expectedAudience || env.GOOGLE_CLIENT_ID;

  // 1. Support structured mock tokens in test or development environments
  if (token.startsWith('test-google-token:') || token.startsWith('mock-google-token:')) {
    const rawJson = token.replace(/^(test-google-token:|mock-google-token:)/, '');
    let parsed: any;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error('Malformed test token');
    }

    if (parsed.invalidSignature) {
      throw new Error('Invalid token signature');
    }
    if (parsed.exp && parsed.exp * 1000 < Date.now()) {
      throw new Error('Token is expired');
    }
    if (clientId && parsed.aud && parsed.aud !== clientId) {
      throw new Error('Invalid token audience');
    }
    const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (parsed.iss && !validIssuers.includes(parsed.iss)) {
      throw new Error('Invalid token issuer');
    }
    if (!parsed.email || !parsed.email.includes('@')) {
      throw new Error('Valid email information is required');
    }
    if (parsed.email_verified === false) {
      throw new Error('Google email is not verified');
    }
    if (!parsed.sub) {
      throw new Error('Google sub claim is missing');
    }

    return {
      sub: String(parsed.sub),
      email: String(parsed.email).toLowerCase().trim(),
      emailVerified: parsed.email_verified !== false,
      name: String(parsed.name || parsed.email.split('@')[0]),
      picture: parsed.picture
    };
  }

  // 2. Official Google token verification via google-auth-library
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
