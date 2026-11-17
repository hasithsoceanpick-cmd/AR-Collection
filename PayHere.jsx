import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { lkr, fmtDate, fmtDateTime } from '../lib/format';
import { readPayHere } from '../lib/payhere';
import ReopenDoc from '../components/ReopenDoc';
import { TAGS } from '../lib/workflow';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const n = (x) => Number(x ?? 0);
const same = (a, b) => Math.abs(n(a) - n(b)) < 0.005;
const day = (ts) => (ts ? String(ts).slice(0, 10) : null);
const r2 = (x) => Math.round(n(x) * 100) / 100;
// Said where it goes: one invoice, a customer, or a split (Oceanpick invoices / Round Island).
const isMatched = (p) => p.matched ?? Boolean(p.customer_no);

// Where a payout stands, for its stamp.
export function payoutState(o) {
  const pays = o.payments ?? [];
  const open = pays.filter((p) => !isMatched(p)).length;
  const unconf = pays.filter((p) => isMatched(p) && !p.confirmed).length;
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

// Where a payment goes: its split, or its one invoice / customer.
export function WhereItGoes({ p }) {
  const parts = p.parts ?? [];
  if (parts.length) return (
    <ul className="ph-parts">
      {parts.map((x) => (
        <li key={x.line_no}>
          <span>{x.kind === 'ri' ? <><strong>Round Island</strong> {x.ri_ref} <span className="muted small">(RI Current Account)</span></>
            : x.kind === 'unapplied' ? <>On {x.account_name ?? x.customer_no} <span className="muted small">({x.customer_no})</span>, unapplied</>
            : <><strong>{x.document_no}</strong> · {x.account_name ?? x.customer_no} <span className="muted small">({x.customer_no})</span></>}</span>
          <span className="num">{lkr(x.amount)}</span>
        </li>
      ))}
    </ul>
  );
  if (!p.customer_no) return <span className="error small">Not said yet</span>;
  return <><strong>{p.document_no ?? 'Unapplied'}</strong> · {p.account_name ?? p.customer_no} <span className="muted small">({p.customer_no})</span></>;
}

// Who said so, and whether finance has confirmed it.
function MatchNote({ p, sales = false }) {
  if ((p.parts ?? []).length) {
    const who = p.match_how === 'sales' ? `${p.settled_by ?? 'Sales'}${sales ? '' : ' (Sales)'}` : (p.settled_by ?? 'finance');
    return (
      <div className={`small ${p.confirmed || p.exported ? 'muted' : 'warn-text'}`}>
        {p.exported ? `Split by ${who} · in the BC journal`
          : p.confirmed ? `Split by ${who}${p.match_how === 'sales' && p.confirmed_by ? ` · confirmed by ${p.confirmed_by}` : ''}`
          : `Split by ${who} on ${fmtDate(day(p.settled_at))}: ${sales ? 'waiting for finance' : 'confirm it'}`}
        {p.settle_note && <div className="muted ph-note">“{p.settle_note}”</div>}
      </div>
    );
  }
  if (!p.customer_no) return null;
  if (sales) return <div className={`small ${p.confirmed ? 'muted' : 'warn-text'}`}>{p.exported ? 'In the BC journal · ' : ''}{p.confirmed ? '' : 'The app suggests: '}{howText(p)}</div>;
  return <div className={`small ${p.confirmed ? 'muted' : 'warn-text'}`}>{p.confirmed ? '' : 'Suggested: '}{howText(p)}</div>;
}

// ---------------------------------------------------------------------------
// Sales (or finance) say where a payment goes: Oceanpick invoices of a customer,
// the Round Island part (posted to the RI Current Account), and anything left on the customer.
function SettlePanel({ p, onDone, onCancel }) {
  const { role } = useAuth();
  const fin = role === 'finance';
  const parts = p.parts ?? [];
  const firstCust = parts.find((x) => x.customer_no) ?? (p.customer_no ? { customer_no: p.customer_no, account_name: p.account_name } : null);
  const [cust, setCust] = useState(firstCust ? { customer_no: firstCust.customer_no, name: firstCust.account_name ?? firstCust.customer_no } : null);
  const [picking, setPicking] = useState(!firstCust);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [amt, setAmt] = useState(() => {
    const m = {};
    for (const x of parts) if (x.kind === 'invoice') m[x.document_no] = String(x.amount);
    if (!parts.length && p.document_no) m[p.document_no] = String(r2(Math.min(n(p.gross), n(p.invoice?.free ?? p.gross))));
    return m;
  });
  const riParts = parts.filter((x) => x.kind === 'ri');
  const [ri, setRi] = useState(riParts.length ? String(r2(riParts.reduce((a, x) => a + n(x.amount), 0))) : '');
  const [riRef, setRiRef] = useState(riParts.map((x) => x.ri_ref).join('/'));
  const restPart = parts.find((x) => x.kind === 'unapplied');
  const [rest, setRest] = useState(restPart ? String(restPart.amount) : '');
  const [note, setNote] = useState(p.settle_note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!picking) return undefined;
    let live = true;
    const t = setTimeout(() => {
      rpc('cc_payhere_candidates', { p_payment_id: p.id, p_q: q.trim() || null })
        .then((d) => { if (live) { setFound(d); setError(''); } }).catch((e) => live && setError(e.message));
    }, q ? 350 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [p.id, q, picking]);
  const custNo = cust?.customer_no;
  useEffect(() => {
    if (!custNo) { setInvoices(null); return undefined; }
    let live = true;
    setInvoices(null);
    rpc('cc_payhere_invoices', { p_payment_id: p.id, p_customer_no: custNo })
      .then((d) => live && setInvoices(d ?? [])).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [p.id, custNo]);

  const invTotal = r2(Object.values(amt).reduce((a, v) => a + n(v), 0));
  const left = r2(n(p.gross) - invTotal - n(ri) - n(rest));
  const byDoc = new Map((invoices ?? []).map((i) => [i.document_no, i]));
  const gone = Object.keys(amt).filter((d) => invoices && !byDoc.has(d));
  const over = Object.entries(amt).filter(([d, v]) => byDoc.has(d) && n(v) > n(byDoc.get(d).free) + 0.004).map(([d]) => d);
  const zero = Object.values(amt).some((v) => n(v) <= 0);
  const needRef = n(ri) > 0 && !riRef.trim();
  const needCust = (invTotal > 0 || n(rest) > 0) && !cust;
  const canSave = !busy && Math.abs(left) < 0.005 && !needRef && !needCust && !zero && over.length === 0 && gone.length === 0 && n(ri) >= 0 && n(rest) >= 0;

  const opts = [];
  const seen = new Set();
  for (const i of found?.invoices ?? []) {
    if (seen.has(i.customer_no)) continue;
    seen.add(i.customer_no);
    opts.push({ customer_no: i.customer_no, name: i.customer_name,
      why: i.by_order ? `Order ${p.order_id} is on ${i.document_no}` : i.by_name ? 'Same name' : i.same_amount ? `${i.document_no} is LKR ${lkr(i.remaining_amount)}` : '' });
  }
  for (const c of found?.customers ?? []) if (!seen.has(c.customer_no)) { seen.add(c.customer_no); opts.push({ ...c, why: 'Same name' }); }

  const pickCust = (c) => { setCust({ customer_no: c.customer_no, name: c.name }); setPicking(false); setQ(''); if (c.customer_no !== custNo) { setAmt({}); setRest(''); } };
  const toggle = (i) => setAmt((m) => {
    const x = { ...m };
    if (i.document_no in x) delete x[i.document_no];
    else x[i.document_no] = String(r2(Math.max(0, Math.min(n(i.free), left))));
    return x;
  });
  const allToRi = () => { setAmt({}); setRest(''); setRi(String(n(p.gross))); };

  async function save() {
    setBusy(true); setError('');
    const order = (invoices ?? []).map((i) => i.document_no).filter((d) => d in amt);
    const out = [
      ...order.map((d) => ({ kind: 'invoice', customer_no: custNo, document_no: d, amount: r2(amt[d]) })),
      ...(n(ri) > 0 ? [{ kind: 'ri', ri_ref: riRef.trim(), amount: r2(ri) }] : []),
      ...(n(rest) > 0 ? [{ kind: 'unapplied', customer_no: custNo, amount: r2(rest) }] : []),
    ];
    try { await rpc('cc_payhere_settle', { p_payment_id: p.id, p_parts: out, p_note: note.trim() || null }); await onDone(); }
    catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="ph-settle">
      <p className="hint">{p.customer_name} paid <strong>LKR {lkr(p.gross)}</strong> for order {p.order_id ?? '—'} on {fmtDate(day(p.paid_at))}.
        Say what is for Oceanpick (the customer&apos;s invoices) and what is for Round Island. The parts must add up to the payment.</p>

      <div className="ph-block">
        <h4>Oceanpick</h4>
        {cust && !picking ? (
          <p className="row ph-cust"><span>Customer: <strong>{cust.name}</strong> <span className="muted">({cust.customer_no})</span></span>
            <button type="button" className="link small" onClick={() => setPicking(true)}>Change customer</button>
            {invTotal === 0 && n(rest) === 0 && <button type="button" className="link small" onClick={() => { setCust(null); setPicking(true); }}>No Oceanpick invoice</button>}</p>
        ) : (
          <div className="ph-pick">
            <input type="search" placeholder="Search customer name or no., invoice or external document no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
            {found === null ? <p className="muted small">Looking for customers…</p> : opts.length === 0 ? <p className="muted small">No customer found{q ? '' : ': search for one'}. If it is all for Round Island, leave this.</p> : (
              <ul className="ph-custs">
                {opts.slice(0, 12).map((c) => (
                  <li key={c.customer_no}><button type="button" className="btn small ghost" onClick={() => pickCust(c)}>
                    <strong>{c.name}</strong> <span className="muted">({c.customer_no})</span>{c.why && <span className="lp-exact"> · {c.why}</span>}</button></li>
                ))}
              </ul>
            )}
            {cust && <button type="button" className="link small" onClick={() => setPicking(false)}>Keep {cust.name}</button>}
          </div>
        )}
        {cust && !picking && (invoices === null ? <p className="muted small">Loading invoices…</p> : invoices.length === 0 && gone.length === 0 ? (
          <p className="muted small">No open invoices for {cust.name} in the latest customer ledger upload.</p>
        ) : (
          <ul className="checklist ph-invs">
            {invoices.map((i) => {
              const on = i.document_no in amt;
              const full = n(i.free) <= 0.004;
              return (
                <li key={i.document_no} className={on ? 'on' : ''}>
                  <div className="ph-invrow"><label>
                    <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(i)} />
                    <span className="lp-main">
                      <span className="lp-narr"><strong>{i.document_no}</strong> · LKR {lkr(i.remaining_amount)} open</span>
                      <span className="lp-meta">
                        <span>{fmtDate(i.posting_date)}</span>
                        {i.external_document_no && <span>Ext. {i.external_document_no}</span>}
                        {i.by_order && <span className="lp-exact">Order {p.order_id}</span>}
                        {i.taken_by && <span className="lp-close">On PayHere payment {i.taken_by}</span>}
                        {full ? <span className="lp-close">Covered by other receipts</span> : !same(i.free, i.remaining_amount) && <span className="lp-close">LKR {lkr(i.free)} free</span>}
                      </span>
                    </span>
                  </label>
                  {on && <input className="ph-amt" type="number" inputMode="decimal" step="0.01" min="0" value={amt[i.document_no]} aria-label={`Amount for ${i.document_no}`}
                    onChange={(e) => setAmt((m) => ({ ...m, [i.document_no]: e.target.value }))} />}</div>
                  {on && over.includes(i.document_no) && <p className="error small ph-inline">Only LKR {lkr(i.free)} is free on {i.document_no}.</p>}
                </li>
              );
            })}
            {gone.map((d) => (
              <li key={d} className="on"><div className="ph-invrow"><label>
                <input type="checkbox" checked onChange={() => setAmt((m) => { const x = { ...m }; delete x[d]; return x; })} />
                <span className="lp-main"><span className="lp-narr"><strong>{d}</strong></span><span className="lp-meta"><span className="lp-close">Not open any more: untick it</span></span></span>
              </label><span className="num lp-amt">{lkr(amt[d])}</span></div></li>
            ))}
          </ul>
        ))}
        {cust && !picking && (
          <div className="row ph-line">
            <label className="field inline"><span>Left on {cust.name}, unapplied</span>
              <input className="ph-amt" type="number" inputMode="decimal" step="0.01" min="0" value={rest} onChange={(e) => setRest(e.target.value)} /></label>
            {left > 0.004 && <button type="button" className="link small" onClick={() => setRest(String(r2(n(rest) + left)))}>Rest on the customer</button>}
          </div>
        )}
      </div>

      <div className="ph-block">
        <h4>Round Island</h4>
        <div className="row ph-line">
          <label className="field inline"><span>Amount</span>
            <input className="ph-amt" type="number" inputMode="decimal" step="0.01" min="0" value={ri} onChange={(e) => setRi(e.target.value)} aria-label="Round Island amount" /></label>
          <label className="field inline"><span>RI invoice no.</span>
            <input className="ph-ref" value={riRef} onChange={(e) => setRiRef(e.target.value)} placeholder="RI-01511" aria-label="Round Island invoice no." /></label>
          {left > 0.004 && <button type="button" className="link small" onClick={() => setRi(String(r2(n(ri) + left)))}>Rest to Round Island</button>}
        </div>
        <p className="hint small">Exported to BC to the RI Current Account (G/L 102030), not to a customer.</p>
        {needRef && <p className="error small">Give the Round Island invoice no.</p>}
      </div>

      <p className="ph-sum">
        <span>Oceanpick <strong>{lkr(invTotal + n(rest))}</strong></span>
        <span>Round Island <strong>{lkr(n(ri))}</strong></span>
        <span className={Math.abs(left) < 0.005 ? 'ok-text' : 'error'}>{Math.abs(left) < 0.005 ? `Adds up to LKR ${lkr(p.gross)}` : left > 0 ? `LKR ${lkr(left)} still to place` : `LKR ${lkr(-left)} too much`}</span>
      </p>
      <label className="field"><span className="flabel">{fin ? 'Note' : 'Note for finance'} <span className="muted small">(optional)</span></span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="E.g. 2 Round Island items on this order" /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" className="btn small primary" disabled={!canSave} onClick={save}>{busy ? 'Saving…' : fin ? 'Save' : 'Send to finance'}</button>
        {!same(ri, p.gross) && <button type="button" className="btn small ghost" disabled={busy} onClick={allToRi}>All to Round Island</button>}
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finance picks the invoice (or only the customer) a payment is for.
function MatchPicker({ p, onDone, onCancel }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const split = (p.parts ?? []).length > 0;
  const [pick, setPick] = useState(split ? '' : p.document_no ? `${p.customer_no}|${p.document_no}` : p.customer_no ? `${p.customer_no}|` : '');
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
      <p className="hint">{p.customer_name} paid LKR {lkr(p.gross)} for order {p.order_id ?? '—'} on {fmtDate(day(p.paid_at))}. Open invoices with the order number or the same amount come first; search for others.{split ? ' Picking one replaces the split.' : ''}</p>
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
        {isMatched(p) && <button className="btn small ghost" disabled={busy} onClick={() => save(null, null)}>{split ? 'Clear the split' : 'Clear the match'}</button>}
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// One payment's row: who paid, and where it goes (an invoice, or Oceanpick invoices and Round Island).
function PaymentRow({ p, locked, fin, onChanged }) {
  const [mode, setMode] = useState(null);   // 'pick' (one invoice) | 'split'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matched = isMatched(p);
  const confirm = async () => {
    setBusy(true); setError('');
    try { await rpc('cc_payhere_confirm', { p_payment_ids: [p.id] }); await onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const status = p.status !== 'Paid out' ? <span className="lp-close">{p.status ?? 'No status'}</span> : null;
  const done = async () => { setMode(null); await onChanged(); };
  return (
    <>
      <tr className={!matched || !p.confirmed ? 'row-open' : ''}>
        <td className="hide-sm">{fmtDateTime(p.paid_at)}<div className="muted small">{p.method}</div></td>
        <td>{p.customer_name}<div className="muted small"><span className="show-sm">{fmtDate(day(p.paid_at))} · </span>Order {p.order_id ?? '—'} · {p.payment_no} {status}</div></td>
        <td className="num">{lkr(p.gross)}</td>
        <td className="num hide-sm">{lkr(p.fee)}</td>
        <td className="num hide-sm">{lkr(p.net)}</td>
        <td>
          {matched ? <><WhereItGoes p={p} /><MatchNote p={p} /></> : <span className="error small">Nothing said yet: no invoice matched</span>}
          {fin && !locked && !mode && (
            <div className="row ph-acts">
              {matched && !p.confirmed && <button className="btn small primary" disabled={busy} onClick={confirm}>Confirm</button>}
              <button className={matched ? 'link small' : 'btn small'} onClick={() => setMode('pick')}>{matched ? 'Change' : 'Pick the invoice'}</button>
              <button className="link small" onClick={() => setMode('split')}>{(p.parts ?? []).length ? 'Change the split' : 'Split with Round Island'}</button>
            </div>
          )}
          {error && <p className="error small">{error}</p>}
        </td>
      </tr>
      {mode && (
        <tr className="sub-row"><td colSpan={6}>
          {mode === 'pick'
            ? <MatchPicker p={p} onCancel={() => setMode(null)} onDone={done} />
            : <SettlePanel p={p} onCancel={() => setMode(null)} onDone={done} />}
        </td></tr>
      )}
    </>
  );
}

function PaymentsTable({ payments, locked, fin, onChanged, foot }) {
  return (
    <div className="table-wrap flat">
      <table className="table ph-table">
        <thead><tr><th className="hide-sm">Paid</th><th>Customer (PayHere)</th><th className="num">Amount</th><th className="num hide-sm">Fee</th><th className="num hide-sm">Net</th><th>Where it goes</th></tr></thead>
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
  const unconf = pays.filter((p) => isMatched(p) && !p.confirmed);
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
          <span className="lp-meta"><span>{fmtDate(l.txn_date)}</span>{l.reference && <span>{l.reference}</span>}{same(l.credit, o.net) && <span className="lp-exact">Same amount</span>}
            {l.tag && <span className="lp-close">Tagged {TAGS[l.tag] ?? l.tag}{l.tag_note ? ` (${l.tag_note})` : ''}{l.tagged_by ? ` by ${l.tagged_by}` : ''}: pairing takes the tag off</span>}</span></span>
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
              Confirm all {unconf.length}</button><span className="hint">Check each name, invoice and Round Island part first.</span></p>
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
// Sales: the web payments, and where each one goes.
function SalesRow({ p, open, onToggle, onChanged }) {
  const todo = !p.exported && !p.confirmed && !p.settled_at;
  return (
    <>
      <tr className={todo ? 'row-open' : ''}>
        <td className="hide-sm">{fmtDateTime(p.paid_at)}<div className="muted small">{p.method}</div></td>
        <td>{p.customer_name}<div className="muted small"><span className="show-sm">{fmtDate(day(p.paid_at))} · </span>Order {p.order_id ?? '—'} · {p.payment_no}
          {p.status !== 'Paid out' && <> · <span className="lp-close">{p.status === 'Authorized' ? 'not paid out yet' : p.status}</span></>}</div>
          {p.email && <div className="muted small hide-sm">{p.email}</div>}</td>
        <td className="num">{lkr(p.gross)}</td>
        <td>
          <WhereItGoes p={p} /><MatchNote p={p} sales />
          {!p.exported && !open && (
            <div className="row ph-acts">
              <button className={todo ? 'btn small primary' : 'link small'} onClick={onToggle}>
                {(p.parts ?? []).length ? 'Change' : isMatched(p) ? 'Check or split' : 'Say where it goes'}</button>
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="sub-row"><td colSpan={4}>
          <SettlePanel p={p} onCancel={onToggle} onDone={async () => { onToggle(); await onChanged(); }} />
        </td></tr>
      )}
    </>
  );
}

function SalesView() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData(await rpc('cc_payhere_sales_list')); setError(''); }
    catch (e) { setError(e.message); setData((d) => d ?? { payments: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (data === null) return <p className="muted">Loading…</p>;
  const pays = data.payments ?? [];
  const todo = pays.filter((p) => !p.exported && !p.confirmed && !p.settled_at);
  const sent = pays.filter((p) => !p.exported && !p.confirmed && p.settled_at);
  const done = pays.filter((p) => p.exported || p.confirmed);
  const active = tab ?? (todo.length || !sent.length ? 'todo' : 'sent');
  const list = { todo, sent, done }[active];
  const tabs = [
    { key: 'todo', label: 'To settle', n: todo.length },
    { key: 'sent', label: 'With finance', n: sent.length },
    { key: 'done', label: 'Confirmed', n: done.length },
  ];
  return (
    <section className="wide">
      <div className="page-head"><h1>PayHere web payments</h1></div>
      <p className="lede">Card payments on roundisland.lk. For each one, say which Oceanpick invoice it pays and how much of it is for Round Island, with the RI invoice no.
        Finance confirms it and exports it to BC: the Oceanpick part to the customer&apos;s invoice, the Round Island part to the RI Current Account (G/L {data.settings?.ri_gl ?? '102030'}).</p>
      {error && <p className="error">{error}</p>}
      {data.last_upload && <p className="muted small">PayHere export last uploaded by finance {fmtDateTime(data.last_upload.done_at)}.</p>}
      <div className="tabs report-tabs" role="tablist">
        {tabs.map((t) => <button key={t.key} role="tab" aria-selected={active === t.key} className={active === t.key ? 'tab on' : 'tab'} onClick={() => setTab(t.key)}>{t.label} <span className="count">{t.n}</span></button>)}
      </div>
      {list.length === 0 ? (
        <div className="empty"><p>{active === 'todo' ? 'Nothing waiting for you.' : active === 'sent' ? 'Nothing waiting for finance.' : 'None in the last 60 days.'}</p></div>
      ) : (
        <div className="table-wrap flat">
          <table className="table ph-table">
            <thead><tr><th className="hide-sm">Paid</th><th>Customer (PayHere)</th><th className="num">Amount</th><th>Where it goes</th></tr></thead>
            <tbody>{list.map((p) => <SalesRow key={p.id} p={p} open={openId === p.id} onToggle={() => setOpenId((x) => (x === p.id ? null : p.id))} onChanged={load} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
export default function PayHerePage() {
  const { role } = useAuth();
  return role === 'sales' ? <SalesView /> : <FinanceView />;
}

function FinanceView() {
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
  const toMatch = all.filter((p) => !isMatched(p)).length + waiting.filter((p) => !isMatched(p)).length;
  const toConfirm = all.filter((p) => isMatched(p) && !p.confirmed).length + waiting.filter((p) => isMatched(p) && !p.confirmed).length;
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
        with its Sampath credit. When a payment is partly for Round Island, Sales split it (Oceanpick invoices, and the Round Island part with its RI invoice no.)
        for you to confirm, or you split it yourself. A payout goes to Export to BC as one BAKRC: each customer applied to the invoice, the Round Island part
        to G/L {data.settings?.ri_gl ?? '102030'} RI Current Account, the fee to G/L 204003, Sampath 590 as balancing account, Comment = the Sampath description.
        Payouts from {fmtDate(data.settings?.start_date)} onwards.</p>
      {error && <p className="error">{error}</p>}
      {!data.account && <p className="error">No bank account in the app has BC code {data.settings?.bank_code}: set it on the Bank page so payouts can be paired with Sampath credits.</p>}
      {data.last_upload && <p className="muted small">Last upload: {data.last_upload.file_name} ({data.last_upload.kind}), {fmtDateTime(data.last_upload.done_at)} by {data.last_upload.done_by}</p>}
      {fin && (showUpload || payouts.length === 0) && <Upload onDone={() => { setShowUpload(true); return load(false); }} />}

      <div className="kpis">
        <div><span>{toMatch}</span>payments with no invoice<small>pick the invoice, or wait for Sales</small></div>
        <div><span>{toConfirm}</span>to confirm<small>the app&apos;s suggestions and Sales&apos; splits</small></div>
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
              <thead><tr><th>Date</th><th>Narration</th><th className="num">LKR</th><th>Note</th></tr></thead>
              <tbody>{unpaired.map((l) => <Fragment key={l.id}><tr><td>{fmtDate(l.txn_date)}</td><td className="narr">{l.narration}</td><td className="num">{lkr(l.credit)}</td>
                <td className="small">{l.tag ? <span className="warn-text">Tagged {TAGS[l.tag] ?? l.tag}{l.tagged_by ? ` by ${l.tagged_by}` : ''}: pair it with its payout</span> : ''}</td></tr></Fragment>)}</tbody>
            </table></div>
          )}
        </div>
      )}
    </section>
  );
}
