'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, MessageCircle, Users, UserRoundCheck } from 'lucide-react';
import './analytics.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Overview = { metrics: { conversations: number; openConversations: number; totalContacts: number; newContacts: number; openLeads: number }; activity: { date: string; inbound: number; outbound: number }[]; leadSources: { source: string; count: number }[] };

async function loadOverview(): Promise<Overview> {
  const response = await fetch(`${API}/analytics/overview`, { credentials: 'include' });
  if (!response.ok) throw new Error('Could not load workspace analytics');
  return response.json();
}

export function AnalyticsStats() {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => { let live = true; const refresh = () => { loadOverview().then(value => { if (live) setData(value); }).catch(() => {}); }; refresh(); window.addEventListener('okaychat:contacts-changed', refresh); return () => { live = false; window.removeEventListener('okaychat:contacts-changed', refresh); }; }, []);
  return <div className="stats-grid"><SmallStat label="Conversations" value={data?.metrics.conversations} icon={MessageCircle} tone="violet"/><SmallStat label="New contacts · 7 days" value={data?.metrics.newContacts} icon={Users} tone="blue"/><SmallStat label="Open leads" value={data?.metrics.openLeads} icon={Activity} tone="orange"/><SmallStat label="Open conversations" value={data?.metrics.openConversations} icon={UserRoundCheck} tone="green"/></div>;
}

function SmallStat({label,value,icon:Icon,tone}:{label:string;value?:number;icon:typeof Activity;tone:string}) { return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={18}/></div><span className="stat-label">{label}</span><b className="stat-value">{value === undefined ? '—' : value.toLocaleString('en-IN')}</b><small><span>Live workspace data</span></small></div>; }

export function AnalyticsView() {
  const [data, setData] = useState<Overview | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const refresh = useCallback(async () => { setLoading(true); try { setData(await loadOverview()); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load analytics'); } finally { setLoading(false); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const peak = Math.max(1, ...(data?.activity ?? []).flatMap(day => [day.inbound, day.outbound]));
  const sourceTotal = data?.metrics.totalContacts ?? 0;
  return <section className="analytics-view">
    {error && <p className="analytics-error" role="alert">{error}</p>}
    {loading && !data ? <div className="analytics-loading">Loading analytics…</div> : data && <>
      <div className="analytics-stats"><SmallStat label="All conversations" value={data.metrics.conversations} icon={MessageCircle} tone="violet"/><SmallStat label="Open conversations" value={data.metrics.openConversations} icon={Activity} tone="green"/><SmallStat label="New contacts · 7 days" value={data.metrics.newContacts} icon={Users} tone="blue"/><SmallStat label="Open leads" value={data.metrics.openLeads} icon={UserRoundCheck} tone="orange"/></div>
      <div className="analytics-grid"><section className="analytics-card"><div className="analytics-heading"><div><h2>Message activity</h2><p>Inbound and outbound messages · last 7 days</p></div></div><div className="activity-bars" role="img" aria-label="Daily inbound and outbound messages over the last seven days">{data.activity.map(day => <div className="activity-day" key={day.date}><div className="activity-columns"><i title={`${day.inbound} inbound`} style={{ height: `${Math.max(3, day.inbound / peak * 100)}%` }}/><i title={`${day.outbound} outbound`} style={{ height: `${Math.max(3, day.outbound / peak * 100)}%` }}/></div><small>{new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))}</small></div>)}</div><div className="analytics-legend"><span><i className="incoming-dot"/>Inbound</span><span><i className="outgoing-dot"/>Outbound</span></div></section>
        <section className="analytics-card"><div className="analytics-heading"><div><h2>Contact sources</h2><p>{sourceTotal.toLocaleString('en-IN')} contacts total</p></div></div>{data.leadSources.length ? <div className="source-bars">{data.leadSources.map(item => <div className="source-bar-row" key={item.source}><div><span>{item.source}</span><b>{item.count.toLocaleString('en-IN')}</b></div><i><span style={{ width: `${sourceTotal ? item.count / sourceTotal * 100 : 0}%` }}/></i></div>)}</div> : <div className="analytics-empty">Contact sources will appear as you add contacts.</div>}</section></div>
    </>}
  </section>;
}
