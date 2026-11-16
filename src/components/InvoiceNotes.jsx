import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { lkr } from '../lib/format';
import { dmy } from '../lib/followup';
import NoteEditor from './NoteEditor';
import InvoicePromise from './InvoicePromise';
import { ACTIVE } from '../lib/followup';

// A customer's open invoices, each with its note. Loads the customer's follow-up itself unless it is given (the panel gives it).
export default function InvoiceNotes({ customerNo, data: given, onChange, onPromise }) {
  const [data, setData] = useState(given ?? null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (given) { setData(given); return undefined; }
    let live = true;
    rpc('cc_ar_customer', { p_customer_no: customerNo }).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [customerNo, given]);
  // a promise changed: the panel reloads (it gives the data); on the worklist, reload here and tell the list
  async function promiseChanged() {
    if (given) { await onChange?.(); return; }
    try { setData(await rpc('cc_ar_customer', { p_customer_no: customerNo })); } catch (e) { setErr(e.message); }
    await onPromise?.();
  }
  const promiseOf = (doc) => {
    const list = (data?.promises ?? []).filter((p) => p.status !== 'cancelled' && (p.invoices ?? []).some((i) => i.doc_no === doc));
    const p = list.find((x) => ACTIVE.includes(x.status)) ?? list[0];
    return p ? { id: p.id, amount: p.amount, promised_on: p.promised_on, status: p.status, received: p.received, n_invoices: (p.invoices ?? []).length } : null;
  };

  if (err) return <p className="error small">{err}</p>;
  if (!data) return <p className="muted small">Loading invoices…</p>;
  const inv = data.invoices ?? [];
  async function saved(doc, note) {
    const next = { ...data, invoices: inv.map((i) => (i.doc_no === doc ? { ...i, note } : i)) };
    setData(next);
    await onChange?.(next.invoices.filter((i) => i.note).length);
  }
  return (
    <div className="fu-invnotes">
      {inv.length === 0 ? <p className="muted small">No open invoices in the latest ledger upload.</p> : (
        <ul>
          {inv.map((i) => (
            <li key={i.doc_no} className={`fu-invnote${i.note ? ' has-note' : ''}`}>
              <div className="fu-invnote-head">
                <strong>{i.doc_no}</strong>
                <span className="muted small">due {dmy(i.due_date)} · {i.late > 0 ? `${i.late} days overdue` : 'not due'}
                  {i.late > 0 && i.outer_late != null && i.outer_late !== i.late && (i.outer_late > 0 ? ' · past the outer limit' : ' · within the credit window')}</span>
                {i.disputed && <span className="pill warn">Disputed</span>}
                {i.promised && <span className="pill muted">Promised</span>}
                <span className="num">{lkr(i.remaining)}</span>
              </div>
              <div className="fu-invnote-promise">
                <InvoicePromise customerNo={data.customer.customer_no} docNo={i.doc_no} open={i.remaining} promise={promiseOf(i.doc_no)}
                  canWrite={data.can.write} today={data.today} onChanged={promiseChanged} />
              </div>
              <NoteEditor customerNo={data.customer.customer_no} docNo={i.doc_no} note={i.note} canWrite={data.can.write} onSaved={(n) => saved(i.doc_no, n)} />
            </li>
          ))}
        </ul>
      )}
      {data.closed_notes?.length > 0 && (
        <details className="fu-past">
          <summary className="small">Notes on invoices closed since ({data.closed_notes.length})</summary>
          <ul>{data.closed_notes.map((n) => (
            <li key={n.id} className="fu-invnote">
              <div className="fu-invnote-head"><strong>{n.doc_no}</strong><span className="muted small">closed since{Number(n.invoice?.remaining) > 0 ? ` · LKR ${lkr(n.invoice.remaining)} was open when noted` : ''}</span></div>
              <p className="fu-noteline"><span className="fu-notetext">{n.text}</span><span className="muted small"> · {n.by}, {dmy(n.at)}</span></p>
            </li>
          ))}</ul>
        </details>
      )}
    </div>
  );
}
