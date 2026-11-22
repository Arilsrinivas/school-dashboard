const API = (typeof import.meta.env.VITE_API_URL === 'string' && import.meta.env.VITE_API_URL.trim() !== '')
  ? import.meta.env.VITE_API_URL.trim()
  : (import.meta.env.PROD ? '' : 'http://localhost:4000');
let accessToken:string|null=null;
import { firebaseConfigured, firebaseAuth, firebaseIdToken, firebasePasswordSignIn, firebaseCreatePasswordAccount, firebaseGoogleSignIn, firebaseLogout, firebaseResetPassword, firebaseResendVerification } from './auth/firebase';
let firebaseMode=false;
export function setAccessToken(token:string|null){accessToken=token;if(token)firebaseMode=false;}
export function getAccessToken(){return accessToken;}
function schoolHeaders():Record<string,string>{const school=typeof localStorage!=='undefined'?localStorage.getItem('educonnect_school_context'):null;return school?{'X-EduConnect-School-ID':school}:{};}
async function authHeaders():Promise<Record<string,string>>{const token=firebaseMode?await firebaseIdToken():accessToken;return {...(token?{Authorization:`Bearer ${token}`}:{ }),...schoolHeaders()};}
function headerRecord(input?:HeadersInit):Record<string,string>{const result:Record<string,string>={};new Headers(input).forEach((value,key)=>{result[key]=value;});return result;}
export async function downloadFile(path:string,filename:string){
  const response=await fetch(`${API}${path}`,{credentials:'include',headers:await authHeaders()});
  if(!response.ok){let message=`Export failed (${response.status})`;try{const payload=await response.json();message=payload.error||message;}catch{}throw new Error(message);}
  const blob=await response.blob();
  const url=window.URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
export function exportCsv(filename:string,headers:string[],rows:(string|number|boolean|null|undefined)[][]){
  const escapeCsv=(val:unknown)=>{if(val===null||val===undefined)return '';const str=String(val);if(str.includes(',')||str.includes('"')||str.includes('\n')||str.includes('\r'))return `"${str.replace(/"/g,'""')}"`;return str;};
  const csvContent=[headers.map(escapeCsv).join(','),...rows.map(row=>row.map(escapeCsv).join(','))].join('\r\n');
  const blob=new Blob([csvContent],{type:'text/csv;charset=utf-8;'});
  const url=window.URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
export async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(`${API}${path}`,{...init,credentials:'include',headers:{'Content-Type':'application/json',...await authHeaders(),...headerRecord(init.headers)}});
  if(!response.ok){
    let message=`Request failed (${response.status})`;
    let code = '';
    try{
      const payload=await response.json();
      message=payload.message||payload.error||message;
      code=payload.error||'';
    }catch{}
    const err = new Error(message);
    (err as any).code = code;
    (err as any).status = response.status;
    throw err;
  }
  if(response.status===204)return undefined as T;return response.json() as Promise<T>;
}
export async function login(email:string,password:string,schoolId?:string,kind:'platform'|'school'='school'){
  if(import.meta.env.PROD&&!firebaseConfigured)throw new Error('Firebase Authentication is not configured for this deployment.');
  const endpoint = kind === 'platform' ? '/api/auth/platform/login' : '/api/auth/school/login';
  if(firebaseConfigured){
    let firebaseUser;
    try{firebaseUser=await firebasePasswordSignIn(email,password);}
    catch(error){
      const code=(error as {code?:string}).code;
      if(code!=='auth/user-not-found'&&code!=='auth/invalid-credential'&&code!=='auth/invalid-login-credentials')throw error;
      firebaseMode=false;accessToken=null;
      const legacy=await request<{accessToken:string;user:User}>(endpoint,{method:'POST',body:JSON.stringify({email,password,...(schoolId?{schoolId}:{})})});
      accessToken=legacy.accessToken;
      try{
        await firebaseCreatePasswordAccount(email,password);
        accessToken=null;
        throw new Error('A Firebase account was created. Verify your email, then sign in again to securely link your existing EduConnect account.');
      }catch(createError){if((createError as {code?:string}).code==='auth/email-already-in-use')throw new Error('This email already has a Firebase account. Sign in or reset that Firebase password, then link it to your existing EduConnect account.');throw createError;}
    }
    firebaseMode=true;accessToken=null;
    if(!firebaseUser.emailVerified){await firebaseResendVerification();throw new Error('Verify your email address before continuing. A new verification message was sent.');}
    let context:{user:User;schools:Array<{school_id:string}>};
    try{context=await request('/api/auth/firebase/context');}
    catch(error){
      // Account migration requires proof of the existing password plus this verified Firebase session.
      firebaseMode=false;
      const legacy=await request<{accessToken:string;user:User}>(endpoint,{method:'POST',body:JSON.stringify({email,password,...(schoolId?{schoolId}:{})})});
      accessToken=legacy.accessToken;firebaseMode=true;
      const token=await firebaseIdToken();
      const linked=await fetch(`${API}/api/auth/firebase/link`,{method:'POST',credentials:'include',headers:{Authorization:`Bearer ${token}`,'X-EduConnect-Legacy-Token':legacy.accessToken,'Content-Type':'application/json'}});
      accessToken=null;
      if(!linked.ok){let payload:any={};try{payload=await linked.json();}catch{}throw new Error(payload.error||payload.message||'Could not link this Firebase account to the authenticated EduConnect account.');}
      context=await request('/api/auth/firebase/context');
    }
    const chosen=schoolId?context.schools.find(s=>s.school_id===schoolId):context.schools.find(s=>s.school_id===localStorage.getItem('educonnect_school_context'))??context.schools[0];
    if(kind==='school'&&chosen){localStorage.setItem('educonnect_school_context',chosen.school_id);return await request<User>('/api/auth/me').then(data=>(data as any).user);}
    if(kind==='platform')return await request<{user:User}>('/api/auth/me').then(data=>data.user);
    throw new Error('No active EduConnect school membership is available for this account.');
  }
  const data = await request<{accessToken:string;user:User}>(endpoint, {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(schoolId ? { schoolId } : {}) }),
  });
  setAccessToken(data.accessToken);
  return data.user;
}
export async function registerSchool(params:{schoolName:string;administratorName:string;email:string;password:string;phone?:string;schoolType?:string}){const data=await request<{accessToken:string;user:User & {schoolId:string}}>('/api/auth/register-school',{method:'POST',body:JSON.stringify(params)});setAccessToken(data.accessToken);return data.user;}
export type GoogleAuthResult =
  | { type: 'success'; accessToken: string; user: User & { schoolId?: string } }
  | { type: 'requiresLinking'; email: string; name: string; provider: string; message: string; firebaseCredential?:string }
  | { type: 'requireSchoolSelection'; user: { id: string; name: string; email: string }; schools: Array<{ id: string; schoolId: string; name: string; role: string; schoolRole?: string; schoolRoleName?: string }> };

