import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Upload, X } from 'lucide-react';
import { downloadStudentDocument, request, uploadStudentDocument } from './api';

type DocumentItem={id:string;display_name:string|null;mime_type:string;byte_size:number|string;category:string;created_at:string};
export default function StudentDocuments({studentId,studentName}:{studentId:string;studentName:string}){
  const [open,setOpen]=useState(false),[error,setError]=useState('');const qc=useQueryClient();
  const files=useQuery({queryKey:['student-documents',studentId],queryFn:()=>request<{items:DocumentItem[]}>(`/api/school/students/${studentId}/documents`),enabled:open});
  const upload=useMutation({mutationFn:(file:File)=>uploadStudentDocument(studentId,'student_document',file),onSuccess:()=>{setError('');void qc.invalidateQueries({queryKey:['student-documents',studentId]});}});
  return <>
    <button className="btn btn-secondary small-btn" onClick={()=>{setError('');setOpen(true);}}><FileText size={14}/> Documents</button>
    {open&&<div className="modal-backdrop" onClick={event=>{if(event.target===event.currentTarget)setOpen(false);}}><section className="modal school-modal" role="dialog" aria-modal="true" aria-label={`${studentName} documents`}>
      <div className="modal-head"><div><div className="eyebrow">PRIVATE STUDENT RECORDS</div><h2>{studentName}</h2><p>Files are school-scoped and downloads expire after two minutes.</p></div><button className="icon-button" onClick={()=>setOpen(false)}><X size={19}/></button></div>
      <div className="panel-head"><strong>Documents</strong><label className="btn btn-primary small-btn"><Upload size={14}/>{upload.isPending?'Uploading…':'Upload file'}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,text/plain" disabled={upload.isPending} hidden onChange={event=>{const file=event.target.files?.[0];if(file)upload.mutate(file);event.target.value='';}}/></label></div>
      {error&&<div className="error-inline">{error}</div>}{upload.isError&&<div className="error-inline">{(upload.error as Error).message}</div>}
      {files.isLoading?<div className="table-loading"><div className="table-skeleton"/></div>:files.isError?<div className="error-inline">{(files.error as Error).message}</div>:files.data?.items.length?<div className="access-member-list">{files.data.items.map(item=><div className="access-member" key={item.id}><div><strong>{item.display_name||item.category}</strong><small>{item.category} · {Math.ceil(Number(item.byte_size)/1024)} KB · {new Date(item.created_at).toLocaleDateString()}</small></div><button className="btn btn-secondary small-btn" onClick={()=>void downloadStudentDocument(item.id)}><Download size={14}/> Download</button></div>)}</div>:<div className="empty-state"><div className="empty-icon"><FileText size={18}/></div><strong>No private documents</strong><span>Upload an approved PDF, photo, or text file.</span></div>}
      <div className="modal-actions"><span>Maximum file size: 10 MB</span><button className="btn btn-secondary" onClick={()=>setOpen(false)}>Close</button></div>
    </section></div>}
  </>;
}
