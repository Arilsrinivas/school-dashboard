import { Router, type Request } from 'express';
import { z } from 'zod';
import { tenantTransaction, type DbClient } from '../db/pool.js';
import { asyncRoute, fail } from '../http.js';
import { authenticate, requireSchoolPermission } from '../middleware/auth.js';

export const feesRouter=Router();
feesRouter.use(authenticate);

const uuid=z.uuid();
const categoryType=z.enum(['tuition','transport','examination','custom']);
const methodSchema=z.enum(['cash','bank_transfer','cheque','demand_draft','other']);
const amountSchema=z.number().int().safe().positive().max(Number.MAX_SAFE_INTEGER);
const optionalDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const categorySchema=z.object({name:z.string().trim().min(2).max(80),categoryType:categoryType.default('custom')});
const structureSchema=z.object({categoryId:uuid,academicYearId:uuid,amountMinor:amountSchema,currency:z.string().regex(/^[A-Z]{3}$/),dueOn:optionalDate,description:z.string().trim().max(1000).default('')});
const assignSchema=z.object({studentId:uuid,feeStructureId:uuid,amountDueMinor:amountSchema.optional(),dueOn:optionalDate});
const paymentSchema=z.object({studentFeeId:uuid,amountMinor:amountSchema,method:methodSchema,reference:z.string().trim().max(180).optional(),idempotencyKey:z.string().trim().min(12).max(120)});
const reversalSchema=z.object({amountMinor:amountSchema,reason:z.string().trim().min(5).max(500),idempotencyKey:z.string().trim().min(12).max(120)});
const pageSchema=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(30)});
const dateRangeSchema=z.object({from:optionalDate,to:optionalDate}).superRefine((range,ctx)=>{if(range.from&&range.to&&range.from>range.to)ctx.addIssue({code:'custom',path:['to'],message:'to must not be before from'});});

