import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/supabase';
import { lkr, fmtDate } from '../lib/format';

// Pick unlinked bank credit line(s).
//  single:   value = line id,        onChange(line)
//  multiple: value = [line ids],     onChange([lines]); `suggest(lines)` may return ids to pre-select.
// HNB merchant settlements ("HNB MERCHANT SLIPS") are left out: finance matches those
// to merchant statement batches. `merchant` shows them instead (for that match).
export default function BankLinePicker({ accountId, amount = null, exact = null, amounts = null, value, onChange, multiple = false, suggest = null, showAccount = false, merchant = false }) {
  const amountsKey = amounts ? amounts.join('|') : '';
  const [lines, setLines] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setLines(null);
    let query = db.from('bank_credits').select('*').is('link_kind', null).order('txn_date', { ascending: false }).limit(500);
    if (accountId) query = query.eq('account_id', accountId);
    query = merchant ? query.ilike('narration', '%MERCHANT SLIPS%') : query.not('narration', 'ilike', '%MERCHANT SLIPS%');
    if (exact != null) query = query.eq('credit', Number(exact));
    if (amounts?.length) query = query.in('credit', amounts.map(Number));
    query.then(({ data, error }) => {
      if (!live) return;
      if (error) { setError(error.message); return; }
      setLines(data);
      if (multiple && suggest) {
        const ids = suggest(data);
        if (ids.length) onChange(data.filter((l) => ids.includes(l.id)));
      }
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, exact, amountsKey, merchant]);

  const chosen = multiple ? new Set(value ?? []) : new Set(value ? [value] : []);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/,/g, '');
    let list = lines ?? [];
    if (t) list = list.filter((l) => l.narration.toLowerCase().includes(t) || (l.reference ?? '').toLowerCase().includes(t)
      || String(l.credit).includes(t));
    const near = (l) => amount != null && Math.abs(Number(l.credit) - Number(amount)) < 0.005;
    list = [...list.filter((l) => chosen.has(l.id)), ...list.filter((l) => !chosen.has(l.id) && near(l)).map((l) => ({ ...l, exact: true })),
      ...list.filter((l) => !chosen.has(l.id) && !near(l))];
    return list.slice(0, 80);
  }, [lines, q, amount, value]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(l) {
    if (!multiple) { onChange(l); return; }
    const picked = (lines ?? []).filter((x) => (x.id === l.id ? !chosen.has(x.id) : chosen.has(x.id)));
    onChange(picked);
  }

  if (error) return <p className="error">{error}</p>;
  if (lines === null) return <p className="muted">Loading bank lines…</p>;
  if (lines.length === 0 && amounts?.length) return (
    <p className="warn-text">No unlinked line of LKR {amounts.map((a) => lkr(a)).join(' or ')} on this account yet. If the bank credited it, upload the latest statement.</p>
  );
  if (lines.length === 0) return exact != null ? (
    <p className="warn-text">No unlinked LKR {lkr(exact)} line{accountId ? ' on this account' : ''} yet. Check the amount, or wait for the next statement upload.</p>
  ) : (
    <p className="hint">No unlinked money-in lines{accountId ? ' on this account' : ''}. If the payment is recent, finance may need to upload the latest statement.</p>
  );

  return (
    <div className="linepicker">
      <input type="search" placeholder="Filter by amount, narration, reference or cheque number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter bank lines" />
      <ul>
        {shown.map((l) => (
          <li key={l.id} className={chosen.has(l.id) ? 'on' : ''}>
            <label>
              <input type={multiple ? 'checkbox' : 'radio'} name="bankline" checked={chosen.has(l.id)} onChange={() => toggle(l)} />
              <span className="lp-main">
                <span className="lp-narr">{l.narration || '(no narration)'}</span>
                <span className="lp-meta">
                  <span>{fmtDate(l.txn_date)}</span>
                  {l.reference && <span>Ref {l.reference}</span>}
                  {l.cheque_no && <span>Cheque {l.cheque_no}</span>}
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
