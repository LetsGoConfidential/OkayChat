'use client';

import { useRef, useState } from 'react';
import { FileUp, Upload, X } from 'lucide-react';
import './contact-import.css';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type ImportRow = { name: string; phone: string; email?: string; company?: string; source?: string; tags: string[] };
type ImportResult = { submitted: number; imported: number; skipped: number; issues: { row: number; reason: string }[] };

function parseCsv(text: string): ImportRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      if (char === '\r' && text[index + 1] === '\n') index += 1;
    } else cell += char;
  }
  if (quoted) throw new Error('This CSV has an unclosed quotation mark. Check the file and try again.');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('Add a header row and at least one contact.');
  const headers = rows[0].map(header => header.replace(/^\uFEFF/, '').trim().toLowerCase());
  const column = (aliases: string[]) => headers.findIndex(header => aliases.includes(header));
  const nameIndex = column(['name', 'full name', 'contact name']);
  const phoneIndex = column(['phone', 'phone number', 'mobile', 'mobile number']);
  if (nameIndex < 0 || phoneIndex < 0) throw new Error('Your CSV needs “name” and “phone” columns.');
  const emailIndex = column(['email', 'email address']);
  const companyIndex = column(['company', 'organization']);
  const sourceIndex = column(['source', 'lead source']);
  const tagsIndex = column(['tags', 'labels']);
  const at = (values: string[], index: number) => index < 0 ? '' : (values[index] ?? '').trim();
  return rows.slice(1).map(values => ({
    name: at(values, nameIndex),
    phone: at(values, phoneIndex),
    ...(emailIndex >= 0 && at(values, emailIndex) ? { email: at(values, emailIndex) } : {}),
    ...(companyIndex >= 0 && at(values, companyIndex) ? { company: at(values, companyIndex) } : {}),
    ...(sourceIndex >= 0 && at(values, sourceIndex) ? { source: at(values, sourceIndex) } : {}),
    tags: tagsIndex >= 0 ? at(values, tagsIndex).split('|').map(tag => tag.trim()).filter(Boolean).slice(0, 20) : [],
  }));
}

export function ContactImportButton({ onComplete, onToast }: { onComplete: () => void; onToast: (message: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const chooseFile = async (file?: File) => {
    setRows([]); setResult(null); setError(''); setFileName('');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('CSV files must be smaller than 5 MB.'); return; }
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length > 500) throw new Error('Import up to 500 contacts at a time. Split larger files into smaller CSVs.');
      setRows(parsed); setFileName(file.name);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read this CSV.'); }
  };

  const importRows = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/contacts/import`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Could not import contacts');
      setResult(data); onComplete(); onToast(`${data.imported} contact${data.imported === 1 ? '' : 's'} imported`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import contacts'); }
    finally { setBusy(false); }
  };

  return <>
    <button className="secondary-button contact-import-trigger" type="button" onClick={() => { setOpen(true); setError(''); setRows([]); setResult(null); setFileName(''); }}><FileUp size={15}/>Import CSV</button>
    {open && <div className="contact-import-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section className="contact-import-modal" role="dialog" aria-modal="true" aria-labelledby="contact-import-title">
        <header><div><div className="import-title-icon"><Upload size={17}/></div><h2 id="contact-import-title">Import contacts</h2><p>Add a CSV to this workspace. New records start with WhatsApp consent marked Unknown.</p></div><button type="button" className="import-close" aria-label="Close import" onClick={() => !busy && setOpen(false)}><X size={17}/></button></header>
        <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void chooseFile(file); }}/>
        <button className="import-file-picker" type="button" onClick={() => inputRef.current?.click()}><Upload size={17}/><b>{fileName || 'Choose a CSV file'}</b><small>Required columns: name, phone · Optional: email, company, source, tags</small><small>Phone numbers must use international format, e.g. +919876543210. Separate tags with |.</small></button>
        {rows.length > 0 && !result && <div className="import-preview"><div><b>{rows.length} rows ready</b><span>Preview</span></div><div className="import-preview-table"><div><b>Name</b><b>Phone</b><b>Company</b></div>{rows.slice(0, 4).map((row, index) => <div key={`${row.phone}-${index}`}><span>{row.name || '—'}</span><span>{row.phone || '—'}</span><span>{row.company || '—'}</span></div>)}</div>{rows.length > 4 && <small>And {rows.length - 4} more rows</small>}</div>}
        {result && <div className="import-result"><b>{result.imported} imported · {result.skipped} skipped</b><span>Consent status was left Unknown for every new contact.</span>{result.issues.length > 0 && <ul>{result.issues.slice(0, 8).map((issue, index) => <li key={`${issue.row}-${index}`}>{issue.row ? `Row ${issue.row}: ` : ''}{issue.reason}</li>)}</ul>}{result.issues.length > 8 && <small>{result.issues.length - 8} more issues not shown.</small>}</div>}
        {error && <p className="import-error" role="alert">{error}</p>}
        <footer><button className="campaign-cancel-button" type="button" onClick={() => setOpen(false)} disabled={busy}>{result ? 'Done' : 'Cancel'}</button>{!result && <button className="primary-button" type="button" onClick={() => void importRows()} disabled={busy || rows.length === 0}>{busy ? 'Importing…' : `Import ${rows.length || ''} contacts`}</button>}</footer>
      </section>
    </div>}
  </>;
}
