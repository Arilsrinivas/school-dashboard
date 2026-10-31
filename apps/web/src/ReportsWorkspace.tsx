import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileSpreadsheet, GraduationCap, Users, Calendar, DollarSign, TrendingUp } from 'lucide-react';
import { request, downloadFile, type User } from './api';

type DashboardData = {
  counts: {
    active_students: number;
    active_teachers: number;
    total_parents: number;
    total_classes: number;
  };
  attendanceSummary: {
    status: string;
    count: number;
  }[];
  fees: {
    totalDueMinor: number;
    netCollectedMinor: number;
    outstandingMinor: number;
  };
  recentExams: {
    id: string;
    name: string;
    exam_type: string;
    starts_on: string;
    ends_on: string;
    status: string;
  }[];
};

type AcademicPerformance = {
  examination_id: string;
  examination_name: string;
  class_id: string;
  class_name: string;
  subject_name: string;
  max_marks: number | string;
  total_submissions: number;
  average_marks: number | string;
  highest_marks: number | string;
  lowest_marks: number | string;
};

const formatMoney = (minor: number | string) => {
  const num = Number(minor || 0) / 100;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num);
};

export default function ReportsWorkspace({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<'analytics' | 'academics' | 'exports'>('analytics');

  // 1. Fetch Dashboard Analytics
  const dashQuery = useQuery({
    queryKey: ['reports-dashboard'],
    queryFn: () => request<DashboardData>('/api/school/reports/dashboard'),
  });

  // 2. Fetch Academics
  const academicsQuery = useQuery({
    queryKey: ['reports-academics'],
    queryFn: () => request<{ items: AcademicPerformance[] }>('/api/school/reports/academics'),
    enabled: activeTab === 'academics',
  });

  const dash = dashQuery.data;

  // Calculate Attendance Percent
  const totalAtt = dash?.attendanceSummary.reduce((acc, cur) => acc + cur.count, 0) || 0;
  const presentAtt = dash?.attendanceSummary.find(s => s.status === 'present')?.count || 0;
  const attRate = totalAtt > 0 ? Math.round((presentAtt / totalAtt) * 100) : 100;

  return (
    <div className="space-y-4">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-lg border border-[#e8ede9] shadow-sm">
        <div>
          <div className="text-[10px] font-bold text-[#89968f] tracking-wider uppercase">Executive Intelligence</div>
          <h2 className="text-xl font-bold text-[#1c3025] font-['Manrope']">Reports & School Analytics</h2>
          <p className="text-xs text-[#849189]">Operational KPIs, attendance ratios, academic performance, and exportable data files.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void downloadFile('/api/school/reports/export?type=students&format=csv', 'students-report.csv')}
            className="btn btn-secondary small-btn"
          >
            <Download size={14} /> Quick Students CSV
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="school-workbar mb-2">
        <div className="school-tabs">
          <button className={activeTab === 'analytics' ? 'selected' : ''} onClick={() => setActiveTab('analytics')}>
            Operational Overview
          </button>
          <button className={activeTab === 'academics' ? 'selected' : ''} onClick={() => setActiveTab('academics')}>
            Academic Benchmarks
          </button>
          <button className={activeTab === 'exports' ? 'selected' : ''} onClick={() => setActiveTab('exports')}>
            Data Exports
          </button>
        </div>
      </div>

      {/* TAB 1: Operational Overview */}
      {activeTab === 'analytics' && (
        <div className="space-y-4">
          {/* 4 Metric Cards */}
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-top">
                <span>Enrolled Students</span>
                <span className="metric-icon green"><GraduationCap size={16} /></span>
              </div>
              <div className="metric-value">{dash?.counts.active_students ?? '—'}</div>
              <div className="metric-bottom">
                <span>In active classes</span>
                <span className="metric-trend"><TrendingUp size={12} /> Active</span>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <span>Teaching Faculty</span>
                <span className="metric-icon blue"><Users size={16} /></span>
              </div>
              <div className="metric-value">{dash?.counts.active_teachers ?? '—'}</div>
              <div className="metric-bottom">
                <span>Subject instructors</span>
                <span className="metric-trend">Full-time</span>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <span>30-Day Attendance</span>
                <span className="metric-icon amber"><Calendar size={16} /></span>
              </div>
              <div className="metric-value">{attRate}%</div>
              <div className="metric-bottom">
                <span>{presentAtt} attended of {totalAtt}</span>
                <span className="metric-trend">Campus-wide</span>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <span>Fee Collection</span>
                <span className="metric-icon green"><DollarSign size={16} /></span>
              </div>
              <div className="metric-value">{dash ? formatMoney(dash.fees.netCollectedMinor) : '—'}</div>
              <div className="metric-bottom">
                <span>Out of {dash ? formatMoney(dash.fees.totalDueMinor) : '—'}</span>
                <span className="metric-trend text-[#a75644]">
                  Bal: {dash ? formatMoney(dash.fees.outstandingMinor) : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Two Section Panels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Attendance Breakdown */}
            <section className="panel p-4 space-y-3">
              <div className="panel-kicker">CAMPUS ENGAGEMENT</div>
              <h3 className="text-sm font-bold text-[#1c3025]">Attendance Distribution (Last 30 Days)</h3>
              <div className="space-y-2 pt-2">
                {['present', 'absent', 'late', 'excused'].map(st => {
                  const item = dash?.attendanceSummary.find(s => s.status === st);
                  const count = item?.count || 0;
                  const pct = totalAtt > 0 ? Math.round((count / totalAtt) * 100) : 0;
                  const color =
                    st === 'present' ? 'bg-[#5b9674]' : st === 'absent' ? 'bg-[#d6a354]' : st === 'late' ? 'bg-[#c18c43]' : 'bg-[#6885a4]';
                  return (
                    <div key={st} className="space-y-1">
                      <div className="flex justify-between text-xs text-[#526258]">
                        <span className="capitalize">{st}</span>
                        <span className="font-semibold">{count} ({pct}%)</span>
                      </div>
                      <div className="h-2 w-full bg-[#f0f3f1] rounded-full overflow-hidden">
                        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Right: Recent Examinations */}
            <section className="panel p-4 space-y-3">
              <div className="panel-kicker">ASSESSMENT CALENDAR</div>
              <h3 className="text-sm font-bold text-[#1c3025]">Recent & Upcoming Examinations</h3>
              <div className="divide-y divide-[#eff2f0]">
                {dash?.recentExams.map(ex => (
                  <div key={ex.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <strong className="text-[#2b3d32]">{ex.name}</strong>
                      <div className="text-[10px] text-[#89958d]">
                        {ex.exam_type.replace('_', ' ')} • {ex.starts_on} to {ex.ends_on}
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#edf4ef] text-[#36735c]">
                      {ex.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: Academic Benchmarks */}
      {activeTab === 'academics' && (
        <section className="panel p-0 overflow-hidden">
          <div className="p-3 bg-[#fafbfa] border-b border-[#eff2f0]">
            <span className="text-xs font-bold text-[#43564a]">Subject-Wise Examination Marks Analysis</span>
          </div>

          {academicsQuery.isLoading ? (
            <div className="p-4 space-y-2">
              <div className="skeleton h-10 w-full" />
              <div className="skeleton h-10 w-full" />
            </div>
          ) : academicsQuery.data?.items.length === 0 ? (
            <div className="empty-state py-12">
              <strong>No academic results recorded yet</strong>
              <span className="text-xs text-[#89958d]">Enter marks in the Examinations workspace to view analytics.</span>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>EXAMINATION</th>
                    <th>CLASS</th>
                    <th>SUBJECT</th>
                    <th>MAX MARKS</th>
                    <th>SUBMISSIONS</th>
                    <th>AVERAGE SCORE</th>
                    <th>HIGHEST SCORE</th>
                    <th>LOWEST SCORE</th>
                  </tr>
                </thead>
                <tbody>
                  {academicsQuery.data?.items.map((row, i) => (
                    <tr key={i}>
                      <td><strong>{row.examination_name}</strong></td>
                      <td>{row.class_name}</td>
                      <td className="font-semibold text-[#36735c]">{row.subject_name}</td>
                      <td>{row.max_marks}</td>
                      <td>{row.total_submissions}</td>
                      <td className="font-bold text-[#2b3d32]">{row.average_marks}</td>
                      <td className="text-[#49845e] font-semibold">{row.highest_marks}</td>
                      <td className="text-[#a75644] font-semibold">{row.lowest_marks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 3: Data Exports */}
      {activeTab === 'exports' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-white rounded-lg border border-[#e8ede9] space-y-3">
            <div className="w-10 h-10 rounded-lg bg-[#edf5ef] text-[#54886a] flex items-center justify-center">
              <GraduationCap size={20} />
            </div>
            <div>
              <strong className="text-sm text-[#2b3d32]">Students Master Export</strong>
              <p className="text-xs text-[#89958d] mt-1">Full directory of active students, admission numbers, assigned class, and academic year.</p>
            </div>
            <button
              onClick={() => void downloadFile('/api/school/reports/export?type=students&format=csv', 'students-master.csv')}
              className="btn btn-secondary w-full"
            >
              <Download size={14} /> Download Students CSV
            </button>
          </div>

          <div className="p-4 bg-white rounded-lg border border-[#e8ede9] space-y-3">
            <div className="w-10 h-10 rounded-lg bg-[#edf2f7] text-[#6885a4] flex items-center justify-center">
              <Calendar size={20} />
            </div>
            <div>
              <strong className="text-sm text-[#2b3d32]">Attendance Daily Log</strong>
              <p className="text-xs text-[#89958d] mt-1">Granular log of student attendance, statuses, and teacher notes.</p>
            </div>
            <button
              onClick={() => void downloadFile('/api/school/reports/export?type=attendance&format=csv', 'attendance-log.csv')}
              className="btn btn-secondary w-full"
            >
              <Download size={14} /> Download Attendance CSV
            </button>
          </div>

          <div className="p-4 bg-white rounded-lg border border-[#e8ede9] space-y-3">
            <div className="w-10 h-10 rounded-lg bg-[#fbf3e8] text-[#c18c43] flex items-center justify-center">
              <DollarSign size={20} />
            </div>
            <div>
              <strong className="text-sm text-[#2b3d32]">Fee Collections & Invoices</strong>
              <p className="text-xs text-[#89958d] mt-1">Auditable ledger entries of invoiced fees, collections, and due dates.</p>
            </div>
            <button
              onClick={() => void downloadFile('/api/school/reports/export?type=fees&format=csv', 'fees-ledger.csv')}
              className="btn btn-secondary w-full"
            >
              <Download size={14} /> Download Fees CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
