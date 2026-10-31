import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Calendar, Check, ChevronRight, FileSpreadsheet, FileText, Filter, Plus, Printer, Search, ShieldCheck, X } from 'lucide-react';
import { request, type User } from './api';

type ExamSummary = {
  id: string;
  name: string;
  exam_type: string;
  starts_on: string;
  ends_on: string;
  status: 'draft' | 'published' | 'archived';
  published_at: string | null;
  results_published_at: string | null;
  subject_count: number;
};

type ExamDetail = ExamSummary & {
  academic_year_id: string;
  subjects: {
    id: string;
    class_id: string;
    class_name: string;
    section_id: string | null;
    section_name: string | null;
    subject_id: string;
    subject_name: string;
    max_marks: number | string;
    exam_at: string | null;
  }[];
  grading: {
    grade: string;
    min_percent: number | string;
    max_percent: number | string;
    ordinal: number;
  }[];
};

type MarksRecord = {
  student_id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  result_id: string | null;
  marks: number | string | null;
  grade: string | null;
};

type ReportCardData = {
  student: { first_name: string; last_name: string; admission_number: string };
  examinationId: string;
  results: {
    examination_id: string;
    examination_name: string;
    exam_type: string;
    class_name: string;
    subject_name: string;
    max_marks: number | string;
    marks: number | string;
    grade: string;
    class_rank: number | null;
  }[];
  rankingsEnabled: boolean;
};

