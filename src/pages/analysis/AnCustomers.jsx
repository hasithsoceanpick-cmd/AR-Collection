import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { rpc } from '../../lib/supabase';
import { changeClass, changeWords, compact, downloadCustomers, METRICS, metricOf, money, num1, payWindow, payWindowText, periods } from '../../lib/analysis';
import { AnPage, DataNote, Loading, ModeNote, useAnMode, useAnStatus } from './AnCommon';

const STEP = 100;
const cellText = (m, v) => {
  if (v == null) return '';
  if (m.kind === 'pct') return `${Math.round(v)}%`;
  if (m.kind === 'days') return String(Math.round(v));
  if (m.key === 'kg') return Number(v) === 0 ? '' : num1(v);
  return Number(v) === 0 ? '' : compact(v);
};

// Analysis → Customers: every customer × 12 months, one measure at a time, coloured against the customer's own average.
export default function AnCustomers() {
  const { status } = useAnStatus();
  const [mode] = useAnMode();
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
    rpc('cc_an_customers', { p_mode: mode }).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [mode]);

  const groups = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.grp ?? ''))].sort(), [data]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = (data?.rows ?? []).filter((r) => (!t || `${r.name} ${r.customer_no}`.toLowerCase().includes(t)) && (!grp || (r.grp ?? '') === grp));
    const total = (r) => (metric.kind === 'amount' ? Number(r.total[metric.key]) || 0 : r.total[metric.key]);
    const by = {
      size: (a, b) => (metric.kind === 'amount' ? total(b) - total(a) : (Number(b.total.billed) || 0) - (Number(a.total.billed) || 0)),
      // the last 3 months against the 9 before (from the database; higher = better)
      drop: (a, b) => (a.change?.[metric.key] ?? 1e9) - (b.change?.[metric.key] ?? 1e9),
      rise: (a, b) => (b.change?.[metric.key] ?? -1e9) - (a.change?.[metric.key] ?? -1e9),
      name: (a, b) => a.name.localeCompare(b.name),
    }[sort] ?? (() => 0);
    return [...list].sort(by);
  }, [data, q, grp, sort, metric]);
  useEffect(() => { setShown(STEP); }, [q, grp, sort, metric.key, mode]);
  const per = data ? periods(data.months, data.from, data.to) : [];

  const totalCell = (r) => {
    const v = r.total[metric.key];
    if (metric.kind === 'amount') return metric.key === 'kg' ? num1(v) : money(v);
    return cellText(metric, v);
  };
  return (
    <AnPage title="Customers" lede={`${metric.long}. Each month is coloured against the customer's own 12-month average.`}
      actions={<>
        <button type="button" className="btn" disabled={!data} onClick={() => downloadCustomers(data, status)}>Download Excel</button>
      </>}>
      <ModeNote data={data} />
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
            <option value="drop">Biggest drop, last 3 months vs the 9 before</option>
            <option value="rise">Biggest rise, last 3 months vs the 9 before</option>
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
                  {per.map((x) => <th key={x.m} scope="col" className="num">{x.label}{x.partial && <span className="an-part">{x.part}</span>}</th>)}
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
                    <tr key={r.customer_no} className="click" onClick={(e) => { if (!e.target.closest('a')) nav(`/analysis/customer/${encodeURIComponent(r.customer_no)}`); }}>
                      <th scope="row" className="an-sticky">
                        <Link to={`/analysis/customer/${encodeURIComponent(r.customer_no)}`}>{r.name}</Link>
                        <span className="muted small"> {r.customer_no}{r.grp ? ` · ${r.grp}` : ''}</span>
                      </th>
                      {list.map((v, i) => {
                        const cls = per[i].partial ? '' : changeClass(v, list, metric.kind); // part months aren't coloured
                        return <td key={per[i].m} className={`num an-c ${cls}${per[i].partial ? ' an-partcell' : ''}`} title={`${per[i].title}: ${metric.fmt(v)}${cls ? `, ${changeWords(cls, metric.kind)}` : ''}`}>{cellText(metric, v)}</td>;
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
