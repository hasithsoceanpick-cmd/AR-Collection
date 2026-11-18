import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { rpc } from '../../lib/supabase';
import { changeClass, changeWords, compact, downloadCustomers, METRICS, metricOf, money, mShort, num1, payWindow, payWindowText, windowLabel } from '../../lib/analysis';
import { AnPage, DataNote, Loading, useAnStatus, useEndMonth, WindowPicker, withTo } from './AnCommon';

const STEP = 100;
const cellText = (m, v) => {
  if (v == null) return '';
  if (m.kind === 'pct') return `${Math.round(v)}%`;
  if (m.kind === 'days') return String(Math.round(v));
  if (m.key === 'kg') return Number(v) === 0 ? '' : num1(v);
  return Number(v) === 0 ? '' : compact(v);
};
// recent 3 months against the 9 before, for sorting by change
function change(list, kind) {
  const a = list.slice(0, 9); const b = list.slice(9);
  if (kind === 'amount') {
    const pa = a.reduce((s, v) => s + (Number(v) || 0), 0) / 9; const pb = b.reduce((s, v) => s + (Number(v) || 0), 0) / 3;
    return pa > 0 ? pb / pa - 1 : null;
  }
  const av = (l) => { const x = l.filter((v) => v != null).map(Number); return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null; };
  const ra = av(a); const rb = av(b);
  if (ra == null || rb == null) return null;
  return kind === 'days' ? ra - rb : rb - ra; // higher = better
}

