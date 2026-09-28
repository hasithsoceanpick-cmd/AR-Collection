import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { lkr, fmtDate } from '../lib/format';

// Pick one unlinked bank credit line. Lines equal to `amount` are listed first.
export default function BankLinePicker({ accountId, amount = null, value, onChange, showAccount = false }) {
  const [lines, setLines] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setLines(null);
    let query = supabase.from('bank_credits').select('*').is('link_kind', null)
      .order('txn_date', { ascending: false }).limit(500);
    if (accountId) query = query.eq('account_id', accountId);
    query.then(({ data, error }) => {
      if (!live) return;
      if (error) setError(error.message); else setLines(data);
    });
    return () => { live = false; };
  }, [accountId]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/,/g, '');
    let list = lines ?? [];
    if (t) list = list.filter((l) => l.narration.toLowerCase().includes(t) || (l.reference ?? '').toLowerCase().includes(t)
      || String(l.credit).includes(t));
    if (amount != null) {
      const exact = list.filter((l) => Math.abs(Number(l.credit) - Number(amount)) < 0.005);
      const rest = list.filter((l) => Math.abs(Number(l.credit) - Number(amount)) >= 0.005);
      list = [...exact.map((l) => ({ ...l, exact: true })), ...rest];
    }
    return list.slice(0, 80);
  }, [lines, q, amount]);

  if (error) return <p className="error">{error}</p>;
  if (lines === null) return <p className="muted">Loading bank lines…</p>;
  if (lines.length === 0) return (
    <p className="hint">No unlinked money-in lines{accountId ? ' on this account' : ''}. If the payment is recent, finance may need to upload the latest statement.</p>
  );

  return (
    <div className="linepicker">
      <input type="search" placeholder="Filter by amount, narration or reference" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter bank lines" />
      <ul>
        {shown.map((l) => (
          <li key={l.id} className={value === l.id ? 'on' : ''}>
            <label>
              <input type="radio" name="bankline" checked={value === l.id} onChange={() => onChange(l)} />
              <span className="lp-main">
                <span className="lp-narr">{l.narration || '(no narration)'}</span>
                <span className="lp-meta">
                  <span>{fmtDate(l.txn_date)}</span>
                  {l.reference && <span>Ref {l.reference}</span>}
                  {showAccount && <span>{l.account_name}</span>}
                  {l.exact && <span className="lp-exact">Amount matches</span>}
                </span>
              </span>
              <span className="num lp-amt">{lkr(l.credit)}</span>
            </label>
          </li>
        ))}
      </ul>
      {shown.length === 80 && <p className="hint">Showing the first 80. Filter to narrow down.</p>}
    </div>
  );
}
