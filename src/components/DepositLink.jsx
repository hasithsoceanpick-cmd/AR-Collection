import { useCallback, useEffect, useRef, useState } from 'react';
import { db, rpc } from '../lib/supabase';
import { lkr } from '../lib/format';
import BankLinePicker from './BankLinePicker';
import StatementView from './StatementView';
import ChequeLines, { suggestGroups } from './ChequeLines';
import { useAuth } from '../lib/auth';

const digits = (s) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
// Can an amount be made up of some of the slip's cheques (one, several or all)?
function canMake(amount, cheques) {
  const target = Math.round(Number(amount) * 100);
  let sums = new Set([0]);
  for (const q of cheques) {
    const a = Math.round(Number(q.amount) * 100);
    sums = new Set([...sums, ...[...sums].map((x) => x + a).filter((x) => x <= target)]);
    if (sums.has(target)) return true;
  }
  return false;
}
// Can the slip be matched the usual way: one line for the whole slip, or a line of each cheque's amount?
function usualWorks(cheques, lines, total) {
  const c = (n) => Math.round(Number(n) * 100);
  if (lines.some((l) => c(l.credit) === c(total))) return true;
  const used = new Set();
  return cheques.every((q) => { const l = lines.find((x) => !used.has(x.id) && c(x.credit) === c(q.amount)); if (l) used.add(l.id); return Boolean(l); });
}

