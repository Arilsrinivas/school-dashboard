import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config.js';

let client:SupabaseClient|null=null;
let testClient:SupabaseClient|null=null;
export function setStorageClientForTest(value:SupabaseClient|null){if(process.env.NODE_ENV!=='test')throw new Error('Storage client injection is test-only');testClient=value;}
export function storageClient():SupabaseClient{
  if(process.env.NODE_ENV==='test'&&testClient)return testClient;
  if(env.SUPABASE_STORAGE_ENABLED!=='true')throw new Error('Private document storage is not configured');
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to enable private document storage');
  client??=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return client;
}
export const privateBucket=()=>env.SUPABASE_STORAGE_BUCKET;