export async function loginWithGoogle(params: { idToken?: string; credential?: string; schoolId?: string; invitationToken?: string }): Promise<GoogleAuthResult> {
  if(import.meta.env.PROD&&!firebaseConfigured)throw new Error('Firebase Authentication is not configured for this deployment.');
  if(firebaseConfigured){
    const {user:firebaseUser,googleIdToken}=await firebaseGoogleSignIn();if(!firebaseUser.emailVerified)throw new Error('Verify your email address before continuing.');
    firebaseMode=true;accessToken=null;
    let context:{user:User;schools:Array<{school_id:string}>};
    try{context=await request('/api/auth/firebase/context');}
    catch(contextError){
      const authError=contextError as Error & {status?:number};
      if(authError.status!==403||!authError.message.includes('Firebase account is not linked'))throw contextError;
      if(!googleIdToken)throw new Error('This Firebase account has no EduConnect link. Access requires an approved invitation or an existing account.');
      firebaseMode=false;
      let legacy=await request<any>('/api/auth/google',{method:'POST',body:JSON.stringify({idToken:googleIdToken,schoolId:params.schoolId})});
      if(legacy.requiresLinking)return {type:'requiresLinking',email:legacy.email,name:legacy.name,provider:'firebase',message:legacy.message,firebaseCredential:googleIdToken};
      if(legacy.requireSchoolSelection&&legacy.schools?.length){const selected=legacy.schools.find((item:any)=>item.schoolId===params.schoolId)??legacy.schools[0];legacy=await request<any>('/api/auth/google',{method:'POST',body:JSON.stringify({idToken:googleIdToken,schoolId:selected.schoolId})});}
      if(!legacy.accessToken)throw new Error('The verified Google account is not linked to an active EduConnect account. Ask a school administrator for an invitation.');
      accessToken=legacy.accessToken;firebaseMode=true;
      const idToken=await firebaseIdToken();
      const linked=await fetch(`${API}/api/auth/firebase/link`,{method:'POST',credentials:'include',headers:{Authorization:`Bearer ${idToken}`,'X-EduConnect-Legacy-Token':legacy.accessToken,'Content-Type':'application/json'}});
      accessToken=null;if(!linked.ok)throw new Error('Could not securely link this Firebase identity to the existing account.');
      context=await request('/api/auth/firebase/context');
    }
    const chosen=params.schoolId?context.schools.find(s=>s.school_id===params.schoolId):context.schools.find(s=>s.school_id===localStorage.getItem('educonnect_school_context'))??context.schools[0];
    if(chosen)localStorage.setItem('educonnect_school_context',chosen.school_id);
    return {type:'success',accessToken:await firebaseIdToken()||'',user:(await request<{user:User}>('/api/auth/me')).user};
  }
  const data = await request<any>('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify(params),
  });

  if (data.requiresLinking) {
    return {
      type: 'requiresLinking',
      email: data.email,
      name: data.name,
      provider: data.provider,
      message: data.message,
    };
  }

  if (data.requireSchoolSelection) {
    return {
      type: 'requireSchoolSelection',
      user: data.user,
      schools: data.schools,
    };
  }

  if (data.accessToken) {
    setAccessToken(data.accessToken);
    return {
      type: 'success',
      accessToken: data.accessToken,
      user: data.user,
    };
  }

  throw new Error(data.message || 'Authentication failed');
}

