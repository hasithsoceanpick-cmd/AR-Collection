import { useEffect, useMemo, useState } from 'react';
import { rpc } from '../lib/supabase';
import { lkr, ref, fmtDate, todayISO } from '../lib/format';

// The customer's open invoices, offered only for what is still available: invoices
// already covered by other receipts (open or closed) are left out, part-covered ones
// show only their balance. `snapshot` = invoices already on the item being edited.
export default function InvoicePicker({ customerNo, selected, onChange, snapshot = [], collectionId = null }) {
  const [rows, setRows] = useState(null);
  const [hidden, setHidden] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setRows(null); setError('');
    rpc('cc_available_invoices', { p_customer_no: customerNo, p_exclude: collectionId }).then((data) => {
      if (!live) return;
      const mine = new Set(snapshot.map((s) => s.document_no));
      const usable = (data ?? []).filter((r) => mine.has(r.document_no) || Math.abs(Number(r.available)) >= 0.005);
      setHidden((data ?? []).length - usable.length);
      const byDoc = new Map(usable.map((r) => [r.document_no, r]));
      for (const s of snapshot) {
        const r = byDoc.get(s.document_no);
        // an item being edited keeps the amount it was recorded with
        byDoc.set(s.document_no, { ...(r ?? { ...s, fromSnapshot: true }), available: s.remaining_amount });
      }
      setRows([...byDoc.values()].sort((a, b) => String(a.posting_date).localeCompare(String(b.posting_date))));
    }).catch((e) => live && setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerNo]);

  const sel = useMemo(() => new Set(selected), [selected]);
  const amt = (r) => Number(r.available);
  const total = (rows ?? []).filter((r) => sel.has(r.document_no)).reduce((s, r) => s + amt(r), 0);
  const today = todayISO();

  function emit(next) {
    const picked = (rows ?? []).filter((r) => next.has(r.document_no));
    onChange(picked.map((r) => r.document_no), Math.round(picked.reduce((s, r) => s + amt(r), 0) * 100) / 100);
  }
  function toggle(doc) { const n = new Set(sel); n.has(doc) ? n.delete(doc) : n.add(doc); emit(n); }
  function toggleAll() { emit(sel.size === (rows ?? []).length ? new Set() : new Set((rows ?? []).map((r) => r.document_no))); }

  if (error) return <p className="error">{error}</p>;
  if (rows === null) return <p className="muted">Loading open invoices…</p>;
  if (rows.length === 0) return (
    <p className="hint">
      {hidden ? `All ${hidden} open invoice${hidden === 1 ? ' is' : 's are'} already covered by other receipts. ` : 'No open invoices for this customer in the last upload. '}
      Type settlement instructions below instead.
    </p>
  );

  return (
    <div className="invoices">
      <div className="inv-head">
        <label className="check"><input type="checkbox" checked={sel.size === rows.length} onChange={toggleAll} /> Select all</label>
        <span className="num">Selected: LKR {lkr(total)}</span>
      </div>
      <ul>
        {rows.map((r) => {
          const on = sel.has(r.document_no);
          const partial = Number(r.allocated) > 0.004 && !r.fromSnapshot;
          const overdue = r.due_date && r.due_date < today && amt(r) > 0;
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
                  {partial && (
                    <span className="inv-note">
                      LKR {lkr(r.allocated)} already on {(r.on_items ?? []).map((x) => ref(x)).join(', ')}; LKR {lkr(r.available)} left
                      {r.original_amount ? ` of ${lkr(r.original_amount)}` : ''}
                    </span>
                  )}
                  {r.fromSnapshot && <span className="inv-note">No longer open in the latest upload</span>}
                </span>
                <span className={`num inv-amt${amt(r) < 0 ? ' neg' : ''}`}>
                  {r.currency_code && r.currency_code !== 'LKR' ? `${r.currency_code} ` : ''}{lkr(r.available)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <p className="hint pad">{hidden} invoice{hidden === 1 ? ' is' : 's are'} hidden because other receipts already cover {hidden === 1 ? 'it' : 'them'}.</p>}
    </div>
  );
}
