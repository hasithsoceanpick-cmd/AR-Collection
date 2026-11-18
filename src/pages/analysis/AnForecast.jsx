import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../../lib/supabase';
import { compact, dmy, downloadForecast, money, num0, PALETTE } from '../../lib/analysis';
import { Columns } from '../../components/Charts';
import { AnPage, DataNote, Loading, Tile, useAnStatus } from './AnCommon';

const BUCKETS = [['w1', 'Week 1'], ['w2', 'Week 2'], ['w3', 'Week 3'], ['w4', 'Week 4'], ['late', 'Past their usual date'], ['later', 'Later']];
const BASIS = { promise: 'Promise', habit: 'Habit', 'due date': 'Due date' };

// Analysis → Cash forecast: open invoices by the week each customer is expected to pay.
export default function AnForecast() {
  const { status } = useAnStatus();
  const [fc, setFc] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [bucket, setBucket] = useState('next4');
  const [open, setOpen] = useState(null);
  useEffect(() => { rpc('cc_an_forecast').then(setFc).catch((e) => setError(e.message)); }, []);

  const byCust = useMemo(() => {
    if (!fc) return [];
    const t = q.trim().toLowerCase();
    const m = new Map();
    for (const r of fc.rows) {
      if (r.bucket === 'in_app') continue;
      if (t && !`${r.name} ${r.customer_no}`.toLowerCase().includes(t)) continue;
      const c = m.get(r.customer_no) ?? { customer_no: r.customer_no, name: r.name, owner: r.owner, rows: [], b: {}, basis: new Set() };
      c.rows.push(r); c.b[r.bucket] = (c.b[r.bucket] ?? 0) + Number(r.expected); c.basis.add(r.basis);
      m.set(r.customer_no, c);
    }
    const inB = (c) => (bucket === 'next4' ? ['w1', 'w2', 'w3', 'w4'].reduce((a, k) => a + (c.b[k] ?? 0), 0) : bucket === 'all'
      ? Object.values(c.b).reduce((a, v) => a + v, 0) : (c.b[bucket] ?? 0));
    return [...m.values()].map((c) => ({ ...c, shown: inB(c) })).filter((c) => c.shown > 0.005).sort((a, b) => b.shown - a.shown);
  }, [fc, q, bucket]);

  const next4 = fc ? fc.weeks.reduce((a, w) => a + Number(w.amount), 0) : 0;
  return (
    <AnPage title="Cash forecast" lede={fc ? `Open invoices of local customers, dated by when each customer usually pays, from ${dmy(fc.today)}.` : ''}
      actions={<button type="button" className="btn" disabled={!fc} onClick={() => downloadForecast(fc, status)}>Download Excel</button>}>
      <DataNote status={status} />
      {!fc ? <Loading error={error} /> : (
        <>
          <div className="an-tiles">
            <Tile label="Next 4 weeks" value={`LKR ${compact(next4)}`} sub={`${fc.weeks.reduce((a, w) => a + w.n, 0)} invoices`} />
            {fc.weeks.map((w, i) => <Tile key={w.key} label={`Week ${i + 1}: ${dmy(w.from).slice(0, 5)} to ${dmy(w.to).slice(0, 5)}`} value={`LKR ${compact(w.amount)}`}
              sub={`${w.n} invoices, ${w.customers} customers`} />)}
          </div>
          <div className="an-grid2">
            <Columns title="Expected by week (LKR)" labels={fc.weeks.map((w, i) => `Week ${i + 1}`)} fmt={money} table={false}
              series={[{ name: 'Expected', color: PALETTE[0], values: fc.weeks.map((w) => w.amount) }]} />
            <div className="an-fcnotes">
              <p><strong>How it's dated.</strong> A live promise comes first. Otherwise the invoice date plus the customer's average days to pay over the last
                12 months (from two payments up). Customers without that history go by the due date.</p>
              <p><strong>Past their usual date:</strong> LKR {money(fc.late.amount)} in {num0(fc.late.n)} invoices that the customer would normally have paid by now.
                These need chasing rather than waiting.</p>
              <p><strong>Later:</strong> LKR {money(fc.later.amount)} in {num0(fc.later.n)} invoices expected after week 4.</p>
              {Number(fc.in_app) > 0 && <p>LKR {money(fc.in_app)} already received in the app and not in BC yet is taken off.</p>}
              {Number(fc.credits.amount) > 0 && <p className="muted">Unapplied credits of LKR {money(fc.credits.amount)} ({fc.credits.customers} customers) are not taken off.</p>}
            </div>
          </div>
          <h2>By customer</h2>
          <div className="filters">
            <input className="search" type="search" placeholder="Search customer name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
            <select value={bucket} onChange={(e) => setBucket(e.target.value)} aria-label="When">
              <option value="next4">Next 4 weeks</option>
              {BUCKETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              <option value="all">Everything open</option>
            </select>
          </div>
          <div className="table-wrap">
            <table className="table an-fctable">
              <thead><tr><th scope="col">Customer</th>{BUCKETS.map(([k, l]) => <th key={k} scope="col" className="num">{l}</th>)}<th scope="col">Based on</th></tr></thead>
              <tbody>
                {byCust.map((c) => (
                  <FcRows key={c.customer_no} c={c} open={open === c.customer_no} onToggle={() => setOpen(open === c.customer_no ? null : c.customer_no)} />
                ))}
              </tbody>
            </table>
          </div>
          {byCust.length === 0 && <p className="muted">Nothing expected there.</p>}
        </>
      )}
    </AnPage>
  );
}

function FcRows({ c, open, onToggle }) {
  return (
    <>
      <tr>
        <td><button type="button" className="link an-fctoggle" onClick={onToggle} aria-expanded={open}>{c.name}</button>
          <span className="muted small"> {c.customer_no} · {c.rows.length} invoice{c.rows.length === 1 ? '' : 's'}</span>
          {' '}<Link className="small" to={`/analysis/customer/${encodeURIComponent(c.customer_no)}`} aria-label={`${c.name}: buying and paying`}>Buying and paying</Link></td>
        {BUCKETS.map(([k]) => <td key={k} className="num">{c.b[k] ? money(c.b[k]) : ''}</td>)}
        <td>{[...c.basis].map((b) => BASIS[b]).join(', ')}</td>
      </tr>
      {open && (
        <tr className="an-fcinv"><td colSpan={BUCKETS.length + 2}>
          <table className="table compact">
            <thead><tr><th scope="col">Invoice</th><th scope="col">Posted</th><th scope="col">Due</th><th scope="col" className="num">Open</th>
              <th scope="col" className="num">In the app</th><th scope="col" className="num">Expected</th><th scope="col">On</th><th scope="col">Based on</th></tr></thead>
            <tbody>{c.rows.map((r) => (
              <tr key={r.document_no}><td>{r.document_no}</td><td>{dmy(r.posting_date)}</td><td>{dmy(r.due_date)}</td><td className="num">{money(r.remaining)}</td>
                <td className="num">{Number(r.in_app) ? money(r.in_app) : ''}</td><td className="num">{money(r.expected)}</td><td>{dmy(r.expected_on)}</td>
                <td>{BASIS[r.basis]}{r.basis === 'habit' ? ` (${r.habit_days} days)` : ''}</td></tr>
            ))}</tbody>
          </table>
        </td></tr>
      )}
    </>
  );
}