function has(req:Request,...permissions:string[]){return permissions.some(permission=>req.permissions?.includes(permission));}
async function actorMembership(client:DbClient,schoolId:string,userId:string){
  const result=await client.query('SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active',[schoolId,userId]);
  if(!result.rows[0])fail(403,'Active school membership is required');return result.rows[0].id as string;
}
async function audit(client:DbClient,schoolId:string,membershipId:string,action:string,targetType:string,targetId:string|null,metadata:Record<string,unknown>={}){
  await client.query('INSERT INTO audit_logs(school_id,actor_membership_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[schoolId,membershipId,action,targetType,targetId,JSON.stringify(metadata)]);
}
function currentBalance(client:DbClient,schoolId:string,feeId:string){
  return client.query(`SELECT sf.amount_due_minor::bigint AS amount_due_minor,
    COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS paid_minor,
    COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS reversed_minor
    FROM student_fees sf WHERE sf.school_id=$1 AND sf.id=$2`,[schoolId,feeId]);
}
async function visibleStudent(client:DbClient,req:Request,studentId:string){
  const schoolId=req.tenant!.id,userId=req.identity!.id;
  const global=has(req,'fees:read','fees:manage');
  const result=await client.query(`SELECT st.id FROM students st WHERE st.school_id=$1 AND st.id=$2 AND
    ($3::boolean OR EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE sp.school_id=st.school_id AND sp.student_id=st.id AND p.user_id=$4))`,[schoolId,studentId,global,userId]);
  if(!result.rowCount)fail(404,'Fee record not found');
}

feesRouter.get('/categories',requireSchoolPermission('fees:read','fees:read:linked','fees:manage'),asyncRoute(async(req,res)=>{
  const data=await tenantTransaction(req.tenant!.id,client=>client.query('SELECT id,name,category_type,created_at FROM fee_categories WHERE school_id=$1 ORDER BY name',[req.tenant!.id]));
  res.json({items:data.rows});
}));
feesRouter.post('/categories',requireSchoolPermission('fees:manage'),asyncRoute(async(req,res)=>{
  const input=categorySchema.parse(req.body),schoolId=req.tenant!.id;
  const created=await tenantTransaction(schoolId,async client=>{
    const actor=await actorMembership(client,schoolId,req.identity!.id);
    const row=await client.query('INSERT INTO fee_categories(school_id,name,category_type) VALUES($1,$2,$3) RETURNING id,name,category_type,created_at',[schoolId,input.name,input.categoryType]);
    await audit(client,schoolId,actor,'fees.category_created','fee_category',row.rows[0].id,{name:input.name,categoryType:input.categoryType});return row.rows[0];
  });res.status(201).json({category:created});
}));
feesRouter.patch('/categories/:id',requireSchoolPermission('fees:manage'),asyncRoute(async(req,res)=>{
  const id=uuid.parse(req.params.id),input=categorySchema.parse(req.body),schoolId=req.tenant!.id;
  const changed=await tenantTransaction(schoolId,async client=>{
    const actor=await actorMembership(client,schoolId,req.identity!.id);
    const old=await client.query('SELECT id,name,category_type FROM fee_categories WHERE school_id=$1 AND id=$2 FOR UPDATE',[schoolId,id]);if(!old.rows[0])fail(404,'Fee category not found');
    const row=await client.query('UPDATE fee_categories SET name=$3,category_type=$4 WHERE school_id=$1 AND id=$2 RETURNING id,name,category_type',[schoolId,id,input.name,input.categoryType]);
    await audit(client,schoolId,actor,'fees.category_updated','fee_category',id,{before:old.rows[0],after:row.rows[0]});return row.rows[0];
  });res.json({category:changed});
}));

feesRouter.get('/structures',requireSchoolPermission('fees:read','fees:read:linked','fees:manage'),asyncRoute(async(req,res)=>{
  const data=await tenantTransaction(req.tenant!.id,client=>client.query(`SELECT fs.id,fs.category_id,fc.name AS category_name,fc.category_type,fs.academic_year_id,y.name AS academic_year_name,fs.amount_minor,fs.currency,fs.due_on,fs.description
    FROM fee_structures fs JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id JOIN academic_years y ON y.school_id=fs.school_id AND y.id=fs.academic_year_id
    WHERE fs.school_id=$1 ORDER BY y.starts_on DESC,fc.name,fs.due_on NULLS LAST`,[req.tenant!.id]));res.json({items:data.rows});
}));
feesRouter.post('/structures',requireSchoolPermission('fees:manage'),asyncRoute(async(req,res)=>{
  const input=structureSchema.parse(req.body),schoolId=req.tenant!.id;
  const created=await tenantTransaction(schoolId,async client=>{
    const actor=await actorMembership(client,schoolId,req.identity!.id);
    const category=await client.query('SELECT id FROM fee_categories WHERE school_id=$1 AND id=$2',[schoolId,input.categoryId]);if(!category.rowCount)fail(400,'The fee category is unavailable in this school');
    const year=await client.query('SELECT id FROM academic_years WHERE school_id=$1 AND id=$2',[schoolId,input.academicYearId]);if(!year.rowCount)fail(400,'The academic year is unavailable in this school');
    const row=await client.query(`INSERT INTO fee_structures(school_id,category_id,academic_year_id,amount_minor,currency,due_on,description)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,category_id,academic_year_id,amount_minor,currency,due_on,description`,[schoolId,input.categoryId,input.academicYearId,input.amountMinor,input.currency,input.dueOn??null,input.description]);
    await audit(client,schoolId,actor,'fees.structure_created','fee_structure',row.rows[0].id,{categoryId:input.categoryId,academicYearId:input.academicYearId,amountMinor:input.amountMinor,currency:input.currency});return row.rows[0];
  });res.status(201).json({structure:created});
}));

feesRouter.post('/assignments',requireSchoolPermission('fees:manage'),asyncRoute(async(req,res)=>{
  const input=assignSchema.parse(req.body),schoolId=req.tenant!.id;
  const created=await tenantTransaction(schoolId,async client=>{
    const actor=await actorMembership(client,schoolId,req.identity!.id);
    const student=await client.query("SELECT id FROM students WHERE school_id=$1 AND id=$2 AND status='active'",[schoolId,input.studentId]);if(!student.rowCount)fail(400,'The selected student is not active in this school');
    const structure=await client.query('SELECT id,amount_minor,due_on FROM fee_structures WHERE school_id=$1 AND id=$2',[schoolId,input.feeStructureId]);if(!structure.rows[0])fail(400,'The fee structure is unavailable in this school');
    const row=await client.query(`INSERT INTO student_fees(school_id,student_id,fee_structure_id,amount_due_minor,due_on,assigned_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,student_id,fee_structure_id,amount_due_minor,due_on,assigned_at,is_active`,[schoolId,input.studentId,input.feeStructureId,input.amountDueMinor??structure.rows[0].amount_minor,input.dueOn??structure.rows[0].due_on,actor]);
    await audit(client,schoolId,actor,'fees.student_fee_assigned','student_fee',row.rows[0].id,{studentId:input.studentId,feeStructureId:input.feeStructureId,amountDueMinor:row.rows[0].amount_due_minor});return row.rows[0];
  });res.status(201).json({fee:created});
}));

feesRouter.get('/assignments',requireSchoolPermission('fees:read','fees:read:linked','fees:manage'),asyncRoute(async(req,res)=>{
  const schoolId=req.tenant!.id,pageInfo=pageSchema.parse(req.query),classId=typeof req.query.classId==='string'?uuid.parse(req.query.classId):null;
  const global=has(req,'fees:read','fees:manage'),parent=has(req,'fees:read:linked');
  const data=await tenantTransaction(schoolId,async client=>{
    const params=[schoolId,req.identity!.id,global,parent,classId,pageInfo.limit,(pageInfo.page-1)*pageInfo.limit];
    const where=`sf.school_id=$1 AND sf.is_active AND ($3::boolean OR ($4::boolean AND EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id WHERE sp.school_id=sf.school_id AND sp.student_id=sf.student_id AND p.user_id=$2))) AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM student_enrollments e WHERE e.school_id=sf.school_id AND e.student_id=sf.student_id AND e.class_id=$5 AND e.status='active'))`;
    const rows=await client.query(`SELECT sf.id,sf.student_id,concat_ws(' ',st.first_name,st.last_name) AS student_name,st.admission_number,sf.fee_structure_id,fc.name AS category_name,fs.currency,sf.amount_due_minor,sf.due_on,
      COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS paid_minor,
      COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS reversed_minor,
      (SELECT count(*)::int FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id) AS payment_count
      FROM student_fees sf JOIN students st ON st.school_id=sf.school_id AND st.id=sf.student_id JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id
      WHERE ${where} ORDER BY sf.due_on NULLS LAST,st.last_name,st.first_name LIMIT $6 OFFSET $7`,params);
    const count=await client.query(`SELECT count(*)::int AS total FROM student_fees sf WHERE ${where}`,params.slice(0,5));
    return {items:rows.rows,total:count.rows[0].total,page:pageInfo.page,limit:pageInfo.limit};
  });res.json(data);
}));

feesRouter.get('/students/:studentId',requireSchoolPermission('fees:read','fees:read:linked','fees:manage'),asyncRoute(async(req,res)=>{
  const studentId=uuid.parse(req.params.studentId),schoolId=req.tenant!.id;
  const data=await tenantTransaction(schoolId,async client=>{
    await visibleStudent(client,req,studentId);
    const rows=await client.query(`SELECT sf.id,sf.fee_structure_id,fc.name AS category_name,fc.category_type,fs.currency,sf.amount_due_minor,sf.due_on,
      COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS paid_minor,
      COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)::bigint AS reversed_minor,
      sf.amount_due_minor-COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)+COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0) AS balance_minor
      FROM student_fees sf JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id WHERE sf.school_id=$1 AND sf.student_id=$2 AND sf.is_active ORDER BY sf.due_on NULLS LAST`,[schoolId,studentId]);
    return rows.rows;
  });res.json({studentId,items:data});
}));

feesRouter.post('/payments',requireSchoolPermission('fees:manage'),asyncRoute(async(req,res)=>{
  const input=paymentSchema.parse(req.body),schoolId=req.tenant!.id;
  const outcome=await tenantTransaction(schoolId,async client=>{
    const actor=await actorMembership(client,schoolId,req.identity!.id);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[schoolId,input.idempotencyKey]);
    const previous=await client.query(`SELECT p.id,p.student_fee_id,p.amount_minor,p.method,p.reference,p.paid_at,r.id AS receipt_id,r.receipt_number
      FROM payments p LEFT JOIN payment_receipts r ON r.school_id=p.school_id AND r.payment_id=p.id WHERE p.school_id=$1 AND p.idempotency_key=$2`,[schoolId,input.idempotencyKey]);
    if(previous.rows[0]){
      const row=previous.rows[0];
      if(row.student_fee_id!==input.studentFeeId||Number(row.amount_minor)!==input.amountMinor||row.method!==input.method||(row.reference??null)!==(input.reference??null))fail(409,'The idempotency key was already used for a different payment');
      const balance=await currentBalance(client,schoolId,input.studentFeeId);const b=balance.rows[0];
      return {payment:row,receipt:{id:row.receipt_id,receipt_number:row.receipt_number},balanceMinor:Number(b.amount_due_minor)-Number(b.paid_minor)+Number(b.reversed_minor),replayed:true};
    }
    const fee=await client.query('SELECT sf.id,sf.amount_due_minor,fs.currency FROM student_fees sf JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id WHERE sf.school_id=$1 AND sf.id=$2 AND sf.is_active FOR UPDATE OF sf',[schoolId,input.studentFeeId]);if(!fee.rows[0])fail(404,'Active student fee not found');
    const balance=await currentBalance(client,schoolId,input.studentFeeId),current=balance.rows[0];
    const balanceMinor=Number(current.amount_due_minor)-Number(current.paid_minor)+Number(current.reversed_minor);
    if(input.amountMinor>balanceMinor)fail(409,'Payment exceeds the outstanding balance');
    const payment=await client.query(`INSERT INTO payments(school_id,student_fee_id,amount_minor,method,reference,received_by,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,student_fee_id,amount_minor,method,reference,paid_at`,[schoolId,input.studentFeeId,input.amountMinor,input.method,input.reference??null,actor,input.idempotencyKey]);
    await client.query('INSERT INTO fee_receipt_sequences(school_id,last_value) VALUES($1,0) ON CONFLICT(school_id) DO NOTHING',[schoolId]);
    const sequence=await client.query('UPDATE fee_receipt_sequences SET last_value=last_value+1 WHERE school_id=$1 RETURNING last_value',[schoolId]);
    const receiptNumber=`${req.tenant!.displayId}-FEE-${String(sequence.rows[0].last_value).padStart(6,'0')}`;
    const receipt=await client.query('INSERT INTO payment_receipts(school_id,payment_id,receipt_number) VALUES($1,$2,$3) RETURNING id,receipt_number,created_at',[schoolId,payment.rows[0].id,receiptNumber]);
    await audit(client,schoolId,actor,'fees.payment_recorded','payment',payment.rows[0].id,{studentFeeId:input.studentFeeId,amountMinor:input.amountMinor,method:input.method,receiptNumber});
    return {payment:payment.rows[0],receipt:receipt.rows[0],balanceMinor:balanceMinor-input.amountMinor,replayed:false};
  });res.status(outcome.replayed?200:201).json(outcome);
}));

