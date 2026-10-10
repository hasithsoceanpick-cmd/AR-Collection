import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { lkr, fmtDate } from '../lib/format';

export const cardNo = (first6, last4) => `${first6 || '······'}******${last4 || '????'}`;

// Merchant statement sales drafts a card payment can be set off against:
// exact amount, card date within a day. onChange(draft | null).
export default function DraftPicker({ amount, cardDate, value, onChange, include = null }) {
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!(amount > 0) || !cardDate) { setDrafts(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      rpc('cc_card_drafts', { p_amount: amount, p_card_date: cardDate, p_include: include })
        .then((d) => {
          if (!live) return;
          setDrafts(d ?? []); setError('');
          if (value && !(d ?? []).some((x) => x.draft_id === value.draft_id)) onChange(null);
        })
        .catch((e) => live && setError(e.message));
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [amount, cardDate, include]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="error">{error}</p>;
  if (!(amount > 0) || !cardDate) return <p className="hint">Enter the amount and the card date to see the matching sales on the merchant statements.</p>;
  if (drafts === null) return <p className="muted">Looking at the merchant statements…</p>;
  if (drafts.length === 0) return (
    <p className="warn-text">No sale of LKR {lkr(amount)} within a day of {fmtDate(cardDate)} on the merchant statements in the app yet.
      Check the amount and date, or park it until finance adds the statement.</p>
  );
  return (
    <div className="linepicker">
      <ul>
        {drafts.map((d) => (
          <li key={d.draft_id} className={value?.draft_id === d.draft_id ? 'on' : ''}>
            <label>
              <input type="radio" name="draft" checked={value?.draft_id === d.draft_id} onChange={() => onChange(d)} />
              <span className="lp-main">
                <span className="lp-narr">{d.hnbms_no} · sale on {fmtDate(d.txn_date)} · card {cardNo(d.card_first6, d.card_last4)}</span>
                <span className="lp-meta">
                  <span>Batch {fmtDate(d.pres_date)}</span>
                  <span>Commission {lkr(d.commission)}</span>
                  <span>Net {lkr(d.net)}</span>
                  {d.txn_date === cardDate && <span className="lp-exact">Same day</span>}
                </span>
              </span>
              <span className="num lp-amt">{lkr(d.amount)}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
