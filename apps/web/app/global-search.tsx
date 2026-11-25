'use client';

import { KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { Activity, Inbox, Search, UserRound } from 'lucide-react';
import './global-search.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
export type GlobalSearchResult = { kind: 'contact' | 'lead' | 'conversation'; id: string; title: string; subtitle: string; detail?: string; status?: string };
type SearchResponse = {
  contacts: { id: string; name: string; phone: string; company: string | null }[];
  leads: { id: string; title: string; stage: string; contact: { name: string; phone: string } }[];
  conversations: { id: string; status: string; contact: { name: string; phone: string }; messages: { body: string | null }[] }[];
};

export function GlobalSearch({ onSelect }: { onSelect: (result: GlobalSearchResult, query: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<SearchResponse>({ contacts: [], leads: [], conversations: [] });

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('okaychat-global-search')?.focus();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) { setData({ contacts: [], leads: [], conversations: [] }); setError(''); setLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const response = await fetch(`${API}/search?q=${encodeURIComponent(normalized)}`, { credentials: 'include', signal: controller.signal });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message ?? 'Search is unavailable');
        setData(result);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Search is unavailable');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const results = useMemo<GlobalSearchResult[]>(() => [
    ...data.contacts.map(item => ({ kind: 'contact' as const, id: item.id, title: item.name, subtitle: item.phone, detail: item.company ?? undefined })),
    ...data.leads.map(item => ({ kind: 'lead' as const, id: item.id, title: item.title, subtitle: `${item.contact.name} · ${item.stage.replaceAll('_', ' ').toLowerCase()}`, detail: item.contact.phone })),
    ...data.conversations.map(item => ({ kind: 'conversation' as const, id: item.id, title: item.contact.name, subtitle: `${item.contact.phone} · ${item.status.toLowerCase()}`, detail: item.messages[0]?.body ?? undefined, status: item.status })),
  ], [data]);

  const choose = (result: GlobalSearchResult) => {
    const selectedQuery = query.trim();
    setOpen(false); setQuery('');
    onSelect(result, selectedQuery);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { setOpen(false); event.currentTarget.blur(); }
  };

  return <div className="global-search">
    <Search size={15}/><input id="okaychat-global-search" placeholder="Search anything…" value={query} onChange={event => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={handleKeyDown} autoComplete="off" aria-label="Search contacts, leads, and conversations" aria-expanded={open} aria-controls="global-search-results" aria-autocomplete="list"/><kbd>⌘ K</kbd>
    {open && <div className="global-search-results" id="global-search-results" role="listbox" aria-label="Search results">
      {query.trim().length < 2 ? <div className="global-search-hint">Type at least 2 characters to search your workspace.</div> : loading ? <div className="global-search-hint">Searching contacts, leads, and conversations…</div> : error ? <div className="global-search-error" role="alert">{error}</div> : results.length ? <>
        {data.contacts.length > 0 && <SearchGroup title="Contacts" results={results.filter(item => item.kind === 'contact')} onChoose={choose}/>}
        {data.leads.length > 0 && <SearchGroup title="Leads" results={results.filter(item => item.kind === 'lead')} onChoose={choose}/>}
        {data.conversations.length > 0 && <SearchGroup title="Conversations" results={results.filter(item => item.kind === 'conversation')} onChoose={choose}/>}
      </> : <div className="global-search-hint">No matching contacts, leads, or conversations.</div>}
    </div>}
  </div>;
}

function SearchGroup({ title, results, onChoose }: { title: string; results: GlobalSearchResult[]; onChoose: (result: GlobalSearchResult) => void }) {
  return <div className="global-search-group"><div className="global-search-label">{title}</div>{results.map(result => {
    const Icon = result.kind === 'contact' ? UserRound : result.kind === 'lead' ? Activity : Inbox;
    return <button type="button" role="option" aria-selected="false" className="global-search-option" key={`${result.kind}-${result.id}`} onClick={() => onChoose(result)}><span className="global-search-option-icon"><Icon size={14}/></span><span className="global-search-option-copy"><b>{result.title}</b><small>{result.subtitle}</small>{result.detail && result.kind === 'conversation' && <small className="global-search-preview">{result.detail}</small>}</span></button>;
  })}</div>;
}
