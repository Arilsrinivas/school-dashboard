import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenCheck, Check, ChevronDown, Clock3, FileCheck2, LoaderCircle, Plus, Send, UserRound } from 'lucide-react';
import { request, type User } from './api';
import './homework.css';

type ClassItem={id:string;name:string;academic_year_name?:string;grade_level?:number|null};
type SectionItem={id:string;class_id:string;name:string};
type SubjectItem={id:string;name:string;code?:string|null};
type TeacherItem={teacher_id:string;employee_id:string|null;name:string};
type SubmissionMini={studentId?:string;studentName?:string;submittedAt:string|null;isLate:boolean;score:number|null;feedback:string|null};
type Assignment={id:string;class_id:string;class_name:string;section_id:string|null;section_name:string|null;subject_id:string;subject_name:string;teacher_id:string;title:string;description:string;due_at:string|null;max_score:number|string|null;status:'draft'|'published'|'archived';published_at:string|null;created_at:string;submitted_count:number|null;target_count:number|null;linked_child_submissions?:SubmissionMini[];own_submission?:{submittedAt:string|null;isLate:boolean;score:number|null;feedback:string|null}|null};
type AssignmentResponse={items:Assignment[];total:number;page:number;limit:number};
type Dashboard={metrics:{assignments:number;submissions:number;late_submissions:number;awaiting_review:number}};
type Submission={student_id:string;admission_number:string;first_name:string;last_name:string;submission_id:string|null;submitted_at:string|null;file_id:string|null;response_text:string|null;score:number|string|null;feedback:string|null;reviewed_at:string|null;is_late:boolean};
type SubmissionResponse={assignment:{id:string;max_score:number|string|null};items:Submission[]};

const can=(user:User,...permissions:string[])=>permissions.some(permission=>user.permissions?.includes(permission));
const humanDate=(value:string|null|undefined)=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:value.includes('T')?'short':undefined}).format(new Date(value)): 'No deadline';
const childLine=(rows:SubmissionMini[]|undefined)=>rows?.length?rows.map(row=>`${row.studentName}: ${row.submittedAt?'submitted':'not submitted'}${row.isLate?' · late':''}`).join(' · '):'No linked homework records';

