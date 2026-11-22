import { useState } from 'react';
import { ArrowRight, BookOpen, Building2, Bus, CalendarCheck, Check, ChevronRight, DollarSign, FileText, GraduationCap, Menu, Users, X } from 'lucide-react';
import EduConnectBrand from './EduConnectBrand';
import './educonnect.css';

interface EduConnectLandingProps {
  onOpenDemo: () => void;
  onGoToLogin: () => void;
  onExploreModule: (moduleKey: string) => void;
}

const previewModules = [
  { id: 'admissions', label: 'Admissions', icon: Users, title: 'Move each application forward.', detail: 'Keep enquiries, applications, review steps, and student records in one school workspace.' },
  { id: 'academics', label: 'Academics', icon: BookOpen, title: 'Give academic work a clear home.', detail: 'Bring classes, homework, examinations, results, and timetables into the school day.' },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck, title: 'See the daily register clearly.', detail: 'Record attendance by class and follow each student’s attendance history.' },
  { id: 'fees', label: 'Fee accounts', icon: DollarSign, title: 'Keep fee records in view.', detail: 'Manage fee structures, student balances, offline payments, and receipts.' },
  { id: 'transport', label: 'Transport', icon: Bus, title: 'Organize routes and records.', detail: 'Keep route information together. Live GPS, RFID, and message delivery are not connected.' },
] as const;

