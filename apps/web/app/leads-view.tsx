'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDownUp, Plus, Search, TrendingUp, Users, X } from 'lucide-react';
import './leads.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'SITE_VISIT', 'PROPOSAL', 'WON', 'LOST'] as const;
type Stage = typeof STAGES[number];
type ContactOption = { id: string; name: string; phone: string };
type Lead = { id: string; title: string; stage: Stage; value: string | number | null; createdAt: string; updatedAt: string; contact: ContactOption };

const stageLabel = (stage: Stage) => stage.replaceAll('_', ' ');
const currency = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

export function LeadsView({ role, onToast }: { role: string; onToast: (message: string) => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyLead, setBusyLead] = useState<string | null>(null);
  const [contactId, setContactId] = useState('');
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [createError, setCreateError] = useState('');
  const canManage = ['OWNER', 'ADMIN', 'MANAGER'].includes(role);

  const loadPage = useCallback(async (search: string, nextCursor?: string | null, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (search.trim()) params.set('q', search.trim());
      if (nextCursor) params.set('cursor', nextCursor);
      const response = await fetch(`${API}/leads?${params}`, { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message ?? 'Could not load workspace leads');
      setLeads(current => append ? [...current, ...data.items] : data.items);
      setCursor(data.nextCursor ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load workspace leads'); }
    finally { setLoading(false); setLoadingMore(false); }
  }, []);

  useEffect(() => { const timeout = window.setTimeout(() => { void loadPage(query); }, 220); return () => window.clearTimeout(timeout); }, [loadPage, query]);
  useEffect(() => {
    const loadContacts = async () => {
      setContactsLoading(true);
      try {
        const all: ContactOption[] = [];
        let nextCursor: string | null = null;
        do {
          const params = new URLSearchParams({ limit: '100' });
          if (nextCursor) params.set('cursor', nextCursor);
          const response = await fetch(`${API}/contacts?${params}`, { credentials: 'include' });
          if (!response.ok) throw new Error('Could not load contacts for lead creation');
          const page: { items: ContactOption[]; nextCursor: string | null } = await response.json();
          all.push(...page.items);
          nextCursor = page.nextCursor;
        } while (nextCursor && all.length < 5000);
        setContacts(all);
      } catch (cause) { onToast(cause instanceof Error ? cause.message : 'Could not load contacts'); }
      finally { setContactsLoading(false); }
    };
    if (canManage) void loadContacts();
  }, [canManage, onToast]);

  const loadMore = () => { if (cursor && !loadingMore) void loadPage(query, cursor, true); };

  const updateStage = async (lead: Lead, stage: Stage) => {
    if (lead.stage === stage) return;
    setBusyLead(lead.id);
    try {
      const response = await fetch(`${API}/leads/${lead.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message ?? 'Could not update lead stage');
      setLeads(current => current.map(item => item.id === lead.id ? { ...item, stage, updatedAt: new Date().toISOString() } : item));
      onToast(`Lead moved to ${stageLabel(stage).toLowerCase()}`);
    } catch (cause) { onToast(cause instanceof Error ? cause.message : 'Could not update lead stage'); }
    finally { setBusyLead(null); }
  };

  const createLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contactId || !title.trim()) return;
    setSaving(true); setCreateError('');
    try {
      const response = await fetch(`${API}/leads`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId, title: title.trim(), ...(value ? { value: Number(value) } : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Could not create lead');
      setCreating(false); setContactId(''); setTitle(''); setValue('');
      onToast('Lead added to the pipeline');
      await loadPage(query);
    } catch (cause) { setCreateError(cause instanceof Error ? cause.message : 'Could not create lead'); }
    finally { setSaving(false); }
  };

  const stageCounts = STAGES.map(stage => ({ stage, count: leads.filter(lead => lead.stage === stage).length }));
  const pipelineValue = leads.reduce((sum, lead) => sum + Number(lead.value ?? 0), 0);

  return <section className="leads-view">
    <div className="leads-toolbar"><div className="leads-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search leads, contacts, or phone…"/></div><div className="leads-toolbar-actions"><span className="leads-loaded-count"><Users size={14}/>{leads.length} leads loaded</span>{canManage && <button className="primary-button" onClick={() => { setCreating(true); setCreateError(''); }}><Plus size={15}/>Create lead</button>}</div></div>
    {!loading && !error && <div className="leads-summary"><div><span className="summary-icon"><TrendingUp size={16}/></span><span><small>Pipeline value loaded</small><b>{currency(pipelineValue)}</b></span></div><p>Showing up to {leads.length} matching leads. Load more to see older records.</p></div>}
    {error && <div className="leads-error" role="alert">{error}</div>}
    {loading ? <div className="leads-loading">Loading your pipeline…</div> : !error && leads.length === 0 ? <div className="leads-empty"><span><ArrowDownUp size={21}/></span><b>No leads yet</b><p>Create a lead from a contact to track it through your sales pipeline.</p>{canManage && <button className="primary-button" onClick={() => setCreating(true)}><Plus size={15}/>Create first lead</button>}</div> : !error && <div className="pipeline-board">{stageCounts.map(({ stage, count }) => <section className={`pipeline-column stage-${stage.toLowerCase()}`} key={stage}><header><div><i/><b>{stageLabel(stage)}</b></div><span>{count}</span></header><div className="pipeline-cards">{leads.filter(lead => lead.stage === stage).map(lead => <article className="lead-card" key={lead.id}><div className="lead-card-top"><b>{lead.title}</b>{lead.value != null && <span>{currency(Number(lead.value))}</span>}</div><div className="lead-contact"><div className="lead-avatar">{lead.contact.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div><div><b>{lead.contact.name}</b><small>{lead.contact.phone}</small></div></div><footer><small>Updated {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(lead.updatedAt))}</small>{canManage && <select aria-label={`Move ${lead.title}`} value={lead.stage} disabled={busyLead === lead.id} onChange={event => void updateStage(lead, event.target.value as Stage)}>{STAGES.map(option => <option value={option} key={option}>{stageLabel(option)}</option>)}</select>}</footer></article>)}</div></section>)}</div>}
    {cursor && !loading && !error && <button className="load-more-leads" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more leads'}</button>}
    {creating && <div className="lead-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setCreating(false); }}><section className="lead-modal" role="dialog" aria-modal="true" aria-labelledby="lead-create-title"><header><div><h2 id="lead-create-title">Create a lead</h2><p>Choose a contact and add the opportunity to your pipeline.</p></div><button type="button" aria-label="Close" onClick={() => !saving && setCreating(false)}><X size={17}/></button></header><form onSubmit={event => void createLead(event)}><label>Contact<select required value={contactId} onChange={event => setContactId(event.target.value)} disabled={contactsLoading}><option value="">{contactsLoading ? 'Loading contacts…' : 'Choose a contact'}</option>{contacts.map(contact => <option value={contact.id} key={contact.id}>{contact.name} · {contact.phone}</option>)}</select></label><label>Opportunity name<input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. 3-bedroom apartment enquiry"/></label><label>Estimated value <small>(optional)</small><div className="lead-value-input"><span>₹</span><input type="number" min="0" step="0.01" value={value} onChange={event => setValue(event.target.value)} placeholder="0"/></div></label>{createError && <p className="lead-create-error" role="alert">{createError}</p>}<footer><button type="button" className="campaign-cancel-button" disabled={saving} onClick={() => setCreating(false)}>Cancel</button><button className="primary-button" disabled={saving || contactsLoading || contacts.length === 0}>{saving ? 'Creating…' : 'Create lead'}</button></footer></form></section></div>}
  </section>;
}
