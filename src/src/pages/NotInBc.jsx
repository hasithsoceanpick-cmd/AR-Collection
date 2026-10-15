import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { lkr, ref, fmtDate, daysAgo } from '../lib/format';
import { KIND_LABEL, STATUS } from '../lib/workflow';

const STAGES = [
  { key: 'rejected', kpi: 'rejected back to Sales', title: 'Rejected back to Sales', hint: 'Finance sent these back for new invoices or settlement instructions. Open each one, correct it and send it back.', tone: 'red' },
  { key: 'posted_diff', kpi: 'posted in BC with differences', title: 'Posted in BC with differences', hint: 'BC check found the posting differs from what was sent (amount, date or invoices). Finance must correct it in BC.', tone: 'red' },
  { key: 'with_finance', kpi: 'with finance', title: 'With finance', hint: "Sent, but finance hasn't finished with it yet (collecting, depositing, reviewing).", tone: 'amber' },
  { key: 'to_export', kpi: 'accepted, waiting for export to BC', title: 'Accepted, waiting for export to BC', hint: 'Finance has closed it; it goes into the next BC journal export. A card payment waits until every sale in its batch is set off.', tone: 'blue' },
  { key: 'exported', kpi: 'exported, not yet confirmed in BC', title: 'Exported, not yet confirmed in BC', hint: "In a BC journal, but BC check hasn't seen it posted yet.", tone: 'teal' },
];

const link = (r) => (r.kind === 'cash' && r.handover_id ? `/cash/${r.handover_id}` : `/c/${r.id}`);

// Everything sent to finance that BC hasn't confirmed. Until BC check confirms
// it posted, treat it as not recorded in Business Central.
export default function NotInBc() {
  const { role } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { rpc('cc_not_in_bc').then((d) => setRows(d ?? [])).catch((e) => { setError(e.message); setRows([]); }); }, []);

  const term = q.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? []).filter((r) => !term
    || [r.customer_name, r.customer_no, r.invoice_refs, ref(r.id), ...(r.doc_nos ?? []), r.recorded_by].some((v) => v?.toLowerCase().includes(term))), [rows, term]);

  if (rows === null) return <p className="muted">Loading…</p>;
  const total = (list) => list.reduce((a, r) => a + Number(r.amount ?? 0), 0);

  return (
    <section className="wide">
      <div className="page-head"><h1>Not in BC yet</h1></div>
      <p className="lede">{role === 'sales' ? 'Everything you sent to finance' : 'Everything sent to finance'} that Business Central hasn't confirmed yet.
        An item leaves this list only when finance uploads the BC ledgers and the BC check finds it posted as sent. Until then, for all purposes, it is not recorded in BC.</p>
      {error && <p className="error">{error}</p>}
      <div className="kpis">
        {STAGES.map((s) => { const l = rows.filter((r) => r.stage === s.key); return (
          <div key={s.key}><span>{l.length}</span>{s.kpi}<small>LKR {lkr(total(l))}</small></div>
        ); })}
      </div>
      <input className="search" type="search" placeholder="Search customer, invoice, CC or BAKRC number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      {rows.length === 0 && <div className="empty"><p>Nothing outstanding: everything sent to finance is confirmed in BC.</p></div>}
      {STAGES.map((s) => {
        const list = shown.filter((r) => r.stage === s.key);
        if (!list.length) return null;
        return (
          <div className="facts" key={s.key}>
            <h2>{s.title} ({list.length}, LKR {lkr(total(list))})</h2>
            <p className="hint">{s.hint}</p>
            <div className="table-wrap flat">
              <table className="table">
                <thead><tr><th>Item</th><th>Customer</th><th>Invoices</th><th className="num">LKR</th><th>Recorded</th>{role !== 'sales' && <th>By</th>}<th>Where it is</th></tr></thead>
                <tbody>{list.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={link(r)}>{ref(r.id)}</Link><div className="muted small">{KIND_LABEL[r.kind] ?? r.kind}</div></td>
                    <td>{r.customer_name}<div className="muted small">{r.customer_no}</div></td>
                    <td>{r.invoice_refs || <span className="muted">—</span>}</td>
                    <td className="num">{lkr(r.amount)}</td>
                    <td>{fmtDate(r.created_at)}<div className="muted small">{daysAgo(r.created_at)} days ago</div></td>
                    {role !== 'sales' && <td>{r.recorded_by}</td>}
                    <td>
                      {(r.doc_nos ?? []).length > 0 ? <strong>{r.doc_nos.join(', ')}</strong> : r.cshrc_no ? <strong>{r.cshrc_no}</strong> : null}
                      {s.key === 'with_finance' && <span className={`stamp tone-${STATUS[r.status]?.tone ?? 'grey'}`}>{STATUS[r.status]?.label ?? r.status}</span>}
                      {(r.problems ?? []).map((p) => <div key={p} className="error small">{p}</div>)}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
