import express,{Router,type Request,type Response} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {fileTypeFromBuffer} from 'file-type';
import {asyncRoute,fail} from '../http.js';
import {authenticate,requireSchoolPermission} from '../middleware/auth.js';
import {tenantTransaction,type DbClient} from '../db/pool.js';
import {bucketForPurpose,parseObjectKey,storageClient,storageObjectKey} from './supabase.js';

export const storageRouter=Router();
const MAX_FILE_BYTES=10*1024*1024;
const MIME_TYPES:Record<string,string>={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp','text/plain':'txt'};
const FILE_PURPOSES=['student_document','student_certificate','student_profile_photo','assignment_attachment','school_document'] as const;
type FilePurpose=typeof FILE_PURPOSES[number];
const studentAccess=requireSchoolPermission('students:manage','students:admit','students:read:linked','students:read:self','students:read:assigned');
const fileAccess=requireSchoolPermission('students:manage','students:admit','students:read','students:read:linked','students:read:self','students:read:assigned','homework:read','homework:manage','homework:manage:assigned','school:settings:read','school:settings:update','school:members:manage');

async function requireStudentAccess(req:Request,client:DbClient,studentId:string,manageOnly=false){
  const userId=req.identity!.id,permissions=req.permissions??[];
  if(permissions.includes('students:manage')||permissions.includes('students:admit')){const exists=await client.query('SELECT 1 FROM students WHERE school_id=$1 AND id=$2',[req.tenant!.id,studentId]);if(!exists.rowCount)fail(404,'Student not found');return;}
  if(manageOnly)fail(403,'Document management permission is required');
  const access=await client.query(`SELECT 1 FROM students st WHERE st.school_id=$1 AND st.id=$2 AND (
      (st.user_id=$3 AND $4::boolean) OR
      EXISTS(SELECT 1 FROM parents p JOIN student_parents sp ON sp.school_id=p.school_id AND sp.parent_id=p.id WHERE p.school_id=st.school_id AND p.user_id=$3 AND sp.student_id=st.id AND $5::boolean) OR
      EXISTS(SELECT 1 FROM student_enrollments se JOIN teacher_assignments ta ON ta.school_id=se.school_id AND (ta.section_id IS NULL OR ta.section_id=se.section_id) JOIN class_subjects cs ON cs.school_id=ta.school_id AND cs.id=ta.class_subject_id AND cs.class_id=se.class_id JOIN teachers t ON t.school_id=ta.school_id AND t.id=ta.teacher_id WHERE se.school_id=st.school_id AND se.student_id=st.id AND se.status='active' AND t.user_id=$3 AND $6::boolean)
    )`,[req.tenant!.id,studentId,userId,permissions.includes('students:read:self'),permissions.includes('students:read:linked'),permissions.includes('students:read:assigned')]);
  if(!access.rowCount)fail(403,'You are not authorized to access this student document');
}

function requirePurposePermission(req:Request,purpose:FilePurpose,action:'read'|'write'='write'){
  const permissions=req.permissions??[];
  if(purpose==='assignment_attachment'&&action==='write'&&!permissions.some(item=>['homework:manage','homework:manage:assigned'].includes(item)))fail(403,'Homework management permission is required');
  if(purpose==='school_document'&&!permissions.some(item=>action==='read'?['school:settings:read','school:settings:update','school:members:manage'].includes(item):['school:settings:update','school:members:manage'].includes(item)))fail(403,'School document access is not authorized');
}

function purposeForObject(bucket:string,path:string):FilePurpose|undefined{
  if(bucket===bucketForPurpose('student_document'))return path.includes('/student_certificate/')?'student_certificate':'student_document';
  if(bucket===bucketForPurpose('student_profile_photo'))return 'student_profile_photo';
  if(bucket===bucketForPurpose('assignment_attachment'))return 'assignment_attachment';
  if(bucket===bucketForPurpose('school_document'))return 'school_document';
}

function studentIdFromPath(path:string){const match=path.match(/(?:^|\/)students\/([0-9a-f-]{36})\//i);return match?.[1];}

async function requireStorage(bucketName:string){try{const client=storageClient();const bucket=await client.storage.getBucket(bucketName);if(bucket.error||!bucket.data||bucket.data.public)fail(503,'Configured Supabase bucket must exist and be private');return client;}catch(error){if(error instanceof Error&&error.message==='Configured Supabase bucket must exist and be private')throw error;fail(503,'Private document storage is unavailable or not securely configured');}}

async function requireAssignmentFileAccess(req:Request,client:DbClient,fileId:string){
  if(req.permissions?.includes('homework:manage'))return;
  const result=await client.query(`SELECT 1 FROM assignment_attachments aa JOIN assignments a ON a.school_id=aa.school_id AND a.id=aa.assignment_id WHERE aa.school_id=$1 AND aa.file_id=$2 AND a.status='published' AND (
      EXISTS(SELECT 1 FROM teachers t WHERE t.school_id=a.school_id AND t.user_id=$3 AND t.id=a.teacher_id) OR
      EXISTS(SELECT 1 FROM students st JOIN student_enrollments se ON se.school_id=st.school_id AND se.student_id=st.id WHERE st.school_id=a.school_id AND st.user_id=$3 AND se.class_id=a.class_id AND (a.section_id IS NULL OR se.section_id=a.section_id) AND se.status='active') OR
      EXISTS(SELECT 1 FROM parents p JOIN student_parents sp ON sp.school_id=p.school_id AND sp.parent_id=p.id JOIN student_enrollments se ON se.school_id=sp.school_id AND se.student_id=sp.student_id WHERE p.school_id=a.school_id AND p.user_id=$3 AND se.class_id=a.class_id AND (a.section_id IS NULL OR se.section_id=a.section_id) AND se.status='active')
    )`,[req.tenant!.id,fileId,req.identity!.id]);
  if(!result.rowCount)fail(403,'You are not authorized to access this assignment file');
}

storageRouter.get('/students/:studentId/documents',authenticate,studentAccess,asyncRoute(async(req,res)=>{const studentId=z.uuid().parse(req.params.studentId);const items=await tenantTransaction(req.tenant!.id,async client=>{await requireStudentAccess(req,client,studentId);const result=await client.query(`SELECT uf.id,uf.display_name,uf.mime_type,uf.byte_size,sd.category,uf.created_at FROM student_documents sd JOIN uploaded_files uf ON uf.school_id=sd.school_id AND uf.id=sd.uploaded_file_id WHERE sd.school_id=$1 AND sd.student_id=$2 AND uf.upload_status='ready' ORDER BY uf.created_at DESC`,[req.tenant!.id,studentId]);return result.rows;});res.json({items});}));

async function authorizeUpload(req:Request,res:Response,forcedPurpose?:FilePurpose){
  const parsed=z.object({purpose:z.enum(FILE_PURPOSES).optional(),studentId:z.uuid().optional(),category:z.string().trim().min(2).max(60).default('document'),fileName:z.string().trim().min(1).max(180).refine(value=>!/[\\/\0]/.test(value)),mimeType:z.string().refine(value=>Object.hasOwn(MIME_TYPES,value)),size:z.number().int().positive().max(MAX_FILE_BYTES)}).safeParse(req.body);
  if(!parsed.success)fail(400,'Invalid file upload request');const input=parsed.data;const purpose=forcedPurpose??input.purpose;if(!purpose)fail(400,'File purpose is required');requirePurposePermission(req,purpose);if(purpose==='student_profile_photo'&&!input.mimeType.startsWith('image/'))fail(400,'Profile photos must be JPEG, PNG, or WebP images');
  const studentPurpose=purpose==='student_document'||purpose==='student_certificate'||purpose==='student_profile_photo';if(studentPurpose&&!input.studentId)fail(400,'A student ID is required for this file purpose');if(!studentPurpose&&input.studentId)fail(400,'Student ID is not valid for this file purpose');
  const fileId=randomUUID(),bucket=bucketForPurpose(purpose),ext=MIME_TYPES[input.mimeType];const path=purpose==='student_document'||purpose==='student_certificate'?`schools/${req.tenant!.id}/students/${input.studentId}/documents/${purpose}/${fileId}.${ext}`:purpose==='student_profile_photo'?`schools/${req.tenant!.id}/students/${input.studentId}/profile/${fileId}.${ext}`:purpose==='assignment_attachment'?`schools/${req.tenant!.id}/assignments/${fileId}.${ext}`:`schools/${req.tenant!.id}/documents/${input.category}/${fileId}.${ext}`;
  await requireStorage(bucket);
  const created=await tenantTransaction(req.tenant!.id,async client=>{if(input.studentId)await requireStudentAccess(req,client,input.studentId,purpose==='student_certificate'||purpose==='student_profile_photo');const membership=await client.query('SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active',[req.tenant!.id,req.identity!.id]);if(!membership.rows[0])fail(403,'Active school membership is required');await client.query(`INSERT INTO uploaded_files(id,school_id,uploaded_by,object_key,mime_type,byte_size,display_name,upload_status) VALUES($1,$2,$3,$4,$5,$6,$7,'pending_upload')`,[fileId,req.tenant!.id,membership.rows[0].id,storageObjectKey(bucket,path),input.mimeType,input.size,input.fileName]);if(purpose==='student_document'||purpose==='student_certificate')await client.query('INSERT INTO student_documents(school_id,student_id,uploaded_file_id,category) VALUES($1,$2,$3,$4)',[req.tenant!.id,input.studentId,fileId,purpose==='student_certificate'?'certificate':input.category]);await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'file.upload_authorized',$3,$4,$5::jsonb)`,[req.tenant!.id,membership.rows[0].id,purpose,fileId,JSON.stringify({mimeType:input.mimeType,bytes:input.size})]);return {id:fileId};});res.status(201).json({fileId:created.id,uploadUrl:`/api/school/files/${created.id}/content`,maxBytes:MAX_FILE_BYTES});
}

storageRouter.post('/files/upload-authorizations',authenticate,fileAccess,asyncRoute((req,res)=>authorizeUpload(req,res)));
storageRouter.post('/documents/upload-authorizations',authenticate,studentAccess,asyncRoute((req,res)=>authorizeUpload(req,res,'student_document')));

async function uploadContent(req:Request,res:Response){
  const fileId=z.uuid().parse(req.params.fileId),bytes=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0),mimeType=req.header('content-type')?.split(';')[0]?.trim()??'';if(!Object.hasOwn(MIME_TYPES,mimeType)||!bytes.length||bytes.length>MAX_FILE_BYTES)fail(400,'Unsupported or oversized file');
  const record=await tenantTransaction(req.tenant!.id,async client=>{const result=await client.query(`SELECT uf.*,sm.id AS membership_id,sd.student_id FROM uploaded_files uf JOIN school_memberships sm ON sm.school_id=uf.school_id AND sm.id=uf.uploaded_by AND sm.user_id=$3 AND sm.is_active LEFT JOIN student_documents sd ON sd.school_id=uf.school_id AND sd.uploaded_file_id=uf.id WHERE uf.school_id=$1 AND uf.id=$2 AND uf.upload_status='pending_upload'`,[req.tenant!.id,fileId,req.identity!.id]);if(!result.rows[0])fail(404,'Pending file upload not found');const row=result.rows[0],location=parseObjectKey(row.object_key),purpose=purposeForObject(location.bucket,location.path);if(!purpose)fail(400,'Unknown private file bucket');requirePurposePermission(req,purpose);const studentId=row.student_id??(purpose==='student_profile_photo'?studentIdFromPath(location.path):undefined);if(studentId)await requireStudentAccess(req,client,studentId,purpose==='student_certificate'||purpose==='student_profile_photo');return {...row,purpose,location,studentId};});
  const detected=await fileTypeFromBuffer(bytes),actualMime=detected?.mime??(record.mime_type==='text/plain'&&bytes.length&&bytes.subarray(0,Math.min(bytes.length,1024)).every((byte:number)=>byte===9||byte===10||byte===13||byte>=32)?'text/plain':'');if(actualMime!==mimeType||record.mime_type!==mimeType||Number(record.byte_size)<bytes.length)fail(400,'Uploaded bytes do not match the approved file type or size');
  const stored=await (await requireStorage(record.location.bucket)).storage.from(record.location.bucket).upload(record.location.path,bytes,{contentType:mimeType,upsert:false});if(stored.error)throw new Error('Private file upload failed');
  await tenantTransaction(req.tenant!.id,async client=>{await client.query('UPDATE uploaded_files SET upload_status=\'ready\',byte_size=$3 WHERE school_id=$1 AND id=$2',[req.tenant!.id,fileId,bytes.length]);if(record.purpose==='student_profile_photo'&&record.studentId)await client.query('UPDATE students SET photo_file_id=$3 WHERE school_id=$1 AND id=$2',[req.tenant!.id,record.studentId,fileId]);await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'file.uploaded',$3,$4,$5::jsonb)`,[req.tenant!.id,record.membership_id,record.purpose,fileId,JSON.stringify({bytes:bytes.length,mimeType})]);});res.json({fileId,status:'ready'});
}

storageRouter.put('/files/:fileId/content',authenticate,fileAccess,express.raw({type:Object.keys(MIME_TYPES),limit:MAX_FILE_BYTES}),asyncRoute(uploadContent));
storageRouter.put('/documents/:fileId/content',authenticate,studentAccess,express.raw({type:Object.keys(MIME_TYPES),limit:MAX_FILE_BYTES}),asyncRoute(uploadContent));

async function failUpload(req:Request,res:Response){const fileId=z.uuid().parse(req.params.fileId);const row=await tenantTransaction(req.tenant!.id,async client=>{const result=await client.query(`SELECT uf.object_key,uf.uploaded_by,sm.id membership_id FROM uploaded_files uf JOIN school_memberships sm ON sm.school_id=uf.school_id AND sm.id=uf.uploaded_by AND sm.user_id=$3 AND sm.is_active WHERE uf.school_id=$1 AND uf.id=$2 AND uf.upload_status='pending_upload'`,[req.tenant!.id,fileId,req.identity!.id]);if(!result.rows[0])fail(404,'Pending upload not found');return result.rows[0];});const {bucket,path}=parseObjectKey(row.object_key);const removed=await (await requireStorage(bucket)).storage.from(bucket).remove([path]);if(removed.error)throw new Error('Failed upload cleanup failed');await tenantTransaction(req.tenant!.id,async client=>{await client.query("UPDATE uploaded_files SET upload_status='failed' WHERE school_id=$1 AND id=$2",[req.tenant!.id,fileId]);await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'file.upload_failed','private_file',$3,'{}')`,[req.tenant!.id,row.membership_id,fileId]);});res.status(204).end();}
storageRouter.post('/files/:fileId/fail',authenticate,fileAccess,asyncRoute(failUpload));
storageRouter.post('/documents/:fileId/fail',authenticate,studentAccess,asyncRoute(failUpload));

async function issueDownloadUrl(req:Request,res:Response){
  const fileId=z.uuid().parse(req.params.fileId);const file=await tenantTransaction(req.tenant!.id,async client=>{const result=await client.query(`SELECT uf.id,uf.object_key,uf.display_name,uf.mime_type,uf.upload_status,sm.id AS membership_id,sd.student_id FROM uploaded_files uf JOIN school_memberships sm ON sm.school_id=uf.school_id AND sm.user_id=$3 AND sm.is_active LEFT JOIN student_documents sd ON sd.school_id=uf.school_id AND sd.uploaded_file_id=uf.id WHERE uf.school_id=$1 AND uf.id=$2`,[req.tenant!.id,fileId,req.identity!.id]);if(!result.rows[0]||result.rows[0].upload_status!=='ready')fail(404,'File not found');const row=result.rows[0],location=parseObjectKey(row.object_key),purpose=purposeForObject(location.bucket,location.path);if(!purpose)fail(404,'File not found');requirePurposePermission(req,purpose,'read');if(purpose==='student_document'||purpose==='student_certificate'){if(!row.student_id)fail(404,'File not found');await requireStudentAccess(req,client,row.student_id);}if(purpose==='student_profile_photo'){const studentId=studentIdFromPath(location.path);if(!studentId)fail(404,'File not found');await requireStudentAccess(req,client,studentId);}if(purpose==='assignment_attachment')await requireAssignmentFileAccess(req,client,fileId);return {...row,location,purpose};});
  const {data,error}=await (await requireStorage(file.location.bucket)).storage.from(file.location.bucket).createSignedUrl(file.location.path,120,{download:file.display_name??true});if(error||!data?.signedUrl)throw new Error('Private file download authorization failed');await tenantTransaction(req.tenant!.id,client=>client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'file.download_url_issued',$3,$4,$5::jsonb)`,[req.tenant!.id,file.membership_id,file.purpose,fileId,JSON.stringify({expiresInSeconds:120})]));res.json({url:data.signedUrl,expiresInSeconds:120});
}

