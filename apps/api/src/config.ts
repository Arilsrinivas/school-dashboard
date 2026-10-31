import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),
  PLATFORM_DATABASE_URL: z.string().min(1),
  ACCESS_TOKEN_SECRET: z.string().min(32),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().default('CalmStacks Platform Admin'),
  INVITATION_BASE_URL: z.string().url().default('http://localhost:5173/accept-invitation'),
  RECOVERY_BASE_URL: z.string().url().default('http://localhost:5173/recover-account'),
  INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(72),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().optional(), SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(), SMTP_FROM: z.string().default('EduConnect <no-reply@example.com>')
});

export const env = schema.parse(process.env);
if (env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET) throw new Error('Access and refresh secrets must be different');
for(const key of ['DATABASE_URL','PLATFORM_DATABASE_URL','MIGRATION_DATABASE_URL','ACCESS_TOKEN_SECRET','REFRESH_TOKEN_SECRET','BOOTSTRAP_ADMIN_PASSWORD'] as const){const value=env[key];if(value?.toLowerCase().includes('replace-with')||value?.toLowerCase().includes('replace-before'))throw new Error(`${key} still has the example placeholder; replace it before starting EduConnect`);}
