import { createClient } from '@supabase/supabase-js';
import { env } from '../config.js';

let testClient:any=null;
export function setStorageClientForTest(value:any){if(process.env.NODE_ENV!=='test')throw new Error('Storage client injection is test-only');testClient=value;}

export function storageClient():any {
  if(process.env.NODE_ENV==='test'&&testClient)return testClient;
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Supabase Storage is not configured');
  const client=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
  return {storage:{
    getBucket:async(name:string)=>client.storage.getBucket(name),
    from:(bucket:string)=>({
      upload:async(path:string,bytes:Buffer,options:{contentType:string;upsert:boolean})=>client.storage.from(bucket).upload(path,bytes,{contentType:options.contentType,upsert:options.upsert,cacheControl:'0'}),
      remove:async(paths:string[])=>client.storage.from(bucket).remove(paths),
      createSignedUrl:async(path:string,seconds:number,options:any)=>client.storage.from(bucket).createSignedUrl(path,seconds,{download:options?.download??true})
    })
  }};
}

export function bucketForPurpose(purpose:'student_document'|'student_certificate'|'student_profile_photo'|'assignment_attachment'|'school_document'){
  if(purpose==='student_document'||purpose==='student_certificate')return env.SUPABASE_STUDENT_DOCUMENTS_BUCKET;
  if(purpose==='student_profile_photo')return env.SUPABASE_PROFILE_IMAGES_BUCKET;
  if(purpose==='assignment_attachment')return env.SUPABASE_ASSIGNMENTS_BUCKET;
  return env.SUPABASE_SCHOOL_DOCUMENTS_BUCKET;
}

export function parseObjectKey(value:string){
  const separator=value.indexOf(':');
  if(separator>0)return {bucket:value.slice(0,separator),path:value.slice(separator+1)};
  // Preserve compatibility with pre-bucket-prefix student document metadata.
  return {bucket:env.SUPABASE_STUDENT_DOCUMENTS_BUCKET,path:value};
}

export function storageObjectKey(bucket:string,path:string){return `${bucket}:${path}`;}
