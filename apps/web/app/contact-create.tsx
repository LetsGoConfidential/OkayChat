'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ContactRound, X } from 'lucide-react';
import './contact-create.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export function ContactCreateDialog({ open, onClose, onToast }: { open: boolean; onClose: () => void; onToast: (message: string) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setName(''); setPhone(''); setEmail(''); setCompany(''); setError(''); }
  }, [open]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/contacts`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), ...(email.trim() ? { email: email.trim() } : {}), ...(company.trim() ? { company: company.trim() } : {}), source: 'Manual' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message ?? 'Could not add contact');
      window.dispatchEvent(new Event('okaychat:contacts-changed'));
      onToast(`${result.name} added to contacts`);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add contact'); }
    finally { setBusy(false); }
  };

  return <div className="contact-create-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="contact-create-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-create-title">
      <header><div><span className="contact-create-icon"><ContactRound size={17}/></span><h2 id="contact-create-title">Add a contact</h2><p>Save a customer to this workspace. WhatsApp consent starts as Unknown.</p></div><button type="button" className="contact-create-close" onClick={() => !busy && onClose()} aria-label="Close add contact form"><X size={17}/></button></header>
      <form onSubmit={event => void submit(event)}>
        <label>Contact name<input autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Asha Mehta" autoComplete="name"/></label>
        <label>Phone number<input required type="tel" inputMode="tel" pattern="\+[1-9][0-9]{7,14}" title="Use international format, such as +919876543210" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+919876543210" autoComplete="tel"/><small>Use international format with country code.</small></label>
        <div className="contact-create-row"><label>Email <span>(optional)</span><input type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="asha@example.com" autoComplete="email"/></label><label>Company <span>(optional)</span><input maxLength={160} value={company} onChange={event => setCompany(event.target.value)} placeholder="Business name" autoComplete="organization"/></label></div>
        <div className="contact-create-consent"><b>WhatsApp consent: Unknown</b><span>Only update this after you’ve recorded the customer’s permission.</span></div>
        {error && <p className="contact-create-error" role="alert">{error}</p>}
        <footer><button className="contact-create-cancel" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" type="submit" disabled={busy || !name.trim() || !/^\+[1-9]\d{7,14}$/.test(phone.trim())}>{busy ? 'Saving…' : 'Add contact'}</button></footer>
      </form>
    </section>
  </div>;
}
