'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Check, Copy, MailPlus, RefreshCw, Shield, UserRound, X } from 'lucide-react';
import './team.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Member = { id: string; role: string; joinedAt: string; user: { id: string; name: string; email: string } };
type Invite = { id: string; email: string; role: string; createdAt: string; expiresAt: string; inviteUrl?: string };

export function TeamView({ role, onToast }: { role: string; onToast: (message: string) => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('AGENT');
  const [createdLink, setCreatedLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canInvite = role === 'OWNER' || role === 'ADMIN';
  const canInviteAdmins = role === 'OWNER';

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const memberResponse = await fetch(`${API}/workspaces/current/members`, { credentials: 'include' });
      const memberData = await memberResponse.json();
      if (!memberResponse.ok) throw new Error(memberData.message || 'Could not load workspace teammates');
      setMembers(memberData);
      if (canInvite) {
        const inviteResponse = await fetch(`${API}/workspaces/current/invites`, { credentials: 'include' });
        const inviteData = await inviteResponse.json();
        if (!inviteResponse.ok) throw new Error(inviteData.message || 'Could not load pending invitations');
        setInvites(inviteData);
      } else setInvites([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load team'); }
    finally { setLoading(false); }
  }, [canInvite]);

  useEffect(() => { void load(); }, [load]);

  const createInvite = async (event: FormEvent) => {
    event.preventDefault(); if (!email.trim() || saving) return;
    setSaving(true); setError(''); setCreatedLink('');
    try {
      const response = await fetch(`${API}/workspaces/current/invites`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), role: inviteRole }) });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message || 'Could not create invitation');
      setEmail(''); setCreatedLink(result.inviteUrl); setInvites(current => [result, ...current]); onToast('Invitation link created');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create invitation'); }
    finally { setSaving(false); }
  };

  const copyLink = async (link: string) => {
    try { await navigator.clipboard.writeText(link); onToast('Invitation link copied'); }
    catch { onToast('Clipboard access is unavailable in this browser'); }
  };

  const revoke = async (invite: Invite) => {
    const response = await fetch(`${API}/workspaces/current/invites/${invite.id}/revoke`, { method: 'POST', credentials: 'include' });
    if (!response.ok) { onToast('Could not revoke invitation'); return; }
    setInvites(current => current.filter(item => item.id !== invite.id)); if (invite.inviteUrl === createdLink) setCreatedLink(''); onToast('Invitation revoked');
  };

  return <div className="team-page">
    <div className="team-summary"><div className="team-summary-icon"><UserRound size={19}/></div><div><b>{members.length} workspace {members.length === 1 ? 'member' : 'members'}</b><span>One team, one shared customer inbox.</span></div><button className="team-refresh" onClick={() => void load()} aria-label="Refresh team"><RefreshCw size={15}/></button></div>
    {error && <div className="team-error">{error}</div>}
    {canInvite && <section className="team-card"><div className="team-card-heading"><div><h2>Invite a teammate</h2><p>Create a secure link to share with a person you want to add.</p></div><MailPlus size={18}/></div>
      <form className="team-invite-form" onSubmit={event => void createInvite(event)}><label>Email address<input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="teammate@company.com"/></label><label>Workspace role<select value={inviteRole} onChange={event => setInviteRole(event.target.value)}><option value="AGENT">Agent · Inbox access</option><option value="MANAGER">Manager · Campaigns and analytics</option>{canInviteAdmins && <option value="ADMIN">Admin · Workspace management</option>}</select></label><button className="primary-button" disabled={saving || !email.trim()}>{saving ? 'Creating…' : 'Create invite link'} <MailPlus size={15}/></button></form>
      {createdLink && <div className="invite-created"><div><Check size={15}/><span>Link ready · expires in 7 days</span></div><code>{createdLink}</code><button onClick={() => void copyLink(createdLink)}><Copy size={14}/>Copy link</button></div>}
    </section>}
    <section className="team-card"><div className="team-card-heading"><div><h2>Workspace members</h2><p>People who can access this workspace.</p></div><Shield size={18}/></div>{loading ? <div className="team-empty">Loading team…</div> : members.length ? <div className="team-list">{members.map(member => <div className="team-row" key={member.id}><div className="team-avatar">{member.user.name.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div><div className="team-person"><b>{member.user.name}</b><span>{member.user.email}</span></div><span className={`team-role role-${member.role.toLowerCase()}`}>{member.role.toLowerCase()}</span></div>)}</div> : <div className="team-empty">No members were found.</div>}</section>
    {canInvite && <section className="team-card"><div className="team-card-heading"><div><h2>Pending invitations</h2><p>Unused invite links expire after seven days.</p></div><MailPlus size={18}/></div>{invites.length ? <div className="team-list">{invites.map(invite => <div className="team-row" key={invite.id}><div className="team-avatar invite-avatar"><MailPlus size={15}/></div><div className="team-person"><b>{invite.email}</b><span>Expires {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(invite.expiresAt))}</span></div><span className={`team-role role-${invite.role.toLowerCase()}`}>{invite.role.toLowerCase()}</span>{invite.inviteUrl && <button className="invite-copy" onClick={() => void copyLink(invite.inviteUrl!)} aria-label="Copy invite link"><Copy size={14}/></button>}<button className="invite-revoke" onClick={() => void revoke(invite)} aria-label={`Revoke invitation for ${invite.email}`}><X size={15}/></button></div>)}</div> : <div className="team-empty">No pending invitations.</div>}</section>}
  </div>;
}
