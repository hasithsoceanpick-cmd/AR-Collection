import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr, fmtDate, todayISO } from '../lib/format';
import { BASIS, OVERDUE, bucketLabel, postBucketLabel, daysFrom, withPostingAge, docType, unpack, downloadAging } from '../lib/aging';
import LedgerStatus from '../components/LedgerStatus';
import NotesList from '../components/NotesList';
import BulkPromise from '../components/BulkPromise';
import InvoicePromise from '../components/InvoicePromise';
import HoverCard from '../components/HoverCard';
import PendingCard from '../components/PendingCard';
import { groupPending } from '../lib/pending';
import { ACTIVE, dmy, daysBetween, PAY_METHODS, payMethodLabel } from '../lib/followup';

// past their due date, whichever way the page is aged
const overdue = (r) => OVERDUE.reduce((a, k) => a + Number(r[k] ?? 0), 0);

// Customer aging as at a date, by due date (Not due, 1–30, 31–60, 61–90, Over 90 days)
// or by posting date (0–30, 31–60, 61–90, 91–120, Over 120 days since the invoice was posted).
export default function Aging() {
  const [params, setParams] = useSearchParams();
  const asAt = params.get('asAt') || todayISO();
  const basis = params.get('by') === 'posting' ? 'posting' : 'due';
  const B = BASIS[basis];
  const COLS = [...B.buckets, { key: 'credits', label: 'Unapplied credits' }, { key: 'balance', label: 'Balance' }];
  const go = (at, by) => setParams({ asAt: at, ...(by === 'posting' ? { by } : {}) }, { replace: true });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [only, setOnly] = useState('all');
  const [sort, setSort] = useState({ key: 'balance', dir: -1 });
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState({});   // customer no. -> credit terms in the app
  const [termsOk, setTermsOk] = useState(false);   // credit terms are installed and readable
  useEffect(() => {
    rpc('cc_customer_terms', { p_customer_no: null })
      .then((t) => { setTerms(Object.fromEntries((t?.terms ?? []).map((x) => [x.customer_no, x]))); setTermsOk(true); }).catch(() => {});
  }, []);
  // no credit period: no terms in the app, or terms without days (e.g. bill to bill)
  const noPeriod = (r) => termsOk && terms[r.customer_no]?.min_days == null;
  const termsOf = (r) => terms[r.customer_no]?.terms ?? r.terms;
  const [marks, setMarks] = useState({});   // customer no. -> its notes and promises by entry (null: follow-up not installed)
  const [pending, setPending] = useState(null);   // receipts in the app not in BC yet, by customer and invoice (null: not loaded)
  useEffect(() => {
    rpc('cc_ar_pending', { p_customer_no: null }).then((p) => setPending(groupPending(p?.items ?? []))).catch(() => {});
  }, []);
  const pendOf = (no) => pending?.byCust[no] ?? null;
  // invoices ticked on the open customer, to give them one promised date
  const [sel, setSel] = useState(() => new Set());
  function toggleOpen(no) { setOpen(open === no ? null : no); setSel(new Set()); }
  // per customer: last payment, average days to pay, average balance, promises still expected, open notes, payment method
  const [stats, setStats] = useState(null);   // customer no. -> figures (null: not installed or not loaded)
  const [statsCan, setStatsCan] = useState({});
  const [method, setMethod] = useState('');
  const loadStats = useCallback(async () => {
    try {
      const s = await rpc('cc_ar_customer_stats', { p_as_at: asAt });
      setStats(Object.fromEntries((s?.rows ?? []).map((x) => [x.customer_no, x]))); setStatsCan(s?.can ?? {});
    } catch { setStats(null); }
  }, [asAt]);
  useEffect(() => { loadStats(); }, [loadStats]);
  const stOf = (no) => stats?.[no] ?? null;
  const sinceLast = (no) => (stOf(no)?.last_pay ? daysBetween(stOf(no).last_pay.on, asAt) : null);

  const loadMarks = useCallback(async (no) => {
    try { const m = await rpc('cc_ar_marks', { p_customer_no: no }); setMarks((s) => ({ ...s, [no]: m })); }
    catch { setMarks((s) => ({ ...s, [no]: null })); }
  }, []);
  useEffect(() => { if (open && !(open in marks)) loadMarks(open); }, [open, marks, loadMarks]);


  useEffect(() => {
    let live = true;
    setData(null); setError('');
    rpc('cc_aging', { p_as_at: asAt }).then((d) => { if (live) setData(d); }).catch((e) => { if (live) { setError(e.message); setData({ rows: [], entries: [], entry_fields: [] }); } });
    return () => { live = false; };
  }, [asAt]);

  const entries = useMemo(() => (data ? unpack(data.entry_fields, data.entries) : []), [data]);
  const rows = useMemo(() => (!data ? [] : basis === 'posting' ? withPostingAge(data.rows, entries, data.as_at ?? asAt) : data.rows), [data, entries, basis, asAt]);
  const byCustomer = useMemo(() => { const m = {}; for (const e of entries) (m[e.customer_no] ??= []).push(e); return m; }, [entries]);
  const groups = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.group).filter(Boolean))].sort(), [data]);
  const term = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const old90 = (r) => B.old90.reduce((a, k) => a + Number(r[k] ?? 0), 0);
    const list = rows.filter((r) => (!term || r.name.toLowerCase().includes(term) || r.customer_no.toLowerCase().includes(term))
      && (!group || r.group === group)
      && (!method || (method === 'none' ? !stOf(r.customer_no)?.pay_method : stOf(r.customer_no)?.pay_method === method))
      && (only === 'all' || (only === 'overdue' && overdue(r) > 0.004) || (only === 'over90' && old90(r) > 0.004) || (only === 'credit' && Number(r.balance) < 0)
        || (only === 'pending' && Boolean(pending?.byCust[r.customer_no])) || (only === 'noterms' && noPeriod(r))
        || (only === 'staff' && stOf(r.customer_no)?.is_staff)));
    // never paid sorts as the longest wait; no average sorts below every customer that has one
    const val = (r) => {
      if (sort.key === 'name') return r.name.toLowerCase();
      if (sort.key === 'overdue') return overdue(r);
      if (sort.key === 'last_pay') return sinceLast(r.customer_no) ?? 1e9;
      if (sort.key === 'avg_days') return stOf(r.customer_no)?.avg_days ?? -1;
      if (sort.key === 'avg_balance') return Number(stOf(r.customer_no)?.avg_balance ?? -1e15);
      return Number(r[sort.key] ?? 0);
    };
    return [...list].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir || a.name.localeCompare(b.name));
  }, [rows, term, group, only, sort, pending, B, terms, termsOk, stats, method]);   // eslint-disable-line react-hooks/exhaustive-deps
  const nStaff = useMemo(() => rows.filter((r) => stOf(r.customer_no)?.is_staff).length, [rows, stats]);   // eslint-disable-line react-hooks/exhaustive-deps
  const promisedShown = shown.reduce((a, r) => a + Number(stOf(r.customer_no)?.promised_open ?? 0), 0);
  const promisedN = shown.reduce((a, r) => a + Number(stOf(r.customer_no)?.promised_n ?? 0), 0);
  const XCOLS = stats ? [{ key: 'last_pay', label: 'Last payment' }, { key: 'avg_days', label: 'Avg days to pay' }, { key: 'avg_balance', label: 'Avg balance owed' }] : [];
  const nPending = useMemo(() => rows.filter((r) => pending?.byCust[r.customer_no]).length, [rows, pending]);
  const nNoPeriod = useMemo(() => rows.filter(noPeriod).length, [rows, terms, termsOk]);   // eslint-disable-line react-hooks/exhaustive-deps
  const total = (k) => shown.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const allTotal = (k) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const by = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'name' ? 1 : -1 }));
  const arrow = (key) => (sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');

  async function excel() {
    setBusy(true);
    try {
      const names = Object.fromEntries(data.rows.map((r) => [r.customer_no, r.name]));
      const keep = new Set(shown.map((r) => r.customer_no));
      let all = null;
      try { all = await rpc('cc_ar_marks', { p_customer_no: null }); } catch { /* follow-up not installed: no notes or promises in the file */ }
      await downloadAging({ asAt, rows: shown.map((r) => ({ ...r, terms: termsOf(r) })), entries: entries.filter((e) => keep.has(e.customer_no)), names, marks: all, pending, basis, stats });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const positive = B.buckets.reduce((a, b) => a + Math.max(0, allTotal(b.key)), 0);
  function changeBasis(by) {
    // a sort on a bucket of the other basis goes back to the balance
    if (!['name', 'balance', 'credits', 'overdue', 'last_pay', 'avg_days', 'avg_balance'].includes(sort.key)) setSort({ key: 'balance', dir: -1 });
    if (only === 'over90') setOnly('all');
    go(asAt, by);
  }
  return (
    <section className="wide aging-page">
      <div className="page-head">
        <h1>Customer aging</h1>
        <div className="row">
          <label className="field inline"><span className="flabel">As at</span>
            <input type="date" value={asAt} max={todayISO()} onChange={(e) => e.target.value && go(e.target.value, basis)} /></label>
          <label className="field inline"><span className="flabel">Age by</span>
            <select value={basis} onChange={(e) => changeBasis(e.target.value)} aria-label="Age by">
              <option value="due">Due date</option>
              <option value="posting">Posting date</option>
            </select></label>
          <button type="button" className="btn" disabled={!data || !shown.length || busy} onClick={excel}>{busy ? 'Preparing…' : 'Download Excel'}</button>
        </div>
      </div>
      <p className="lede">{basis === 'posting'
        ? <>What each customer owes as at {fmtDate(asAt)}, by how long ago each invoice was posted, whatever its credit terms. Overdue still means past the due date.</>
        : <>What each customer owes as at {fmtDate(asAt)}, by how long it has been due.</>}
        {' '}Payments and credit notes not yet applied to an invoice are shown on their own.
        {basis === 'due' && Object.keys(terms).length > 0 && ' Where a customer has credit terms in the app, its invoices are due that many days after the invoice date; otherwise BC’s due date is used.'}
        {nPending > 0 && <> <span className="pending-dot" aria-hidden="true" /> marks receipts recorded in the app that aren’t in BC yet: point at it to see them.</>}</p>
      {error && <p className="error">{error}</p>}
      <LedgerStatus status={data?.status} />
      {data === null ? <p className="muted">Loading…</p> : (
        <>
          <div className="kpis aging-kpis">
            <div><small>Balance</small><span>{lkr(allTotal('balance'))}</span><small>{data.rows.length} customers</small></div>
            {B.buckets.map((b) => (
              <div key={b.key} className={`b-${b.tone ?? b.key}`}><small>{b.label}{basis === 'posting' ? ' old' : ''}</small><span>{lkr(allTotal(b.key))}</span>
                <small>{positive > 0 ? `${Math.round((Math.max(0, allTotal(b.key)) / positive) * 100)}% of what is owed` : '—'}</small></div>
            ))}
            <div><small>Unapplied credits</small><span>{lkr(allTotal('credits'))}</span><small>payments not set against an invoice</small></div>
          </div>
          {positive > 0 && (
            <div className="aging-bar" role="img" aria-label="Share of what is owed in each bucket">
              {B.buckets.map((b) => { const v = Math.max(0, allTotal(b.key)); return v > 0 ? <i key={b.key} className={`b-${b.tone ?? b.key}`} style={{ flexGrow: v }} title={`${b.label}: LKR ${lkr(v)}`} /> : null; })}
            </div>
          )}
          <div className="filters">
            <input className="search" type="search" placeholder="Search customer name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
            {groups.length > 1 && (
              <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Customer group">
                <option value="">All groups</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            {stats && (
              <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">
                <option value="">Every payment method</option>
                {PAY_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                <option value="none">Not set</option>
              </select>
            )}
            <div className="tabs" role="tablist" aria-label="Show">
              {[['all', 'All'], ['overdue', 'Overdue'], ['over90', basis === 'posting' ? 'Over 90 days old' : 'Over 90 days'], ['credit', 'In credit'],
                ...(nPending ? [['pending', `In the app, not in BC (${nPending})`]] : []), ...(termsOk ? [['noterms', `No credit period (${nNoPeriod})`]] : []),
                ...(statsCan.profile && nStaff ? [['staff', `Staff (${nStaff})`]] : [])].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={only === k} className={`tab${only === k ? ' on' : ''}`} onClick={() => setOnly(k)}>{l}</button>
              ))}
            </div>
          </div>
          {only === 'noterms' && (
            <p className="hint aging-noterms">Customers owing money with no credit period in the app: no terms, or terms without days such as bill to bill. Their invoices age by BC’s due dates.
              {' '}Set terms on the customer’s page, or see <Link to="/customer-list?show=noterms">every customer without a credit period</Link> and download the list to fill in and upload.</p>
          )}
          {shown.length === 0 ? <div className="empty"><p>{data.rows.length ? 'No customer matches.' : `Nothing owed as at ${fmtDate(asAt)}.`}</p></div> : (
            <div className="table-wrap">
              <table className="table aging-table">
                <thead><tr>
                  <th><button type="button" className="th-sort" onClick={() => by('name')}>Customer{arrow('name')}</button></th>
                  {COLS.map((c) => <th key={c.key} className="num"><button type="button" className="th-sort" onClick={() => by(c.key)}>{c.label}{arrow(c.key)}</button></th>)}
                  {XCOLS.map((c) => <th key={c.key} className={`num aging-x${c.key === 'last_pay' ? ' first' : ''}`}><button type="button" className="th-sort" onClick={() => by(c.key)}>{c.label}{arrow(c.key)}</button></th>)}
                </tr></thead>
                <tbody>{shown.map((r) => (
                  <Fragment key={r.customer_no}>
                    <tr className={`click${open === r.customer_no ? ' on' : ''}${pendOf(r.customer_no) ? ' has-pending' : ''}`}
                      onClick={(e) => { if (!e.target.closest('a,button,input,textarea,select,label,form,.ap-notes')) toggleOpen(r.customer_no); }}>
                      <td>
                        <button type="button" className="link row-toggle" aria-expanded={open === r.customer_no} onClick={() => toggleOpen(r.customer_no)}>{r.name}</button>
                        <div className="muted small">{r.customer_no}{r.group ? ` · ${r.group}` : ''}{termsOf(r) ? ` · ${termsOf(r)}` : ''}{r.incomplete ? ' · history incomplete' : ''}</div>
                        {stOf(r.customer_no) && (stOf(r.customer_no).pay_method || stOf(r.customer_no).is_staff || Number(stOf(r.customer_no).promised_open) > 0) && (
                          <div className="aging-tags">
                            {stOf(r.customer_no).is_staff && <span className="pill staff">Staff</span>}
                            {stOf(r.customer_no).pay_method && <span className="pill method">{payMethodLabel(stOf(r.customer_no).pay_method)}</span>}
                            {Number(stOf(r.customer_no).promised_open) > 0 && <span className="pill muted">Promised {lkr(stOf(r.customer_no).promised_open)}{stOf(r.customer_no).promised_n > 1 ? ` (${stOf(r.customer_no).promised_n})` : ''}</span>}
                          </div>
                        )}
                        {stOf(r.customer_no) && (stOf(r.customer_no).notes.length > 0 || stOf(r.customer_no).can_note) && (
                          <div className="aging-rownotes">
                            <NotesList customerNo={r.customer_no} notes={stOf(r.customer_no).notes} canWrite={stOf(r.customer_no).can_note} compact onChanged={loadStats} />
                          </div>
                        )}
                        {pendOf(r.customer_no) && (
                          <HoverCard className="pending-mark" card={<PendingCard receipts={pendOf(r.customer_no).list} />}>
                            <span className="pending-dot" aria-hidden="true" />In the app, not in BC: LKR {lkr(pendOf(r.customer_no).total)}
                            {pendOf(r.customer_no).n > 1 ? ` (${pendOf(r.customer_no).n})` : ''}
                          </HoverCard>
                        )}
                      </td>
                      {COLS.map((c) => <td key={c.key} className={`num${c.key === 'balance' ? ' strong' : ''}${Math.abs(Number(r[c.key])) < 0.005 ? ' zero' : ''}`}>{Math.abs(Number(r[c.key])) < 0.005 ? '–' : lkr(r[c.key])}</td>)}
                      {stats && (() => {
                        const x = stOf(r.customer_no);
                        const since = sinceLast(r.customer_no);
                        return <>
                          <td className="num aging-x first">{x?.last_pay
                            ? <>{dmy(x.last_pay.on)}<div className={`small${since > 60 ? ' aging-stale' : ' muted'}`}>{since === 0 ? 'today' : `${since} day${since === 1 ? '' : 's'} ago`}</div>
                                {x.last_pay.src === 'app' && <div className="small pending-sub" title={`${x.last_pay.ref}: recorded in the app, not in BC yet`}>in the app</div>}</>
                            : <span className="aging-stale small">No payment on record</span>}</td>
                          <td className="num aging-x">{x?.avg_days != null ? <>{x.avg_days} days<div className="muted small">{x.avg_days_n} invoice{x.avg_days_n === 1 ? '' : 's'}</div></> : <span className="muted">–</span>}</td>
                          <td className="num aging-x">{x?.avg_balance != null ? lkr(x.avg_balance) : <span className="muted">–</span>}</td>
                        </>;
                      })()}
                    </tr>
                    {open === r.customer_no && (() => {
                      const m = marks[r.customer_no];
                      const withMarks = m && !m.hidden;
                      const notesOf = (doc) => (withMarks ? m.notes.filter((n) => n.doc_no === doc) : []);
                      const promiseOf = (doc) => (withMarks ? m.promises.find((x) => x.doc_no === doc) ?? null : null);
                      const list = byCustomer[r.customer_no] ?? [];
                      const canTick = withMarks && m.can.write;
                      // an invoice inside a promise covering several invoices is changed on the follow-up, not here
                      const pickable = (e) => Number(e.remaining) > 0 && !(promiseOf(e.document_no)?.n_invoices > 1 && ACTIVE.includes(promiseOf(e.document_no)?.status));
                      const choices = canTick ? list.filter(pickable).map((e) => e.document_no) : [];
                      const picked = choices.filter((d) => sel.has(d));
                      const pickedTotal = list.filter((e) => sel.has(e.document_no)).reduce((t, e) => t + Number(e.remaining), 0);
                      const flip = (doc) => setSel((x) => { const y = new Set(x); if (y.has(doc)) y.delete(doc); else y.add(doc); return y; });
                      const pend = (doc) => pending?.byDoc[`${r.customer_no}|${doc}`] ?? null;
                      return (
                      <tr className="aging-detail"><td colSpan={COLS.length + XCOLS.length + 1}>
                        <div className="row between">
                          <strong>{r.open} open invoice{r.open === 1 ? '' : 's'}{basis === 'posting'
                            ? (r.age_oldest != null ? `, the oldest posted ${r.age_oldest} days ago` : '')
                            : (r.oldest > 0 ? `, the oldest ${r.oldest} days overdue` : '')}</strong>
                          <Link to={`/customer/${encodeURIComponent(r.customer_no)}?to=${asAt}`}>Open the customer's ledger</Link>
                        </div>
                        {m?.hidden && <p className="muted small">Notes and promises on this customer are kept by {m.owner}.</p>}
                        {canTick && (
                          <BulkPromise key={r.customer_no} customerNo={r.customer_no} picked={picked} pickedTotal={pickedTotal} choices={choices.length}
                            today={m.today} onClear={() => setSel(new Set())} onSaved={async () => { await loadMarks(r.customer_no); await loadStats(); }} />
                        )}
                        <div className="table-wrap flat">
                          <table className="table">
                            <thead><tr>
                              {canTick && <th className="aging-sel">{choices.length > 0 && (
                                <input type="checkbox" aria-label="Tick all open invoices" checked={picked.length > 0 && picked.length === choices.length}
                                  ref={(el) => { if (el) el.indeterminate = picked.length > 0 && picked.length < choices.length; }}
                                  onChange={() => setSel(picked.length === choices.length ? new Set() : new Set(choices))} />)}</th>}
                              <th>Document</th><th>Posted</th><th>Due</th><th>Age</th><th className="num">Original</th><th className="num">Open</th>
                              {withMarks && <><th className="aging-promise">Promised</th><th className="aging-note">Note</th></>}</tr></thead>
                            <tbody>{list.map((e) => {
                              const pd = pend(e.document_no);
                              const inApp = pd ? pd.reduce((t, x) => t + Number(x.applied ?? 0), 0) : 0;
                              return (
                              <tr key={`${e.document_no}-${e.posting_date}-${e.remaining}`} className={`${pd ? 'has-pending' : ''}${sel.has(e.document_no) ? ' ticked' : ''}`}>
                                {canTick && <td className="aging-sel">{pickable(e) && (
                                  <input type="checkbox" checked={sel.has(e.document_no)} onChange={() => flip(e.document_no)} aria-label={`Tick ${e.document_no}`} />)}</td>}
                                <td>{e.document_no}<div className="muted small">{docType(e.document_type, e.original)}{e.description ? ` · ${e.description}` : ''}</div></td>
                                <td>{fmtDate(e.posting_date)}</td>
                                <td>{fmtDate(e.due_date)}</td>
                                <td>{Number(e.remaining) < 0 ? <span className="muted">Unapplied credit</span>
                                  : basis === 'posting' ? `${daysFrom(e.posting_date, asAt)} days old` : e.late > 0 ? `${e.late} days overdue` : 'Not due'}
                                  {Number(e.remaining) > 0 && <div className="muted small">{basis === 'posting'
                                    ? `${postBucketLabel(daysFrom(e.posting_date, asAt))} · ${e.late > 0 ? `${e.late} days overdue` : 'not due'}`
                                    : bucketLabel(e.late)}{(() => {
                                    const t = terms[r.customer_no];
                                    if (!t || !(t.max_days > t.min_days) || e.late <= 0) return '';
                                    const past = e.late > t.max_days - t.min_days;
                                    return past ? ` · past ${t.max_days} days` : ` · within ${t.min_days}–${t.max_days} days`;
                                  })()}</div>}</td>
                                <td className="num">{lkr(e.original)}</td>
                                <td className="num strong">{pd ? (
                                  <HoverCard className="pending-amt" card={<PendingCard receipts={pd} docNo={e.document_no} />}
                                    label={`${lkr(e.remaining)} open on ${e.document_no}. In the app, not in BC yet: LKR ${lkr(Math.abs(inApp))} in ${pd.length} receipt${pd.length === 1 ? '' : 's'}`}>
                                    <span className="pending-amt-v"><span className="pending-dot" aria-hidden="true" />{lkr(e.remaining)}</span>
                                    <span className="pending-sub small">{inApp < 0 ? 'credit used in the app' : `LKR ${lkr(inApp)} in the app`}</span>
                                  </HoverCard>) : lkr(e.remaining)}</td>
                                {withMarks && <>
                                  <td className="aging-promise">{Number(e.remaining) > 0
                                    ? <InvoicePromise customerNo={r.customer_no} docNo={e.document_no} open={e.remaining} promise={promiseOf(e.document_no)}
                                        canWrite={m.can.write} today={m.today} onChanged={async () => { await loadMarks(r.customer_no); await loadStats(); }} />
                                    : <span className="muted">–</span>}</td>
                                  <td className="aging-note"><NotesList customerNo={r.customer_no} docNo={e.document_no} notes={notesOf(e.document_no)}
                                    canWrite={m.can.write} compact onChanged={() => loadMarks(r.customer_no)} /></td>
                                </>}
                              </tr>
                              );
                            })}</tbody>
                          </table>
                        </div>
                        {(() => {
                          const loose = (pendOf(r.customer_no)?.list ?? []).filter((x) => !x.docs.length);
                          return loose.length > 0 && (
                            <p className="small aging-loose"><span className="pending-dot" aria-hidden="true" />
                              {loose.length === 1 ? 'A receipt' : `${loose.length} receipts`} in the app with no invoice given: LKR {lkr(loose.reduce((t, x) => t + Number(x.amount), 0))}.{' '}
                              <HoverCard className="link small" card={<PendingCard receipts={loose} />}>See {loose.length === 1 ? 'it' : 'them'}</HoverCard></p>
                          );
                        })()}
                      </td></tr>
                      );
                    })()}
                  </Fragment>
                ))}</tbody>
                <tfoot><tr>
                  <td>Total{shown.length !== data.rows.length ? ` (${shown.length} of ${data.rows.length})` : ` (${shown.length})`}</td>
                  {COLS.map((c) => <td key={c.key} className="num">{lkr(total(c.key))}</td>)}
                  {stats && <><td className="aging-x first" /><td className="aging-x" /><td className="num aging-x">{lkr(shown.reduce((a, r) => a + Number(stOf(r.customer_no)?.avg_balance ?? 0), 0))}</td></>}
                </tr>
                {stats && (
                  <tr className="aging-promised-total">
                    <td colSpan={COLS.length + XCOLS.length + 1}>Promised collections still expected (open, due today, late in grace):{' '}
                      <strong>LKR {lkr(promisedShown)}</strong> in {promisedN} promise{promisedN === 1 ? '' : 's'}</td>
                  </tr>
                )}</tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
