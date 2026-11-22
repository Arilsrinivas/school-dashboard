import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Activity, ArrowDownRight, ArrowUpRight, Award, BarChart3, Bell, BookOpen, Building2, CalendarCheck, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock, Clock3, CreditCard, Download, FileText, Filter, GraduationCap, Layers, LayoutDashboard, LogOut, Menu, MoreHorizontal, Plus, Receipt, Search, Settings, Settings2, ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles, UserCheck, UserPlus, Users, X } from 'lucide-react';
import { acceptInvitation, exportCsv, login, loginWithGoogle, linkGoogleAccount, logout, request, restoreSession, sendFirebasePasswordReset, type School, type User, type GoogleAuthResult } from './api';
const AttendanceWorkspace = lazy(() => import('./AttendanceWorkspace'));
const HomeworkWorkspace = lazy(() => import('./HomeworkWorkspace'));
const ExamsWorkspace = lazy(() => import('./ExamsWorkspace'));
const TimetableWorkspace = lazy(() => import('./TimetableWorkspace'));
const FeesWorkspace = lazy(() => import('./FeesWorkspace'));
const AnnouncementsWorkspace = lazy(() => import('./AnnouncementsWorkspace'));
const ReportsWorkspace = lazy(() => import('./ReportsWorkspace'));
const SettingsWorkspace = lazy(() => import('./SettingsWorkspace'));
const NotificationBell = lazy(() => import('./NotificationBell'));
import EduConnectLanding from './EduConnectLanding';
import EduConnectBrand from './EduConnectBrand';
import { useFirebaseAuth } from './auth/firebase';
import { firebaseConfigured, firebaseConfigurationError } from './auth/firebase';
import StudentDocuments from './StudentDocuments';
const AdmissionsWorkspace = lazy(() => import('./AdmissionsWorkspace'));
const TransportWorkspace = lazy(() => import('./TransportWorkspace'));

type Overview={schools:{total_schools:number;active_schools:number;suspended_schools:number;pending_schools:number};total_users:number;total_students:number;total_teachers:number;total_parents:number;growth:{month:string;schools:number}[]};
type Plans={items:{id:string;name:string;billing_interval:string;price_minor:number|null;currency:string}[]};
const createSchema=z.object({name:z.string().min(2,'Enter the school name'),address:z.string(),contactEmail:z.string().email(),contactPhone:z.string(),principalName:z.string(),schoolType:z.string().min(1),website:z.union([z.string().url(),z.literal('')]),academicYearLabel:z.string(),planId:z.string().uuid('Choose a plan'),administratorName:z.string().min(2,'Enter the administrator name'),administratorEmail:z.string().email()});
type CreateValues=z.infer<typeof createSchema>;
const dateLabel=(value:string)=>new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value));
const money=(minor:number|null,currency='INR')=>minor===null?'Configured per contract':new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:0}).format(minor/100);

