import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr, ref, fmtDate, fmtDateTime } from '../lib/format';
import { STATUS } from '../lib/workflow';
import StatusStamp from '../components/StatusStamp';

const M = (v) => `${(Number(v || 0) / 1e6).toFixed(2)}m`;
const pct = (a, b) => (Number(b) > 0 ? Math.round((100 * Number(a)) / Number(b)) : 0);
const BUCKETS = [
  { key: 'not_due', label: 'Not due', cls: 'b0' }, { key: 'd1_30', label: '1–30 days', cls: 'b1' },
  { key: 'd31_60', label: '31–60 days', cls: 'b2' }, { key: 'd61_90', label: '61–90 days', cls: 'b3' }, { key: 'd90', label: '90+ days', cls: 'b4' },
];
const SEG_NOTE = { HORECA: 'Hotels & restaurants', Local: 'Retail, farms & trade', Export: 'Overseas buyers', Other: 'No group in BC' };
const STAGE_ORDER = ['submitted', 'assigned', 'collected', 'received', 'deposited', 'review', 'relink'];

function monthsBack(n) {
  const out = []; const d = new Date(); d.setDate(1);
  for (let i = 0; i < n; i++) { out.push(new Date(d.getFullYear(), d.getMonth() - i, 1)); }
  return out.map((x) => ({ value: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`,
    label: x.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) }));
}

function Kpi({ label, value, sub, tone }) {
  return <div className={`kpi${tone ? ` kpi-${tone}` : ''}`}><span className="kpi-label">{label}</span><span className="kpi-value">{value}</span>{sub && <span className="kpi-sub">{sub}</span>}</div>;
}

function AgeingBars({ segments }) {
  const max = Math.max(...segments.map((s) => Number(s.open)), 1);
  return (
    <div className="ageing">
      <div className="legend-row">{BUCKETS.map((b) => <span key={b.key}><i className={b.cls} />{b.label}</span>)}</div>
      {segments.map((s) => (
        <div className="age-row" key={s.seg}>
          <div className="age-name"><strong>{s.seg}</strong><small>{SEG_NOTE[s.seg] ?? ''} · {s.customers} customers</small></div>
          <div className="age-track" style={{ width: `${Math.max(8, (100 * s.open) / max)}%` }}
            title={BUCKETS.map((b) => `${b.label}: LKR ${lkr(s[b.key] || 0)}`).join('\n')}>
            {BUCKETS.map((b) => Number(s[b.key]) > 0 && <span key={b.key} className={b.cls} style={{ width: `${(100 * s[b.key]) / s.open}%` }} />)}
          </div>
          <div className="age-total num">LKR {M(s.open)}</div>
        </div>
      ))}
      <div className="table-wrap flat">
        <table className="table">
          <thead><tr><th>Segment</th>{BUCKETS.map((b) => <th key={b.key} className="num">{b.label}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>{segments.map((s) => (
            <tr key={s.seg}><td>{s.seg}</td>{BUCKETS.map((b) => <td key={b.key} className="num">{lkr(s[b.key] || 0)}</td>)}<td className="num"><strong>{lkr(s.open)}</strong></td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function WeekColumns({ weeks }) {
  const max = Math.max(...weeks.map((w) => Number(w.receipts) + Number(w.tagged) + Number(w.unidentified)), 1);
  return (
    <div className="weeks">
      <div className="legend-row"><span><i className="w-rec" />Linked to receipts</span><span><i className="w-tag" />Tagged (card, PayHere, other)</span><span><i className="w-unid" />Unidentified</span></div>
      <div className="week-cols">
        {weeks.map((w) => {
          const t = Number(w.receipts) + Number(w.tagged) + Number(w.unidentified);
          return (
            <div className="week" key={w.week} title={`Week of ${fmtDate(w.week)}\nReceipts LKR ${lkr(w.receipts)}\nTagged LKR ${lkr(w.tagged)}\nUnidentified LKR ${lkr(w.unidentified)}`}>
              <span className="week-total">{M(t)}</span>
              <div className="week-bar" style={{ height: `${Math.max(4, (100 * t) / max)}%` }}>
                <span className="w-unid" style={{ height: `${pct(w.unidentified, t)}%` }} />
                <span className="w-tag" style={{ height: `${pct(w.tagged, t)}%` }} />
                <span className="w-rec" style={{ height: `${pct(w.receipts, t)}%` }} />
              </div>
              <span className="week-label">{fmtDate(w.week).replace(/ \d{4}$/, '')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Overview() {
  const months = useMemo(() => monthsBack(12), []);
  const [month, setMonth] = useState(null);
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setD(await rpc('cc_exec_overview', { p_month: month })); } catch (e) { setError(e.message); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  if (error) return <section className="wide"><div className="page-head"><h1>Overview</h1></div><p className="error">Couldn't load the overview: {error}</p></section>;
  if (!d) return <p className="muted">Loading the overview…</p>;
  const R = d.receivables, P = d.pipeline, K = d.cash;
  const stages = STAGE_ORDER.map((st) => {
    const rows = P.stages.filter((s) => s.status === st);
    return { st, items: rows.reduce((a, r) => a + Number(r.items), 0), amount: rows.reduce((a, r) => a + Number(r.amount), 0) };
  }).filter((s) => s.items > 0);
  const stageMax = Math.max(...stages.map((s) => s.amount), 1);
  const cashIn = K.accounts.reduce((a, x) => a + Number(x.received), 0);
  const cashRec = K.accounts.reduce((a, x) => a + Number(x.receipts) + Number(x.tagged), 0);
  const monthValue = month ?? K.month;
  const monthLabel = new Date(`${K.month}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <section className="wide overview">
      <div className="page-head">
        <h1>Overview</h1>
        <label className="inline-field">Month
          <select value={monthValue} onChange={(e) => setMonth(e.target.value)}>
            {!months.some((m) => m.value === K.month) && <option value={K.month}>{monthLabel}</option>}
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      </div>
      <p className="lede">
        Receivables as uploaded from Business Central {R.as_at ? fmtDateTime(R.as_at) : '(no ledger uploaded yet)'}.
        {' '}Bank lines up to {fmtDate(K.latest_line)}. Collections and cash figures are for {monthLabel}.
      </p>

      {/* ---------------- Receivables ---------------- */}
      <h2 className="ov-title">Receivables (local sales)</h2>
      {Number(R.ungrouped?.customers) > 0 && (
        <div className="facts flag-card">
          <p className="warn-text"><strong>{R.ungrouped.customers} customers (LKR {M(R.ungrouped.open)}) have no BC posting group in the app</strong>, so export customers among them can't be recognised and left out.
            Upload the customer list again on <Link to="/customers">Customer data</Link>, with BC's <strong>Customer Posting Group</strong> and <strong>Payment Terms Code</strong> columns showing.</p>
        </div>
      )}
      <p className="hint">Export customers are left out of this overview{Number(R.export_excluded?.customers) > 0 ? `: ${R.export_excluded.customers} customers, LKR ${lkr(R.export_excluded.open)} open` : ''}. Their data stays in the app and in BC.</p>
      <div className="kpi-grid">
        <Kpi label="Open receivables" value={`LKR ${M(R.open)}`} sub={`${R.invoices_open} invoices · ${R.customers_owing} customers`} />
        <Kpi label="Overdue" value={`LKR ${M(R.overdue)}`} sub={`${pct(R.overdue, R.open)}% of open`} tone={pct(R.overdue, R.open) > 50 ? 'warn' : null} />
        <Kpi label="More than 30 days late" value={`LKR ${M(R.overdue_30)}`} sub={`${pct(R.overdue_30, R.open)}% of open`} tone="warn" />
        <Kpi label="Top 10 customers hold" value={`${R.top10_share ?? 0}%`} sub="of open receivables" />
        {Number(R.credits) < 0 && <Kpi label="Unapplied credits" value={`LKR ${M(-R.credits)}`} sub="payments and credit notes not yet applied in BC" />}
      </div>

      <div className="facts"><h2>Ageing by segment</h2><AgeingBars segments={R.segments} /></div>

      <div className="ov-flags">
        <div className="facts flag-card">
          <h2>Overdue over 30 days, no collection arranged</h2>
          <p className="flag-big">{R.unarranged.customers} customers · LKR {M(R.unarranged.amount)}</p>
          <p className="hint">HORECA and Local customers with invoices over 30 days late and nothing recorded in the app to collect it. Export excluded.</p>
          <ul className="plain">{R.unarranged.top.map((u) => <li key={u.customer_no}>{u.name} <span className="muted">({u.seg})</span>: LKR {lkr(u.o30)}, oldest due {fmtDate(u.oldest_due)}</li>)}</ul>
        </div>
        <div className="facts flag-card">
          <h2>Balances on advance-payment terms</h2>
          {R.advance_terms.length === 0 ? <p className="muted">None. Good.</p> : (
            <>
              <p className="flag-big">{R.advance_terms.length} customers · LKR {M(R.advance_terms.reduce((a, x) => a + Number(x.open), 0))}</p>
              <p className="hint">These customers are set to pay 100% in advance, yet they owe money.</p>
              <ul className="plain">{R.advance_terms.map((a) => <li key={a.customer_no}>{a.name}: LKR {lkr(a.open)} ({a.terms}), oldest due {fmtDate(a.oldest_due)}</li>)}</ul>
            </>
          )}
          <h2 className="flag-sub">No payment terms in BC</h2>
          <p><strong>{R.no_terms.customers} customers · LKR {M(R.no_terms.open)}</strong></p>
          <p className="hint">Their invoices count as overdue from the day they're issued, which overstates "overdue". Setting terms in BC fixes this.</p>
        </div>
      </div>

      <div className="facts">
        <h2>Top 10 customers by balance</h2>
        <div className="table-wrap flat">
          <table className="table">
            <thead><tr><th>Customer</th><th>Segment</th><th>Terms</th><th className="num">Open</th><th className="num">Overdue</th><th className="num">Over 30 days</th><th>Oldest due</th><th className="num">Being collected</th></tr></thead>
            <tbody>{R.top_customers.map((t) => (
              <tr key={t.customer_no}>
                <td>{t.name}<div className="muted small">{t.customer_no}</div></td><td>{t.seg}</td><td>{t.terms ?? <span className="muted">none</span>}</td>
                <td className="num">{lkr(t.open)}</td><td className="num">{lkr(t.overdue)}</td>
                <td className={`num${Number(t.overdue_30) > 0 ? ' warn-text' : ''}`}>{lkr(t.overdue_30)}</td>
                <td>{fmtDate(t.oldest_due)}</td><td className="num">{Number(t.in_progress) > 0 ? lkr(t.in_progress) : <span className="muted">—</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {/* ---------------- Collections ---------------- */}
      <h2 className="ov-title">Collections in progress</h2>
      <div className="kpi-grid">
        <Kpi label="In progress" value={`LKR ${M(P.total.amount)}`} sub={`${P.total.items} cheques and transfers`} />
        <Kpi label="Pickups overdue" value={P.overdue_pickups.length} sub="assigned, collection date passed" tone={P.overdue_pickups.length ? 'warn' : null} />
        <Kpi label="Stuck over 5 days" value={P.stuck.length} sub="in the same stage" tone={P.stuck.length ? 'warn' : null} />
        <Kpi label={`Returned in ${monthLabel.split(' ')[0]}`} value={P.returned.items} sub={`LKR ${lkr(P.returned.amount)}`} tone={P.returned.items ? 'warn' : null} />
        <Kpi label="Invoice to bank" value={P.days_to_cash.invoice_to_bank != null ? `${P.days_to_cash.invoice_to_bank} days` : '—'}
          sub={`average, ${P.days_to_cash.closed} receipts closed in ${monthLabel.split(' ')[0]}`} />
      </div>
      <div className="ov-flags">
        <div className="facts">
          <h2>By stage</h2>
          {stages.length === 0 ? <p className="muted">Nothing in progress.</p> : stages.map((s) => (
            <div className="stage-row" key={s.st}>
              <span className="stage-name"><StatusStamp status={s.st} /></span>
              <span className="stage-bar"><span style={{ width: `${Math.max(3, (100 * s.amount) / stageMax)}%` }} /></span>
              <span className="num">{s.items} · LKR {lkr(s.amount)}</span>
            </div>
          ))}
          <p className="hint"><Link to="/reports">Map, ageing and reconciliation reports</Link></p>
        </div>
        <div className="facts">
          <h2>Needs attention</h2>
          {P.overdue_pickups.length === 0 && P.stuck.length === 0 && <p className="muted">Nothing overdue or stuck.</p>}
          <ul className="plain">
            {P.overdue_pickups.map((o) => <li key={`o${o.id}`}><Link to={`/c/${o.id}`}>{ref(o.id)}</Link> {o.customer_name}: pickup was due {fmtDate(o.collection_date)} ({o.days_late} days late, {o.driver ?? 'no driver'}), LKR {lkr(o.amount)}</li>)}
            {P.stuck.filter((s) => !P.overdue_pickups.some((o) => o.id === s.id)).map((s) => (
              <li key={`s${s.id}`}><Link to={`/c/${s.id}`}>{ref(s.id)}</Link> {s.customer_name}: {STATUS[s.status]?.label ?? s.status} for {s.days} days, LKR {lkr(s.amount)}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="facts">
        <h2>By sales person, {monthLabel}</h2>
        {P.by_sales.length === 0 ? <p className="muted">Nothing recorded this month.</p> : (
          <div className="table-wrap flat"><table className="table">
            <thead><tr><th>Recorded by</th><th className="num">Recorded</th><th className="num">LKR</th><th className="num">Closed</th><th className="num">Closed LKR</th><th className="num">Still open</th></tr></thead>
            <tbody>{P.by_sales.map((b) => <tr key={b.person}><td>{b.person}</td><td className="num">{b.recorded}</td><td className="num">{lkr(b.recorded_amount)}</td><td className="num">{b.closed}</td><td className="num">{lkr(b.closed_amount)}</td><td className="num">{b.open}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>

      {/* ---------------- Cash & bank ---------------- */}
      <h2 className="ov-title">Cash and bank</h2>
      <div className="kpi-grid">
        <Kpi label={`Money in, ${monthLabel}`} value={`LKR ${M(cashIn)}`} sub="all active accounts" />
        <Kpi label="Identified" value={`${pct(cashRec, cashIn)}%`} sub={`LKR ${M(cashRec)} linked or tagged`} />
        <Kpi label="Unidentified money in" value={`LKR ${M(K.unidentified.amount)}`} sub={`${K.unidentified.lines} lines, oldest ${fmtDate(K.unidentified.oldest)}`} tone={K.unidentified.lines ? 'warn' : null} />
      </div>
      <div className="facts">
        <h2>By account, {monthLabel}</h2>
        <div className="table-wrap flat"><table className="table">
          <thead><tr><th>Account</th><th className="num">Money in</th><th className="num">Linked to receipts</th><th className="num">Tagged</th><th className="num">Unidentified</th><th>Statement up to</th></tr></thead>
          <tbody>{K.accounts.map((a) => (
            <tr key={a.name}><td>{a.name}</td><td className="num">{lkr(a.received)}</td><td className="num">{lkr(a.receipts)}</td><td className="num">{lkr(a.tagged)}</td>
              <td className={`num${Number(a.unidentified) > 0 ? ' warn-text' : ''}`}>{lkr(a.unidentified)}{a.unidentified_lines ? ` (${a.unidentified_lines})` : ''}</td><td>{fmtDate(a.last_line)}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="facts"><h2>Money in by week</h2>{K.weeks.length ? <WeekColumns weeks={K.weeks} /> : <p className="muted">No bank lines yet.</p>}</div>
    </section>
  );
}
