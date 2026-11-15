'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { MessageCircle, Plus, ShieldCheck } from 'lucide-react';
import './settings.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Channel = { id: string; phoneNumberId: string; businessAccountId: string; displayPhoneNumber: string; status: string; createdAt: string };

export function SettingsView({ onToast, onChanged }: { onToast: (message: string) => void; onChanged: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]); const [phoneNumberId, setPhoneNumberId] = useState(''); const [businessAccountId, setBusinessAccountId] = useState(''); const [displayPhoneNumber, setDisplayPhoneNumber] = useState(''); const [accessToken, setAccessToken] = useState(''); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const refresh = useCallback(async () => { setLoading(true); try { const response = await fetch(`${API}/channels`, { credentials: 'include' }); if (!response.ok) throw new Error('Could not load WhatsApp channels'); setChannels(await response.json()); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load WhatsApp channels'); } finally { setLoading(false); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const connect = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const response = await fetch(`${API}/channels/whatsapp/connect`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneNumberId: phoneNumberId.trim(), businessAccountId: businessAccountId.trim(), displayPhoneNumber: displayPhoneNumber.trim(), accessToken }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message ?? 'Could not connect WhatsApp');
      setPhoneNumberId(''); setBusinessAccountId(''); setDisplayPhoneNumber(''); setAccessToken(''); await refresh(); onChanged(); onToast('WhatsApp number connected');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not connect WhatsApp'); }
    finally { setSaving(false); }
  };
  return <div className="settings-view">
    <section className="settings-card"><div className="settings-card-heading"><div className="settings-icon"><MessageCircle size={19}/></div><div><h2>WhatsApp Business Platform</h2><p>Connect a Meta Cloud API number to receive and reply to customer messages.</p></div></div>
      {loading ? <div className="settings-state">Loading connected numbers…</div> : channels.length > 0 && <div className="settings-channels">{channels.map(channel => <div className="settings-channel" key={channel.id}><span className={`status-dot ${channel.status === 'CONNECTED' ? 'online' : ''}`}/><div><b>{channel.displayPhoneNumber}</b><small>{channel.status === 'CONNECTED' ? 'Connected' : channel.status}</small></div><span>{channel.phoneNumberId}</span></div>)}</div>}
      <form className="channel-form" onSubmit={connect}><h3>Connect a number</h3><p>Enter your WhatsApp phone number ID, business account ID, and a Meta access token with WhatsApp Business permissions. The token is encrypted before it is stored.</p><label htmlFor="wa-phone-id">Phone number ID</label><input id="wa-phone-id" value={phoneNumberId} onChange={event => setPhoneNumberId(event.target.value)} required maxLength={100}/><label htmlFor="wa-waba-id">WhatsApp Business Account ID</label><input id="wa-waba-id" value={businessAccountId} onChange={event => setBusinessAccountId(event.target.value)} required maxLength={100}/><label htmlFor="wa-display-number">Display phone number</label><input id="wa-display-number" value={displayPhoneNumber} onChange={event => setDisplayPhoneNumber(event.target.value)} required placeholder="+1 555 123 4567" maxLength={30}/><label htmlFor="wa-access-token">Meta access token</label><input id="wa-access-token" type="password" autoComplete="new-password" value={accessToken} onChange={event => setAccessToken(event.target.value)} required minLength={20} maxLength={4096}/>{error && <div className="settings-error" role="alert">{error}</div>}<button className="primary-button" disabled={saving}><Plus size={15}/>{saving ? 'Connecting…' : 'Connect WhatsApp number'}</button></form>
    </section>
    <div className="settings-note"><ShieldCheck size={16}/><span>Only workspace owners and admins can connect channels. The token is never returned by the API after saving.</span></div>
  </div>;
}
