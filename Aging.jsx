import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr, fmtDate, todayISO } from '../lib/format';
import { BUCKETS, OVERDUE, bucketLabel, docType, unpack, downloadAging } from '../lib/aging';
import LedgerStatus from '../components/LedgerStatus';
import NoteEditor from '../components/NoteEditor';
import InvoicePromise from '../components/InvoicePromise';
import HoverCard from '../components/HoverCard';
import PendingCard from '../components/PendingCard';
import { groupPending } from '../lib/pending';
import { ACTIVE, addDays, dmy } from '../lib/followup';

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
  const [terms, setTerms] = useState({});   // customer no. -> credit terms in the app
  useEffect(() => {
    rpc('cc_customer_terms', { p_customer_no: null })
      .then((t) => setTerms(Object.fromEntries((t?.terms ?? []).map((x) => [x.customer_no, x])))).catch(() => {});
  }, []);
  const termsOf = (r) => terms[r.customer_no]?.terms ?? r.terms;
  const [marks, setMarks] = useState({});   // customer no. -> its notes and promises by entry (null: follow-up not installed)
  const [pending, setPending] = useState(null);   // receipts in the app not in BC yet, by customer and invoice (null: not loaded)
  useEffect(() => {
    rpc('cc_ar_pending', { p_customer_no: null }).then((p) => setPending(groupPending(p?.items ?? []))).catch(() => {});
  }, []);
  const pendOf = (no) => pending?.byCust[no] ?? null;
  // invoices ticked on the open customer, to give them one promised date
  const [sel, setSel] = useState(() => new Set());
  const [bulkDate, setBulkDate] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState(null);
  function toggleOpen(no) { setOpen(open === no ? null : no); setSel(new Set()); setBulkMsg(null); }
  async function setPromised(no, e) {
    e.preventDefault(); setBulkBusy(true); setBulkMsg(null);
    try {
      const res = await rpc('cc_ar_promise_invoices', { p_customer_no: no, p_docs: [...sel], p_promised_on: bulkDate });
      setBulkMsg({ ...res, date: bulkDate });
      setSel(new Set());
      await loadMarks(no);
    } catch (x) { setBulkMsg({ error: x.message }); } finally { setBulkBusy(false); }
  }

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
  const byCustomer = useMemo(() => { const m = {}; for (const e of entries) (m[e.customer_no] ??= []).push(e); return m; }, [entries]);
  const groups = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.group).filter(Boolean))].sort(), [data]);
  const term = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) => (!term || r.name.toLowerCase().includes(term) || r.customer_no.toLowerCase().includes(term))
      && (!group || r.group === group)
      && (only === 'all' || (only === 'overdue' && overdue(r) > 0.004) || (only === 'over90' && Number(r.over90) > 0.004) || (only === 'credit' && Number(r.balance) < 0)
        || (only === 'pending' && Boolean(pending?.byCust[r.customer_no]))));
    const val = (r) => (sort.key === 'name' ? r.name.toLowerCase() : sort.key === 'overdue' ? overdue(r) : Number(r[sort.key] ?? 0));
    return [...list].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir || a.name.localeCompare(b.name));
  }, [data, term, group, only, sort, pending]);
  const nPending = useMemo(() => (data?.rows ?? []).filter((r) => pending?.byCust[r.customer_no]).length, [data, pending]);
  const total = (k) => shown.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const allTotal = (k) => (data?.rows ?? []).reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const by = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'name' ? 1 : -1 }));
  const arrow = (key) => (sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');

  async function excel() {
    setBusy(true);
    try {
      const names = Object.fromEntries(data.rows.map((r) => [r.customer_no, r.name]));
      const keep = new Set(shown.map((r) => r.customer_no));
      let all = null;
      try { all = await rpc('cc_ar_marks', { p_customer_no: null }); } catch { /* follow-up not installed: no notes or promises in the file */ }
      await downloadAging({ asAt, rows: shown.map((r) => ({ ...r, terms: termsOf(r) })), entries: entries.filter((e) => keep.has(e.customer_no)), names, marks: all, pending });
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
      <p className="lede">What each customer owes as at {fmtDate(asAt)}, by how long it has been due. Payments and credit notes not yet applied to an invoice are shown on their own.
        {Object.keys(terms).length > 0 && ' Where a customer has credit terms in the app, its invoices are due that many days after the invoice date; otherwise BC’s due date is used.'}
        {nPending > 0 && <> <span className="pending-dot" aria-hidden="true" /> marks receipts recorded in the app that aren’t in BC yet: point at it to see them.</>}</p>
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
              {[['all', 'All'], ['overdue', 'Overdue'], ['over90', 'Over 90 days'], ['credit', 'In credit'], ...(nPending ? [['pending', `In the app, not in BC (${nPending})`]] : [])].map(([k, l]) => (
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
                    <tr className={`click${open === r.customer_no ? ' on' : ''}${pendOf(r.customer_no) ? ' has-pending' : ''}`} onClick={() => toggleOpen(r.customer_no)}>
                      <td>
                        <button type="button" className="link row-toggle" aria-expanded={open === r.customer_no}>{r.name}</button>
                        <div className="muted small">{r.customer_no}{r.group ? ` · ${r.group}` : ''}{termsOf(r) ? ` · ${termsOf(r)}` : ''}{r.incomplete ? ' · history incomplete' : ''}</div>
                        {pendOf(r.customer_no) && (
                          <HoverCard className="pending-mark" card={<PendingCard receipts={pendOf(r.customer_no).list} />}>
                            <span className="pending-dot" aria-hidden="true" />In the app, not in BC: LKR {lkr(pendOf(r.customer_no).total)}
                            {pendOf(r.customer_no).n > 1 ? ` (${pendOf(r.customer_no).n})` : ''}
                          </HoverCard>
                        )}
                      </td>
                      {COLS.map((c) => <td key={c.key} className={`num${c.key === 'balance' ? ' strong' : ''}${Math.abs(Number(r[c.key])) < 0.005 ? ' zero' : ''}`}>{Math.abs(Number(r[c.key])) < 0.005 ? '–' : lkr(r[c.key])}</td>)}
                    </tr>
                    {open === r.customer_no && (() => {
                      const m = marks[r.customer_no];
                      const withMarks = m && !m.hidden;
                      const noteOf = (doc) => (withMarks ? m.notes.find((n) => n.doc_no === doc) ?? null : null);
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
                      <tr className="aging-detail"><td colSpan={COLS.length + 1}>
                        <div className="row between">
                          <strong>{r.open} open invoice{r.open === 1 ? '' : 's'}{r.oldest > 0 ? `, the oldest ${r.oldest} days overdue` : ''}</strong>
                          <Link to={`/customer/${encodeURIComponent(r.customer_no)}?to=${asAt}`}>Open the customer's ledger</Link>
                        </div>
                        {m?.hidden && <p className="muted small">Notes and promises on this customer are kept by {m.owner}.</p>}
                        {canTick && choices.length > 1 && picked.length === 0 && !bulkMsg && (
                          <p className="muted small aging-bulk-hint">Tick several invoices to give them one expected collection date.</p>
                        )}
                        {canTick && picked.length > 0 && (
                          <form className="aging-bulk" onSubmit={(e) => setPromised(r.customer_no, e)} aria-label="Set one promised date for the ticked invoices">
                            <strong>{picked.length} invoice{picked.length === 1 ? '' : 's'} ticked</strong>
                            <span className="muted">LKR {lkr(pickedTotal)}</span>
                            <label className="aging-bulk-date"><span className="small">Expected collection date</span>
                              <input type="date" min={m.today} max={addDays(m.today, 180)} value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} required
                                aria-label="Expected collection date for the ticked invoices" /></label>
                            <span className="muted small fu-dmy" aria-live="polite">{bulkDate ? dmy(bulkDate) : ''}</span>
                            <button className="btn small primary" type="submit" disabled={bulkBusy || !bulkDate}>{bulkBusy ? 'Saving…' : 'Set promised date'}</button>
                            <button className="link small" type="button" onClick={() => setSel(new Set())} disabled={bulkBusy}>Clear</button>
                            <span className="muted small">Each invoice is promised for what is open on it.</span>
                          </form>
                        )}
                        {bulkMsg && (
                          <div className={`aging-bulk-msg${bulkMsg.error ? ' error' : ''}`} role="status">
                            {bulkMsg.error ? bulkMsg.error : <>
                              {bulkMsg.set > 0 && <span>Promised by <strong>{dmy(bulkMsg.date)}</strong>: {bulkMsg.set} invoice{bulkMsg.set === 1 ? '' : 's'}. </span>}
                              {bulkMsg.unchanged > 0 && <span>{bulkMsg.unchanged} already promised by that date. </span>}
                              {bulkMsg.skipped?.length > 0 && <span>Not set:</span>}
                              {bulkMsg.skipped?.length > 0 && <ul>{bulkMsg.skipped.map((x) => <li key={x.doc_no}>{x.reason.includes(x.doc_no) ? x.reason : <><strong>{x.doc_no}</strong>: {x.reason}</>}</li>)}</ul>}
                            </>}
                            <button type="button" className="link small" onClick={() => setBulkMsg(null)}>Dismiss</button>
                          </div>
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
                                <td>{Number(e.remaining) < 0 ? <span className="muted">Unapplied credit</span> : e.late > 0 ? `${e.late} days overdue` : 'Not due'}
                                  {Number(e.remaining) > 0 && <div className="muted small">{bucketLabel(e.late)}{(() => {
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
                                        canWrite={m.can.write} today={m.today} onChanged={() => loadMarks(r.customer_no)} />
                                    : <span className="muted">–</span>}</td>
                                  <td className="aging-note"><NoteEditor customerNo={r.customer_no} docNo={e.document_no} note={noteOf(e.document_no)}
                                    canWrite={m.can.write} onSaved={() => loadMarks(r.customer_no)} /></td>
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
                </tr></tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
