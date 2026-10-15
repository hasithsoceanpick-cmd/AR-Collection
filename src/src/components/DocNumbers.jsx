import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, rpc } from '../lib/supabase';
import { fetchAll } from '../lib/bcimport';
import { lkr, fmtDate } from '../lib/format';

// While finance types a first CSHRC / BAKRC number: which of the numbers it would use are taken.
//  In the app by another receipt → can't be used. Only in Business Central → can be used once ticked.
export function NumberCheck({ code, first, count, bcOk, setBcOk, onState }) {
  const [rows, setRows] = useState([]);
  const [tick, setTick] = useState(0);   // checks again after a number is changed from here
  useEffect(() => {
    const t = setTimeout(() => {
      if (!first || !(count > 0)) { setRows([]); return; }
      rpc('cc_doc_numbers_check', { p_code: code, p_first: Number(first), p_count: count }).then((d) => setRows(d ?? [])).catch(() => setRows([]));
    }, 300);
    return () => clearTimeout(t);
  }, [code, first, count, tick]);
  const app = rows.filter((r) => r.app);
  const bc = rows.filter((r) => r.bc && !r.app);
  useEffect(() => {
    onState?.({ app: app.length, bc: bc.length });
    if (!bc.length && bcOk) setBcOk(false);
  }, [app.length, bc.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!app.length && !bc.length) return null;
  const many = code === 'CSHRC' ? '/cash?numbers=1' : '/bc-check?numbers=1';
  return (
    <div className="number-check">
      {app.map((r) => (
        <div key={r.no} className="nc-app">
          <p className="error small">{r.no} is already used in the app by {r.app}. Choose another first number, or change that one's number to the one BC has for it.</p>
          {r.app_id && <Renumber kind={r.app_kind} id={r.app_id} label={`Change the number of ${r.app.split(' ')[0]}`} onDone={() => setTick((n) => n + 1)} />}
        </div>
      ))}
      {app.length > 0 && <p className="hint small">Receipts posted in BC shifted by one number? <Link to={many}>Change several numbers at once</Link>.</p>}
      {bc.map((r) => <p key={r.no} className="bc-note small">{r.no} is already in Business Central: {r.bc}.</p>)}
      {bc.length > 0 && app.length === 0 && (
        <label className="check"><input type="checkbox" checked={bcOk} onChange={(e) => setBcOk(e.target.checked)} />
          Already posted in BC under {bc.length === 1 ? 'this number' : 'these numbers'}: use {bc.length === 1 ? 'it' : 'them'}</label>
      )}
    </div>
  );
}

// Finance: change a receipt's CSHRC / BAKRC number to the one it was posted under in BC.
//  kind 'cash' + id = a cash receipt; or docNo = a BC document's current number.
export function Renumber({ kind = null, id = null, docNo = null, onDone, label = 'Change number' }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return <div><button type="button" className="link small" onClick={() => { setVal(''); setError(''); setOpen(true); }}>{label}</button></div>;
  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      let k = kind, i = id;
      if (!i && docNo) {
        const { data } = await db.from('bc_docs').select('id').eq('doc_no', docNo).maybeSingle();
        if (!data) throw new Error(`${docNo} is not exported yet`);
        k = 'doc'; i = data.id;
      }
      await rpc('cc_doc_renumber', { p_kind: k, p_id: i, p_new: val });
      setOpen(false);
      await onDone?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <form className="renumber" onSubmit={save}>
      <input value={val} onChange={(e) => setVal(e.target.value)} aria-label="New number" placeholder="Number in BC, e.g. 570" autoFocus />
      <button className="btn small primary" disabled={busy || !val.trim()}>Save</button>
      <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>Cancel</button>
      <span className="hint small">The number it was posted under in Business Central.</span>
      {error && <p className="error small">{error}</p>}
    </form>
  );
}

// Finance: the next BAKRC and CSHRC numbers.
export function NumberSeries() {
  const [series, setSeries] = useState([]);
  const [edit, setEdit] = useState({});
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const load = () => db.from('doc_series').select('code, prefix, width, next_no').in('code', ['BAKRC', 'CSHRC']).order('code')
    .then(({ data }) => { setSeries(data ?? []); setEdit(Object.fromEntries((data ?? []).map((s) => [s.code, s.next_no ? String(s.next_no) : '']))); });
  useEffect(() => { load(); }, []);
  async function save(code) {
    setError(''); setMsg('');
    try { await rpc('cc_doc_series_set', { p_code: code, p_next: Number(edit[code]) }); setMsg(`Next ${code} number saved.`); await load(); }
    catch (e) { setError(e.message); }
  }
  return (
    <details className="facts number-series">
      <summary>Number series: next BAKRC and CSHRC numbers</summary>
      <p className="hint">The app starts the next export (BAKRC) or cash receipt (CSHRC) from these. Set them to the next free numbers in Business Central.</p>
      {series.map((s) => (
        <div className="row" key={s.code}>
          <label className="inline-field">{s.code === 'BAKRC' ? 'Bank receipts' : 'Cash receipts'}: next {s.code}
            <input inputMode="numeric" value={edit[s.code] ?? ''} onChange={(e) => setEdit({ ...edit, [s.code]: e.target.value.replace(/\D/g, '') })} aria-label={`Next ${s.code} number`} /></label>
          <span className="muted small">{edit[s.code] ? `${s.prefix}${edit[s.code].padStart(s.width, '0')}` : 'not set'}</span>
          <button className="btn small" disabled={!edit[s.code] || String(s.next_no ?? '') === edit[s.code]} onClick={() => save(s.code)}>Save</button>
        </div>
      ))}
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </details>
  );
}

