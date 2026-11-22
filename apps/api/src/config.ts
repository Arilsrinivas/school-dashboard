import 'dotenv/config';
import { z } from 'zod';
import { parseFirebaseServiceAccountJson } from './auth/firebase-service-account.js';
import { assertEduConnectDatabaseTarget } from './db/target-identity.js';

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
  if (values.AUTH_PROVIDER !== 'firebase') throw new Error('AUTH_PROVIDER must be firebase in production');
  if (!values.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be configured in production for Firebase Authentication');
  if (values.FIREBASE_PROJECT_ID !== 'educonnect-44f2b') throw new Error('FIREBASE_PROJECT_ID must be educonnect-44f2b in production');
  if (!values.SUPABASE_URL?.trim()) throw new Error('SUPABASE_URL must be configured in production for private document storage');
  if (!values.SUPABASE_SERVICE_ROLE_KEY?.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY must be configured in production for private document storage');
  let storageUrl: URL;
  try { storageUrl = new URL(values.SUPABASE_URL); } catch { throw new Error('SUPABASE_URL must point to the dedicated EduConnect project'); }
  if (storageUrl.protocol !== 'https:' || storageUrl.hostname !== 'jnhcomdjezlvmxpjkoot.supabase.co') throw new Error('SUPABASE_URL must point to the dedicated EduConnect project');
  if (!values.DATABASE_URL?.trim()||!values.PLATFORM_DATABASE_URL?.trim()) throw new Error('DATABASE_URL and PLATFORM_DATABASE_URL must be explicitly configured for EduConnect');
  try { assertEduConnectDatabaseTarget(values.DATABASE_URL,values.PLATFORM_DATABASE_URL,'jnhcomdjezlvmxpjkoot','postgres'); } catch { throw new Error('Database URLs must identify the dedicated EduConnect PostgreSQL project and postgres database'); }
  if (!values.DATABASE_SSL_CA_CERT?.trim()) throw new Error('DATABASE_SSL_CA_CERT must contain the Supabase root CA for strict Vercel TLS verification');
  if (!values.WEB_ORIGIN?.trim()) throw new Error('WEB_ORIGIN must be the HTTPS EduConnect production origin');
  const parseHttpsOrigin=(key:string,value:string)=>{
    let url:URL;try{url=new URL(value);}catch{throw new Error(`${key} must be a valid HTTPS URL`);}
    if(url.protocol!=='https:'||url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname.endsWith('.local')||url.hostname.includes('school-dashboard'))throw new Error(`${key} must use the EduConnect HTTPS domain, not a local or legacy Schoollog domain`);
    return url;
  };
  const webOrigin=parseHttpsOrigin('WEB_ORIGIN',values.WEB_ORIGIN);
  for(const key of ['INVITATION_BASE_URL','RECOVERY_BASE_URL'] as const){
    const value=values[key];if(!value?.trim())throw new Error(`${key} must use the EduConnect production origin`);
    if(parseHttpsOrigin(key,value).origin!==webOrigin.origin)throw new Error(`${key} must use the same origin as WEB_ORIGIN`);
  }
  if(values.GOOGLE_CALLBACK_URL?.trim()&&parseHttpsOrigin('GOOGLE_CALLBACK_URL',values.GOOGLE_CALLBACK_URL).origin!==webOrigin.origin)throw new Error('GOOGLE_CALLBACK_URL must use the same origin as WEB_ORIGIN');
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
  DATABASE_SSL_CA_CERT_PATH: z.string().optional(),
  DATABASE_SSL_CA_CERT: z.string().optional(),
  MIGRATION_DATABASE_URL: z.string().default(defaultPlatformDb),
  PLATFORM_DATABASE_URL: z.string().default(defaultPlatformDb),
  ACCESS_TOKEN_SECRET: z.string().min(32).default('dev-access-token-secret-must-be-at-least-32-chars-long'),
  REFRESH_TOKEN_SECRET: z.string().min(32).default('dev-refresh-token-secret-must-be-at-least-32-chars-long-different'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_FIREBASE_UID: z.string().min(1).max(128).optional(),
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
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_STUDENT_DOCUMENTS_BUCKET: z.string().default('student-documents'),
  SUPABASE_PROFILE_IMAGES_BUCKET: z.string().default('profile-images'),
  SUPABASE_ASSIGNMENTS_BUCKET: z.string().default('assignments'),
  SUPABASE_SCHOOL_DOCUMENTS_BUCKET: z.string().default('school-documents'),
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
for(const key of ['DATABASE_URL','PLATFORM_DATABASE_URL','MIGRATION_DATABASE_URL','ACCESS_TOKEN_SECRET','REFRESH_TOKEN_SECRET'] as const){const value=env[key];if(value?.toLowerCase().includes('replace-with')||value?.toLowerCase().includes('replace-before'))throw new Error(`${key} still has the example placeholder; replace it before starting EduConnect`);}
