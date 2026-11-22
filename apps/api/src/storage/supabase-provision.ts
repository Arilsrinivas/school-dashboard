import {createClient} from '@supabase/supabase-js';
import {env} from '../config.js';

const EXPECTED_URL='https://jnhcomdjezlvmxpjkoot.supabase.co';
const MAX_FILE_BYTES=10*1024*1024;
const common=['application/pdf','image/jpeg','image/png','image/webp','text/plain'];
const buckets=[
  {name:env.SUPABASE_STUDENT_DOCUMENTS_BUCKET,mimeTypes:common},
  {name:env.SUPABASE_PROFILE_IMAGES_BUCKET,mimeTypes:['image/jpeg','image/png','image/webp']},
  {name:env.SUPABASE_ASSIGNMENTS_BUCKET,mimeTypes:common},
  {name:env.SUPABASE_SCHOOL_DOCUMENTS_BUCKET,mimeTypes:common}
];
if(!env.SUPABASE_URL||env.SUPABASE_URL.replace(/\/$/,'')!==EXPECTED_URL)throw new Error('Supabase Storage provisioning is restricted to the verified EduConnect project URL');
if(!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required; set it only in the ignored API environment');
if(new Set(buckets.map(bucket=>bucket.name)).size!==buckets.length)throw new Error('Supabase Storage bucket names must be distinct');
const supabase=createClient(EXPECTED_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});

for(const bucket of buckets){
  const existing=await supabase.storage.getBucket(bucket.name);
  if(existing.error){
    if(existing.error.statusCode!=='404'&&!/not found/i.test(existing.error.message??''))throw new Error(`Could not verify Supabase bucket ${bucket.name}; refusing to create it after an unexpected provider error`);
    const created=await supabase.storage.createBucket(bucket.name,{public:false,fileSizeLimit:MAX_FILE_BYTES,allowedMimeTypes:bucket.mimeTypes});
    if(created.error)throw new Error(`Could not create private bucket ${bucket.name}`);
    console.info(`Created private bucket: ${bucket.name}`);
    continue;
  }
  if(existing.data.public)throw new Error(`Refusing to use public Supabase bucket ${bucket.name}`);
  const updated=await supabase.storage.updateBucket(bucket.name,{public:false,fileSizeLimit:MAX_FILE_BYTES,allowedMimeTypes:bucket.mimeTypes});
  if(updated.error)throw new Error(`Could not validate private bucket settings for ${bucket.name}`);
  console.info(`Verified private bucket: ${bucket.name}`);
}
