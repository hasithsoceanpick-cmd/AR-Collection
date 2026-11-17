import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr, todayISO } from '../lib/format';
import { PROMISE, methodLabel, dmy, addDays } from '../lib/followup';

const PERIODS = [
  { key: '30', label: 'Last 30 days', range: (t) => [addDays(t, -30), t] },
  { key: '90', label: 'Last 90 days', range: (t) => [addDays(t, -90), t] },
  { key: 'month', label: 'This month', range: (t) => { const [y, m] = t.split('-').map(Number); return [`${t.slice(0, 7)}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)]; } },
  { key: 'next', label: 'Coming up', range: (t) => [t, addDays(t, 60)] },
];
const STATUS_CHIPS = ['all', 'open', 'due_today', 'grace', 'kept', 'part_kept', 'broken', 'cancelled'];

// Promises to pay with their status, and how often each owner's promises were kept.
export default function FollowUpPromises() {
  const t = todayISO();
  const [period, setPeriod] = useState('90');
  const [st, setSt] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const p = PERIODS.find((x) => x.key === period);
    const [from, to] = p.range(t);
    try { setData(await rpc('cc_ar_promises', { p_from: from, p_to: to })); setError(''); } catch (e) { setError(e.message); }
  }, [period, t]);
  useEffect(() => { setData(null); load(); }, [load]);

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => st === 'all' || r.status === st), [data, st]);
  const count = (k) => (data?.rows ?? []).filter((r) => k === 'all' || r.status === k).length;
  return (
    <section className="wide follow-up">
      <div className="page-head"><div>
        <h1>Promises to pay</h1>
        <p className="lede">A promise is <strong>kept</strong> when the receipts the app records from the customer reach the amount by the promised date plus the grace days,
          or when its invoices close in the ledger. Less than that is <strong>part kept</strong>; nothing is <strong>broken</strong>.</p>
      </div></div>
      <div className="chips" role="group" aria-label="Promised dates">
        {PERIODS.map((p) => <button key={p.key} type="button" className={period === p.key ? 'chip on' : 'chip'} aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="mi-card">
            <div className="mi-head"><div><h2>Hit rate, {dmy(data.from)} to {dmy(data.to)}</h2>
              <span className="muted small">Promises whose date and grace have passed, or that were kept early. Owner when the promise was made.</span></div></div>
            {data.hit.length === 0 ? <p className="muted fu-pad">No promise in this period has come due yet.</p> : (
              <div className="table-wrap flat">
                <table className="table">
                  <thead><tr><th>Owner</th><th className="num">Due</th><th className="num">Kept</th><th className="num">Part kept</th><th className="num">Broken</th>
                    <th className="num">By number</th><th className="num">Promised LKR</th><th className="num">Received LKR</th><th className="num">By value</th></tr></thead>
                  <tbody>{data.hit.map((h) => (
                    <tr key={h.owner_id ?? 'none'}>
                      <td>{h.owner}</td><td className="num">{h.due_n}</td><td className="num">{h.kept_n}</td><td className="num">{h.part_n}</td><td className="num">{h.broken_n}</td>
                      <td className="num"><strong>{h.rate_n}%</strong></td><td className="num">{lkr(h.due_amt)}</td><td className="num">{lkr(h.kept_amt)}</td>
                      <td className="num"><strong>{h.rate_amt ?? 0}%</strong></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          <div className="chips" role="group" aria-label="Status">
            {STATUS_CHIPS.map((k) => <button key={k} type="button" className={st === k ? 'chip on' : 'chip'} aria-pressed={st === k} onClick={() => setSt(k)}>
              {k === 'all' ? 'All' : PROMISE[k].label} <span className="count">{count(k)}</span></button>)}
          </div>
          {rows.length === 0 ? <div className="empty"><p>No promise here.</p></div> : (
            <div className="table-wrap">
              <table className="table fu-table">
                <thead><tr><th>Customer</th><th className="num">Promised</th><th>Pay by</th><th>Status</th><th className="num">Received</th><th>Owner</th><th>Logged</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Customer"><Link to={`/customer/${encodeURIComponent(r.customer_no)}#follow-up`}>{r.name}</Link>
                      <div className="muted small">{r.customer_no}{r.invoices?.length ? ` · ${r.invoices.map((i) => i.doc_no).join(', ')}` : ''}</div></td>
                    <td data-label="Promised" className="num"><strong>{lkr(r.amount)}</strong>{r.method && <div className="muted small">{methodLabel(r.method)}</div>}</td>
                    <td data-label="Pay by">{dmy(r.promised_on)}</td>
                    <td data-label="Status"><span className={`pill ${PROMISE[r.status].tone}`}>{PROMISE[r.status].label}</span>
                      {r.cancel_reason && <div className="muted small">{r.cancel_reason}</div>}</td>
                    <td data-label="Received" className="num">{Number(r.received) > 0 ? lkr(r.received) : <span className="muted">–</span>}</td>
                    <td data-label="Owner">{r.owner ?? <span className="muted">Unassigned</span>}</td>
                    <td data-label="Logged">{dmy(r.at)}<div className="muted small">{r.by}</div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
