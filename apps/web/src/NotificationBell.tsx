import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { request } from './api';

interface NotificationItem {
  id: string;
  announcement_id: string;
  title: string;
  message: string;
  priority: string;
  is_read: boolean;
  created_at: string;
}

export default function NotificationBell({ onOpenAnnouncements }: { onOpenAnnouncements?: () => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['my-notifications'],
    queryFn: () => request<{ items: NotificationItem[] }>('/api/school/notifications'),
    refetchInterval: 30000,
  });

  const markAllRead = useMutation({
    mutationFn: () => request('/api/school/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-notifications'] });
    },
  });

  const markSingleRead = useMutation({
    mutationFn: (id: string) =>
      request(`/api/school/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-notifications'] });
    },
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const items = data?.items || [];
  const unreadCount = items.filter((n) => !n.is_read).length;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="icon-button notification-trigger"
        onClick={() => setOpen((prev) => !prev)}
        title="Notifications"
        style={{
          position: 'relative',
          padding: '0.45rem',
          borderRadius: '8px',
          border: '1px solid var(--border-color, #e2e8f0)',
          background: open ? '#f1f5f9' : 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              background: '#ef4444',
              color: '#ffffff',
              borderRadius: '9999px',
              fontSize: '0.65rem',
              fontWeight: 700,
              minWidth: '16px',
              height: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              lineHeight: 1,
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '320px',
            maxHeight: '400px',
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              borderBottom: '1px solid #e2e8f0',
              background: '#f8fafc',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Notifications</div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                <Check size={12} /> Mark all read
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
            {items.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                No notifications right now
              </div>
            ) : (
              items.slice(0, 10).map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => {
                    if (!notif.is_read) {
                      markSingleRead.mutate(notif.id);
                    }
                  }}
                  style={{
                    padding: '0.7rem 1rem',
                    borderBottom: '1px solid #f1f5f9',
                    backgroundColor: notif.is_read ? '#ffffff' : '#f0f7ff',
                    cursor: notif.is_read ? 'default' : 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ fontWeight: notif.is_read ? 500 : 700, fontSize: '0.825rem', color: '#0f172a' }}>
                      {notif.title}
                    </span>
                    {!notif.is_read && (
                      <span
                        style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          backgroundColor: '#2563eb',
                          marginTop: '4px',
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </div>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.775rem', color: '#475569', lineHeight: 1.35 }}>
                    {notif.message}
                  </p>
                  <span style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.35rem' }}>
                    {new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(notif.created_at))}
                  </span>
                </div>
              ))
            )}
          </div>

          {onOpenAnnouncements && (
            <div
              style={{
                borderTop: '1px solid #e2e8f0',
                padding: '0.5rem 1rem',
                background: '#f8fafc',
                textAlign: 'center',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenAnnouncements();
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                <span>View all announcements</span>
                <ExternalLink size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