feesRouter.post('/payments/:paymentId/reversals',requireSchoolPermission('fees:manage'),asyncRoute(async(req,res)=>{
  const paymentId=uuid.parse(req.params.paymentId),input=reversalSchema.parse(req.body),schoolId=req.tenant!.id;
  const result=await tenantTransaction(schoolId,async client=>{
    const actor=await actorMembership(client,schoolId,req.identity!.id);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[schoolId,input.idempotencyKey]);
    const existing=await client.query('SELECT id,payment_id,amount_minor,reason,created_at FROM payment_reversals WHERE school_id=$1 AND idempotency_key=$2',[schoolId,input.idempotencyKey]);
    if(existing.rows[0]){const row=existing.rows[0];if(row.payment_id!==paymentId||Number(row.amount_minor)!==input.amountMinor||row.reason!==input.reason)fail(409,'The idempotency key was already used for a different reversal');return {reversal:row,replayed:true};}
    const payment=await client.query('SELECT id,student_fee_id,amount_minor FROM payments WHERE school_id=$1 AND id=$2 FOR UPDATE',[schoolId,paymentId]);if(!payment.rows[0])fail(404,'Payment not found');
    const reversals=await client.query('SELECT COALESCE(sum(amount_minor),0)::bigint AS total FROM payment_reversals WHERE school_id=$1 AND payment_id=$2',[schoolId,paymentId]);
    const reversible=Number(payment.rows[0].amount_minor)-Number(reversals.rows[0].total);if(input.amountMinor>reversible)fail(409,'Reversal exceeds the remaining payment amount');
    const row=await client.query(`INSERT INTO payment_reversals(school_id,payment_id,amount_minor,reason,idempotency_key,reversed_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,payment_id,amount_minor,reason,created_at`,[schoolId,paymentId,input.amountMinor,input.reason,input.idempotencyKey,actor]);
    await audit(client,schoolId,actor,'fees.payment_reversed','payment_reversal',row.rows[0].id,{paymentId,amountMinor:input.amountMinor,reason:input.reason});
    return {reversal:row.rows[0],replayed:false};
  });res.status(result.replayed?200:201).json(result);
}));

