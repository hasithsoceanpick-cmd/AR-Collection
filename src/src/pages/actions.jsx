import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, rpc, uploadPhoto, db } from '../lib/supabase';
import BankLinePicker from '../components/BankLinePicker';
import StatementView from '../components/StatementView';
import { lkr, todayISO, fmtDate } from '../lib/format';
import PhotoInput from '../components/PhotoInput';
import InvoicePicker from '../components/InvoicePicker';

function useAction(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); await onDone(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return { busy, error, run };
}

// Step 3 — finance assigns a driver and a date
export function AssignPanel({ c, onDone }) {
  const [drivers, setDrivers] = useState([]);
  const [driver, setDriver] = useState(c.driver_id ?? '');
  const [date, setDate] = useState(c.collection_date ?? todayISO());
  const [note, setNote] = useState(c.instructions ?? '');
  const [open, setOpen] = useState(c.status === 'submitted');
  const { busy, error, run } = useAction(onDone);

  useEffect(() => {
    db.from('profiles').select('id, full_name, email').eq('role', 'driver').eq('active', true)
      .order('full_name').then(({ data }) => setDrivers(data ?? []));
  }, []);

  if (!open) return (
    <div className="action quiet"><button className="btn" onClick={() => setOpen(true)}>Change driver or date</button></div>
  );

  return (
    <form className="action" onSubmit={(e) => { e.preventDefault(); run(() => rpc('cc_assign', {
      p_id: c.id, p_driver: driver, p_date: date, p_instructions: note })); }}>
      <h2>{c.status === 'assigned' ? 'Change driver or date' : 'Send a driver'}</h2>
      <div className="grid2">
        <label className="field"><span className="flabel">Driver</span>
          <select required value={driver} onChange={(e) => setDriver(e.target.value)}>
            <option value="">Choose a driver</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name || d.email}</option>)}
          </select>
        </label>
        <label className="field"><span className="flabel">Collection date</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {drivers.length === 0 && <p className="hint">No drivers set up yet. Give someone the driver role under People.</p>}
      <label className="field"><span className="flabel">Instructions for the driver</span>
        <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ask for Mr Perera at accounts" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{c.status === 'assigned' ? 'Save and tell the driver' : 'Assign driver'}</button>
        {c.status === 'assigned' && <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Keep as is</button>}
      </div>
    </form>
  );
}

// Step 4 — driver records the cheques
const blankCheque = () => ({ key: crypto.randomUUID(), cheque_no: '', bank: '', cheque_date: '', amount: '', photo: null });