// Finance: change several CSHRC (cash receipts) or BAKRC (bank receipts) numbers in one save,
// e.g. when BC posted a run of receipts shifted by one number.
const BC_STATUS = { exported: 'Not posted in BC', posted: 'Posted', posted_diff: 'Posted with differences' };
export function NumberEditor({ series, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState({});
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const width = 7;
  const box = useRef(null);
  const norm = (v) => { const d = String(v ?? '').replace(/\D/g, '').replace(/^0+/, ''); return d ? `${series}-${d.padStart(width, '0')}` : ''; };

  const load = useCallback(async () => {
    setError('');
    try {
      if (series === 'CSHRC') {
        const [c, d] = await Promise.all([
          fetchAll(() => db.from('collections').select('id, cshrc_no, customer_name, customer_no, invoice_refs, collected_amount, received_at, status')
            .eq('kind', 'cash').not('cshrc_no', 'is', null).neq('status', 'cancelled').order('id')),
          fetchAll(() => db.from('bc_docs').select('doc_no, cash_collection_id, post_status, accepted_at').not('cash_collection_id', 'is', null).order('id')),
        ]);
        const docOf = new Map(d.map((x) => [x.cash_collection_id, x]));
        setRows(c.map((x) => ({ key: `cash-${x.id}`, kind: 'cash', id: x.id, no: x.cshrc_no, who: x.customer_name, inv: x.invoice_refs,
          amount: x.collected_amount, date: x.received_at, doc: docOf.get(x.id) })).sort((a, b) => b.no.localeCompare(a.no)));
      } else {
        const d = await fetchAll(() => db.from('bc_docs').select('id, doc_no, posting_date, total, post_status, accepted_at, lines:bc_doc_lines(account_name, applies_doc_no)')
          .like('doc_no', 'BAKRC-%').order('id'));
        setRows(d.map((x) => ({ key: `doc-${x.id}`, kind: 'doc', id: x.id, no: x.doc_no, who: [...new Set((x.lines ?? []).map((l) => l.account_name))].join(', '),
          inv: (x.lines ?? []).map((l) => l.applies_doc_no).filter(Boolean).join(', '), amount: x.total, date: x.posting_date, doc: x })).sort((a, b) => b.no.localeCompare(a.no)));
      }
    } catch (e) { setError(e.message); setRows([]); }
  }, [series]);
  useEffect(() => { if (open && rows === null) load(); }, [open, load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (defaultOpen && rows) box.current?.scrollIntoView({ block: 'start' }); }, [defaultOpen, rows === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = useMemo(() => (rows ?? []).filter((r) => edit[r.key] !== undefined && norm(edit[r.key]) && norm(edit[r.key]) !== r.no), [rows, edit]); // eslint-disable-line react-hooks/exhaustive-deps
  const term = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => !term || `${r.no} ${r.who} ${r.inv}`.toLowerCase().includes(term));
  const list = all || term ? shown : shown.slice(0, 25);

  async function save() {
    setBusy(true); setError(''); setMsg('');
    try {
      const n = await rpc('cc_doc_renumber_many', { p_items: changed.map((r) => ({ kind: r.kind, id: r.id, new: edit[r.key] })) });
      setMsg(`${n} number${n === 1 ? '' : 's'} changed.`); setEdit({});
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <details className="facts number-editor" open={open} ref={box} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{series === 'CSHRC' ? 'Cash receipt (CSHRC) numbers' : 'Bank receipt (BAKRC) numbers'}: change several at once</summary>
      <p className="hint">Type the number each receipt was posted under in Business Central, then save them together. Use this when BC posted a run of receipts
        shifted by one number: one at a time doesn't work there, because each new number is still held by the next receipt.</p>
      <div className="row">
        <input type="search" className="search" placeholder="Search number, customer or invoice" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search receipts" />
        <button className="btn primary" disabled={busy || !changed.length} onClick={save}>{busy ? 'Saving…' : `Save ${changed.length || ''} change${changed.length === 1 ? '' : 's'}`}</button>
        {changed.length > 0 && <button className="btn ghost" onClick={() => setEdit({})}>Undo changes</button>}
      </div>
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {!open ? null : rows === null ? <p className="muted">Loading…</p> : (
        <div className="table-wrap flat">
          <table className="table">
            <thead><tr><th>Number now</th><th>New number</th><th>Customer and invoices</th><th className="num">LKR</th><th>{series === 'CSHRC' ? 'Received' : 'Bank date'}</th><th>In BC</th></tr></thead>
            <tbody>{list.map((r) => {
              const v = edit[r.key];
              const isChanged = v !== undefined && norm(v) && norm(v) !== r.no;
              return (
                <tr key={r.key} className={isChanged ? 'row-picked' : ''}>
                  <td><strong>{r.no}</strong></td>
                  <td><input className="ne-input" inputMode="numeric" value={v ?? ''} placeholder={r.no.replace(/^\D+-0*/, '')} aria-label={`New number for ${r.no}`}
                    onChange={(e) => setEdit({ ...edit, [r.key]: e.target.value })} />
                    {isChanged && <div className="small muted">→ {norm(v)}</div>}</td>
                  <td>{r.who}<div className="muted small">{r.inv}</div></td>
                  <td className="num">{lkr(r.amount)}</td>
                  <td>{fmtDate(r.date)}</td>
                  <td className="small">{r.doc ? (r.doc.accepted_at ? 'Posted (accepted)' : BC_STATUS[r.doc.post_status] ?? r.doc.post_status) : <span className="muted">Not exported yet</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {open && rows && !all && !term && shown.length > 25 && <p><button className="link" onClick={() => setAll(true)}>Show all {shown.length}</button></p>}
    </details>
  );
}
