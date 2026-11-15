'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import './templates.css';
import './campaigns.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Channel = { id: string; displayPhoneNumber: string; status: string };
type Template = { id: string; channelId: string; name: string; language: string; category: string | null; status: string; components: { type?: string; text?: string }[]; displayPhoneNumber: string | null; syncedAt: string };

export function TemplatesView({ onToast }: { onToast: (message: string) => void }) {
  const [channels, setChannels] = useState<Channel[]>([]); const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [channelResponse, templateResponse] = await Promise.all([fetch(`${API}/channels`, { credentials: 'include' }), fetch(`${API}/templates`, { credentials: 'include' })]);
      if (!channelResponse.ok || !templateResponse.ok) throw new Error('Could not load WhatsApp templates');
      setChannels(await channelResponse.json()); setTemplates(await templateResponse.json()); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load WhatsApp templates'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const sync = async (channel: Channel) => {
    setBusy(channel.id); setError('');
    try {
      const response = await fetch(`${API}/templates/sync/${channel.id}`, { method: 'POST', credentials: 'include' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? 'Could not sync templates');
      onToast(`${result.synced} templates synced`); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sync templates'); }
    finally { setBusy(''); }
  };
  const connected = channels.filter(channel => channel.status === 'CONNECTED');
  return <section className="templates-view">
    {connected.length > 0 && <div className="templates-channels">{connected.map(channel => <div className="template-channel" key={channel.id}><span><b>{channel.displayPhoneNumber}</b><small>WhatsApp Business Account</small></span><button className="template-sync" onClick={() => void sync(channel)} disabled={busy === channel.id}><RefreshCw size={14} className={busy === channel.id ? 'is-spinning' : ''}/>{busy === channel.id ? 'Syncing…' : 'Sync templates'}</button></div>)}</div>}
    {error && <p className="templates-error" role="alert">{error}</p>}
    <div className="campaign-list-heading"><div><h2>Message templates</h2><p>Approved templates are required to start business-initiated conversations.</p></div><span>{templates.length} total</span></div>
    {loading ? <div className="templates-empty">Loading templates…</div> : templates.length ? <div className="template-list">{templates.map(template => { const body = template.components?.find(component => component.type?.toUpperCase() === 'BODY')?.text; return <article className="template-row" key={template.id}><div className="template-icon"><FileText size={17}/></div><div className="template-main"><b>{template.name}</b><small>{template.displayPhoneNumber ?? 'WhatsApp'} · {template.language} · {template.category ?? 'Uncategorized'}</small>{body && <p>{body}</p>}</div><span className={`template-status ${template.status.toLowerCase()}`}>{template.status.replaceAll('_', ' ')}</span></article>; })}</div> : <div className="templates-empty"><FileText size={22}/><b>{connected.length ? 'No synced templates yet' : 'Connect a WhatsApp channel first'}</b><span>{connected.length ? 'Sync a connected number to review templates and approval status.' : 'Your WhatsApp message templates will appear here once a channel is connected.'}</span></div>}
  </section>;
}
