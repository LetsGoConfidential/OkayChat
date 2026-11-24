'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowUpRight, BarChart3, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, FileText, Inbox, LayoutDashboard, LogOut, Menu, MessageCircle, MoreHorizontal, Plus, Search, Send, Settings, Users, WalletCards, Zap } from 'lucide-react';
import { InboxView } from './inbox-view';
import { CampaignsView } from './campaigns-view';
import { AutomationsView } from './automations-view';
import { AnalyticsStats, AnalyticsView } from './analytics-view';
import { TemplatesView } from './templates-view';
import { SettingsView } from './settings-view';
import { TeamView } from './team-view';
import { ContactImportButton } from './contact-import';
import { LeadsView } from './leads-view';
import { NotificationCenter } from './notifications-view';

type Nav = 'Home'|'Inbox'|'Contacts'|'Leads'|'Campaigns'|'Templates'|'Automations'|'Analytics'|'Team'|'Billing'|'Settings';
type WorkspaceSummary = { id: string; name: string; slug: string; timezone: string; role: string };
type CrmRow = { id: string; name: string; company: string; phone: string; tags: string[]; whatsappConsent?: 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT'; stage?: string; createdAt: string };
type RecentConversation = { id: string; status: string; contact: { name: string; phone: string }; messages: { body: string | null; createdAt: string }[] };
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const navItems: { label: Nav; icon: typeof Inbox; group: string }[] = [
  { label: 'Home', icon: LayoutDashboard, group: 'WORKSPACE' }, { label: 'Inbox', icon: Inbox, group: 'WORKSPACE' }, { label: 'Contacts', icon: Users, group: 'WORKSPACE' }, { label: 'Leads', icon: Activity, group: 'WORKSPACE' },
  { label: 'Campaigns', icon: Send, group: 'ENGAGE' }, { label: 'Templates', icon: FileText, group: 'ENGAGE' }, { label: 'Automations', icon: Zap, group: 'ENGAGE' },
  { label: 'Analytics', icon: BarChart3, group: 'MANAGE' }, { label: 'Team', icon: Users, group: 'MANAGE' }, { label: 'Billing', icon: WalletCards, group: 'MANAGE' }, { label: 'Settings', icon: Settings, group: 'MANAGE' },
];

export default function OkayChat() {
  const router = useRouter();
  const [active, setActive] = useState<Nav>('Home'); const [query, setQuery] = useState(''); const [notice, setNotice] = useState('');
  const [mobileNav, setMobileNav] = useState(false); const [profileOpen, setProfileOpen] = useState(false); const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null); const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]); const [channelsConnected, setChannelsConnected] = useState(false);
  const toast = useCallback((message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2800); }, []);

  const loadWorkspaces = useCallback(async () => {
    try {
      const [currentResponse, listResponse, channelsResponse] = await Promise.all([
        fetch(`${API}/workspaces/current`, { credentials: 'include' }), fetch(`${API}/workspaces`, { credentials: 'include' }), fetch(`${API}/channels`, { credentials: 'include' }),
      ]);
      if (currentResponse.ok) setWorkspace(await currentResponse.json());
      if (listResponse.ok) setWorkspaces(await listResponse.json());
      if (channelsResponse.ok) { const channels = await channelsResponse.json(); setChannelsConnected(channels.some((channel: { status: string }) => channel.status === 'CONNECTED')); }
    } catch { /* Show the shell while the API is unavailable. */ }
  }, []);
  useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces]);

  const activateWorkspace = async (id: string) => {
    const response = await fetch(`${API}/workspaces/${id}/activate`, { method: 'POST', credentials: 'include' });
    if (!response.ok) { toast('Could not switch workspace'); return; }
    const result = await response.json(); setWorkspace(result.workspace); if (result.workspace.role === 'AGENT' && active === 'Leads') setActive('Home'); setWorkspaceMenu(false); await loadWorkspaces();
    window.dispatchEvent(new Event('okaychat:workspace-changed')); window.dispatchEvent(new Event('okaychat:contacts-changed')); toast('Workspace switched');
  };
  const createWorkspace = async () => {
    const name = window.prompt('Name your new workspace'); if (!name?.trim()) return;
    const response = await fetch(`${API}/workspaces`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
    if (!response.ok) { toast('Could not create workspace'); return; }
    const result = await response.json(); setWorkspace(result.workspace); await loadWorkspaces(); setWorkspaceMenu(false); toast('Workspace created');
  };
  const addContact = async () => {
    const name = window.prompt('Contact name'); if (!name?.trim()) return;
    const phone = window.prompt('Phone number in international format, e.g. +919876543210'); if (!phone?.trim()) return;
    const response = await fetch(`${API}/contacts`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), phone: phone.trim(), source: 'Manual' }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { toast(Array.isArray(result.message) ? result.message.join(', ') : result.message ?? 'Could not add contact'); return; }
    window.dispatchEvent(new Event('okaychat:contacts-changed')); toast(`${result.name} added to contacts`);
  };
  const signOut = async () => { try { await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' }); } finally { router.replace('/login'); } };

  return <div className="shell">
    <aside className={`sidebar ${mobileNav ? 'show' : ''}`}>
      <div className="brand"><div className="brand-icon"><MessageCircle size={18} fill="currentColor"/></div><span>okay<span className="brand-light">chat</span></span><button className="collapse" aria-label="Collapse sidebar"><ChevronLeft size={16}/></button></div>
      <button className="workspace-switch" onClick={() => setWorkspaceMenu(open => !open)}><div className="workspace-mark">{(workspace?.name ?? 'O').slice(0, 1).toUpperCase()}</div><div className="workspace-copy"><b>{workspace?.name ?? 'Loading workspace'}</b><small>{workspace?.role ? `${workspace.role.toLowerCase()} workspace` : 'Business workspace'}</small></div><ChevronDown size={15}/></button>
      {workspaceMenu && <div className="workspace-menu"><div className="workspace-menu-label">YOUR WORKSPACES</div>{workspaces.map(item => <button key={item.id} onClick={() => void activateWorkspace(item.id)}><span className="workspace-mark">{item.name.slice(0, 1).toUpperCase()}</span><span><b>{item.name}</b><small>{item.role.toLowerCase()}</small></span>{item.id === workspace?.id && <Check size={14}/>}</button>)}<button className="workspace-create" onClick={() => void createWorkspace()}><Plus size={15}/> Create workspace</button></div>}
      {['WORKSPACE', 'ENGAGE', 'MANAGE'].map(group => <div className="nav-group" key={group}><div className="nav-label">{group}</div>{navItems.filter(item => item.group === group && !(item.label === 'Leads' && workspace?.role === 'AGENT')).map(item => <button key={item.label} className={`nav-item ${active === item.label ? 'active' : ''}`} onClick={() => { setActive(item.label); setMobileNav(false); }}><item.icon size={17}/><span>{item.label}</span></button>)}</div>)}
      <div className="sidebar-bottom"><div className="whatsapp-status"><span className={`status-dot ${channelsConnected ? 'online' : ''}`}/><div><b>{channelsConnected ? 'WhatsApp connected' : 'WhatsApp not connected'}</b><small>{channelsConnected ? 'Business account active' : 'Connect from workspace settings'}</small></div><button onClick={() => setActive('Settings')} aria-label="WhatsApp settings"><ChevronRight size={15}/></button></div><button className="profile" onClick={() => setProfileOpen(open => !open)}><div className="avatar avatar-me">OC</div><span><b>{workspace?.name ?? 'Workspace user'}</b><small>{workspace?.role ?? 'Member'}</small></span><MoreHorizontal size={18}/></button>{profileOpen && <div className="profile-menu"><button onClick={() => { setActive('Settings'); setProfileOpen(false); }}><Settings size={15}/>Workspace settings</button><button onClick={() => void signOut()}><LogOut size={15}/>Sign out</button></div>}</div>
    </aside>
    <main className="main"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(open => !open)} aria-label="Toggle navigation"><Menu size={19}/></button><div className="breadcrumbs"><span>{workspace?.name ?? 'OkayChat'}</span><ChevronRight size={14}/><b>{active}</b></div><div className="top-actions"><div className="search-global"><Search size={15}/><input placeholder="Search anything..." value={query} onChange={event => setQuery(event.target.value)}/><kbd>⌘ K</kbd></div><NotificationCenter onOpenInbox={() => setActive('Inbox')}/><button className="help-button" onClick={() => toast('Help centre is coming soon')} aria-label="Help"><CircleHelp size={18}/></button><div className="top-avatar">OC</div></div></header>
      <div className="page-content"><WorkspacePage active={active} workspaceRole={workspace?.role ?? 'AGENT'} onNavigate={setActive} onToast={toast} onAddContact={addContact} connected={channelsConnected} onChannelsChanged={loadWorkspaces}/></div>
    </main>
    {notice && <div className="toast"><Check size={16}/>{notice}</div>}
  </div>;
}

