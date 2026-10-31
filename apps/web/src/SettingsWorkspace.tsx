import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Image, Palette, RefreshCw, Save, School, ShieldCheck } from 'lucide-react';
import { request, type User } from './api';

interface SchoolSettings {
  academic_year_label: string | null;
  settings: {
    branding?: {
      primaryColor?: string;
      logoUrl?: string;
      displayName?: string;
    };
    notifications?: Record<string, boolean>;
  };
  updated_at?: string;
}

export default function SettingsWorkspace({ user }: { user: User }) {
  const qc = useQueryClient();
  const canUpdate = user.permissions?.includes('school:settings:update') ?? false;

  const [displayName, setDisplayName] = useState('');
  const [academicYearLabel, setAcademicYearLabel] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  const [logoUrl, setLogoUrl] = useState('');
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [parentNotifications, setParentNotifications] = useState(true);
  const [feeAlerts, setFeeAlerts] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['school-settings'],
    queryFn: () => request<{ settings: SchoolSettings }>('/api/school/settings'),
  });

  useEffect(() => {
    if (data?.settings) {
      const s = data.settings;
      setAcademicYearLabel(s.academic_year_label || '');
      setDisplayName(s.settings?.branding?.displayName || '');
      setPrimaryColor(s.settings?.branding?.primaryColor || '#2563eb');
      setLogoUrl(s.settings?.branding?.logoUrl || '');
      if (s.settings?.notifications) {
        setEmailAlerts(s.settings.notifications['email_alerts'] ?? true);
        setParentNotifications(s.settings.notifications['parent_notifications'] ?? true);
        setFeeAlerts(s.settings.notifications['fee_alerts'] ?? true);
      }
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: (payload: {
      academicYearLabel: string;
      settings: {
        branding: {
          displayName: string;
          primaryColor: string;
          logoUrl?: string;
        };
        notifications: Record<string, boolean>;
      };
    }) =>
      request('/api/school/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
      void qc.invalidateQueries({ queryKey: ['school-settings'] });
      void qc.invalidateQueries({ queryKey: ['school-dashboard'] });
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUpdate) return;
    updateMutation.mutate({
      academicYearLabel,
      settings: {
        branding: {
          displayName,
          primaryColor,
          ...(logoUrl.trim().startsWith('https://') ? { logoUrl: logoUrl.trim() } : { logoUrl: '' }),
        },
        notifications: {
          email_alerts: emailAlerts,
          parent_notifications: parentNotifications,
          fee_alerts: feeAlerts,
        },
      },
    });
  };

  if (isLoading) {
    return (
      <section className="panel school-data-panel">
        <div className="table-loading">
          <div className="table-skeleton" />
          <div className="table-skeleton" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel school-data-panel">
        <div className="error-panel">
          <span>{(error as Error).message}</span>
          <button onClick={() => refetch()}>Retry</button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel school-data-panel">
      <div className="panel-head">
        <div>
          <div className="panel-kicker">SCHOOL CONFIGURATION</div>
          <h3>Branding & Settings</h3>
        </div>
        <div className="top-status-indicator">
          <ShieldCheck size={16} />
          <span>Tenant Isolated (RLS Protected)</span>
        </div>
      </div>

      <form onSubmit={handleSave} className="settings-form" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* Branding Section */}
        <div className="settings-section">
          <div className="form-section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.9rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.5rem' }}>
            <Palette size={16} /> BRAND IDENTITY & THEMING
          </div>
          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
            <div className="field">
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>School Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Greenwood Academy"
                disabled={!canUpdate}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border-color, #cbd5e1)' }}
              />
            </div>

            <div className="field">
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>Primary Brand Color</label>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  disabled={!canUpdate}
                  style={{ width: '42px', height: '38px', padding: '2px', borderRadius: '6px', cursor: 'pointer', border: '1px solid #cbd5e1' }}
                />
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  placeholder="#2563eb"
                  disabled={!canUpdate}
                  style={{ width: '120px', padding: '0.6rem 0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontFamily: 'monospace' }}
                />
                <div style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', background: primaryColor, color: '#fff', fontSize: '0.8rem', fontWeight: 600 }}>
                  Live Preview
                </div>
              </div>
            </div>

            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>Official Logo URL (HTTPS)</label>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.edu/assets/logo.png"
                  disabled={!canUpdate}
                  style={{ flex: 1, padding: '0.6rem 0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                {logoUrl.startsWith('https://') && (
                  <div style={{ width: '42px', height: '42px', border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
                    <img
                      src={logoUrl}
                      alt="Logo preview"
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Academic Settings Section */}
        <div className="settings-section">
          <div className="form-section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.9rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.5rem' }}>
            <School size={16} /> ACADEMIC SETTINGS
          </div>
          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
            <div className="field">
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>Academic Year Label</label>
              <input
                type="text"
                value={academicYearLabel}
                onChange={(e) => setAcademicYearLabel(e.target.value)}
                placeholder="e.g. 2026–27"
                disabled={!canUpdate}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
              <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem', display: 'block' }}>Default label applied to public circulars and reports.</span>
            </div>
          </div>
        </div>

        {/* Operational Notifications */}
        <div className="settings-section">
          <div className="form-section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.9rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.5rem' }}>
            <RefreshCw size={16} /> NOTIFICATION DISPATCH CHANNELS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: canUpdate ? 'pointer' : 'default', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={emailAlerts}
                onChange={(e) => setEmailAlerts(e.target.checked)}
                disabled={!canUpdate}
                style={{ width: '16px', height: '16px' }}
              />
              <span>Send administrator email digests on critical school events</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: canUpdate ? 'pointer' : 'default', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={parentNotifications}
                onChange={(e) => setParentNotifications(e.target.checked)}
                disabled={!canUpdate}
                style={{ width: '16px', height: '16px' }}
              />
              <span>Trigger parent push/email notifications when homework is assigned</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: canUpdate ? 'pointer' : 'default', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={feeAlerts}
                onChange={(e) => setFeeAlerts(e.target.checked)}
                disabled={!canUpdate}
                style={{ width: '16px', height: '16px' }}
              />
              <span>Automatically generate & email fee receipt vouchers on payment recording</span>
            </label>
          </div>
        </div>

        {/* System & Audit metadata */}
        {data?.settings?.updated_at && (
          <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>Last settings update: {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.settings.updated_at))}</span>
          </div>
        )}

        {/* Status / Errors */}
        {updateMutation.isError && (
          <div className="error-banner">{(updateMutation.error as Error).message}</div>
        )}

        {saveSuccess && (
          <div style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '0.75rem 1rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
            <Check size={16} /> School settings updated successfully.
          </div>
        )}

        {/* Submit */}
        {canUpdate && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={updateMutation.isPending}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <Save size={16} />
              {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