export function CollectPanel({ c, onDone, asFinance }) {
  const [list, setList] = useState([{ ...blankCheque(), amount: String(c.expected_amount) }]);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState(null); // null = hidden, string = open
  const [progress, setProgress] = useState('');
  const [show, setShow] = useState(!asFinance);
  const nav = useNavigate();
  const { busy, error, run } = useAction(onDone);

  const total = list.reduce((s, q) => s + (Number(String(q.amount).replace(/,/g, '')) || 0), 0);
  const diff = Math.round((total - Number(c.expected_amount)) * 100) / 100;
  const upd = (key, k, v) => setList((l) => l.map((q) => (q.key === key ? { ...q, [k]: v } : q)));

  function submit(e) {
    e.preventDefault();
    run(async () => {
      if (list.some((q) => !q.photo)) throw new Error('Take a photo of each cheque before saving.');
      const rows = [];
      for (let i = 0; i < list.length; i++) {
        setProgress(`Uploading photo ${i + 1} of ${list.length}…`);
        const q = list[i];
        const path = await uploadPhoto(c.id, 'cheque', q.photo);
        rows.push({ cheque_no: q.cheque_no, bank: q.bank, cheque_date: q.cheque_date || null,
          amount: String(q.amount).replace(/,/g, ''), photo_path: path });
      }
      setProgress('Saving…');
      await rpc('cc_collect', { p_id: c.id, p_cheques: rows, p_note: note });
    }).finally(() => setProgress(''));
  }

  if (!show) return (
    <div className="action quiet"><button className="btn" onClick={() => setShow(true)}>Record the collection myself</button></div>
  );

  if (problem !== null) return (
    <form className="action" onSubmit={(e) => { e.preventDefault(); run(async () => {
      await rpc('cc_report_problem', { p_id: c.id, p_note: problem });
      if (!asFinance) nav('/');
    }); }}>
      <h2>Couldn't collect</h2>
      <p className="hint">This goes back to finance to rearrange. Sales will be told too.</p>
      <label className="field"><span className="flabel">What happened?</span>
        <textarea rows="3" required value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Customer said the cheque will be ready on Monday" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy}>Send back to finance</button>
        <button type="button" className="btn ghost" onClick={() => setProblem(null)}>Back</button>
      </div>
    </form>
  );

  return (
    <form className="action" onSubmit={submit}>
      <h2>{asFinance ? 'Record the collection' : 'Collect the cheques'}</h2>
      <p className="hint">Check each cheque's amount against LKR {lkr(c.expected_amount)} and photograph it.</p>
      {list.map((q, i) => (
        <fieldset key={q.key} className="cheque-entry">
          <legend>Cheque {list.length > 1 ? i + 1 : ''}</legend>
          <PhotoInput label="Photo of the cheque" value={q.photo} onChange={(b) => upd(q.key, 'photo', b)} />
          <div className="grid2">
            <label className="field"><span className="flabel">Cheque number</span>
              <input required inputMode="numeric" value={q.cheque_no} onChange={(e) => upd(q.key, 'cheque_no', e.target.value)} />
            </label>
            <label className="field"><span className="flabel">Amount (LKR)</span>
              <input required inputMode="decimal" value={q.amount} onChange={(e) => upd(q.key, 'amount', e.target.value)} />
            </label>
            <label className="field"><span className="flabel">Bank</span>
              <input value={q.bank} onChange={(e) => upd(q.key, 'bank', e.target.value)} placeholder="BOC, Commercial, HNB…" />
            </label>
            <label className="field"><span className="flabel">Cheque date</span>
              <input type="date" value={q.cheque_date} onChange={(e) => upd(q.key, 'cheque_date', e.target.value)} />
            </label>
          </div>
          {list.length > 1 && (
            <button type="button" className="link" onClick={() => setList((l) => l.filter((x) => x.key !== q.key))}>Remove this cheque</button>
          )}
        </fieldset>
      ))}
      <button type="button" className="btn ghost" onClick={() => setList((l) => [...l, { ...blankCheque() }])}>Add another cheque</button>

      <div className={diff === 0 ? 'total ok' : 'total warn'}>
        <span>Total LKR {lkr(total)}</span>
        {diff !== 0 && <span>{diff > 0 ? 'More' : 'Less'} than expected by LKR {lkr(Math.abs(diff))}. Finance and sales will be notified.</span>}
      </div>
      <label className="field"><span className="flabel">Note (optional)</span>
        <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} placeholder={diff !== 0 ? 'Why is the amount different?' : ''} />
      </label>
      {progress && <p className="hint">{progress}</p>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy}>Save collection</button>
        <button type="button" className="btn ghost" onClick={() => setProblem('')}>Couldn't collect</button>
      </div>
    </form>
  );
}

// Step 5 — finance receives the cheques
export function ReceivePanel({ c, onDone }) {
  const { busy, error, run } = useAction(onDone);
  if (c.split_needed && !c.split_at) return (
    <div className="action">
      <h2>Receive the cheques</h2>
      <p className="warn-text">The driver collected more than one cheque. Waiting for Sales to say which invoices each cheque pays, before the cheques can be received.</p>
    </div>
  );
  return (
    <div className="action">
      <h2>Receive the cheques</h2>
      <p className="hint">Confirm you have the physical cheques from the driver and they match the photos below.</p>
      <AmountCheck c={c} />
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy} onClick={() => run(() => rpc('cc_receive', { p_id: c.id }))}>
        I have the cheques
      </button>
    </div>
  );
}

// The collected amount against the invoices on the request: when they differ, Sales may need to re-instruct.
function AmountCheck({ c }) {
  if (c.collected_amount == null || !(c.settlement ?? []).length) return null;
  const inv = (c.settlement ?? []).reduce((t, s) => t + Number(s.remaining_amount), 0);
  const d = Math.round((Number(c.collected_amount) - inv) * 100) / 100;
  if (Math.abs(d) < 0.005) return null;
  return <p className="warn-text">Collected LKR {lkr(c.collected_amount)} against invoices of LKR {lkr(inv)} ({d < 0 ? `LKR ${lkr(-d)} short` : `LKR ${lkr(d)} over`}).
    If Sales must give new settlement instructions, use <strong>Reject: back to Sales</strong> below.</p>;
}