export default function ExamsWorkspace({ user }: { user: User }) {
  const qc = useQueryClient();
  const canManage = !!user.permissions?.some(p => p === 'exams:manage' || p === 'exams:manage:assigned');
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [reportStudentId, setReportStudentId] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [marksState, setMarksState] = useState<Record<string, number | null>>({});
  const [errorMsg, setErrorMsg] = useState('');

  // 1. Fetch Examinations
  const examsQuery = useQuery({
    queryKey: ['examinations'],
    queryFn: () => request<{ items: ExamSummary[] }>('/api/school/examinations'),
  });

  // 2. Fetch Selected Exam Detail
  const examDetailQuery = useQuery({
    queryKey: ['examination', selectedExamId],
    queryFn: () => request<{ examination: ExamDetail }>(`/api/school/examinations/${selectedExamId}`),
    enabled: !!selectedExamId,
  });

  // 3. Fetch Marks for Selected Subject
  const marksQuery = useQuery({
    queryKey: ['examination-marks', selectedExamId, selectedSubjectId],
    queryFn: async () => {
      const data = await request<{ examinationSubject: unknown; items: MarksRecord[] }>(
        `/api/school/examinations/${selectedExamId}/subjects/${selectedSubjectId}/marks`
      );
      const init: Record<string, number | null> = {};
      data.items.forEach(r => {
        init[r.student_id] = r.marks !== null ? Number(r.marks) : null;
      });
      setMarksState(init);
      return data;
    },
    enabled: !!selectedExamId && !!selectedSubjectId && canManage,
  });

  // 4. Fetch Report Card
  const reportCardQuery = useQuery({
    queryKey: ['report-card', reportStudentId, selectedExamId],
    queryFn: () =>
      request<{ reportCard: ReportCardData }>(
        `/api/school/report-cards/${reportStudentId}/${selectedExamId}`
      ),
    enabled: !!reportStudentId && !!selectedExamId,
  });

  // Fetch Academic data for Exam Creation
  const yearsQuery = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => request<{ items: { id: string; name: string; is_current: boolean }[] }>('/api/school/academic-years'),
    enabled: createModal,
  });
  const classesQuery = useQuery({
    queryKey: ['school-classes'],
    queryFn: () => request<{ items: { id: string; name: string; academic_year_id: string }[] }>('/api/school/classes'),
    enabled: createModal,
  });
  const subjectsQuery = useQuery({
    queryKey: ['school-subjects'],
    queryFn: () => request<{ items: { id: string; name: string }[] }>('/api/school/subjects'),
    enabled: createModal,
  });

  // Mutations
  const publishSchedule = useMutation({
    mutationFn: (id: string) => request(`/api/school/examinations/${id}/publish`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['examinations'] });
      void qc.invalidateQueries({ queryKey: ['examination', selectedExamId] });
    },
  });

  const publishResults = useMutation({
    mutationFn: (id: string) => request(`/api/school/examinations/${id}/results/publish`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['examinations'] });
      void qc.invalidateQueries({ queryKey: ['examination', selectedExamId] });
    },
  });

  const saveMarks = useMutation({
    mutationFn: (records: { studentId: string; marks: number | null }[]) =>
      request(`/api/school/examinations/${selectedExamId}/marks/bulk`, {
        method: 'POST',
        body: JSON.stringify({ examinationSubjectId: selectedSubjectId, records }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['examination-marks', selectedExamId, selectedSubjectId] });
      setErrorMsg('');
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const exams = examsQuery.data?.items || [];
  const activeExam = examDetailQuery.data?.examination;

  return (
    <div className="space-y-4">
      {/* Top Banner & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-lg border border-[#e8ede9] shadow-sm">
        <div>
          <div className="text-[10px] font-bold text-[#89968f] tracking-wider uppercase">Academics & Evaluations</div>
          <h2 className="text-xl font-bold text-[#1c3025] font-['Manrope']">Examinations & Results</h2>
          <p className="text-xs text-[#849189]">Configure examinations, allocate subjects, record marks, and publish report cards.</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button className="btn btn-primary" onClick={() => setCreateModal(true)}>
              <Plus size={16} /> New Examination
            </button>
          )}
        </div>
      </div>

      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      {/* Main Grid: List of exams on left, details on right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Exams List */}
        <section className="panel p-0 overflow-hidden lg:col-span-1">
          <div className="p-3 border-b border-[#eff2f0] flex items-center justify-between bg-[#fafbfa]">
            <span className="text-xs font-bold text-[#43564a]">Examinations ({exams.length})</span>
            <span className="text-[10px] text-[#89958d]">Academic Assessments</span>
          </div>

          {examsQuery.isLoading ? (
            <div className="p-4 space-y-2">
              <div className="skeleton h-12 w-full" />
              <div className="skeleton h-12 w-full" />
            </div>
          ) : exams.length === 0 ? (
            <div className="empty-state">
              <Award size={24} className="text-[#89968f]" />
              <strong>No examinations yet</strong>
              <span>Create an examination schedule to record grades.</span>
            </div>
          ) : (
            <div className="divide-y divide-[#eff2f0]">
              {exams.map(exam => (
                <div
                  key={exam.id}
                  onClick={() => {
                    setSelectedExamId(exam.id);
                    setSelectedSubjectId(null);
                    setReportStudentId(null);
                  }}
                  className={`p-3 cursor-pointer transition hover:bg-[#f6f8f6] ${
                    selectedExamId === exam.id ? 'bg-[#edf4ef] border-l-4 border-[#36735c]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-xs text-[#2b3d32]">{exam.name}</strong>
                    <span
                      className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${
                        exam.results_published_at
                          ? 'bg-[#eaf4ed] text-[#4e8b63]'
                          : exam.status === 'published'
                          ? 'bg-[#eff6ff] text-[#3b82f6]'
                          : 'bg-[#fbf4e8] text-[#a77e3d]'
                      }`}
                    >
                      {exam.results_published_at ? 'Results Out' : exam.status === 'published' ? 'Scheduled' : 'Draft'}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#89958d] mt-1 flex items-center gap-2">
                    <span>{exam.exam_type.replace('_', ' ')}</span>
                    <span>•</span>
                    <span>{exam.starts_on} to {exam.ends_on}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Right: Selected Examination Details, Marks Grid, or Report Card */}
        <section className="panel p-4 lg:col-span-2">
          {!selectedExamId ? (
            <div className="empty-state py-16">
              <FileSpreadsheet size={32} className="text-[#99a39d] mb-2" />
              <strong>Select an examination</strong>
              <p className="text-xs text-[#89958d]">Choose an examination from the left panel to configure subjects, enter marks, or publish results.</p>
            </div>
          ) : examDetailQuery.isLoading ? (
            <div className="space-y-3">
              <div className="skeleton h-8 w-1/3" />
              <div className="skeleton h-24 w-full" />
            </div>
          ) : activeExam ? (
            <div className="space-y-4">
              {/* Header Bar */}
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#eff2f0] gap-2">
                <div>
                  <h3 className="text-base font-bold text-[#1c3025]">{activeExam.name}</h3>
                  <div className="text-xs text-[#89958d]">
                    {activeExam.exam_type.toUpperCase()} • Schedule: {activeExam.starts_on} to {activeExam.ends_on}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && activeExam.status === 'draft' && (
                    <button
                      className="btn btn-secondary small-btn"
                      disabled={publishSchedule.isPending}
                      onClick={() => publishSchedule.mutate(activeExam.id)}
                    >
                      Publish Schedule
                    </button>
                  )}
                  {canManage && activeExam.status === 'published' && !activeExam.results_published_at && (
                    <button
                      className="btn btn-primary small-btn"
                      disabled={publishResults.isPending}
                      onClick={() => publishResults.mutate(activeExam.id)}
                    >
                      Publish Results
                    </button>
                  )}
                </div>
              </div>

              {/* Subject Selector Pills */}
              <div>
                <label className="text-[10px] font-bold text-[#89968f] uppercase block mb-1.5">
                  Examination Subjects ({activeExam.subjects.length})
                </label>
                <div className="flex flex-wrap gap-2">
                  {activeExam.subjects.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => {
                        setSelectedSubjectId(sub.id);
                        setReportStudentId(null);
                      }}
                      className={`text-xs px-3 py-1.5 rounded-md border text-left transition ${
                        selectedSubjectId === sub.id
                          ? 'bg-[#36735c] text-white border-[#36735c] shadow-sm'
                          : 'bg-white text-[#526258] border-[#e3e9e5] hover:bg-[#f6f8f6]'
                      }`}
                    >
                      <div className="font-semibold">{sub.subject_name}</div>
                      <div className="text-[9px] opacity-80">
                        {sub.class_name} {sub.section_name ? `(${sub.section_name})` : ''} • Max: {sub.max_marks}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Marks Entry Grid */}
              {selectedSubjectId && marksQuery.data && (
                <div className="mt-4 border border-[#eff2f0] rounded-lg overflow-hidden bg-white">
                  <div className="p-3 bg-[#fafbfa] border-b border-[#eff2f0] flex items-center justify-between">
                    <div>
                      <strong className="text-xs text-[#2b3d32]">Marks Entry & Roster</strong>
                      <div className="text-[10px] text-[#89958d]">
                        Entering marks for {activeExam.subjects.find(s => s.id === selectedSubjectId)?.subject_name}
                      </div>
                    </div>
                    {canManage && !activeExam.results_published_at && (
                      <button
                        className="btn btn-primary small-btn"
                        disabled={saveMarks.isPending}
                        onClick={() => {
                          const payload = Object.entries(marksState).map(([studentId, marks]) => ({
                            studentId,
                            marks,
                          }));
                          saveMarks.mutate(payload);
                        }}
                      >
                        {saveMarks.isPending ? 'Saving...' : 'Save All Marks'}
                      </button>
                    )}
                  </div>

                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>STUDENT</th>
                          <th>ADMISSION NO</th>
                          <th>SCORE / MAX</th>
                          <th>GRADE</th>
                          <th>REPORT CARD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {marksQuery.data.items.map(st => {
                          const max = Number(activeExam.subjects.find(s => s.id === selectedSubjectId)?.max_marks || 100);
                          const curMarks = marksState[st.student_id];
                          const pct = curMarks !== null && curMarks !== undefined ? (curMarks / max) * 100 : null;
                          const calculatedGrade =
                            pct !== null
                              ? activeExam.grading.find(g => pct >= Number(g.min_percent) && pct <= Number(g.max_percent))?.grade || '—'
                              : st.grade || '—';

                          return (
                            <tr key={st.student_id}>
                              <td>
                                <strong className="text-xs text-[#2b3d32]">{st.first_name} {st.last_name}</strong>
                              </td>
                              <td className="text-xs">{st.admission_number}</td>
                              <td>
                                {canManage && !activeExam.results_published_at ? (
                                  <input
                                    type="number"
                                    min={0}
                                    max={max}
                                    step="0.5"
                                    value={curMarks ?? ''}
                                    onChange={e => {
                                      const val = e.target.value === '' ? null : Number(e.target.value);
                                      setMarksState(prev => ({ ...prev, [st.student_id]: val }));
                                    }}
                                    className="w-20 h-7 text-xs border rounded px-1.5 focus:border-[#36735c]"
                                    placeholder="Marks"
                                  />
                                ) : (
                                  <span className="font-semibold text-xs text-[#2b3d32]">{curMarks ?? '—'} / {max}</span>
                                )}
                              </td>
                              <td>
                                <span className="font-bold text-xs text-[#36735c]">{calculatedGrade}</span>
                              </td>
                              <td>
                                <button
                                  className="text-xs text-[#36735c] underline font-semibold"
                                  onClick={() => setReportStudentId(st.student_id)}
                                >
                                  View Card
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Report Card Preview Modal / Drawer */}
              {reportStudentId && reportCardQuery.data && (
                <div className="p-4 border border-[#e8ede9] rounded-lg bg-[#fafbfa] space-y-3">
                  <div className="flex items-center justify-between border-b border-[#eff2f0] pb-2">
                    <div>
                      <div className="text-[10px] text-[#89968f] font-bold uppercase">Official Student Report Card</div>
                      <h4 className="text-sm font-bold text-[#1c3025]">
                        {reportCardQuery.data.reportCard.student.first_name} {reportCardQuery.data.reportCard.student.last_name}
                      </h4>
                      <small className="text-xs text-[#89958d]">
                        Admission No: {reportCardQuery.data.reportCard.student.admission_number}
                      </small>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="btn btn-secondary small-btn" onClick={() => window.print()}>
                        <Printer size={14} /> Print
                      </button>
                      <button className="icon-button" onClick={() => setReportStudentId(null)}>
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>SUBJECT</th>
                          <th>MAX MARKS</th>
                          <th>OBTAINED</th>
                          <th>GRADE</th>
                          {reportCardQuery.data.reportCard.rankingsEnabled && <th>CLASS RANK</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {reportCardQuery.data.reportCard.results.map((res, i) => (
                          <tr key={i}>
                            <td><strong>{res.subject_name}</strong></td>
                            <td>{res.max_marks}</td>
                            <td className="font-semibold">{res.marks}</td>
                            <td><span className="text-[#36735c] font-bold">{res.grade}</span></td>
                            {reportCardQuery.data.reportCard.rankingsEnabled && (
                              <td>{res.class_rank ? `#${res.class_rank}` : '—'}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {/* Create Examination Modal */}
      {createModal && (
        <CreateExamModal
          years={yearsQuery.data?.items || []}
          classes={classesQuery.data?.items || []}
          subjects={subjectsQuery.data?.items || []}
          onClose={() => setCreateModal(false)}
          onCreated={id => {
            setCreateModal(false);
            setSelectedExamId(id);
            void qc.invalidateQueries({ queryKey: ['examinations'] });
          }}
        />
      )}
    </div>
  );
}

function CreateExamModal({
  years,
  classes,
  subjects,
  onClose,
  onCreated,
}: {
  years: { id: string; name: string; is_current: boolean }[];
  classes: { id: string; name: string; academic_year_id: string }[];
  subjects: { id: string; name: string }[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState('unit_test');
  const [academicYearId, setAcademicYearId] = useState(years.find(y => y.is_current)?.id || years[0]?.id || '');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id || '');
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || '');
  const [maxMarks, setMaxMarks] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !startsOn || !endsOn || !selectedClassId || !selectedSubjectId) {
      setError('Please fill all required fields');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await request<{ examination: { id: string } }>('/api/school/examinations', {
        method: 'POST',
        body: JSON.stringify({
          name,
          type,
          academicYearId,
          startsOn,
          endsOn,
          subjects: [
            {
              classId: selectedClassId,
              subjectId: selectedSubjectId,
              maxMarks,
            },
          ],
          grades: [
            { grade: 'A+', minPercent: 90, maxPercent: 100 },
            { grade: 'A', minPercent: 80, maxPercent: 89.99 },
            { grade: 'B', minPercent: 70, maxPercent: 79.99 },
            { grade: 'C', minPercent: 60, maxPercent: 69.99 },
            { grade: 'D', minPercent: 50, maxPercent: 59.99 },
            { grade: 'F', minPercent: 0, maxPercent: 49.99 },
          ],
        }),
      });
      onCreated(res.examination.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal school-modal max-w-lg">
        <div className="modal-head">
          <div>
            <div className="eyebrow">ACADEMICS / ASSESSMENT</div>
            <h2>Create Examination</h2>
            <p>Schedule a new examination and configure initial subject targets.</p>
          </div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="modal-form space-y-3 pb-4">
          <div className="field">
            <span>Exam Name</span>
            <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Midterm Assessment 2026" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <span>Exam Type</span>
              <select value={type} onChange={e => setType(e.target.value)}>
                <option value="unit_test">Unit Test</option>
                <option value="midterm">Midterm Examination</option>
                <option value="term">Term Final</option>
                <option value="annual">Annual Examination</option>
              </select>
            </div>
            <div className="field">
              <span>Academic Year</span>
              <select value={academicYearId} onChange={e => setAcademicYearId(e.target.value)}>
                {years.map(y => (
                  <option key={y.id} value={y.id}>{y.name} {y.is_current ? '(Current)' : ''}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <span>Starts On</span>
              <input type="date" required value={startsOn} onChange={e => setStartsOn(e.target.value)} />
            </div>
            <div className="field">
              <span>Ends On</span>
              <input type="date" required min={startsOn} value={endsOn} onChange={e => setEndsOn(e.target.value)} />
            </div>
          </div>

          <div className="p-3 bg-[#fafbfa] border border-[#eff2f0] rounded-md space-y-2">
            <span className="text-[10px] font-bold text-[#43564a] uppercase block">Target Class & Subject</span>
            <div className="grid grid-cols-2 gap-2">
              <div className="field">
                <span>Class</span>
                <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}>
                  {classes.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span>Subject</span>
                <select value={selectedSubjectId} onChange={e => setSelectedSubjectId(e.target.value)}>
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <span>Maximum Marks</span>
              <input type="number" min="10" max="1000" value={maxMarks} onChange={e => setMaxMarks(Number(e.target.value))} />
            </div>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="modal-actions pt-3">
            <span className="text-xs text-[#849189]">Initial grading scale A+ to F will be attached automatically.</span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating...' : 'Create Examination'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
