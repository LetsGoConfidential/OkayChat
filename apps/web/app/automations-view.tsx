'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDownToLine, Plus, UserRound, Zap } from 'lucide-react';
import './automations.css';
import './campaigns.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Member = { user: { id: string; name: string; email: string }; role: string };
type Automation = { id: string; name: string; enabled: boolean; trigger: { type?: string }; actions: Array<{ type?: string; userId?: string }> };

export function AutomationsView({ onToast }: { onToast: (message: string) => void }) {
  const [rules, setRules] = useState<Automation[]>([]); const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState(''); const [assigneeId, setAssigneeId] = useState('');
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesResponse, membersResponse] = await Promise.all([fetch(`${API}/automations`, { credentials: 'include' }), fetch(`${API}/workspaces/current/members`, { credentials: 'include' })]);
      if (!rulesResponse.ok || !membersResponse.ok) throw new Error('Could not load automation setup');
      const [rulesData, membersData] = await Promise.all([rulesResponse.json(), membersResponse.json()]);
      setRules(rulesData); setMembers(membersData); setAssigneeId(current => current || membersData[0]?.user.id || ''); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load automation setup'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const create = async (event: FormEvent) => {
    event.preventDefault(); if (!name.trim() || !assigneeId) return; setSaving(true);
    try {
      const response = await fetch(`${API}/automations`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), assigneeId }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.message ?? 'Could not create automation');
      setName(''); onToast('Automation is active for new WhatsApp enquiries'); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create automation'); }
    finally { setSaving(false); }
  };
  const toggle = async (rule: Automation) => {
    const response = await fetch(`${API}/automations/${rule.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !rule.enabled }) });
    if (!response.ok) { onToast('Could not update automation'); return; }
    setRules(current => current.map(item => item.id === rule.id ? { ...item, enabled: !item.enabled } : item));
  };
  const assigneeFor = (rule: Automation) => members.find(member => member.user.id === rule.actions?.[0]?.userId)?.user.name ?? 'Workspace teammate';

  return <section className="automation-view">
    <div className="automation-info"><div><Zap size={20}/></div><span><b>Route every new enquiry</b><small>Automatically assign new WhatsApp conversations to a teammate. Existing manual assignments are kept.</small></span></div>
    <form className="automation-form" onSubmit={create}><label htmlFor="automation-name">Rule name</label><input id="automation-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Assign new enquiries to sales" maxLength={120}/><label htmlFor="automation-assignee">Assign conversations to</label><select id="automation-assignee" value={assigneeId} onChange={event => setAssigneeId(event.target.value)}><option value="">Choose teammate</option>{members.map(member => <option key={member.user.id} value={member.user.id}>{member.user.name} · {member.role.toLowerCase()}</option>)}</select><button className="primary-button" disabled={saving || !name.trim() || !assigneeId}><Plus size={16}/>{saving ? 'Saving…' : 'Create automation'}</button></form>
    {error && <p className="automation-error" role="alert">{error}</p>}
    <div className="campaign-list-heading"><div><h2>Automation rules</h2><p>Runs when a new inbound WhatsApp message arrives.</p></div><span>{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</span></div>
    {loading ? <div className="campaign-empty">Loading automations…</div> : rules.length ? <div className="campaign-list">{rules.map(rule => <article className="campaign-row" key={rule.id}><div className="campaign-row-icon"><ArrowDownToLine size={18}/></div><div className="campaign-row-main"><b>{rule.name}</b><small>New WhatsApp message <span className="automation-arrow">→</span> assign to {assigneeFor(rule)}</small></div><label className="automation-switch"><input type="checkbox" checked={rule.enabled} onChange={() => void toggle(rule)} aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.name}`}/><span>{rule.enabled ? 'Active' : 'Paused'}</span></label></article>)}</div> : <div className="campaign-empty"><UserRound size={22}/><b>No automation rules yet</b><span>Create a rule to route inbound conversations to your team.</span></div>}
  </section>;
}