export function CancelPanel({ c, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction(onDone);
  const what = c.kind === 'cheque' ? 'collection' : 'payment';
  if (!open) return <button className="btn ghost danger-text" onClick={() => setOpen(true)}>Cancel {what}</button>;
  return (
    <form className="action cancel-box" onSubmit={(e) => { e.preventDefault(); run(() => rpc('cc_cancel', { p_id: c.id, p_reason: reason })); }}>
      <h2>Cancel this {what}?</h2>
      <label className="field"><span className="flabel">Reason</span>
        <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer paid by bank transfer" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn danger" disabled={busy}>Cancel {what}</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Keep it</button>
      </div>
    </form>
  );
}

// Transfers — finance reviews: close, or send back to sales (unlinks the bank line)
export function TransferReviewPanel({ c, line, onDone }) {
  const [note, setNote] = useState('');
  const [back, setBack] = useState(false);
  const { busy, error, run } = useAction(onDone);
  const invTotal = c.settlement?.length ? c.settlement.reduce((t, s) => t + Number(s.remaining_amount), 0) : null;
  const differs = line && invTotal != null && Math.abs(Number(line.credit) - invTotal) >= 0.005;
  return (
    <div className="action">
      <h2>{back ? 'Send back to sales' : 'Review this transfer'}</h2>
      {!back && <p className="hint">Check the bank line, the receipt and the invoices below, then close it.</p>}
      {!back && differs && <p className="warn-text">Transfer LKR {lkr(line.credit)} vs invoices LKR {lkr(invTotal)}: {Number(line.credit) < invTotal ? 'short payment, settles the oldest invoices first' : 'overpayment, the excess stays unapplied'}.</p>}
      <label className="field"><span className="flabel">{back ? 'What needs fixing?' : 'Note (optional)'}</span>
        <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        {back ? (
          <>
            <button className="btn danger" disabled={busy} onClick={() => run(() => rpc('cc_send_back_transfer', { p_id: c.id, p_reason: note }))}>Send back</button>
            <button className="btn ghost" onClick={() => setBack(false)}>Back</button>
          </>
        ) : (
          <>
            <button className="btn primary" disabled={busy} onClick={() => run(() => rpc('cc_close_transfer', { p_id: c.id, p_note: note }))}>Checked, close it</button>
            <button className="btn ghost" onClick={() => setBack(true)}>Something's wrong</button>
          </>
        )}
      </div>
      {!back && c.account_id && <StatementView accountId={c.account_id} highlightIds={c.line_id ? [c.line_id] : []} focusDate={line?.txn_date} />}
    </div>
  );
}

// Transfers — relink after being sent back or reopened
export function RelinkPanel({ c, onDone, parked = false }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(c.account_id ? String(c.account_id) : '');
  const [line, setLine] = useState(null);
  const { busy, error, run } = useAction(onDone);
  useEffect(() => {
    db.from('bank_accounts').select('id, name').eq('active', true).order('name').then(({ data }) => setAccounts(data ?? []));
  }, []);
  return (
    <div className="action">
      <h2>{parked ? 'Link the bank line and send to finance' : 'Link to the right bank line'}</h2>
      {parked && <p className="hint">Parked: finance can't see this yet. When the payment shows on the bank statement in the app, pick its line here (exact amount LKR {lkr(c.expected_amount)}). If the bank amount differs, edit the entry first.</p>}
      <label className="field"><span className="flabel">Paid into</span>
        <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setLine(null); }}>
          <option value="">Choose the bank account</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></label>
      {accountId && <BankLinePicker accountId={Number(accountId)} exact={c.expected_amount} value={line?.id} onChange={setLine} />}
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy || !line} onClick={() => run(() => rpc(parked ? 'cc_send_parked' : 'cc_relink_transfer', { p_id: c.id, p_account_id: Number(accountId), p_line_id: line.id }))}>
        Link and send to finance
      </button>
      {accountId && <StatementView key={accountId} accountId={Number(accountId)} highlightIds={line ? [line.id] : []} focusDate={line?.txn_date} compact />}
    </div>
  );
}

