import { useState } from 'react';
import { rpc } from '../lib/supabase';
import { lkr } from '../lib/format';
import BankLinePicker from './BankLinePicker';

// Finance: match a deposit slip to its bank credit line (closes every collection on it),
// or send the slip back if it was recorded wrongly.
export default function DepositLink({ deposit, onDone }) {
  const [line, setLine] = useState(null);
  const [back, setBack] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); await onDone(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (back) return (
    <div className="action cancel-box">
      <h2>Send slip D-{deposit.id} back</h2>
      <p className="hint">Its collections go back to "To deposit" so the slip can be recorded again.</p>
      <label className="field"><span className="flabel">What's wrong?</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Slip total doesn't match the photo" /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn danger" disabled={busy} onClick={() => run(() => rpc('cc_cancel_deposit', { p_deposit_id: deposit.id, p_reason: reason }))}>Send back</button>
        <button className="btn ghost" onClick={() => setBack(false)}>Back</button>
      </div>
    </div>
  );

  return (
    <div className="action">
      <h2>Match slip D-{deposit.id} to the bank</h2>
      <p className="hint">Pick the money-in line of LKR {lkr(deposit.slip_total)}. Lines with the same amount are listed first. Every collection on the slip closes when you confirm.</p>
      <BankLinePicker accountId={deposit.account_id} amount={deposit.slip_total} value={line?.id} onChange={setLine} />
      {line && Math.abs(Number(line.credit) - Number(deposit.slip_total)) >= 0.005 && (
        <p className="warn-text">This line is LKR {lkr(line.credit)}, not LKR {lkr(deposit.slip_total)}. Only a line with the exact slip total can be linked.</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy || !line} onClick={() => run(() => rpc('cc_link_deposit', { p_deposit_id: deposit.id, p_line_id: line.id }))}>
          Link and close
        </button>
        <button className="btn ghost" onClick={() => setBack(true)}>Something's wrong</button>
      </div>
    </div>
  );
}
