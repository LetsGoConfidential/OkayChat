'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, FileText, Megaphone, Plus, Search, Users } from 'lucide-react';
import './campaigns.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Campaign = { id: string; name: string; status: string; templateName: string | null; templateLanguage: string | null; audience: { contactIds?: string[] }; createdAt: string };
type ApprovedTemplate = { id: string; name: string; language: string; status: string; displayPhoneNumber: string | null };
type Contact = { id: string; name: string; phone: string; company: string | null; tags: string[]; whatsappConsent: 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT' };
type Eligibility = { contacts: { selected: number; optedIn: number; optedOut: number; unknown: number; missing: number }; template: { selected: boolean; approved: boolean; channelConnected: boolean }; audienceEligible: boolean; readyForDispatch: boolean; blockers: string[] };

export function CampaignsView({ onToast }: { onToast: (message: string) => void }) {
  const [items, setItems] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<ApprovedTemplate[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [contactQuery, setContactQuery] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<Eligibility | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [response, templateResponse] = await Promise.all([fetch(`${API}/campaigns`, { credentials: 'include' }), fetch(`${API}/templates`, { credentials: 'include' })]);
      if (!response.ok || !templateResponse.ok) throw new Error('Could not load campaigns');
      const [campaignData, templateData] = await Promise.all([response.json(), templateResponse.json()]);
      setItems(campaignData); setTemplates(templateData.filter((item: ApprovedTemplate) => item.status === 'APPROVED')); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load campaigns'); }
    finally { setLoading(false); }
  }, []);

  const refreshContacts = useCallback(async () => {
    setContactsLoading(true);
    try {
      const all: Contact[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ limit: '100' });
        if (cursor) params.set('cursor', cursor);
        const response = await fetch(`${API}/contacts?${params}`, { credentials: 'include' });
        if (!response.ok) throw new Error('Could not load workspace contacts');
        const page: { items: Contact[]; nextCursor: string | null } = await response.json();
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && all.length < 5000);
      setContacts(all);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load workspace contacts'); }
    finally { setContactsLoading(false); }
  }, []);

  useEffect(() => { void refresh(); void refreshContacts(); }, [refresh, refreshContacts]);
  const visibleContacts = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter(contact => `${contact.name} ${contact.phone} ${contact.company ?? ''}`.toLowerCase().includes(query));
  }, [contactQuery, contacts]);
  const eligibleSelected = contacts.filter(contact => selectedContactIds.includes(contact.id) && contact.whatsappConsent === 'OPTED_IN').length;

  const toggleContact = (id: string) => setSelectedContactIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const create = async (event: FormEvent) => {
    event.preventDefault(); if (!name.trim()) return;
    setSaving(true);
    try {
      const selectedTemplate = templates.find(template => template.id === templateId);
      const body = { name: name.trim(), contactIds: selectedContactIds, ...(editingId ? { templateName: selectedTemplate?.name ?? '', templateLanguage: selectedTemplate?.language ?? '' } : selectedTemplate ? { templateName: selectedTemplate.name, templateLanguage: selectedTemplate.language } : {}) };
      const response = await fetch(`${API}/campaigns${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PATCH' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? 'Could not create campaign');
      setName(''); setTemplateId(''); setSelectedContactIds([]); setEditingId(null); onToast(editingId ? 'Campaign draft updated' : 'Campaign draft saved'); setReviewId(null); setReviewData(null); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create campaign'); }
    finally { setSaving(false); }
  };

  const editCampaign = (item: Campaign) => {
    setEditingId(item.id); setName(item.name); setSelectedContactIds(item.audience?.contactIds ?? []); setContactQuery('');
    const selectedTemplate = templates.find(template => template.name === item.templateName && template.language === item.templateLanguage);
    setTemplateId(selectedTemplate?.id ?? ''); setError(''); setReviewId(null); setReviewData(null);
    document.getElementById('campaign-name')?.focus();
  };

  const cancelEdit = () => { setEditingId(null); setName(''); setTemplateId(''); setSelectedContactIds([]); setError(''); };

  const toggleVisible = () => {
    const visibleIds = visibleContacts.map(contact => contact.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedContactIds.includes(id));
    setSelectedContactIds(current => allSelected ? current.filter(id => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);
  };

  const reviewAudience = async (campaignId: string) => {
    if (reviewId === campaignId) { setReviewId(null); setReviewData(null); setReviewError(''); return; }
    setReviewId(campaignId); setReviewData(null); setReviewError(''); setReviewLoading(true);
    try {
      const response = await fetch(`${API}/campaigns/${campaignId}/eligibility`, { credentials: 'include' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? 'Could not review this audience');
      setReviewData(result);
    } catch (cause) { setReviewError(cause instanceof Error ? cause.message : 'Could not review this audience'); }
    finally { setReviewLoading(false); }
  };

  return <section className="campaigns-view">
    <div className="campaign-intro"><div className="campaign-intro-icon"><Megaphone size={20}/></div><div><b>Plan your next campaign</b><p>Create a WhatsApp campaign draft, choose its approved template, and define the audience.</p></div></div>
    <form className="campaign-create" onSubmit={create}>
      <div className="campaign-field"><label htmlFor="campaign-name">Campaign name</label><input id="campaign-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="e.g. October property launch"/></div>
      <div className="campaign-field"><label htmlFor="campaign-template">Approved WhatsApp template</label><select id="campaign-template" value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="">Choose later</option>{templates.map(template => <option value={template.id} key={template.id}>{template.name} · {template.language}</option>)}</select></div>
      <div className="campaign-form-actions"><button className="primary-button" disabled={saving || !name.trim()}><Plus size={16}/>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create draft'}</button>{editingId && <button className="campaign-cancel-button" type="button" onClick={cancelEdit} disabled={saving}>Cancel</button>}</div>
      <div className="campaign-audience-picker">
        <div className="audience-picker-heading"><div><b>Choose contacts</b><span>{selectedContactIds.length} selected</span><span className="audience-eligible-count">{eligibleSelected} opted in</span></div><button type="button" className="text-link" onClick={toggleVisible} disabled={contactsLoading || !visibleContacts.length}>{visibleContacts.length && visibleContacts.every(contact => selectedContactIds.includes(contact.id)) ? 'Clear visible' : 'Select visible'}</button></div>
        <div className="audience-search"><Search size={14}/><input aria-label="Search campaign contacts" value={contactQuery} onChange={event => setContactQuery(event.target.value)} placeholder="Find a contact by name, phone, or company"/></div>
        <div className="audience-contact-list">
          {contactsLoading ? <div className="audience-empty">Loading contacts…</div> : visibleContacts.length ? visibleContacts.slice(0, 100).map(contact => <label className="audience-contact" key={contact.id}><input type="checkbox" checked={selectedContactIds.includes(contact.id)} onChange={() => toggleContact(contact.id)}/><span className="audience-check"><Check size={12}/></span><span className="audience-contact-copy"><b>{contact.name}</b><small>{contact.phone}{contact.company ? ` · ${contact.company}` : ''}</small></span><span className={`consent-pill consent-${contact.whatsappConsent.toLowerCase().replace('_', '-')}`}>{contact.whatsappConsent === 'OPTED_IN' ? 'Opted in' : contact.whatsappConsent === 'OPTED_OUT' ? 'Opted out' : 'Unknown'}</span></label>) : <div className="audience-empty">{contacts.length ? 'No contacts match your search.' : 'Add contacts to your workspace to build a campaign audience.'}</div>}
        </div>
        {!contactsLoading && visibleContacts.length > 100 && <small className="audience-limit">Showing first 100 matches. Search to narrow the list.</small>}
      </div>
    </form>
    {error && <p className="campaign-error" role="alert">{error}</p>}
    <div className="campaign-list-heading"><div><h2>Your campaigns</h2><p>Drafts are saved to this workspace.</p></div><span>{items.length} {items.length === 1 ? 'campaign' : 'campaigns'}</span></div>
    {loading ? <div className="campaign-empty">Loading campaigns…</div> : items.length ? <div className="campaign-list">{items.map(item => <div className="campaign-item" key={item.id}><article className="campaign-row"><div className="campaign-row-icon"><FileText size={18}/></div><div className="campaign-row-main"><b>{item.name}</b><small>{item.templateName ? `Template: ${item.templateName} · ${item.templateLanguage ?? ''}` : 'No template selected'} · Created {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(item.createdAt))}</small></div><div className="campaign-audience"><Users size={14}/>{item.audience?.contactIds?.length ?? 0} contacts</div>{item.status === 'DRAFT' && <button className="campaign-review-button" type="button" onClick={() => editCampaign(item)}>Edit draft</button>}<button className="campaign-review-button" type="button" onClick={() => void reviewAudience(item.id)}>{reviewId === item.id ? 'Close review' : 'Review audience'}</button><span className="campaign-status">{item.status.toLowerCase()}</span></article>{reviewId === item.id && <div className="eligibility-review">{reviewLoading ? <span>Reviewing audience…</span> : reviewError ? <span className="campaign-error">{reviewError}</span> : reviewData && <><div className="eligibility-title"><b>Audience eligibility</b><span className={reviewData.audienceEligible ? 'eligibility-good' : 'eligibility-blocked'}>{reviewData.audienceEligible ? 'All selected contacts opted in' : 'Audience needs attention'}</span></div><div className="eligibility-counts"><span><b>{reviewData.contacts.selected}</b>Selected</span><span><b>{reviewData.contacts.optedIn}</b>Opted in</span><span><b>{reviewData.contacts.optedOut}</b>Opted out</span><span><b>{reviewData.contacts.unknown}</b>Unknown</span><span><b>{reviewData.contacts.missing}</b>Missing</span></div><div className="eligibility-template">Template: {reviewData.template.approved ? 'approved' : 'not selected or unavailable'} · Channel: {reviewData.template.channelConnected ? 'connected' : 'not connected'}</div><ul>{reviewData.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></>}</div>}</div>)}</div> : <div className="campaign-empty"><Megaphone size={22}/><b>No campaigns yet</b><span>Create a draft to start planning your first campaign.</span></div>}
    <p className="campaign-footnote">Review the opted-in count before preparing an audience. Only send to customers with recorded WhatsApp consent; dispatch remains disabled while delivery safeguards are completed.</p>
  </section>;
}
