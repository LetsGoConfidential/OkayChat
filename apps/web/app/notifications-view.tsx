'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import './notifications.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Notice = { id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string };

export function NotificationCenter({ onOpenInbox }: { onOpenInbox: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API}/notifications?limit=20`, { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json() as { items: Notice[]; unreadCount: number };
      setItems(data.items);
      setUnreadCount(data.unreadCount);
      setError('');
    } catch { /* Keep the shell usable if the API is temporarily unavailable. */ }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('okaychat:workspace-changed', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('okaychat:workspace-changed', refresh);
    };
  }, [refresh]);

  const markAllRead = async () => {
    try {
      const response = await fetch(`${API}/notifications/read-all`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Could not update notifications');
      setItems(current => current.map(item => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
      setUnreadCount(0);
      setError('');
    } catch { setError('Could not mark notifications as read. Try again.'); }
  };

  const openNotification = async (item: Notice) => {
    if (!item.readAt) {
      try {
        const response = await fetch(`${API}/notifications/${item.id}/read`, { method: 'PATCH', credentials: 'include' });
        if (!response.ok) throw new Error('Could not update notification');
        setItems(current => current.map(notice => notice.id === item.id ? { ...notice, readAt: new Date().toISOString() } : notice));
        setUnreadCount(count => Math.max(0, count - 1));
        setError('');
      } catch { setError('Could not open this notification. Try again.'); return; }
    }
    setOpen(false);
    onOpenInbox();
  };

  return <div className="notification-center">
    <button className="icon-button notification-trigger" onClick={() => { setOpen(value => !value); if (!open) void refresh(); }} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={open} aria-controls="notification-panel">
      <Bell size={18}/>{unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {open && <section className="notification-panel" id="notification-panel" aria-label="Notifications">
      <header className="notification-heading"><div><b>Notifications</b><span>{unreadCount ? `${unreadCount} unread` : 'You’re all caught up'}</span></div><button type="button" aria-label="Mark all notifications as read" title="Mark all as read" onClick={() => void markAllRead()} disabled={!unreadCount}><CheckCheck size={16}/></button></header>
      {error && <p className="notification-error" role="alert">{error}</p>}
      <div className="notification-list">
        {items.length ? items.map(item => <button className={`notification-item ${item.readAt ? '' : 'unread'}`} type="button" key={item.id} onClick={() => void openNotification(item)}>
          <span className="notification-icon"><Inbox size={15}/></span><span className="notification-copy"><b>{item.title}</b><span>{item.body}</span><time dateTime={item.createdAt}>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}</time></span>{!item.readAt && <i className="notification-unread-dot" aria-label="Unread"/>}
        </button>) : <div className="notification-empty"><Bell size={19}/><b>No notifications yet</b><span>Updates about assigned conversations will show here.</span></div>}
      </div>
    </section>}
  </div>;
}
