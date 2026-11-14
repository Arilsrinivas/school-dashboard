const API = (typeof import.meta.env.VITE_API_URL === 'string' && import.meta.env.VITE_API_URL.trim() !== '')
  ? import.meta.env.VITE_API_URL.trim()
  : (import.meta.env.PROD ? '' : 'http://localhost:4000');
let accessToken:string|null=null;
export function setAccessToken(token:string|null){accessToken=token;}
export function getAccessToken(){return accessToken;}
export async function downloadFile(path:string,filename:string){
  const response=await fetch(`${API}${path}`,{credentials:'include',headers:{...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})}});
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
  const response=await fetch(`${API}${path}`,{...init,credentials:'include',headers:{'Content-Type':'application/json',...(accessToken?{Authorization:`Bearer ${accessToken}`}:{}) ,...init.headers}});
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
    throw err;
  }
  if(response.status===204)return undefined as T;return response.json() as Promise<T>;
}
export async function login(email:string,password:string,schoolId?:string,kind:'platform'|'school'='school'){
  const endpoint = kind === 'platform' ? '/api/auth/platform/login' : '/api/auth/school/login';
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
  | { type: 'requiresLinking'; email: string; name: string; provider: string; message: string }
  | { type: 'requireSchoolSelection'; user: { id: string; name: string; email: string }; schools: Array<{ id: string; schoolId: string; name: string; role: string; schoolRole?: string; schoolRoleName?: string }> };

export async function loginWithGoogle(params: { idToken?: string; credential?: string; schoolId?: string; invitationToken?: string }): Promise<GoogleAuthResult> {
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
export async function acceptInvitation(token:string,name:string,password:string){const data=await request<{accessToken:string;user:User & {schoolId:string}}>('/api/auth/accept-invitation',{method:'POST',body:JSON.stringify({token,name,password})});setAccessToken(data.accessToken);return data.user;}
export async function restoreSession(){try{const data=await request<{accessToken:string}>('/api/auth/refresh',{method:'POST'});setAccessToken(data.accessToken);return true;}catch{return false;}}
export async function logout(){try{await request('/api/auth/logout',{method:'POST'});}finally{setAccessToken(null);}}
export type User={id:string;name:string;role:string;schoolRole?:string;schoolRoleName?:string;permissions?:string[];schoolId?:string};
export type School={id:string;school_id:string;name:string;contact_email:string;contact_phone:string;principal_name:string;status:'pending'|'active'|'suspended'|'expired'|'deactivated';created_at:string;plan_name:string|null;expires_at:string|null};
