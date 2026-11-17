import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { lkr, fmtDate, fmtDateTime } from '../lib/format';

// Months that have ended: the last twelve, newest first.
function endedMonths() {
  const out = [];
  const now = new Date();
  for (let i = 1; i <= 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    out.push({ from: iso(d), to: iso(last), label: d.toLocaleString('en-GB', { month: 'long', year: 'numeric' }) });
  }
  return out;
}

const GROUPS = [
  { key: 'found', title: "Export to BC · exported, and BC's bank ledger has it under BC's number: the app takes that number", test: (x) => x.action === 'found_in_bc' },
  { key: 'bcno', title: 'Export to BC · never exported: recorded under its BC number', test: (x) => x.action === 'closed_new' && (x.bc_found || x.kind === 'cash receipt') },
  { key: 'closed', title: "Export to BC · never exported, not found in BC's ledgers: closed with the month (CLOSED-… number)", test: (x) => x.action === 'closed_new' && !x.bc_found && x.kind !== 'cash receipt' },
  { key: 'accepted', title: 'Export to BC · exported, not found under its number in BC: accepted as posted', test: (x) => x.action === 'accepted' },
  { key: 'diff', title: 'BC check · needs attention ("BC differs", not found, customer side missing): accepted as posted', test: (x) => x.action === 'diff_accepted' || x.action === 'doc_accepted' },
  { key: 'rev', title: 'BC check · sent back to Sales or reopened (this month or earlier): marked checked, BC taken as right', test: (x) => x.action === 'reversal_checked', noMoney: true },
  { key: 'receipt', title: 'Receipts still open (not cheques): closed and recorded as posted in BC', test: (x) => x.action === 'receipt_closed' },
  { key: 'line', title: 'Bank credits never identified: tagged "Other: Posted in BC"', test: (x) => x.action === 'line_tagged' },
];
const noMoney = (x) => x.action === 'reversal_checked';

