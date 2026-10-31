import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck, Clock, Eye, Globe, MessageSquare, Plus, Send, Users, X } from 'lucide-react';
import { request, type User } from './api';

type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: {
    type: 'school' | 'role' | 'class';
    targetRoles?: string[];
    targetClassIds?: string[];
  };
  status: 'draft' | 'published' | 'archived';
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
  author_name?: string;
  author_role?: string;
};

type InAppNotification = {
  id: string;
  event_type: string;
  title: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export default function AnnouncementsWorkspace({ user }: { user: User }) {
  const qc = useQueryClient();
  const canManage = !!user.permissions?.some(p => p === 'announcements:manage');
  const [activeTab, setActiveTab] = useState<'announcements' | 'notifications'>('announcements');
  const [createModal, setCreateModal] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // 1. Fetch Announcements
  const announcementsQuery = useQuery({
    queryKey: ['announcements'],
    queryFn: () => request<{ items: Announcement[]; total: number }>('/api/school/announcements'),
  });

  // 2. Fetch In-App Notifications
  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => request<{ items: InAppNotification[]; unreadCount: number }>('/api/school/notifications'),
  });

  // Mutations
  const publishMutation = useMutation({
    mutationFn: (id: string) => request(`/api/school/announcements/${id}/publish`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => request(`/api/school/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => request('/api/school/notifications/read-all', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const announcements = announcementsQuery.data?.items || [];
  const notifications = notificationsQuery.data?.items || [];
  const unreadCount = notificationsQuery.data?.unreadCount || 0;

  return (
    <div className="space-y-4">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-lg border border-[#e8ede9] shadow-sm">
        <div>
          <div className="text-[10px] font-bold text-[#89968f] tracking-wider uppercase">Campus Communication</div>
          <h2 className="text-xl font-bold text-[#1c3025] font-['Manrope']">Announcements & Circulars</h2>
          <p className="text-xs text-[#849189]">Targeted school circulars, event broadcasts, and in-app member notifications.</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button className="btn btn-primary" onClick={() => setCreateModal(true)}>
              <Plus size={15} /> Compose Circular
            </button>
          )}
        </div>
      </div>

      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      {/* Tabs */}
      <div className="school-workbar mb-2">
        <div className="school-tabs">
          <button className={activeTab === 'announcements' ? 'selected' : ''} onClick={() => setActiveTab('announcements')}>
            Circulars & Notices ({announcements.length})
          </button>
          <button className={activeTab === 'notifications' ? 'selected' : ''} onClick={() => setActiveTab('notifications')}>
            In-App Notifications {unreadCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[#d99e4e] text-white text-[9px] font-bold">{unreadCount}</span>}
          </button>
        </div>
      </div>

      {/* TAB 1: Announcements List */}
      {activeTab === 'announcements' && (
        <section className="panel p-0 overflow-hidden">
          {announcementsQuery.isLoading ? (
            <div className="p-4 space-y-2">
              <div className="skeleton h-12 w-full" />
              <div className="skeleton h-12 w-full" />
            </div>
          ) : announcements.length === 0 ? (
            <div className="empty-state py-12">
              <MessageSquare size={28} className="text-[#89968f] mb-2" />
              <strong>No announcements published</strong>
              <p className="text-xs text-[#89958d]">Circulars will be visible to students, teachers, and parents here.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#eff2f0]">
              {announcements.map(ann => {
                const isPublished = ann.status === 'published';
                return (
                  <div key={ann.id} className="p-4 hover:bg-[#fafbfa] transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <strong className="text-sm text-[#20392e]">{ann.title}</strong>
                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                          isPublished ? 'bg-[#edf6ef] text-[#49845e]' : 'bg-[#fbf4e8] text-[#a77e3d]'
                        }`}>
                          {isPublished ? 'Published' : 'Draft'}
                        </span>
                        <span className="text-[10px] text-[#748178] bg-[#f0f3f1] px-2 py-0.5 rounded-md flex items-center gap-1">
                          <Users size={12} />
                          {ann.audience.type === 'school' ? 'All School' : ann.audience.type === 'role' ? `Roles: ${ann.audience.targetRoles?.join(', ')}` : 'Targeted Classes'}
                        </span>
                      </div>
                      <p className="text-xs text-[#637168] line-clamp-2 max-w-2xl">{ann.body}</p>
                      <div className="text-[10px] text-[#89958d] flex items-center gap-2">
                        <span>By {ann.author_name || 'School Admin'}</span>
                        <span>•</span>
                        <span>{new Date(ann.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button className="btn btn-secondary small-btn" onClick={() => setSelectedAnnouncement(ann)}>
                        <Eye size={13} /> View
                      </button>
                      {canManage && !isPublished && (
                        <button
                          className="btn btn-primary small-btn"
                          disabled={publishMutation.isPending}
                          onClick={() => publishMutation.mutate(ann.id)}
                        >
                          <Send size={13} /> Publish Now
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: In-App Notifications */}
      {activeTab === 'notifications' && (
        <section className="panel p-0 overflow-hidden">
          <div className="p-3 bg-[#fafbfa] border-b border-[#eff2f0] flex items-center justify-between">
            <span className="text-xs font-bold text-[#43564a]">Your Alerts & Notifications</span>
            {unreadCount > 0 && (
              <button
                className="btn btn-secondary small-btn"
                disabled={markAllRead.isPending}
                onClick={() => markAllRead.mutate()}
              >
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="empty-state py-12">
              <Bell size={28} className="text-[#89968f] mb-2" />
              <strong>No notifications yet</strong>
              <p className="text-xs text-[#89958d]">Important school events and notices will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#eff2f0]">
              {notifications.map(notif => (
                <div
                  key={notif.id}
                  className={`p-3.5 flex items-center justify-between transition ${
                    notif.read_at ? 'bg-white opacity-70' : 'bg-[#f7faf8]'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {!notif.read_at && <span className="w-2 h-2 rounded-full bg-[#36735c]" />}
                      <strong className="text-xs text-[#2b3d32]">{notif.title}</strong>
                    </div>
                    <div className="text-[10px] text-[#89958d]">
                      {new Date(notif.created_at).toLocaleString()}
                    </div>
                  </div>
                  {!notif.read_at && (
                    <button
                      className="btn btn-secondary small-btn"
                      onClick={() => markRead.mutate(notif.id)}
                    >
                      <Check size={13} /> Mark read
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* MODAL: Compose Announcement */}
      {createModal && (
        <ComposeModal
          onClose={() => setCreateModal(false)}
          onSuccess={() => {
            setCreateModal(false);
            void qc.invalidateQueries({ queryKey: ['announcements'] });
            void qc.invalidateQueries({ queryKey: ['notifications'] });
          }}
        />
      )}

      {/* MODAL: View Announcement Details */}
      {selectedAnnouncement && (
        <div className="modal-backdrop">
          <div className="modal school-modal max-w-lg">
            <div className="modal-head">
              <div>
                <div className="eyebrow">CAMPUS NOTICE</div>
                <h2>{selectedAnnouncement.title}</h2>
                <p className="text-xs text-[#89958d]">
                  Audience: {selectedAnnouncement.audience.type.toUpperCase()} • {new Date(selectedAnnouncement.created_at).toLocaleString()}
                </p>
              </div>
              <button className="icon-button" onClick={() => setSelectedAnnouncement(null)}><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="text-sm text-[#354a3c] whitespace-pre-wrap leading-relaxed bg-[#fafbfa] p-4 rounded border border-[#eff2f0]">
                {selectedAnnouncement.body}
              </div>
              <div className="flex justify-end">
                <button className="btn btn-secondary" onClick={() => setSelectedAnnouncement(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ComposeModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audienceType, setAudienceType] = useState<'school' | 'role' | 'class'>('school');
  const [selectedRoles, setSelectedRoles] = useState<string[]>(['parent', 'student']);
  const [publishImmediately, setPublishImmediately] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !body) {
      setError('Title and message content are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request('/api/school/announcements', {
        method: 'POST',
        body: JSON.stringify({
          title,
          body,
          audience: {
            type: audienceType,
            targetRoles: audienceType === 'role' ? selectedRoles : undefined,
          },
          publish: publishImmediately,
        }),
      });
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
            <div className="eyebrow">CIRCULAR COMPOSER</div>
            <h2>Compose Announcement</h2>
            <p>Publish an official notice or schedule updates across your campus.</p>
          </div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="modal-form space-y-3 pb-4">
          <div className="field">
            <span>Title / Subject</span>
            <input required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Science Fair 2026 Registration Open" />
          </div>

          <div className="field">
            <span>Target Audience</span>
            <select value={audienceType} onChange={e => setAudienceType(e.target.value as typeof audienceType)}>
              <option value="school">All School (Students, Parents, Teachers, Staff)</option>
              <option value="role">Targeted Roles Only</option>
            </select>
          </div>

          {audienceType === 'role' && (
            <div className="p-3 bg-[#fafbfa] border border-[#eff2f0] rounded space-y-2">
              <span className="text-[10px] font-bold text-[#89968f] uppercase block">Select Target Roles</span>
              <div className="flex gap-4 text-xs text-[#526258]">
                {['teacher', 'parent', 'student', 'school_admin'].map(r => (
                  <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedRoles.includes(r)}
                      onChange={e => {
                        setSelectedRoles(prev => (e.target.checked ? [...prev, r] : prev.filter(x => x !== r)));
                      }}
                    />
                    <span className="capitalize">{r.replace('_', ' ')}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <span>Notice Content</span>
            <textarea
              required
              rows={5}
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Enter the detailed circular announcement text..."
              className="w-full border border-[#e3e9e5] rounded p-2 text-xs"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-[#526258] cursor-pointer">
            <input type="checkbox" checked={publishImmediately} onChange={e => setPublishImmediately(e.target.checked)} />
            <span>Publish immediately and dispatch notifications to recipient accounts</span>
          </label>

          {error && <div className="error-banner">{error}</div>}

          <div className="modal-actions pt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting...' : publishImmediately ? 'Publish Circular' : 'Save Draft'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
