import { useEffect, useMemo, useState } from 'react';
import { supabase, rpc } from '../lib/supabase';
import { lkr, ref, fmtDate, todayISO } from '../lib/format';

// Lists the customer's open ledger entries with checkboxes.
// `snapshot` = invoices already recorded on the collection being edited.
export default function InvoicePicker({ customerNo, selected, onChange, snapshot = [], collectionId = null }) {
  const [rows, setRows] = useState(null);
  const [taken, setTaken] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setRows(null); setError('');
    Promise.all([
      supabase.from('customer_ledger').select('*').eq('customer_no', customerNo)
        .order('posting_date', { ascending: true, nullsFirst: false }).limit(1000),
      rpc('cc_open_settlements', { p_customer_no: customerNo }),
    ]).then(([l, t]) => {
      if (!live) return;
      if (l.error) { setError(l.error.message); return; }
      const byDoc = new Map(l.data.map((r) => [r.document_no, r]));
      for (const s of snapshot) if (!byDoc.has(s.document_no)) byDoc.set(s.document_no, { ...s, fromSnapshot: true });
      setRows([...byDoc.values()]);
      const tk = {};
      for (const x of t ?? []) if (x.collection_id !== collectionId) tk[x.document_no] = x.collection_id;
      setTaken(tk);
    }).catch((e) => live && setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerNo]);

  const sel = useMemo(() => new Set(selected), [selected]);
  const total = (rows ?? []).filter((r) => sel.has(r.document_no)).reduce((s, r) => s + Number(r.remaining_amount), 0);
  const today = todayISO();

  function emit(next) {
    const docs = (rows ?? []).map((r) => r.document_no).filter((d) => next.has(d));
    const sum = (rows ?? []).filter((r) => next.has(r.document_no)).reduce((s, r) => s + Number(r.remaining_amount), 0);
    onChange(docs, Math.round(sum * 100) / 100);
  }
  function toggle(doc) { const n = new Set(sel); n.has(doc) ? n.delete(doc) : n.add(doc); emit(n); }
  const free = rows ?? [];
  function toggleAll() { emit(sel.size === free.length ? new Set() : new Set(free.map((r) => r.document_no))); }

  if (error) return <p className="error">{error}</p>;
  if (rows === null) return <p className="muted">Loading open invoices…</p>;
  if (rows.length === 0) return (
    <p className="hint">No open invoices for this customer in the last upload. Type settlement instructions below instead.</p>
  );

  return (
    <div className="invoices">
      <div className="inv-head">
        <label className="check"><input type="checkbox" checked={free.length > 0 && sel.size === free.length} onChange={toggleAll} /> Select all</label>
        <span className="num">Selected: LKR {lkr(total)}</span>
      </div>
      <ul>
        {rows.map((r) => {
          const on = sel.has(r.document_no);
          const blockedBy = taken[r.document_no];
          const overdue = r.due_date && r.due_date < today && Number(r.remaining_amount) > 0;
          return (
            <li key={r.document_no} className={on ? 'on' : ''}>
              <label>
                <input type="checkbox" checked={on} onChange={() => toggle(r.document_no)} />
                <span className="inv-main">
                  <strong>{r.document_no}</strong>
                  <span className="inv-meta">
                    {r.document_type && <span>{r.document_type}</span>}
                    {r.posting_date && <span>{fmtDate(r.posting_date)}</span>}
                    {r.due_date && <span className={overdue ? 'overdue' : ''}>Due {fmtDate(r.due_date)}</span>}
                    {r.external_document_no && <span>Ext. {r.external_document_no}</span>}
                  </span>
                  {blockedBy && <span className="inv-note">Also on {ref(blockedBy)}: check it isn't paid twice</span>}
                  {r.fromSnapshot && <span className="inv-note">No longer open in the latest upload</span>}
                </span>
                <span className={`num inv-amt${Number(r.remaining_amount) < 0 ? ' neg' : ''}`}>
                  {r.currency_code && r.currency_code !== 'LKR' ? `${r.currency_code} ` : ''}{lkr(r.remaining_amount)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
