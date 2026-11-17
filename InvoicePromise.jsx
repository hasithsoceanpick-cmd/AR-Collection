import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr } from '../lib/format';
import { PROMISE, ACTIVE, dmy } from '../lib/followup';

const num = (v) => Number(String(v ?? '').replace(/,/g, ''));

// Tick an invoice as promised and give the expected collection date (and amount; default what is open).
// promise: { id, amount, promised_on, status, received, n_invoices } or null.
export default function InvoicePromise({ customerNo, docNo, open, promise, canWrite, today, onChanged }) {
  const active = promise && ACTIVE.includes(promise.status);
  const [mode, setMode] = useState('view');   // view | edit | untick
  const [date, setDate] = useState('');
  const [amt, setAmt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const st = promise ? PROMISE[promise.status] : null;
  const part = active && Math.abs(Number(promise.amount) - Number(open)) >= 0.005;

  function edit() { setDate(active ? promise.promised_on : ''); setAmt(Number(active ? promise.amount : open).toFixed(2)); setErr(''); setMode('edit'); }
  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await rpc('cc_ar_promise_invoice', { p_customer_no: customerNo, p_doc_no: docNo, p_promised_on: date, p_amount: amt === '' ? null : num(amt) }); setMode('view'); await onChanged?.(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  async function untick() {
    setBusy(true); setErr('');
    try { await rpc('cc_ar_promise_cancel', { p_id: promise.id, p_reason: 'Unticked: no longer promised' }); setMode('view'); await onChanged?.(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }

  const summary = active
    ? <>by <strong>{dmy(promise.promised_on)}</strong>{part && <span className="muted small"> · LKR {lkr(promise.amount)}</span>}
        {promise.status !== 'open' && <> <span className={`pill ${st.tone}`}>{st.label}</span></>}</>
    : null;
  const past = promise && !active ? <span className={`pill ${st.tone}`} title={`LKR ${lkr(promise.amount)} by ${dmy(promise.promised_on)}`}>{st.label} {dmy(promise.promised_on)}</span> : null;

  if (!canWrite) {
    return <span className="fu-promise">{active ? <>Promised {summary}</> : past ?? <span className="muted">–</span>}</span>;
  }
  if (active && promise.n_invoices > 1) {
    return (
      <span className="fu-promise">
        <label className="fu-tick"><input type="checkbox" checked disabled aria-label={`${docNo} promised`} /> {summary}</label>
        <span className="muted small"> · in a promise of LKR {lkr(promise.amount)} for {promise.n_invoices} invoices, <Link to={`/customer/${encodeURIComponent(customerNo)}#follow-up`}>change it on the follow-up</Link></span>
      </span>
    );
  }
  if (mode === 'edit') {
    return (
      <form className="fu-promise-ed" onSubmit={save}>
        <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} required autoFocus aria-label={`Expected collection date for ${docNo}`} />
        <span className="muted small fu-dmy" aria-live="polite">{date ? dmy(date) : 'pick a date'}</span>
        <label className="fu-promise-amt"><span className="muted small">LKR</span>
          <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label={`Promised amount for ${docNo}`} /></label>
        <button className="btn small primary" type="submit" disabled={busy || !date}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="link small" type="button" onClick={() => setMode('view')} disabled={busy}>Cancel</button>
        {err && <span className="error small">{err}</span>}
      </form>
    );
  }
  if (mode === 'untick') {
    return (
      <span className="fu-promise">
        <span className="small">Remove the promise of LKR {lkr(promise.amount)} by {dmy(promise.promised_on)}?</span>{' '}
        <button className="btn small" type="button" onClick={untick} disabled={busy}>{busy ? 'Removing…' : 'Remove'}</button>{' '}
        <button className="link small" type="button" onClick={() => setMode('view')} disabled={busy}>Keep it</button>
        {err && <span className="error small"> {err}</span>}
      </span>
    );
  }
  return (
    <span className="fu-promise">
      <label className="fu-tick">
        <input type="checkbox" checked={Boolean(active)} onChange={() => (active ? setMode('untick') : edit())} aria-label={`${docNo} promised`} />
        {active ? summary : 'Promised'}
      </label>
      {active && <> <button type="button" className="link small" onClick={edit} aria-label={`Change the promise on ${docNo}`}>Change</button></>}
      {!active && past && <> {past}</>}
      {err && <span className="error small"> {err}</span>}
    </span>
  );
}
