import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { lkr } from '../lib/format';
import { dmy } from '../lib/followup';
import NoteEditor from './NoteEditor';

// A customer's open invoices, each with its note. Loads the customer's follow-up itself unless it is given (the panel gives it).
export default function InvoiceNotes({ customerNo, data: given, onChange }) {
  const [data, setData] = useState(given ?? null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (given) { setData(given); return undefined; }
    let live = true;
    rpc('cc_ar_customer', { p_customer_no: customerNo }).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [customerNo, given]);

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
                <span className="muted small">due {dmy(i.due_date)} · {i.late > 0 ? `${i.late} days overdue` : 'not due'}</span>
                {i.disputed && <span className="pill warn">Disputed</span>}
                {i.promised && <span className="pill muted">Promised</span>}
                <span className="num">{lkr(i.remaining)}</span>
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
