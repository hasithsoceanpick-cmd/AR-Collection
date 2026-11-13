import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr } from '../lib/format';
import { BUCKETS } from '../lib/aging';
import { PROMISE, ACTIVE, dmy, outcomeLabel, channelLabel, addDays, daysBetween, zero } from '../lib/followup';
import LedgerStatus from '../components/LedgerStatus';
import NoteEditor from '../components/NoteEditor';
import InvoiceNotes from '../components/InvoiceNotes';

const OVERDUE = BUCKETS.filter((b) => b.key !== 'not_due');

const QUICK = [
  { key: 'all', label: 'All' },
  { key: 'action', label: 'Next action due', test: (r, t) => r.next_action_on && r.next_action_on <= t },
  { key: 'stale', label: 'No contact in 7+ days', test: (r, t) => !r.last_contact || daysBetween(r.last_contact.at.slice(0, 10), t) >= 7 },
  { key: 'week', label: 'Promise due this week', test: (r, t) => r.promise && ACTIVE.includes(r.promise.status) && r.promise.promised_on <= addDays(t, 7) },
  { key: 'broken', label: 'Broken promise', test: (r) => r.broken_60 > 0 },
  { key: 'disputed', label: 'Disputed', test: (r) => r.disputes_n > 0 },
  { key: 'over90', label: 'Over 90 days', test: (r) => !zero(r.over90) },
  { key: 'flags', label: 'In credit or over limit', test: (r) => r.in_credit || r.over_limit },
];

// The overdue amount with a small bar of its buckets.
function OverdueCell({ r }) {
  const parts = OVERDUE.map((b) => ({ ...b, v: Math.max(0, Number(r[b.key])) })).filter((b) => b.v > 0);
  return (
    <>
      <strong className="num-strong">{lkr(r.overdue)}</strong>
      <span className="fu-bar" role="img" aria-label={parts.map((b) => `${b.label}: ${lkr(b.v)}`).join(', ')}>
        {parts.map((b) => <i key={b.key} className={`b-${b.key}`} style={{ flexGrow: b.v }} title={`${b.label}: LKR ${lkr(b.v)}`} />)}
      </span>
      <span className="muted small">oldest {r.oldest} day{r.oldest === 1 ? '' : 's'}{!zero(r.over90) ? ` · 90+ ${lkr(r.over90)}` : ''}</span>
    </>
  );
}

function Settings({ data, onDone }) {
  const [days, setDays] = useState(String(data.settings.retail_overdue_days));
  const [grace, setGrace] = useState(String(data.settings.grace_days));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await rpc('cc_ar_settings_set', { p_retail_days: Number(days), p_grace_days: Number(grace) }); await onDone(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form className="fu-settings" onSubmit={save}>
      <label className="field"><span className="flabel">Retail customers (RT-/WEB- invoices only) join the list after</span>
        <span className="row"><input type="number" min="0" max="365" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days overdue" /> days overdue</span></label>
      <label className="field"><span className="flabel">A promise is broken this many days after its date</span>
        <span className="row"><input type="number" min="0" max="14" value={grace} onChange={(e) => setGrace(e.target.value)} aria-label="Grace days" /> days</span></label>
      <button className="btn small primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      {err && <p className="error small">{err}</p>}
    </form>
  );
}

