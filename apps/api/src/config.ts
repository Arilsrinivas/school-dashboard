import 'dotenv/config';
import { z } from 'zod';
import { parseFirebaseServiceAccountJson } from './auth/firebase-service-account.js';

function resolveDatabaseUrl(): string {
  const direct =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.STORAGE_POSTGRES_URL ||
    process.env.STORAGE_URL ||
    process.env.STORAGE_POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.STORAGE_POSTGRES_URL_NON_POOLING;
  if (direct) return direct;

  for (const [key, val] of Object.entries(process.env)) {
    if (typeof val === 'string' && (val.startsWith('postgres://') || val.startsWith('postgresql://'))) {
      return val;
    }
  }

  return 'postgresql://educonnect_app:local-dev-runtime-pass-2026@127.0.0.1:5432/postgres?sslmode=disable';
}

function resolvePlatformDatabaseUrl(): string {
  const direct =
    process.env.PLATFORM_DATABASE_URL ||
    process.env.MIGRATION_DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.STORAGE_POSTGRES_URL_NON_POOLING;
  if (direct) return direct;
  return resolveDatabaseUrl();
}

export function validateProductionEnvironment(values: NodeJS.ProcessEnv): void {
  if (values.NODE_ENV !== 'production') return;

  const databaseUrl = [
    values.DATABASE_URL, values.POSTGRES_URL, values.STORAGE_POSTGRES_URL,
    values.STORAGE_URL, values.STORAGE_POSTGRES_PRISMA_URL,
    values.POSTGRES_PRISMA_URL, values.POSTGRES_URL_NON_POOLING,
    values.STORAGE_POSTGRES_URL_NON_POOLING
  ].find(value => Boolean(value?.trim())) || Object.values(values).find(value =>
    typeof value === 'string' && /^postgres(?:ql)?:\/\//i.test(value)
  );
  if (!databaseUrl) throw new Error('DATABASE_URL must be configured in production');

  const access = values.ACCESS_TOKEN_SECRET;
  const refresh = values.REFRESH_TOKEN_SECRET;
  if (!access || access.length < 32) throw new Error('ACCESS_TOKEN_SECRET must be explicitly configured with at least 32 characters in production');
  if (!refresh || refresh.length < 32) throw new Error('REFRESH_TOKEN_SECRET must be explicitly configured with at least 32 characters in production');
  if (access === refresh) throw new Error('Access and refresh secrets must be different');
  if (!values.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be configured in production for Firebase Authentication');
  parseFirebaseServiceAccountJson(values.FIREBASE_SERVICE_ACCOUNT_JSON, values.FIREBASE_PROJECT_ID || 'educonnect-44f2b');
}

validateProductionEnvironment(process.env);

const defaultDb = resolveDatabaseUrl();
const defaultPlatformDb = resolvePlatformDatabaseUrl();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().default(defaultDb),
  MIGRATION_DATABASE_URL: z.string().default(defaultPlatformDb),
  PLATFORM_DATABASE_URL: z.string().default(defaultPlatformDb),
  ACCESS_TOKEN_SECRET: z.string().min(32).default('dev-access-token-secret-must-be-at-least-32-chars-long'),
  REFRESH_TOKEN_SECRET: z.string().min(32).default('dev-refresh-token-secret-must-be-at-least-32-chars-long-different'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().default('CalmStacks Platform Admin'),
  INVITATION_BASE_URL: z.string().default('http://localhost:5173/accept-invitation'),
  RECOVERY_BASE_URL: z.string().default('http://localhost:5173/recover-account'),
  INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(72),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().optional(), SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(), SMTP_FROM: z.string().default('EduConnect <no-reply@example.com>'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().default('educonnect-44f2b'), FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  VITE_FIREBASE_API_KEY: z.string().optional(), VITE_FIREBASE_AUTH_DOMAIN: z.string().optional(), VITE_FIREBASE_APP_ID: z.string().optional(), VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(), SUPABASE_ANON_KEY: z.string().optional(), SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('school-private-documents'), SUPABASE_STORAGE_ENABLED: z.enum(['true','false']).default('false'),
  AUTH_PROVIDER: z.enum(['firebase','legacy']).default(process.env.NODE_ENV === 'production' ? 'firebase' : 'legacy')
});

export const env = schema.parse(process.env);
if (env.AUTH_PROVIDER === 'firebase' && env.NODE_ENV !== 'test' && !env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required when AUTH_PROVIDER=firebase');
}
export const firebaseServiceAccount = env.AUTH_PROVIDER === 'firebase' && env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? parseFirebaseServiceAccountJson(env.FIREBASE_SERVICE_ACCOUNT_JSON, env.FIREBASE_PROJECT_ID)
  : undefined;
if (env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET) throw new Error('Access and refresh secrets must be different');
if(env.SUPABASE_STORAGE_ENABLED==='true'&&(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY))throw new Error('SUPABASE_STORAGE_ENABLED requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
for(const key of ['DATABASE_URL','PLATFORM_DATABASE_URL','MIGRATION_DATABASE_URL','ACCESS_TOKEN_SECRET','REFRESH_TOKEN_SECRET','BOOTSTRAP_ADMIN_PASSWORD'] as const){const value=env[key];if(value?.toLowerCase().includes('replace-with')||value?.toLowerCase().includes('replace-before'))throw new Error(`${key} still has the example placeholder; replace it before starting EduConnect`);}
