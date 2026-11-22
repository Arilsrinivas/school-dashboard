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
import { storageRouter } from './storage/routes.js';
import { HttpError } from './http.js';
import { pool, platformPool, verifyRuntimeDatabaseRoles } from './db/pool.js';
import { configureProxyTrust } from './proxy.js';
import { initializeFirebaseAdmin } from './auth/firebase-admin.js';
import { bucketForPurpose, storageClient } from './storage/supabase.js';
import { isAllowedCorsOrigin } from './cors.js';

export const app=express();
// Vercel's edge overwrites X-Forwarded-For before forwarding to the function.
// Trust exactly that one hop in its runtime; trust no forwarded headers locally.
configureProxyTrust(app, process.env.VERCEL === '1');
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests without origin (same-origin, mobile apps, serverless internal)
    if (!origin) return callback(null, true);
    if(isAllowedCorsOrigin(origin,env.WEB_ORIGIN,process.env.VERCEL_URL,env.NODE_ENV==='production'))return callback(null,true);
    return callback(new HttpError(403, 'CORS origin not allowed: ' + origin), false);
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-EduConnect-School-ID','X-EduConnect-Legacy-Token']
}));
app.use(compression());
app.use(express.json({limit:'1mb'}));

let runtimeRoleCheckAt=0;
let runtimeRoleCheck:Promise<void>|null=null;
app.use((_req,_res,next)=>{
  if(env.NODE_ENV!=='production'||Date.now()-runtimeRoleCheckAt<30_000)return next();
  runtimeRoleCheck??=verifyRuntimeDatabaseRoles().then(()=>{runtimeRoleCheckAt=Date.now();}).finally(()=>{runtimeRoleCheck=null;});
  void runtimeRoleCheck.then(()=>next()).catch(next);
});

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
  res.setHeader('Cache-Control','no-store');
  try {
    if(env.NODE_ENV==='production') await verifyRuntimeDatabaseRoles();
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
app.get(['/readyz','/api/readyz'],async(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const checks={database:false,firebaseAdmin:false,storage:false};
  try{
    await verifyRuntimeDatabaseRoles();
    await Promise.all([pool.query('SELECT 1'),platformPool.query('SELECT 1')]);
    checks.database=true;
    const auth=initializeFirebaseAdmin();
    if(auth.app.options.projectId!==env.FIREBASE_PROJECT_ID)throw new Error('Firebase Admin project mismatch');
    checks.firebaseAdmin=true;
    for(const purpose of ['student_document','student_profile_photo','assignment_attachment','school_document'] as const){
      const bucket=await storageClient().storage.getBucket(bucketForPurpose(purpose));
      if(bucket.error||!bucket.data||bucket.data.public)throw new Error('Private storage bucket is unavailable');
    }
    checks.storage=true;
    return res.json({status:'ready',checks,timestamp:new Date().toISOString()});
  }catch{
    return res.status(503).json({status:'not_ready',checks,error:'One or more required services are unavailable',timestamp:new Date().toISOString()});
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
app.use(['/api/school', '/school'], storageRouter);
app.use((_req,res)=>res.status(404).json({error:'Not found'}));
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error instanceof HttpError)return res.status(error.status).json({error:error.message});
  if(error && typeof error==='object' && 'name' in error && error.name==='ZodError')return res.status(400).json({error:'Invalid request data',details:(error as {issues?:unknown}).issues});
  if(error&&typeof error==='object'&&'code' in error){
    const code=(error as {code:string}).code;
    if(code==='23505')return res.status(409).json({error:'A record with those details already exists'});
    if(code==='23503'||code==='23514')return res.status(400).json({error:'The selected school record is not valid'});
    if(code==='ECONNREFUSED'||code==='ETIMEDOUT')return res.status(503).json({error:'Database unavailable'});
  }
  const msg = (error as Error)?.message || '';
  if (msg.includes('Connection terminated') || msg.includes('connection timeout')) {
    return res.status(503).json({error:'Database unavailable'});
  }
  console.error('Unhandled API error',error);return res.status(500).json({error:'Internal server error'});
});
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const server=app.listen(env.API_PORT,()=>console.info(`EduConnect API listening on ${env.API_PORT}`));
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>{void Promise.all([pool.end(),platformPool.end()]).then(()=>process.exit(0));}));
}