storageRouter.get('/files/:fileId/download-url',authenticate,fileAccess,asyncRoute(issueDownloadUrl));
storageRouter.get('/documents/:fileId/download-url',authenticate,studentAccess,asyncRoute(issueDownloadUrl));

storageRouter.get('/school-files',authenticate,fileAccess,asyncRoute(async(req,res)=>{if(!req.permissions?.some(permission=>['school:settings:read','school:settings:update','school:members:manage'].includes(permission)))fail(403,'School document access is required');const bucket=bucketForPurpose('school_document'),prefix=`${bucket}:schools/${req.tenant!.id}/documents/`;const rows=await tenantTransaction(req.tenant!.id,client=>client.query(`SELECT id,display_name,mime_type,byte_size,created_at,object_key FROM uploaded_files WHERE school_id=$1 AND object_key LIKE $2 AND upload_status='ready' ORDER BY created_at DESC`,[req.tenant!.id,`${prefix}%`]));res.json({items:rows.rows.map(row=>({...row,category:parseObjectKey(row.object_key).path.split('/')[3]??'document',object_key:undefined}))});}));

async function deleteFile(req:Request,res:Response){
  const fileId=z.uuid().parse(req.params.fileId);const file=await tenantTransaction(req.tenant!.id,async client=>{const result=await client.query(`SELECT uf.object_key,uf.uploaded_by,sm.id AS membership_id,sd.student_id,st.id photo_student_id FROM uploaded_files uf JOIN school_memberships sm ON sm.school_id=uf.school_id AND sm.user_id=$3 AND sm.is_active LEFT JOIN student_documents sd ON sd.school_id=uf.school_id AND sd.uploaded_file_id=uf.id LEFT JOIN students st ON st.school_id=uf.school_id AND st.photo_file_id=uf.id WHERE uf.school_id=$1 AND uf.id=$2`,[req.tenant!.id,fileId,req.identity!.id]);if(!result.rows[0])fail(404,'File not found');const row=result.rows[0],location=parseObjectKey(row.object_key),purpose=purposeForObject(location.bucket,location.path);if(!purpose)fail(404,'File not found');if(purpose==='student_document'||purpose==='student_certificate'||purpose==='student_profile_photo'){const sid=row.student_id??row.photo_student_id??studentIdFromPath(location.path);if(!sid)fail(404,'File not found');await requireStudentAccess(req,client,sid,true);}else requirePurposePermission(req,purpose);return {...row,purpose,location};});
  const removed=await (await requireStorage(file.location.bucket)).storage.from(file.location.bucket).remove([file.location.path]);if(removed.error)throw new Error('Private file deletion failed');await tenantTransaction(req.tenant!.id,async client=>{if(file.purpose==='student_profile_photo')await client.query('UPDATE students SET photo_file_id=NULL WHERE school_id=$1 AND photo_file_id=$2',[req.tenant!.id,fileId]);await client.query('DELETE FROM student_documents WHERE school_id=$1 AND uploaded_file_id=$2',[req.tenant!.id,fileId]);await client.query('DELETE FROM assignment_attachments WHERE school_id=$1 AND file_id=$2',[req.tenant!.id,fileId]);await client.query('DELETE FROM uploaded_files WHERE school_id=$1 AND id=$2',[req.tenant!.id,fileId]);await client.query(`INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,'file.deleted',$3,$4,'{}')`,[req.tenant!.id,file.membership_id,file.purpose,fileId]);});res.status(204).end();
}
storageRouter.delete('/files/:fileId',authenticate,fileAccess,asyncRoute(deleteFile));
storageRouter.delete('/documents/:fileId',authenticate,requireSchoolPermission('students:manage','students:admit'),asyncRoute(deleteFile));
