import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr, ref, fmtDate, todayISO } from '../lib/format';
import { KIND_LABEL, STATUS } from '../lib/workflow';
import { BUCKETS, bucketLabel, docType, kindLabel, downloadStatement } from '../lib/aging';
import LedgerStatus from '../components/LedgerStatus';
import StatusStamp from '../components/StatusStamp';
import FollowUpPanel from '../components/FollowUpPanel';
import { useAuth } from '../lib/auth';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function period(key, to) {
  const t = new Date(`${to}T00:00:00`);
  if (key === 'month') return iso(new Date(t.getFullYear(), t.getMonth(), 1));
  if (key === '3m') return iso(new Date(t.getFullYear(), t.getMonth() - 2, 1));
  if (key === 'year') return iso(new Date(t.getFullYear(), 0, 1));
  return '';
}

// One customer: details, what is open and its age, the ledger with a running balance, and the app's receipts.
export default function CustomerPage() {
  const { no } = useParams();
  const { role } = useAuth();
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const to = params.get('to') || todayISO();
  const from = params.get('from') ?? '';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); } return n; }, { replace: true });

  useEffect(() => {
    let live = true;
    setData(null); setError('');
    rpc('cc_customer_ledger', { p_customer_no: no, p_from: from || null, p_to: to })
      .then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [no, from, to]);

  // a notification or the worklist opens the follow-up: scroll to it once the page is there
  useEffect(() => {
    if (hash !== '#follow-up' || !data) return undefined;
    const t = setTimeout(() => document.getElementById('follow-up')?.scrollIntoView({ block: 'start' }), 50);
    return () => clearTimeout(t);
  }, [hash, data]);

  const lines = useMemo(() => {
    if (!data) return [];
    let bal = Number(data.opening);
    return data.lines.map((l) => { bal += Number(l.amount); return { ...l, balance: bal }; });
  }, [data]);

  if (error) return <section className="wide"><p><Link to="/customer-list">All customers</Link></p><p className="error">{error}</p></section>;
  if (!data) return <section className="wide"><p className="muted">Loading…</p></section>;
  const c = data.customer;
  const b = data.buckets;
  const owed = BUCKETS.reduce((a, x) => a + Math.max(0, Number(b[x.key])), 0);
  const quick = [['month', 'This month'], ['3m', 'Last 3 months'], ['year', 'This year'], ['', 'All']];

  async function excel() {
    setBusy(true);
    try { await downloadStatement(data); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="wide customer-page">
      <p><Link to="/customer-list">All customers</Link> · <Link to={`/aging?asAt=${to}`}>Customer aging</Link></p>
      <div className="page-head">
        <div>
          <h1>{c.name}</h1>
          <p className="muted">{[c.customer_no, c.group, c.terms && `Terms ${c.terms}`].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={excel}>{busy ? 'Preparing…' : 'Download statement'}</button>
      </div>
      {(c.phone || c.contact || c.address || c.city) && (
        <p className="contact-line">{[c.contact, c.phone, [c.address, c.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
      )}
      {!c.in_list && <p className="warn-text">Not in the customer list uploaded from BC (only in the ledger).</p>}
      <LedgerStatus status={data.status} customer incomplete={c.incomplete} />

      <div className="kpis aging-kpis">
        <div><small>Balance at {fmtDate(data.to)}</small><span>{lkr(b.balance)}</span><small>{Number(b.balance) < 0 ? 'in credit' : (() => { const n = data.open.filter((o) => Number(o.remaining) > 0).length; return `${n} open invoice${n === 1 ? '' : 's'}`; })()}</small></div>
        {BUCKETS.map((x) => <div key={x.key} className={`b-${x.key}`}><small>{x.label}</small><span>{lkr(b[x.key])}</span></div>)}
        <div><small>Unapplied credits</small><span>{lkr(b.credits)}</span></div>
      </div>
      {owed > 0 && (
        <div className="aging-bar" role="img" aria-label="Share of what is owed in each bucket">
          {BUCKETS.map((x) => { const v = Math.max(0, Number(b[x.key])); return v > 0 ? <i key={x.key} className={`b-${x.key}`} style={{ flexGrow: v }} title={`${x.label}: LKR ${lkr(v)}`} /> : null; })}
        </div>
      )}

      {(role === 'finance' || role === 'executive') && <FollowUpPanel customerNo={no} />}

      <div className="facts">
        <h2>Open at {fmtDate(data.to)} ({data.open.length})</h2>
        {data.open.length === 0 ? <p className="muted">Nothing open.</p> : (
          <div className="table-wrap flat">
            <table className="table">
              <thead><tr><th>Document</th><th>Posted</th><th>Due</th><th>Age</th><th className="num">Original</th><th className="num">Open</th></tr></thead>
              <tbody>{data.open.map((o) => (
                <tr key={`${o.doc_no}-${o.date}-${o.original}`}>
                  <td>{o.doc_no}<div className="muted small">{docType(o.doc_type, o.original)}{o.description ? ` · ${o.description}` : ''}</div></td>
                  <td>{fmtDate(o.date)}</td>
                  <td>{fmtDate(o.due_date)}</td>
                  <td>{Number(o.remaining) < 0 ? <span className="muted">Unapplied credit</span> : o.late > 0 ? <span className={o.late > 90 ? 'late' : ''}>{o.late} days overdue</span> : 'Not due'}
                    {Number(o.remaining) > 0 && <div className="muted small">{bucketLabel(o.late)}</div>}</td>
                  <td className="num">{lkr(o.original)}</td>
                  <td className="num strong">{lkr(o.remaining)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={5}>Balance</td><td className="num">{lkr(b.balance)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="facts">
        <div className="page-head">
          <h2>Ledger</h2>
          <div className="row ledger-period">
            <div className="tabs" role="tablist" aria-label="Period">
              {quick.map(([k, l]) => (
                <button key={l} type="button" role="tab" aria-selected={from === period(k, to)} className={`tab${from === period(k, to) ? ' on' : ''}`} onClick={() => set({ from: period(k, to) })}>{l}</button>
              ))}
            </div>
            <label className="field inline"><span className="flabel">From</span><input type="date" value={from || data.from} max={to} onChange={(e) => set({ from: e.target.value })} /></label>
            <label className="field inline"><span className="flabel">To</span><input type="date" value={to} max={todayISO()} onChange={(e) => e.target.value && set({ to: e.target.value })} /></label>
          </div>
        </div>
        <div className="table-wrap flat">
          <table className="table ledger-table">
            <thead><tr><th>Date</th><th>Document</th><th>Due</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th><th className="num">Still open</th></tr></thead>
            <tbody>
              <tr className="sub"><td>{fmtDate(data.from)}</td><td colSpan={4}>Opening balance</td><td className="num">{lkr(data.opening)}</td><td /></tr>
              {lines.map((l) => {
                const initial = l.kind === 'Initial Entry';
                const open = initial && Math.abs(Number(l.remaining)) >= 0.005;
                return (
                  <tr key={l.entry_no}>
                    <td>{fmtDate(l.date)}</td>
                    <td>{initial ? (l.doc_no ?? '—') : kindLabel(l.kind)}
                      <div className="muted small">{initial ? docType(l.doc_type, l.amount) : l.doc_no}{l.description ? ` · ${l.description}` : ''}</div></td>
                    <td>{initial && Number(l.amount) > 0 ? fmtDate(l.due_date) : ''}</td>
                    <td className="num">{Number(l.amount) > 0 ? lkr(l.amount) : ''}</td>
                    <td className="num">{Number(l.amount) < 0 ? lkr(-l.amount) : ''}</td>
                    <td className="num strong">{lkr(l.balance)}</td>
                    <td className="num">{open ? lkr(l.remaining) : initial ? <span className="muted">settled</span> : ''}</td>
                  </tr>
                );
              })}
              {lines.length === 0 && <tr><td colSpan={7} className="muted">Nothing posted in this period.</td></tr>}
            </tbody>
            <tfoot><tr><td>{fmtDate(data.to)}</td><td colSpan={4}>Closing balance</td><td className="num">{lkr(data.closing)}</td><td /></tr></tfoot>
          </table>
        </div>
      </div>

      <div className="facts">
        <h2>Receipts recorded in the app ({data.receipts.length})</h2>
        {data.receipts.length === 0 ? <p className="muted">None you can see.</p> : (
          <div className="table-wrap flat">
            <table className="table">
              <thead><tr><th>Receipt</th><th>Date</th><th>Invoices</th><th className="num">LKR</th><th>Status</th></tr></thead>
              <tbody>{data.receipts.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/c/${r.id}`}>{ref(r.id)}</Link><div className="muted small">{KIND_LABEL[r.kind] ?? r.kind}{r.cshrc_no ? ` · ${r.cshrc_no}` : ''}</div></td>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.invoices || <span className="muted">—</span>}</td>
                  <td className="num">{lkr(r.amount)}</td>
                  <td>{STATUS[r.status] ? <StatusStamp status={r.status} /> : r.status}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
