import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { lkr } from '../lib/format';
import { dmy, ACTIVE } from '../lib/followup';
import NotesList from './NotesList';
import InvoicePromise from './InvoicePromise';
import BulkPromise from './BulkPromise';

// A customer's open invoices, each with its notes (action points) and its promise; several can be ticked and given one
// promised date. Loads the customer's follow-up itself unless it is given (the panel gives it).
export default function InvoiceNotes({ customerNo, data: given, onChange, onPromise }) {
  const [data, setData] = useState(given ?? null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(() => new Set());
  useEffect(() => {
    if (given) { setData(given); return undefined; }
    let live = true;
    rpc('cc_ar_customer', { p_customer_no: customerNo }).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [customerNo, given]);
  // something changed: the panel reloads (it gives the data); on the worklist, reload here and tell the list
  async function changed(promise = false) {
    if (given) { await onChange?.(); return; }
    let d = null;
    try { d = await rpc('cc_ar_customer', { p_customer_no: customerNo }); setData(d); } catch (e) { setErr(e.message); }
    if (d) await onChange?.((d.invoices ?? []).reduce((a, i) => a + (i.notes?.length ?? 0), 0));
    if (promise) await onPromise?.();
  }
  const promiseOf = (doc) => {
    const list = (data?.promises ?? []).filter((p) => p.status !== 'cancelled' && (p.invoices ?? []).some((i) => i.doc_no === doc));
    const p = list.find((x) => ACTIVE.includes(x.status)) ?? list[0];
    return p ? { id: p.id, amount: p.amount, promised_on: p.promised_on, status: p.status, received: p.received, n_invoices: (p.invoices ?? []).length } : null;
  };

  if (err) return <p className="error small">{err}</p>;
  if (!data) return <p className="muted small">Loading invoices…</p>;
  const inv = data.invoices ?? [];
  const canTick = data.can.write;
  // an invoice inside a promise covering several invoices is changed on the follow-up, not by a tick
  const pickable = (i) => { const p = promiseOf(i.doc_no); return !(p && p.n_invoices > 1 && ACTIVE.includes(p.status)); };
  const choices = canTick ? inv.filter(pickable).map((i) => i.doc_no) : [];
  const picked = choices.filter((d) => sel.has(d));
  const pickedTotal = inv.filter((i) => sel.has(i.doc_no)).reduce((a, i) => a + Number(i.remaining), 0);
  const flip = (doc) => setSel((x) => { const y = new Set(x); if (y.has(doc)) y.delete(doc); else y.add(doc); return y; });
  return (
    <div className="fu-invnotes">
      {canTick && inv.length > 0 && (
        <div className="fu-bulk">
          {choices.length > 1 && (
            <label className="small fu-tickall"><input type="checkbox" checked={picked.length > 0 && picked.length === choices.length}
              ref={(el) => { if (el) el.indeterminate = picked.length > 0 && picked.length < choices.length; }}
              onChange={() => setSel(picked.length === choices.length ? new Set() : new Set(choices))} aria-label="Tick all open invoices" /> Tick all</label>
          )}
          <BulkPromise customerNo={data.customer.customer_no} picked={picked} pickedTotal={pickedTotal} choices={choices.length} today={data.today}
            onClear={() => setSel(new Set())} onSaved={() => changed(true)} />
        </div>
      )}
      {inv.length === 0 ? <p className="muted small">No open invoices in the latest ledger upload.</p> : (
        <ul>
          {inv.map((i) => (
            <li key={i.doc_no} className={`fu-invnote${i.notes?.length ? ' has-note' : ''}${sel.has(i.doc_no) ? ' ticked' : ''}`}>
              <div className="fu-invnote-head">
                {canTick && (pickable(i)
                  ? <input type="checkbox" className="fu-pick" checked={sel.has(i.doc_no)} onChange={() => flip(i.doc_no)} aria-label={`Tick ${i.doc_no}`} />
                  : <span className="fu-pick" aria-hidden="true" />)}
                <strong>{i.doc_no}</strong>
                <span className="muted small">due {dmy(i.due_date)} · {i.late > 0 ? `${i.late} days overdue` : 'not due'}
                  {i.late > 0 && i.outer_late != null && i.outer_late !== i.late && (i.outer_late > 0 ? ' · past the outer limit' : ' · within the credit window')}</span>
                {i.disputed && <span className="pill warn">Disputed</span>}
                {i.promised && <span className="pill muted">Promised</span>}
                <span className="num">{lkr(i.remaining)}</span>
              </div>
              <div className="fu-invnote-promise">
                <InvoicePromise customerNo={data.customer.customer_no} docNo={i.doc_no} open={i.remaining} promise={promiseOf(i.doc_no)}
                  canWrite={data.can.write} today={data.today} onChanged={() => changed(true)} />
              </div>
              <NotesList customerNo={data.customer.customer_no} docNo={i.doc_no} notes={i.notes} canWrite={data.can.write} onChanged={() => changed()} />
            </li>
          ))}
        </ul>
      )}
      {data.closed_notes?.length > 0 && (
        <details className="fu-past">
          <summary className="small">Open notes on invoices closed since ({data.closed_notes.length})</summary>
          <NotesList customerNo={data.customer.customer_no} notes={data.closed_notes} showDoc canWrite={false} onChanged={() => changed()} />
        </details>
      )}
    </div>
  );
}
