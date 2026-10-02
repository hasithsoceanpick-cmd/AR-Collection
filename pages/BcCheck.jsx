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
  const [tab, setTab] = useState('attention');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await fetchAll(() => db.from('bc_docs').select('id, doc_no, posting_date, total, post_status, bank_check, customer_check, checked_at, export_count, last_exported_at, account:bank_accounts(name), lines:bc_doc_lines(account_name, applies_doc_no)').order('doc_no', { ascending: false }));
      const u = await db.from('bc_uploads').select('kind, file_name, rows_in, rows_new, done_at').order('done_at', { ascending: false }).limit(6);
      setDocs(d); setUploads(u.data ?? []);
    } catch (e) { setError(e.message); setDocs([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (docs === null) return <p className="muted">Loading…</p>;

  const custPending = (d) => d.post_status === 'posted' && d.customer_check?.status === 'missing';
  const needs = (d) => d.post_status !== 'posted' || custPending(d);
  const counts = { posted: docs.filter((d) => d.post_status === 'posted' && !custPending(d)).length, attention: docs.filter(needs).length, all: docs.length };
  const shown = docs.filter((d) => (tab === 'all' || (tab === 'attention' ? needs(d) : d.post_status === 'posted' && !custPending(d))))
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
          {[['attention', 'Needs attention'], ['posted', 'Posted correctly'], ['all', 'All']].map(([k, l]) => (
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
                  <td>{d.account?.name}</td>
                  <td>{[...new Set((d.lines ?? []).map((l) => l.account_name))].join(', ')}<div className="muted small">{(d.lines ?? []).map((l) => l.applies_doc_no).filter(Boolean).join(', ')}</div></td>
                  <td className="num">{lkr(d.total)}</td>
                  <td><span className={`pill ${custPending(d) ? 'warn' : st.cls}`}>{custPending(d) ? 'Posted (bank)' : st.label}</span></td>
                  <td className="small">
                    {d.post_status === 'exported' && <>Not in BC's bank ledger. If it wasn't posted, <Link to="/bc-export">export it again</Link> (same number).</>}
                    {custPending(d) && 'Bank side correct. The customer ledger uploaded doesn\'t include it yet: upload a newer Detailed Customer Ledger.'}
                    {d.post_status === 'posted' && !custPending(d) && <span className="muted">Bank and customer sides match{d.customer_check?.status === 'not_checked' ? ' (customer side not checked)' : ''}.</span>}
                    {problems.length > 0 && <ul className="plain">{problems.map((p) => <li key={p} className="error">{p}</li>)}</ul>}
                    {d.post_status === 'posted_diff' && <div className="muted">Correct it in BC, then upload the ledgers again.</div>}
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
