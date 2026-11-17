import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import Icon from './Icon';

// One search box in the top bar: receipts, cheque numbers, CSHRC/BAKRC numbers, bank lines, customers, handovers, slips.
export default function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const nav = useNavigate();
  const loc = useLocation();
  const box = useRef(null);

  useEffect(() => { setOpen(false); }, [loc.pathname, loc.search]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(null); return undefined; }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      rpc('cc_search', { p_q: term }).then((r) => { if (live) { setRes(r ?? []); setAt(0); setOpen(true); } })
        .catch((e) => { if (live) setRes([{ type: 'Error', title: e.message, sub: '', href: null }]); })
        .finally(() => { if (live) setBusy(false); });
    }, 280);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const go = (r) => { if (!r?.href) return; setOpen(false); setQ(''); nav(r.href); };
  const onKey = (e) => {
    if (!res?.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setAt((i) => Math.min(i + 1, res.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(res[at]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="gsearch" ref={box}>
      <label className="gsearch-box">
        <Icon name="search" size={18} />
        <span className="sr-only">Search everything</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => res && setOpen(true)} onKeyDown={onKey}
          placeholder="Search receipts, customers, invoices, amounts, numbers"
          role="combobox" aria-expanded={open && Boolean(res)} aria-controls="gsearch-list" aria-autocomplete="list" />
        {busy && <span className="gsearch-busy" aria-hidden="true" />}
      </label>
      {open && res && (
        <ul className="gsearch-list" id="gsearch-list" role="listbox">
          {res.length === 0 && <li className="gsearch-none">Nothing found for “{q.trim()}”.</li>}
          {res.map((r, i) => (
            <li key={`${r.type}-${r.title}-${i}`} role="option" aria-selected={i === at}>
              <button type="button" className={i === at ? 'on' : ''} onMouseEnter={() => setAt(i)} onClick={() => go(r)} disabled={!r.href}>
                <span className="gsearch-type">{r.type}</span>
                <span className="gsearch-title">{r.title}</span>
                {r.sub && <span className="gsearch-sub">{r.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