export async function linkGoogleAccount(params: { idToken?: string; credential?: string; password?: string; schoolId?: string }): Promise<{ user?: User; message: string }> {
  if(firebaseConfigured){
    if(!firebaseAuth?.currentUser||!params.credential||!params.password)throw new Error('An authenticated Firebase session and the existing EduConnect password are required.');
    firebaseMode=false;
    const legacy=await request<any>('/api/auth/google/link',{method:'POST',body:JSON.stringify({credential:params.credential,password:params.password,schoolId:params.schoolId})});
    if(!legacy.accessToken)throw new Error('Existing EduConnect account could not be verified.');
    firebaseMode=true;const firebaseToken=await firebaseIdToken();
    const linked=await fetch(`${API}/api/auth/firebase/link`,{method:'POST',credentials:'include',headers:{Authorization:`Bearer ${firebaseToken}`,'X-EduConnect-Legacy-Token':legacy.accessToken,'Content-Type':'application/json'}});
    if(!linked.ok)throw new Error('Firebase identity could not be linked to the authenticated EduConnect account.');
    accessToken=null;
    const context=await request<{schools:Array<{school_id:string}>}>('/api/auth/firebase/context');
    const chosen=context.schools.find(s=>s.school_id===params.schoolId)??context.schools.find(s=>s.school_id===localStorage.getItem('educonnect_school_context'))??context.schools[0];
    if(chosen)localStorage.setItem('educonnect_school_context',chosen.school_id);
    return {user:(await request<{user:User}>('/api/auth/me')).user,message:'Account linked securely.'};
  }
  const data = await request<any>('/api/auth/google/link', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (data.accessToken) {
    setAccessToken(data.accessToken);
  }
  return data;
}

export async function selectSchool(schoolId: string): Promise<User> {
  if(firebaseConfigured&&firebaseMode){localStorage.setItem('educonnect_school_context',schoolId);return (await request<{user:User}>('/api/auth/me')).user;}
  const data = await request<{ accessToken: string; user: User }>('/api/auth/select-school', {
    method: 'POST',
    body: JSON.stringify({ schoolId }),
  });
  if (data.accessToken) {
    setAccessToken(data.accessToken);
  }
  return data.user;
}

export async function getLinkedIdentities(): Promise<{ identities: Array<{ provider: string; provider_subject_id: string; email: string; created_at: string; last_authenticated_at: string }>; hasPassword: boolean; canUnlink: boolean }> {
  return request('/api/auth/external-identities');
}

export async function unlinkIdentity(provider: string): Promise<{ success: boolean; message: string }> {
  return request(`/api/auth/external-identities/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });
}
export async function acceptInvitation(token:string,name:string,password:string){const data=await request<{accessToken:string;user:User & {email:string;schoolId:string}}>('/api/auth/accept-invitation',{method:'POST',body:JSON.stringify({token,name,password})});setAccessToken(data.accessToken);if(firebaseConfigured){localStorage.setItem('educonnect_school_context',data.user.schoolId);try{await firebaseCreatePasswordAccount(data.user.email,password);}catch(error){const code=(error as {code?:string}).code;if(code!=='auth/email-already-in-use')throw error;}setAccessToken(null);}return data.user;}
export async function sendFirebasePasswordReset(email:string){await firebaseResetPassword(email);}
export async function uploadStudentDocument(studentId:string,category:string,file:File){
  if(file.size>10*1024*1024)throw new Error('Documents must be 10 MB or smaller.');
  const authorization=await request<{fileId:string}>('/api/school/files/upload-authorizations',{method:'POST',body:JSON.stringify({purpose:'student_document',studentId,category,fileName:file.name,mimeType:file.type,size:file.size})});
  try{await request(`/api/school/files/${authorization.fileId}/content`,{method:'PUT',headers:{'Content-Type':file.type},body:file});return authorization.fileId;}
  catch(error){try{await request(`/api/school/files/${authorization.fileId}/fail`,{method:'POST'});}catch{}throw error;}
}
export async function downloadStudentDocument(fileId:string){const result=await request<{url:string;expiresInSeconds:number}>(`/api/school/files/${fileId}/download-url`);const response=await fetch(result.url);if(!response.ok)throw new Error(`Document download failed (${response.status})`);const blob=await response.blob();const url=window.URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='student-document';document.body.appendChild(anchor);anchor.click();window.URL.revokeObjectURL(url);anchor.remove();}
export async function restoreSession(){if(firebaseConfigured){firebaseMode=true;accessToken=null;if(!firebaseAuth?.currentUser)return false;try{if(!firebaseAuth.currentUser.emailVerified)return false;const context=await request<{schools:Array<{school_id:string}>}>('/api/auth/firebase/context');if(context.schools?.length&&!localStorage.getItem('educonnect_school_context'))localStorage.setItem('educonnect_school_context',context.schools[0]!.school_id);await request('/api/auth/me');return true;}catch{return false;}}try{const data=await request<{accessToken:string}>('/api/auth/refresh',{method:'POST'});setAccessToken(data.accessToken);return true;}catch{return false;}}
export async function logout(){try{if(firebaseConfigured&&firebaseMode){const token=await firebaseIdToken();if(token)await fetch(`${API}/api/auth/firebase/logout`,{method:'POST',credentials:'include',headers:{Authorization:`Bearer ${token}`}});await firebaseLogout();}else await request('/api/auth/logout',{method:'POST'});}finally{accessToken=null;firebaseMode=false;}}
export type User={id:string;name:string;role:string;schoolRole?:string;schoolRoleName?:string;permissions?:string[];schoolId?:string};
export type School={id:string;school_id:string;name:string;contact_email:string;contact_phone:string;principal_name:string;status:'pending'|'active'|'suspended'|'expired'|'deactivated';created_at:string;plan_name:string|null;expires_at:string|null};
