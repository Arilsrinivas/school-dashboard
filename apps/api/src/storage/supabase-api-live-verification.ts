import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';

process.env.AUTH_PROVIDER='legacy';
if(process.env.EDUCONNECT_STORAGE_API_LIVE_TEST!=='1')throw new Error('Set EDUCONNECT_STORAGE_API_LIVE_TEST=1 to run the live API verification');

const PROJECT_REF='jnhcomdjezlvmxpjkoot';
const schools:string[]=[],users:string[]=[],objects:Array<{bucket:string;path:string}>=[];
let stage='initialization',server:ReturnType<express.Application['listen']>|undefined;
let cleanup:(()=>Promise<void>)|undefined;

async function main(){
  const [{env},{assertEduConnectDatabaseTarget},{pool,platformPool,tenantTransaction},{signAccess},{storageRouter},{storageClient}]=await Promise.all([
    import('../config.js'),import('../db/target-identity.js'),import('../db/pool.js'),import('../auth/tokens.js'),import('./routes.js'),import('./supabase.js')
  ]);
  cleanup=async()=>{
    if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
    for(const object of objects){try{await storageClient().storage.from(object.bucket).remove([object.path]);}catch{}}
    if(schools.length){await platformPool.query('DELETE FROM subscriptions WHERE school_id=ANY($1::uuid[])',[schools]);await platformPool.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[schools]);}
    if(users.length)await platformPool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
    await Promise.all([pool.end(),platformPool.end()]);
    console.log('PASS disposable verification tenants, users, metadata, and objects cleaned up');
  };
  assert.equal(env.SUPABASE_URL,`https://${PROJECT_REF}.supabase.co`,'Storage URL must be the dedicated EduConnect project');
  assert.ok(env.SUPABASE_SERVICE_ROLE_KEY,'The server-only Storage key is required');
  assertEduConnectDatabaseTarget(env.DATABASE_URL,env.PLATFORM_DATABASE_URL,PROJECT_REF);
  for(const [dbPool,expectedRole] of [[pool,'educonnect_app'],[platformPool,'educonnect_platform']] as const){
    const identity=await dbPool.query<{database:string;role:string;privileged:boolean}>(`SELECT current_database() AS database,current_user AS role,(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS privileged`);
    assert.equal(identity.rows[0]?.database,'postgres','Database name must match the verified EduConnect project');
    assert.equal(identity.rows[0]?.role,expectedRole,'Live verification must use the least-privilege runtime role');
    assert.equal(identity.rows[0]?.privileged,false,'Runtime role must not be superuser or BYPASSRLS');
  }
  const storagePolicies=await platformPool.query<{roles:string[];cmd:string}>(`SELECT roles,cmd FROM pg_policies WHERE schemaname='storage' AND tablename='objects'`);
  assert.equal(storagePolicies.rows.some(policy=>policy.roles.some(role=>['public','anon','authenticated'].includes(role.toLowerCase()))),false,'storage.objects must not grant direct client role access');
  console.log('PASS storage.objects has no policies granting public, anon, or authenticated access');
  const commonMime=['application/pdf','image/jpeg','image/png','image/webp','text/plain'];
  const buckets=[
    {name:'student-documents',mime:commonMime},
    {name:'profile-images',mime:['image/jpeg','image/png','image/webp']},
    {name:'assignments',mime:commonMime},
    {name:'school-documents',mime:commonMime}
  ];
  for(const bucket of buckets){const result=await storageClient().storage.getBucket(bucket.name);assert.equal(result.error,null,`private bucket ${bucket.name} exists`);assert.equal(result.data.public,false,`bucket ${bucket.name} is private`);assert.equal(Number(result.data.file_size_limit),10*1024*1024,`bucket ${bucket.name} has a 10 MiB limit`);assert.deepEqual([...(result.data.allowed_mime_types??[])].sort(),[...bucket.mime].sort(),`bucket ${bucket.name} has its expected MIME allowlist`);}
  console.log('PASS all four buckets have verified private, size, and MIME policies');
  const trialId=(await platformPool.query<{id:string}>(`SELECT id FROM subscription_plans WHERE billing_interval='trial' LIMIT 1`)).rows[0]?.id;if(!trialId)throw new Error('Trial subscription plan is unavailable');

  async function makeSchool(label:string){
    const school=(await platformPool.query<{id:string;school_id:string}>(`INSERT INTO schools(name,contact_email,status) VALUES($1,$2,'active') RETURNING id,school_id`,[`EduConnect Storage Verification ${label} ${randomUUID()}`,`${randomUUID()}@test.invalid`])).rows[0]!;schools.push(school.id);
    await platformPool.query(`INSERT INTO subscriptions(school_id,plan_id,status) VALUES($1,$2,'trialing')`,[school.id,trialId]);
    const userId=randomUUID();users.push(userId);
    await platformPool.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'verification-only')`,[userId,`${randomUUID()}@test.invalid`,`Storage Verification ${label}`]);
    const membership=await tenantTransaction(school.id,async client=>{
      const role=(await client.query<{id:string}>('SELECT id FROM school_roles WHERE school_id=$1 AND code=\'school_administrator\'',[school.id])).rows[0];assert.ok(role,'School administrator role was provisioned');
      return (await client.query<{id:string}>(`INSERT INTO school_memberships(school_id,user_id,role,school_role_id) VALUES($1,$2,'school_admin',$3) RETURNING id`,[school.id,userId,role.id])).rows[0]!;
    });
    return {school,userId,membershipId:membership.id,token:await signAccess({kind:'school',id:userId,role:'school_admin',schoolId:school.id})};
  }

  stage='create disposable test tenants';
  const [schoolA,schoolB]=await Promise.all([makeSchool('A'),makeSchool('B')]);
  const studentId=randomUUID();
  await tenantTransaction(schoolA.school.id,client=>client.query(`INSERT INTO students(id,school_id,admission_number,first_name,last_name) VALUES($1,$2,$3,'Storage','Verification')`,[studentId,schoolA.school.id,`STOR-${randomUUID()}`]));

  const app=express();app.use(express.json());app.use('/api/school',storageRouter);app.use((error:any,_req:any,res:any,_next:any)=>res.status(error?.status??500).json({error:error?.status&&error?.message?error.message:'Request failed'}));
  server=app.listen(0);await new Promise<void>(resolve=>server!.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
  const request=(path:string,token:string|undefined,init:RequestInit={})=>fetch(`${base}${path}`,{...init,signal:AbortSignal.timeout(30_000),headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(init.headers??{})}});
  const pdf=Buffer.from('%PDF-1.4\nEduConnect live API storage verification\n%%EOF\n');

  stage='reject unauthenticated access';
  const unauth=await request('/api/school/files/upload-authorizations',undefined,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:'student_document',studentId,fileName:'proof.pdf',mimeType:'application/pdf',size:pdf.length})});assert.equal(unauth.status,401);
  stage='reject cross-school upload';
  const foreignUpload=await request('/api/school/files/upload-authorizations',schoolB.token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:'student_document',studentId,fileName:'foreign.pdf',mimeType:'application/pdf',size:pdf.length})});assert.ok(foreignUpload.status===403||foreignUpload.status===404,'School B cannot authorize an upload for a School A student');
  const noForeignMetadata=await tenantTransaction(schoolB.school.id,client=>client.query(`SELECT 1 FROM uploaded_files WHERE school_id=$1 AND display_name='foreign.pdf'`,[schoolB.school.id]));assert.equal(noForeignMetadata.rowCount,0,'Unauthorized upload created no School B metadata');
  console.log('PASS live API authentication and cross-school upload denial');

  stage='authorize upload and verify PostgreSQL metadata';
  const authorization=await request('/api/school/files/upload-authorizations',schoolA.token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:'student_document',studentId,schoolId:schoolB.school.id,category:'verification',fileName:'proof.pdf',mimeType:'application/pdf',size:pdf.length})});assert.equal(authorization.status,201);const {fileId}=await authorization.json() as {fileId:string};
  const metadata=(await tenantTransaction(schoolA.school.id,client=>client.query<{object_key:string;mime_type:string;byte_size:number;display_name:string;upload_status:string;student_id:string}>('SELECT uf.object_key,uf.mime_type,uf.byte_size,uf.display_name,uf.upload_status,sd.student_id FROM uploaded_files uf JOIN student_documents sd ON sd.school_id=uf.school_id AND sd.uploaded_file_id=uf.id WHERE uf.school_id=$1 AND uf.id=$2',[schoolA.school.id,fileId]))).rows[0];assert.ok(metadata);const location=metadata.object_key.split(':');objects.push({bucket:location[0]!,path:location.slice(1).join(':')});assert.match(metadata.object_key,new RegExp(`^student-documents:schools/${schoolA.school.id}/`),'Client-supplied school ID cannot override the authenticated tenant');assert.equal(metadata.mime_type,'application/pdf');assert.equal(Number(metadata.byte_size),pdf.length);assert.equal(metadata.display_name,'proof.pdf');assert.equal(metadata.upload_status,'pending_upload');assert.equal(metadata.student_id,studentId);
  console.log('PASS live PostgreSQL metadata is tenant scoped and ignores supplied school ID');

  stage='upload through the authorized API';
  const uploaded=await request(`/api/school/files/${fileId}/content`,schoolA.token,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:pdf});assert.equal(uploaded.status,200);
  const ready=(await tenantTransaction(schoolA.school.id,client=>client.query<{upload_status:string;byte_size:number}>('SELECT upload_status,byte_size FROM uploaded_files WHERE school_id=$1 AND id=$2',[schoolA.school.id,fileId]))).rows[0];assert.equal(ready?.upload_status,'ready');assert.equal(Number(ready?.byte_size),pdf.length);
  console.log('PASS real API upload reached the private Supabase bucket');

  stage='deny cross-school read and delete';
  const foreignRead=await request(`/api/school/files/${fileId}/download-url`,schoolB.token);assert.equal(foreignRead.status,404,'School B cannot obtain a signed URL for School A content');
  const foreignDelete=await request(`/api/school/files/${fileId}`,schoolB.token,{method:'DELETE'});assert.equal(foreignDelete.status,404,'School B cannot delete School A content');
  console.log('PASS live API cross-school signed URL and deletion denial');

  stage='issue and fetch authorized signed download';
  const signedResponse=await request(`/api/school/files/${fileId}/download-url`,schoolA.token);assert.equal(signedResponse.status,200);const signed=await signedResponse.json() as {url:string;expiresInSeconds:number};assert.equal(signed.expiresInSeconds,120);assert.ok(new URL(signed.url).hostname.endsWith('supabase.co'),'Signed download is served by the private Supabase project');const content=await fetch(signed.url);assert.equal(content.status,200);assert.deepEqual(Buffer.from(await content.arrayBuffer()),pdf);
  console.log('PASS live API signed download returns original bytes');

  stage='authorized delete request';
  const removed=await request(`/api/school/files/${fileId}`,schoolA.token,{method:'DELETE'});stage='authorized delete response';assert.equal(removed.status,204);
  stage='verify PostgreSQL deletion';const afterDelete=await tenantTransaction(schoolA.school.id,client=>client.query('SELECT 1 FROM uploaded_files WHERE school_id=$1 AND id=$2',[schoolA.school.id,fileId]));assert.equal(afterDelete.rowCount,0);
  stage='verify Supabase object deletion';const objectAfterDelete=await storageClient().storage.from(objects[0]!.bucket).download(objects[0]!.path);assert.ok(objectAfterDelete.error,'Authorized delete removed the private object');
  console.log('PASS live EduConnect API authorization, PostgreSQL metadata, upload, signed download, School A/B denial, and deletion');

}

try{await main();}catch{console.error(`FAIL live EduConnect API storage verification at ${stage}; row data, provider payloads, and credentials were suppressed.`);process.exitCode=1;}finally{if(cleanup)await cleanup();}
