import express,{ Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fileTypeFromBuffer } from 'file-type';
import { asyncRoute, fail } from '../http.js';
import { authenticate, requireSchoolPermission } from '../middleware/auth.js';
import { tenantTransaction } from '../db/pool.js';
import { privateBucket, storageClient } from './firebase.js';

export const storageRouter=Router();
const MAX_FILE_BYTES=10*1024*1024;
const MIME_TYPES:Record<string,string>={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp','text/plain':'txt'};
const studentAccess=requireSchoolPermission('students:manage','students:admit','students:read:linked','students:read:self','students:read:assigned');

async function requireStudentAccess(req:import('express').Request,client:import('../db/pool.js').DbClient,studentId:string,manageOnly=false){
  const userId=req.identity!.id;const permissions=req.permissions??[];
  if(permissions.includes('students:manage')||permissions.includes('students:admit'))return;
  if(manageOnly)fail(403,'Document management permission is required');
  const access=await client.query(`SELECT 1 FROM students st
    WHERE st.school_id=$1 AND st.id=$2 AND (
      (st.user_id=$3 AND $4::boolean) OR
      EXISTS(SELECT 1 FROM parents p JOIN student_parents sp ON sp.school_id=p.school_id AND sp.parent_id=p.id WHERE p.school_id=st.school_id AND p.user_id=$3 AND sp.student_id=st.id AND $5::boolean) OR
      EXISTS(SELECT 1 FROM student_enrollments se JOIN teacher_assignments ta ON ta.school_id=se.school_id AND (ta.section_id IS NULL OR ta.section_id=se.section_id) JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id AND cs.class_id=se.class_id JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id WHERE se.school_id=st.school_id AND se.student_id=st.id AND se.status='active' AND t.user_id=$3 AND $6::boolean)
    )`,[req.tenant!.id,studentId,userId,permissions.includes('students:read:self')||permissions.includes('students:manage'),permissions.includes('students:read:linked'),permissions.includes('students:read:assigned')]);
  if(!access.rowCount)fail(403,'You are not authorized to access this student document');
}

async function requireStorage(){let client;try{client=storageClient();}catch{fail(503,'Private document storage is not configured');}const bucket=await client.storage.getBucket(privateBucket());if(bucket.error||!bucket.data||bucket.data.public)fail(503,'Configured document bucket must exist and be private');return client;}

storageRouter.get('/students/:studentId/documents',authenticate,studentAccess,asyncRoute(async(req,res)=>{
  const studentId=z.uuid().parse(req.params.studentId);const items=await tenantTransaction(req.tenant!.id,async client=>{
    await requireStudentAccess(req,client,studentId);
    const rows=await client.query(`SELECT uf.id,uf.display_name,uf.mime_type,uf.byte_size,sd.category,uf.created_at FROM student_documents sd JOIN uploaded_files uf ON uf.school_id=sd.school_id AND uf.id=sd.uploaded_file_id WHERE sd.school_id=$1 AND sd.student_id=$2 AND uf.upload_status='ready' ORDER BY uf.created_at DESC`,[req.tenant!.id,studentId]);return rows.rows;
  });res.json({items});
}));

storageRouter.post('/documents/upload-authorizations',authenticate,studentAccess,asyncRoute(async(req,res)=>{
  await requireStorage();
  const input=z.object({studentId:z.uuid(),category:z.string().trim().min(2).max(60),fileName:z.string().trim().min(1).max(180).refine(v=>!/[\\/\0]/.test(v),'Invalid file name'),mimeType:z.string().refine(v=>Object.hasOwn(MIME_TYPES,v),'Unsupported file type'),size:z.number().int().positive().max(MAX_FILE_BYTES)}).parse(req.body);
  const fileId=randomUUID();const key=`schools/${req.tenant!.id}/students/${input.studentId}/documents/${fileId}.${MIME_TYPES[input.mimeType]}`;
  const created=await tenantTransaction(req.tenant!.id,async client=>{
    await requireStudentAccess(req,client,input.studentId);
    const membership=await client.query('SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active',[req.tenant!.id,req.identity!.id]);
    if(!membership.rows[0])fail(403,'Active school membership is required');
    await client.query(`INSERT INTO uploaded_files(id,school_id,uploaded_by,object_key,mime_type,byte_size,display_name,upload_status) VALUES($1,$2,$3,$4,$5,$6,$7,'pending_upload')`,[fileId,req.tenant!.id,membership.rows[0].id,key,input.mimeType,input.size,input.fileName]);
    await client.query('INSERT INTO student_documents(school_id,student_id,uploaded_file_id,category) VALUES($1,$2,$3,$4)',[req.tenant!.id,input.studentId,fileId,input.category]);
    await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'document.upload_authorized','student_document',$3,$4::jsonb)`,[req.tenant!.id,membership.rows[0].id,fileId,JSON.stringify({studentId:input.studentId,category:input.category,mimeType:input.mimeType,bytes:input.size})]);
    return {id:fileId};
  });
  res.status(201).json({fileId:created.id,uploadUrl:`/api/school/documents/${created.id}/content`,maxBytes:MAX_FILE_BYTES});
}));

storageRouter.put('/documents/:fileId/content',authenticate,studentAccess,express.raw({type:Object.keys(MIME_TYPES),limit:MAX_FILE_BYTES}),asyncRoute(async(req,res)=>{
  const fileId=z.uuid().parse(req.params.fileId);const bytes=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0);const mimeType=req.header('content-type')?.split(';')[0]?.trim()??'';
  if(!Object.hasOwn(MIME_TYPES,mimeType)||!bytes.length||bytes.length>MAX_FILE_BYTES)fail(400,'Unsupported or oversized file');
  const record=await tenantTransaction(req.tenant!.id,async client=>{
    const row=await client.query(`SELECT uf.*,sd.student_id,sm.id AS membership_id FROM uploaded_files uf JOIN student_documents sd ON sd.school_id=uf.school_id AND sd.uploaded_file_id=uf.id JOIN school_memberships sm ON sm.school_id=uf.school_id AND sm.user_id=$3 AND sm.is_active WHERE uf.school_id=$1 AND uf.id=$2 AND uf.upload_status='pending_upload'`,[req.tenant!.id,fileId,req.identity!.id]);
    if(!row.rows[0])fail(404,'Pending document upload not found');await requireStudentAccess(req,client,row.rows[0].student_id);if(row.rows[0].mime_type!==mimeType||Number(row.rows[0].byte_size)<bytes.length)fail(400,'Uploaded file does not match its approved type or size');return row.rows[0];
  });
  const detected=await fileTypeFromBuffer(bytes);
  const actualMime=detected?.mime??(record.mime_type==='text/plain'&&bytes.length&&bytes.subarray(0,Math.min(bytes.length,1024)).every(byte=>byte===9||byte===10||byte===13||byte>=32)?'text/plain':'');
  if(actualMime!==mimeType)fail(400,'Uploaded bytes do not match the approved content type');
  const stored=await (await requireStorage()).storage.from(privateBucket()).upload(record.object_key,bytes,{contentType:mimeType,upsert:false});
  if(stored.error)throw new Error(`Private upload failed: ${stored.error.message}`);
  await tenantTransaction(req.tenant!.id,async client=>{
    await client.query(`UPDATE uploaded_files SET upload_status='ready',byte_size=$3 WHERE school_id=$1 AND id=$2`,[req.tenant!.id,fileId,bytes.length]);
    await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'document.uploaded','student_document',$3,$4::jsonb)`,[req.tenant!.id,record.membership_id,fileId,JSON.stringify({bytes:bytes.length,mimeType:actualMime})]);
  });
  res.json({fileId,status:'ready'});
}));