// AR follow-up worklist: every local customer with an overdue balance, highest priority first.
export default function FollowUp() {
  const { reloadToday } = useOutletContext() ?? {};
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [seg, setSeg] = useState('');
  const [owner, setOwner] = useState('');
  const [quick, setQuick] = useState('all');
  const [showSettings, setShowSettings] = useState(false);
  const [open, setOpen] = useState(() => new Set());   // customers whose invoice lines are showing
  const setRow = (no, patch) => setData((d) => ({ ...d, rows: d.rows.map((x) => (x.customer_no === no ? { ...x, ...patch } : x)) }));
  const flipOpen = (no) => setOpen((s) => { const n = new Set(s); if (n.has(no)) n.delete(no); else n.add(no); return n; });

  const load = useCallback(async () => {
    try {
      rpc('cc_ar_tick').then(() => reloadToday?.()).catch(() => {});
      setData(await rpc('cc_ar_worklist', { p_as_at: null })); setError('');
    } catch (e) { setError(e.message); }
  }, [reloadToday]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const t = data?.today;
  const owners = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => r.owner_id && m.set(r.owner_id, r.owner));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const qt = QUICK.find((x) => x.key === quick);
  const shown = rows.filter((r) => (!seg || r.seg === seg)
    && (!owner || (owner === 'none' ? !r.owner_id : r.owner_id === owner))
    && (!q.trim() || `${r.name} ${r.customer_no}`.toLowerCase().includes(q.trim().toLowerCase()))
    && (!qt.test || qt.test(r, t)));
  const sum = (k, list = shown) => list.reduce((a, r) => a + Number(r[k] || 0), 0);
  const unassigned = rows.filter((r) => !r.owner_id).length;
  const actionsDue = rows.filter((r) => r.next_action_on && r.next_action_on <= t).length;
  const brokenN = rows.filter((r) => r.broken_60 > 0).length;

  if (!data && !error) return <section className="wide"><h1>AR follow-up</h1><p className="muted">Loading…</p></section>;
  if (!data) return <section className="wide"><h1>AR follow-up</h1><p className="error">{error}</p></section>;
  const tie = data.tie;
  return (
    <section className="wide follow-up">
      <div className="page-head">
        <div>
          <h1>AR follow-up</h1>
          <p className="lede">Local customers with overdue invoices, highest priority first. <strong>Net to chase</strong> is what is overdue less the money
            already on its way (receipts in the app not in BC yet, parked transfers, card, cash and PayHere), unapplied credits and disputed invoices.</p>
        </div>
        {data.can.admin && <button className="btn small" type="button" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}>Settings</button>}
      </div>
      {showSettings && <Settings data={data} onDone={async () => { setShowSettings(false); await load(); }} />}
      <LedgerStatus status={data.status} />

      <div className="kpis fu-kpis">
        <div><small>Overdue</small><span>{lkr(sum('overdue', rows))}</span><small>{rows.length} customer{rows.length === 1 ? '' : 's'}</small></div>
        <div className="fu-net"><small>Net to chase</small><span>{lkr(sum('net', rows))}</span><small>after money on its way, credits, disputes</small></div>
        <div><small>Money on its way</small><span>{lkr(sum('on_way', rows))}</span><small>{rows.reduce((a, r) => a + r.on_way_n, 0)} receipts not in BC yet</small></div>
        <div><small>Disputed</small><span>{lkr(sum('disputed', rows))}</span><small>{(() => { const n = rows.filter((r) => r.disputes_n > 0).length; return `${n} customer${n === 1 ? '' : 's'}`; })()}</small></div>
        <div className={actionsDue ? 'fu-due' : ''}><small>Next action due</small><span>{actionsDue}</span><small>{brokenN} with a broken promise</small></div>
      </div>

      {tie && (
        <p className="fu-tie muted small">
          Ties to <Link to={`/aging?asAt=${data.as_at}`}>Customer aging</Link> as at {dmy(data.as_at)}: overdue LKR {lkr(tie.aging.overdue)} = {lkr(tie.listed.overdue)} on this list
          {!zero(tie.retail.overdue) && <> + {lkr(tie.retail.overdue)} retail customers under {data.settings.retail_overdue_days} days ({tie.retail.customers})</>}
          {!zero(tie.no_group.overdue) && <> + {lkr(tie.no_group.overdue)} needing a posting group ({tie.no_group.customers})</>}.
        </p>
      )}
      {data.no_group?.length > 0 && (
        <details className="notice fu-nogroup">
          <summary><strong>{data.no_group.length} customer{data.no_group.length === 1 ? ' has' : 's have'} no posting group in BC</strong> and {data.no_group.length === 1 ? 'is' : 'are'} kept off the list. Give {data.no_group.length === 1 ? 'it' : 'them'} one in BC and upload the customer list again.</summary>
          <ul>{data.no_group.map((c) => <li key={c.customer_no}><Link to={`/customer/${encodeURIComponent(c.customer_no)}`}>{c.name}</Link> <span className="muted small">{c.customer_no}{c.in_list ? '' : ' · not in the customer list'} · overdue {lkr(c.overdue)}</span></li>)}</ul>
        </details>
      )}

      <div className="filters">
        <input className="search" type="search" placeholder="Search customer name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
        <select value={seg} onChange={(e) => setSeg(e.target.value)} aria-label="Segment">
          <option value="">HORECA and Local</option><option value="HORECA">HORECA</option><option value="Local">Local</option>
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">Every owner</option>
          <option value="none">Unassigned ({unassigned})</option>
          {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        {data.can.admin && unassigned > 0 && <Link className="small" to="/followup/owners?show=unowned">Assign owners</Link>}
      </div>
      <div className="chips" role="group" aria-label="Show">
        {QUICK.map((x) => {
          const n = x.test ? rows.filter((r) => x.test(r, t)).length : rows.length;
          return <button key={x.key} type="button" className={quick === x.key ? 'chip on' : 'chip'} aria-pressed={quick === x.key} onClick={() => setQuick(x.key)}>{x.label} <span className="count">{n}</span></button>;
        })}
      </div>

      {shown.length === 0 ? <div className="empty"><p>{rows.length ? 'No customer matches.' : 'No local customer has an overdue balance.'}</p></div> : (
        <div className="table-wrap fu-wrap">
          <table className="table fu-table">
            <thead><tr>
              <th>Customer</th><th className="num">Overdue</th><th className="num">On its way</th><th className="num">Net to chase</th>
              <th>Last contact</th><th>Promise</th><th>Next action</th>
            </tr></thead>
            <tbody>{shown.map((r) => {
              const href = `/customer/${encodeURIComponent(r.customer_no)}#follow-up`;
              const late = r.next_action_on && r.next_action_on < t;
              const ps = r.promise ? PROMISE[r.promise.status] : null;
              const isOpen = open.has(r.customer_no);
              return (
                <Fragment key={r.customer_no}>
                <tr className={`click${isOpen ? ' fu-open' : ''}`} onClick={(e) => { if (!e.target.closest('a,button,textarea,input,select,label,form')) nav(href); }}>
                  <td data-label="Customer">
                    <Link to={href} className="fu-name">{r.name}</Link>
                    <div className="muted small">{r.customer_no} · {r.seg}{r.terms ? ` · ${r.terms}` : ''} · {r.owner ?? <em>Unassigned</em>}</div>
                    <div className="fu-flags">
                      {!r.terms && <span className="pill warn" title="No payment terms in BC: everything is overdue from the invoice date">No terms</span>}
                      {r.in_credit && <span className="pill warn" title="Unapplied payments and credit notes are more than the invoices: finance to check">In credit</span>}
                      {r.over_limit && <span className="pill bad">Over limit</span>}
                      {r.broken_60 > 0 && <span className="pill bad">{r.broken_60} broken</span>}
                      {r.disputes_n > 0 && <span className="pill warn">Disputed {lkr(r.disputed)}</span>}
                    </div>
                    <div className="fu-rownote">
                      <NoteEditor customerNo={r.customer_no} note={r.note} canWrite={data.can.write} onSaved={(n) => setRow(r.customer_no, { note: n })} />
                      <button type="button" className="link small fu-inv-toggle" aria-expanded={isOpen} onClick={() => flipOpen(r.customer_no)}>
                        {isOpen ? 'Hide invoices' : `Invoices (${r.n_open})`}{r.inv_notes > 0 ? ` · ${r.inv_notes} note${r.inv_notes === 1 ? '' : 's'}` : ''}
                      </button>
                    </div>
                  </td>
                  <td data-label="Overdue" className="num"><OverdueCell r={r} /></td>
                  <td data-label="On its way" className="num">{zero(r.on_way) ? <span className="muted">–</span> : <Link to={href}>{lkr(r.on_way)}</Link>}
                    {r.on_way_n > 0 && <div className="muted small">{r.on_way_n} receipt{r.on_way_n === 1 ? '' : 's'}</div>}</td>
                  <td data-label="Net to chase" className="num"><strong className={zero(r.net) ? 'muted' : 'num-strong'}>{lkr(r.net)}</strong></td>
                  <td data-label="Last contact">{r.last_contact ? <>{dmy(r.last_contact.at)}<div className="muted small">{channelLabel(r.last_contact.channel)}, {outcomeLabel(r.last_contact.outcome).toLowerCase()} · {r.last_contact.by}</div></>
                    : <span className="muted">Never</span>}</td>
                  <td data-label="Promise">{r.promise ? <><span className={`pill ${ps.tone}`}>{ps.label}</span><div className="small">{lkr(r.promise.amount)} by {dmy(r.promise.promised_on)}</div></> : <span className="muted">–</span>}</td>
                  <td data-label="Next action" className={late ? 'fu-late' : ''}>{r.next_action_on ? <>{dmy(r.next_action_on)}{late && <div className="small">{daysBetween(r.next_action_on, t)} days late</div>}{r.next_action_on === t && <div className="small">Today</div>}</> : <span className="muted">–</span>}</td>
                </tr>
                {isOpen && (
                  <tr className="fu-expand">
                    <td colSpan="7" className="fu-expand-cell" aria-label={`${r.name}: invoices and notes`}>
                      <InvoiceNotes customerNo={r.customer_no} onChange={(n) => setRow(r.customer_no, { inv_notes: n })} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}</tbody>
            <tfoot><tr>
              <td>Total ({shown.length}{shown.length !== rows.length ? ` of ${rows.length}` : ''})</td>
              <td className="num">{lkr(sum('overdue'))}</td><td className="num">{lkr(sum('on_way'))}</td><td className="num">{lkr(sum('net'))}</td><td colSpan="3" />
            </tr></tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
