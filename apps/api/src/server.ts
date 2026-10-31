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

export const app=express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({origin:env.WEB_ORIGIN,credentials:true,methods:['GET','POST','PATCH','DELETE'],allowedHeaders:['Content-Type','Authorization']}));
app.use(compression());
app.use(express.json({limit:'1mb'}));
app.get('/health',async(_req,res)=>{try{await pool.query('SELECT 1');res.json({status:'ok',database:'ok'});}catch{res.status(503).json({status:'unavailable',database:'unavailable'});}});
app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-7',legacyHeaders:false}),authRouter);
app.use('/api/platform',supportRouter);
app.use('/api/platform',platformRouter);
app.use('/api/school',schoolRouter);
app.use('/api/school',schoolRoleRouter);
app.use('/api/school',attendanceRouter);
app.use('/api/school/homework',homeworkRouter);
app.use('/api/school',examRouter);
app.use('/api/school',timetableRouter);
app.use('/api/school/fees',feesRouter);
app.use('/api/school',announcementsRouter);
app.use('/api/school',reportsRouter);
app.use((_req,res)=>res.status(404).json({error:'Not found'}));
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error instanceof HttpError)return res.status(error.status).json({error:error.message});
  if(error && typeof error==='object' && 'name' in error && error.name==='ZodError')return res.status(400).json({error:'Invalid request data',details:(error as {issues?:unknown}).issues});
  if(error&&typeof error==='object'&&'code' in error){const code=(error as {code:string}).code;if(code==='23505')return res.status(409).json({error:'A record with those details already exists'});if(code==='23503'||code==='23514')return res.status(400).json({error:'The selected school record is not valid'});}
  console.error('Unhandled API error',error);return res.status(500).json({error:'Internal server error'});
});
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const server=app.listen(env.API_PORT,()=>console.info(`EduConnect API listening on ${env.API_PORT}`));
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>{void Promise.all([pool.end(),platformPool.end()]).then(()=>process.exit(0));}));
}
