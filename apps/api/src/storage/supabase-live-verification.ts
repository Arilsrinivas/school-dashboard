import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {env} from '../config.js';

const PROJECT_URL='https://jnhcomdjezlvmxpjkoot.supabase.co';
if(process.env.SUPABASE_STORAGE_LIVE_TEST!=='1')throw new Error('Set SUPABASE_STORAGE_LIVE_TEST=1 to run live Supabase Storage checks');
if(env.SUPABASE_URL?.replace(/\/$/,'')!==PROJECT_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Live checks require the server-only key and exact EduConnect Supabase project URL');
const supabase=createClient(PROJECT_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
const buckets=[env.SUPABASE_STUDENT_DOCUMENTS_BUCKET,env.SUPABASE_PROFILE_IMAGES_BUCKET,env.SUPABASE_ASSIGNMENTS_BUCKET,env.SUPABASE_SCHOOL_DOCUMENTS_BUCKET];
const schoolA=randomUUID(),schoolB=randomUUID(),runId=randomUUID();
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const testObjects=buckets.map((bucket,index)=>({bucket,path:`schools/${index===1?schoolB:schoolA}/storage-check/${runId}.${index===1?'png':'txt'}`,bytes:index===1?png:Buffer.from(`EduConnect storage check ${runId}`),mime:index===1?'image/png':'text/plain'}));
let activeStage='initialization';

async function main(){
  activeStage='bucket verification';
  for(const name of buckets){const result=await supabase.storage.getBucket(name);assert.equal(result.error,null,`bucket ${name} should exist`);assert.equal(result.data.public,false,`bucket ${name} must be private`);}
  console.log('PASS all four EduConnect Supabase buckets exist and are private');
  for(const item of testObjects){
    activeStage=`upload ${item.bucket}`;
    const uploaded=await supabase.storage.from(item.bucket).upload(item.path,item.bytes,{contentType:item.mime,upsert:false,cacheControl:'0'});assert.equal(uploaded.error,null,`upload to ${item.bucket} should succeed`);
    activeStage=`signed download ${item.bucket}`;
    const signed=await supabase.storage.from(item.bucket).createSignedUrl(item.path,120,{download:true});assert.equal(signed.error,null,'authorized signed URL should be issued');assert.ok(signed.data.signedUrl);
    activeStage=`download bytes ${item.bucket}`;const response=await fetch(signed.data.signedUrl);assert.equal(response.status,200,'signed download should succeed');assert.deepEqual(Buffer.from(await response.arrayBuffer()),item.bytes);
    activeStage=`unsigned access denial ${item.bucket}`;
    const direct=await fetch(`${PROJECT_URL}/storage/v1/object/${encodeURIComponent(item.bucket)}/${item.path.split('/').map(encodeURIComponent).join('/')}`);assert.ok([400,401,403,404].includes(direct.status),'unsigned object request should be rejected');
    activeStage=`delete ${item.bucket}`;
    const deleted=await supabase.storage.from(item.bucket).remove([item.path]);assert.equal(deleted.error,null,'object deletion should succeed');
    activeStage=`verify deletion ${item.bucket}`;
    const verify=await supabase.storage.from(item.bucket).download(item.path);assert.ok(verify.error,'deleted object should no longer be readable');
    activeStage='next bucket';
  }
  console.log('PASS real Supabase upload, 120-second signed download, unsigned denial, and deletion for all buckets');
  console.log('PASS objects under randomized school-scoped paths reject unsigned direct access');
}
try{await main();}catch{console.error(`FAIL Supabase Storage live verification at ${activeStage}; provider details and credentials were suppressed.`);process.exitCode=1;}finally{await Promise.all(testObjects.map(item=>supabase.storage.from(item.bucket).remove([item.path]).catch(()=>undefined)));}