feesRouter.get('/receipts/:receiptId',requireSchoolPermission('fees:read','fees:read:linked','fees:manage'),asyncRoute(async(req,res)=>{
  const receiptId=uuid.parse(req.params.receiptId),schoolId=req.tenant!.id;
  const data=await tenantTransaction(schoolId,async client=>{
    const receipt=await client.query(`SELECT r.id,r.receipt_number,r.created_at,p.id AS payment_id,p.amount_minor,p.method,p.reference,p.paid_at,fs.currency,sf.student_id,st.admission_number,st.first_name,st.last_name,fc.name AS category_name
      FROM payment_receipts r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id JOIN student_fees sf ON sf.school_id=p.school_id AND sf.id=p.student_fee_id JOIN students st ON st.school_id=sf.school_id AND st.id=sf.student_id JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id
      WHERE r.school_id=$1 AND r.id=$2`,[schoolId,receiptId]);if(!receipt.rows[0])fail(404,'Receipt not found');
    if(has(req,'fees:read:linked'))await visibleStudent(client,req,receipt.rows[0].student_id);
    else if(!has(req,'fees:read','fees:manage'))fail(403,'Fee receipt access is not authorized');
    return receipt.rows[0];
  });res.json({receipt:data});
}));

feesRouter.get('/reports/collection',requireSchoolPermission('fees:read','fees:manage'),asyncRoute(async(req,res)=>{
  const range=dateRangeSchema.parse(req.query),schoolId=req.tenant!.id;
  const rows=await tenantTransaction(schoolId,client=>client.query(`WITH payments_in_range AS (
      SELECT p.id,p.school_id,p.amount_minor,fs.currency,fc.name AS category_name
      FROM payments p JOIN student_fees sf ON sf.school_id=p.school_id AND sf.id=p.student_fee_id
      JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id
      JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id
      WHERE p.school_id=$1 AND ($2::date IS NULL OR p.paid_at::date >= $2::date) AND ($3::date IS NULL OR p.paid_at::date <= $3::date)
    ), collected AS (
      SELECT currency,category_name,count(*)::int AS payment_count,sum(amount_minor)::bigint AS collected_minor
      FROM payments_in_range GROUP BY currency,category_name
    ), reversed AS (
      SELECT fs.currency,fc.name AS category_name,sum(r.amount_minor)::bigint AS reversed_minor
      FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id
      JOIN student_fees sf ON sf.school_id=p.school_id AND sf.id=p.student_fee_id
      JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id
      JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id
      WHERE r.school_id=$1 AND ($2::date IS NULL OR r.created_at::date >= $2::date) AND ($3::date IS NULL OR r.created_at::date <= $3::date)
      GROUP BY fs.currency,fc.name
    )
    SELECT c.currency,c.category_name,c.payment_count,c.collected_minor,COALESCE(r.reversed_minor,0)::bigint AS reversed_minor
    FROM collected c LEFT JOIN reversed r ON r.currency=c.currency AND r.category_name=c.category_name ORDER BY c.category_name`,[schoolId,range.from??null,range.to??null]));res.json({items:rows.rows});
}));