// Sales — match a parked transfer to its bank line (any account) and send it to finance.
// Lines of the same amount, or a close one (the bank took charges), are offered best first.
export function ParkedMatchPanel({ c, onDone, lineId = null }) {
  const [entry, setEntry] = useState(null);
  const [pick, setPick] = useState(null);
  const [takeBank, setTakeBank] = useState(false);
  const { busy, error, run } = useAction(onDone);
  useEffect(() => {
    rpc('cc_parked_candidates', { p_id: c.id }).then((d) => {
      const e = d?.[0] ?? { lines: [] };
      setEntry(e);
      const pre = e.lines.find((l) => l.id === lineId) ?? (e.lines.length === 1 && e.lines[0].exact ? e.lines[0] : null);
      if (pre) setPick(pre);
    }).catch(() => setEntry({ lines: [] }));
  }, [c.id, c.collected_amount, lineId]);
  if (!entry) return <div className="action"><p className="muted">Looking for the bank line…</p></div>;
  const amt = Number(c.collected_amount);
  const diffText = (l) => `LKR ${lkr(Math.abs(Number(l.diff)))} ${Number(l.diff) < 0 ? 'less' : 'more'}`;
  return (
    <div className="action parked-match">
      <h2>Match it to the bank line and send to finance</h2>
      <p className="hint">Parked: finance can't see this yet. {entry.lines.length
        ? `These money-in lines could be this payment of LKR ${lkr(amt)}. Pick the right one.`
        : `No bank line of LKR ${lkr(amt)}, or close to it, is in the app yet. When finance uploads the statement it shows here, and you are told.`}</p>
      {entry.lines.length > 0 && (
        <ul className="pm-lines">
          {entry.lines.map((l) => (
            <li key={l.id} className={pick?.id === l.id ? 'on' : ''}>
              <label>
                <input type="radio" name="parked-line" checked={pick?.id === l.id} onChange={() => { setPick(l); setTakeBank(false); }} />
                <span className="lp-main">
                  <span className="lp-narr">{l.narration || '(no narration)'}</span>
                  <span className="lp-meta">
                    <span>{fmtDate(l.txn_date)}</span><span>{l.account_name}</span>
                    {l.reference && <span>Ref {l.reference}</span>}
                    {l.cheque_no && <span>Cheque {l.cheque_no}</span>}
                    {l.exact ? <span className="lp-exact">Same amount</span> : <span className="lp-close">{diffText(l)}</span>}
                    {l.names_customer && <span className="lp-exact">Customer's name</span>}
                    {l.cheque_match && <span className="lp-exact">Cheque number</span>}
                  </span>
                </span>
                <span className="num lp-amt">{lkr(l.credit)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {pick && !pick.exact && (
        <label className="check warn-box"><input type="checkbox" checked={takeBank} onChange={(e) => setTakeBank(e.target.checked)} />
          The bank received LKR {lkr(pick.credit)}, {diffText(pick)} than entered. Change this payment to LKR {lkr(pick.credit)} and link it.</label>
      )}
      {error && <p className="error">{error}</p>}
      {entry.lines.length > 0 && (
        <button className="btn primary" disabled={busy || !pick || (!pick.exact && !takeBank)}
          onClick={() => run(() => rpc('cc_link_parked', { p_id: c.id, p_line_id: pick.id, p_take_bank_amount: !pick.exact && takeBank }))}>
          Link and send to finance
        </button>
      )}
      <p className="hint">Not listed? If the customer paid a different amount, <Link to={`/transfer?edit=${c.id}`}>edit the parked entry</Link> first.</p>
    </div>
  );
}

// Finance — reopen a closed item
export function ReopenPanel({ c, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction(onDone);
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Reopen</button>;
  return (
    <div className="action cancel-box">
      <h2>Reopen {c.kind === 'transfer' ? 'this transfer' : 'this collection'}?</h2>
      <p className="hint">{c.kind === 'transfer'
        ? 'The bank line is unlinked and the transfer goes back to sales to relink.'
        : 'Its deposit slip is unlinked from the bank, so every collection on that slip goes back to "Deposited" until the slip is matched again.'}</p>
      <label className="field"><span className="flabel">Reason</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Linked to the wrong bank line" /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn danger" disabled={busy} onClick={() => run(() => rpc('cc_reopen', { p_id: c.id, p_reason: reason }))}>Reopen</button>
        <button className="btn ghost" onClick={() => setOpen(false)}>Keep closed</button>
      </div>
    </div>
  );
}

// Finance — mark one cheque as returned (bounced)
export function ReturnChequePanel({ c, cheques, onDone }) {
  const [open, setOpen] = useState(false);
  const [chequeId, setChequeId] = useState(cheques.length === 1 ? String(cheques[0].id) : '');
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction(onDone);
  if (!open) return <button className="btn ghost danger-text" onClick={() => setOpen(true)}>Mark a cheque returned</button>;
  return (
    <div className="action cancel-box">
      <h2>Cheque returned by the bank</h2>
      <p className="hint">The collection is marked Returned and sales is asked to raise a replacement.</p>
      {cheques.length > 1 && (
        <label className="field"><span className="flabel">Which cheque?</span>
          <select value={chequeId} onChange={(e) => setChequeId(e.target.value)}>
            <option value="">Choose</option>
            {cheques.map((q) => <option key={q.id} value={q.id}>No. {q.cheque_no}, LKR {lkr(q.amount)}</option>)}
          </select></label>
      )}
      <label className="field"><span className="flabel">Return reason</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Refer to drawer / insufficient funds" /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn danger" disabled={busy || !chequeId} onClick={() => run(() => rpc('cc_return_cheque', { p_cheque_id: Number(chequeId), p_reason: reason }))}>Mark returned</button>
        <button className="btn ghost" onClick={() => setOpen(false)}>Back</button>
      </div>
    </div>
  );
}

// Sales says which of its invoices each cheque pays (only when there are 2+ cheques).
export function SplitPanel({ c, cheques, onDone }) {
  const inv = (c.settlement ?? []).filter((s) => Number(s.remaining_amount) > 0);
  const [alloc, setAlloc] = useState(() => {
    const a = {};
    for (const q of cheques) for (const s of inv) if (Math.abs(Number(s.remaining_amount) - Number(q.amount)) < 0.005 && !Object.values(a).some((x) => x[s.document_no])) a[q.id] = { ...(a[q.id] ?? {}), [s.document_no]: String(q.amount) };
    return a;
  });
  const { busy, error, run } = useAction(onDone);
  const set = (qid, doc, v) => setAlloc((a) => ({ ...a, [qid]: { ...(a[qid] ?? {}), [doc]: v.replace(/[^0-9.]/g, '') } }));
  const qTotal = (qid) => Object.values(alloc[qid] ?? {}).reduce((t, v) => t + (Number(v) || 0), 0);
  const invTotal = (doc) => cheques.reduce((t, q) => t + (Number(alloc[q.id]?.[doc]) || 0), 0);
  const problems = [
    ...cheques.filter((q) => qTotal(q.id) === 0).map((q) => `Cheque ${q.cheque_no} has no invoices`),
    ...cheques.filter((q) => qTotal(q.id) > Number(q.amount) + 0.004).map((q) => `Cheque ${q.cheque_no}: more than LKR ${lkr(q.amount)} split onto it`),
    ...inv.filter((s) => invTotal(s.document_no) > Number(s.remaining_amount) + 0.004).map((s) => `${s.document_no}: more than its open LKR ${lkr(s.remaining_amount)}`),
  ];
  const payload = cheques.flatMap((q) => Object.entries(alloc[q.id] ?? {}).filter(([, v]) => Number(v) > 0).map(([doc, v]) => ({ cheque_id: q.id, document_no: doc, amount: Number(v) })));
  return (
    <div className="action">
      <h2>Which invoices does each cheque pay?</h2>
      <p className="hint">The customer gave {cheques.length} cheques. Using your invoice list, enter the amount of each invoice paid by each cheque. An invoice can be split across cheques; anything a cheque pays beyond its invoices stays unapplied on the customer.</p>
      <div className="table-wrap flat"><table className="table split-table">
        <thead><tr><th>Invoice (open LKR)</th>{cheques.map((q) => <th key={q.id} className="num">Cheque {q.cheque_no}<div className="muted small">LKR {lkr(q.amount)}</div></th>)}</tr></thead>
        <tbody>
          {inv.map((s) => (
            <tr key={s.document_no}><td>{s.document_no} <span className="muted">({lkr(s.remaining_amount)})</span></td>
              {cheques.map((q) => <td key={q.id}><input inputMode="decimal" className="num" value={alloc[q.id]?.[s.document_no] ?? ''} onChange={(e) => set(q.id, s.document_no, e.target.value)} placeholder="0" /></td>)}</tr>
          ))}
          <tr className="total-row"><td>On this cheque</td>{cheques.map((q) => <td key={q.id} className="num">{lkr(qTotal(q.id))}{Number(q.amount) - qTotal(q.id) > 0.004 && <div className="muted small">{lkr(Number(q.amount) - qTotal(q.id))} unapplied</div>}</td>)}</tr>
        </tbody>
      </table></div>
      {problems.map((p) => <p key={p} className="error">{p}</p>)}
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy || problems.length > 0} onClick={() => run(() => rpc('cc_split_cheques', { p_id: c.id, p_alloc: payload }))}>Save the split</button>
    </div>
  );
}

// Finance — reject a cheque collection back to Sales (new invoices / settlement instructions needed)
export const REJECTABLE = ['submitted', 'assigned', 'collected', 'received'];
export function RejectPanel({ c, onDone, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction(onDone);
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Reject: back to Sales</button>;
  return (
    <form className="action cancel-box" onSubmit={(e) => { e.preventDefault(); run(() => rpc('cc_reject', { p_id: c.id, p_note: note })); }}>
      <h2>Reject and send back to Sales?</h2>
      <p className="hint">For when Sales must change the invoices or the settlement instructions, for example because the cheque amount is different.
        Sales sees it as Rejected with your note, corrects it and sends it back; it then returns to this step.
        {c.status === 'assigned' && ' The driver is told not to collect it for now.'}</p>
      <label className="field"><span className="flabel">What should Sales change?</span>
        <textarea required rows="3" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Cheque is LKR 12,500, not 15,000. Tell us which invoices it pays." /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn danger" disabled={busy || !note.trim()}>Reject</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Keep it</button>
      </div>
    </form>
  );
}

// Sales — correct a rejected collection and send it back to finance
export function ResubmitPanel({ c, cheques, onDone }) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState((c.settlement ?? []).map((s) => s.document_no));
  const [invTotal, setInvTotal] = useState(null);
  const [instructions, setInstructions] = useState(c.settlement_instructions ?? '');
  const [amount, setAmount] = useState(c.expected_amount != null ? Number(c.expected_amount).toFixed(2) : '');
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction(onDone);
  const collected = ['collected', 'received'].includes(c.rejected_from);
  const chequeTotal = cheques.reduce((t, q) => t + Number(q.amount), 0);
  const target = collected ? chequeTotal : Number(String(amount).replace(/,/g, '')) || 0;
  const total = invTotal ?? (c.settlement ?? []).reduce((t, s) => t + Number(s.remaining_amount), 0);
  const diff = Math.round((target - total) * 100) / 100;

  return (
    <div className="action reject-box">
      <h2>Rejected by finance: correct it and send it back</h2>
      <p className="quote">{c.reject_note}</p>
      {!open ? (
        <div className="row"><button className="btn primary" onClick={() => setOpen(true)}>Reopen and correct</button></div>
      ) : (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          run(() => rpc('cc_resubmit', { p_id: c.id, p: { settlement_docs: docs, settlement_instructions: instructions, note,
            expected_amount: collected ? null : String(amount).replace(/,/g, '') } }));
        }}>
          {collected && <p className="hint">The driver collected {cheques.length === 1 ? 'a cheque' : `${cheques.length} cheques`} for <strong>LKR {lkr(chequeTotal)}</strong>.
            Tick the invoices it pays, add or remove invoices, and say how to settle them.</p>}
          {c.customer_no ? (
            <div className="field"><span className="flabel">Invoices being settled</span>
              <InvoicePicker customerNo={c.customer_no} selected={docs} snapshot={c.settlement ?? []} collectionId={c.id}
                onChange={(d, t) => { setDocs(d); setInvTotal(t); }} />
            </div>
          ) : <p className="hint">This customer isn't in the BC customer list, so there are no invoices to tick. Use the settlement instructions.</p>}
          {!collected && (
            <label className="field"><span className="flabel">Expected amount (LKR)</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          )}
          {docs.length > 0 && Math.abs(diff) >= 0.005 && target > 0 && (
            <p className="warn-text">{diff < 0
              ? `The ticked invoices are LKR ${lkr(-diff)} more than ${collected ? 'the cheque' : 'the expected amount'}: the oldest are settled first, unless your instructions say otherwise.`
              : `LKR ${lkr(diff)} more than the ticked invoices: the excess stays unapplied on the customer, unless your instructions say otherwise.`}</p>
          )}
          <label className="field"><span className="flabel">Settlement instructions{docs.length ? ' (optional)' : ''}</span>
            <textarea rows="2" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="E.g. BB-01435 in full, the balance to BB-01367" /></label>
          <label className="field"><span className="flabel">Note for finance (optional)</span>
            <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Customer short paid; balance next week" /></label>
          {cheques.length > 1 && <p className="hint">There are {cheques.length} cheques: after you send it, you'll be asked again which invoices each cheque pays.</p>}
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="btn primary" disabled={busy || (!docs.length && !instructions.trim())}>Send back to finance</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Close</button>
          </div>
        </form>
      )}
    </div>
  );
}
