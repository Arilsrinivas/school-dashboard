import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Image, Palette, RefreshCw, Save, School, ShieldCheck, Link2, Unlink } from 'lucide-react';
import { getLinkedIdentities, linkGoogleAccount, unlinkIdentity, request, type User } from './api';

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
              <span>Email administrator digests when an email provider is configured</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: canUpdate ? 'pointer' : 'default', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={parentNotifications}
                onChange={(e) => setParentNotifications(e.target.checked)}
                disabled={!canUpdate}
                style={{ width: '16px', height: '16px' }}
              />
              <span>Notify parents about homework when push or email delivery is configured</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: canUpdate ? 'pointer' : 'default', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={feeAlerts}
                onChange={(e) => setFeeAlerts(e.target.checked)}
                disabled={!canUpdate}
                style={{ width: '16px', height: '16px' }}
              />
              <span>Email fee receipts when an email provider is configured</span>
            </label>
          </div>
        </div>

        {/* Security & Linked Accounts Section */}
        <LinkedIdentitiesSection />

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

function LinkedIdentitiesSection() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['linked-identities'],
    queryFn: getLinkedIdentities,
  });

  const googleIdentity = data?.identities?.find((id) => id.provider === 'google');

  async function handleUnlink() {
    if (!window.confirm('Are you sure you want to unlink your Google account?')) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await unlinkIdentity('google');
      setMsg({ type: 'success', text: res.message || 'Google account unlinked.' });
      void refetch();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'Failed to unlink Google account' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="form-section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.9rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.5rem' }}>
        <ShieldCheck size={16} /> SECURITY & LINKED ACCOUNTS
      </div>
      <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1rem' }}>
        Manage external identity providers for one-click authentication. Unlinking requires an account password or another linked provider.
      </p>

      {msg && (
        <div style={{ padding: '0.6rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '0.8rem', background: msg.type === 'success' ? '#ecfdf5' : '#fef2f2', color: msg.type === 'success' ? '#065f46' : '#991b1b', border: `1px solid ${msg.type === 'success' ? '#a7f3d0' : '#fecaca'}` }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>Google Account</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {googleIdentity
                  ? `Linked: ${googleIdentity.email} (last authenticated ${new Date(googleIdentity.last_authenticated_at).toLocaleDateString()})`
                  : 'Not linked to this EduConnect account'}
              </div>
            </div>
          </div>
          <div>
            {googleIdentity ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleUnlink}
                disabled={busy || !data?.canUnlink}
                title={!data?.canUnlink ? 'Cannot unlink without an alternative login method' : 'Unlink Google account'}
                style={{ fontSize: '0.75rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Unlink size={13} /> Unlink
              </button>
            ) : (
              <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>
                Link via Google Sign-In on login
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
