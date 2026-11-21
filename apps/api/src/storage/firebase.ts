import { getStorage } from 'firebase-admin/storage';
import { initializeFirebaseAdmin } from '../auth/firebase-admin.js';
import { env } from '../config.js';

let testClient:any=null;
export function setStorageClientForTest(value:any){if(process.env.NODE_ENV!=='test')throw new Error('Storage client injection is test-only');testClient=value;}
export function storageClient():any {
  if(process.env.NODE_ENV==='test'&&testClient)return testClient;
  if(!env.FIREBASE_STORAGE_BUCKET)throw new Error('Firebase Cloud Storage is not configured');
  const bucket=getStorage(initializeFirebaseAdmin().app).bucket(env.FIREBASE_STORAGE_BUCKET);
  return {storage:{
    getBucket:async(name:string)=>{if(name!==env.FIREBASE_STORAGE_BUCKET)return {data:null,error:new Error('Unexpected bucket')};const [exists]=await bucket.exists();if(!exists)return {data:null,error:new Error('Bucket does not exist')};const [policy]=await bucket.iam.getPolicy();const publicAccess=policy.bindings?.some(binding=>(binding.members||[]).some((member:string)=>member==='allUsers'||member==='allAuthenticatedUsers'))??false;return {data:{public:publicAccess},error:null};},
    from:()=>({
      upload:async(path:string,bytes:Buffer,options:{contentType:string;upsert:boolean})=>{const file=bucket.file(path);await file.save(bytes,{resumable:false,validation:'md5',metadata:{contentType:options.contentType,cacheControl:'private, max-age=0, no-store'}});return {data:{path},error:null};},
      remove:async(paths:string[])=>{await Promise.all(paths.map(path=>bucket.file(path).delete({ignoreNotFound:true})));return {data:[],error:null};},
      createSignedUrl:async(path:string,seconds:number,options:any)=>{const [signedUrl]=await bucket.file(path).getSignedUrl({version:'v4',action:'read',expires:Date.now()+seconds*1000,responseDisposition:typeof options?.download==='string'?`attachment; filename="${String(options.download).replace(/["\\\r\n]/g,'_')}"`:undefined});return {data:{signedUrl},error:null};}
    })
  }};
}
export const privateBucket=()=>env.FIREBASE_STORAGE_BUCKET??'';
