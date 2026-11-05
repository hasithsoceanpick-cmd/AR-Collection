import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr, fmtDate, todayISO } from '../lib/format';
import { BUCKETS, OVERDUE, bucketLabel, docType, unpack, downloadAging } from '../lib/aging';
import LedgerStatus from '../components/LedgerStatus';

const COLS = [...BUCKETS, { key: 'credits', label: 'Unapplied credits' }, { key: 'balance', label: 'Balance' }];
const overdue = (r) => OVERDUE.reduce((a, k) => a + Number(r[k] ?? 0), 0);

// Customer aging as at a date, by due date: Not due, 1–30, 31–60, 61–90, Over 90 days.
export default function Aging() {
  const [params, setParams] = useSearchParams();
  const asAt = params.get('asAt') || todayISO();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [only, setOnly] = useState('all');
  const [sort, setSort] = useState({ key: 'balance', dir: -1 });
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null); setError('');
    rpc('cc_aging', { p_as_at: asAt }).then((d) => { if (live) setData(d); }).catch((e) => { if (live) { setError(e.message); setData({ rows: [], entries: [], entry_fields: [] }); } });
    return () => { live = false; };
  }, [asAt]);

  const entries = useMemo(() => (data ? unpack(data.entry_fields, data.entries) : []), [data]);
  const byCustomer = useMemo(() => { const m = {}; for (const e of entries) (m[e.customer_no] ??= []).push(e); return m; }, [entries]);
  const groups = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.group).filter(Boolean))].sort(), [data]);
  const term = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) => (!term || r.name.toLowerCase().includes(term) || r.customer_no.toLowerCase().includes(term))
      && (!group || r.group === group)
      && (only === 'all' || (only === 'overdue' && overdue(r) > 0.004) || (only === 'over90' && Number(r.over90) > 0.004) || (only === 'credit' && Number(r.balance) < 0)));
    const val = (r) => (sort.key === 'name' ? r.name.toLowerCase() : sort.key === 'overdue' ? overdue(r) : Number(r[sort.key] ?? 0));
    return [...list].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir || a.name.localeCompare(b.name));
  }, [data, term, group, only, sort]);
  const total = (k) => shown.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const allTotal = (k) => (data?.rows ?? []).reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const by = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'name' ? 1 : -1 }));
  const arrow = (key) => (sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');

  async function excel() {
    setBusy(true);
    try {
      const names = Object.fromEntries(data.rows.map((r) => [r.customer_no, r.name]));
      const keep = new Set(shown.map((r) => r.customer_no));
      await downloadAging({ asAt, rows: shown, entries: entries.filter((e) => keep.has(e.customer_no)), names });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const positive = BUCKETS.reduce((a, b) => a + Math.max(0, allTotal(b.key)), 0);
  return (
    <section className="wide aging-page">
      <div className="page-head">
        <h1>Customer aging</h1>
        <div className="row">
          <label className="field inline"><span className="flabel">As at</span>
            <input type="date" value={asAt} max={todayISO()} onChange={(e) => e.target.value && setParams({ asAt: e.target.value }, { replace: true })} /></label>
          <button type="button" className="btn" disabled={!data || !shown.length || busy} onClick={excel}>{busy ? 'Preparing…' : 'Download Excel'}</button>
        </div>
      </div>
      <p className="lede">What each customer owes as at {fmtDate(asAt)}, by how long it has been due. Payments and credit notes not yet applied to an invoice are shown on their own.</p>
      {error && <p className="error">{error}</p>}
      <LedgerStatus status={data?.status} />
      {data === null ? <p className="muted">Loading…</p> : (
        <>
          <div className="kpis aging-kpis">
            <div><small>Balance</small><span>{lkr(allTotal('balance'))}</span><small>{data.rows.length} customers</small></div>
            {BUCKETS.map((b) => (
              <div key={b.key} className={`b-${b.key}`}><small>{b.label}</small><span>{lkr(allTotal(b.key))}</span>
                <small>{positive > 0 ? `${Math.round((Math.max(0, allTotal(b.key)) / positive) * 100)}% of what is owed` : '—'}</small></div>
            ))}
            <div><small>Unapplied credits</small><span>{lkr(allTotal('credits'))}</span><small>payments not set against an invoice</small></div>
          </div>
          {positive > 0 && (
            <div className="aging-bar" role="img" aria-label="Share of what is owed in each bucket">
              {BUCKETS.map((b) => { const v = Math.max(0, allTotal(b.key)); return v > 0 ? <i key={b.key} className={`b-${b.key}`} style={{ flexGrow: v }} title={`${b.label}: LKR ${lkr(v)}`} /> : null; })}
            </div>
          )}
          <div className="filters">
            <input className="search" type="search" placeholder="Search customer name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
            {groups.length > 1 && (
              <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Customer group">
                <option value="">All groups</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            <div className="tabs" role="tablist" aria-label="Show">
              {[['all', 'All'], ['overdue', 'Overdue'], ['over90', 'Over 90 days'], ['credit', 'In credit']].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={only === k} className={`tab${only === k ? ' on' : ''}`} onClick={() => setOnly(k)}>{l}</button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? <div className="empty"><p>{data.rows.length ? 'No customer matches.' : `Nothing owed as at ${fmtDate(asAt)}.`}</p></div> : (
            <div className="table-wrap">
              <table className="table aging-table">
                <thead><tr>
                  <th><button type="button" className="th-sort" onClick={() => by('name')}>Customer{arrow('name')}</button></th>
                  {COLS.map((c) => <th key={c.key} className="num"><button type="button" className="th-sort" onClick={() => by(c.key)}>{c.label}{arrow(c.key)}</button></th>)}
                </tr></thead>
                <tbody>{shown.map((r) => (
                  <Fragment key={r.customer_no}>
                    <tr className={`click${open === r.customer_no ? ' on' : ''}`} onClick={() => setOpen(open === r.customer_no ? null : r.customer_no)}>
                      <td>
                        <button type="button" className="link row-toggle" aria-expanded={open === r.customer_no}>{r.name}</button>
                        <div className="muted small">{r.customer_no}{r.group ? ` · ${r.group}` : ''}{r.terms ? ` · ${r.terms}` : ''}{r.incomplete ? ' · history incomplete' : ''}</div>
                      </td>
                      {COLS.map((c) => <td key={c.key} className={`num${c.key === 'balance' ? ' strong' : ''}${Math.abs(Number(r[c.key])) < 0.005 ? ' zero' : ''}`}>{Math.abs(Number(r[c.key])) < 0.005 ? '–' : lkr(r[c.key])}</td>)}
                    </tr>
                    {open === r.customer_no && (
                      <tr className="aging-detail"><td colSpan={COLS.length + 1}>
                        <div className="row between">
                          <strong>{r.open} open invoice{r.open === 1 ? '' : 's'}{r.oldest > 0 ? `, the oldest ${r.oldest} days overdue` : ''}</strong>
                          <Link to={`/customer/${encodeURIComponent(r.customer_no)}?to=${asAt}`}>Open the customer's ledger</Link>
                        </div>
                        <div className="table-wrap flat">
                          <table className="table">
                            <thead><tr><th>Document</th><th>Posted</th><th>Due</th><th>Age</th><th className="num">Original</th><th className="num">Open</th></tr></thead>
                            <tbody>{(byCustomer[r.customer_no] ?? []).map((e) => (
                              <tr key={`${e.document_no}-${e.posting_date}-${e.remaining}`}>
                                <td>{e.document_no}<div className="muted small">{docType(e.document_type, e.original)}{e.description ? ` · ${e.description}` : ''}</div></td>
                                <td>{fmtDate(e.posting_date)}</td>
                                <td>{fmtDate(e.due_date)}</td>
                                <td>{Number(e.remaining) < 0 ? <span className="muted">Unapplied credit</span> : e.late > 0 ? `${e.late} days overdue` : 'Not due'}
                                  {Number(e.remaining) > 0 && <div className="muted small">{bucketLabel(e.late)}</div>}</td>
                                <td className="num">{lkr(e.original)}</td>
                                <td className="num strong">{lkr(e.remaining)}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                ))}</tbody>
                <tfoot><tr>
                  <td>Total{shown.length !== data.rows.length ? ` (${shown.length} of ${data.rows.length})` : ` (${shown.length})`}</td>
                  {COLS.map((c) => <td key={c.key} className="num">{lkr(total(c.key))}</td>)}
                </tr></tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
