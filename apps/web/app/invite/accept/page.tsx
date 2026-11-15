'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, MessageCircle, ShieldCheck } from 'lucide-react';
import '../../auth.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type InvitePreview = { workspaceName: string; email: string; role: string };

export default function AcceptInvitePage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const inviteToken = new URLSearchParams(window.location.search).get('token') || '';
    setToken(inviteToken);
    if (!inviteToken) { setError('This invitation link is missing its token.'); setLoading(false); return; }
    const load = async () => {
      try {
        const me = await fetch(`${API}/auth/me`, { credentials: 'include' });
        if (me.status === 401) { router.replace(`/login?inviteToken=${encodeURIComponent(inviteToken)}`); return; }
        if (!me.ok) throw new Error('Could not verify your OkayChat account.');
        const response = await fetch(`${API}/workspaces/invites/preview?token=${encodeURIComponent(inviteToken)}`, { credentials: 'include' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'This invitation is no longer available.');
        setInvite(result);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this invitation.'); }
      finally { setLoading(false); }
    };
    void load();
  }, [router]);

  const accept = async () => {
    if (!token || joining) return;
    setJoining(true); setError('');
    try {
      const response = await fetch(`${API}/workspaces/invites/accept`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not accept this invitation.');
      router.replace('/');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not accept this invitation.'); }
    finally { setJoining(false); }
  };

  return <main className="invite-accept-page"><div className="invite-accept-card"><div className="invite-brand"><MessageCircle size={18} fill="currentColor"/> okaychat</div><div className="invite-mark"><ShieldCheck size={24}/></div><div className="auth-kicker">WORKSPACE INVITATION</div><h1>{loading ? 'Checking your invitation…' : error && !invite ? 'Invitation unavailable' : `Join ${invite?.workspaceName ?? 'your workspace'}`}</h1>{invite ? <><p>You’re invited to join <b>{invite.workspaceName}</b> as a <b>{invite.role.toLowerCase()}</b>, using {invite.email}.</p>{error && <div className="auth-error">{error}</div>}<button className="auth-submit" disabled={joining} onClick={() => void accept()}>{joining ? 'Joining…' : 'Accept invitation'} <ArrowRight size={15}/></button></> : <><p>{loading ? 'Verifying the invitation and your signed-in email.' : error}</p>{error && <div className="auth-error">{error}</div>}</>}<div className="invite-private"><Check size={14}/> Invitation links expire after 7 days</div></div></main>;
}