function WorkspacePage({ active, workspaceRole, onNavigate, onToast, onAddContact, connected, onChannelsChanged }: { active: Nav; workspaceRole: string; onNavigate: (nav: Nav) => void; onToast: (message: string) => void; onAddContact: () => void; connected: boolean; onChannelsChanged: () => void }) {
  if (active === 'Inbox') return <InboxView onToast={onToast}/>;
  if (active === 'Campaigns') return <PageFrame group="ENGAGE" title="Campaigns" subtitle="Plan thoughtful WhatsApp messages for your customers."><CampaignsView onToast={onToast}/></PageFrame>;
  if (active === 'Automations') return <PageFrame group="ENGAGE" title="Automations" subtitle="Set a clear next step for every new customer enquiry."><AutomationsView onToast={onToast}/></PageFrame>;
  if (active === 'Analytics') return <PageFrame group="MANAGE" title="Analytics" subtitle="See real conversation, contact, and lead activity in this workspace."><AnalyticsView/></PageFrame>;
  if (active === 'Templates') return <PageFrame group="ENGAGE" title="Templates" subtitle="Review WhatsApp message templates and approval status."><TemplatesView onToast={onToast}/></PageFrame>;
  if (active === 'Settings') return <PageFrame group="MANAGE" title="Settings" subtitle="Connect WhatsApp and manage your workspace integrations."><SettingsView onToast={onToast} onChanged={() => { window.dispatchEvent(new Event('okaychat:contacts-changed')); onChannelsChanged(); }}/></PageFrame>;
  if (active === 'Team') return <PageFrame group="MANAGE" title="Team" subtitle="Invite the people who keep customer conversations moving."><TeamView role={workspaceRole} onToast={onToast}/></PageFrame>;
  if (active === 'Leads') return <PageFrame group="WORKSPACE" title="Leads" subtitle="Move every opportunity forward with a clear sales pipeline."><LeadsView role={workspaceRole} onToast={onToast}/></PageFrame>;
  if (active === 'Contacts') return <CrmPage active="Contacts" role={workspaceRole} onToast={onToast} onAddContact={onAddContact}/>;
  if (active === 'Home') return <HomePage connected={connected} onNavigate={onNavigate}/>;
  return <PageFrame group="MANAGE" title={active} subtitle={pageSubtitle(active)}><div className="module-card"><div className="module-empty"><div className="empty-icon"><Settings size={22}/></div><h2>{active} setup is in progress</h2><p>This area will be connected to your workspace data as the OkayChat V1 foundation is completed.</p><div className="feature-row"><span><Check size={13}/>Workspace-scoped</span><span><Check size={13}/>Built for your team</span></div></div></div></PageFrame>;
}