export default function EduConnectLanding({ onOpenDemo, onGoToLogin, onExploreModule }: EduConnectLandingProps) {
  const [activeTab, setActiveTab] = useState<(typeof previewModules)[number]['id']>('admissions');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activeModule = previewModules.find(module => module.id === activeTab) || previewModules[0];
  const ActiveIcon = activeModule.icon;

  return (
    <div className="public-site">
      <div className="preview-notice">
        <span className="preview-notice-dot" aria-hidden="true" />
        Product preview. Illustrative interface only; SMS, GPS, biometric hardware, and email delivery are not connected.
      </div>

      <header className="public-header">
        <div className="public-header-inner">
          <a href="/" aria-label="EduConnect home" className="public-brand"><EduConnectBrand compact className="landing-brand" /></a>
          <button className="public-menu-toggle" type="button" onClick={() => setMobileMenuOpen(value => !value)} aria-expanded={mobileMenuOpen} aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}>
            {mobileMenuOpen ? <X size={20}/> : <Menu size={20}/>}
          </button>
          <nav className={`public-nav ${mobileMenuOpen ? 'open' : ''}`} aria-label="Main navigation">
            {previewModules.slice(0, 4).map(module => <button type="button" key={module.id} onClick={() => { setActiveTab(module.id); setMobileMenuOpen(false); document.getElementById('product-preview')?.scrollIntoView({ behavior: 'smooth' }); }}>{module.label}</button>)}
          </nav>
          <div className="public-header-actions">
            <button type="button" className="public-signin" onClick={onGoToLogin}>Sign in</button>
            <button type="button" className="public-primary public-header-cta" onClick={onOpenDemo}>Request a walkthrough <ArrowRight size={16}/></button>
          </div>
        </div>
      </header>

      <main>
        <section className="public-hero">
          <div className="public-hero-inner">
            <div className="public-hero-copy">
              <div className="public-kicker"><span/> School operations, connected</div>
              <h1>Make room for the work that matters at school.</h1>
              <p>EduConnect brings student records, attendance, learning, and school operations into one organized workspace for school teams and families.</p>
              <div className="public-hero-actions">
                <button type="button" className="public-primary" onClick={onOpenDemo}>Request a walkthrough <ArrowRight size={17}/></button>
                <button type="button" className="public-secondary" onClick={onGoToLogin}>Sign in to EduConnect</button>
              </div>
              <div className="public-trust-notes">
                <span><Check size={15}/> School-scoped access</span>
                <span><Check size={15}/> Role-based workspaces</span>
              </div>
            </div>
            <div className="public-hero-visual">
              <img src="/brand/educonnect-school-hero.webp" alt="A teacher helping two students review their schoolwork" />
              <div className="hero-photo-caption"><span className="caption-mark"><Building2 size={16}/></span><span><strong>Built around the school day</strong><small>One workspace for school teams and families</small></span></div>
              <div className="hero-preview-label">Original EduConnect school photography</div>
            </div>
          </div>
          <div className="public-capability-rail" aria-label="EduConnect capabilities">
            <span>Student records</span><i/><span>Attendance</span><i/><span>Academics</span><i/><span>Fee accounts</span><i/><span>Communication</span>
          </div>
        </section>

        <section className="product-preview-section" id="product-preview">
          <div className="public-section-heading">
            <span className="public-kicker">A clearer view of school operations</span>
            <h2>One place to keep the day moving.</h2>
            <p>Explore the modules available in EduConnect. This is a product preview and contains no school records.</p>
          </div>
          <div className="product-preview-layout">
            <div className="preview-module-list" role="tablist" aria-label="Product areas">
              {previewModules.map(module => { const Icon = module.icon; return <button type="button" role="tab" aria-selected={activeTab===module.id} className={activeTab===module.id?'active':''} key={module.id} onClick={() => setActiveTab(module.id)}><Icon size={18}/><span>{module.label}</span><ChevronRight size={15}/></button>; })}
            </div>
            <div className="preview-window" role="tabpanel">
              <div className="preview-window-top"><EduConnectBrand compact/><span className="preview-only"><i/> Illustrative preview</span></div>
              <div className="preview-window-body">
                <div className="preview-window-rail"><span className="preview-rail-dot active"/><span/><span/><span/><span/></div>
                <div className="preview-window-content">
                  <div className="preview-module-heading"><span className="preview-module-icon"><ActiveIcon size={20}/></span><span><small>{activeModule.label}</small><strong>{activeModule.title}</strong></span></div>
                  <p>{activeModule.detail}</p>
                  <div className="preview-workspace-lines" aria-hidden="true"><div/><div/><div/><div/></div>
                  <div className="preview-data-note"><FileText size={15}/> Illustrative interface. Sign in to view records available to your account.</div>
                  <button type="button" className="preview-open-link" onClick={() => onExploreModule(activeTab)}>Explore this workspace <ArrowRight size={15}/></button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="public-capabilities">
          <div className="public-section-heading public-section-heading-left">
            <span className="public-kicker">Designed for everyday coordination</span>
            <h2>Less switching. Clearer handoffs.</h2>
            <p>School teams can work from shared records while each person sees the areas permitted for their role.</p>
          </div>
          <div className="capability-grid">
            <article><span className="capability-index">01</span><h3>Keep student records together</h3><p>Manage admissions, class placement, profiles, and documents in the school workspace.</p><button type="button" onClick={() => onExploreModule('admissions')}>Admissions and students <ArrowRight size={15}/></button></article>
            <article><span className="capability-index">02</span><h3>Coordinate teaching and learning</h3><p>Work with attendance, assignments, examinations, results, and timetables.</p><button type="button" onClick={() => onExploreModule('academics')}>Academic workspace <ArrowRight size={15}/></button></article>
            <article><span className="capability-index">03</span><h3>Make school operations visible</h3><p>Track fee accounts, share announcements, and review operational reports.</p><button type="button" onClick={() => onExploreModule('fees')}>Operations workspace <ArrowRight size={15}/></button></article>
          </div>
        </section>

        <section className="public-role-section">
          <div className="public-role-copy"><span className="public-kicker">A workspace for every part of school</span><h2>One school. The right view for each role.</h2><p>School leaders, teachers, families, and students use role-specific access to reach the information and workflows available to them.</p><button type="button" className="public-secondary" onClick={onGoToLogin}>Open your workspace</button></div>
          <div className="public-role-list"><span><GraduationCap size={18}/> School leaders</span><span><BookOpen size={18}/> Teachers and academic teams</span><span><Users size={18}/> Parents and students</span><span><DollarSign size={18}/> Finance and operations</span></div>
        </section>

        <section className="public-cta-section">
          <div><span className="public-kicker">EduConnect · Powered by CalmStacks</span><h2>See how it fits your school.</h2><p>Request a walkthrough of the school workflows and roles relevant to your team.</p></div>
          <button type="button" className="public-primary" onClick={onOpenDemo}>Request a walkthrough <ArrowRight size={17}/></button>
        </section>
      </main>

      <footer className="public-footer">
        <EduConnectBrand inverse compact className="landing-footer-brand" />
        <span>School operations, connected.</span>
        <button type="button" onClick={onGoToLogin}>Sign in <ArrowRight size={15}/></button>
      </footer>
    </div>
  );
}
