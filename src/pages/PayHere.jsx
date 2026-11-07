import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { lkr, fmtDate, fmtDateTime } from '../lib/format';
import { readPayHere } from '../lib/payhere';
import ReopenDoc from '../components/ReopenDoc';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const n = (x) => Number(x ?? 0);
const same = (a, b) => Math.abs(n(a) - n(b)) < 0.005;
const day = (ts) => (ts ? String(ts).slice(0, 10) : null);

// Where a payout stands, for its stamp.
export function payoutState(o) {
  const pays = o.payments ?? [];
  const open = pays.filter((p) => !p.customer_no).length;
  const unconf = pays.filter((p) => p.customer_no && !p.confirmed).length;
  if (o.post_status === 'posted') return { label: 'Posted in BC', tone: 'green' };
  if (o.post_status === 'posted_diff') return { label: 'BC differs', tone: 'red' };
  if (o.doc_no) return { label: 'Exported to BC', tone: 'blue' };
  if (open) return { label: `${open} to match`, tone: 'amber' };
  if (unconf) return { label: `${unconf} to confirm`, tone: 'amber' };
  if (o.amount != null && !same(o.amount, o.payments_net)) return { label: 'Payments missing', tone: 'red' };
  if (!o.line_id) return { label: 'No Sampath credit yet', tone: 'amber' };
  return { label: 'Ready for BC', tone: 'teal' };
}

// How a payment was matched, in words.
function howText(p) {
  const inv = p.invoice;
  const amountOff = inv && !same(inv.free, p.gross);
  if (p.match_how === 'order') return `Order no. ${p.order_id} is on the invoice${amountOff ? `, but LKR ${lkr(inv.free)} is open on it` : ''}`;
  if (p.match_how === 'name') return 'Same name and amount (no order no. on the invoice)';
  if (p.match_how === 'finance') return p.document_no ? `Picked by ${p.confirmed_by ?? 'finance'}` : `On the customer, unapplied (${p.confirmed_by ?? 'finance'})`;
  return '';
}