feesRouter.get('/reports/outstanding',requireSchoolPermission('fees:read','fees:manage'),asyncRoute(async(req,res)=>{
  const rows=await tenantTransaction(req.tenant!.id,client=>client.query(`SELECT fs.currency,fc.name AS category_name,count(DISTINCT sf.id)::int AS fee_count,
      COALESCE(sum(sf.amount_due_minor),0)::bigint AS amount_due_minor,
      COALESCE(sum((SELECT COALESCE(sum(p.amount_minor),0) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id)),0)::bigint AS paid_minor,
      COALESCE(sum((SELECT COALESCE(sum(r.amount_minor),0) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id)),0)::bigint AS reversed_minor,
      COALESCE(sum(sf.amount_due_minor-(SELECT COALESCE(sum(p.amount_minor),0) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id)+(SELECT COALESCE(sum(r.amount_minor),0) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id)),0)::bigint AS outstanding_minor
    FROM student_fees sf JOIN fee_structures fs ON fs.school_id=sf.school_id AND fs.id=sf.fee_structure_id JOIN fee_categories fc ON fc.school_id=fs.school_id AND fc.id=fs.category_id
    WHERE sf.school_id=$1 AND sf.is_active GROUP BY fs.currency,fc.name ORDER BY fc.name`,[req.tenant!.id]));res.json({items:rows.rows});
}));

