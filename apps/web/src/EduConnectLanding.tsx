import React, { useState } from 'react';
import {
  ArrowRight, CheckCircle2, ShieldCheck, Sparkles,
  Users, DollarSign, Calendar, Bus, BookOpen, Layers, Menu, X,
  Phone, Mail, Building2, ChevronRight, Star, PlayCircle
} from 'lucide-react';
import './educonnect.css';
import EduConnectBrand from './EduConnectBrand';

interface EduConnectLandingProps {
  onOpenDemo: () => void;
  onGoToLogin: () => void;
  onExploreModule: (moduleKey: string) => void;
}

export default function EduConnectLanding({ onOpenDemo, onGoToLogin, onExploreModule }: EduConnectLandingProps) {
  const [activeTab, setActiveTab] = useState<'admissions' | 'academics' | 'fees' | 'attendance' | 'transport'>('admissions');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 1. Top Announcement Header */}
      <div style={{ background: '#09131f', color: '#cbd5e1', fontSize: '12px', padding: '8px 24px', textAlign: 'center', fontWeight: 500 }}>
        <span style={{ color: '#22c55e', fontWeight: 700, marginRight: '6px' }}>PRODUCT PREVIEW:</span>
        Sample interface only. SMS, biometric, GPS and delivery integrations are not connected.{' '}
        <button
          onClick={onOpenDemo}
          style={{ background: 'transparent', border: 'none', color: '#22c55e', textDecoration: 'underline', cursor: 'pointer', fontWeight: 600, padding: 0 }}
        >
          Contact CalmStacks →
        </button>
      </div>

      {/* 2. Main Navigation Bar */}
      <header className="edu-header">
        <div className="edu-container edu-header-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
            <a href="/" className="edu-brand-link" aria-label="EduConnect home">
              <EduConnectBrand compact className="landing-brand" />
            </a>
            <nav className="edu-nav-links" style={{ display: mobileMenuOpen ? 'none' : undefined }}>
              <span className="edu-nav-item" onClick={() => onExploreModule('admissions')}>Admissions CRM</span>
              <span className="edu-nav-item" onClick={() => onExploreModule('academics')}>Exams &amp; Homework</span>
              <span className="edu-nav-item" onClick={() => onExploreModule('fees')}>Fee Accounts</span>
              <span className="edu-nav-item" onClick={() => onExploreModule('attendance')}>Attendance &amp; Staff</span>
              <span className="edu-nav-item" onClick={() => onExploreModule('transport')}>Transport Management</span>
            </nav>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={onGoToLogin} className="edu-btn-secondary">
              Sign in
            </button>
            <button onClick={onOpenDemo} className="edu-btn-primary">
              Request a Walkthrough
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* 3. Hero Section */}
      <section className="edu-hero">
        <div className="edu-container">
          <div className="edu-badge-mono">
            <Sparkles size={13} /> School operations, connected
          </div>
          <h1 className="edu-hero-title">
            One connected workspace for <span className="gradient-text">school teams and families.</span>
          </h1>
          <p className="edu-hero-subtitle">
            Say goodbye to fragmented spreadsheets and legacy desktop software. EduConnect brings school administration, academics, and family workspaces together.
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginBottom: '40px' }}>
            <button onClick={onOpenDemo} className="edu-btn-primary" style={{ padding: '14px 28px', fontSize: '15px' }}>
              Request 1-on-1 School Demo
              <ArrowRight size={18} />
            </button>
            <button onClick={onGoToLogin} className="edu-btn-secondary" style={{ padding: '14px 24px', fontSize: '15px' }}>
              Launch ERP Workspace
            </button>
          </div>

          {/* Interactive Preview Tabs */}
          <div className="edu-tab-strip">
            <button className={`edu-tab-pill ${activeTab === 'admissions' ? 'active' : ''}`} onClick={() => setActiveTab('admissions')}>
              01. Admissions Funnel
            </button>
            <button className={`edu-tab-pill ${activeTab === 'academics' ? 'active' : ''}`} onClick={() => setActiveTab('academics')}>
              02. Exams &amp; Homework
            </button>
            <button className={`edu-tab-pill ${activeTab === 'fees' ? 'active' : ''}`} onClick={() => setActiveTab('fees')}>
              03. Fee Reconciliation
            </button>
            <button className={`edu-tab-pill ${activeTab === 'attendance' ? 'active' : ''}`} onClick={() => setActiveTab('attendance')}>
              04. Attendance
            </button>
            <button className={`edu-tab-pill ${activeTab === 'transport' ? 'active' : ''}`} onClick={() => setActiveTab('transport')}>
              05. Transport Preview
            </button>
          </div>

          {/* Dynamic Interactive Stage Card */}
          <div className="edu-stage-card">
            <div className="edu-stage-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="edu-traffic-lights">
                  <div className="edu-traffic-dot" style={{ background: '#ef4444' }} />
                  <div className="edu-traffic-dot" style={{ background: '#f59e0b' }} />
                  <div className="edu-traffic-dot" style={{ background: '#10b981' }} />
                </div>
                <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#64748b' }}>
                  educonnect.school.workspace // {activeTab.toUpperCase()}
                </span>
              </div>
              <button
                onClick={() => onExploreModule(activeTab)}
                style={{ background: 'transparent', border: 'none', color: '#16a34a', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                Explore interactive preview <ArrowRight size={13} />
              </button>
            </div>

            {/* Simulated Product Preview */}
            <div style={{ padding: '24px' }}>
              {activeTab === 'admissions' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Lead Pipeline &amp; Conversion Tracker</h3>
                      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>128 new enquiries captured this term with automated WhatsApp nurturing</p>
                    </div>
                    <span style={{ background: '#dcfce7', color: '#15803d', fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '9999px' }}>
                      +34% Conversion vs 2025
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>ENQUIRY CAPTURE</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>64 Leads</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>ASSESSMENT TEST</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#0284c7', marginTop: '4px' }}>28 Scheduled</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>PROVISIONAL OFFER</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#eab308', marginTop: '4px' }}>19 Sent</div>
                    </div>
                    <div style={{ background: '#f0fdf4', padding: '14px', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
                      <div style={{ fontSize: '11px', color: '#15803d', fontWeight: 600 }}>CONFIRMED ENROLLED</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>17 Admitted</div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'academics' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>CBSE Board-Ready Gradebook &amp; Report Generator</h3>
                      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Term 2 Periodic Assessments compiled across all subjects</p>
                    </div>
                    <span style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '9999px' }}>
                      Auto-Grade Calculator Active
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>CLASS AVERAGE</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>78.4% Overall</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>TOP PERFORMING</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>Mathematics (84%)</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>REPORT CARDS</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#0284c7', marginTop: '4px' }}>1-Click PDF Ready</div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'fees' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Real-Time Fee Invoicing &amp; Instant UPI Receipts</h3>
                      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Reconciled automatically with Tally ERP and digital payment gateways</p>
                    </div>
                    <span style={{ background: '#dcfce7', color: '#15803d', fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '9999px' }}>
                      98.2% Timely Collection
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>TOTAL COLLECTED (Q4)</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>₹ 42,80,000</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>PENDING OUTSTANDING</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#ea580c', marginTop: '4px' }}>₹ 1,12,000</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>AUTO REMINDERS</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>Preview data</div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'attendance' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Attendance Preview</h3>
                      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Sample interface. Biometric hardware and SMS delivery are not connected.</p>
                    </div>
                    <span style={{ background: '#dcfce7', color: '#15803d', fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '9999px' }}>
                      Today: 95.8% Present
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>PRESENT TODAY</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>1,152 Students</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>UNEXCUSED ABSENT</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626', marginTop: '4px' }}>14 Students (Alerted)</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>STAFF ATTENDANCE</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>62 / 64 Faculty Present</div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'transport' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Transport Preview · Sample Data</h3>
                      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Parents receive dynamic notification 5 minutes before bus arrives at their stop</p>
                    </div>
                    <span style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '9999px' }}>
                      12 / 12 Buses On-Time
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>SPEED MONITORING</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>Zero Over-speeding</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>RFID BOARDING</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>410 Students Boarded</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>SAFETY PROTOCOL</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#0284c7', marginTop: '4px' }}>CCTV &amp; SOS Active</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 4. Core Modules Feature Grid */}
      <section className="edu-features-section">
        <div className="edu-container">
          <div style={{ textAlign: 'center', marginBottom: '50px' }}>
            <div className="edu-badge-mono">Complete Enterprise Modules</div>
            <h2 style={{ fontSize: '36px', fontWeight: 800, color: '#0f172a', margin: '12px 0 8px' }}>
              Everything your institution needs, built natively into one suite.
            </h2>
            <p style={{ color: '#64748b', fontSize: '16px', maxWidth: '640px', margin: '0 auto' }}>
              Engineered for CBSE, ICSE, State Boards, and International School chains.
            </p>
          </div>

          <div className="edu-grid-3">
            <div className="edu-feature-card">
              <div className="edu-feature-icon"><Users size={26} /></div>
              <h3 style={{ fontSize: '19px', fontWeight: 700, margin: '0 0 10px' }}>Admissions CRM</h3>
              <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6, flexGrow: 1, margin: '0 0 20px' }}>
                Multi-channel inquiry capture, automated lead scoring, document vault, and one-click student admission into the SIS.
              </p>
              <button onClick={() => onExploreModule('admissions')} style={{ border: 'none', background: 'transparent', color: '#16a34a', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }}>
                Explore Admissions CRM <ChevronRight size={15} />
              </button>
            </div>

            <div className="edu-feature-card">
              <div className="edu-feature-icon"><DollarSign size={26} /></div>
              <h3 style={{ fontSize: '19px', fontWeight: 700, margin: '0 0 10px' }}>Smart Fee Management</h3>
              <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6, flexGrow: 1, margin: '0 0 20px' }}>
                Flexible fee structures, automatic WhatsApp reminders, online UPI/card payments, and bi-directional Tally ERP integration.
              </p>
              <button onClick={() => onExploreModule('fees')} style={{ border: 'none', background: 'transparent', color: '#16a34a', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }}>
                Explore Fee Operations <ChevronRight size={15} />
              </button>
            </div>

            <div className="edu-feature-card">
              <div className="edu-feature-icon"><BookOpen size={26} /></div>
              <h3 style={{ fontSize: '19px', fontWeight: 700, margin: '0 0 10px' }}>Exams &amp; Board Report Cards</h3>
              <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6, flexGrow: 1, margin: '0 0 20px' }}>
                Board-compliant grading rubrics (CBSE/ICSE), automated marks calculation, and 1-click batch report card PDF generation.
              </p>
              <button onClick={() => onExploreModule('academics')} style={{ border: 'none', background: 'transparent', color: '#16a34a', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }}>
                Explore Exam Suite <ChevronRight size={15} />
              </button>
            </div>

            <div className="edu-feature-card">
              <div className="edu-feature-icon"><Calendar size={26} /></div>
              <h3 style={{ fontSize: '19px', fontWeight: 700, margin: '0 0 10px' }}>Attendance &amp; Staff HR</h3>
              <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6, flexGrow: 1, margin: '0 0 20px' }}>
                Attendance workflows; hardware, SMS, and payroll integrations require provider setup.
              </p>
              <button onClick={() => onExploreModule('attendance')} style={{ border: 'none', background: 'transparent', color: '#16a34a', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }}>
                Explore Attendance Suite <ChevronRight size={15} />
              </button>
            </div>

            <div className="edu-feature-card">
              <div className="edu-feature-icon"><Bus size={26} /></div>
              <h3 style={{ fontSize: '19px', fontWeight: 700, margin: '0 0 10px' }}>Transport Preview Tracking</h3>
              <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6, flexGrow: 1, margin: '0 0 20px' }}>
                Sample route interface only. GPS tracking, RFID boarding, and parent alerts are unavailable.
              </p>
              <button onClick={() => onExploreModule('transport')} style={{ border: 'none', background: 'transparent', color: '#16a34a', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }}>
                Explore Fleet Safety <ChevronRight size={15} />
              </button>
            </div>

            <div className="edu-feature-card">
              <div className="edu-feature-icon"><Layers size={26} /></div>
              <h3 style={{ fontSize: '19px', fontWeight: 700, margin: '0 0 10px' }}>Parent &amp; Student Mobile App</h3>
              <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6, flexGrow: 1, margin: '0 0 20px' }}>
                Branded iOS &amp; Android apps providing instant homework access, digital fee payments, circulars, and direct teacher chat.
              </p>
              <button onClick={onGoToLogin} style={{ border: 'none', background: 'transparent', color: '#16a34a', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }}>
                Open Mobile Portals <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Product principles */}
      <section style={{ background: '#0c1e33', color: '#ffffff', padding: '64px 0' }}>
        <div className="edu-container">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '32px', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: '42px', fontWeight: 900, color: '#22c55e', letterSpacing: '-0.02em' }}>New product</div>
              <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '6px' }}>Independent school workspaces</div>
            </div>
            <div>
              <div style={{ fontSize: '42px', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.02em' }}>Tenant scoped</div>
              <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '6px' }}>School-scoped access</div>
            </div>
            <div>
              <div style={{ fontSize: '42px', fontWeight: 900, color: '#22c55e', letterSpacing: '-0.02em' }}>Designed for</div>
              <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '6px' }}>Secure operations</div>
            </div>
            <div>
              <div style={{ fontSize: '42px', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.02em' }}>School teams</div>
              <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '6px' }}>One connected platform</div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Footer */}
      <footer style={{ background: '#09131f', color: '#64748b', padding: '40px 0 24px', fontSize: '13px' }}>
        <div className="edu-container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <EduConnectBrand inverse compact className="landing-footer-brand" />
            <span>— School operations, connected</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
