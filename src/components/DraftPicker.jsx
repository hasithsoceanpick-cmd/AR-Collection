import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { lkr, fmtDate } from '../lib/format';
import { useAuth } from '../lib/auth';

export const cardNo = (first6, last4) => `${first6 || '······'}******${last4 || '????'}`;
const gap = (a, b) => Math.round((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000);
const days = (n) => `${n} day${n === 1 ? '' : 's'}`;

// Merchant statement sales a card payment can be set off against: every sale of exactly its value
// (what the customer paid, before HNB's commission) that isn't set off yet. Sales within a day of the
// card date come first; sales of the same value on other dates follow, marked { otherDate: true }:
// picking one means the card date was wrong and becomes HNB's date for that sale.
// onChange(draft | null). pick = a sale to select as soon as it shows (the one the person came from).
// invoices = the payment's invoices ({ document_no, posting_date }) to say when a sale is on an invoice's date.
export default function DraftPicker({ amount, cardDate, value, onChange, include = null, pick = null, invoices = [] }) {
  const { role } = useAuth();
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!(amount > 0)) { setDrafts(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      rpc('cc_card_drafts', { p_amount: amount, p_card_date: null, p_include: include })
        .then((all) => {
          if (!live) return;
          const invDays = new Set(invoices.map((i) => i.posting_date));
          const list = (all ?? []).map((d) => ({ ...d, otherDate: Boolean(cardDate) && Math.abs(gap(d.txn_date, cardDate)) > 1 }))
            // within a day first; then a sale on one of the invoices' dates; then the nearest
            .sort((a, b) => (a.otherDate - b.otherDate) || (invDays.has(b.txn_date) - invDays.has(a.txn_date))
              || (cardDate ? Math.abs(gap(a.txn_date, cardDate)) - Math.abs(gap(b.txn_date, cardDate)) : 0) || a.txn_date.localeCompare(b.txn_date));
          setDrafts(list); setError('');
          const again = value && list.find((x) => x.draft_id === value.draft_id);
          if (value && !again) onChange(null);
          else if (again && again.otherDate !== value.otherDate) onChange(again);
          else if (!value && pick) { const x = list.find((y) => y.draft_id === pick); if (x) onChange(x); }
        })
        .catch((e) => live && setError(e.message));
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [amount, cardDate, include]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="error">{error}</p>;
  if (!(amount > 0)) return <p className="hint">Enter the amount to see the sales of that value on the merchant statements.</p>;
  if (drafts === null) return <p className="muted">Looking at the merchant statements…</p>;
  if (drafts.length === 0) return (
    <p className="warn-text">No sale of LKR {lkr(amount)} on the merchant statements in the app that isn't set off yet.
      Check the amount, or park it until finance adds the statement with this sale.</p>
  );
  const near = drafts.filter((d) => !d.otherDate);
  const other = drafts.filter((d) => d.otherDate);
  const onInvoiceDay = (d) => invoices.find((i) => i.posting_date === d.txn_date);
  const row = (d) => {
    const inv = onInvoiceDay(d);
    const g = cardDate ? gap(d.txn_date, cardDate) : 0;
    return (
      <li key={d.draft_id} className={value?.draft_id === d.draft_id ? 'on' : ''}>
        <label>
          <input type="radio" name="draft" checked={value?.draft_id === d.draft_id} onChange={() => onChange(d)} />
          <span className="lp-main">
            <span className="lp-narr">{d.hnbms_no} · sale on {fmtDate(d.txn_date)} · card {cardNo(d.card_first6, d.card_last4)}</span>
            <span className="lp-meta">
              <span>Batch {fmtDate(d.pres_date)}</span>
              {role !== 'sales' && <><span>Commission {lkr(d.commission)}</span><span>Net {lkr(d.net)}</span></>}
              {cardDate && g === 0 && <span className="lp-exact">Same day</span>}
              {d.otherDate && <span className="lp-close">{days(Math.abs(g))} {g < 0 ? 'before' : 'after'} the card date</span>}
              {inv && <span className="lp-exact">Same day as invoice {inv.document_no}</span>}
            </span>
          </span>
          <span className="num lp-amt">{lkr(d.amount)}</span>
        </label>
      </li>
    );
  };
  return (
    <div className="linepicker">
      {cardDate && near.length === 0 && (
        <p className="warn-text">No sale of LKR {lkr(amount)} within a day of {fmtDate(cardDate)}. HNB shows {other.length === 1 ? 'this sale' : 'these sales'} of the same value on other dates:</p>
      )}
      {near.length > 0 && <ul>{near.map(row)}</ul>}
      {near.length > 0 && other.length > 0 && <p className="hint">The same value on other dates:</p>}
      {other.length > 0 && <ul>{other.slice(0, 8).map(row)}</ul>}
    </div>
  );
}
