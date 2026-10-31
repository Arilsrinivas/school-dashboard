const API=(import.meta.env.VITE_API_URL as string|undefined)||'http://localhost:4000';
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
  if(!response.ok){let message=`Request failed (${response.status})`;try{const payload=await response.json();message=payload.error||message;}catch{}throw new Error(message);}
  if(response.status===204)return undefined as T;return response.json() as Promise<T>;
}
export async function login(email:string,password:string,schoolId?:string){const data=await request<{accessToken:string;user:User}>(schoolId?'/api/auth/school/login':'/api/auth/platform/login',{method:'POST',body:JSON.stringify({email,password,...(schoolId?{schoolId}:{})})});setAccessToken(data.accessToken);return data.user;}
export async function acceptInvitation(token:string,name:string,password:string){const data=await request<{accessToken:string;user:User & {schoolId:string}}>('/api/auth/accept-invitation',{method:'POST',body:JSON.stringify({token,name,password})});setAccessToken(data.accessToken);return data.user;}
export async function restoreSession(){try{const data=await request<{accessToken:string}>('/api/auth/refresh',{method:'POST'});setAccessToken(data.accessToken);return true;}catch{return false;}}
export async function logout(){try{await request('/api/auth/logout',{method:'POST'});}finally{setAccessToken(null);}}
export type User={id:string;name:string;role:string;schoolRole?:string;schoolRoleName?:string;permissions?:string[];schoolId?:string};
export type School={id:string;school_id:string;name:string;contact_email:string;contact_phone:string;principal_name:string;status:'pending'|'active'|'suspended'|'expired'|'deactivated';created_at:string;plan_name:string|null;expires_at:string|null};
