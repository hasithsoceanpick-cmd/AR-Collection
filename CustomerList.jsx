import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr, fmtDate, todayISO } from '../lib/format';
import LedgerStatus from '../components/LedgerStatus';

// Every customer from BC with what they owe; each opens their ledger.
export default function CustomerList() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [only, setOnly] = useState('owing');
  const [sort, setSort] = useState({ key: 'name', dir: 1 });

  useEffect(() => {
    rpc('cc_customer_list', { p_as_at: todayISO() }).then(setData).catch((e) => { setError(e.message); setData({ rows: [] }); });
  }, []);

  const groups = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.group).filter(Boolean))].sort(), [data]);
  const term = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) => (!term || [r.name, r.customer_no, r.city, r.phone].some((v) => v?.toLowerCase().includes(term)))
      && (!group || r.group === group)
      && (only === 'all' || (only === 'owing' && Math.abs(Number(r.balance)) >= 0.005) || (only === 'overdue' && Number(r.overdue) >= 0.005)));
    const val = (r) => (sort.key === 'name' ? r.name.toLowerCase() : ['last_invoice', 'last_receipt'].includes(sort.key) ? r[sort.key] ?? '' : Number(r[sort.key] ?? 0));
    return [...list].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir || a.name.localeCompare(b.name));
  }, [data, term, group, only, sort]);
  const by = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'name' ? 1 : -1 }));
  const arrow = (key) => (sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');
  const sum = (k) => shown.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const counts = useMemo(() => ({
    all: data?.rows.length ?? 0,
    owing: (data?.rows ?? []).filter((r) => Math.abs(Number(r.balance)) >= 0.005).length,
    overdue: (data?.rows ?? []).filter((r) => Number(r.overdue) >= 0.005).length,
  }), [data]);

  return (
    <section className="wide">
      <div className="page-head">
        <h1>Customers</h1>
        <Link className="btn" to="/aging">Customer aging</Link>
      </div>
      <p className="lede">Every customer in BC's customer list with what they owe today. Open one for their ledger, open invoices and the receipts recorded in the app.</p>
      {error && <p className="error">{error}</p>}
      <LedgerStatus status={data?.status} />
      {data === null ? <p className="muted">Loading…</p> : (
        <>
          <div className="filters">
            <input className="search" type="search" placeholder="Search name, number, city or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
            {groups.length > 1 && (
              <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Customer group">
                <option value="">All groups</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            <div className="tabs" role="tablist" aria-label="Show">
              {[['owing', 'With a balance'], ['overdue', 'Overdue'], ['all', 'All']].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={only === k} className={`tab${only === k ? ' on' : ''}`} onClick={() => setOnly(k)}>{l} ({counts[k]})</button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? <div className="empty"><p>No customer matches.</p></div> : (
            <div className="table-wrap">
              <table className="table customers-table">
                <thead><tr>
                  <th><button type="button" className="th-sort" onClick={() => by('name')}>Customer{arrow('name')}</button></th>
                  <th>Group</th><th>Terms</th>
                  <th className="num"><button type="button" className="th-sort" onClick={() => by('balance')}>Balance{arrow('balance')}</button></th>
                  <th className="num"><button type="button" className="th-sort" onClick={() => by('overdue')}>Overdue{arrow('overdue')}</button></th>
                  <th><button type="button" className="th-sort" onClick={() => by('last_invoice')}>Last invoice{arrow('last_invoice')}</button></th>
                  <th><button type="button" className="th-sort" onClick={() => by('last_receipt')}>Last receipt{arrow('last_receipt')}</button></th>
                </tr></thead>
                <tbody>{shown.map((r) => (
                  <tr key={r.customer_no} className="click" onClick={() => nav(`/customer/${encodeURIComponent(r.customer_no)}`)}>
                    <td><Link to={`/customer/${encodeURIComponent(r.customer_no)}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                      <div className="muted small">{[r.customer_no, r.city, r.phone].filter(Boolean).join(' · ')}{r.incomplete ? ' · history incomplete' : ''}{!r.in_list ? ' · not in the customer list' : ''}</div></td>
                    <td>{r.group ?? '—'}</td>
                    <td>{r.terms ?? '—'}</td>
                    <td className="num strong">{Math.abs(Number(r.balance)) < 0.005 ? '–' : lkr(r.balance)}</td>
                    <td className={`num${Number(r.overdue) >= 0.005 ? ' late' : ' zero'}`}>{Number(r.overdue) >= 0.005 ? lkr(r.overdue) : '–'}</td>
                    <td>{fmtDate(r.last_invoice)}</td>
                    <td>{fmtDate(r.last_receipt)}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><td>Total ({shown.length})</td><td /><td /><td className="num">{lkr(sum('balance'))}</td><td className="num">{lkr(sum('overdue'))}</td><td /><td /></tr></tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