function PageFrame({ group, title, subtitle, children }: { group: string; title: string; subtitle: string; children: ReactNode }) {
  return <div className="dashboard"><div className="page-heading"><div><div className="eyebrow">{group}</div><h1>{title}</h1><p>{subtitle}</p></div></div>{children}</div>;
}

function HomePage({ connected, onNavigate }: { connected: boolean; onNavigate: (nav: Nav) => void }) {
  const [recent, setRecent] = useState<RecentConversation[]>([]);
  const loadRecent = useCallback(() => { fetch(`${API}/conversations?status=OPEN`, { credentials: 'include' }).then(response => response.ok ? response.json() : []).then(rows => setRecent(rows.slice(0, 5))).catch(() => {}); }, []);
  useEffect(() => { loadRecent(); window.addEventListener('okaychat:contacts-changed', loadRecent); return () => window.removeEventListener('okaychat:contacts-changed', loadRecent); }, [loadRecent]);
  return <div className="dashboard"><div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Welcome to OkayChat</h1><p>Here’s the latest activity from your workspace.</p></div></div>
    <div className="connection-banner"><div className="connection-icon"><MessageCircle size={21}/></div><div><b>{connected ? 'Your WhatsApp is connected' : 'Connect your WhatsApp business account'}</b><p>{connected ? 'Your team can now manage customer conversations here.' : 'Start receiving messages and manage every conversation from one shared inbox.'}</p></div><button onClick={() => onNavigate('Settings')}>{connected ? 'Manage connection' : 'Connect WhatsApp'} <ArrowUpRight size={15}/></button></div>
    <AnalyticsStats/>
    <div className="card recent-card"><div className="card-heading"><div><h2>Recent conversations</h2><p>Pick up where your team left off</p></div><button className="text-link" onClick={() => onNavigate('Inbox')}>View inbox <ArrowUpRight size={14}/></button></div>{recent.length ? <div className="recent-list">{recent.map(conversation => <button key={conversation.id} onClick={() => onNavigate('Inbox')} className="recent-row"><div className="avatar blue">{conversation.contact.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div><div className="recent-copy"><b>{conversation.contact.name}</b><span>{conversation.messages[0]?.body || 'No message preview'}</span></div><span className="recent-time">{conversation.messages[0] ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(conversation.messages[0].createdAt)) : ''}</span></button>)}</div> : <div className="home-empty">{connected ? 'New conversations will appear here.' : 'Connect WhatsApp to start receiving customer conversations.'}</div>}</div>
  </div>;
}

