import 'dotenv/config';
import { z } from 'zod';

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
  GOOGLE_CALLBACK_URL: z.string().optional()
});

export const env = schema.parse(process.env);
if (env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET) throw new Error('Access and refresh secrets must be different');
for(const key of ['DATABASE_URL','PLATFORM_DATABASE_URL','MIGRATION_DATABASE_URL','ACCESS_TOKEN_SECRET','REFRESH_TOKEN_SECRET','BOOTSTRAP_ADMIN_PASSWORD'] as const){const value=env[key];if(value?.toLowerCase().includes('replace-with')||value?.toLowerCase().includes('replace-before'))throw new Error(`${key} still has the example placeholder; replace it before starting EduConnect`);}
