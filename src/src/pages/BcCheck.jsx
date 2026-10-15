import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, rpc } from '../lib/supabase';
import { lkr, fmtDate, fmtDateTime } from '../lib/format';
import { parseBankLedger, parseDetailedCustLedger, fetchAll } from '../lib/bcimport';
import { useAuth } from '../lib/auth';

const STATUS = {
  posted: { label: 'Posted', cls: 'ok' },
  posted_diff: { label: 'Posted with differences', cls: 'bad' },
  exported: { label: 'Not posted', cls: 'warn' },
};
const CHUNK = 2000;

// Finance: treat a document as posted even though the check doesn't confirm it, with the reason.
function PostAnyway({ d, onDone }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return <button className="btn small" onClick={() => setOpen(true)}>Post anyway</button>;
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await rpc('cc_bc_accept', { p_doc_id: d.id, p_note: note }); await onDone(); }
    catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form className="post-anyway" onSubmit={go}>
      <label className="field"><span className="flabel">Why can {d.doc_no} be treated as posted?</span>
        <textarea required rows="2" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="E.g. posted in BC with the customers swapped; corrected by journal GJ-0123" /></label>
      <p className="hint">It then counts as posted everywhere, stays posted when the ledgers are uploaded again, and can be undone.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn small primary" disabled={busy || !note.trim()}>Post anyway</button>
        <button type="button" className="link" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

