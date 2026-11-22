import React, { useState } from 'react';
import {
  Users, UserPlus, CheckCircle2, Phone, Mail, Calendar, Filter,
  ArrowRight, Search, Download, Plus, ChevronRight, Check, AlertCircle,
  FileText, ShieldCheck, Sparkles, Building2, MapPin
} from 'lucide-react';

export interface AdmissionLead {
  id: string;
  studentName: string;
  parentName: string;
  phone: string;
  email: string;
  gradeApplying: string;
  source: 'Website Form' | 'Walk-in' | 'Referral' | 'Social Campaign';
  stage: 'Enquiry' | 'Follow-up' | 'Assessment' | 'Offer Sent' | 'Enrolled';
  leadScore: number;
  documentsVerified: boolean;
  notes: string;
  createdAt: string;
}

const INITIAL_LEADS: AdmissionLead[] = [
  {
    id: 'ADM-2026-001',
    studentName: 'Aarav Sharma',
    parentName: 'Rajesh Sharma',
    phone: '+91 98231 44551',
    email: 'rajesh.sharma@example.com',
    gradeApplying: 'Grade 1',
    source: 'Website Form',
    stage: 'Assessment',
    leadScore: 92,
    documentsVerified: true,
    notes: 'Prior play-school record verified. Assessment scheduled for Saturday 10:00 AM.',
    createdAt: '2026-11-18'
  },
  {
    id: 'ADM-2026-002',
    studentName: 'Ananya Iyer',
    parentName: 'Venkatesh Iyer',
    phone: '+91 94450 12890',
    email: 'v.iyer@example.com',
    gradeApplying: 'Grade 6',
    source: 'Referral',
    stage: 'Offer Sent',
    leadScore: 88,
    documentsVerified: true,
    notes: 'Transfer Certificate & previous marksheet cleared. Provisional offer letter emailed.',
    createdAt: '2026-11-15'
  },
  {
    id: 'ADM-2026-003',
    studentName: 'Kabir Verma',
    parentName: 'Sunita Verma',
    phone: '+91 98110 99882',
    email: 's.verma@example.com',
    gradeApplying: 'Grade 9',
    source: 'Walk-in',
    stage: 'Follow-up',
    leadScore: 74,
    documentsVerified: false,
    notes: 'Parent enquired regarding CBSE science stream laboratory facilities. Follow-up call booked.',
    createdAt: '2026-11-19'
  },
  {
    id: 'ADM-2026-004',
    studentName: 'Riya Sen',
    parentName: 'Amit Sen',
    phone: '+91 97234 56789',
    email: 'amit.sen@example.com',
    gradeApplying: 'Kindergarten',
    source: 'Website Form',
    stage: 'Enrolled',
    leadScore: 96,
    documentsVerified: true,
    notes: 'Admission fee cleared. Enrolled in KG Section Sunflower.',
    createdAt: '2026-11-12'
  },
  {
    id: 'ADM-2026-005',
    studentName: 'Devansh Kulkarni',
    parentName: 'Nitin Kulkarni',
    phone: '+91 96123 77441',
    email: 'nitin.kulkarni@example.com',
    gradeApplying: 'Grade 11',
    source: 'Social Campaign',
    stage: 'Enquiry',
    leadScore: 68,
    documentsVerified: false,
    notes: 'Enquired about JEE integrated coaching batches.',
    createdAt: '2026-11-20'
  }
];

const STAGES: AdmissionLead['stage'][] = ['Enquiry', 'Follow-up', 'Assessment', 'Offer Sent', 'Enrolled'];

