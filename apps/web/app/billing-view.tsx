'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BadgeCheck, CalendarDays, CreditCard, Users, UserRound, Send, RotateCw } from 'lucide-react';
import './billing.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Plan = { id: string; name: string; monthlyPriceInr: number | null; priceLabel: string; features: string[] };
type BillingData = {
  subscription: { plan: string; status: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };
  usage: { teamMembers: number; contacts: number; campaigns: number };
  plans: Plan[];
  paymentsEnabled: boolean;
};

export function BillingView() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API}/billing/current`, { credentials: 'include' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? 'Could not load billing information');
      setData(result);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load billing information'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="billing-loading" aria-live="polite">Loading your billing overview…</div>;
  if (error) return <section className="billing-error" role="alert"><AlertCircle size={18}/><span>{error}</span><button type="button" onClick={() => void load()}><RotateCw size={14}/>Retry</button></section>;
  if (!data) return null;

  const currentPlan = data.plans.find(plan => plan.id === data.subscription.plan);
  return <section className="billing-page">
    <div className="billing-current-card">
      <div className="billing-current-icon"><CreditCard size={20}/></div>
      <div className="billing-current-copy"><span>YOUR CURRENT PLAN</span><h2>{currentPlan?.name ?? data.subscription.plan}</h2><p>{data.subscription.status === 'ACTIVE' ? 'Active' : data.subscription.status.replaceAll('_', ' ').toLowerCase()}{data.subscription.currentPeriodEnd ? ` · Renews ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(data.subscription.currentPeriodEnd))}` : ' · No renewal date set'}</p></div>
      <div className="billing-current-price"><b>{currentPlan?.priceLabel ?? 'Custom'}</b><span>{currentPlan?.monthlyPriceInr === 0 ? 'forever' : 'per month'}</span></div>
    </div>

    <div className="billing-usage-heading"><div><h2>Workspace usage</h2><p>Your current workspace counts.</p></div></div>
    <div className="billing-usage-grid">
      <UsageCard icon={Users} label="Team members" value={data.usage.teamMembers}/>
      <UsageCard icon={UserRound} label="Contacts" value={data.usage.contacts}/>
      <UsageCard icon={Send} label="Campaigns" value={data.usage.campaigns}/>
    </div>

    <div className="billing-usage-heading billing-plans-heading"><div><h2>Plans</h2><p>Proposed monthly pricing in INR. Checkout is not connected yet.</p></div></div>
    <div className="billing-plan-grid">
      {data.plans.map(plan => <article className={`billing-plan-card ${plan.id === data.subscription.plan ? 'is-current' : ''}`} key={plan.id}>
        <div className="billing-plan-title"><div><h3>{plan.name}</h3><p>{plan.monthlyPriceInr === null ? 'Talk to us' : plan.monthlyPriceInr === 0 ? 'For getting started' : 'For growing teams'}</p></div>{plan.id === data.subscription.plan && <span className="billing-current-pill"><BadgeCheck size={12}/>Current</span>}</div>
        <div className="billing-plan-price"><b>{plan.priceLabel}</b><span>{plan.monthlyPriceInr === 0 ? 'forever' : plan.monthlyPriceInr === null ? '' : '/ month'}</span></div>
        <ul>{plan.features.map(feature => <li key={feature}><BadgeCheck size={13}/>{feature}</li>)}</ul>
        <button type="button" className="billing-plan-action" disabled={!data.paymentsEnabled || plan.id === data.subscription.plan}>{plan.id === data.subscription.plan ? 'Current plan' : data.paymentsEnabled ? 'Choose plan' : 'Payments not connected'}</button>
      </article>)}
    </div>

    <div className="billing-note"><CalendarDays size={16}/><span><b>Billing history and payment methods</b><small>These will appear here after a payment provider and subscription webhooks are configured. No payment can be taken from this page yet.</small></span></div>
  </section>;
}

function UsageCard({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return <article className="billing-usage-card"><span><Icon size={16}/></span><div><small>{label}</small><b>{value.toLocaleString('en-IN')}</b></div></article>;
}
