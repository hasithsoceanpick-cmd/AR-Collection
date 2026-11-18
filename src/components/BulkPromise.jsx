import { useState } from 'react';
import { rpc } from '../lib/supabase';
import { lkr } from '../lib/format';
import { addDays, dmy } from '../lib/followup';

// Several invoices ticked, one expected collection date. Each invoice gets its own promise for what is open on it.
// picked: the ticked document numbers; choices: how many could be ticked (for the hint). onSaved runs after a save.
export default function BulkPromise({ customerNo, picked, pickedTotal, choices, today, onSaved, onClear }) {
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const res = await rpc('cc_ar_promise_invoices', { p_customer_no: customerNo, p_docs: picked, p_promised_on: date });
      setMsg({ ...res, date });
      onClear();
      await onSaved?.();
    } catch (x) { setMsg({ error: x.message }); } finally { setBusy(false); }
  }
  return (
    <>
      {choices > 1 && picked.length === 0 && !msg && (
        <p className="muted small aging-bulk-hint">Tick several invoices to give them one expected collection date.</p>
      )}
      {picked.length > 0 && (
        <form className="aging-bulk" onSubmit={submit} aria-label="Set one promised date for the ticked invoices">
          <strong>{picked.length} invoice{picked.length === 1 ? '' : 's'} ticked</strong>
          <span className="muted">LKR {lkr(pickedTotal)}</span>
          <label className="aging-bulk-date"><span className="small">Expected collection date</span>
            <input type="date" min={today} max={addDays(today, 180)} value={date} onChange={(e) => setDate(e.target.value)} required
              aria-label="Expected collection date for the ticked invoices" /></label>
          <span className="muted small fu-dmy" aria-live="polite">{date ? dmy(date) : ''}</span>
          <button className="btn small primary" type="submit" disabled={busy || !date}>{busy ? 'Saving…' : 'Set promised date'}</button>
          <button className="link small" type="button" onClick={onClear} disabled={busy}>Clear</button>
          <span className="muted small">Each invoice is promised for what is open on it.</span>
        </form>
      )}
      {msg && (
        <div className={`aging-bulk-msg${msg.error ? ' error' : ''}`} role="status">
          {msg.error ? msg.error : <>
            {msg.set > 0 && <span>Promised by <strong>{dmy(msg.date)}</strong>: {msg.set} invoice{msg.set === 1 ? '' : 's'}. </span>}
            {msg.unchanged > 0 && <span>{msg.unchanged} already promised by that date. </span>}
            {msg.skipped?.length > 0 && <span>Not set:</span>}
            {msg.skipped?.length > 0 && <ul>{msg.skipped.map((x) => <li key={x.doc_no}>{x.reason.includes(x.doc_no) ? x.reason : <><strong>{x.doc_no}</strong>: {x.reason}</>}</li>)}</ul>}
          </>}
          <button type="button" className="link small" onClick={() => setMsg(null)}>Dismiss</button>
        </div>
      )}
    </>
  );
}
