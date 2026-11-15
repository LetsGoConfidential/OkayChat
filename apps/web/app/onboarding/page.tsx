'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Check, MessageCircle, ShieldCheck } from 'lucide-react';

export default function OnboardingPage() {
  const router = useRouter();
  return <main className="onboarding-page"><div className="onboarding-top"><div className="auth-brand"><span><MessageCircle size={18} fill="currentColor"/></span>okay<span>chat</span></div><button onClick={()=>router.replace('/')}>Skip for now</button></div><div className="onboarding-content"><div className="steps"><i className="step-done"><Check size={13}/></i><span/><i>2</i><span/><i>3</i></div><div className="onboarding-icon"><MessageCircle size={25}/></div><div className="auth-kicker">YOUR WORKSPACE IS READY</div><h1>Let’s connect your WhatsApp.</h1><p>Bring your business number into OkayChat to receive messages, reply with your team, and manage leads from one shared inbox.</p><div className="onboarding-benefits"><div><span><Check size={14}/></span><p><b>Keep your number</b><small>Connect your official WhatsApp Business account.</small></p></div><div><span><Check size={14}/></span><p><b>Work together</b><small>Give your team one place to manage conversations.</small></p></div><div><span><ShieldCheck size={14}/></span><p><b>Your account stays yours</b><small>Secure Meta authorization and workspace access.</small></p></div></div><button className="auth-submit" onClick={()=>router.replace('/')}>Continue to workspace <ArrowRight size={16}/></button><small className="onboarding-note">WhatsApp provider authorization is the next integration step. You can connect it from your workspace later.</small></div></main>
}