storageRouter.post('/documents/:fileId/fail',authenticate,studentAccess,asyncRoute(async(req,res)=>{
  const fileId=z.uuid().parse(req.params.fileId);const row=await tenantTransaction(req.tenant!.id,async client=>{
    const found=await client.query(`SELECT uf.object_key,sd.student_id,sm.id AS membership_id FROM uploaded_files uf JOIN student_documents sd ON sd.school_id=uf.school_id AND sd.uploaded_file_id=uf.id JOIN school_memberships sm ON sm.school_id=uf.school_id AND sm.user_id=$3 AND sm.is_active WHERE uf.school_id=$1 AND uf.id=$2 AND uf.upload_status='pending_upload'`,[req.tenant!.id,fileId,req.identity!.id]);if(!found.rows[0])fail(404,'Pending document upload not found');await requireStudentAccess(req,client,found.rows[0].student_id);return found.rows[0];
  });
  const removed=await (await requireStorage()).storage.from(privateBucket()).remove([row.object_key]);
  if(removed.error)console.error('Failed upload object requires cleanup',JSON.stringify({schoolId:req.tenant!.id,fileId,storageCode:removed.error.name}));
  await tenantTransaction(req.tenant!.id,async client=>{await client.query(`UPDATE uploaded_files SET upload_status='failed' WHERE school_id=$1 AND id=$2`,[req.tenant!.id,fileId]);await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'document.upload_failed','student_document',$3,'{}')`,[req.tenant!.id,row.membership_id,fileId]);});
  res.status(204).end();
}));

storageRouter.get('/documents/:fileId/download-url',authenticate,studentAccess,asyncRoute(async(req,res)=>{
  const fileId=z.uuid().parse(req.params.fileId);const file=await tenantTransaction(req.tenant!.id,async client=>{
    const row=await client.query(`SELECT uf.object_key,uf.display_name,sd.student_id,sm.id AS membership_id FROM uploaded_files uf JOIN student_documents sd ON sd.school_id=uf.school_id AND sd.uploaded_file_id=uf.id JOIN school_memberships sm ON sm.school_id=uf.school_id AND sm.user_id=$3 AND sm.is_active WHERE uf.school_id=$1 AND uf.id=$2 AND uf.upload_status='ready'`,[req.tenant!.id,fileId,req.identity!.id]);
    if(!row.rows[0])fail(404,'Document not found');await requireStudentAccess(req,client,row.rows[0].student_id);return row.rows[0];
  });
  const {data,error}=await (await requireStorage()).storage.from(privateBucket()).createSignedUrl(file.object_key,120,{download:file.display_name??true});
  if(error||!data)throw new Error(`Could not create private document download URL: ${error?.message??'unknown storage error'}`);
  await tenantTransaction(req.tenant!.id,client=>client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'document.download_url_issued','student_document',$3,$4::jsonb)`,[req.tenant!.id,file.membership_id,fileId,JSON.stringify({expiresInSeconds:120})]));
  res.json({url:data.signedUrl,expiresInSeconds:120});
}));

