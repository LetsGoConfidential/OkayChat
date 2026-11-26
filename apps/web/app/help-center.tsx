'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, CircleHelp, Search, Settings, Users, X } from 'lucide-react';
import './help-center.css';

const guides = [
  { title: 'Connect your WhatsApp number', section: 'Getting started', answer: 'Open Settings → WhatsApp connection. Add the phone number ID, WhatsApp Business Account ID, access token, and verify token from your Meta app. Keep credentials private; OkayChat encrypts the access token when it is saved.' },
  { title: 'Invite your teammates', section: 'Workspace', answer: 'Open Team and create an invitation for the person’s email. Choose the least-privileged role they need, then share the one-time invite link with them.' },
  { title: 'Why can’t I send a freeform message?', section: 'Inbox', answer: 'WhatsApp allows freeform replies during the 24-hour customer service window after a customer message. Outside that window, choose an approved template for the connected number.' },
  { title: 'Send a campaign safely', section: 'Campaigns', answer: 'Create a draft, select an approved template, and choose opted-in contacts. Review every preflight blocker and the recipient counts before confirming dispatch.' },
  { title: 'Understand WhatsApp consent', section: 'Contacts', answer: 'Only message people who opted in. Imported contacts start with Unknown consent. Record the source when a manager updates consent, and honor opt-outs before sending.' },
  { title: 'What does the current plan include?', section: 'Billing', answer: 'The Billing page shows the workspace plan and usage foundation. Paid checkout and invoices are not connected yet, so the plan cards are informational and cannot charge you.' },
];

export function HelpCenter({ onClose, onNavigate }: { onClose: () => void; onNavigate: (page: 'Inbox' | 'Contacts' | 'Team' | 'Campaigns' | 'Settings' | 'Billing') => void }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return guides.filter(guide => !search || `${guide.title} ${guide.section} ${guide.answer}`.toLowerCase().includes(search));
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const actions = [
    { label: 'Connect WhatsApp', page: 'Settings' as const, icon: Settings },
    { label: 'Manage your team', page: 'Team' as const, icon: Users },
    { label: 'Open the Inbox', page: 'Inbox' as const, icon: ArrowRight },
  ];

  return <div className="help-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <header className="help-panel-head"><span className="help-mark"><CircleHelp size={17}/></span><div><h2 id="help-title">How can we help?</h2><p>Quick answers to get your team moving.</p></div><button type="button" className="help-close" onClick={onClose} aria-label="Close help centre"><X size={17}/></button></header>
      <label className="help-search"><Search size={15}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search help articles" aria-label="Search help articles"/></label>
      <div className="help-quick-actions">{actions.map(({ label, page, icon: Icon }) => <button key={page} type="button" onClick={() => { onClose(); onNavigate(page); }}><Icon size={15}/>{label}<ArrowRight size={13}/></button>)}</div>
      <div className="help-articles"><div className="help-section-label"><BookOpen size={14}/>POPULAR GUIDES</div>{filtered.length ? filtered.map(guide => <details className="help-article" key={guide.title}><summary><span><small>{guide.section}</small><b>{guide.title}</b></span><span className="help-chevron">⌄</span></summary><p>{guide.answer}</p></details>) : <p className="help-no-results">No articles match that search. Try “WhatsApp”, “campaign”, or “team”.</p>}</div>
      <footer className="help-footnote">Need to review plan details? <button type="button" onClick={() => { onClose(); onNavigate('Billing'); }}>Open Billing</button></footer>
    </section>
  </div>;
}
