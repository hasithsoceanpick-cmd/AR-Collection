import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, rpc } from '../lib/supabase';
import { fetchAll } from '../lib/bcimport';
import { lkr, fmtDate } from '../lib/format';
import { useAuth } from '../lib/auth';

// The numbers a receive or an export is about to use: which are taken. Numbers come from the series (BC's next numbers);
// a clash means the app and BC are out of line, which Match BC numbers fixes.
export function NumberCheck({ code, first, count, onState, hint = null }) {
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
  useEffect(() => { onState?.({ app: app.length, bc: bc.length }); }, [app.length, bc.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!app.length && !bc.length) return null;
  return (
    <div className="number-check">
      {app.map((r) => <p key={r.no} className="error small">{r.no} is already held in the app by {r.app}.</p>)}
      {bc.map((r) => <p key={r.no} className="error small">{r.no} is already in Business Central: {r.bc}.</p>)}
      {hint ? <p className="hint small">{hint}</p> : <p className="hint small">The app and Business Central are out of line. <a href="/bc-close#match-bc" onClick={() => setTick((n) => n + 1)}>Match BC numbers</a> lines them up
        (a Finance Admin enters BC&apos;s next numbers).</p>}
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

// Finance: where the app's numbers stand against Business Central, and (Finance Admin) lining them up:
// enter BC's next BAKRC and CSHRC numbers, preview what changes, apply.
const SECTIONS = [
  { key: 'relabel', title: "Counted as posted, but BC can't have them under these numbers: BC's own number, or a CLOSED- label", cols: ['Now', 'Becomes', 'What', 'LKR'] },
  { key: 'duplicates', title: 'Copies removed: BC already has these under the earlier number', cols: ['Copy', 'Restored', 'What', 'LKR'] },
  { key: 'freed', title: 'Numbers freed: sent back, reopened or cancelled, and BC never had them', cols: ['Number', '', 'What', 'LKR'] },
  { key: 'renumber', title: "Renumbered to BC's next numbers (not posted in BC yet)", cols: ['Now', 'Becomes', 'What', 'LKR'] },
];
export function MatchBc({ open: startOpen = false, onDone }) {
  const { role, isAdmin } = useAuth();
  const admin = role === 'finance' && isAdmin;
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(startOpen);
  const [bakrc, setBakrc] = useState('');
  const [cshrc, setCshrc] = useState('');
  const [plan, setPlan] = useState(null);
  const [also, setAlso] = useState(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const box = useRef(null);
  const load = useCallback(async () => {
    try {
      const s = await rpc('cc_doc_numbers_status');
      setStatus(s);
      setBakrc((v) => v || String(s?.BAKRC?.start_no || s?.BAKRC?.next_no || ''));
      setCshrc((v) => v || String(s?.CSHRC?.start_no || s?.CSHRC?.next_no || ''));
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (startOpen) { setOpen(true); box.current?.scrollIntoView({ block: 'start' }); } }, [startOpen]);
  useEffect(() => {   // "Match BC numbers" links elsewhere on the page open this
    const go = () => { if (window.location.hash === '#match-bc') { setOpen(true); box.current?.scrollIntoView({ block: 'start' }); } };
    window.addEventListener('hashchange', go); go();
    return () => window.removeEventListener('hashchange', go);
  }, []);
  useEffect(() => { setPlan(null); }, [bakrc, cshrc]);

  const args = (apply) => {
    const ad = [], ac = [];
    for (const k of also) { const [kind, id] = k.split(':'); (kind === 'cash' ? ac : ad).push(Number(id)); }
    return { p_bakrc: Number(bakrc), p_cshrc: Number(cshrc), p_apply: apply, p_note: apply ? note : null, p_also_docs: ad, p_also_cash: ac };
  };
  async function preview() {
    setBusy(true); setError(''); setMsg('');
    try { setPlan(await rpc('cc_doc_numbers_sync', args(false))); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  useEffect(() => { if (plan) preview(); }, [also]); // eslint-disable-line react-hooks/exhaustive-deps
  async function apply() {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await rpc('cc_doc_numbers_sync', args(true));
      const n = (r.renumber?.length ?? 0) + (r.duplicates?.length ?? 0) + (r.freed?.length ?? 0) + (r.relabel?.length ?? 0);
      setMsg(`Done: ${n} change${n === 1 ? '' : 's'}. Next numbers: ${r.app_next.BAKRC} and ${r.app_next.CSHRC}.${r.unique_note ? ` ${r.unique_note}` : ''}`);
      setPlan(null); setAlso(new Set()); setNote('');
      await load(); await onDone?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const out = (s) => Boolean(s && (s.behind || (s.gaps ?? []).length > 0));
  const toCheck = (s) => Boolean(s && (s.below ?? []).length > 0);
  const anyOut = status && (out(status.BAKRC) || out(status.CSHRC));
  const anyCheck = status && (toCheck(status.BAKRC) || toCheck(status.CSHRC));
  const changes = plan ? (plan.renumber?.length ?? 0) + (plan.duplicates?.length ?? 0) + (plan.freed?.length ?? 0) + (plan.relabel?.length ?? 0) : 0;
  const tick = (k) => setAlso((a) => { const n = new Set(a); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <details className="facts match-bc" id="match-bc" open={open} ref={box} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Numbers and Business Central{anyOut ? <span className="pill bad">out of line</span> : anyCheck ? <span className="pill warn">in line · some to check</span>
        : status ? <span className="pill ok">in line</span> : null}</summary>
      <p className="hint">BAKRC and CSHRC numbers follow Business Central&apos;s No. Series. Export to BC takes the BAKRC number you type next to its Export button
        and lines the app&apos;s numbers up with it, and Cash takes the CSHRC number you type when receiving. Use this only to line both series up without exporting.</p>
      {status && (
        <div className="table-wrap flat"><table className="table small">
          <thead><tr><th>Series</th><th>App&apos;s next</th><th>BC&apos;s next (confirmed)</th><th>Highest in BC ledgers</th><th>Out of line</th></tr></thead>
          <tbody>{['BAKRC', 'CSHRC'].map((c) => { const s = status[c] ?? {}; return (
            <tr key={c}>
              <td><strong>{c}</strong></td>
              <td>{s.next ?? 'not set'}</td>
              <td>{s.bc_next ?? '—'}{s.bc_synced_at && <div className="muted small">{fmtDate(s.bc_synced_at)}{s.bc_synced_by ? `, ${s.bc_synced_by}` : ''}</div>}</td>
              <td>{s.bc_max ?? '—'}</td>
              <td className="small">{!out(s) && !toCheck(s) ? <span className="ok-text">No</span> : <>
                {s.behind && <div className="error">BC&apos;s ledgers already have {s.bc_max}: the app&apos;s next number is behind BC.</div>}
                {(s.gaps ?? []).length > 0 && <div className="error">No receipt holds {s.gaps.slice(0, 5).join(', ')}{s.gaps.length > 5 ? ` and ${s.gaps.length - 5} more` : ''}: BC&apos;s journal would have a gap.</div>}
                {(s.below ?? []).length > 0 && <div className="warn-text">Not in BC, but BC is past {s.below.length === 1 ? 'its number' : 'their numbers'}: {s.below.slice(0, 5).map((b) => b.doc_no).join(', ')}{s.below.length > 5 ? ` and ${s.below.length - 5} more` : ''}.</div>}
              </>}</td>
            </tr>); })}</tbody>
        </table></div>
      )}
      {admin ? (
        <div className="match-form">
          <h3>Match BC numbers</h3>
          <p className="hint small">Upload the latest bank and customer ledgers on <Link to="/bc-check">BC check</Link> first{plan?.uploads ? ` (last: bank ${plan.uploads.bank ? fmtDate(plan.uploads.bank) : 'never'}, customer ${plan.uploads.customer ? fmtDate(plan.uploads.customer) : 'never'})` : ''}.
            Then type the next numbers from the No. Series in Business Central.</p>
          <div className="row">
            <label className="inline-field">BC&apos;s next BAKRC <input inputMode="numeric" value={bakrc} onChange={(e) => setBakrc(e.target.value.replace(/\D/g, ''))} aria-label="Business Central's next BAKRC number" /></label>
            <label className="inline-field">BC&apos;s next CSHRC <input inputMode="numeric" value={cshrc} onChange={(e) => setCshrc(e.target.value.replace(/\D/g, ''))} aria-label="Business Central's next CSHRC number" /></label>
            <button className="btn" disabled={busy || !bakrc || !cshrc} onClick={preview}>{busy && !plan ? 'Checking…' : 'Preview'}</button>
          </div>
          {plan && (
            <div className="match-plan">
              {plan.errors.length > 0 && <div className="notice danger-notice"><strong>This can&apos;t be applied:</strong><ul className="plain">{plan.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
              {SECTIONS.map((sec) => (plan[sec.key] ?? []).length > 0 && (
                <div key={sec.key}>
                  <h4>{sec.title} ({plan[sec.key].length})</h4>
                  <div className="table-wrap flat"><table className="table small">
                    <thead><tr>{sec.cols.map((c) => <th key={c} className={c === 'LKR' ? 'num' : ''}>{c}</th>)}</tr></thead>
                    <tbody>{plan[sec.key].map((x) => (
                      <tr key={`${sec.key}-${x.id ?? x.collection_id ?? ''}-${x.doc_no ?? x.old}`}>
                        <td><strong>{x.doc_no ?? x.old}</strong></td>
                        <td>{sec.key === 'renumber' || sec.key === 'relabel' ? <strong>{x.new}</strong> : x.restore_no ?? ''}</td>
                        <td>{x.item}<div className="muted small">{x.why}</div></td>
                        <td className="num">{x.total != null ? lkr(x.total) : ''}</td>
                      </tr>))}</tbody>
                  </table></div>
                </div>
              ))}
              {(plan.check ?? []).length > 0 && (
                <div>
                  <h4>To check: not in BC, but BC&apos;s numbers are past them ({plan.check.length})</h4>
                  <p className="hint small">Left as they are unless you tick them. Tick one only after checking Business Central doesn&apos;t have it: it then gets one of BC&apos;s next numbers too.</p>
                  <ul className="checklist">{plan.check.map((x) => { const k = `${x.kind}:${x.id}`; return (
                    <li key={k} className={also.has(k) ? 'on' : ''}><label>
                      <input type="checkbox" checked={also.has(k)} onChange={() => tick(k)} />
                      <span className="lp-main"><span className="lp-narr"><strong>{x.doc_no}</strong> · {x.item}</span><span className="lp-meta"><span>{x.why}</span></span></span>
                      <span className="num lp-amt">{lkr(x.total)}</span>
                    </label></li>); })}</ul>
                </div>
              )}
              <p className="match-sum">After this: next numbers <strong>{plan.app_next.BAKRC}</strong> and <strong>{plan.app_next.CSHRC}</strong>
                {changes === 0 && ' · nothing to change'}.</p>
              {(plan.renumber ?? []).some((x) => x.series === 'BAKRC') && <p className="warn-text small">Renumbered documents that were already exported must be exported again:
                delete their old lines from the BC Cash Receipt Journal and import the new file.</p>}
              {plan.errors.length === 0 && (<>
                <label className="field"><span className="flabel">Where BC&apos;s next numbers come from</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="E.g. checked the No. Series in BC on 9 Nov" /></label>
                <button className="btn primary" disabled={busy || !note.trim()} onClick={apply}>{busy ? 'Applying…' : changes ? `Apply ${changes} change${changes === 1 ? '' : 's'}` : 'Set the next numbers'}</button>
              </>)}
            </div>
          )}
        </div>
      ) : <p className="muted small">A Finance Admin can match the numbers to Business Central.</p>}
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </details>
  );
}
export const NumberSeries = MatchBc;

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