storageRouter.delete('/documents/:fileId',authenticate,requireSchoolPermission('students:manage','students:admit'),asyncRoute(async(req,res)=>{
  const fileId=z.uuid().parse(req.params.fileId);const file=await tenantTransaction(req.tenant!.id,async client=>{
    const row=await client.query(`SELECT uf.object_key,sd.student_id,sm.id AS membership_id FROM uploaded_files uf JOIN student_documents sd ON sd.school_id=uf.school_id AND sd.uploaded_file_id=uf.id JOIN school_memberships sm ON sm.school_id=uf.school_id AND sm.user_id=$3 AND sm.is_active WHERE uf.school_id=$1 AND uf.id=$2`,[req.tenant!.id,fileId,req.identity!.id]);
    if(!row.rows[0])fail(404,'Document not found');
    await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'document.deleted','student_document',$3,'{}')`,[req.tenant!.id,row.rows[0].membership_id,fileId]);
    await client.query('DELETE FROM student_documents WHERE school_id=$1 AND uploaded_file_id=$2',[req.tenant!.id,fileId]);
    await client.query('DELETE FROM uploaded_files WHERE school_id=$1 AND id=$2',[req.tenant!.id,fileId]);return row.rows[0];
  });
  const {error}=await (await requireStorage()).storage.from(privateBucket()).remove([file.object_key]);
  if(error)console.error('Private file orphan requires cleanup',JSON.stringify({schoolId:req.tenant!.id,fileId,storageCode:error.name}));
  res.status(204).end();
}));
