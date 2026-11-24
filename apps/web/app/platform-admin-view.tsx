'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, Building2, ContactRound, Megaphone, RotateCw, Users } from 'lucide-react';
import './platform-admin.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type WorkspaceRow = { id: string; name: string; slug: string; createdAt: string; plan: string; subscriptionStatus: string; members: number; contacts: number; campaigns: number };
type Overview = { metrics: { workspaces: number; users: number; contacts: number; conversations: number; campaigns: number }; workspaces: WorkspaceRow[] };

export function PlatformAdminView() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API}/platform-admin/overview`, { credentials: 'include' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? (response.status === 403 ? 'Your account is not on the platform admin allowlist.' : 'Could not load the platform overview'));
      setData(result); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load the platform overview'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="platform-admin-state">Loading platform overview…</div>;
  if (error) return <section className="platform-admin-error" role="alert"><AlertCircle size={18}/><span>{error}</span><button type="button" onClick={() => void load()}><RotateCw size={14}/>Retry</button></section>;
  if (!data) return null;

  return <section className="platform-admin-view">
    <div className="platform-admin-notice"><Activity size={16}/><span><b>Read-only overview</b><small>Workspace membership, billing, and customer data cannot be changed from this panel. Every overview access is audited.</small></span></div>
    <div className="platform-admin-metrics">
      <Metric icon={Building2} label="Workspaces" value={data.metrics.workspaces}/>
      <Metric icon={Users} label="Accounts" value={data.metrics.users}/>
      <Metric icon={ContactRound} label="Contacts" value={data.metrics.contacts}/>
      <Metric icon={Activity} label="Conversations" value={data.metrics.conversations}/>
      <Metric icon={Megaphone} label="Campaigns" value={data.metrics.campaigns}/>
    </div>
    <div className="platform-admin-table-card"><div className="platform-admin-table-heading"><div><h2>Recent workspaces</h2><p>Newest 50 workspaces · no member email addresses shown</p></div><button type="button" onClick={() => void load()} aria-label="Refresh platform overview"><RotateCw size={14}/>Refresh</button></div>
      {data.workspaces.length ? <div className="platform-admin-table-wrap"><table><thead><tr><th>Workspace</th><th>Plan</th><th>Members</th><th>Contacts</th><th>Campaigns</th><th>Created</th></tr></thead><tbody>{data.workspaces.map(workspace => <tr key={workspace.id}><td><b>{workspace.name}</b><small>{workspace.slug}</small></td><td><span className="platform-plan-pill">{workspace.plan.toLowerCase()}</span><small>{workspace.subscriptionStatus.toLowerCase()}</small></td><td>{workspace.members}</td><td>{workspace.contacts}</td><td>{workspace.campaigns}</td><td>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(workspace.createdAt))}</td></tr>)}</tbody></table></div> : <div className="platform-admin-empty">No workspaces have been created.</div>}
    </div>
  </section>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return <article className="platform-admin-metric"><span><Icon size={16}/></span><small>{label}</small><b>{value.toLocaleString('en-IN')}</b></article>;
}
