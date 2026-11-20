import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { env } from './config.js';
import { authRouter } from './auth/routes.js';
import { platformRouter, schoolRouter } from './schools/routes.js';
import { schoolRoleRouter } from './schools/roles.js';
import { supportRouter } from './support/routes.js';
import { attendanceRouter } from './attendance/routes.js';
import { homeworkRouter } from './homework/routes.js';
import { examRouter } from './exams/routes.js';
import { timetableRouter } from './timetable/routes.js';
import { feesRouter } from './fees/routes.js';
import { announcementsRouter } from './announcements/routes.js';
import { reportsRouter } from './reports/routes.js';
import { HttpError } from './http.js';
import { pool, platformPool } from './db/pool.js';

const APPROVED_PREVIEW_PATTERN = /^https:\/\/[a-z0-9-]+-arilsrinivas-projects\.vercel\.app$/;
const APPROVED_PROD_DOMAIN = 'https://school-dashboard-nine-rho.vercel.app';

export const app=express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests without origin (same-origin, mobile apps, serverless internal)
    if (!origin) return callback(null, true);
    // Exact match for configured WEB_ORIGIN
    if (origin === env.WEB_ORIGIN) return callback(null, true);
    // Exact match for verified production deployment domain
    if (origin === APPROVED_PROD_DOMAIN) return callback(null, true);
    // Scoped regex match for team/project preview domains
    if (APPROVED_PREVIEW_PATTERN.test(origin)) return callback(null, true);
    // Allow localhost only in non-production environments
    if (env.NODE_ENV !== 'production' && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
      return callback(null, true);
    }
    return callback(new HttpError(403, 'CORS origin not allowed: ' + origin), false);
  },
  credentials: true,
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(compression());
app.use(express.json({limit:'1mb'}));

// Controlled Migration Execution Check:
// In production, migrations must be executed via controlled CI/CD pipeline or deployment task (`npm run db:migrate`).
// Running DDL migrations inside incoming HTTP request handlers is strictly forbidden in production.
if (process.env.NODE_ENV === 'development' && process.env.AUTO_MIGRATE === 'true') {
  let autoMigrated = false;
  app.use(async (_req, _res, next) => {
    if (!autoMigrated) {
      try {
        const { runMigrations } = await import('./db/migrate.js');
        await runMigrations();
        autoMigrated = true;
      } catch (err: any) {
        console.warn('[Auto-Migration] Development notice:', err.message);
      }
    }
    next();
  });
}

app.get(['/health', '/api/health'], async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    await platformPool.query('SELECT 1');
    res.json({
      status: 'ok',
      database: 'ok',
      platformDatabase: 'ok',
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'unavailable',
      database: 'unavailable',
      error: 'Database connectivity check failed',
      timestamp: new Date().toISOString()
    });
  }
});
const authLimiter = env.NODE_ENV === 'production'
  ? rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false })
  : (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
app.use(['/api/auth', '/auth'], authLimiter, authRouter);
app.use(['/api/platform', '/platform'], supportRouter);
app.use(['/api/platform', '/platform'], platformRouter);
app.use(['/api/school', '/school'], schoolRouter);
app.use(['/api/school', '/school'], schoolRoleRouter);
app.use(['/api/school', '/school'], attendanceRouter);
app.use(['/api/school/homework', '/school/homework'], homeworkRouter);
app.use(['/api/school', '/school'], examRouter);
app.use(['/api/school', '/school'], timetableRouter);
app.use(['/api/school/fees', '/school/fees'], feesRouter);
app.use(['/api/school', '/school'], announcementsRouter);
app.use(['/api/school', '/school'], reportsRouter);
app.use((_req,res)=>res.status(404).json({error:'Not found'}));
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error instanceof HttpError)return res.status(error.status).json({error:error.message});
  if(error && typeof error==='object' && 'name' in error && error.name==='ZodError')return res.status(400).json({error:'Invalid request data',details:(error as {issues?:unknown}).issues});
  if(error&&typeof error==='object'&&'code' in error){
    const code=(error as {code:string}).code;
    if(code==='23505')return res.status(409).json({error:'A record with those details already exists'});
    if(code==='23503'||code==='23514')return res.status(400).json({error:'The selected school record is not valid'});
    if(code==='ECONNREFUSED'||code==='ETIMEDOUT')return res.status(503).json({error:'Database unavailable. On Vercel, connect a PostgreSQL database (e.g. Neon) in the Storage tab, or test on mobile via local network Wi-Fi.'});
  }
  const msg = (error as Error)?.message || '';
  if (msg.includes('Connection terminated') || msg.includes('connection timeout')) {
    return res.status(503).json({error:'Database unavailable. On Vercel, connect a PostgreSQL database (e.g. Neon) in the Storage tab, or test on mobile via local network Wi-Fi.'});
  }
  console.error('Unhandled API error',error);return res.status(500).json({error:'Internal server error'});
});
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const server=app.listen(env.API_PORT,()=>console.info(`EduConnect API listening on ${env.API_PORT}`));
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>{void Promise.all([pool.end(),platformPool.end()]).then(()=>process.exit(0));}));
}
