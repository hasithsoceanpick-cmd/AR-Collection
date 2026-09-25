import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, rpc, uploadPhoto, BUCKET } from '../lib/supabase';
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
    supabase.from('profiles').select('id, full_name, email').eq('role', 'driver').eq('active', true)
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

// Step 6 — deposit slip
export function DepositPanel({ c, onDone }) {
  const [date, setDate] = useState(todayISO());
  const [reference, setReference] = useState('');
  const [slip, setSlip] = useState(null);
  const { busy, error, run } = useAction(onDone);
  return (
    <form className="action" onSubmit={(e) => { e.preventDefault(); run(async () => {
      if (!slip) throw new Error('Take a photo of the deposit slip first.');
      const path = await uploadPhoto(c.id, 'deposit-slip', slip);
      await rpc('cc_deposit', { p_id: c.id, p_date: date, p_reference: reference, p_slip_path: path });
    }); }}>
      <h2>Record the deposit</h2>
      <PhotoInput label="Photo of the deposit slip" value={slip} onChange={setSlip} />
      <div className="grid2">
        <label className="field"><span className="flabel">Deposit date</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field"><span className="flabel">Slip or reference number</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy}>Save deposit</button>
    </form>
  );
}

// Step 7 — finance verifies and closes
export function ClosePanel({ c, onDone }) {
  const [note, setNote] = useState('');
  const [sendBack, setSendBack] = useState(false);
  const { busy, error, run } = useAction(onDone);

  async function returnIt() {
    if (!note.trim()) throw new Error('Say what is wrong with the deposit.');
    const old = c.deposit_slip_path;
    await rpc('cc_return_deposit', { p_id: c.id, p_note: note });
    if (old) await supabase.storage.from(BUCKET).remove([old]);
  }

  return (
    <div className="action">
      <h2>{sendBack ? 'Send the deposit back' : 'Verify the deposit'}</h2>
      <p className="hint">
        {sendBack ? 'The slip will be removed and the deposit can be recorded again.'
          : `Check LKR ${lkr(c.collected_amount)} reached the bank, then close the collection.`}
      </p>
      <label className="field"><span className="flabel">{sendBack ? 'What is wrong?' : 'Note (optional)'}</span>
        <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        {sendBack ? (
          <>
            <button className="btn danger" disabled={busy} onClick={() => run(returnIt)}>Send back</button>
            <button className="btn ghost" onClick={() => setSendBack(false)}>Back</button>
          </>
        ) : (
          <>
            <button className="btn primary" disabled={busy} onClick={() => run(() => rpc('cc_close', { p_id: c.id, p_note: note }))}>
              Verify and close
            </button>
            <button className="btn ghost" onClick={() => setSendBack(true)}>Something's wrong</button>
          </>
        )}
      </div>
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