export default function HomeworkWorkspace({user}:{user:User}){
  const permissions=user.permissions||[];
  const canRead=can(user,'homework:read','homework:read:assigned','homework:read:linked','homework:read:self');
  const canCreate=can(user,'homework:manage','homework:manage:assigned');
  const canReview=can(user,'homework:manage','homework:manage:assigned');
  const isPersonal=!can(user,'homework:read','homework:read:assigned')&&can(user,'homework:read:linked','homework:read:self');
  const canChooseAnyClass=permissions.includes('academics:read');
  const qc=useQueryClient();
  const [filterStatus,setFilterStatus]=useState('');
  const [selectedClass,setSelectedClass]=useState('');
  const [selectedSection,setSelectedSection]=useState('');
  const [selectedSubject,setSelectedSubject]=useState('');
  const [selectedTeacher,setSelectedTeacher]=useState('');
  const [selectedAssignment,setSelectedAssignment]=useState('');
  const [error,setError]=useState('');
  const [createOpen,setCreateOpen]=useState(false);
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [dueAt,setDueAt]=useState('');
  const [maxScore,setMaxScore]=useState('');
  const [publishNow,setPublishNow]=useState(true);
  const [responseText,setResponseText]=useState('');
  const [reviewValues,setReviewValues]=useState<Record<string,{score:string;feedback:string}>>({});

  const classesQuery=useQuery({queryKey:['homework-classes'],queryFn:()=>request<{items:ClassItem[]}>('/api/school/classes'),enabled:canCreate});
  const classes=classesQuery.data?.items||[];
  const sectionsQuery=useQuery({queryKey:['homework-sections',selectedClass],queryFn:()=>request<{items:SectionItem[]}>(`/api/school/sections?classId=${encodeURIComponent(selectedClass)}`),enabled:canCreate&&!!selectedClass});
  const sections=sectionsQuery.data?.items||[];
  const subjectsQuery=useQuery({queryKey:['homework-subjects',selectedClass],queryFn:()=>request<{items:SubjectItem[]}>(`/api/school/subjects?classId=${encodeURIComponent(selectedClass)}`),enabled:canCreate&&!!selectedClass});
  const teachersQuery=useQuery({queryKey:['homework-teachers',selectedClass,selectedSubject,selectedSection],queryFn:()=>request<{items:TeacherItem[]}>(`/api/school/homework/teachers?classId=${encodeURIComponent(selectedClass)}&subjectId=${encodeURIComponent(selectedSubject)}${selectedSection?`&sectionId=${encodeURIComponent(selectedSection)}`:''}`),enabled:permissions.includes('homework:manage')&&!!selectedClass&&!!selectedSubject});
  const subjects=subjectsQuery.data?.items||[];
  const assignmentsQuery=useQuery({queryKey:['homework','assignments',filterStatus],queryFn:()=>request<AssignmentResponse>(`/api/school/homework/assignments?page=1&limit=100${filterStatus?`&status=${encodeURIComponent(filterStatus)}`:''}`),enabled:canRead});
  const dashboardQuery=useQuery({queryKey:['homework','dashboard'],queryFn:()=>request<Dashboard>('/api/school/homework/dashboard'),enabled:canRead});
  const assignments=assignmentsQuery.data?.items||[];
  const activeAssignment=assignments.find(item=>item.id===selectedAssignment)||null;
  const submissionsQuery=useQuery({queryKey:['homework','submissions',selectedAssignment],queryFn:()=>request<SubmissionResponse>(`/api/school/homework/assignments/${encodeURIComponent(selectedAssignment)}/submissions`),enabled:!!selectedAssignment&&canReview});
  const invalidate=()=>{void qc.invalidateQueries({queryKey:['homework']});};

  const create=useMutation({mutationFn:()=>request<{assignment:Assignment}>('/api/school/homework/assignments',{method:'POST',body:JSON.stringify({classId:selectedClass,sectionId:selectedSection||undefined,subjectId:selectedSubject,teacherId:selectedTeacher||undefined,title,description,dueAt:dueAt?new Date(dueAt).toISOString():undefined,maxScore:maxScore?Number(maxScore):undefined,publish:publishNow})}),onSuccess:()=>{setError('');setTitle('');setDescription('');setDueAt('');setMaxScore('');setSelectedTeacher('');setCreateOpen(false);invalidate();}});
  const status=useMutation({mutationFn:({assignmentId,next}:{assignmentId:string;next:'published'|'archived'})=>request(`/api/school/homework/assignments/${encodeURIComponent(assignmentId)}/status`,{method:'PATCH',body:JSON.stringify({status:next})}),onSuccess:invalidate});
  const submit=useMutation({mutationFn:({assignmentId,text}:{assignmentId:string;text:string})=>request(`/api/school/homework/assignments/${encodeURIComponent(assignmentId)}/submission`,{method:'POST',body:JSON.stringify({responseText:text})}),onSuccess:()=>{setError('');setResponseText('');invalidate();}});
  const review=useMutation({mutationFn:({assignmentId,submissionId,score,feedback}:{assignmentId:string;submissionId:string;score:string;feedback:string})=>request(`/api/school/homework/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(submissionId)}/review`,{method:'PATCH',body:JSON.stringify({score:score===''?undefined:Number(score),feedback})}),onSuccess:async()=>{await qc.invalidateQueries({queryKey:['homework','submissions',selectedAssignment]});invalidate();}});

  const personalSummary=useMemo(()=>assignments.reduce((summary,item)=>{
    if(isPersonal){const own=item.own_submission;return {...summary,assigned:summary.assigned+1,submitted:summary.submitted+(own?.submittedAt?1:0),late:summary.late+(own?.isLate?1:0)};}
    const submitted=Number(item.submitted_count||0);return {...summary,assigned:summary.assigned+Number(item.target_count||0),submitted:summary.submitted+submitted,late:summary.late};
  },{assigned:0,submitted:0,late:0}),[assignments,isPersonal]);

  if(!canRead)return <section className="homework-workspace"><div className="empty-state"><strong>Homework access is not assigned</strong><span>Ask a school administrator to update this account’s permissions.</span></div></section>;

  return <section className="homework-workspace">
    <div className="homework-heading"><div><div className="panel-kicker">SCHOOL OPERATIONS</div><h2>Homework & assignments</h2><p>{isPersonal?'View class assignments and track submissions.':'Create assignments and follow student completion.'}</p></div>{canCreate&&<button className="btn btn-primary" onClick={()=>setCreateOpen(value=>!value)}><Plus size={15}/>{createOpen?'Close form':'Create assignment'}</button>}</div>

    <div className="homework-metrics">
      {(isPersonal?[
        {label:'Assignments',value:personalSummary.assigned},
        {label:'Submitted',value:personalSummary.submitted},
        {label:'Late',value:personalSummary.late},
        {label:'Completion',value:personalSummary.assigned?`${Math.round(personalSummary.submitted/personalSummary.assigned*100)}%`:'—'},
      ]:[
        {label:'Published assignments',value:dashboardQuery.data?.metrics.assignments??0},
        {label:'Submissions',value:dashboardQuery.data?.metrics.submissions??0},
        {label:'Late submissions',value:dashboardQuery.data?.metrics.late_submissions??0},
        {label:'Awaiting review',value:dashboardQuery.data?.metrics.awaiting_review??0},
      ]).map(metric=><div className="homework-metric" key={metric.label}><span>{metric.label}</span><strong>{dashboardQuery.isLoading&&!isPersonal?<LoaderCircle size={16} className="homework-spin"/>:metric.value}</strong></div>)}
    </div>

    {createOpen&&canCreate&&<form className="homework-create panel" onSubmit={event=>{event.preventDefault();setError('');if(!selectedClass||!selectedSubject){setError('Select a class and subject before saving.');return;}create.mutate();}}>
      <div className="panel-head"><div><div className="panel-kicker">ASSIGNMENT SETUP</div><h3>New assignment</h3></div><span className="homework-subtle">Target one class and optional section</span></div>
      {classesQuery.isLoading?<div className="homework-loading"><LoaderCircle size={16}/> Loading classes…</div>:classesQuery.isError?<div className="error-inline">{(classesQuery.error as Error).message}</div>:<div className="homework-form-grid">
        <label><span>CLASS</span><select required value={selectedClass} onChange={event=>{setSelectedClass(event.target.value);setSelectedSection('');setSelectedSubject('');setSelectedTeacher('');}}><option value="">Select a class</option>{classes.map(item=><option key={item.id} value={item.id}>{item.name}{item.academic_year_name?` · ${item.academic_year_name}`:''}</option>)}</select></label>
        <label><span>SECTION</span><select value={selectedSection} onChange={event=>{setSelectedSection(event.target.value);setSelectedTeacher('');}} disabled={!selectedClass}><option value="">All sections</option>{sections.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>SUBJECT</span><select required value={selectedSubject} onChange={event=>{setSelectedSubject(event.target.value);setSelectedTeacher('');}} disabled={!selectedClass}><option value="">Select a subject</option>{subjects.map(item=><option key={item.id} value={item.id}>{item.name}{item.code?` (${item.code})`:''}</option>)}</select></label>
        {permissions.includes('homework:manage')&&<label><span>ASSIGNED TEACHER</span><select required value={selectedTeacher} onChange={event=>setSelectedTeacher(event.target.value)} disabled={!selectedSubject||teachersQuery.isLoading}><option value="">{teachersQuery.isLoading?'Loading assigned teachers…':'Choose a teacher'}</option>{(teachersQuery.data?.items||[]).map(item=><option key={item.teacher_id} value={item.teacher_id}>{item.name}{item.employee_id?` · ${item.employee_id}`:''}</option>)}</select>{teachersQuery.isError&&<small className="homework-error-hint">{(teachersQuery.error as Error).message}</small>}{teachersQuery.data?.items.length===0&&<small className="homework-error-hint">No active teacher is assigned to this class, section, and subject.</small>}</label>}
        <label><span>DEADLINE</span><input type="datetime-local" value={dueAt} onChange={event=>setDueAt(event.target.value)}/></label>
        <label><span>TITLE</span><input required minLength={2} maxLength={180} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Assignment title"/></label>
        <label><span>MAXIMUM SCORE</span><input type="number" min="0" max="100000" step="0.01" value={maxScore} onChange={event=>setMaxScore(event.target.value)} placeholder="Optional"/></label>
        <label className="homework-description"><span>DESCRIPTION</span><textarea maxLength={10000} rows={4} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Instructions and learning objectives"/></label>
        <label className="homework-publish"><input type="checkbox" checked={publishNow} onChange={event=>setPublishNow(event.target.checked)}/><span>Publish now so students and parents can see it</span></label>
      </div>}
      <div className="homework-form-footer"><span className="homework-subtle">Private file uploads are not configured in this workspace.</span><button className="btn btn-primary" disabled={create.isPending||classesQuery.isLoading||subjectsQuery.isLoading}>{create.isPending?<LoaderCircle size={14} className="homework-spin"/>:<BookOpenCheck size={14}/>}Save assignment</button></div>
      {(error||create.isError)&&<div className="error-inline">{error||(create.error as Error).message}</div>}
    </form>}

    <section className="homework-list panel">
      <div className="panel-head"><div><div className="panel-kicker">ASSIGNMENT BOARD</div><h3>{isPersonal?'Class assignments':'Assignments & completion'}</h3></div><label className="homework-status-filter"><span>STATUS</span><select value={filterStatus} onChange={event=>setFilterStatus(event.target.value)}><option value="">Visible to me</option>{can(user,'homework:manage','homework:manage:assigned')&&<option value="draft">Drafts</option>}<option value="published">Published</option><option value="archived">Archived</option></select><ChevronDown size={13}/></label></div>
      {assignmentsQuery.isLoading?<div className="homework-loading"><LoaderCircle size={16} className="homework-spin"/>Loading assignments…</div>:assignmentsQuery.isError?<div className="error-inline">{(assignmentsQuery.error as Error).message}<button onClick={()=>assignmentsQuery.refetch()}>Retry</button></div>:assignments.length===0?<div className="empty-state"><div className="empty-icon"><BookOpenCheck size={19}/></div><strong>No assignments available</strong><span>{canCreate?'Create an assignment for a class to begin.':'Published homework will appear here.'}</span></div>:<div className="homework-cards">{assignments.map(item=>{
        const own=item.own_submission;
        const linked=item.linked_child_submissions||[];
        const isLate=own?.isLate;
        const submitted=own?.submittedAt;
        return <article className={`homework-card ${selectedAssignment===item.id?'selected':''}`} key={item.id}>
          <div className="homework-card-main"><div className="homework-card-icon"><FileCheck2 size={17}/></div><div className="homework-card-copy"><div className="homework-card-top"><strong>{item.title}</strong><span className={`homework-badge ${item.status}`}>{item.status}</span></div><div className="homework-meta">{item.class_name}{item.section_name?` · ${item.section_name}`:''} · {item.subject_name}</div><p>{item.description||'No additional instructions.'}</p><div className="homework-meta homework-due"><Clock3 size={12}/>{humanDate(item.due_at)}{isLate&&<span className="homework-late">Late</span>}{submitted&&!isLate&&<span className="homework-submitted"><Check size={12}/>Submitted</span>}</div>
            {!isPersonal&&item.status==='published'&&item.submitted_count!==null&&<div className="homework-completion"><div className="homework-completion-track"><i style={{width:`${item.target_count?Math.min(100,Number(item.submitted_count||0)/Number(item.target_count)*100):0}%`}}/></div><span>{item.submitted_count||0} of {item.target_count||0} submitted</span></div>}
            {!!linked.length&&<div className="homework-meta homework-linked"><UserRound size={12}/>{childLine(linked)}</div>}
          </div></div>
          <div className="homework-card-actions">
            {isPersonal&&user.role==='student'&&item.status==='published'&&<button className="btn btn-secondary small-btn" onClick={()=>{setSelectedAssignment(selectedAssignment===item.id?'':item.id);setResponseText('');}}><Send size={13}/>{submitted?'Update submission':'Submit work'}</button>}
            {canReview&&item.status==='published'&&!isPersonal&&<button className="btn btn-secondary small-btn" onClick={()=>setSelectedAssignment(selectedAssignment===item.id?'':item.id)}><FileCheck2 size={13}/>{selectedAssignment===item.id?'Close reviews':'Review submissions'}</button>}
            {canCreate&&(item.status==='draft'||item.status==='published')&&<button className="btn btn-secondary small-btn" disabled={status.isPending} onClick={()=>status.mutate({assignmentId:item.id,next:item.status==='draft'?'published':'archived'})}>{item.status==='draft'?'Publish':'Archive'}</button>}
          </div>
          {isPersonal&&user.role==='student'&&selectedAssignment===item.id&&<form className="homework-submit" onSubmit={event=>{event.preventDefault();if(!responseText.trim()){setError('Add your response before submitting.');return;}setError('');submit.mutate({assignmentId:item.id,text:responseText});}}><label><span>YOUR RESPONSE</span><textarea value={responseText} onChange={event=>setResponseText(event.target.value)} maxLength={20000} rows={3} placeholder="Write your answer or submission notes…"/></label><div className="homework-form-footer"><span className="homework-subtle">If you replace a submission after the deadline it remains late.</span><button className="btn btn-primary" disabled={submit.isPending}>{submit.isPending?<LoaderCircle size={14} className="homework-spin"/>:<Send size={14}/>}Submit assignment</button></div>{(error||submit.isError)&&<div className="error-inline">{error||(submit.error as Error).message}</div>}</form>}
          {canReview&&selectedAssignment===item.id&&!isPersonal&&<div className="homework-review">{submissionsQuery.isLoading?<div className="homework-loading"><LoaderCircle size={15} className="homework-spin"/>Loading submissions…</div>:submissionsQuery.isError?<div className="error-inline">{(submissionsQuery.error as Error).message}<button onClick={()=>submissionsQuery.refetch()}>Retry</button></div>:submissionsQuery.data?.items.map(row=>{
            const value=reviewValues[row.submission_id||'']||{score:row.score==null?'':String(row.score),feedback:row.feedback||''};
            return <div className="homework-review-row" key={row.student_id}><div className="homework-review-student"><strong>{row.first_name} {row.last_name}</strong><small>{row.submitted_at?`Submitted ${humanDate(row.submitted_at)}`:'Not submitted'}{row.is_late?' · Late':''}</small>{row.response_text&&<p>{row.response_text}</p>}</div>{row.submission_id&&<form onSubmit={event=>{event.preventDefault();review.mutate({assignmentId:item.id,submissionId:row.submission_id!,score:value.score,feedback:value.feedback});}}><label><span>MARK / {submissionsQuery.data?.assignment.max_score??'—'}</span><input type="number" min="0" max={submissionsQuery.data?.assignment.max_score??undefined} step="0.01" value={value.score} onChange={event=>setReviewValues(current=>({...current,[row.submission_id!]:{...value,score:event.target.value}}))}/></label><label><span>FEEDBACK</span><input value={value.feedback} onChange={event=>setReviewValues(current=>({...current,[row.submission_id!]:{...value,feedback:event.target.value}}))}/></label><button className="btn btn-primary small-btn" disabled={review.isPending}>Save review</button></form>}</div>;
          })}</div>}
          {(status.isError||review.isError)&&<div className="error-inline">{(status.error||review.error as Error).message}</div>}
        </article>;
      })}</div>}
    </section>
  </section>;
}