feesRouter.post('/reminders',requireSchoolPermission('fees:manage'),asyncRoute(async(req,res)=>{
  const {dueOnBefore}=z.object({dueOnBefore:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(req.body),schoolId=req.tenant!.id;
  const result=await tenantTransaction(schoolId,async client=>{
    const actor=await actorMembership(client,schoolId,req.identity!.id);
    const inserted=await client.query(`INSERT INTO background_jobs(school_id,job_type,payload,idempotency_key,status)
      SELECT sf.school_id,'fees.payment_reminder',jsonb_build_object('studentFeeId',sf.id,'dueOn',$2::date),$3 || sf.id::text,'queued'
      FROM student_fees sf WHERE sf.school_id=$1 AND sf.is_active AND sf.due_on<=$2::date
        AND sf.amount_due_minor>COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)-COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r JOIN payments p ON p.school_id=r.school_id AND p.id=r.payment_id WHERE p.school_id=sf.school_id AND p.student_fee_id=sf.id),0)
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,[schoolId,dueOnBefore,`fees-reminder:${schoolId}:${dueOnBefore}:`]);
    await audit(client,schoolId,actor,'fees.reminders_enqueued','fee_reminder_batch',null,{dueOnBefore,queued:inserted.rowCount||0});return inserted.rowCount||0;
  });res.status(202).json({queued:result,delivery:'pending_worker'});
}));