function CrmPage({ active, role, onToast, onAddContact }: { active: 'Contacts' | 'Leads'; role: string; onToast: (message: string) => void; onAddContact: () => void }) {
  const [rows, setRows] = useState<CrmRow[]>([]); const [search, setSearch] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [refresh, setRefresh] = useState(0);
  useEffect(() => { const changed = () => setRefresh(value => value + 1); window.addEventListener('okaychat:contacts-changed', changed); return () => window.removeEventListener('okaychat:contacts-changed', changed); }, []);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(''); const params = new URLSearchParams({ limit: '100' }); if (search.trim()) params.set('q', search.trim()); fetch(`${API}/${active.toLowerCase()}?${params}`, { credentials: 'include', signal: controller.signal }).then(async response => { if (!response.ok) throw new Error('Could not load workspace records'); return response.json(); }).then(data => { const mapped = (data.items ?? []).map((item: any) => { const contact = active === 'Leads' ? item.contact : item; return { id: item.id, name: contact.name, company: active === 'Leads' ? item.title : (item.company || '—'), phone: contact.phone, tags: item.tags ?? [], whatsappConsent: contact.whatsappConsent ?? 'UNKNOWN', stage: active === 'Leads' ? item.stage : undefined, createdAt: active === 'Leads' ? item.updatedAt : item.createdAt }; }); setRows(mapped); }).catch(cause => { if (cause.name !== 'AbortError') setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [active, search, refresh]);
  const advance = async (row: CrmRow) => { const stages = ['NEW', 'CONTACTED', 'QUALIFIED', 'SITE_VISIT', 'PROPOSAL', 'WON', 'LOST']; const next = stages[(stages.indexOf(row.stage ?? 'NEW') + 1) % stages.length]; const response = await fetch(`${API}/leads/${row.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: next }) }); if (!response.ok) { onToast('Could not update lead stage'); return; } setRows(current => current.map(item => item.id === row.id ? { ...item, stage: next } : item)); };
  const updateConsent = async (row: CrmRow, next: 'UNKNOWN'|'OPTED_IN'|'OPTED_OUT') => { const source = window.prompt(next === 'UNKNOWN' ? 'Why is the consent status being reset?' : 'Where was this consent status recorded?'); if (!source?.trim()) return; const response = await fetch(`${API}/contacts/${row.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whatsappConsent: next, whatsappConsentSource: source.trim() }) }); const result = await response.json().catch(() => ({})); if (!response.ok) { onToast(Array.isArray(result.message) ? result.message.join(', ') : result.message ?? 'Could not update consent status'); return; } setRows(current => current.map(item => item.id === row.id ? { ...item, whatsappConsent: next } : item)); onToast('WhatsApp consent status updated'); };
  const canManageConsent = ['OWNER', 'ADMIN', 'MANAGER'].includes(role);
  return <PageFrame group="WORKSPACE" title={active} subtitle={active === 'Contacts' ? 'A shared home for every customer relationship.' : 'Turn new enquiries into your next customers.'}><div className="module-card"><div className="module-toolbar"><div className="inbox-search"><Search size={15}/><input placeholder={`Search ${active.toLowerCase()}…`} value={search} onChange={event => setSearch(event.target.value)}/></div>{active === 'Contacts' && <><ContactImportButton onComplete={() => window.dispatchEvent(new Event('okaychat:contacts-changed'))} onToast={onToast}/><button className="primary-button" onClick={onAddContact}><Plus size={15}/>Add contact</button></>}</div>{error ? <div className="module-empty"><p>{error}</p></div> : loading ? <div className="module-empty"><p>Loading {active.toLowerCase()}…</p></div> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>{active === 'Leads' ? 'Opportunity' : 'Company'}</th><th>Phone</th><th>{active === 'Leads' ? 'Stage' : 'WhatsApp consent'}</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><b>{row.name}</b></td><td>{row.company}</td><td>{row.phone}</td><td>{active === 'Leads' ? <button className="select-button" onClick={() => void advance(row)}>{(row.stage ?? 'NEW').replaceAll('_', ' ')} <ChevronDown size={13}/></button> : canManageConsent ? <select className="select-button consent-select" value={row.whatsappConsent ?? 'UNKNOWN'} onChange={event => void updateConsent(row, event.target.value as 'UNKNOWN'|'OPTED_IN'|'OPTED_OUT')} aria-label={`WhatsApp consent for ${row.name}`}><option value="UNKNOWN">Unknown</option><option value="OPTED_IN">Opted in</option><option value="OPTED_OUT">Opted out</option></select> : <span className={`consent-pill consent-${(row.whatsappConsent ?? 'UNKNOWN').toLowerCase().replace('_', '-')}`}>{row.whatsappConsent === 'OPTED_IN' ? 'Opted in' : row.whatsappConsent === 'OPTED_OUT' ? 'Opted out' : 'Unknown'}</span>}</td></tr>)}</tbody></table></div> : <div className="module-empty"><div className="empty-icon"><Users size={22}/></div><h2>No {active.toLowerCase()} yet</h2><p>{active === 'Contacts' ? 'Add your first contact to start building customer relationships.' : 'Create leads from your new enquiries as they arrive.'}</p>{active === 'Contacts' && <button className="primary-button" onClick={onAddContact}><Plus size={15}/>Add contact</button>}</div>}</div></PageFrame>;
}

function pageSubtitle(nav: Nav) { const values: Partial<Record<Nav, string>> = { Templates: 'Approved messages, ready when you need them.', Team: 'Great conversations are a team effort.', Billing: 'A clear view of your OkayChat subscription.', Settings: 'Make OkayChat work the way your business does.' }; return values[nav] ?? ''; }