export default function AdmissionsWorkspace({ onAdmitStudent }: { onAdmitStudent?: (lead: AdmissionLead) => void }) {
  const [leads, setLeads] = useState<AdmissionLead[]>(INITIAL_LEADS);
  const [search, setSearch] = useState('');
  const [selectedStage, setSelectedStage] = useState<string>('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLead, setNewLead] = useState({
    studentName: '',
    parentName: '',
    phone: '',
    email: '',
    gradeApplying: 'Grade 1',
    source: 'Website Form' as AdmissionLead['source'],
    notes: ''
  });

  const filteredLeads = leads.filter(l => {
    const matchesSearch = l.studentName.toLowerCase().includes(search.toLowerCase()) ||
                          l.parentName.toLowerCase().includes(search.toLowerCase()) ||
                          l.id.toLowerCase().includes(search.toLowerCase());
    const matchesStage = selectedStage === 'All' || l.stage === selectedStage;
    return matchesSearch && matchesStage;
  });

  const countsByStage = STAGES.reduce((acc, stage) => {
    acc[stage] = leads.filter(l => l.stage === stage).length;
    return acc;
  }, {} as Record<string, number>);

  const handleStageChange = (id: string, newStage: AdmissionLead['stage']) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, stage: newStage } : l));
  };

  const handleToggleDocVerify = (id: string) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, documentsVerified: !l.documentsVerified } : l));
  };

  const handleCreateLead = (e: React.FormEvent) => {
    e.preventDefault();
    const id = `ADM-2026-${String(leads.length + 1).padStart(3, '0')}`;
    const created: AdmissionLead = {
      id,
      studentName: newLead.studentName,
      parentName: newLead.parentName,
      phone: newLead.phone,
      email: newLead.email,
      gradeApplying: newLead.gradeApplying,
      source: newLead.source,
      stage: 'Enquiry',
      leadScore: 75,
      documentsVerified: false,
      notes: newLead.notes || 'New enquiry captured via CRM.',
      createdAt: new Date().toISOString().split('T')[0]
    };
    setLeads([created, ...leads]);
    setShowAddModal(false);
    setNewLead({ studentName: '', parentName: '', phone: '', email: '', gradeApplying: 'Grade 1', source: 'Website Form', notes: '' });
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1240px', margin: '0 auto' }}>
      {/* Header & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <Sparkles size={14} /> EduConnect Admissions · Simulation with sample data
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', margin: '4px 0 6px', letterSpacing: '-0.02em' }}>
            Admissions Pipeline &amp; Enquiry Funnel
          </h1>
          <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>
            Automated lead scoring, document verification, and 1-click student registration.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: '#16a34a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '9999px',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(22, 163, 74, 0.2)'
            }}
          >
            <Plus size={16} /> New Enquiry
          </button>
        </div>
      </div>

      {/* Pipeline Stage Pills Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <button
          onClick={() => setSelectedStage('All')}
          style={{
            background: selectedStage === 'All' ? '#0f172a' : '#ffffff',
            color: selectedStage === 'All' ? '#ffffff' : '#0f172a',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px 16px',
            textAlign: 'left',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 600, opacity: 0.8 }}>All Pipeline Leads</div>
          <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px' }}>{leads.length}</div>
        </button>
        {STAGES.map(stage => (
          <button
            key={stage}
            onClick={() => setSelectedStage(stage)}
            style={{
              background: selectedStage === stage ? '#16a34a' : '#ffffff',
              color: selectedStage === stage ? '#ffffff' : '#0f172a',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '14px 16px',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 600, opacity: 0.8 }}>{stage}</div>
            <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px' }}>{countsByStage[stage] || 0}</div>
          </button>
        ))}
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center', background: '#ffffff', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <Search size={18} color="#94a3b8" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by student name, parent name, or enquiry ID..."
          style={{ border: 'none', outline: 'none', width: '100%', fontSize: '14px' }}
        />
      </div>

      {/* Leads Table / Cards */}
      <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}>
                <th style={{ padding: '14px 18px' }}>Enquiry ID &amp; Student</th>
                <th style={{ padding: '14px 18px' }}>Parent &amp; Contact</th>
                <th style={{ padding: '14px 18px' }}>Grade</th>
                <th style={{ padding: '14px 18px' }}>Lead Score</th>
                <th style={{ padding: '14px 18px' }}>Docs Verified</th>
                <th style={{ padding: '14px 18px' }}>Current Stage</th>
                <th style={{ padding: '14px 18px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map(lead => (
                <tr key={lead.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{lead.studentName}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>{lead.id} • {lead.source}</div>
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ color: '#334155' }}>{lead.parentName}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{lead.phone}</div>
                  </td>
                  <td style={{ padding: '14px 18px', fontWeight: 600, color: '#0f172a' }}>
                    {lead.gradeApplying}
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      fontSize: '11px',
                      fontWeight: 700,
                      background: lead.leadScore >= 90 ? '#dcfce7' : lead.leadScore >= 75 ? '#fef9c3' : '#fee2e2',
                      color: lead.leadScore >= 90 ? '#15803d' : lead.leadScore >= 75 ? '#854d0e' : '#b91c1c'
                    }}>
                      <Sparkles size={11} /> {lead.leadScore}%
                    </span>
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <button
                      onClick={() => handleToggleDocVerify(lead.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        border: 'none',
                        background: lead.documentsVerified ? '#f0fdf4' : '#f8fafc',
                        color: lead.documentsVerified ? '#16a34a' : '#94a3b8',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      {lead.documentsVerified ? <ShieldCheck size={14} /> : <AlertCircle size={14} />}
                      {lead.documentsVerified ? 'Verified' : 'Pending'}
                    </button>
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <select
                      value={lead.stage}
                      onChange={e => handleStageChange(lead.id, e.target.value as any)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '12px',
                        fontWeight: 600,
                        background: '#ffffff',
                        color: '#0f172a'
                      }}
                    >
                      {STAGES.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                    {lead.stage === 'Enrolled' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#16a34a', fontWeight: 600, fontSize: '12px' }}>
                        <Check size={14} /> Admitted to SIS
                      </span>
                    ) : (
                      <button
                        onClick={() => handleStageChange(lead.id, 'Enrolled')}
                        style={{
                          background: '#16a34a',
                          color: '#ffffff',
                          border: 'none',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        Enroll <ArrowRight size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Enquiry Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 100,
          padding: '16px'
        }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '500px', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>Capture New Admission Enquiry</h3>
              <button onClick={() => setShowAddModal(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}>✕</button>
            </div>
            <form onSubmit={handleCreateLead} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Student Full Name</label>
                <input
                  required
                  value={newLead.studentName}
                  onChange={e => setNewLead({ ...newLead, studentName: e.target.value })}
                  placeholder="e.g. Vivaan Kapoor"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Parent / Guardian Name</label>
                  <input
                    required
                    value={newLead.parentName}
                    onChange={e => setNewLead({ ...newLead, parentName: e.target.value })}
                    placeholder="e.g. Sanjay Kapoor"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Applying for Grade</label>
                  <select
                    value={newLead.gradeApplying}
                    onChange={e => setNewLead({ ...newLead, gradeApplying: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                  >
                    <option value="Kindergarten">Kindergarten</option>
                    <option value="Grade 1">Grade 1</option>
                    <option value="Grade 2">Grade 2</option>
                    <option value="Grade 5">Grade 5</option>
                    <option value="Grade 6">Grade 6</option>
                    <option value="Grade 9">Grade 9</option>
                    <option value="Grade 11">Grade 11</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Phone Number</label>
                  <input
                    required
                    value={newLead.phone}
                    onChange={e => setNewLead({ ...newLead, phone: e.target.value })}
                    placeholder="+91 98000 00000"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Enquiry Source</label>
                  <select
                    value={newLead.source}
                    onChange={e => setNewLead({ ...newLead, source: e.target.value as any })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                  >
                    <option value="Website Form">Website Form</option>
                    <option value="Walk-in">Walk-in</option>
                    <option value="Referral">Referral</option>
                    <option value="Social Campaign">Social Campaign</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: '#16a34a', color: '#ffffff', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                >
                  Save Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
