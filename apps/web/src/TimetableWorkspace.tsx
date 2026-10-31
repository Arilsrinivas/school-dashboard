import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Clock, AlertTriangle, Check, Plus, Send, X, Layers } from 'lucide-react';
import { request, type User } from './api';

type Period = {
  id: string;
  academic_year_id: string;
  period_number: number;
  name: string;
  starts_at: string;
  ends_at: string;
  is_break: boolean;
  is_active: boolean;
};

type TimetableEntry = {
  id: string;
  academic_year_id: string;
  class_id: string;
  class_name: string;
  section_id: string;
  section_name: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string;
  teacher_name: string;
  period_id: string;
  period_number: number;
  period_name: string;
  day_of_week: number;
  starts_at: string;
  ends_at: string;
  room: string | null;
  status: 'draft' | 'published' | 'archived';
};

const daysOfWeek = [
  { id: 1, name: 'Monday' },
  { id: 2, name: 'Tuesday' },
  { id: 3, name: 'Wednesday' },
  { id: 4, name: 'Thursday' },
  { id: 5, name: 'Friday' },
  { id: 6, name: 'Saturday' },
];

export default function TimetableWorkspace({ user }: { user: User }) {
  const qc = useQueryClient();
  const canManage = !!user.permissions?.some(p => p === 'timetable:manage');

  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [filterMode, setFilterMode] = useState<'class' | 'teacher'>('class');
  const [entryModal, setEntryModal] = useState(false);
  const [periodModal, setPeriodModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 1. Fetch Academic Years
  const yearsQuery = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => request<{ items: { id: string; name: string; is_current: boolean }[] }>('/api/school/academic-years'),
  });
  const currentYear = yearsQuery.data?.items.find(y => y.is_current) || yearsQuery.data?.items[0];

  // 2. Fetch Classes and Sections
  const classesQuery = useQuery({
    queryKey: ['school-classes'],
    queryFn: () => request<{ items: { id: string; name: string; academic_year_id: string }[] }>('/api/school/classes'),
  });

  const activeClassId = selectedClassId || classesQuery.data?.items[0]?.id || '';

  const sectionsQuery = useQuery({
    queryKey: ['school-sections', activeClassId],
    queryFn: () => request<{ items: { id: string; name: string; class_id: string }[] }>(`/api/school/sections?classId=${activeClassId}`),
    enabled: !!activeClassId,
  });

  // 3. Fetch Teachers
  const teachersQuery = useQuery({
    queryKey: ['school-teachers'],
    queryFn: () => request<{ items: { id: string; name: string; employee_id: string }[] }>('/api/school/teachers'),
  });

  // 4. Fetch Periods
  const periodsQuery = useQuery({
    queryKey: ['timetable-periods', currentYear?.id],
    queryFn: () => request<{ items: Period[] }>(`/api/school/timetable/periods?academicYearId=${currentYear?.id}`),
    enabled: !!currentYear?.id,
  });

  // 5. Fetch Timetable Entries (either by class or teacher)
  const timetableQuery = useQuery({
    queryKey: ['timetable-entries', activeClassId, selectedSectionId, selectedTeacherId, filterMode],
    queryFn: () => {
      if (filterMode === 'teacher' && selectedTeacherId) {
        return request<{ items: TimetableEntry[] }>(`/api/school/timetable/teachers/${selectedTeacherId}?academicYearId=${currentYear?.id}`);
      }
      return request<{ items: TimetableEntry[] }>(
        `/api/school/timetable/classes/${activeClassId}?academicYearId=${currentYear?.id}${selectedSectionId ? `&sectionId=${selectedSectionId}` : ''}`
      );
    },
    enabled: !!currentYear?.id && (filterMode === 'class' ? !!activeClassId : !!selectedTeacherId),
  });

  // Publish timetable mutation
  const publishSchedule = useMutation({
    mutationFn: () =>
      request('/api/school/timetable/publish', {
        method: 'POST',
        body: JSON.stringify({
          academicYearId: currentYear?.id,
          classId: activeClassId,
          sectionId: selectedSectionId || undefined,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['timetable-entries'] });
      setErrorMsg('');
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const periods = periodsQuery.data?.items || [];
  const entries = timetableQuery.data?.items || [];

  // Group entries by day of week and period
  const grid = useMemo(() => {
    const map: Record<string, TimetableEntry> = {};
    for (const e of entries) {
      map[`${e.day_of_week}_${e.period_id}`] = e;
    }
    return map;
  }, [entries]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-lg border border-[#e8ede9] shadow-sm">
        <div>
          <div className="text-[10px] font-bold text-[#89968f] tracking-wider uppercase">Class Scheduling</div>
          <h2 className="text-xl font-bold text-[#1c3025] font-['Manrope']">School Timetable</h2>
          <p className="text-xs text-[#849189]">Weekly schedules, period allocations, and teacher clash prevention.</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <>
              <button className="btn btn-secondary" onClick={() => setPeriodModal(true)}>
                <Clock size={15} /> Configure Periods
              </button>
              <button className="btn btn-primary" onClick={() => setEntryModal(true)}>
                <Plus size={15} /> Add Schedule Entry
              </button>
            </>
          )}
        </div>
      </div>

      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      {/* Filters Toolbar */}
      <div className="p-3 bg-white rounded-lg border border-[#e8ede9] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex border border-[#e3e9e5] rounded-md overflow-hidden text-xs">
            <button
              onClick={() => setFilterMode('class')}
              className={`px-3 py-1.5 font-semibold ${filterMode === 'class' ? 'bg-[#36735c] text-white' : 'bg-white text-[#637168]'}`}
            >
              By Class
            </button>
            <button
              onClick={() => {
                setFilterMode('teacher');
                if (!selectedTeacherId && teachersQuery.data?.items[0]) {
                  setSelectedTeacherId(teachersQuery.data.items[0].id);
                }
              }}
              className={`px-3 py-1.5 font-semibold ${filterMode === 'teacher' ? 'bg-[#36735c] text-white' : 'bg-white text-[#637168]'}`}
            >
              By Teacher
            </button>
          </div>

          {filterMode === 'class' ? (
            <div className="flex items-center gap-2">
              <select
                value={activeClassId}
                onChange={e => {
                  setSelectedClassId(e.target.value);
                  setSelectedSectionId('');
                }}
                className="h-8 border border-[#e3e9e5] rounded px-2 text-xs bg-white"
              >
                {classesQuery.data?.items.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <select
                value={selectedSectionId}
                onChange={e => setSelectedSectionId(e.target.value)}
                className="h-8 border border-[#e3e9e5] rounded px-2 text-xs bg-white"
              >
                <option value="">All Sections</option>
                {sectionsQuery.data?.items.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <select
              value={selectedTeacherId}
              onChange={e => setSelectedTeacherId(e.target.value)}
              className="h-8 border border-[#e3e9e5] rounded px-2 text-xs bg-white"
            >
              {teachersQuery.data?.items.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.employee_id})</option>
              ))}
            </select>
          )}
        </div>

        {canManage && filterMode === 'class' && entries.length > 0 && (
          <button
            className="btn btn-secondary small-btn"
            disabled={publishSchedule.isPending}
            onClick={() => publishSchedule.mutate()}
          >
            <Send size={14} /> Publish Class Timetable
          </button>
        )}
      </div>

      {/* Timetable Weekly Matrix */}
      <section className="panel p-0 overflow-hidden">
        {periods.length === 0 ? (
          <div className="empty-state py-12">
            <Clock size={28} className="text-[#89968f] mb-2" />
            <strong>No periods configured for this academic year</strong>
            <p className="text-xs text-[#89958d]">Add your school periods (e.g. Period 1, Period 2, Recess) to start building timetables.</p>
            {canManage && (
              <button className="btn btn-primary mt-2" onClick={() => setPeriodModal(true)}>
                <Plus size={15} /> Add Period
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="w-24 text-center">DAY</th>
                  {periods.map(p => (
                    <th key={p.id} className="text-center min-w-[140px]">
                      <div>{p.name}</div>
                      <div className="text-[9px] font-normal text-[#89958d]">{p.starts_at.slice(0, 5)} - {p.ends_at.slice(0, 5)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {daysOfWeek.map(day => (
                  <tr key={day.id} className="hover:bg-[#fafbfa]">
                    <td className="text-center font-bold text-xs bg-[#fafbfa] border-r border-[#eff2f0]">
                      {day.name}
                    </td>
                    {periods.map(p => {
                      if (p.is_break) {
                        return (
                          <td key={p.id} className="bg-[#f7faf8] text-center text-[10px] text-[#89968f] italic border-r border-[#eff2f0]">
                            Break
                          </td>
                        );
                      }
                      const entry = grid[`${day.id}_${p.id}`];
                      return (
                        <td key={p.id} className="p-2 border-r border-[#eff2f0] align-top">
                          {entry ? (
                            <div className="p-2 rounded bg-[#edf4ef] border border-[#dcebe1] text-xs space-y-1">
                              <div className="font-bold text-[#20392e]">{entry.subject_name}</div>
                              <div className="text-[10px] text-[#55695d] flex items-center justify-between">
                                <span>{entry.teacher_name}</span>
                                {entry.room && <span className="font-semibold text-[#36735c]">[{entry.room}]</span>}
                              </div>
                              <div className="flex items-center justify-between text-[9px] text-[#89958d] pt-1 border-t border-[#dcebe1]">
                                <span>{entry.class_name} {entry.section_name}</span>
                                <span className={entry.status === 'published' ? 'text-[#36735c] font-semibold' : 'text-[#a77e3d]'}>
                                  {entry.status}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="h-14 border border-dashed border-[#e3e9e5] rounded flex items-center justify-center text-[10px] text-[#a4afa9]">
                              Free
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modals */}
      {entryModal && currentYear && (
        <CreateEntryModal
          academicYearId={currentYear.id}
          classes={classesQuery.data?.items || []}
          periods={periods.filter(p => !p.is_break)}
          onClose={() => setEntryModal(false)}
          onSuccess={() => {
            setEntryModal(false);
            void qc.invalidateQueries({ queryKey: ['timetable-entries'] });
          }}
        />
      )}

      {periodModal && currentYear && (
        <ConfigurePeriodsModal
          academicYearId={currentYear.id}
          periods={periods}
          onClose={() => setPeriodModal(false)}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['timetable-periods'] });
          }}
        />
      )}
    </div>
  );
}

function CreateEntryModal({
  academicYearId,
  classes,
  periods,
  onClose,
  onSuccess,
}: {
  academicYearId: string;
  classes: { id: string; name: string }[];
  periods: Period[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [classId, setClassId] = useState(classes[0]?.id || '');
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [periodId, setPeriodId] = useState(periods[0]?.id || '');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflictError, setConflictError] = useState('');

  const sectionsQuery = useQuery({
    queryKey: ['modal-sections', classId],
    queryFn: async () => {
      const res = await request<{ items: { id: string; name: string }[] }>(`/api/school/sections?classId=${classId}`);
      if (res.items[0]) setSectionId(res.items[0].id);
      return res;
    },
    enabled: !!classId,
  });

  const subjectsQuery = useQuery({
    queryKey: ['modal-subjects', classId],
    queryFn: async () => {
      const res = await request<{ items: { id: string; subject_id: string; subject_name: string }[] }>(`/api/school/class-subjects?classId=${classId}`);
      if (res.items[0]) setSubjectId(res.items[0].subject_id);
      return res;
    },
    enabled: !!classId,
  });

  const teachersQuery = useQuery({
    queryKey: ['modal-teachers'],
    queryFn: async () => {
      const res = await request<{ items: { id: string; name: string }[] }>('/api/school/teachers');
      if (res.items[0]) setTeacherId(res.items[0].id);
      return res;
    },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setConflictError('');
    setBusy(true);
    try {
      await request('/api/school/timetable', {
        method: 'POST',
        body: JSON.stringify({
          academicYearId,
          classId,
          sectionId,
          subjectId,
          teacherId,
          periodId,
          dayOfWeek,
          room: room.trim() || undefined,
        }),
      });
      onSuccess();
    } catch (err: unknown) {
      setConflictError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal school-modal max-w-lg">
        <div className="modal-head">
          <div>
            <div className="eyebrow">TIMETABLE / SCHEDULING</div>
            <h2>Add Schedule Entry</h2>
            <p>Allocate a teacher and subject to a period slot.</p>
          </div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="modal-form space-y-3 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <span>Class</span>
              <select value={classId} onChange={e => setClassId(e.target.value)}>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <span>Section</span>
              <select value={sectionId} onChange={e => setSectionId(e.target.value)} required>
                {sectionsQuery.data?.items.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <span>Subject</span>
              <select value={subjectId} onChange={e => setSubjectId(e.target.value)} required>
                {subjectsQuery.data?.items.map(s => <option key={s.id} value={s.subject_id}>{s.subject_name}</option>)}
              </select>
            </div>
            <div className="field">
              <span>Assigned Teacher</span>
              <select value={teacherId} onChange={e => setTeacherId(e.target.value)} required>
                {teachersQuery.data?.items.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <span>Day of the Week</span>
              <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))}>
                {daysOfWeek.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="field">
              <span>Period</span>
              <select value={periodId} onChange={e => setPeriodId(e.target.value)}>
                {periods.map(p => <option key={p.id} value={p.id}>{p.name} ({p.starts_at.slice(0, 5)})</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <span>Room / Facility (Optional)</span>
            <input value={room} onChange={e => setRoom(e.target.value)} placeholder="e.g. Science Lab 2" />
          </div>

          {conflictError && (
            <div className="p-3 bg-[#fff5f2] border border-[#f1d6cf] rounded-md text-xs text-[#a75644] flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>{conflictError}</span>
            </div>
          )}

          <div className="modal-actions pt-2">
            <span className="text-xs text-[#849189]">Clash checks protect against double-booking teachers or rooms.</span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Add Entry'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfigurePeriodsModal({
  academicYearId,
  periods,
  onClose,
  onSuccess,
}: {
  academicYearId: string;
  periods: Period[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [periodNumber, setPeriodNumber] = useState(periods.length + 1);
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('09:00');
  const [endsAt, setEndsAt] = useState('09:45');
  const [isBreak, setIsBreak] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('/api/school/timetable/periods', {
        method: 'POST',
        body: JSON.stringify({
          academicYearId,
          periodNumber,
          name,
          startsAt,
          endsAt,
          isBreak,
        }),
      });
      setName('');
      setPeriodNumber(n => n + 1);
      onSuccess();
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
            <div className="eyebrow">TIMETABLE / PERIODS</div>
            <h2>Configure Periods</h2>
            <p>Define standard daily bell schedules and break times.</p>
          </div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1 max-h-48 overflow-y-auto divide-y divide-[#eff2f0] border border-[#eff2f0] rounded">
            {periods.map(p => (
              <div key={p.id} className="p-2.5 flex items-center justify-between text-xs">
                <div>
                  <strong className="text-[#2b3d32]">{p.period_number}. {p.name}</strong>
                  <span className="text-[#89958d] ml-2">({p.starts_at.slice(0, 5)} - {p.ends_at.slice(0, 5)})</span>
                </div>
                {p.is_break && <span className="bg-[#f0f5f1] text-[#42765e] px-2 py-0.5 rounded text-[10px]">Break</span>}
              </div>
            ))}
          </div>

          <form onSubmit={submit} className="border-t border-[#eff2f0] pt-3 space-y-3">
            <span className="text-xs font-bold text-[#43564a]">Add New Period</span>
            <div className="grid grid-cols-2 gap-2">
              <div className="field">
                <span>Period Name</span>
                <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Period 1" />
              </div>
              <div className="field">
                <span>Period Number</span>
                <input type="number" min={1} max={30} value={periodNumber} onChange={e => setPeriodNumber(Number(e.target.value))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="field">
                <span>Starts At</span>
                <input type="time" required value={startsAt} onChange={e => setStartsAt(e.target.value)} />
              </div>
              <div className="field">
                <span>Ends At</span>
                <input type="time" required value={endsAt} onChange={e => setEndsAt(e.target.value)} />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-[#526258] cursor-pointer">
              <input type="checkbox" checked={isBreak} onChange={e => setIsBreak(e.target.checked)} />
              <span>Mark as break period (recess, lunch, etc.)</span>
            </label>

            {error && <div className="error-banner">{error}</div>}

            <div className="modal-actions pt-2">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Done</button>
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Add Period'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
