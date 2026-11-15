'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const publicRoute = path === '/login' || path === '/invite/accept' || path === '/connect';
  const [ready, setReady] = useState(publicRoute);

  useEffect(() => {
    let live = true;
    if (publicRoute) { setReady(true); return () => { live = false; }; }
    setReady(false);
    const verify = async () => {
      try {
        let response = await fetch(`${API}/auth/me`, { credentials: 'include' });
        if (response.status === 401) {
          const refreshed = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' });
          if (refreshed.ok) response = await fetch(`${API}/auth/me`, { credentials: 'include' });
        }
        if (!response.ok) throw new Error('Sign in required');
        if (live) setReady(true);
      } catch { if (live) router.replace('/login'); }
    };
    void verify();
    return () => { live = false; };
  }, [path, publicRoute, router]);

  if (!ready) return <div className="auth-loading"><div className="brand-icon">◌</div><span>Opening your workspace…</span></div>;
  return children;
}