// Finance: match a deposit slip to its bank credit line(s). Banks often list each
// cheque as its own line, so several lines may make up one slip.
export default function DepositLink({ deposit, onDone }) {
  const { isAdmin, role } = useAuth();
  const admin = isAdmin && role === 'finance';
  const [cheques, setCheques] = useState(null);
  const [picked, setPicked] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [back, setBack] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Finance Admin: every unlinked money-in line on the account, to match cheque by cheque
  const [bankLines, setBankLines] = useState(null);
  const [byCheque, setByCheque] = useState(false);
  const [prefer, setPrefer] = useState([]);
  const [shown, setShown] = useState([]);
  const auto = useRef(false);

  const loadCheques = useCallback(() => db.from('collections').select('id, customer_name, cheques!cheques_collection_id_fkey(id, cheque_no, amount, returned_at)')
    .eq('deposit_id', deposit.id).neq('status', 'cancelled')
    .then(({ data, error: e }) => {
      if (e) setError(`Couldn't load the slip's cheques: ${e.message}`);
      setCheques((data ?? []).flatMap((c) => c.cheques.filter((q) => !q.returned_at).map((q) => ({ ...q, customer: c.customer_name }))));
    }), [deposit.id]);
  useEffect(() => { loadCheques(); }, [loadCheques]);
  useEffect(() => {
    if (!admin) return;
    db.from('bank_credits').select('*').eq('account_id', deposit.account_id).is('link_kind', null)
      .not('narration', 'ilike', '%MERCHANT SLIPS%').order('txn_date', { ascending: false }).limit(500)
      .then(({ data, error: e }) => { if (e) setError(`Couldn't load the bank lines: ${e.message}`); setBankLines(data ?? []); });
  }, [admin, deposit.account_id]);
  // when the usual way can't match the slip but the bank lines add up cheque by cheque, open that straight away
  useEffect(() => {
    if (!admin || auto.current || !cheques?.length || !bankLines) return;
    auto.current = true;
    if (!usualWorks(cheques, bankLines, deposit.slip_total) && suggestGroups(cheques, bankLines, { depositDate: deposit.deposit_date }).complete) setByCheque(true);
  }, [admin, cheques, bankLines, deposit.slip_total, deposit.deposit_date]);

  // Pre-select: a line carrying each cheque's number, else one with its exact amount,
  // else a single line equal to the whole slip.
  function suggest(lines) {
    const whole = lines.find((l) => Math.abs(Number(l.credit) - Number(deposit.slip_total)) < 0.005);
    const ids = [];
    for (const q of cheques ?? []) {
      const n = digits(q.cheque_no);
      const hit = lines.find((l) => !ids.includes(l.id) && Math.abs(Number(l.credit) - Number(q.amount)) < 0.005
          && n && (digits(l.cheque_no) === n || l.narration.replace(/\D+/g, ' ').split(' ').map((x) => x.replace(/^0+/, '')).includes(n)))
        || lines.find((l) => !ids.includes(l.id) && Math.abs(Number(l.credit) - Number(q.amount)) < 0.005);
      if (hit) ids.push(hit.id);
    }
    const sum = lines.filter((l) => ids.includes(l.id)).reduce((s, l) => s + Number(l.credit), 0);
    if (Math.abs(sum - Number(deposit.slip_total)) < 0.005) return ids;
    return whole ? [whole.id] : ids;
  }

  const total = picked.reduce((s, l) => s + Number(l.credit), 0);
  const ok = picked.length > 0 && Math.abs(total - Number(deposit.slip_total)) < 0.005;
  // the bank shows a cheque differently from what was recorded (e.g. one recorded cheque as two bank lines)
  const odd = ok && cheques ? picked.filter((l) => !canMake(l.credit, cheques)) : [];

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

  if (admin && byCheque) return (
    <div className="action">
      <h2>Match slip D-{deposit.id} to the bank</h2>
      {!cheques || !bankLines ? <p className="muted">Loading…</p> : (
        <ChequeLines key={prefer.join()} deposit={deposit} cheques={cheques} lines={bankLines} prefer={prefer} onLinesChange={setShown}
          onDone={onDone} cancelLabel="Match the usual way instead" onCancel={() => { setByCheque(false); setPrefer([]); setShown([]); }} />
      )}
      <StatementView accountId={deposit.account_id} highlightIds={shown} focusDate={deposit.deposit_date} />
    </div>
  );

  return (
    <div className="action">
      <h2>Match slip D-{deposit.id} to the bank</h2>
      <p className="hint">Tick the money-in line(s) for this slip. Banks often show each cheque as its own line; lines carrying the cheque numbers are ticked for you. Every collection on the slip closes when you confirm.</p>
      {cheques === null ? <p className="muted">Loading…</p> : (
        <>
          <p className="hint">
            {showAll ? 'Showing every unlinked money-in line on this account.'
              : `Showing only lines of exactly LKR ${[...new Set([Number(deposit.slip_total), ...cheques.map((q) => Number(q.amount))])].map((a) => lkr(a)).join(', ')} (the slip total or one of its cheques).`}{' '}
            <button type="button" className="link" onClick={() => { setShowAll((v) => !v); setPicked([]); }}>
              {showAll ? 'Show exact amounts only' : 'Bank combined or split the cheques? Show all lines'}
            </button>
          </p>
          {admin && (
            <p className="hint">Finance Admin: the bank shows a cheque as several lines?{' '}
              <button type="button" className="link" onClick={() => { setPrefer([]); setByCheque(true); }}>Match cheque by cheque</button>
            </p>
          )}
          <BankLinePicker key={showAll ? 'all' : 'exact'} multiple accountId={deposit.account_id}
            amounts={showAll ? null : [...new Set([Number(deposit.slip_total), ...cheques.map((q) => Number(q.amount))])]}
            value={picked.map((l) => l.id)} onChange={setPicked} suggest={suggest} />
        </>
      )}
      <div className={ok ? 'total ok' : 'total warn'}>
        <span>Ticked: LKR {lkr(total)} of LKR {lkr(deposit.slip_total)}</span>
        {picked.length > 0 && !ok && <span>{total < deposit.slip_total ? 'Short' : 'Over'} by LKR {lkr(Math.abs(deposit.slip_total - total))}.</span>}
      </div>
      {odd.length > 0 && !admin && (
        <p className="warn-text">The bank shows {odd.map((l) => `LKR ${lkr(l.credit)}`).join(' and ')}, which {odd.length === 1 ? "isn't" : "aren't"} one of the cheques recorded on this slip:
          Sales recorded them differently. Only a Finance Admin can match this slip (splitting the recorded cheque to match the bank).</p>
      )}
      {odd.length > 0 && admin && (
        <div className="row">
          <p className="warn-text">The bank shows {odd.map((l) => `LKR ${lkr(l.credit)}`).join(' and ')}, which {odd.length === 1 ? "isn't" : "aren't"} one of the cheques recorded on this slip.</p>
          <button type="button" className="btn primary" disabled={!bankLines} onClick={() => { setPrefer(picked.map((l) => l.id)); setByCheque(true); }}>Match cheque by cheque with these lines</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        {odd.length === 0 && (
          <button className="btn primary" disabled={busy || !ok} onClick={() => run(() => rpc('cc_link_deposit', { p_deposit_id: deposit.id, p_line_ids: picked.map((l) => l.id) }))}>
            Match and close
          </button>
        )}
        <button className="btn ghost" onClick={() => setBack(true)}>Something's wrong</button>
      </div>
      <StatementView accountId={deposit.account_id} highlightIds={picked.map((l) => l.id)} focusDate={deposit.deposit_date} />
    </div>
  );
}
