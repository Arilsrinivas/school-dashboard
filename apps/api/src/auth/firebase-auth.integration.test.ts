import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

process.env.NODE_ENV='test';process.env.AUTH_PROVIDER='firebase';
process.env.ACCESS_TOKEN_SECRET='local-test-access-secret-that-is-long-enough';process.env.REFRESH_TOKEN_SECRET='different-local-test-refresh-secret-long-enough';
process.env.FIREBASE_PROJECT_ID='educonnect-44f2b';
const adminKey=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
process.env.FIREBASE_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',project_id:'educonnect-44f2b',client_email:'firebase-admin@educonnect-44f2b.iam.gserviceaccount.com',private_key:adminKey});

test('Firebase ID tokens resolve only explicitly linked active EduConnect accounts and school memberships',async()=>{
  const db=await PGlite.create();const migrationDir=new URL('../../migrations/',import.meta.url);
    await db.exec('CREATE ROLE educonnect_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; CREATE ROLE educonnect_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;');
  for(const name of (await readdir(migrationDir)).filter(name=>name.endsWith('.sql')).sort()){let sql=await readFile(new URL(name,migrationDir),'utf8');sql=sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/,'');await db.exec(sql);}
  await db.exec('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO educonnect_app,educonnect_platform; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO educonnect_app,educonnect_platform;');
  const socket=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:12});await socket.start();const port=Number(socket.getServerConn().split(':').at(-1));
  process.env.DATABASE_URL=`postgresql://educonnect_app@127.0.0.1:${port}/postgres?sslmode=disable`;process.env.PLATFORM_DATABASE_URL=`postgresql://educonnect_platform@127.0.0.1:${port}/postgres?sslmode=disable`;process.env.MIGRATION_DATABASE_URL=process.env.PLATFORM_DATABASE_URL;
  const [{pool,platformPool,tenantTransaction},{signAccess,hashRefresh,newRefreshSecret},{authRouter},{setFirebaseTokenVerifierForTest,initializeFirebaseAdmin}]=await Promise.all([import('../db/pool.js'),import('./tokens.js'),import('./routes.js'),import('./firebase-admin.js')]);
  const firebaseAuth=initializeFirebaseAdmin();assert.equal(firebaseAuth.app.options.projectId,'educonnect-44f2b');assert.equal(firebaseAuth.app.name,'educonnect-firebase');
  pool.on('acquire',client=>{void client.query('SET ROLE educonnect_app');});platformPool.on('acquire',client=>{void client.query('SET ROLE educonnect_platform');});
  const users:string[]=[],schools:string[]=[];const app=express();app.set('trust proxy',1);app.use(express.json());app.use('/api/auth',authRouter);app.get('/identity',(await import('../middleware/auth.js')).authenticate,(req,res)=>res.json(req.identity));app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status??500).json({error:error.message}));
  const server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
  const schoolToken='eyJhbGciOiJub25lIn0.eyJzdWIiOiJmaXJlYmFzZSJ9.sig';const platformToken='header.payload.signature';const unknownToken='unknown.uid.sig';const expiredToken='expired.uid.sig';
  setFirebaseTokenVerifierForTest(async token=>{if(token===schoolToken)return {uid:'firebase-school-uid',email:'teacher@example.test',email_verified:true} as any;if(token===platformToken)return {uid:'firebase-platform-uid',email:'admin@example.test',email_verified:true} as any;if(token===unknownToken)return {uid:'firebase-unlinked-uid',email:'nobody@example.test',email_verified:true} as any;if(token===expiredToken){const error=new Error('expired');(error as Error&{code:string}).code='auth/id-token-expired';throw error;}throw new Error('invalid signature');});
  const call=(path:string,token:string,school?:string,init:RequestInit={})=>fetch(`${base}${path}`,{...init,headers:{Authorization:`Bearer ${token}`,...(school?{'X-EduConnect-School-ID':school}:{}),...(init.body?{'Content-Type':'application/json'}:{}),...init.headers}});
  try{
    const role=(await platformPool.query("SELECT id FROM platform_roles WHERE name='super_admin'")).rows[0].id;
    const platformId=randomUUID();users.push(platformId);await platformPool.query('INSERT INTO platform_users(id,email,name,password_hash,role_id) VALUES($1,$2,$3,$4,$5)',[platformId,'admin@example.test','Platform Admin','legacy-hash',role]);
    const refreshId=randomUUID(),refreshSecret=newRefreshSecret();await platformPool.query("INSERT INTO user_sessions(id,user_kind,user_id,refresh_token_hash,expires_at) VALUES($1,'platform',$2,$3,now()+interval '1 day')",[refreshId,platformId,hashRefresh(refreshSecret)]);
    const rotated=await fetch(`${base}/api/auth/refresh`,{method:'POST',headers:{cookie:`educonnect_refresh=${refreshId}.${refreshSecret}`,'x-forwarded-for':'198.51.100.25'}});assert.equal(rotated.status,200,'refresh endpoint works behind the configured proxy');assert.ok((rotated.headers.get('set-cookie')||'').includes('educonnect_refresh='));assert.ok((await rotated.json() as any).accessToken);
    const replay=await fetch(`${base}/api/auth/refresh`,{method:'POST',headers:{cookie:`educonnect_refresh=${refreshId}.${refreshSecret}`,'x-forwarded-for':'198.51.100.25'}});assert.equal(replay.status,401,'rotated refresh tokens cannot be replayed');
    const plan=(await platformPool.query("SELECT id FROM subscription_plans WHERE billing_interval='trial' LIMIT 1")).rows[0].id;
    const makeSchool=async(name:string)=>{const id=randomUUID();schools.push(id);const row=(await platformPool.query("INSERT INTO schools(id,name,contact_email,status) VALUES($1,$2,$3,'active') RETURNING school_id",[id,name,`${randomUUID()}@example.test`])).rows[0];await platformPool.query("INSERT INTO subscriptions(school_id,plan_id,status) VALUES($1,$2,'trialing')",[id,plan]);return {id,display:row.school_id};};
    const a=await makeSchool('Firebase School A'),b=await makeSchool('Firebase School B');
    const schoolUser=randomUUID();users.push(schoolUser);await platformPool.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[schoolUser,'teacher@example.test','Mapped Teacher','legacy-hash']);
    const memberships=[] as string[];
    for(const school of [a,b])memberships.push((await tenantTransaction(school.id,async client=>{const role=(await client.query("SELECT id FROM school_roles WHERE school_id=$1 AND code='teacher'",[school.id])).rows[0].id;return client.query("INSERT INTO school_memberships(school_id,user_id,role,school_role_id) VALUES($1,$2,'teacher',$3) RETURNING id",[school.id,schoolUser,role]);})).rows[0].id);
    await platformPool.query("INSERT INTO external_identities(user_kind,user_id,provider,provider_subject_id,email) VALUES('platform',$1,'firebase','firebase-platform-uid','admin@example.test'),('school',$2,'firebase','firebase-school-uid','teacher@example.test')",[platformId,schoolUser]);

    const validPlatform=await call('/identity',platformToken);assert.equal(validPlatform.status,200,await validPlatform.clone().text());assert.deepEqual(await validPlatform.json(),{kind:'platform',id:platformId,role:'super_admin'});
    const missingContext=await call('/identity',schoolToken);assert.equal(missingContext.status,409,'multi-school Firebase identity must select a tenant');
    const schoolAIdentity=await call('/identity',schoolToken,a.display);assert.equal(schoolAIdentity.status,200);assert.equal((await schoolAIdentity.json() as any).schoolId,a.id);
    const schoolBIdentity=await call('/identity',schoolToken,b.display);assert.equal(schoolBIdentity.status,200);assert.equal((await schoolBIdentity.json() as any).schoolId,b.id);
    const foreignSchool=await call('/identity',schoolToken,'CS-SCH-NOT-MEMBER');assert.equal(foreignSchool.status,409,'a Firebase UID cannot select a school without a relational membership');
    const unlinked=await call('/identity','a.b.c');assert.equal(unlinked.status,401,'invalid Firebase signatures are rejected');
    const expired=await call('/identity',expiredToken);assert.equal(expired.status,401,'expired Firebase ID tokens are rejected');
    const unknown=await call('/identity',unknownToken);assert.equal(unknown.status,403,'unknown Firebase UIDs are not auto-created or linked');
    await platformPool.query('UPDATE users SET is_active=false WHERE id=$1',[schoolUser]);const inactive=await call('/identity',schoolToken,a.display);assert.equal(inactive.status,403,'deactivated PostgreSQL accounts are denied despite a valid Firebase token');

    const legacy=await signAccess({kind:'platform',id:platformId,role:'super_admin'});const linkedFirebaseToken='linked.payload.sig';setFirebaseTokenVerifierForTest(async token=>{if(token===linkedFirebaseToken)return {uid:'unlinked-platform-uid',email:'admin@example.test',email_verified:true} as any;throw new Error('invalid signature');});
    const link=await call('/api/auth/firebase/link',linkedFirebaseToken,undefined,{method:'POST',headers:{'X-EduConnect-Legacy-Token':legacy}});assert.equal(link.status,201,'identity linking requires the old authenticated account and verified Firebase identity');
  }finally{
    setFirebaseTokenVerifierForTest(null);await new Promise<void>(resolve=>server.close(()=>resolve()));
    if(schools.length){await platformPool.query('DELETE FROM subscriptions WHERE school_id=ANY($1::uuid[])',[schools]);await platformPool.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[schools]);}
    if(users.length){await platformPool.query('DELETE FROM platform_audit_logs WHERE actor_id=ANY($1::uuid[])',[users]);await platformPool.query('DELETE FROM platform_users WHERE id=ANY($1::uuid[])',[users]);await platformPool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);}
    await Promise.all([pool.end(),platformPool.end()]);await socket.stop();await db.close();
  }
});