// ---------------------------------------------------------------------------
// Finance picks the invoice (or only the customer) a payment is for.
function MatchPicker({ p, onDone, onCancel }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [pick, setPick] = useState(p.document_no ? `${p.customer_no}|${p.document_no}` : p.customer_no ? `${p.customer_no}|` : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      rpc('cc_payhere_candidates', { p_payment_id: p.id, p_q: q.trim() || null })
        .then((d) => { if (live) { setData(d); setError(''); } }).catch((e) => live && setError(e.message));
    }, q ? 350 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [p.id, q]);
  const save = async (cust, doc) => {
    setBusy(true); setError('');
    try { await rpc('cc_payhere_set_match', { p_payment_id: p.id, p_customer_no: cust, p_document_no: doc }); onDone(); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  const [pc, pd] = pick.split('|');
  const invoices = data?.invoices ?? [];
  const customers = (data?.customers ?? []).filter((c) => !invoices.some((i) => i.customer_no === c.customer_no && pick === `${c.customer_no}|`));
  return (
    <div className="ph-pick">
      <p className="hint">{p.customer_name} paid LKR {lkr(p.gross)} for order {p.order_id ?? '—'} on {fmtDate(day(p.paid_at))}. Open invoices with the order number or the same amount come first; search for others.</p>
      <input type="search" placeholder="Search customer, invoice or external document no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search invoices" />
      {error && <p className="error">{error}</p>}
      {data === null ? <p className="muted">Looking for invoices…</p> : (
        <div className="linepicker">
          {invoices.length === 0 ? <p className="muted">No open invoice fits. Search for the customer, or put the payment on the customer unapplied.</p> : (
            <ul>
              {invoices.map((i) => {
                const k = `${i.customer_no}|${i.document_no}`;
                const off = Boolean(i.taken_by) || n(i.free) <= 0.004;
                return (
                  <li key={k} className={pick === k ? 'on' : ''}>
                    <label>
                      <input type="radio" name={`ph${p.id}`} checked={pick === k} disabled={off} onChange={() => setPick(k)} />
                      <span className="lp-main">
                        <span className="lp-narr">{i.document_no} · {i.customer_name} <span className="muted">({i.customer_no})</span></span>
                        <span className="lp-meta">
                          <span>{fmtDate(i.posting_date)}</span>
                          {i.external_document_no && <span>Ext. {i.external_document_no}</span>}
                          {i.by_order && <span className="lp-exact">Order {p.order_id}</span>}
                          {i.by_name && <span className="lp-exact">Same name</span>}
                          {i.same_amount && <span className="lp-exact">Same amount</span>}
                          {i.taken_by && <span className="lp-close">On PayHere payment {i.taken_by}</span>}
                          {!i.taken_by && n(i.free) <= 0.004 && <span className="lp-close">Covered by other receipts</span>}
                          {!i.taken_by && n(i.free) > 0.004 && !same(i.free, i.remaining_amount) && <span className="lp-close">LKR {lkr(i.free)} free</span>}
                        </span>
                      </span>
                      <span className="num lp-amt">{lkr(i.remaining_amount)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {customers.length > 0 && (
            <>
              <p className="hint">No invoice for it? Put it on the customer, unapplied (Export to BC asks before exporting it):</p>
              <ul>
                {customers.map((c) => {
                  const k = `${c.customer_no}|`;
                  return (
                    <li key={k} className={pick === k ? 'on' : ''}>
                      <label>
                        <input type="radio" name={`ph${p.id}`} checked={pick === k} onChange={() => setPick(k)} />
                        <span className="lp-main"><span className="lp-narr">{c.name} <span className="muted">({c.customer_no})</span></span>
                          <span className="lp-meta"><span>No invoice: unapplied on the customer</span></span></span>
                        <span />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
      <div className="row">
        <button className="btn small primary" disabled={busy || !pick} onClick={() => save(pc, pd || null)}>{pd ? `Match to ${pd}` : 'Put on the customer'}</button>
        {p.customer_no && <button className="btn small ghost" disabled={busy} onClick={() => save(null, null)}>Clear the match</button>}
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// One payment's row: who paid, and which invoice it settles.
function PaymentRow({ p, locked, fin, onChanged }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    setBusy(true); setError('');
    try { await rpc('cc_payhere_confirm', { p_payment_ids: [p.id] }); await onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const status = p.status !== 'Paid out' ? <span className="lp-close">{p.status ?? 'No status'}</span> : null;
  let match;
  if (!p.customer_no) match = <span className="error small">No invoice matched</span>;
  else {
    match = (
      <>
        <strong>{p.document_no ?? 'Unapplied'}</strong> · {p.account_name ?? p.customer_no} <span className="muted small">({p.customer_no})</span>
        <div className={`small ${p.confirmed ? 'muted' : 'warn-text'}`}>{p.confirmed ? '' : 'Suggested: '}{howText(p)}</div>
      </>
    );
  }
  return (
    <>
      <tr className={!p.customer_no || !p.confirmed ? 'row-open' : ''}>
        <td className="hide-sm">{fmtDateTime(p.paid_at)}<div className="muted small">{p.method}</div></td>
        <td>{p.customer_name}<div className="muted small"><span className="show-sm">{fmtDate(day(p.paid_at))} · </span>Order {p.order_id ?? '—'} · {p.payment_no} {status}</div></td>
        <td className="num">{lkr(p.gross)}</td>
        <td className="num hide-sm">{lkr(p.fee)}</td>
        <td className="num hide-sm">{lkr(p.net)}</td>
        <td>
          {match}
          {fin && !locked && !picking && (
            <div className="row ph-acts">
              {p.customer_no && !p.confirmed && <button className="btn small primary" disabled={busy} onClick={confirm}>Confirm</button>}
              <button className={p.customer_no ? 'link small' : 'btn small'} onClick={() => setPicking(true)}>{p.customer_no ? 'Change' : 'Pick the invoice'}</button>
            </div>
          )}
          {error && <p className="error small">{error}</p>}
        </td>
      </tr>
      {picking && (
        <tr className="sub-row"><td colSpan={6}>
          <MatchPicker p={p} onCancel={() => setPicking(false)} onDone={async () => { setPicking(false); await onChanged(); }} />
        </td></tr>
      )}
    </>
  );
}

function PaymentsTable({ payments, locked, fin, onChanged, foot }) {
  return (
    <div className="table-wrap flat">
      <table className="table ph-table">
        <thead><tr><th className="hide-sm">Paid</th><th>Customer (PayHere)</th><th className="num">Amount</th><th className="num hide-sm">Fee</th><th className="num hide-sm">Net</th><th>Invoice</th></tr></thead>
        <tbody>{payments.map((p) => <PaymentRow key={p.id} p={p} locked={locked} fin={fin} onChanged={onChanged} />)}</tbody>
        {foot}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One payout: its payments, its Sampath credit, and where it is with BC.
function PayoutCard({ o, open, onToggle, lines, onChanged, focus }) {
  const { role } = useAuth();
  const fin = role === 'finance';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [linking, setLinking] = useState(false);
  const [lineId, setLineId] = useState(null);
  const el = useRef(null);
  useEffect(() => { if (focus) el.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [focus]);
  const locked = Boolean(o.doc_no);
  const pays = o.payments ?? [];
  const unconf = pays.filter((p) => p.customer_no && !p.confirmed);
  const missing = o.amount != null && !same(o.amount, o.payments_net);
  const st = payoutState(o);
  const offered = lines.filter((l) => same(l.credit, o.net) || (l.payhere && o.bank_ref && l.narration?.replace(/\D/g, '').includes(o.bank_ref.replace(/\D/g, ''))));
  const others = lines.filter((l) => l.payhere && !offered.includes(l));

  async function act(fn) {
    setBusy(true); setError('');
    try { await fn(); setLinking(false); setLineId(null); await onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const lineRow = (l) => (
    <li key={l.id} className={lineId === l.id ? 'on' : ''}>
      <label>
        <input type="radio" name={`po${o.id}`} checked={lineId === l.id} onChange={() => setLineId(l.id)} />
        <span className="lp-main"><span className="lp-narr">{l.narration}</span>
          <span className="lp-meta"><span>{fmtDate(l.txn_date)}</span>{l.reference && <span>{l.reference}</span>}{same(l.credit, o.net) && <span className="lp-exact">Same amount</span>}</span></span>
        <span className="num lp-amt">{lkr(l.credit)}</span>
      </label>
    </li>
  );

  return (
    <div className={`facts mbatch${focus ? ' focus' : ''}`} ref={el} id={`po${o.id}`}>
      <button type="button" className="mb-head" onClick={onToggle} aria-expanded={open}>
        <span className="mb-no">Payout {o.payout_no}</span>
        <span className="mb-date">{fmtDate(o.payout_date)}</span>
        <span className="mb-meta">{plural(pays.length, 'payment')}{o.doc_no ? ` · ${o.doc_no}` : ''}</span>
        <span className="mb-amt">LKR {lkr(o.gross)}<span className="mb-net"> · net {lkr(o.net)}</span></span>
        <span className={`stamp tone-${st.tone}`}>{st.label}</span>
      </button>
      {open && (
        <div className="mb-body">
          <dl className="mb-facts">
            <dt>Customers paid</dt><dd>LKR {lkr(o.gross)}</dd>
            <dt>PayHere fee</dt><dd>LKR {lkr(o.fee)} <span className="muted small">to G/L 204003</span></dd>
            <dt>Paid into Sampath</dt><dd>{o.line ? <>LKR {lkr(o.line.credit)} on {fmtDate(o.line.txn_date)} · <span className="mono">{o.line.narration}</span></>
              : <span className="warn-text">No Sampath credit of LKR {lkr(o.net)} paired yet{o.bank_ref ? ` (PayHere ref ${o.bank_ref})` : ''}</span>}</dd>
            {missing && <><dt>Payments</dt><dd className="error">PayHere paid out LKR {lkr(o.amount)}, the payments in the app add up to LKR {lkr(o.payments_net)}: upload a Payments export that covers this payout.</dd></>}
            <dt>Business Central</dt><dd>{o.doc_no ? <>{o.doc_no}: {o.post_status === 'posted' ? 'posted' : o.post_status === 'posted_diff' ? 'posted with differences (see BC check)' : `exported ${o.export_count}×, not confirmed yet`}
              {o.post_status !== 'exported' && <div><ReopenDoc docNo={o.doc_no} onDone={onChanged} /></div>}</>
              : st.label === 'Ready for BC' ? <Link to="/bc-export">Ready: Export to BC</Link> : <span className="muted">Not exported</span>}</dd>
          </dl>
          {error && <p className="error">{error}</p>}
          {fin && !locked && unconf.length > 1 && (
            <p className="row"><button className="btn small primary" disabled={busy} onClick={() => act(() => rpc('cc_payhere_confirm', { p_payment_ids: unconf.map((p) => p.id) }))}>
              Confirm the {unconf.length} suggestions</button><span className="hint">Check each name and invoice first.</span></p>
          )}
          <PaymentsTable payments={pays} locked={locked} fin={fin} onChanged={onChanged}
            foot={<tfoot><tr><td className="hide-sm" /><td>Payout total</td><td className="num">{lkr(o.gross)}</td><td className="num hide-sm">{lkr(o.fee)}</td><td className="num hide-sm">{lkr(o.payments_net)}</td><td /></tr></tfoot>} />
          {fin && !locked && (
            <div className="mb-link">
              {o.line_id ? (
                <button className="btn small ghost" disabled={busy} onClick={() => act(() => rpc('cc_payhere_link_line', { p_payout_id: o.id, p_line_id: null }))}>Unpair the Sampath credit</button>
              ) : linking ? (
                <>
                  {offered.length + others.length === 0 ? <p className="muted">No Sampath credit of LKR {lkr(o.net)} or from PayHere waiting to be paired. Upload the latest Sampath statement on the Bank page.</p> : (
                    <div className="linepicker">
                      {offered.length > 0 && <><p className="hint">Sampath credits of LKR {lkr(o.net)} or with this payout's reference:</p><ul>{offered.map(lineRow)}</ul></>}
                      {others.length > 0 && <><p className="hint">Other PayHere credits not paired yet:</p><ul>{others.map(lineRow)}</ul></>}
                    </div>
                  )}
                  <div className="row">
                    <button className="btn small primary" disabled={busy || !lineId} onClick={() => act(() => rpc('cc_payhere_link_line', { p_payout_id: o.id, p_line_id: lineId }))}>Pair</button>
                    <button className="link" onClick={() => setLinking(false)}>Cancel</button>
                  </div>
                </>
              ) : <button className="btn small" onClick={() => setLinking(true)}>Pair with a Sampath credit</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finance uploads one or both exports; a preview first, then the upload.
function Upload({ onDone }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const input = useRef(null);
  async function choose(list) {
    setError(''); setResult(null);
    const read = [];
    for (const f of list) {
      try { read.push({ name: f.name, ...(await readPayHere(f)) }); } catch (e) { setError(e.message); }
    }
    read.sort((a, b) => (a.kind === 'payments' ? 0 : 1) - (b.kind === 'payments' ? 0 : 1));
    setFiles(read);
  }
  async function upload() {
    setBusy(true); setError('');
    const out = [];
    try {
      for (const f of files) out.push({ name: f.name, kind: f.kind, ...(await rpc('cc_payhere_import', { p_kind: f.kind, p_file: f.name, p_rows: f.rows })) });
      setResult(out); setFiles([]); if (input.current) input.current.value = '';
      await onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="facts ph-upload">
      <h2>Upload from PayHere</h2>
      <p className="hint">In the PayHere portal, export <strong>Payments</strong> (and <strong>Payouts</strong> if you like) as Excel and choose the file(s) here. Uploading the same payments again is fine: only what changed is taken.</p>
      <input ref={input} type="file" multiple accept=".xlsx,.xls,.csv" onChange={(e) => choose([...e.target.files])} aria-label="PayHere export files" />
      {error && <p className="error">{error}</p>}
      {files.map((f) => (
        <div key={f.name} className="ph-preview">
          <strong>{f.name}</strong>: PayHere {f.kind === 'payments' ? 'Payments' : 'Payouts'} export,{' '}
          {f.kind === 'payments'
            ? <>{plural(f.summary.count, 'payment')} from {fmtDate(f.summary.from)} to {fmtDate(f.summary.to)} in {plural(f.summary.payouts, 'payout')}: LKR {lkr(f.summary.gross)}, fee {lkr(f.summary.fee)}, net {lkr(f.summary.net)}
              <span className="muted"> ({Object.entries(f.summary.status).map(([k, v]) => `${v} ${k}`).join(', ')})</span></>
            : <>{plural(f.summary.count, 'payout')} from {fmtDate(f.summary.from)} to {fmtDate(f.summary.to)}, LKR {lkr(f.summary.net)}</>}
          {f.problems.length > 0 && <div className="warn-text small">{f.problems.join('; ')}</div>}
        </div>
      ))}
      {files.length > 0 && <div className="row"><button className="btn primary" disabled={busy} onClick={upload}>{busy ? 'Uploading…' : `Upload ${files.length === 1 ? 'it' : `the ${files.length} files`}`}</button>
        <button className="link" onClick={() => { setFiles([]); if (input.current) input.current.value = ''; }}>Cancel</button></div>}
      {result && (
        <div className="ok-box ph-result">
          {result.map((r) => (
            <p key={r.name}><strong>{r.name}</strong>: {r.kind === 'payments' ? plural(r.new, 'new payment') : plural(r.new, 'new payout')}
              {r.updated > 0 && `, ${r.updated} updated`}{r.unchanged > 0 && `, ${r.unchanged} already in`}{r.exported > 0 && `, ${r.exported} already exported to BC (left as they were)`}
              {r.before_start > 0 && `, ${r.before_start} paid out before ${fmtDate(r.start_date)} left out (posted by hand)`}
              {r.unreadable > 0 && `, ${r.unreadable} unreadable`}.
              {(r.matched > 0 || r.linked > 0) && <> The app matched {plural(r.matched, 'payment')} to invoices and paired {plural(r.linked, 'payout')} with Sampath credits.</>}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function PayHerePage() {
  const { role } = useAuth();
  const fin = role === 'finance';
  const [params] = useSearchParams();
  const focusId = Number(params.get('payout')) || null;
  const [data, setData] = useState(null);
  const [tab, setTab] = useState(null);
  const [openIds, setOpenIds] = useState(() => new Set(focusId ? [focusId] : []));
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    try {
      if (refresh && fin) await rpc('cc_payhere_refresh');
      setData(await rpc('cc_payhere_list'));
    } catch (e) { setError(e.message); setData((d) => d ?? { payouts: [], not_paid_out: [], lines: [] }); }
  }, [fin]);
  useEffect(() => { load(true); }, [load]);

  if (data === null) return <p className="muted">Loading…</p>;
  const payouts = data.payouts ?? [];
  const waiting = data.not_paid_out ?? [];
  const lines = data.lines ?? [];
  const unpaired = lines.filter((l) => l.payhere);
  const unfinished = payouts.filter((o) => o.post_status !== 'posted');
  const all = payouts.flatMap((o) => (o.doc_no ? [] : o.payments ?? []));
  const toMatch = all.filter((p) => !p.customer_no).length + waiting.filter((p) => !p.customer_no).length;
  const toConfirm = all.filter((p) => p.customer_no && !p.confirmed).length + waiting.filter((p) => p.customer_no && !p.confirmed).length;
  const ready = payouts.filter((o) => payoutState(o).label === 'Ready for BC');
  const focusPosted = focusId && payouts.find((o) => o.id === focusId)?.post_status === 'posted';
  const active = tab ?? (focusPosted ? 'all' : 'open');
  const toggle = (id) => setOpenIds((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const list = active === 'open' ? unfinished : payouts;
  const tabs = [
    { key: 'open', label: 'To finish', n: unfinished.length },
    { key: 'all', label: 'All payouts', n: payouts.length },
    { key: 'waiting', label: 'Not paid out yet', n: waiting.length },
    { key: 'lines', label: 'Sampath credits not paired', n: unpaired.length },
  ];

  return (
    <section className="wide">
      <div className="page-head">
        <h1>PayHere</h1>
        {fin && <div className="row"><button className="btn primary" onClick={() => setShowUpload((v) => !v)}>{showUpload ? 'Close upload' : 'Upload PayHere export'}</button></div>}
      </div>
      <p className="lede">Card payments on roundisland.lk go through PayHere, which pays them into Sampath 590 in payouts, after its fee. The app matches each payment
        to its WEB invoice by the order number and amount (or suggests the open invoice of the same amount in the payer's name, for you to confirm) and pairs each payout
        with its Sampath credit. A payout goes to Export to BC as one BAKRC: each customer at the full amount applied to the invoice, the fee to G/L 204003,
        Sampath 590 as balancing account, Comment = the Sampath description. Payouts from {fmtDate(data.settings?.start_date)} onwards.</p>
      {error && <p className="error">{error}</p>}
      {!data.account && <p className="error">No bank account in the app has BC code {data.settings?.bank_code}: set it on the Bank page so payouts can be paired with Sampath credits.</p>}
      {data.last_upload && <p className="muted small">Last upload: {data.last_upload.file_name} ({data.last_upload.kind}), {fmtDateTime(data.last_upload.done_at)} by {data.last_upload.done_by}</p>}
      {fin && (showUpload || payouts.length === 0) && <Upload onDone={() => { setShowUpload(true); return load(false); }} />}

      <div className="kpis">
        <div><span>{toMatch}</span>payments with no invoice<small>pick the invoice</small></div>
        <div><span>{toConfirm}</span>suggestions to confirm<small>same name and amount</small></div>
        <div><span>{ready.length}</span>payouts ready for BC<small>LKR {lkr(ready.reduce((a, o) => a + n(o.net), 0))}{ready.length > 0 && fin ? <> · <Link to="/bc-export">Export</Link></> : ''}</small></div>
        <div><span>{unpaired.length}</span>PayHere credits not paired<small>LKR {lkr(unpaired.reduce((a, l) => a + n(l.credit), 0))}</small></div>
      </div>

      <div className="tabs report-tabs" role="tablist">
        {tabs.map((t) => <button key={t.key} role="tab" aria-selected={active === t.key} className={active === t.key ? 'tab on' : 'tab'} onClick={() => setTab(t.key)}>{t.label} <span className="count">{t.n}</span></button>)}
      </div>

      {(active === 'open' || active === 'all') && (
        <div className="mbatches">
          {list.length === 0 && <div className="empty"><p>{active === 'open' ? (payouts.length ? 'Every payout is posted in BC.' : 'No PayHere payouts yet: upload the Payments export.') : 'No PayHere payouts yet.'}</p></div>}
          {list.map((o) => <PayoutCard key={o.id} o={o} open={openIds.has(o.id)} onToggle={() => toggle(o.id)} lines={lines} onChanged={() => load(false)} focus={o.id === focusId} />)}
        </div>
      )}

      {active === 'waiting' && (
        <div className="facts">
          <h2>Payments PayHere hasn't paid out yet</h2>
          <p className="hint">Authorized payments wait for their payout (usually within a week). You can match them now; they reach Export to BC with their payout.</p>
          {waiting.length === 0 ? <p className="muted">None.</p> : <PaymentsTable payments={waiting} locked={false} fin={fin} onChanged={() => load(false)} />}
        </div>
      )}

      {active === 'lines' && (
        <div className="facts">
          <h2>PayHere credits on Sampath not paired with a payout</h2>
          <p className="hint">Each pairs itself once the Payments export with its payout is uploaded (same PayHere reference, or the same amount within 4 days of the payout).
            If one doesn't, open its payout and pair it by hand.</p>
          {unpaired.length === 0 ? <p className="muted">None.</p> : (
            <div className="table-wrap flat"><table className="table">
              <thead><tr><th>Date</th><th>Narration</th><th className="num">LKR</th></tr></thead>
              <tbody>{unpaired.map((l) => <Fragment key={l.id}><tr><td>{fmtDate(l.txn_date)}</td><td className="narr">{l.narration}</td><td className="num">{lkr(l.credit)}</td></tr></Fragment>)}</tbody>
            </table></div>
          )}
        </div>
      )}
    </section>
  );
}