export default function App(){
  const location=useLocation();
  const firebaseState=useFirebaseAuth();
  const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false);
  const [view, setView] = useState<'landing' | 'portal' | 'admissions' | 'transport'>('landing');
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(()=>{
    const path=location.pathname;
    const page=path==='/accept-invitation'?'Accept invitation'
      :path==='/recover-account'?'Account recovery'
      :path==='/schools'?'Schools'
      :path==='/activity'?'Activity log'
      :path==='/team'?'Support team'
      :view==='admissions'?'Admissions preview'
      :view==='transport'?'Transport preview'
      :user?.role==='super_admin'?'Platform administration'
      :user?.role==='support_agent'?'Support workspace'
      :user?'School workspace'
      :view==='portal'?'Sign in'
      :'School management';
    document.title=`${page} | EduConnect`;
  },[location.pathname,view,user?.role]);

  useEffect(()=>{if(firebaseState.configured&&!firebaseState.ready)return;restoreSession().then(async ok=>{if(ok){try{const me=await request<{user:User}>('/api/auth/me');setUser(me.user);}catch{await logout();}}setReady(true);});},[firebaseState.configured,firebaseState.ready]);
  if(window.location.pathname==='/accept-invitation')return <InvitationPage/>;
  if(window.location.pathname==='/recover-account')return <RecoveryPage/>;
  if(!ready)return <div className="grid min-h-screen place-items-center text-sm text-muted">Opening your workspace…</div>;

  if (user) {
    return <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-muted">Opening your workspace…</div>}>
      {user.role==='super_admin' ? (
        <ControlPanel user={user} onLogout={async()=>{await logout();setUser(null);}}/>
      ) : user.role==='support_agent' ? (
        <SupportConsole user={user} onLogout={async()=>{await logout();setUser(null);}}/>
      ) : (
        <SchoolWorkspace user={user} onLogout={async()=>{await logout();setUser(null);}}/>
      )}
    </Suspense>;
  }

  // EduConnect public experience and portal router
  if (view === 'admissions') {
    return (
      <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-muted">Opening Admissions…</div>}><div>
        <div style={{ background: '#09131f', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#ffffff', fontWeight: 700, fontSize: '15px' }}>EduConnect Admissions // Simulation with sample data</div>
          <button onClick={() => setView('landing')} className="edu-btn-secondary" style={{ padding: '6px 14px', fontSize: '12px' }}>
            ← Back to Home
          </button>
        </div>
        <AdmissionsWorkspace />
      </div></Suspense>
    );
  }

  if (view === 'transport') {
    return (
      <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-muted">Opening Transport…</div>}><div>
        <div style={{ background: '#09131f', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#ffffff', fontWeight: 700, fontSize: '15px' }}>EduConnect Transport // Simulation with sample data; GPS is not connected</div>
          <button onClick={() => setView('landing')} className="edu-btn-secondary" style={{ padding: '6px 14px', fontSize: '12px' }}>
            ← Back to Home
          </button>
        </div>
        <TransportWorkspace />
      </div></Suspense>
    );
  }

  if (view === 'portal') {
    return (
      <div>
        <div style={{ background: '#09131f', padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '13px' }}>EduConnect // School workspace sign in</div>
          <button onClick={() => setView('landing')} style={{ background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '12px' }}>
            ← Return to EduConnect Home
          </button>
        </div>
        <AuthPortal onLogin={setUser}/>
      </div>
    );
  }

  return (
    <>
      <EduConnectLanding
        onOpenDemo={() => setDemoOpen(true)}
        onGoToLogin={() => setView('portal')}
        onExploreModule={(mod) => {
          if (mod === 'admissions') setView('admissions');
          else if (mod === 'transport') setView('transport');
          else setView('portal');
        }}
      />
      {demoOpen && (
        <EduConnectContactModal onClose={() => setDemoOpen(false)} />
      )}
    </>
  );
}

function EduConnectContactModal({ onClose }: { onClose: () => void }) {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: '',
    schoolName: '',
    phone: '',
    role: 'Principal / Director',
    studentCount: '500 - 1000 Students',
    notes: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="edu-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="edu-modal-card">
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img className="brand-mark contact-brand-mark" src="/brand/educonnect-mark.svg" alt="" aria-hidden="true" />
            <strong style={{ fontSize: '16px', color: '#0f172a' }}>Contact CalmStacks about EduConnect</strong>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}>
            <X size={18} />
          </button>
        </div>

        {submitted ? (
          <div style={{ padding: '36px 24px', textAlign: 'center' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#dcfce7', color: '#16a34a', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
              <Check size={28} />
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 8px', color: '#0f172a' }}>Walkthrough request draft</h3>
            <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 24px' }}>
              This preview does not send or retain requests. Use your approved CalmStacks contact channel to arrange an EduConnect walkthrough for <strong>{form.schoolName}</strong>.
            </p>
            <button onClick={onClose} className="edu-btn-primary" style={{ width: '100%' }}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Your Full Name</label>
              <input
                required
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Dr. Anand Verma"
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Official School Name</label>
              <input
                required
                value={form.schoolName}
                onChange={e => setForm({ ...form, schoolName: e.target.value })}
                placeholder="Delhi Public School / St. Xavier's Academy"
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Mobile Number (WhatsApp)</label>
                <input
                  required
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91 98000 00000"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Your Role</label>
                <select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                >
                  <option value="Principal / Director">Principal / Director</option>
                  <option value="School Chairman / Trustee">School Chairman / Trustee</option>
                  <option value="Administrator">Administrator</option>
                  <option value="IT Incharge">IT Incharge</option>
                  <option value="Accountant">Accountant</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Student Strength</label>
              <select
                value={form.studentCount}
                onChange={e => setForm({ ...form, studentCount: e.target.value })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
              >
                <option value="Under 500 Students">Under 500 Students</option>
                <option value="500 - 1000 Students">500 - 1000 Students</option>
                <option value="1000 - 2500 Students">1000 - 2500 Students</option>
                <option value="2500+ Students (School Chain)">2500+ Students (School Chain)</option>
              </select>
            </div>
            <button type="submit" className="edu-btn-primary" style={{ width: '100%', marginTop: '6px', borderRadius: '8px' }}>
              Save walkthrough draft
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
    </svg>
  );
}

function AuthPortal({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<'register' | 'login'>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'login') return 'login';
    if (params.get('mode') === 'register') return 'register';
    return localStorage.getItem('educonnect_has_account') ? 'login' : 'register';
  });

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginSchoolId, setLoginSchoolId] = useState('');
  const [kind, setKind] = useState<'platform' | 'school'>('school');

  // Register form state
  const [schoolName, setSchoolName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Role context selector
  const [selectedRole, setSelectedRole] = useState<'all' | 'admin' | 'teacher' | 'parent' | 'student'>('all');

  // Google modal state
  const [googleOpen, setGoogleOpen] = useState(false);
  const [googleEmail, setGoogleEmail] = useState('arilsrinivas8@gmail.com');
  const [googleName, setGoogleName] = useState('Aril Srinivas');

  // Account linking state (Requirement 4)
  const [linkingState, setLinkingState] = useState<{ email: string; name: string; token: string } | null>(null);
  const [linkingPassword, setLinkingPassword] = useState('');
  const [linkingError, setLinkingError] = useState('');

  // Multi-school selection state (Requirement 5)
  const [multiSchoolState, setMultiSchoolState] = useState<{
    token: string;
    schools: Array<{ id: string; schoolId: string; name: string; role: string; schoolRole?: string; schoolRoleName?: string }>;
  } | null>(null);

  // Access denied / invitation required state (Requirement 5)
  const [accessDeniedModal, setAccessDeniedModal] = useState<{ email: string; name: string } | null>(null);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function executeGoogleToken(token: string, schoolId?: string) {
    setBusy(true);
    setError('');
    try {
      const result: GoogleAuthResult = await loginWithGoogle({ credential: token, schoolId });
      if (result.type === 'success') {
        localStorage.setItem('educonnect_has_account', 'true');
        setGoogleOpen(false);
        setLinkingState(null);
        setMultiSchoolState(null);
        setAccessDeniedModal(null);
        onLogin(result.user);
      } else if (result.type === 'requiresLinking') {
        setGoogleOpen(false);
        setLinkingPassword('');
        setLinkingError('');
        setLinkingState({ email: result.email, name: result.name, token: result.firebaseCredential??token });
      } else if (result.type === 'requireSchoolSelection') {
        setGoogleOpen(false);
        setMultiSchoolState({ token, schools: result.schools });
      }
    } catch (ex) {
      const err = ex as any;
      if (err.code === 'access_denied' || err.message?.includes('access_denied') || err.message?.includes('No EduConnect account found')) {
        setGoogleOpen(false);
        setAccessDeniedModal({ email: googleEmail, name: googleName });
      } else {
        setError(err.message || 'Authentication failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!linkingState) return;
    setBusy(true);
    setLinkingError('');
    try {
      const res = await linkGoogleAccount({
        credential: linkingState.token,
        password: linkingPassword,
        schoolId:loginSchoolId||undefined,
      });
      if (res.user) {
        localStorage.setItem('educonnect_has_account', 'true');
        setLinkingState(null);
        onLogin(res.user);
      } else {
        await executeGoogleToken(linkingState.token);
      }
    } catch (ex) {
      setLinkingError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await login(loginEmail, loginPassword, kind === 'school' ? (loginSchoolId || undefined) : undefined, kind);
      localStorage.setItem('educonnect_has_account', 'true');
      onLogin(u);
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleClick() {
    setError('');
    if(!firebaseConfigured){setError(firebaseConfigurationError);return;}
    await executeGoogleToken('firebase');
  }

  return (
    <main className="login-wrap">
      <section className="login-art">
        <EduConnectBrand inverse />
        <div className="art-copy">
          <div className="eyebrow-light"><span className="eyebrow-dot" /> MODERN SCHOOL PLATFORM</div>
          <h1 style={{ whiteSpace: 'pre-line' }}>{mode === 'register' ? 'Launch your school\nin seconds.' : 'Good schools\ngrow together.'}</h1>
          <p>{mode === 'register' ? 'Set up an institutional workspace for student records, attendance, assignments, examinations, and fee accounts.' : 'A clear workspace for school teams, families, and students.'}</p>
          <div className="art-mini">
            <ShieldCheck size={16}/>
            <span>School access follows your assigned role and membership.</span>
          </div>
        </div>
        <div className="art-footer">
          <span>Powered by CalmStacks</span>
          <span>01 — 05</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <EduConnectBrand compact className="mobile-brand" />

          <div className="auth-mode-toggle">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => { setMode('login'); setError(''); }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              onClick={() => { setMode('register'); setError(''); }}
            >
              Onboard Institution
            </button>
          </div>

          {mode === 'login' && (
            <div className="role-pills-row" style={{ marginTop: '10px', marginBottom: '14px' }}>
              <button type="button" className={`role-pill ${selectedRole === 'all' ? 'active' : ''}`} onClick={() => setSelectedRole('all')}>All Roles</button>
              <button type="button" className={`role-pill ${selectedRole === 'admin' ? 'active' : ''}`} onClick={() => setSelectedRole('admin')}>School Admin</button>
              <button type="button" className={`role-pill ${selectedRole === 'teacher' ? 'active' : ''}`} onClick={() => setSelectedRole('teacher')}>Teacher</button>
              <button type="button" className={`role-pill ${selectedRole === 'parent' ? 'active' : ''}`} onClick={() => setSelectedRole('parent')}>Parent</button>
              <button type="button" className={`role-pill ${selectedRole === 'student' ? 'active' : ''}`} onClick={() => setSelectedRole('student')}>Student</button>
            </div>
          )}

          <div className="eyebrow">
            {mode === 'register'
              ? 'NEW INSTITUTION'
              : selectedRole === 'admin'
              ? 'ADMINISTRATOR PORTAL'
              : selectedRole === 'teacher'
              ? 'FACULTY ACCESS'
              : selectedRole === 'parent'
              ? 'PARENT PORTAL'
              : selectedRole === 'student'
              ? 'STUDENT PORTAL'
              : 'SECURE SIGN IN'}
          </div>
          <h2>
            {mode === 'register'
              ? 'Create school workspace'
              : selectedRole === 'admin'
              ? 'Administrator Login'
              : selectedRole === 'teacher'
              ? 'Teacher Portal'
              : selectedRole === 'parent'
              ? 'Parent Portal'
              : selectedRole === 'student'
              ? 'Student Portal'
              : 'Welcome back'}
          </h2>
          <p className="subtle">
            {mode === 'register'
              ? 'Start with a verified school workspace in under 30 seconds.'
              : selectedRole === 'admin'
              ? 'Manage school administration, staff, academics, and finances.'
              : selectedRole === 'teacher'
              ? 'Take daily attendance, publish homework, and submit exam results.'
              : selectedRole === 'parent'
              ? 'Track your child’s daily attendance, homework, and report cards.'
              : selectedRole === 'student'
              ? 'Review your class timetable, assigned homework, and grades.'
              : 'Sign in to access your school or platform dashboard.'}
          </p>

          {mode === 'login' ? (
            <>
              <button
                type="button"
                className="google-btn"
                onClick={() => void handleGoogleClick()}
                disabled={busy}
              >
                <GoogleIcon />
                <span>Continue with Google</span>
              </button>

              <div className="auth-divider">
                <span>or use credentials</span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: '12px', color: '#475569', marginBottom: '16px', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={18} color="#16a34a" style={{ flexShrink: 0 }} />
              <span>Registering creates your school workspace &amp; administrator account. You can link Google Sign-In right after.</span>
            </div>
          )}

          {mode === 'register' ? (
            <div style={{ padding: '0.75rem 0' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#0f172a', fontWeight: 600, marginBottom: '6px' }}>
                  <Building2 size={20} color="#16a34a" />
                  CalmStacks Managed Onboarding
                </div>
                <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5, margin: 0 }}>
                  To ensure enterprise-grade tenant isolation, data protection, and verified accreditation, new school workspaces are provisioned by the CalmStacks platform team.
                </p>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                If your institution has already been registered, your designated administrator received an activation invitation via email. You can also use the account recovery workflow below to access your workspace.
              </div>
              <button
                type="button"
                className="btn btn-primary btn-wide"
                onClick={() => { setMode('login'); setError(''); }}
              >
                Return to Sign In
                <ChevronRight size={17} />
              </button>
            </div>
          ) : (
            <>
              <div className="auth-switch">
                <button
                  type="button"
                  className={kind === 'school' ? 'selected' : ''}
                  onClick={() => setKind('school')}
                >
                  School account
                </button>
                <button
                  type="button"
                  className={kind === 'platform' ? 'selected' : ''}
                  onClick={() => setKind('platform')}
                >
                  Platform team
                </button>
              </div>
              <form onSubmit={handleLoginSubmit} className="form-stack">
                {kind === 'school' && (
                  <label>
                    School ID <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional if using admin email)</span>
                    <input
                      value={loginSchoolId}
                      onChange={e => setLoginSchoolId(e.target.value)}
                      placeholder="e.g. CS-SCH-0001"
                    />
                  </label>
                )}
                <label>
                  Email address
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="username"
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                {error && <div className="error-banner">{error}</div>}
                <button className="btn btn-primary btn-wide" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                  <ChevronRight size={17} />
                </button>
                <div style={{ marginTop: '0.4rem', textAlign: 'center', fontSize: '11px', color: '#64748b' }}>
                  First time here?{' '}
                  <button
                    type="button"
                    style={{ border: 0, background: 'transparent', color: '#16a34a', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => { setMode('register'); setError(''); }}
                  >
                    Register your school
                  </button>
                </div>
              </form>
              <div className="recovery-link">
                <a href={`/recover-account?kind=${kind}${loginSchoolId ? `&schoolId=${encodeURIComponent(loginSchoolId)}` : ''}`}>
                  Forgot password?
                </a>
              </div>
            </>
          )}

          <div className="login-note">
            <ShieldCheck size={16} /> Protected by role and school access controls
          </div>
        </div>

        <div className="login-bottom">
          <span>© 2026 EduConnect</span>
          <span className="quiet-link">
            <CircleHelp size={14} /> Need help? Contact your school administrator
          </span>
        </div>
      </section>

      {/* 2. Account Linking & Password Proof Modal (Requirement 4) */}
      {linkingState && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setLinkingState(null); }}>
          <section className="modal" style={{ maxWidth: '440px' }}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#eef2ff', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: '17px', margin: 0 }}>Link Google Account</h2>
                  <p style={{ fontSize: '11px', margin: 0, color: '#64748b' }}>Account verification required</p>
                </div>
              </div>
              <button type="button" className="icon-button" onClick={() => setLinkingState(null)}>
                <X size={19} />
              </button>
            </div>
            <form onSubmit={handleLinkSubmit} style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '12px', color: '#334155', lineHeight: 1.5, background: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                An existing EduConnect account was found for <b>{linkingState.email}</b>. To link Google Sign-In, please verify your current password:
              </div>
              <label style={{ display: 'grid', gap: '5px', fontSize: '11px', color: '#475569', fontWeight: 600 }}>
                EduConnect Password
                <input
                  type="password"
                  value={linkingPassword}
                  onChange={e => setLinkingPassword(e.target.value)}
                  placeholder="Enter your current password"
                  required
                  autoFocus
                  style={{ height: '38px', padding: '0 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px' }}
                />
              </label>
              {linkingError && <div className="error-banner">{linkingError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setLinkingState(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Verifying…' : 'Verify & Link Account →'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* 3. Multi-School Selection Modal (Requirement 5) */}
      {multiSchoolState && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setMultiSchoolState(null); }}>
          <section className="modal" style={{ maxWidth: '460px' }}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#ecfdf5', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Building2 size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: '17px', margin: 0 }}>Select School Workspace</h2>
                  <p style={{ fontSize: '11px', margin: 0, color: '#64748b' }}>Choose a workspace to enter</p>
                </div>
              </div>
              <button type="button" className="icon-button" onClick={() => setMultiSchoolState(null)}>
                <X size={19} />
              </button>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                Your account belongs to multiple schools. Select a workspace to open:
              </div>
              {multiSchoolState.schools.map((school) => (
                <div
                  key={school.id}
                  className="school-card-select"
                  onClick={() => void executeGoogleToken(multiSchoolState.token, school.id)}
                >
                  <div>
                    <h4>{school.name}</h4>
                    <p>{school.schoolRoleName || school.role} • ID: {school.schoolId}</p>
                  </div>
                  <ChevronRight size={18} color="#16a34a" />
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {accessDeniedModal && (
        <div className="modal-backdrop">
          <section className="modal-panel" style={{ maxWidth: '440px', padding: 0 }}>
            <div style={{ padding: '24px 20px', textAlign: 'center' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <ShieldAlert size={26} />
              </div>
              <h3 style={{ fontSize: '18px', margin: '0 0 6px', color: '#0f172a' }}>School Workspace Required</h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 }}>
                No active school membership or invitation was found for <b>{accessDeniedModal.email}</b>.
              </p>

              <div style={{ textAlign: 'left', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px', fontSize: '12px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                <div>
                  <b style={{ color: '#0f172a' }}>🏫 Creating a New School?</b>
                  <div style={{ color: '#64748b', marginTop: '2px' }}>
                    Set up your verified institution in 30 seconds using the <b>Register School</b> tab.
                  </div>
                </div>
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
                  <b style={{ color: '#0f172a' }}>✉️ Staff, Parent, or Student?</b>
                  <div style={{ color: '#64748b', marginTop: '2px' }}>
                    Ask your school administrator for an invitation link to activate your access.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-wide"
                  onClick={() => {
                    setAccessDeniedModal(null);
                    setGoogleOpen(false);
                    setMode('register');
                    if (accessDeniedModal.name) setAdminName(accessDeniedModal.name);
                    if (accessDeniedModal.email) setRegEmail(accessDeniedModal.email);
                  }}
                >
                  Register School Workspace →
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-wide"
                  onClick={() => {
                    setAccessDeniedModal(null);
                    setGoogleOpen(false);
                  }}
                >
                  Back to Sign In
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function InvitationPage(){
  const token=new URLSearchParams(window.location.search).get('token')||'';const [name,setName]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState<{name:string;schoolId:string}|null>(null);
  async function submit(e:React.FormEvent){e.preventDefault();setError('');if(password.length<12){setError('Choose a password with at least 12 characters.');return;}if(password!==confirm){setError('The passwords do not match.');return;}setBusy(true);try{const user=await acceptInvitation(token,name,password);setAccepted({name:user.name,schoolId:user.schoolId});}catch(ex){setError((ex as Error).message);}finally{setBusy(false);}}
  return <main className="invite-page"><div className="invite-card"><EduConnectBrand className="invite-brand" />{accepted?<><div className="success-icon invite-success"><Check size={22}/></div><div className="eyebrow">INVITATION ACCEPTED</div><h1>Your school workspace is ready.</h1><p>Welcome, {accepted.name}. Your administrator account for <b>{accepted.schoolId}</b> is active.</p><a className="btn btn-primary btn-wide invite-link" href="/">Open school workspace <ChevronRight size={16}/></a></>:<><div className="eyebrow invite-eyebrow">SCHOOL ADMINISTRATOR SETUP</div><h1>Accept your invitation</h1><p>Set up your account to open the school workspace.</p>{!token?<div className="error-banner">This invitation link is missing its token. Ask the CalmStacks team to send you a fresh invitation.</div>:<form className="form-stack" onSubmit={submit}><label>Your name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" autoComplete="name" required/></label><label>Create a password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" minLength={12} required/><small className="subtle">Use at least 12 characters.</small></label><label>Confirm password<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password" required/></label>{error&&<div className="error-banner">{error}</div>}<button className="btn btn-primary btn-wide" disabled={busy}>{busy?'Setting up…':'Set up administrator account'}<ChevronRight size={16}/></button></form>}<div className="login-note"><ShieldCheck size={15}/> Secure invitation · one time use</div></>}</div></main>;
}

function RecoveryPage(){
  const params=new URLSearchParams(window.location.search);
  const [kind,setKind]=useState<'platform'|'school'>(params.get('kind')==='school'?'school':'platform');
  const [schoolId,setSchoolId]=useState(params.get('schoolId')||'');
  const [email,setEmail]=useState('');
  const [token,setToken]=useState(params.get('token')||'');
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState('');
  const [matchedSchool,setMatchedSchool]=useState<{name?:string;schoolId?:string}|null>(null);
  const [developmentUrl,setDevelopmentUrl]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notFound,setNotFound]=useState(false);
  const [successComplete,setSuccessComplete]=useState(false);

  async function submit(e:React.FormEvent){
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    setNotFound(false);
    try{
      if(token){
        await request('/api/auth/recovery/confirm',{method:'POST',body:JSON.stringify({token,password})});
        setMessage('Password updated successfully. You can sign in with your new password now.');
        setSuccessComplete(true);
        setPassword('');
      }else if(firebaseConfigured){
        await sendFirebasePasswordReset(email);
        setMessage('If the account can sign in with Firebase, password reset instructions have been sent.');
      }else{
        const result=await request<{success?:boolean;message:string;schoolId?:string;schoolName?:string;developmentUrl?:string;invitationUrl?:string;notFound?:boolean}>('/api/auth/recovery/request',{
          method:'POST',
          body:JSON.stringify({kind,email,...(kind==='school'&&schoolId.trim()?{schoolId:schoolId.trim()}:{})})
        });
        setMessage(result.message);
        if(result.schoolName||result.schoolId){
          setMatchedSchool({name:result.schoolName,schoolId:result.schoolId});
        }
        if(result.notFound){
          setNotFound(true);
        }
        setDevelopmentUrl(result.developmentUrl||result.invitationUrl||'');
      }
    }catch(ex){
      setError((ex as Error).message);
    }finally{
      setBusy(false);
    }
  }

  function applyDirectReset(url:string){
    try{
      const parsed=new URL(url,window.location.origin);
      const t=parsed.searchParams.get('token');
      if(t){
        setToken(t);
        setMessage('');
        setDevelopmentUrl('');
      }else{
        window.location.href=url;
      }
    }catch{
      window.location.href=url;
    }
  }

  return <main className="invite-page"><section className="invite-card">
    <EduConnectBrand className="recovery-brand" />
    <div className="eyebrow invite-eyebrow">ACCOUNT SECURITY</div>
    <h1>{token?'Choose a new password':'Recover your account'}</h1>
    <p>{token?'Enter your new secure password below (minimum 12 characters).':'We will send a one time recovery link if the account matches our records.'}</p>
    
    {!token&&!message&&<div className="auth-switch">
      <button className={kind==='platform'?'selected':''} onClick={()=>setKind('platform')}>Platform account</button>
      <button className={kind==='school'?'selected':''} onClick={()=>setKind('school')}>School account</button>
    </div>}

    {successComplete ? (
      <div style={{marginTop:'1.5rem',display:'flex',flexDirection:'column',gap:'1rem'}}>
        <div className="success-banner" style={{padding:'1rem'}}><Check size={18}/> {message}</div>
        <a className="btn btn-primary btn-wide" href="/" style={{textDecoration:'none',textAlign:'center',justifyContent:'center',display:'flex',alignItems:'center'}}>
          Proceed to sign in <ChevronRight size={16}/>
        </a>
      </div>
    ) : (
      <form className="form-stack" onSubmit={submit}>
        {token ? (
          <label>
            New password
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={12} autoComplete="new-password" required placeholder="At least 12 characters"/>
            <small className="subtle">Use letters, numbers, and symbols.</small>
          </label>
        ) : (
          <>
            {kind==='school'&&<label>
              School ID <small style={{color:'#64748b',fontWeight:400}}>(optional — auto-detected from email)</small>
              <input value={schoolId} onChange={e=>setSchoolId(e.target.value)} placeholder="e.g. CS-SCH-0035 (or leave empty)"/>
            </label>}
            <label>
              Email address
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username" required placeholder="you@school.edu"/>
            </label>
          </>
        )}

        {error&&<div className="error-banner">{error}</div>}

        {notFound&&<div className="error-banner" style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          <div>No active school account found for "{email}".</div>
          <div style={{display:'flex',gap:'8px'}}>
            <a href="/" className="btn btn-secondary small-btn" style={{textDecoration:'none',display:'inline-flex',alignItems:'center'}}>
              Register school workspace &rarr;
            </a>
          </div>
        </div>}

        {message&&!notFound&&<div className="success-banner" style={{display:'flex',flexDirection:'column',gap:'0.75rem',padding:'1rem'}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:'8px'}}>
            <Check size={18} style={{flexShrink:0,marginTop:'2px'}}/>
            <div>
              {matchedSchool?.name&&<div style={{fontWeight:700,fontSize:'13px',color:'#14532d',marginBottom:'2px'}}>
                School Matched: {matchedSchool.name} ({matchedSchool.schoolId})
              </div>}
              <div>{message}</div>
            </div>
          </div>
          {developmentUrl&&<div style={{padding:'0.85rem',background:'#ffffff',borderRadius:'8px',border:'1px solid #bbf7d0',marginTop:'0.25rem',display:'flex',flexDirection:'column',gap:'8px'}}>
            <div style={{fontSize:'0.75rem',color:'#475569',fontWeight:500}}>
              {developmentUrl.includes('accept-invitation')
                ? 'Pending invitation found for this school account:'
                : 'Direct password reset link is ready for immediate access:'}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-wide"
              style={{justifyContent:'center',display:'flex',alignItems:'center',gap:'6px'}}
              onClick={()=>applyDirectReset(developmentUrl)}
            >
              {developmentUrl.includes('accept-invitation')?'Accept Invitation & Set Password':'Reset Password Now'} <ChevronRight size={16}/>
            </button>
          </div>}
        </div>}

        {!successComplete&&<button className="btn btn-primary btn-wide" disabled={busy}>
          {busy?'Please wait…':token?'Update password':'Send recovery link'}<ChevronRight size={16}/>
        </button>}
      </form>
    )}

    <div className="login-note"><ShieldCheck size={15}/> Recovery links are hashed and expire after 30 minutes</div>
    <a className="recovery-link" href="/">Return to sign in</a>
  </section></main>;
}

type SchoolTab = 'overview'|'classes'|'students'|'admissions'|'attendance'|'homework'|'exams'|'timetable'|'transport'|'fees'|'announcements'|'reports'|'settings'|'access';

function SchoolOverviewView({
  metrics,
  user,
  academicYear,
  onNavigate,
  onAdmitStudent,
  onAddClass
}: {
  metrics: { students: number; teachers: number; parents: number; attendance_marked: number } | undefined;
  user: User;
  academicYear?: string;
  onNavigate: (tab: SchoolTab) => void;
  onAdmitStudent: () => void;
  onAddClass: () => void;
}) {
  const studentsCount = metrics?.students || 0;
  const teachersCount = metrics?.teachers || 0;
  const parentsCount = metrics?.parents || 0;
  const attendanceToday = metrics?.attendance_marked || 0;
  const attendancePercent = studentsCount > 0 ? Math.min(100, Math.round((attendanceToday / studentsCount) * 100)) : 0;

  return (
    <div className="overview-container">
      {/* 1. School Quick Stats Grid */}
      <div className="overview-stats-grid">
        <div className="stat-card stat-students" onClick={() => onNavigate('students')} role="button" tabIndex={0}>
          <div className="stat-icon-wrapper blue">
            <GraduationCap size={22} />
          </div>
          <div className="stat-content">
            <span className="stat-label">Enrolled Students</span>
            <div className="stat-number">{formatNumber(studentsCount)}</div>
            <span className="stat-sub">Active in roster &rarr;</span>
          </div>
        </div>

        <div className="stat-card stat-teachers" onClick={() => onNavigate('classes')} role="button" tabIndex={0}>
          <div className="stat-icon-wrapper purple">
            <Users size={22} />
          </div>
          <div className="stat-content">
            <span className="stat-label">Teaching Staff</span>
            <div className="stat-number">{formatNumber(teachersCount)}</div>
            <span className="stat-sub">Active faculty &rarr;</span>
          </div>
        </div>

        <div className="stat-card stat-parents" onClick={() => onNavigate('access')} role="button" tabIndex={0}>
          <div className="stat-icon-wrapper amber">
            <ShieldCheck size={22} />
          </div>
          <div className="stat-content">
            <span className="stat-label">Guardian Accounts</span>
            <div className="stat-number">{formatNumber(parentsCount)}</div>
            <span className="stat-sub">Linked parents &rarr;</span>
          </div>
        </div>

        <div className="stat-card stat-attendance" onClick={() => onNavigate('attendance')} role="button" tabIndex={0}>
          <div className="stat-icon-wrapper emerald">
            <CalendarCheck size={22} />
          </div>
          <div className="stat-content">
            <span className="stat-label">Today's Attendance</span>
            <div className="stat-number">{formatNumber(attendanceToday)}</div>
            <span className="stat-sub">Marked records &rarr;</span>
          </div>
        </div>
      </div>

      {/* 2. Today's Attendance Snapshot Bar */}
      <div className="overview-daily-bar">
        <div className="daily-bar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
            <strong style={{ fontSize: '13px', color: '#1e293b' }}>Daily Attendance Progress</strong>
          </div>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#15803d' }}>
            {attendanceToday} of {studentsCount} marked ({attendancePercent}%)
          </span>
        </div>
        <div className="daily-progress-track">
          <div className="daily-progress-fill" style={{ width: `${attendancePercent}%` }} />
        </div>
        <div className="daily-bar-footer">
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            {studentsCount === 0 ? 'Admit students to begin tracking daily attendance.' : attendanceToday >= studentsCount ? '✓ Full class attendance marked for today.' : 'Take register for missing classes.'}
          </span>
          <button className="btn btn-secondary small-btn" onClick={() => onNavigate('attendance')}>
            Open Daily Register &rarr;
          </button>
        </div>
      </div>

      {/* 3. Mobile Quick Actions Hub */}
      <div className="overview-section">
        <div className="section-title">
          <Sparkles size={16} /> QUICK ACTIONS & SHORTCUTS
        </div>
        <div className="quick-actions-grid">
          <button type="button" className="quick-action-card" onClick={() => onNavigate('attendance')}>
            <div className="qa-icon emerald"><CalendarCheck size={20} /></div>
            <div className="qa-text">
              <strong>Take Attendance</strong>
              <small>Mark present/absent</small>
            </div>
            <ChevronRight size={16} className="qa-arrow" />
          </button>

          <button type="button" className="quick-action-card" onClick={onAdmitStudent}>
            <div className="qa-icon blue"><UserPlus size={20} /></div>
            <div className="qa-text">
              <strong>Admit Student</strong>
              <small>New enrollment form</small>
            </div>
            <ChevronRight size={16} className="qa-arrow" />
          </button>

          <button type="button" className="quick-action-card" onClick={onAddClass}>
            <div className="qa-icon indigo"><Layers size={20} /></div>
            <div className="qa-text">
              <strong>Add Class</strong>
              <small>Create grade & section</small>
            </div>
            <ChevronRight size={16} className="qa-arrow" />
          </button>

          <button type="button" className="quick-action-card" onClick={() => onNavigate('fees')}>
            <div className="qa-icon amber"><Receipt size={20} /></div>
            <div className="qa-text">
              <strong>Fees & Billing</strong>
              <small>Collect & manage dues</small>
            </div>
            <ChevronRight size={16} className="qa-arrow" />
          </button>

          <button type="button" className="quick-action-card" onClick={() => onNavigate('timetable')}>
            <div className="qa-icon violet"><Clock size={20} /></div>
            <div className="qa-text">
              <strong>Weekly Timetable</strong>
              <small>Period schedules</small>
            </div>
            <ChevronRight size={16} className="qa-arrow" />
          </button>

          <button type="button" className="quick-action-card" onClick={() => onNavigate('announcements')}>
            <div className="qa-icon rose"><Bell size={20} /></div>
            <div className="qa-text">
              <strong>Announcements</strong>
              <small>Broadcast notice</small>
            </div>
            <ChevronRight size={16} className="qa-arrow" />
          </button>
        </div>
      </div>

      {/* 4. Academic Operational Overview */}
      <div className="overview-two-col">
        {/* Module Directory Guide */}
        <div className="overview-panel">
          <div className="panel-kicker">WORKPLACE MODULES</div>
          <h3>School Management Suite</h3>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 14px' }}>
            All administrative tools and school operations are accessible anytime from the top bar or bottom navigation.
          </p>
          <div className="module-links-list">
            <div className="module-link-row" onClick={() => onNavigate('admissions')}>
              <UserPlus size={16} /> <span>Admissions & Enquiry CRM</span> <small>&rarr;</small>
            </div>
            <div className="module-link-row" onClick={() => onNavigate('classes')}>
              <Layers size={16} /> <span>Classes & Sections</span> <small>&rarr;</small>
            </div>
            <div className="module-link-row" onClick={() => onNavigate('students')}>
              <GraduationCap size={16} /> <span>Student Directory & Records</span> <small>&rarr;</small>
            </div>
            <div className="module-link-row" onClick={() => onNavigate('transport')}>
              <Clock3 size={16} /> <span>Transport preview</span> <small>&rarr;</small>
            </div>
            <div className="module-link-row" onClick={() => onNavigate('exams')}>
              <Award size={16} /> <span>Exams & Report Cards</span> <small>&rarr;</small>
            </div>
            <div className="module-link-row" onClick={() => onNavigate('reports')}>
              <BarChart3 size={16} /> <span>Academic & Attendance Analytics</span> <small>&rarr;</small>
            </div>
            <div className="module-link-row" onClick={() => onNavigate('settings')}>
              <Settings size={16} /> <span>School Settings & Terms</span> <small>&rarr;</small>
            </div>
          </div>
        </div>

        {/* Security & Multi-tenant status card */}
        <div className="overview-panel">
          <div className="panel-kicker">TENANT BOUNDARY & SECURITY</div>
          <h3>Isolated School Workspace</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
            <div className="security-status-item">
              <ShieldCheck size={18} style={{ color: '#16a34a', flexShrink: 0 }} />
              <div>
                <strong style={{ fontSize: '12px', color: '#1e293b' }}>Row-Level Security Active</strong>
                <div style={{ fontSize: '11px', color: '#64748b' }}>School ID: <b>{user.schoolId}</b> · Strict tenant isolation enabled</div>
              </div>
            </div>
            <div className="security-status-item">
              <Check size={18} style={{ color: '#16a34a', flexShrink: 0 }} />
              <div>
                <strong style={{ fontSize: '12px', color: '#1e293b' }}>Academic Year: {academicYear || 'Not configured'}</strong>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Active enrollment and grading period</div>
              </div>
            </div>
            <div className="security-status-item">
              <Users size={18} style={{ color: '#2563eb', flexShrink: 0 }} />
              <div>
                <strong style={{ fontSize: '12px', color: '#1e293b' }}>Role: {user.schoolRoleName || user.schoolRole || user.role}</strong>
                <div style={{ fontSize: '11px', color: '#64748b' }}>{user.permissions?.length || 0} granular privileges assigned</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SchoolWorkspace({user,onLogout}:{user:User;onLogout:()=>void}){
  const schoolAdmin=user.permissions?.includes('school:roles:manage')??user.role==='school_admin';
  const admin=schoolAdmin||!!user.permissions?.some(p=>p==='academics:manage'||p==='students:admit');
  const canAttendance=!!user.permissions?.some(p=>['attendance:read','attendance:read:assigned','attendance:read:linked','attendance:read:self','attendance:manage','attendance:manage:assigned'].includes(p));
  const canHomework=!!user.permissions?.some(p=>['homework:read','homework:read:assigned','homework:read:linked','homework:read:self','homework:manage','homework:manage:assigned'].includes(p));
  const canExams=!!user.permissions?.some(p=>['exams:read','exams:read:assigned','exams:manage','exams:manage:assigned','results:read','results:read:assigned','results:read:linked','results:read:self','results:publish'].includes(p));
  const canTimetable=!!user.permissions?.some(p=>['timetable:read','timetable:read:assigned','timetable:read:linked','timetable:read:self','timetable:manage'].includes(p));
  const canFees=!!user.permissions?.some(p=>['fees:read','fees:read:linked','fees:manage'].includes(p));
  const canAnnouncements=!!user.permissions?.some(p=>['announcements:read','announcements:manage'].includes(p));
  const canReports=!!user.permissions?.some(p=>['reports:read','reports:class'].includes(p));
  const canSettings=schoolAdmin||!!user.permissions?.some(p=>['school:settings:read','school:settings:update'].includes(p));
  const canAccess=schoolAdmin||!!user.permissions?.includes('support-access:review');

  const tabs: SchoolTab[] = [
    ...(admin ? ['overview','admissions','classes','students'] as const : []),
    ...(canAttendance ? ['attendance'] as const : []),
    ...(canHomework ? ['homework'] as const : []),
    ...(canExams ? ['exams'] as const : []),
    ...(canTimetable ? ['timetable'] as const : []),
    'transport' as const,
    ...(canFees ? ['fees'] as const : []),
    ...(canAnnouncements ? ['announcements'] as const : []),
    ...(canReports ? ['reports'] as const : []),
    ...(canSettings ? ['settings'] as const : []),
    ...(canAccess ? ['access'] as const : [])
  ];

  const defaultTab: SchoolTab = admin ? 'overview' : (canAttendance ? 'attendance' : (canHomework ? 'homework' : (canExams ? 'exams' : (canTimetable ? 'timetable' : (canFees ? 'fees' : (canAnnouncements ? 'announcements' : (canReports ? 'reports' : (canSettings ? 'settings' : (canAccess ? 'access' : 'overview')))))))));
  const [tab,setTab]=useState<SchoolTab>(defaultTab);
  const [mobileMenuOpen, setMobileMenuOpen]=useState(false);
  const [dialog,setDialog]=useState<'year'|'class'|'student'|null>(null);
  const [studentPage,setStudentPage]=useState(1);
  const [studentSearch,setStudentSearch]=useState('');
  const [bulkTarget,setBulkTarget]=useState('');
  const [bulkError,setBulkError]=useState('');
  const qc=useQueryClient();

  const q=useQuery({queryKey:['school-dashboard'],queryFn:()=>request<{metrics:{students:number;teachers:number;parents:number;attendance_marked:number};currentAcademicYear:{name:string}|null}>('/api/school/dashboard')});
  const years=useQuery({queryKey:['academic-years'],queryFn:()=>request<{items:AcademicYear[]}>('/api/school/academic-years'),enabled:user.permissions?.some(p=>p==='academics:read'||p==='academics:read:assigned')&&(tab==='classes'||tab==='students')});
  const classes=useQuery({queryKey:['school-classes',years.data?.items[0]?.id],queryFn:()=>request<{items:ClassItem[]}>('/api/school/classes'),enabled:user.permissions?.some(p=>p==='academics:read'||p==='academics:read:assigned')&&(tab==='classes'||tab==='students')});
  const students=useQuery({queryKey:['school-students',studentPage,studentSearch],queryFn:()=>request<{items:StudentRow[];total:number;page:number;limit:number}>(`/api/school/students?page=${studentPage}&limit=20&search=${encodeURIComponent(studentSearch)}`),enabled:user.permissions?.some(p=>p==='students:read'||p==='students:read:assigned'||p==='students:read:linked'||p==='students:read:self')&&tab==='students'});
  const addYear=useMutation({mutationFn:(v:{name:string;startsOn:string;endsOn:string;isCurrent:boolean})=>request('/api/school/academic-years',{method:'POST',body:JSON.stringify(v)}),onSuccess:()=>{setDialog(null);void qc.invalidateQueries({queryKey:['academic-years']});void qc.invalidateQueries({queryKey:['school-dashboard']});}});
  const addClass=useMutation({mutationFn:(v:{name:string;academicYearId:string;gradeLevel?:number})=>request('/api/school/classes',{method:'POST',body:JSON.stringify(v)}),onSuccess:()=>{setDialog(null);void qc.invalidateQueries({queryKey:['school-classes']});}});
  const addStudent=useMutation({mutationFn:(v:{admissionNumber:string;firstName:string;lastName:string;dateOfBirth?:string;classId:string;academicYearId:string})=>request('/api/school/students',{method:'POST',body:JSON.stringify(v)}),onSuccess:()=>{setDialog(null);setStudentPage(1);void qc.invalidateQueries({queryKey:['school-students']});void qc.invalidateQueries({queryKey:['school-dashboard']});void qc.invalidateQueries({queryKey:['school-classes']});}});
  const bulkImport=useMutation({mutationFn:(students:Record<string,string>[])=>request('/api/school/students/import',{method:'POST',body:JSON.stringify({students})}),onSuccess:()=>{void qc.invalidateQueries({queryKey:['school-students']});void qc.invalidateQueries({queryKey:['school-dashboard']});void qc.invalidateQueries({queryKey:['school-classes']});}});

  const getTabLabel = (item: SchoolTab) => {
    switch(item) {
      case 'overview': return 'Overview';
      case 'admissions': return 'Admissions CRM';
      case 'classes': return 'Classes';
      case 'students': return 'Students';
      case 'attendance': return 'Attendance';
      case 'homework': return 'Homework';
      case 'exams': return 'Exams & Results';
      case 'timetable': return 'Timetable';
      case 'transport': return 'Transport';
      case 'fees': return 'Fees & Payments';
      case 'announcements': return 'Announcements';
      case 'reports': return 'Reports';
      case 'settings': return 'Settings';
      case 'access': return 'Roles & access';
      default: return titleCase(item);
    }
  };

  const getTabIcon = (item: SchoolTab) => {
    switch (item) {
      case 'overview': return LayoutDashboard;
      case 'admissions': return UserPlus;
      case 'classes': return Layers;
      case 'students': return GraduationCap;
      case 'attendance': return CalendarCheck;
      case 'homework': return FileText;
      case 'exams': return Award;
      case 'timetable': return Clock;
      case 'transport': return Clock3;
      case 'fees': return Receipt;
      case 'announcements': return Bell;
      case 'reports': return BarChart3;
      case 'settings': return Settings;
      case 'access': return ShieldCheck;
      default: return LayoutDashboard;
    }
  };

  const bottomTabs = useMemo(() => {
    const preferred: SchoolTab[] = ['overview', 'attendance', 'homework', 'exams', 'timetable', 'fees', 'announcements', 'reports'];
    const matched = preferred.filter(t => tabs.includes(t));
    return matched.slice(0, 4);
  }, [tabs]);

  const navigationGroups = [
    { label: 'Workspace', items: tabs.filter(item => ['overview', 'admissions', 'students'].includes(item)) },
    { label: 'Learning', items: tabs.filter(item => ['classes', 'attendance', 'homework', 'exams', 'timetable'].includes(item)) },
    { label: 'Operations', items: tabs.filter(item => ['transport', 'fees', 'announcements', 'reports', 'settings', 'access'].includes(item)) },
  ].filter(group => group.items.length > 0);

  return <div className="school-app school-shell">
    <aside className="school-sidebar" aria-label="School workspace navigation">
      <EduConnectBrand compact className="school-sidebar-brand" />
      <div className="school-identity">
        <span className="school-identity-mark"><Building2 size={16}/></span>
        <span><strong>School workspace</strong><small>{user.schoolId || 'Current school'}</small></span>
      </div>
      {q.data?.currentAcademicYear&&<div className="school-year"><span>Academic year</span><strong>{q.data.currentAcademicYear.name}</strong></div>}
      <nav className="school-sidebar-nav" aria-label="School modules">
        {navigationGroups.map(group=><div className="school-nav-group" key={group.label}>
          <span className="school-nav-group-label">{group.label}</span>
          {group.items.map(item=>{const Icon=getTabIcon(item);return <button type="button" key={item} aria-current={tab===item?'page':undefined} className={`school-side-link ${tab===item?'active':''}`} onClick={()=>setTab(item)}><Icon size={17}/><span>{getTabLabel(item)}</span></button>;})}
        </div>)}
      </nav>
      <div className="school-sidebar-profile">
        <span className="school-user-avatar">{initials(user.name)}</span>
        <span className="school-user-copy"><strong>{user.name}</strong><small>{user.schoolRoleName || user.schoolRole || user.role}</small></span>
        <button type="button" className="school-signout" onClick={onLogout} aria-label="Sign out"><LogOut size={16}/></button>
      </div>
    </aside>
    <div className="school-main">
    <header className="school-top">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <button 
          type="button" 
          className="icon-button school-mobile-menu" 
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open navigation menu"
        >
          <Menu size={20} />
        </button>
        <EduConnectBrand compact className="school-top-brand" />
        <div className="school-top-title"><span>School workspace</span><strong>{getTabLabel(tab)}</strong></div>
      </div>
      <div className="school-top-actions">
        <NotificationBell onOpenAnnouncements={() => { setTab('announcements'); setMobileMenuOpen(false); }} />
        <div className="status-badge-wrap"><StatusBadge status="active"/></div>
        <div className="top-avatar" title={user.name}>{initials(user.name)}</div>
        <button className="btn btn-secondary small-btn logout-btn" onClick={onLogout}>
          <LogOut size={14}/> <span>Sign out</span>
        </button>
      </div>
    </header>

    {/* Mobile Slide-over Drawer */}
    {mobileMenuOpen && (
      <div className="mobile-drawer-overlay" onClick={() => setMobileMenuOpen(false)}>
        <aside className="mobile-drawer" onClick={(e) => e.stopPropagation()}>
          <div className="mobile-drawer-header">
            <EduConnectBrand compact />
            <button type="button" className="icon-button" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">
              <X size={20} />
            </button>
          </div>

          <div className="mobile-drawer-user">
            <div className="avatar" style={{ width: '40px', height: '40px', fontSize: '13px' }}>
              {initials(user.name)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: '14px', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.name}
              </strong>
              <span style={{ display: 'inline-block', fontSize: '10px', color: '#15803d', background: '#dcfce7', padding: '2px 8px', borderRadius: '12px', marginTop: '2px', fontWeight: 600 }}>
                {user.schoolRoleName || user.schoolRole || user.role}
              </span>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                School ID: <b>{user.schoolId}</b>
              </div>
            </div>
          </div>

          <div className="mobile-drawer-nav">
            <div className="side-label" style={{ padding: '8px 12px 4px', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', color: '#94a3b8' }}>
              MODULES & WORKSPACES
            </div>
            {tabs.map((item) => {
              const Icon = getTabIcon(item);
              const active = tab === item;
              return (
                <button
                  key={item}
                  type="button"
                  className={`mobile-drawer-item ${active ? 'active' : ''}`}
                  onClick={() => {
                    setTab(item);
                    setMobileMenuOpen(false);
                  }}
                >
                  <span className="mobile-drawer-icon"><Icon size={18} /></span>
                  <span style={{ flex: 1, textAlign: 'left', fontWeight: active ? 700 : 500 }}>
                    {getTabLabel(item)}
                  </span>
                  {active && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#059669' }} />}
                </button>
              );
            })}
          </div>

          <div className="mobile-drawer-footer">
            <button type="button" className="mobile-drawer-logout" onClick={onLogout}>
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </aside>
      </div>
    )}

    <main className="school-main-content">
    <section className="school-context-bar" aria-label="Current school context">
      <span className="school-role-chip">{user.schoolRoleName||user.schoolRole||user.role}</span>
      <span>{user.schoolId || 'School workspace'}</span>
      {q.data?.currentAcademicYear&&<span>Academic year <strong>{q.data.currentAcademicYear.name}</strong></span>}
    </section>

    {tabs.length>0&&<div className="school-workbar">
      <div className="school-tabs-scroll">
        <div className="school-tabs" role="tablist">
          {tabs.map(item => {
            const Icon = getTabIcon(item);
            return (
              <button 
                key={item} 
                role="tab"
                aria-selected={tab===item}
                className={tab===item?'selected':''} 
                onClick={()=>setTab(item)}
              >
                <Icon size={14} className="tab-icon" />
                <span>{getTabLabel(item)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="school-actions">
        {tab==='classes'&&user.permissions?.includes('academics:manage')&&<button className="btn btn-secondary" onClick={()=>setDialog('year')}><Plus size={15}/> Academic year</button>}
        {tab==='classes'&&user.permissions?.includes('academics:manage')&&<button className="btn btn-primary" onClick={()=>setDialog('class')} disabled={!years.data?.items.length}><Plus size={15}/> Add class</button>}
        {tab==='students'&&user.permissions?.includes('students:admit')&&<button className="btn btn-primary" onClick={()=>setDialog('student')} disabled={!years.data?.items.length||!classes.data?.items.length}><Plus size={15}/> Admit student</button>}
        {tab==='students'&&user.permissions?.includes('students:admit')&&<>
          <select className="bulk-target" value={bulkTarget} onChange={e=>setBulkTarget(e.target.value)}>
            <option value="">Choose import class</option>
            {classes.data?.items.map(item=><option key={item.id} value={`${item.id}|${item.academic_year_id}`}>{item.name} · {item.academic_year_name}</option>)}
          </select>
          <label className="btn btn-secondary csv-upload">Import CSV<input type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setBulkError('');try{const target=(bulkTarget||`${classes.data?.items[0]?.id||''}|${classes.data?.items[0]?.academic_year_id||''}`).split('|');if(!target[0]||!target[1])throw new Error('Choose a class before importing.');const records=parseStudentCsv(await file.text()).map(row=>({...row,classId:target[0],academicYearId:target[1]}));if(!records.length)throw new Error('CSV has no student rows.');await bulkImport.mutateAsync(records);}catch(ex){setBulkError((ex as Error).message);}finally{e.target.value='';}}}/></label>
        </>}
      </div>
    </div>}
  {q.isError?<ErrorPanel message={(q.error as Error).message} retry={()=>q.refetch()}/>:tab==='admissions'?<AdmissionsWorkspace/>:tab==='transport'?<TransportWorkspace/>:tab==='attendance'?<AttendanceWorkspace user={user}/>:tab==='homework'?<HomeworkWorkspace user={user}/>:tab==='exams'?<ExamsWorkspace user={user}/>:tab==='timetable'?<TimetableWorkspace user={user}/>:tab==='fees'?<FeesWorkspace user={user}/>:tab==='announcements'?<AnnouncementsWorkspace user={user}/>:tab==='reports'?<ReportsWorkspace user={user}/>:tab==='settings'?<SettingsWorkspace user={user}/>:tab==='overview'?<SchoolOverviewView metrics={q.data?.metrics} user={user} academicYear={q.data?.currentAcademicYear?.name} onNavigate={setTab} onAdmitStudent={()=>setDialog('student')} onAddClass={()=>setDialog('class')}/>:tab==='access'?<SchoolAccessPanel user={user}/>:tab==='classes'?<section className="panel school-data-panel"><div className="panel-head"><div><div className="panel-kicker">ACADEMIC STRUCTURE</div><h3>Classes and sections</h3></div><span className="table-count">{classes.data?.items.length||0} classes</span></div>{!years.data?.items.length?<div className="empty-state"><div className="empty-icon"><GraduationCap size={19}/></div><strong>Set up your academic year</strong><span>Create the year first, then add classes.</span><button className="btn btn-primary" onClick={()=>setDialog('year')}><Plus size={15}/> Add academic year</button></div>:classes.isLoading?<div className="table-loading"><div className="table-skeleton"/><div className="table-skeleton"/></div>:classes.data?.items.length?<div className="simple-list">{classes.data.items.map(item=><div className="simple-row" key={item.id}><div className="school-logo"><GraduationCap size={16}/></div><div><strong>{item.name}</strong><small>{item.academic_year_name} · Grade {item.grade_level??'—'}</small></div><span>{item.students} students</span><span>{item.sections} sections</span></div>)}</div>:<div className="empty-state"><strong>No classes yet</strong><span>Add classes for {years.data.items[0].name}.</span><button className="btn btn-primary" onClick={()=>setDialog('class')}><Plus size={15}/> Add class</button></div>}</section>:<section className="panel school-data-panel"><div className="panel-head"><div><div className="panel-kicker">STUDENT RECORDS</div><h3>Students</h3></div><span className="table-count">{students.data?.total||0} records</span></div><div className="student-list-toolbar"><div className="search-box"><Search size={16}/><input value={studentSearch} onChange={e=>{setStudentSearch(e.target.value);setStudentPage(1);}} placeholder="Search student name or admission no."/></div><span className="table-count">{students.data?.total||0} records</span></div>{students.isError?<ErrorPanel message={(students.error as Error).message} retry={()=>students.refetch()}/>:students.isLoading?<div className="table-loading"><div className="table-skeleton"/><div className="table-skeleton"/></div>:students.data?.items.length?<div className="table-scroll"><table><thead><tr><th>STUDENT</th><th>ADMISSION NO.</th><th>CLASS</th><th>ACADEMIC YEAR</th><th>STATUS</th><th>FILES</th></tr></thead><tbody>{students.data.items.map(st=><tr key={st.id}><td><div className="school-cell"><div className="school-logo">{initials(`${st.first_name} ${st.last_name}`)}</div><div><strong>{st.first_name} {st.last_name}</strong><small>{st.date_of_birth?`Born ${dateLabel(st.date_of_birth)}`:'Date of birth not set'}</small></div></div></td><td>{st.admission_number}</td><td>{st.class_name||'Not allocated'}{st.section_name?` · ${st.section_name}`:''}</td><td>{st.academic_year_name||'—'}</td><td><StatusBadge status={st.status}/></td><td><StudentDocuments studentId={st.id} studentName={st.first_name+' '+st.last_name}/></td></tr>)}</tbody></table></div>:<div className="empty-state"><div className="empty-icon"><Users size={19}/></div><strong>No students yet</strong><span>Admit a student to start building your school records.</span><button className="btn btn-primary" onClick={()=>setDialog('student')}><Plus size={15}/> Admit student</button></div>}<div className="school-page-footer"><span>Showing {students.data?.items.length||0} of {students.data?.total||0} students</span><div><button className="pager" disabled={studentPage<=1} onClick={()=>setStudentPage(n=>n-1)}><ChevronLeft size={15}/></button><span>Page {studentPage} of {Math.max(1,Math.ceil((students.data?.total||0)/20))}</span><button className="pager" disabled={studentPage>=Math.ceil((students.data?.total||0)/20)} onClick={()=>setStudentPage(n=>n+1)}><ChevronRight size={15}/></button></div></div></section>}
  {(bulkError||addYear.isError||addClass.isError||addStudent.isError||bulkImport.isError)&&<div className="error-inline school-error">{bulkError||((addYear.error||addClass.error||addStudent.error||bulkImport.error) as Error).message}</div>}{dialog&&<div className="modal-backdrop"><section className="modal school-modal"><div className="modal-head"><div><div className="eyebrow">SCHOOL SETUP</div><h2>{dialog==='year'?'Add academic year':dialog==='class'?'Add a class':'Admit a student'}</h2><p>Records are saved to this school workspace.</p></div><button className="icon-button" onClick={()=>setDialog(null)}><X size={19}/></button></div>{dialog==='year'?<YearForm pending={addYear.isPending} onCancel={()=>setDialog(null)} onSubmit={v=>addYear.mutate(v)}/>:dialog==='class'?<ClassForm years={years.data?.items||[]} pending={addClass.isPending} onCancel={()=>setDialog(null)} onSubmit={v=>addClass.mutate(v)}/>:<StudentForm years={years.data?.items||[]} classes={classes.data?.items||[]} pending={addStudent.isPending} onCancel={()=>setDialog(null)} onSubmit={v=>addStudent.mutate(v)}/>}</section></div>}
  {/* Mobile Bottom Navigation Bar */}
  <nav className="school-bottom-nav" aria-label="Quick Mobile Navigation">
    {bottomTabs.map((item) => {
      const Icon = getTabIcon(item);
      const active = tab === item;
      return (
        <button
          key={item}
          type="button"
          className={`bottom-nav-item ${active ? 'active' : ''}`}
          onClick={() => setTab(item)}
        >
          <Icon size={18} />
          <span>{getTabLabel(item)}</span>
        </button>
      );
    })}
    <button
      type="button"
      className={`bottom-nav-item ${mobileMenuOpen ? 'active' : ''}`}
      onClick={() => setMobileMenuOpen(true)}
    >
      <Menu size={18} />
      <span>Menu</span>
    </button>
  </nav>
</main>
    </div>
  </div>;
}

function parseStudentCsv(text:string):Record<string,string>[]{
  const rows:string[][]=[];let row:string[]=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){const char=text[i];if(char==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(char===','&&!quoted){row.push(value.trim());value='';}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[i+1]==='\n')i++;row.push(value.trim());if(row.some(cell=>cell))rows.push(row);row=[];value='';}else value+=char;}
  if(value||row.length){row.push(value.trim());if(row.some(cell=>cell))rows.push(row);}if(rows.length<2)throw new Error('CSV needs a header row and at least one student.');
  const headers=rows[0].map(cell=>cell.toLowerCase());for(const required of ['admissionnumber','firstname'])if(!headers.includes(required))throw new Error(`CSV must include the ${required} column.`);
  return rows.slice(1).map(cells=>{const get=(key:string)=>cells[headers.indexOf(key)]||'';const record:Record<string,string>={admissionNumber:get('admissionnumber'),firstName:get('firstname'),lastName:get('lastname')};if(get('dateofbirth'))record.dateOfBirth=get('dateofbirth');if(!record.admissionNumber||!record.firstName)throw new Error('Every student needs an admission number and first name.');return record;});
}

const schoolPermissionOptions=['dashboard:read','school:roles:manage','school:members:manage','school:admins:manage','school:settings:read','school:settings:update','academics:read','academics:read:assigned','academics:manage','students:read','students:read:assigned','students:read:linked','students:read:self','students:admit','students:manage','students:archive','parents:read','parents:manage','teachers:read','teachers:manage','attendance:read','attendance:read:assigned','attendance:read:linked','attendance:read:self','attendance:manage','attendance:manage:assigned','homework:read','homework:read:assigned','homework:read:linked','homework:read:self','homework:manage','homework:manage:assigned','exams:read','exams:read:assigned','exams:manage','exams:manage:assigned','results:read','results:read:assigned','results:read:linked','results:read:self','results:publish','fees:read','fees:read:linked','fees:manage','timetable:read','timetable:read:assigned','timetable:manage','announcements:read','announcements:manage','reports:read','reports:class','support-access:review'];
type SchoolRole={id:string;name:string;code:string;member_kind:string;is_system:boolean;permissions:string[]};type SchoolMember={id:string;user_id:string;name:string;email:string;role:string;is_active:boolean;school_role_id:string;school_role_name:string;school_role_code:string};
function SchoolAccessPanel({user}:{user:User}){
  const qc=useQueryClient(),canRoles=!!user.permissions?.includes('school:roles:manage'),canMembers=!!user.permissions?.some(p=>p==='school:members:manage'||p==='school:admins:manage'),canSupport=!!user.permissions?.includes('support-access:review');
  const roles=useQuery({queryKey:['school-roles'],queryFn:()=>request<{items:SchoolRole[]}>('/api/school/roles'),enabled:canRoles||canMembers});
  const members=useQuery({queryKey:['school-members'],queryFn:()=>request<{items:SchoolMember[]}>('/api/school/members'),enabled:canMembers});
  const support=useQuery({queryKey:['support-access'],queryFn:()=>request<{items:SupportRequest[]}>('/api/school/support-access'),enabled:canSupport});
  const students=useQuery({queryKey:['school-students-for-parent-link'],queryFn:()=>request<{items:StudentRow[]}>('/api/school/students?limit=100'),enabled:canMembers});
  const [newName,setNewName]=useState(''),[newCode,setNewCode]=useState(''),[newKind,setNewKind]=useState('school_admin'),[inviteEmail,setInviteEmail]=useState(''),[inviteName,setInviteName]=useState(''),[inviteRole,setInviteRole]=useState(''),[inviteStudents,setInviteStudents]=useState<string[]>([]),[error,setError]=useState(''),[latestInvite,setLatestInvite]=useState<{email:string;developmentUrl?:string;deliveryStatus?:string}|null>(null);
  const refresh=()=>{void qc.invalidateQueries({queryKey:['school-roles']});void qc.invalidateQueries({queryKey:['school-members']});void qc.invalidateQueries({queryKey:['support-access']});};
  const createRole=useMutation({mutationFn:()=>request('/api/school/roles',{method:'POST',body:JSON.stringify({name:newName,code:newCode,memberKind:newKind,permissions:['dashboard:read']})}),onSuccess:()=>{setNewName('');setNewCode('');refresh();}});
  const updateRole=useMutation({mutationFn:({role,permissions}:{role:SchoolRole;permissions:string[]})=>request(`/api/school/roles/${role.id}/permissions`,{method:'PATCH',body:JSON.stringify({permissions})}),onSuccess:refresh});
  const invite=useMutation({mutationFn:()=>request<{invitation:{id:string;email:string;expiresAt:string;deliveryStatus:string;inviteUrl?:string;developmentUrl?:string}}>('/api/school/members/invitations',{method:'POST',body:JSON.stringify({email:inviteEmail,name:inviteName,schoolRoleId:inviteRole,...(roles.data?.items.find(r=>r.id===inviteRole)?.member_kind==='parent'?{studentIds:inviteStudents}:roles.data?.items.find(r=>r.id===inviteRole)?.member_kind==='student'?{studentId:inviteStudents[0]}:{})})}),onSuccess:(data)=>{const url=data?.invitation?.inviteUrl||data?.invitation?.developmentUrl;setLatestInvite({email:inviteEmail,developmentUrl:url,deliveryStatus:data?.invitation?.deliveryStatus});setInviteEmail('');setInviteName('');setInviteStudents([]);refresh();}});
  const changeRole=useMutation({mutationFn:({member,schoolRoleId}:{member:SchoolMember;schoolRoleId:string})=>request(`/api/school/members/${member.id}/role`,{method:'PATCH',body:JSON.stringify({schoolRoleId})}),onSuccess:refresh});
  const changeStatus=useMutation({mutationFn:({member,active}:{member:SchoolMember;active:boolean})=>request(`/api/school/members/${member.id}/status`,{method:'PATCH',body:JSON.stringify({active})}),onSuccess:refresh});
  const decide=useMutation({mutationFn:({item,decision}:{item:SupportRequest;decision:'approve'|'reject'})=>request(`/api/school/support-access/${item.id}/decision`,{method:'PATCH',body:JSON.stringify({decision,approvedScopes:decision==='approve'?item.requested_scopes:[],durationMinutes:60})}),onSuccess:refresh});
  const revoke=useMutation({mutationFn:(item:SupportRequest)=>request(`/api/school/support-access/${item.id}/revoke`,{method:'POST'}),onSuccess:refresh});
  const mutationError=(createRole.error||updateRole.error||invite.error||changeRole.error||changeStatus.error||decide.error||revoke.error) as Error|undefined;
  async function doInvite(e:React.FormEvent){e.preventDefault();setError('');setLatestInvite(null);try{await invite.mutateAsync();}catch(ex){setError((ex as Error).message);}}
  return <div className="school-access-grid">
    {canRoles&&<section className="panel school-data-panel"><div className="panel-head"><div><div className="panel-kicker">SCHOOL GOVERNANCE</div><h3>Roles and permissions</h3></div><span className="table-count">{roles.data?.items.length||0} roles</span></div>{roles.isError?<ErrorPanel message={(roles.error as Error).message} retry={()=>roles.refetch()}/>:roles.data?.items.map(role=><details className="access-role" key={role.id}><summary><strong>{role.name}</strong><span>{role.member_kind.replace('_',' ')} · {role.permissions.length} permissions</span></summary><div className="permission-grid">{schoolPermissionOptions.map(permission=><label key={permission}><input type="checkbox" checked={role.permissions.includes(permission)} onChange={e=>{const next=e.target.checked?[...new Set([...role.permissions,permission])]:role.permissions.filter(p=>p!==permission);updateRole.mutate({role,permissions:next});}}/>{permission}</label>)}</div></details>)}<form className="access-create-role" onSubmit={e=>{e.preventDefault();createRole.mutate();}}><input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Custom role name" required/><input value={newCode} onChange={e=>setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g,'_'))} placeholder="role_code" required/><select value={newKind} onChange={e=>setNewKind(e.target.value)}><option value="school_admin">School administrator</option><option value="teacher">Teacher</option><option value="parent">Parent</option><option value="student">Student</option></select><button className="btn btn-primary" disabled={createRole.isPending}>Create role</button></form></section>}
    {canMembers&&<section className="panel school-data-panel"><div className="panel-head"><div><div className="panel-kicker">SCHOOL ACCOUNTS</div><h3>Administrators and staff</h3></div><span className="table-count">{members.data?.items.length||0} members</span></div>{members.isLoading?<div className="table-loading"><div className="table-skeleton"/></div>:members.data?.items.map(member=><div className="access-member" key={member.id}><div><strong>{member.name}</strong><small>{member.email} · {member.is_active?'Active':'Suspended'}</small></div><select aria-label={`Role for ${member.name}`} value={member.school_role_id} disabled={member.user_id===user.id} onChange={e=>changeRole.mutate({member,schoolRoleId:e.target.value})}>{roles.data?.items.filter(role=>role.member_kind===member.role).map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select><button className="btn btn-secondary small-btn" disabled={member.user_id===user.id} onClick={()=>changeStatus.mutate({member,active:!member.is_active})}>{member.is_active?'Suspend':'Reactivate'}</button></div>)}<form className="access-invite" onSubmit={doInvite}><div className="panel-kicker">INVITE A SCHOOL MEMBER</div><input type="text" value={inviteName} onChange={e=>setInviteName(e.target.value)} placeholder="Full name" required/><input type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="Email address" required/><select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} required><option value="">Select role</option>{roles.data?.items.map(role=><option value={role.id} key={role.id}>{role.name}</option>)}</select>{(roles.data?.items.find(r=>r.id===inviteRole)?.member_kind==='parent'||roles.data?.items.find(r=>r.id===inviteRole)?.member_kind==='student')&&<select multiple={roles.data?.items.find(r=>r.id===inviteRole)?.member_kind==='parent'} value={inviteStudents} onChange={e=>setInviteStudents(Array.from(e.target.selectedOptions,o=>o.value))} aria-label="Link children">{students.data?.items.map(student=><option key={student.id} value={student.id}>{student.first_name} {student.last_name} · {student.admission_number}</option>)}</select>}<button className="btn btn-primary" disabled={invite.isPending}>{invite.isPending?'Sending…':'Send invitation'}</button></form>{latestInvite&&<div className="success-banner" style={{marginTop:'0.85rem',display:'flex',flexDirection:'column',gap:'0.65rem',padding:'0.9rem',background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:'8px',color:'#065f46'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'6px'}}><div style={{fontWeight:700,fontSize:'0.9rem'}}>✓ Invitation created for {latestInvite.email}</div><span style={{fontSize:'11px',background:latestInvite.deliveryStatus==='sent'?'#dcfce7':'#fef3c7',color:latestInvite.deliveryStatus==='sent'?'#166534':'#92400e',padding:'2px 8px',borderRadius:'12px',fontWeight:600}}>{latestInvite.deliveryStatus==='sent'?'Email Dispatched':'Direct Link Ready (No SMTP)'}</span></div>{latestInvite.developmentUrl&&<div style={{display:'flex',flexDirection:'column',gap:'6px'}}><p style={{margin:0,fontSize:'12px',color:'#047857',lineHeight:1.4}}>Share this secure one-time activation link to let them set up their account:</p><div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}><input readOnly value={latestInvite.developmentUrl} style={{flex:1,minWidth:'200px',height:'34px',fontSize:'11px',padding:'0 8px',background:'#fff',border:'1px solid #6ee7b7',borderRadius:'6px',color:'#065f46'}} onClick={e=>(e.target as HTMLInputElement).select()}/><button type="button" className="btn btn-primary small-btn" onClick={()=>{void navigator.clipboard.writeText(latestInvite.developmentUrl!);alert('Invitation link copied to clipboard!');}}>Copy link</button><a href={latestInvite.developmentUrl} target="_blank" rel="noreferrer" className="btn btn-secondary small-btn" style={{textDecoration:'none'}}>Open &rarr;</a></div></div>}</div>}</section>}
    {canSupport&&<section className="panel school-data-panel"><div className="panel-head"><div><div className="panel-kicker">CALMSTACKS TECHNICAL SUPPORT</div><h3>Support access requests</h3></div></div>{support.isLoading?<div className="table-loading"><div className="table-skeleton"/></div>:support.data?.items.map(item=><div className="support-request" key={item.id}><div><strong>{item.requested_by.slice(0,8)} · {item.status}</strong><small>{item.reason}</small><small>Requested: {item.requested_scopes.join(', ')} · Until {new Date(item.requested_expires_at).toLocaleString()}</small></div>{item.status==='pending'&&<div><button className="btn btn-primary small-btn" onClick={()=>decide.mutate({item,decision:'approve'})}>Approve requested access</button><button className="btn btn-secondary small-btn" onClick={()=>decide.mutate({item,decision:'reject'})}>Reject</button></div>}{item.status==='approved'&&new Date(item.expires_at||0)>new Date()&&<button className="btn btn-secondary small-btn" onClick={()=>revoke.mutate(item)}>Revoke access</button>}</div>)}{support.data?.items.length===0&&<div className="empty-state">No support requests for this school.</div>}</section>}
    {(error||mutationError)&&<div className="error-inline school-error">{error||mutationError?.message}</div>}
  </div>;
}
type SupportRequest={id:string;reason:string;requested_scopes:string[];status:string;requested_expires_at:string;expires_at:string|null;requested_by:string};
type AcademicYear={id:string;name:string;is_current:boolean};type ClassItem={id:string;name:string;grade_level:number|null;academic_year_id:string;academic_year_name:string;students:number;sections:number};type StudentRow={id:string;admission_number:string;first_name:string;last_name:string;date_of_birth:string|null;status:string;class_name:string|null;section_name:string|null;academic_year_name:string|null};
function YearForm({pending,onCancel,onSubmit}:{pending:boolean;onCancel:()=>void;onSubmit:(v:{name:string;startsOn:string;endsOn:string;isCurrent:boolean})=>void}){const [name,setName]=useState(''),[starts,setStarts]=useState(''),[ends,setEnds]=useState('');return <form className="modal-form" onSubmit={e=>{e.preventDefault();onSubmit({name,startsOn:starts,endsOn:ends,isCurrent:true});}}><div className="form-grid"><Field label="Academic year name"><input required value={name} onChange={e=>setName(e.target.value)} placeholder="2026–27"/></Field><Field label="Starts on"><input type="date" required value={starts} onChange={e=>setStarts(e.target.value)}/></Field><Field label="Ends on"><input type="date" required min={starts} value={ends} onChange={e=>setEnds(e.target.value)}/></Field></div><ModalActions pending={pending} onCancel={onCancel} submit="Save academic year"/></form>}
function ClassForm({years,pending,onCancel,onSubmit}:{years:AcademicYear[];pending:boolean;onCancel:()=>void;onSubmit:(v:{name:string;academicYearId:string;gradeLevel?:number})=>void}){const [name,setName]=useState(''),[academicYearId,setYear]=useState(years.find(y=>y.is_current)?.id||years[0]?.id||''),[grade,setGrade]=useState('');return <form className="modal-form" onSubmit={e=>{e.preventDefault();onSubmit({name,academicYearId,...(grade?{gradeLevel:Number(grade)}:{})});}}><div className="form-grid"><Field label="Class name"><input required value={name} onChange={e=>setName(e.target.value)} placeholder="Grade 5"/></Field><Field label="Grade level"><input type="number" min="0" max="20" value={grade} onChange={e=>setGrade(e.target.value)} placeholder="5"/></Field><Field label="Academic year"><select value={academicYearId} onChange={e=>setYear(e.target.value)} required>{years.map(y=><option key={y.id} value={y.id}>{y.name}{y.is_current?' · current':''}</option>)}</select></Field></div><ModalActions pending={pending} onCancel={onCancel} submit="Create class"/></form>}
function StudentForm({years,classes,pending,onCancel,onSubmit}:{years:AcademicYear[];classes:ClassItem[];pending:boolean;onCancel:()=>void;onSubmit:(v:{admissionNumber:string;firstName:string;lastName:string;dateOfBirth?:string;classId:string;academicYearId:string})=>void}){const [admissionNumber,setAdmission]=useState(''),[firstName,setFirst]=useState(''),[lastName,setLast]=useState(''),[dateOfBirth,setDob]=useState(''),[classId,setClass]=useState(classes[0]?.id||''),[academicYearId,setYear]=useState(classes[0]?.academic_year_id||years.find(y=>y.is_current)?.id||years[0]?.id||'');const eligible=classes.filter(c=>c.academic_year_id===academicYearId);return <form className="modal-form" onSubmit={e=>{e.preventDefault();onSubmit({admissionNumber,firstName,lastName,...(dateOfBirth?{dateOfBirth}:{}),classId,academicYearId});}}><div className="form-grid"><Field label="Admission number"><input required value={admissionNumber} onChange={e=>setAdmission(e.target.value)} placeholder="2026-001"/></Field><Field label="Date of birth"><input type="date" value={dateOfBirth} onChange={e=>setDob(e.target.value)}/></Field><Field label="First name"><input required value={firstName} onChange={e=>setFirst(e.target.value)} placeholder="Student first name"/></Field><Field label="Last name"><input value={lastName} onChange={e=>setLast(e.target.value)} placeholder="Student last name"/></Field><Field label="Academic year"><select value={academicYearId} onChange={e=>{setYear(e.target.value);setClass('');}} required>{years.map(y=><option key={y.id} value={y.id}>{y.name}</option>)}</select></Field><Field label="Class"><select value={classId} onChange={e=>setClass(e.target.value)} required>{eligible.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>{!eligible.length&&<small className="field-error">Create a class for this academic year first.</small>}</Field></div><ModalActions pending={pending} onCancel={onCancel} submit="Admit student" disabled={!eligible.length}/></form>}
function ModalActions({pending,onCancel,submit,disabled}:{pending:boolean;onCancel:()=>void;submit:string;disabled?:boolean}){return <div className="modal-actions"><span><ShieldCheck size={14}/> Only school administrators can edit these records</span><div><button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button><button className="btn btn-primary" disabled={pending||disabled}>{pending?'Saving…':submit}<ChevronRight size={16}/></button></div></div>}

function ControlPanel({user,onLogout}:{user:User;onLogout:()=>void}){
  const [mobileOpen,setMobileOpen]=useState(false),[createOpen,setCreateOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[helpOpen,setHelpOpen]=useState(false),[notifOpen,setNotifOpen]=useState(false);const location=useLocation();
  const routes=[{to:'/',label:'Overview',icon:LayoutDashboard},{to:'/schools',label:'Schools',icon:Building2,badge:undefined},{to:'/subscriptions',label:'Subscriptions',icon:CreditCard,disabled:true},{to:'/activity',label:'Activity log',icon:Activity},{to:'/team',label:'Support team',icon:Users}];
  return <div className="app-shell"><aside className={`sidebar ${mobileOpen?'mobile-open':''}`}><EduConnectBrand className="side-brand" /><div className="side-label">WORKSPACE</div><div className="workspace-switch"><div className="workspace-icon"><ShieldCheck size={17}/></div><div><strong>Platform admin</strong><small>CalmStacks network</small></div><ChevronDown size={15} className="ml-auto text-muted"/></div><div className="side-label nav-label">MANAGE</div><nav className="side-nav">{routes.map(item=><NavLink key={item.to} to={item.to} onClick={()=>setMobileOpen(false)} className={({isActive})=>`nav-item ${isActive&&item.to==='/'&&location.pathname!=='/'?'':' '}${isActive?'active':''} ${item.disabled?'disabled':''}`}><item.icon size={18}/><span>{item.label}</span>{item.badge&&<em>{item.badge}</em>}</NavLink>)}</nav><div className="side-bottom"><div className="plan-card"><div className="plan-top"><span className="plan-icon"><Sparkles size={15}/></span><span>PLATFORM STATUS</span><span className="live-dot"/></div><strong>All systems operational</strong><div className="plan-meter"><i/></div><div className="plan-foot"><span>Infrastructure</span><b>Healthy</b></div></div><button type="button" className="nav-item" onClick={()=>setSettingsOpen(true)}><Settings2 size={18}/><span>Settings</span></button><button type="button" className="nav-item" onClick={()=>setHelpOpen(true)}><CircleHelp size={18}/><span>Help & support</span></button><div className="profile-row"><div className="avatar">{initials(user.name)}</div><div className="profile-meta"><strong>{user.name}</strong><small>Super administrator</small></div><button onClick={onLogout} className="icon-button" title="Sign out"><LogOut size={17}/></button></div></div></aside><div className="main-column"><header className="topbar"><button className="icon-button mobile-menu" onClick={()=>setMobileOpen(!mobileOpen)}><Menu size={19}/></button><div className="crumb"><span>EduConnect</span><ChevronRight size={14}/><b>{location.pathname==='/schools'?'Schools':location.pathname==='/activity'?'Activity log':location.pathname==='/team'?'Support team':'Overview'}</b></div><div className="topbar-actions"><div className="top-date"><span className="date-dot"/> {today().toUpperCase()}</div><button type="button" className="icon-button notification" onClick={()=>setNotifOpen(true)} title="System notifications"><Bell size={18}/><i/></button><div className="top-avatar">{initials(user.name)}</div></div></header><main className="page-content"><Routes><Route path="/" element={<OverviewPage onCreate={()=>setCreateOpen(true)}/>}/><Route path="/schools" element={<SchoolsPage onCreate={()=>setCreateOpen(true)}/>}/><Route path="/activity" element={<ActivityPage/>}/><Route path="/team" element={<TeamPage/>}/><Route path="*" element={<OverviewPage onCreate={()=>setCreateOpen(true)}/>}/></Routes></main><footer className="main-footer"><span>EduConnect <i>•</i> Platform administration</span><span>Secure workspace <ShieldCheck size={13}/></span></footer></div>
    {createOpen&&<CreateSchoolModal onClose={()=>setCreateOpen(false)}/>}
    {settingsOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSettingsOpen(false);}}><section className="modal" style={{maxWidth:'540px'}}><div className="modal-head"><div><div className="eyebrow">PLATFORM CONFIGURATION</div><h2>Platform Settings</h2><p>Core system parameters and tenant isolation controls.</p></div><button className="icon-button" onClick={()=>setSettingsOpen(false)}><X size={19}/></button></div><div style={{display:'flex',flexDirection:'column',gap:'1rem',padding:'1rem 0'}}>
      <div style={{padding:'0.85rem',border:'1px solid #e2e8f0',borderRadius:'8px',background:'#f8fafc'}}><strong>Database engine:</strong> PostgreSQL<div style={{fontSize:'0.75rem',color:'#64748b'}}>Embedded multi-tenant schema with Row-Level Security (RLS) enforcement.</div></div>
      <div style={{padding:'0.85rem',border:'1px solid #e2e8f0',borderRadius:'8px',background:'#f8fafc'}}><strong>Authentication provider:</strong> Firebase Authentication<div style={{fontSize:'0.75rem',color:'#64748b'}}>Accounts resolve through linked EduConnect memberships and assigned permissions.</div></div>
      <div style={{padding:'0.85rem',border:'1px solid #e2e8f0',borderRadius:'8px',background:'#f8fafc'}}><strong>Account security:</strong> Invitation and recovery links<div style={{fontSize:'0.75rem',color:'#64748b'}}>Single-use links expire automatically.</div></div>
    </div><div className="modal-actions"><span/><button type="button" className="btn btn-primary" onClick={()=>setSettingsOpen(false)}>Done</button></div></section></div>}
    {helpOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setHelpOpen(false);}}><section className="modal" style={{maxWidth:'540px'}}><div className="modal-head"><div><div className="eyebrow">ASSISTANCE & DOCUMENTATION</div><h2>Help & Support</h2><p>EduConnect administration guidelines. Powered by CalmStacks.</p></div><button className="icon-button" onClick={()=>setHelpOpen(false)}><X size={19}/></button></div><div style={{display:'flex',flexDirection:'column',gap:'1rem',padding:'1rem 0'}}>
      <p style={{fontSize:'0.85rem',color:'#475569',lineHeight:1.6}}>EduConnect is a multi-tenant education platform with school-scoped access controls, attendance, fees, and academic workflows.</p>
      <div style={{padding:'0.85rem',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'8px'}}><strong style={{color:'#166534'}}>Technical Support Hotline:</strong><div style={{fontSize:'0.8rem',color:'#15803d',marginTop:'0.25rem'}}>Support is available through your approved CalmStacks contact channel.</div></div>
    </div><div className="modal-actions"><span/><button type="button" className="btn btn-primary" onClick={()=>setHelpOpen(false)}>Close</button></div></section></div>}
    {notifOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setNotifOpen(false);}}><section className="modal" style={{maxWidth:'540px'}}><div className="modal-head"><div><div className="eyebrow">SYSTEM BROADCASTS</div><h2>Platform Notifications</h2><p>Infrastructure alerts and platform-wide events.</p></div><button className="icon-button" onClick={()=>setNotifOpen(false)}><X size={19}/></button></div><div style={{display:'flex',flexDirection:'column',gap:'0.75rem',padding:'1rem 0'}}>
      <div style={{padding:'0.75rem 1rem',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:'8px'}}><div style={{fontWeight:600,fontSize:'0.85rem',color:'#0f172a'}}>PostgreSQL Wire Engine Healthy</div><div style={{fontSize:'0.75rem',color:'#64748b'}}>Connection pool active with 0 hung clients. Migrations 001–008 applied.</div></div>
      <div style={{padding:'0.75rem 1rem',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:'8px'}}><div style={{fontWeight:600,fontSize:'0.85rem',color:'#0f172a'}}>Multi-Tenant Network Operational</div><div style={{fontSize:'0.75rem',color:'#64748b'}}>School workspaces and role-based data isolation active.</div></div>
    </div><div className="modal-actions"><span/><button type="button" className="btn btn-primary" onClick={()=>setNotifOpen(false)}>Acknowledge</button></div></section></div>}
  </div>;
}

type PlatformUser={id:string;name:string;email:string;role:string;is_active:boolean;created_at:string};
function TeamPage(){
  const qc=useQueryClient(),team=useQuery({queryKey:['platform-team'],queryFn:()=>request<{items:PlatformUser[]}>('/api/platform/team')});const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('');
  const create=useMutation({mutationFn:()=>request<{user:PlatformUser}>('/api/platform/team/support-agents',{method:'POST',body:JSON.stringify({name,email,initialPassword:password})}),onSuccess:()=>{setName('');setEmail('');setPassword('');void qc.invalidateQueries({queryKey:['platform-team']});}});
  const status=useMutation({mutationFn:({id,active}:{id:string;active:boolean})=>request(`/api/platform/team/${id}/status`,{method:'PATCH',body:JSON.stringify({active})}),onSuccess:()=>{void qc.invalidateQueries({queryKey:['platform-team']});}});
  return <><div className="page-heading"><div><div className="eyebrow">CONTROL CENTER / ACCESS</div><h1>Support team</h1><p>Provision technical support accounts. Student records remain unavailable until a school approves a time‑limited request.</p></div></div><div className="team-grid"><section className="panel"><div className="panel-head"><div><div className="panel-kicker">PLATFORM ACCESS</div><h3>Support agents</h3></div></div>{team.isLoading?<div className="table-loading"><div className="table-skeleton"/></div>:team.data?.items.map(member=><div className="access-member" key={member.id}><div><strong>{member.name}</strong><small>{member.email} · {member.role} · {member.is_active?'Active':'Suspended'}</small></div>{member.role==='support_agent'&&<button className="btn btn-secondary small-btn" onClick={()=>status.mutate({id:member.id,active:!member.is_active})}>{member.is_active?'Suspend':'Reactivate'}</button>}</div>)}</section><section className="panel"><div className="panel-kicker">NEW ACCOUNT</div><h3>Create a support agent</h3><form className="team-create" onSubmit={async e=>{e.preventDefault();setError('');try{await create.mutateAsync();}catch(ex){setError((ex as Error).message);}}}><label>Name<input value={name} onChange={e=>setName(e.target.value)} required minLength={2}/></label><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Temporary password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={16}/><small>At least 16 characters. Share through your approved secure channel.</small></label>{(error||create.isError)&&<div className="error-banner">{error||(create.error as Error).message}</div>}<button className="btn btn-primary" disabled={create.isPending}>{create.isPending?'Creating…':'Create support agent'}</button></form></section></div></>;
}

type SupportCase={id:string;status:string;reason:string;school_id:string;school_name:string;requested_scopes:string[];approved_scopes:string[];requested_expires_at:string;expires_at:string|null};
function SupportConsole({user,onLogout}:{user:User;onLogout:()=>void}){
  const qc=useQueryClient(),cases=useQuery({queryKey:['support-cases'],queryFn:()=>request<{items:SupportCase[]}>('/api/platform/support-access/mine')});const [schoolId,setSchoolId]=useState(''),[reason,setReason]=useState(''),[durationMinutes,setDuration]=useState(60),[scopes,setScopes]=useState<string[]>(['students:read']),[preview,setPreview]=useState<Record<string,unknown>[]>([]),[error,setError]=useState('');
  const create=useMutation({mutationFn:()=>request('/api/platform/support-access',{method:'POST',body:JSON.stringify({schoolId,reason,durationMinutes,scopes})}),onSuccess:()=>{setReason('');void qc.invalidateQueries({queryKey:['support-cases']});}});
  async function viewStudents(item:SupportCase){setError('');try{const data=await request<{items:Record<string,unknown>[];total:number}>(`/api/platform/support-access/${item.id}/students`);setPreview(data.items);}catch(ex){setError((ex as Error).message);}}
  const choices=['students:read','fees:read','announcements:read','messages:read'];
  return <main className="school-app"><header className="school-top"><EduConnectBrand compact /><div className="school-top-actions"><div className="top-avatar">{initials(user.name)}</div><button className="btn btn-secondary small-btn" onClick={onLogout}><LogOut size={14}/> Sign out</button></div></header><section className="school-welcome"><div className="eyebrow">PLATFORM SUPPORT</div><h1>Support workspace.</h1><p>Ask a school administrator to approve the minimum data scope needed for a time‑limited investigation.</p></section><div className="team-grid"><section className="panel"><div className="panel-kicker">REQUEST SCHOOL ACCESS</div><h3>New support request</h3><form className="team-create" onSubmit={async e=>{e.preventDefault();setError('');try{await create.mutateAsync();}catch(ex){setError((ex as Error).message);}}}><label>School ID<input value={schoolId} onChange={e=>setSchoolId(e.target.value)} placeholder="e.g. CS-SCH-0001" required/></label><label>Reason<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={12} maxLength={1000} required placeholder="Describe the technical issue and why access is needed."/></label><fieldset><legend>Requested data scopes</legend>{choices.map(scope=><label className="scope-check" key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={e=>setScopes(e.target.checked?[...scopes,scope]:scopes.filter(item=>item!==scope))}/>{scope}</label>)}</fieldset><label>Access window<select value={durationMinutes} onChange={e=>setDuration(Number(e.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option></select></label>{(error||create.isError)&&<div className="error-banner">{error||(create.error as Error).message}</div>}<button className="btn btn-primary" disabled={create.isPending||!scopes.length}>{create.isPending?'Submitting…':'Send to school administrator'}</button></form></section><section className="panel"><div className="panel-head"><div><div className="panel-kicker">AUDITABLE ACCESS</div><h3>Your support requests</h3></div></div>{cases.isLoading?<div className="table-loading"><div className="table-skeleton"/></div>:cases.data?.items.map(item=><div className="support-request" key={item.id}><div><strong>{item.school_name} · {item.status}</strong><small>{item.reason}</small><small>Requested {item.requested_scopes.join(', ')} · {new Date(item.requested_expires_at).toLocaleString()}</small>{item.approved_scopes.length>0&&<small>Approved {item.approved_scopes.join(', ')} · expires {item.expires_at?new Date(item.expires_at).toLocaleString():'—'}</small>}</div>{item.status==='approved'&&item.approved_scopes.includes('students:read')&&item.expires_at&&new Date(item.expires_at)>new Date()&&<button className="btn btn-secondary small-btn" onClick={()=>viewStudents(item)}>View authorized student list</button>}</div>)}</section></div>{error&&<div className="error-inline school-error">{error}</div>}{preview.length>0&&<section className="panel support-preview"><div className="panel-kicker">LIMITED SUPPORT VIEW</div><h3>Authorized student records</h3>{preview.map(row=><div key={String(row.id)} className="access-member"><strong>{String(row.first_name)} {String(row.last_name)}</strong><small>{String(row.admission_number)} · {String(row.status)}</small></div>)}</section>}</main>;
}

function OverviewPage({onCreate}:{onCreate:()=>void}){
  const q=useQuery({queryKey:['overview'],queryFn:()=>request<Overview>('/api/platform/overview')});const schools=useQuery({queryKey:['schools','recent'],queryFn:()=>request<{items:School[]}>('/api/platform/schools?limit=5')});
  return <><div className="page-heading"><div><div className="eyebrow">{today().toUpperCase()} <span className="heading-dash">/</span> CONTROL CENTER</div><h1>Platform overview</h1><p>Here’s what’s happening across your school network.</p></div><div className="heading-actions"><button type="button" className="btn btn-secondary" onClick={()=>{
    exportCsv('platform_network_overview.csv',['Metric','Count / Detail'],[
      ['Total Schools',q.data?.schools.total_schools||0],
      ['Active Schools',q.data?.schools.active_schools||0],
      ['Pending Schools',q.data?.schools.pending_schools||0],
      ['Suspended Schools',q.data?.schools.suspended_schools||0],
      ['Total Users Across Tenants',q.data?.total_users||0],
      ['Total Enrolled Students',q.data?.total_students||0],
      ['Total Active Teachers',q.data?.total_teachers||0],
      ['Total Connected Parents',q.data?.total_parents||0],
      ['Report Generated At',new Date().toISOString()]
    ]);
  }}><Download size={16}/> Export report</button><button className="btn btn-primary" onClick={onCreate}><Plus size={17}/> Add a school</button></div></div>
  {q.isError&&<ErrorPanel message={(q.error as Error).message} retry={()=>q.refetch()}/>}<div className="metric-grid">{[
    {label:'Total schools',value:q.data?.schools.total_schools,sub:`${q.data?.schools.active_schools??'—'} active schools`,icon:Building2,tone:'green',trend:'Network-wide'},
    {label:'Students',value:q.data?.total_students,sub:'Across all school tenants',icon:GraduationCap,tone:'amber',trend:'All records'},
    {label:'Teachers',value:q.data?.total_teachers,sub:'Active teaching staff',icon:Users,tone:'blue',trend:'All schools'},
    {label:'Parents',value:q.data?.total_parents,sub:'Connected family accounts',icon:Users,tone:'purple',trend:'All schools'}
  ].map((m,i)=><div className="metric-card" key={m.label}><div className="metric-top"><span>{m.label}</span><span className={`metric-icon ${m.tone}`}><m.icon size={17}/></span></div><div className="metric-value">{q.isLoading?<div className="skeleton number-skeleton"/>:formatNumber(m.value??0)}</div><div className="metric-bottom"><span>{m.sub}</span><span className="metric-trend"><ArrowUpRight size={13}/>{m.trend}</span></div></div>)}</div>
  <div className="overview-grid"><section className="panel growth-panel"><div className="panel-head"><div><div className="panel-kicker">NETWORK ACTIVITY</div><h3>School growth</h3></div><button type="button" className="select-button" onClick={()=>alert('Displaying rolling 12-month network onboardings.')}>Last 12 months <ChevronDown size={14}/></button></div>{q.isLoading?<div className="chart-skeleton"/>:<GrowthChart rows={q.data?.growth||[]}/>}<div className="chart-legend"><span><i/> Schools onboarded</span><span className="chart-total">{q.data?.schools.total_schools??0} total schools</span></div></section><section className="panel status-panel"><div className="panel-head"><div><div className="panel-kicker">TENANT HEALTH</div><h3>School status</h3></div><button type="button" className="icon-button" onClick={()=>void q.refetch()} title="Refresh status"><MoreHorizontal size={19}/></button></div><div className="status-total"><strong>{formatNumber(q.data?.schools.total_schools??0)}</strong><span>registered schools</span></div><div className="status-bars">{[['Active',q.data?.schools.active_schools??0,'bar-green'],['Pending',q.data?.schools.pending_schools??0,'bar-amber'],['Suspended',q.data?.schools.suspended_schools??0,'bar-gray']].map(([label,num,cls])=><div className="status-row" key={label as string}><div><span>{label}</span><b>{num}</b></div><div className="bar-track"><i className={cls as string} style={{width:`${q.data?.schools.total_schools?Math.max(3,(Number(num)/q.data.schools.total_schools)*100):0}%`}}/></div></div>)}</div><NavLink to="/schools" className="panel-link">View all schools <ChevronRight size={15}/></NavLink></section></div>
  <section className="panel recent-panel"><div className="panel-head"><div><div className="panel-kicker">LATEST ONBOARDING</div><h3>Recently added schools</h3></div><NavLink to="/schools" className="text-link">View directory <ChevronRight size={14}/></NavLink></div><SchoolTable schools={schools.data?.items||[]} loading={schools.isLoading} compact/>{schools.isError&&<ErrorPanel message={(schools.error as Error).message} retry={()=>schools.refetch()}/>}</section></>;
}

function GrowthChart({rows}:{rows:Overview['growth']}){
  const data=useMemo(()=>{const values=Array.from({length:12},(_,i)=>{const date=new Date();date.setDate(1);date.setMonth(date.getMonth()-11+i);const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;return {key,label:new Intl.DateTimeFormat('en',{month:'short'}).format(date),value:rows.find(r=>String(r.month).slice(0,7)===key)?.schools||0};});return values;},[rows]);const max=Math.max(4,...data.map(d=>d.value));
  return <div className="chart-wrap"><div className="chart-y"><span>{max}</span><span>{Math.round(max*.66)}</span><span>{Math.round(max*.33)}</span><span>0</span></div><div className="chart-plot"><div className="chart-gridlines"><i/><i/><i/><i/></div><div className="chart-bars">{data.map((d,i)=><div className="chart-column" key={d.key} title={`${d.label}: ${d.value}`}><div className={`chart-bar ${i===data.length-1?'current':''}`} style={{height:`${Math.max(d.value?5:2,(d.value/max)*100)}%`}}/><span>{d.label}</span></div>)}</div></div></div>;
}

function SchoolsPage({onCreate}:{onCreate:()=>void}){
  const [search,setSearch]=useState(''),[status,setStatus]=useState('');const q=useQuery({queryKey:['schools',search,status],queryFn:()=>request<{items:School[];page:number;limit:number;total:number}>(`/api/platform/schools?limit=50&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`)});
  return <><div className="page-heading"><div><div className="eyebrow">CONTROL CENTER <span className="heading-dash">/</span> DIRECTORY</div><h1>School directory</h1><p>Manage school tenants, administrators, and access status.</p></div><button className="btn btn-primary" onClick={onCreate}><Plus size={17}/> Add a school</button></div><section className="panel directory-panel"><div className="directory-toolbar"><div className="search-box"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search school name or ID…"/></div><div className="toolbar-right"><label className="filter-select"><Filter size={15}/><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['active','pending','suspended','expired','deactivated'].map(s=><option key={s} value={s}>{titleCase(s)}</option>)}</select><ChevronDown size={13}/></label><button type="button" className="btn btn-secondary small-btn" onClick={()=>setStatus(s=>s===''?'active':s==='active'?'pending':s==='pending'?'suspended':'')}><SlidersHorizontal size={15}/> {status?`Filter: ${titleCase(status)}`:'All statuses'}</button></div></div><SchoolTable schools={q.data?.items||[]} loading={q.isLoading} error={q.error as Error|undefined} retry={()=>q.refetch()} total={q.data?.total}/></section></>;
}

function SchoolTable({schools,loading,compact,error,retry,total}:{schools:School[];loading:boolean;compact?:boolean;error?:Error;retry?:()=>void;total?:number}){
  const qc=useQueryClient();const mutation=useMutation({mutationFn:({id,status}:{id:string;status:string})=>request(`/api/platform/schools/${id}/status`,{method:'PATCH',body:JSON.stringify({status})}),onSuccess:()=>{void qc.invalidateQueries({queryKey:['schools']});void qc.invalidateQueries({queryKey:['overview']});}});
  if(loading)return <div className="table-loading">{[1,2,3].map(i=><div className="table-skeleton" key={i}/>)}</div>;
  if(error)return <ErrorPanel message={error.message} retry={retry||(()=>{})}/>;
  return <><div className="table-scroll"><table><thead><tr><th>SCHOOL</th><th>CONTACT</th><th>SUBSCRIPTION</th><th>STATUS</th><th>ONBOARDED</th><th/></tr></thead><tbody>{schools.map(s=><tr key={s.id}><td><div className="school-cell"><div className="school-logo">{schoolGlyph(s.name)}</div><div><strong>{s.name}</strong><small>{s.school_id}</small></div></div></td><td><span className="contact-main">{s.contact_email}</span><small className="contact-sub">{s.contact_phone||'—'}</small></td><td><span className="plan-name">{s.plan_name||'No plan assigned'}</span><small className="contact-sub">{s.expires_at?`Renews ${dateLabel(s.expires_at)}`:'Trial / setup'}</small></td><td><StatusBadge status={s.status}/></td><td><span className="date-cell">{dateLabel(s.created_at)}</span></td><td><select className="row-action" aria-label={`Change ${s.name} status`} value="" onChange={e=>{if(e.target.value)mutation.mutate({id:s.id,status:e.target.value});e.target.value='';}}><option value="">•••</option>{s.status!=='active'&&<option value="active">Activate</option>}{s.status!=='suspended'&&<option value="suspended">Suspend</option>}{s.status!=='deactivated'&&<option value="deactivated">Deactivate</option>}</select></td></tr>)}</tbody></table></div>{schools.length===0&&<div className="empty-state"><div className="empty-icon"><Building2 size={20}/></div><strong>No schools found</strong><span>Try another search or add a new school tenant.</span></div>}{mutation.isError&&<div className="error-inline">{(mutation.error as Error).message}</div>}<div className="table-footer"><span>Showing <b>{schools.length}</b> of <b>{total??schools.length}</b> schools</span><div><button className="pager" disabled><ChevronLeft size={15}/></button><button className="pager selected">1</button><button className="pager" disabled><ChevronRight size={15}/></button></div></div></>;
}

function ActivityPage(){const q=useQuery({queryKey:['audit'],queryFn:()=>request<{items:{id:string;action:string;target_type:string;target_id:string;metadata:Record<string,unknown>;created_at:string;actor_name:string}[]}>('/api/platform/audit-logs')});return <><div className="page-heading"><div><div className="eyebrow">CONTROL CENTER <span className="heading-dash">/</span> GOVERNANCE</div><h1>Activity log</h1><p>A record of administrative actions across the platform.</p></div></div><section className="panel audit-panel"><div className="panel-head"><div><div className="panel-kicker">AUDIT TRAIL</div><h3>Recent platform activity</h3></div><button type="button" className="btn btn-secondary small-btn" onClick={()=>{exportCsv('platform_activity_audit.csv',['Action','Actor','Target Type','Target ID','Timestamp'],(q.data?.items||[]).map(i=>[i.action,i.actor_name||'Platform Admin',i.target_type,i.target_id,i.created_at]));}}><Download size={15}/> Export</button></div>{q.isLoading?<div className="table-loading"><div className="table-skeleton"/><div className="table-skeleton"/></div>:q.isError?<ErrorPanel message={(q.error as Error).message} retry={()=>q.refetch()}/>:<div className="audit-list">{q.data?.items.map(item=><div className="audit-row" key={item.id}><div className="audit-icon"><Check size={16}/></div><div className="audit-copy"><strong>{titleCase(item.action.replace(/\./g,' '))}</strong><span>{item.actor_name||'Platform administrator'} · {item.target_type} {item.metadata&&'schoolId' in item.metadata?String(item.metadata.schoolId):item.target_id?.slice(0,8)}</span></div><time><Clock3 size={13}/>{dateLabel(item.created_at)}</time></div>)}{q.data?.items.length===0&&<div className="empty-state">No administrative events yet.</div>}</div>}</section></>}

function CreateSchoolModal({onClose}:{onClose:()=>void}){
  const qc=useQueryClient(),plans=useQuery({queryKey:['plans'],queryFn:()=>request<Plans>('/api/platform/plans')});const [created,setCreated]=useState<{school:School;invitation:{email:string;expiresInHours:number;deliveryStatus:'sent'|'pending_delivery';developmentUrl?:string}}|null>(null);
  const form=useForm<CreateValues>({resolver:zodResolver(createSchema),defaultValues:{name:'',address:'',contactEmail:'',contactPhone:'',principalName:'',schoolType:'general',website:'',academicYearLabel:'2026–27',planId:'',administratorName:'',administratorEmail:''}});
  const mutation=useMutation({mutationFn:(values:CreateValues)=>request<{school:School;invitation:{email:string;expiresInHours:number;deliveryStatus:'sent'|'pending_delivery';developmentUrl?:string}}>('/api/platform/schools',{method:'POST',body:JSON.stringify(values)}),onSuccess:data=>{setCreated(data);void qc.invalidateQueries({queryKey:['schools']});void qc.invalidateQueries({queryKey:['overview']});}});
  const resend=useMutation({mutationFn:()=>request<{email:string;expiresInHours:number;deliveryStatus:'sent'|'pending_delivery';developmentUrl?:string}>(`/api/platform/schools/${created!.school.id}/invitation/resend`,{method:'POST'}),onSuccess:invitation=>setCreated(current=>current?{...current,invitation}:null)});
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="modal"><div className="modal-head"><div><div className="eyebrow">CONTROL CENTER / ONBOARDING</div><h2>{created?'School tenant created':'Add a school'}</h2><p>{created?'The tenant is ready for administrator setup.':'Create a secure workspace for a new school.'}</p></div><button className="icon-button" onClick={onClose}><X size={19}/></button></div>{created?<div className="success-state"><div className="success-icon"><Check size={23}/></div><h3>{created.school.name}</h3><div className="school-id-chip">{created.school.school_id}</div><p>{created.invitation.deliveryStatus==='sent'?'Administrator invitation sent to':'Invitation is ready, but delivery is pending for'} <b>{created.invitation.email}</b>. The link expires in {created.invitation.expiresInHours} hours.</p>{created.invitation.deliveryStatus==='pending_delivery'&&<button className="btn btn-secondary retry-invite" disabled={resend.isPending} onClick={()=>resend.mutate()}>{resend.isPending?'Retrying…':'Retry invitation email'}</button>}{resend.isError&&<div className="error-banner">{(resend.error as Error).message}</div>}{created.invitation.developmentUrl&&<div className="dev-invite"><span>Development invitation</span><a href={created.invitation.developmentUrl} target="_blank" rel="noreferrer">Open invite link <ChevronRight size={14}/></a></div>}<button className="btn btn-primary btn-wide" onClick={onClose}>Done</button></div>:<form className="modal-form" onSubmit={form.handleSubmit(v=>mutation.mutate(v))}><div className="form-section-title">SCHOOL INFORMATION <i/></div><div className="form-grid"><Field label="School name" error={form.formState.errors.name?.message}><input {...form.register('name')} placeholder="e.g. Greenwood Public School"/></Field><Field label="School type"><select {...form.register('schoolType')}><option value="general">General / K–12</option><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="international">International</option><option value="other">Other</option></select></Field><Field label="Contact email" error={form.formState.errors.contactEmail?.message}><input type="email" {...form.register('contactEmail')} placeholder="office@school.edu"/></Field><Field label="Contact phone"><input {...form.register('contactPhone')} placeholder="+91 98765 43210"/></Field><Field label="Principal name"><input {...form.register('principalName')} placeholder="Full name"/></Field><Field label="Website"><input {...form.register('website')} placeholder="https://school.edu"/></Field><Field label="School address" wide><input {...form.register('address')} placeholder="Street, city, state"/></Field><Field label="Academic year"><input {...form.register('academicYearLabel')} placeholder="2026–27"/></Field><Field label="Subscription plan" error={form.formState.errors.planId?.message}><select {...form.register('planId')}><option value="">Select a plan</option>{plans.data?.items.map(p=><option key={p.id} value={p.id}>{p.name} · {titleCase(p.billing_interval)} · {money(p.price_minor,p.currency)}</option>)}</select>{plans.isError&&<small className="field-error">Could not load plans</small>}</Field></div><div className="form-section-title admin-section">INITIAL SCHOOL ADMINISTRATOR <i/></div><div className="form-grid admin-grid"><Field label="Administrator name" error={form.formState.errors.administratorName?.message}><input {...form.register('administratorName')} placeholder="Full name"/></Field><Field label="Administrator email" error={form.formState.errors.administratorEmail?.message}><input type="email" {...form.register('administratorEmail')} placeholder="admin@school.edu"/></Field></div>{mutation.isError&&<div className="error-banner">{(mutation.error as Error).message}</div>}<div className="modal-actions"><span><ShieldCheck size={14}/> Invitation link expires after 72 hours</span><div><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={mutation.isPending||!plans.data?.items.length}>{mutation.isPending?'Creating…':'Create school'}<ChevronRight size={16}/></button></div></div></form>}</section></div>;
}

function Field({label,error,wide,children}:{label:string;error?:string;wide?:boolean;children:React.ReactNode}){return <label className={`field ${wide?'field-wide':''}`}><span>{label}</span>{children}{error&&<small className="field-error">{error}</small>}</label>}
function ErrorPanel({message,retry}:{message:string;retry:()=>void}){return <div className="error-panel"><span>{message}</span><button onClick={retry}>Try again</button></div>}
function StatusBadge({status}:{status:string}){return <span className={`status-badge status-${status}`}><i/>{titleCase(status)}</span>}
function initials(name:string){return name.split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'CS';}
function schoolGlyph(name:string){return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();}
function formatNumber(n:number){return new Intl.NumberFormat('en-IN').format(n);}
function titleCase(s:string){return s.charAt(0).toUpperCase()+s.slice(1);}
function today(){return new Intl.DateTimeFormat('en-IN',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date());}
