import { useEffect, useState } from 'react';
import { db, rpc } from '../lib/supabase';

// While finance types a first CSHRC / BAKRC number: which of the numbers it would use are taken.
//  In the app by another receipt → can't be used. Only in Business Central → can be used once ticked.
export function NumberCheck({ code, first, count, bcOk, setBcOk, onState }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!first || !(count > 0)) { setRows([]); return; }
      rpc('cc_doc_numbers_check', { p_code: code, p_first: Number(first), p_count: count }).then((d) => setRows(d ?? [])).catch(() => setRows([]));
    }, 300);
    return () => clearTimeout(t);
  }, [code, first, count]);
  const app = rows.filter((r) => r.app);
  const bc = rows.filter((r) => r.bc && !r.app);
  useEffect(() => {
    onState?.({ app: app.length, bc: bc.length });
    if (!bc.length && bcOk) setBcOk(false);
  }, [app.length, bc.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!app.length && !bc.length) return null;
  return (
    <div className="number-check">
      {app.map((r) => <p key={r.no} className="error small">{r.no} is already used in the app by {r.app}. Choose another first number, or change that one's number.</p>)}
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
export function Renumber({ kind = null, id = null, docNo = null, onDone }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return <div><button type="button" className="link small" onClick={() => { setVal(''); setError(''); setOpen(true); }}>Change number</button></div>;
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
