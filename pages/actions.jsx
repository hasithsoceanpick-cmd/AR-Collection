import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, rpc, uploadPhoto, db } from '../lib/supabase';
import BankLinePicker from '../components/BankLinePicker';
import StatementView from '../components/StatementView';
import { lkr, todayISO } from '../lib/format';
import PhotoInput from '../components/PhotoInput';

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
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy} onClick={() => run(() => rpc('cc_receive', { p_id: c.id }))}>
        I have the cheques
      </button>
    </div>
  );
}

export function CancelPanel({ c, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction(onDone);
  if (!open) return <button className="btn ghost danger-text" onClick={() => setOpen(true)}>Cancel collection</button>;
  return (
    <form className="action cancel-box" onSubmit={(e) => { e.preventDefault(); run(() => rpc('cc_cancel', { p_id: c.id, p_reason: reason })); }}>
      <h2>Cancel this collection?</h2>
      <label className="field"><span className="flabel">Reason</span>
        <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer paid by bank transfer" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn danger" disabled={busy}>Cancel collection</button>
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
export function RelinkPanel({ c, onDone }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(c.account_id ? String(c.account_id) : '');
  const [line, setLine] = useState(null);
  const { busy, error, run } = useAction(onDone);
  useEffect(() => {
    db.from('bank_accounts').select('id, name').eq('active', true).order('name').then(({ data }) => setAccounts(data ?? []));
  }, []);
  return (
    <div className="action">
      <h2>Link to the right bank line</h2>
      <label className="field"><span className="flabel">Paid into</span>
        <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setLine(null); }}>
          <option value="">Choose the bank account</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></label>
      {accountId && <BankLinePicker accountId={Number(accountId)} exact={c.expected_amount} value={line?.id} onChange={setLine} />}
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy || !line} onClick={() => run(() => rpc('cc_relink_transfer', { p_id: c.id, p_account_id: Number(accountId), p_line_id: line.id }))}>
        Link and send to finance
      </button>
      {accountId && <StatementView key={accountId} accountId={Number(accountId)} highlightIds={line ? [line.id] : []} focusDate={line?.txn_date} compact />}
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
