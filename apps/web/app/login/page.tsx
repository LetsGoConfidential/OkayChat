'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, MessageCircle, ShieldCheck, Sparkles } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login'|'register'>('register');
  const [name, setName] = useState(''); const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [inviteMode, setInviteMode] = useState(false);
  useEffect(() => setInviteMode(new URLSearchParams(window.location.search).has('inviteToken')), []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const inviteToken = new URLSearchParams(window.location.search).get('inviteToken');
      const body = mode === 'register' ? { name, email, password, ...(inviteToken ? { inviteToken } : { workspaceName }) } : { email, password };
      const response = await fetch(`${API}/auth/${mode}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Unable to sign in. Please try again.');
      router.replace(inviteToken ? (mode === 'register' ? '/' : `/invite/accept?token=${encodeURIComponent(inviteToken)}`) : mode === 'register' ? '/onboarding' : '/');
    } catch (e) {
      const unavailable = e instanceof TypeError && /fetch/i.test(e.message);
      setError(unavailable
        ? 'OkayChat could not reach its API. Start PostgreSQL and Redis, then start the API at localhost:4000 and try again.'
        : e instanceof Error ? e.message : 'Could not reach OkayChat. Check that the API is running.');
    }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-story"><div className="auth-brand"><span><MessageCircle size={18} fill="currentColor"/></span>okay<span>chat</span></div><div className="auth-story-copy"><div className="auth-kicker"><Sparkles size={14}/> BUSINESS CONVERSATIONS, MADE SIMPLE</div><h1>Every customer conversation, in one place.</h1><p>Turn WhatsApp enquiries into meaningful customer relationships and sales.</p><div className="auth-proof"><div className="proof-avatars"><i>AM</i><i>PS</i><i>RK</i><i>JD</i></div><span>Made for teams that care about every reply.</span></div></div><div className="auth-story-foot"><ShieldCheck size={14}/> Your workspace is private and secure</div><div className="auth-orb orb-one"/><div className="auth-orb orb-two"/></section><section className="auth-form-side"><div className="auth-form-wrap"><div className="mobile-auth-brand"><MessageCircle size={17}/> okaychat</div><div className="auth-heading"><h2>{mode==='register'?(inviteMode?'Join your team':'Create your workspace'):'Welcome back'}</h2><p>{mode==='register'?(inviteMode?'Create your account to accept the workspace invitation.':'Start managing customer conversations with your team.'):'Sign in to continue to your workspace.'}</p></div><div className="auth-switch"><button className={mode==='register'?'chosen':''} onClick={()=>{setMode('register');setError('')}}>Create account</button><button className={mode==='login'?'chosen':''} onClick={()=>{setMode('login');setError('')}}>Sign in</button></div><form onSubmit={submit} className="auth-form">{mode==='register'&&<><label>Your name<input autoComplete="name" required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Jay Patel"/></label>{!inviteMode&&<label>Business name<input autoComplete="organization" required minLength={2} value={workspaceName} onChange={e=>setWorkspaceName(e.target.value)} placeholder="e.g. Mehta Properties"/></label>}</>}<label>Work email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></label><label>Password<input type="password" autoComplete={mode==='register'?'new-password':'current-password'} required minLength={mode==='register'?10:1} value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==='register'?'At least 10 characters':'Your password'}/>{mode==='register'&&<small>Use at least 10 characters.</small>}</label>{error&&<div className="auth-error">{error}</div>}<button className="auth-submit" disabled={busy}>{busy?'Please wait…':mode==='register'?(inviteMode?'Join workspace':'Create workspace'):'Sign in'} {!busy&&<ArrowRight size={16}/>}</button></form>{mode==='register'&&<div className="auth-terms">By creating an account, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.</div>}<div className="auth-checks"><span><Check size={13}/> No credit card required</span><span><Check size={13}/> Set up in minutes</span></div></div></section></main>
}