function Upload({ title, hint, parse, fn, onDone }) {
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [error, setError] = useState('');
  const go = async (file) => {
    if (!file) return;
    setError(''); setMsg('');
    try {
      setBusy('Reading the file…');
      const rows = await parse(file);
      let added = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        setBusy(`Uploading ${Math.min(i + CHUNK, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}…`);
        const r = await rpc(fn, { p_file: file.name, p_rows: rows.slice(i, i + CHUNK) });
        added += Number(r.new ?? 0);
      }
      setMsg(`${rows.length.toLocaleString()} entries read, ${added.toLocaleString()} new. Documents re-checked.`);
      onDone();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  return (
    <div className="facts">
      <h2>{title}</h2>
      <p className="hint">{hint}</p>
      <label className="btn">{busy || 'Choose the BC export (.xlsx)'}<input type="file" accept=".xlsx,.xls,.csv" hidden disabled={Boolean(busy)} onChange={(e) => { go(e.target.files[0]); e.target.value = ''; }} /></label>
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default function BcCheck() {
  const { role } = useAuth();
  const [docs, setDocs] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [people, setPeople] = useState({});
  const [tab, setTab] = useState('attention');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await fetchAll(() => db.from('bc_docs').select('id, doc_no, posting_date, total, post_status, bank_check, customer_check, checked_at, export_count, last_exported_at, accepted_at, accepted_by, accept_note, account:bank_accounts(name), lines:bc_doc_lines(account_name, applies_doc_no)').order('doc_no', { ascending: false }));
      const u = await db.from('bc_uploads').select('kind, file_name, rows_in, rows_new, done_at').order('done_at', { ascending: false }).limit(6);
      const p = await db.from('profiles').select('id, full_name, email');
      setDocs(d); setUploads(u.data ?? []);
      setPeople(Object.fromEntries((p.data ?? []).map((x) => [x.id, x.full_name || x.email])));
    } catch (e) { setError(e.message); setDocs([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (docs === null) return <p className="muted">Loading…</p>;

  const custPending = (d) => !d.accepted_at && d.post_status === 'posted' && d.customer_check?.status === 'missing';
  const needs = (d) => !d.accepted_at && (d.post_status !== 'posted' || custPending(d));
  const counts = { posted: docs.filter((d) => !needs(d)).length, attention: docs.filter(needs).length, all: docs.length };
  const shown = docs.filter((d) => (tab === 'all' || (tab === 'attention' ? needs(d) : !needs(d))))
    .filter((d) => !q || `${d.doc_no} ${d.account?.name} ${(d.lines ?? []).map((l) => `${l.account_name} ${l.applies_doc_no}`).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const last = (k) => uploads.find((u) => u.kind === k);

  return (
    <section className="wide">
      <div className="page-head"><h1>BC check</h1></div>
      <p className="lede">After posting in Business Central, upload these two exports. Each exported document is checked: the bank side (right account, date and total) and the customer side (right customer, invoices applied exactly as Sales instructed).</p>
      {error && <p className="error">{error}</p>}
      {role === 'finance' && (
        <div className="ov-flags">
          <Upload title="1. Bank Account Ledger Entries" fn="cc_import_bank_ledger" parse={parseBankLedger} onDone={load}
            hint={`BC → Bank Account Ledger Entries → Open in Excel, for all four bank accounts. Uploading the same entries again is safe.${last('bank_ledger') ? ` Last upload ${fmtDateTime(last('bank_ledger').done_at)}.` : ''}`} />
          <Upload title="2. Detailed Customer Ledger Entries" fn="cc_import_cust_ledger" parse={parseDetailedCustLedger} onDone={load}
            hint={`BC → Detailed Cust. Ledg. Entries → Open in Excel. Include the invoices' dates too (e.g. from 1 January), so applications can be traced.${last('cust_ledger') ? ` Last upload ${fmtDateTime(last('cust_ledger').done_at)}.` : ''}`} />
        </div>
      )}

      <div className="list-head">
        <div className="tabs" role="tablist">
          {[['attention', 'Needs attention'], ['posted', 'Posted'], ['all', 'All']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'tab on' : 'tab'} onClick={() => setTab(k)}>{l} <span className="count">{counts[k]}</span></button>
          ))}
        </div>
        <input className="search" type="search" placeholder="Search document, customer or invoice" value={q} onChange={(e) => setQ(e.target.value)} />
        {role === 'finance' && <button className="btn" onClick={async () => { await rpc('cc_bc_recheck'); load(); }}>Check again</button>}
      </div>

      {shown.length === 0 ? <p className="muted">{tab === 'attention' ? 'Nothing needs attention.' : 'None.'}</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Document</th><th>Bank date</th><th>Account</th><th>Customer and invoices</th><th className="num">LKR</th><th>Status</th><th>What BC shows</th></tr></thead>
            <tbody>{shown.map((d) => {
              const st = STATUS[d.post_status];
              const problems = [...(d.bank_check?.problems ?? []), ...(d.customer_check?.problems ?? [])];
              return (
                <tr key={d.id}>
                  <td><strong>{d.doc_no}</strong><div className="muted small">exported {d.export_count}×</div></td>
                  <td>{fmtDate(d.posting_date)}</td>
                  <td>{d.account?.name ?? 'Cash in hand'}</td>
                  <td>{[...new Set((d.lines ?? []).map((l) => l.account_name))].join(', ')}<div className="muted small">{(d.lines ?? []).map((l) => l.applies_doc_no).filter(Boolean).join(', ')}</div></td>
                  <td className="num">{lkr(d.total)}</td>
                  <td><span className={`pill ${d.accepted_at ? 'ok' : custPending(d) ? 'warn' : st.cls}`}>{d.accepted_at ? 'Posted (accepted)' : custPending(d) ? 'Posted (bank)' : st.label}</span></td>
                  <td className="small">
                    {d.accepted_at ? (
                      <>
                        <div>Accepted as posted by {people[d.accepted_by] ?? 'finance'} on {fmtDateTime(d.accepted_at)}: <em>{d.accept_note}</em></div>
                        {problems.length > 0 && <ul className="plain muted">{problems.map((p) => <li key={p}>BC check: {p}</li>)}</ul>}
                        {role === 'finance' && <button className="link" onClick={async () => { await rpc('cc_bc_unaccept', { p_doc_id: d.id }); load(); }}>Undo</button>}
                      </>
                    ) : (
                      <>
                        {d.post_status === 'exported' && d.bank_check?.status !== 'n/a' && <>Not in BC's bank ledger. If it wasn't posted, <Link to="/bc-export">export it again</Link> (same number).</>}
                        {d.post_status === 'exported' && d.bank_check?.status === 'n/a' && <>Cash receipt: not in the uploaded customer ledger yet. Upload a newer one, or if it wasn't posted, <Link to="/bc-export">export it again</Link>.</>}
                        {custPending(d) && 'Bank side correct. The customer ledger uploaded doesn\'t include it yet: upload a newer Detailed Customer Ledger.'}
                        {d.post_status === 'posted' && !custPending(d) && <span className="muted">Bank and customer sides match{d.customer_check?.status === 'not_checked' ? ' (customer side not checked)' : ''}.</span>}
                        {problems.length > 0 && <ul className="plain">{problems.map((p) => <li key={p} className="error">{p}</li>)}</ul>}
                        {d.post_status === 'posted_diff' && <div className="muted">Correct it in BC, then upload the ledgers again.</div>}
                        {role === 'finance' && needs(d) && <PostAnyway d={d} onDone={load} />}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