// Finance: close a month whose bank reconciliations are done, so everything in it counts as posted in BC.
export default function CloseMonth({ onDone, defaultOpen = false }) {
  const { role, isAdmin } = useAuth();
  const admin = role === 'finance' && isAdmin;
  const months = useMemo(endedMonths, []);
  const [m, setM] = useState(0);
  const [plan, setPlan] = useState(null);
  const [skip, setSkip] = useState(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const month = months[m];

  const loadHistory = useCallback(async () => {
    try { setHistory(await rpc('cc_period_closes') ?? []); } catch { setHistory([]); }
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { setPlan(null); setSkip(new Set()); setMsg(''); }, [m]);

  async function preview() {
    setBusy(true); setError(''); setMsg('');
    try { setPlan(await rpc('cc_period_close', { p_from: month.from, p_to: month.to, p_apply: false })); setSkip(new Set()); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await rpc('cc_period_close', { p_from: month.from, p_to: month.to, p_apply: true, p_note: note, p_skip: [...skip] });
      setMsg(`${month.label} closed: ${r.items} item${r.items === 1 ? '' : 's'} now count as posted in BC.${(r.check ?? []).length ? ` ${r.check.length} left open (cheques for collection, or another month).` : ''}`);
      setPlan(null); setNote(''); setSkip(new Set());
      await loadHistory(); await onDone?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function undo(id, label) {
    setBusy(true); setError(''); setMsg('');
    try { const n = await rpc('cc_period_close_undo', { p_run_id: id }); setMsg(`Close of ${label} undone: ${n} item${n === 1 ? '' : 's'} back as they were.`); await loadHistory(); await onDone?.(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const items = plan?.items ?? [];
  const closing = items.filter((x) => !skip.has(x.key));
  const total = closing.filter((x) => !noMoney(x)).reduce((a, x) => a + Number(x.total ?? 0), 0);
  const check = plan?.check ?? [];
  const cheques = check.filter((x) => x.group === 'cheque');
  const others = check.filter((x) => x.group !== 'cheque');
  const tick = (k) => setSkip((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const monthName = (h) => new Date(`${h.from}T00:00:00`).toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <details className="facts close-month" id="close-month" open={defaultOpen || undefined}>
      <summary>Close a month</summary>
      <p className="hint">When a month&apos;s bank reconciliations are done and every entry is in Business Central, close it. Everything of that month still open in the app
        counts as posted in BC: Export to BC, BC check (including documents sent back to Sales or reopened), receipts still with finance or sent back to Sales,
        and bank credits never identified. Where BC&apos;s bank ledger has the same amount on the same bank, the app takes BC&apos;s document number.
        Cheques still in collection are left as they are, later months are not touched, and a close can be undone.</p>
      <div className="row">
        <label className="inline-field">Month
          <select value={m} onChange={(e) => setM(Number(e.target.value))} aria-label="Month to close">
            {months.map((x, i) => <option key={x.from} value={i}>{x.label}</option>)}
          </select></label>
        <button className="btn" disabled={busy} onClick={preview}>{busy && !plan ? 'Checking…' : 'Preview'}</button>
      </div>
      {plan && (
        <div className="match-plan">
          <p className="hint small">BC ledgers last uploaded: bank {plan.uploads?.bank ? fmtDateTime(plan.uploads.bank) : 'never'}, customer {plan.uploads?.customer ? fmtDateTime(plan.uploads.customer) : 'never'}.
            Upload the latest ones on BC check first, so BC&apos;s numbers are found.</p>
          {items.length === 0 && <p className="ok-text">Nothing of {month.label} is open in the app.</p>}
          {GROUPS.map((g) => { const list = items.filter(g.test); return list.length > 0 && (
            <div key={g.key}>
              <h4>{g.title} ({list.length})</h4>
              <ul className="checklist">{list.map((x) => (
                <li key={x.key} className={skip.has(x.key) ? '' : 'on'}><label>
                  <input type="checkbox" checked={!skip.has(x.key)} onChange={() => tick(x.key)} aria-label={`Close ${x.item}`} />
                  <span className="lp-main">
                    <span className="lp-narr">{x.item}</span>
                    <span className="lp-meta">
                      <span>{fmtDate(x.date)}</span>
                      {x.old_no ? <span><strong>{x.old_no}</strong> → <strong>{x.doc_no}</strong></span> : x.doc_no && <span><strong>{x.doc_no}</strong></span>}
                      {(x.issues ?? []).length > 0 && <span className="lp-close">Was waiting on: {x.issues.join(', ').replace(/_/g, ' ')}</span>}
                    </span>
                    <span className="muted small">{x.why}</span>
                  </span>
                  <span className={`num lp-amt${g.noMoney ? ' muted' : ''}`}>{lkr(x.total)}</span>
                </label></li>))}</ul>
            </div>); })}
          {cheques.length > 0 && (
            <div>
              <h4>Cheques for collection: left as they are ({cheques.length})</h4>
              <p className="hint small">Cheque receipts of {month.label} still being collected, deposited or cleared. Each one goes with its own bank date.</p>
              <ul className="plain small">{cheques.map((x) => <li key={x.key}>{x.item} · LKR {lkr(x.total)} — <span className="muted">{x.why}</span></li>)}</ul>
            </div>
          )}
          {others.length > 0 && (
            <div>
              <h4>Left open, not changed ({others.length})</h4>
              <p className="hint small">Receipts of {month.label} whose bank item is in another month (they close with that month), or cash receipts without a CSHRC number.</p>
              <ul className="plain small">{others.map((x) => <li key={x.key}>{x.item} · LKR {lkr(x.total)} — <span className="muted">{x.why}</span></li>)}</ul>
            </div>
          )}
          {items.length > 0 && (admin ? (<>
            <p className="match-sum">Closing <strong>{closing.length}</strong> of {items.length} item{items.length === 1 ? '' : 's'}, LKR <strong>{lkr(total)}</strong>. Untick any that isn&apos;t in BC or should stay open.</p>
            <label className="field"><span className="flabel">Why can {month.label} be closed?</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`E.g. ${month.label} bank reconciliations done, all entries posted in BC`} /></label>
            <button className="btn primary" disabled={busy || !note.trim() || closing.length === 0} onClick={apply}>{busy ? 'Closing…' : `Close ${month.label}`}</button>
          </>) : <p className="muted small">A Finance Admin can close the month.</p>)}
        </div>
      )}
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {history.length > 0 && (
        <div className="close-history">
          <h4>Months closed</h4>
          <ul className="plain small">{history.map((h) => (
            <li key={h.id}><strong>{monthName(h)}</strong> · {h.summary?.items ?? h.items.length} items, LKR {lkr(h.summary?.total ?? 0)} · {fmtDateTime(h.done_at)} by {h.done_by}
              <div className="muted">{h.note}</div>
              {h.undone_at ? <div className="warn-text">Undone {fmtDateTime(h.undone_at)}{h.undone_by ? ` by ${h.undone_by}` : ''}</div>
                : admin && <button className="link small" disabled={busy} onClick={() => undo(h.id, monthName(h))}>Undo this close</button>}
            </li>))}</ul>
        </div>
      )}
    </details>
  );
}