// Analysis → Customers: every customer × 12 months, one measure at a time, coloured against the customer's own average.
export default function AnCustomers() {
  const { status } = useAnStatus();
  const [end, setEnd] = useEndMonth();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [grp, setGrp] = useState('');
  const [shown, setShown] = useState(STEP);
  const metric = metricOf(sp.get('m') ?? 'kg');
  const sort = sp.get('sort') ?? 'size';
  const setParam = (k, v, dflt) => { const n = new URLSearchParams(sp); if (v === dflt) n.delete(k); else n.set(k, v); setSp(n, { replace: true }); };

  useEffect(() => {
    let live = true;
    setError('');
    rpc('cc_an_customers', { p_end: end }).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [end]);

  const groups = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.grp ?? ''))].sort(), [data]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = (data?.rows ?? []).filter((r) => (!t || `${r.name} ${r.customer_no}`.toLowerCase().includes(t)) && (!grp || (r.grp ?? '') === grp));
    const total = (r) => (metric.kind === 'amount' ? Number(r.total[metric.key]) || 0 : r.total[metric.key]);
    const by = {
      size: (a, b) => (metric.kind === 'amount' ? total(b) - total(a) : (Number(b.total.billed) || 0) - (Number(a.total.billed) || 0)),
      drop: (a, b) => (change(a[metric.key], metric.kind) ?? 99) - (change(b[metric.key], metric.kind) ?? 99),
      rise: (a, b) => (change(b[metric.key], metric.kind) ?? -99) - (change(a[metric.key], metric.kind) ?? -99),
      name: (a, b) => a.name.localeCompare(b.name),
    }[sort] ?? (() => 0);
    return [...list].sort(by);
  }, [data, q, grp, sort, metric]);
  useEffect(() => { setShown(STEP); }, [q, grp, sort, metric.key, end]);

  const totalCell = (r) => {
    const v = r.total[metric.key];
    if (metric.kind === 'amount') return metric.key === 'kg' ? num1(v) : money(v);
    return cellText(metric, v);
  };
  return (
    <AnPage title="Customers" lede={data ? `${metric.long}, ${windowLabel(data.months)}. Each month is coloured against the customer's own 12-month average.` : 'Every customer, month by month.'}
      actions={<>
        <WindowPicker status={status} end={end} onChange={setEnd} />
        <button type="button" className="btn" disabled={!data} onClick={() => downloadCustomers(data, status)}>Download Excel</button>
      </>}>
      <DataNote status={status} />
      <div className="filters an-filters">
        <input className="search" type="search" placeholder="Search customer name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
        <label className="field inline"><span className="flabel">Show</span>
          <select value={metric.key} onChange={(e) => setParam('m', e.target.value, 'kg')} aria-label="Measure">
            {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select></label>
        <label className="field inline"><span className="flabel">Group</span>
          <select value={grp} onChange={(e) => setGrp(e.target.value)} aria-label="Customer group">
            <option value="">All</option>
            {groups.map((g) => <option key={g} value={g}>{g || 'No group'}</option>)}
          </select></label>
        <label className="field inline"><span className="flabel">Sort</span>
          <select value={sort} onChange={(e) => setParam('sort', e.target.value, 'size')} aria-label="Sort">
            <option value="size">{metric.kind === 'amount' ? `${metric.label}, largest first` : 'Billed, largest first'}</option>
            <option value="drop">Biggest drop, last 3 months</option>
            <option value="rise">Biggest rise, last 3 months</option>
            <option value="name">Name</option>
          </select></label>
      </div>
      <p className="an-key small" aria-label="Colour key">
        <span className="an-c b2">{metric.kind === 'days' ? 'much quicker' : 'well above'}</span>
        <span className="an-c b1">{metric.kind === 'days' ? 'quicker' : 'above'}</span>
        <span className="an-c">usual</span>
        <span className="an-c w1">{metric.kind === 'days' ? 'slower' : 'below'}</span>
        <span className="an-c w2">{metric.kind === 'days' ? 'much slower' : 'well below'}</span>
        <span className="muted">{metric.kind === 'amount' ? 'against the customer\'s monthly average (±20%, ±40%)'
          : metric.kind === 'pct' ? 'against the customer\'s average (±10, ±20 points)' : 'against the customer\'s average (±7, ±14 days)'}</span>
      </p>
      {!data ? <Loading error={error} /> : (
        <>
          <p className="muted small">{rows.length} customer{rows.length === 1 ? '' : 's'}{rows.length > shown ? `, showing the first ${shown}` : ''}.</p>
          <div className="table-wrap an-gridwrap">
            <table className="table an-grid">
              <thead>
                <tr>
                  <th scope="col" className="an-sticky">Customer</th>
                  {data.months.map((m) => <th key={m} scope="col" className="num">{mShort(m)}</th>)}
                  <th scope="col" className="num">{metric.kind === 'amount' ? '12 months' : 'Overall'}</th>
                  <th scope="col">Usually pays</th>
                  <th scope="col" className="num">Balance now</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((r) => {
                  const list = r[metric.key];
                  const pw = payWindow(r.pay_days);
                  return (
                    <tr key={r.customer_no} className="click" onClick={(e) => { if (!e.target.closest('a')) nav(withTo(`/analysis/customer/${encodeURIComponent(r.customer_no)}`, end)); }}>
                      <th scope="row" className="an-sticky">
                        <Link to={withTo(`/analysis/customer/${encodeURIComponent(r.customer_no)}`, end)}>{r.name}</Link>
                        <span className="muted small"> {r.customer_no}{r.grp ? ` · ${r.grp}` : ''}</span>
                      </th>
                      {list.map((v, i) => {
                        const cls = changeClass(v, list, metric.kind);
                        return <td key={data.months[i]} className={`num an-c ${cls}`} title={`${mShort(data.months[i])}: ${metric.fmt(v)}${cls ? `, ${changeWords(cls, metric.kind)}` : ''}`}>{cellText(metric, v)}</td>;
                      })}
                      <td className="num an-total">{totalCell(r)}</td>
                      <td className="an-paywin">{pw ? payWindowText(pw) : <span className="muted small">—</span>}</td>
                      <td className="num">{money(r.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > shown && <button type="button" className="btn" onClick={() => setShown((s) => s + STEP)}>Show {Math.min(STEP, rows.length - shown)} more</button>}
        </>
      )}
    </AnPage>
  );
}
