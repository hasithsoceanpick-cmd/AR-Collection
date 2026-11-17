import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { fmtDateTime, daysAgo } from '../lib/format';
import { useAuth } from '../lib/auth';

// Finance: when an item is waiting on Sales or the driver, remind them.
// The reminder goes to their notifications (and the item's history).
// cash = a cash handover (id is the handover id); otherwise a collection.
export default function Reminders({ id, cash = false, watch, onDone }) {
  const [targets, setTargets] = useState([]);
  const load = useCallback(() => rpc(cash ? 'cc_cash_reminder_targets' : 'cc_reminder_targets', { p_id: id })
    .then((d) => setTargets(d ?? [])).catch(() => setTargets([])), [id, cash]);
  useEffect(() => { load(); }, [load, watch]);
  if (!targets.length) return null;
  return targets.map((t) => (
    <Reminder key={`${t.to_role}-${t.to_user}`} t={t}
      send={(note) => rpc(cash ? 'cc_cash_remind' : 'cc_remind', cash ? { p_id: id, p_note: note } : { p_id: id, p_to: t.to_role, p_note: note })}
      onSent={async () => { await load(); await onDone?.(); }} />
  ));
}

function Reminder({ t, send, onSent }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const first = t.to_name?.split(' ')[0] ?? 'them';
  const days = daysAgo(t.waiting_since);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(''); setSent(false);
    try { await send(note); await onSent(); setOpen(false); setNote(''); setSent(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="remind">
      <p className="remind-what">
        <strong>Waiting on {t.to_name}{t.to_label ? ` (${t.to_label})` : ''}</strong>
        {days > 0 && ` for ${days} day${days === 1 ? '' : 's'}`}: {t.task}.
      </p>
      {t.last_at && <p className="hint">Last reminded by {t.last_by} on {fmtDateTime(t.last_at)}.</p>}
      {sent && <p className="ok-text">Reminder sent to {first}.</p>}
      {!t.can_remind ? (
        <p className="hint">{t.to_user === session.user.id ? "It's waiting on you." : `${t.to_name} no longer has access to the app, so can't be reminded.`}</p>
      ) : !open ? (
        <div className="row"><button className="btn" onClick={() => { setOpen(true); setSent(false); setError(''); }}>Send a reminder to {first}</button></div>
      ) : (
        <form className="remind-form" onSubmit={submit}>
          <label className="field"><span className="flabel">Note for {first} (optional)</span>
            <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The customer is asking. Please do it today." /></label>
          <div className="row">
            <button className="btn primary" disabled={busy}>Send reminder</button>
            <button type="button" className="btn ghost" onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// Finance: remind Sales about unidentified money in the bank — one line (lineId),
// or every unidentified line at once (no lineId). To everyone in Sales, or one person.
export function SalesReminderForm({ lineId = null, people, onSent, onCancel }) {
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const who = lineId
        ? await rpc('cc_remind_line', { p_line_id: lineId, p_to: to || null, p_note: note })
        : await rpc('cc_remind_unidentified', { p_to: to || null, p_note: note });
      await onSent(who);
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <form className="remind-form" onSubmit={submit}>
      <div className="row-2">
        <label className="field"><span className="flabel">Remind</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Everyone in Sales</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
          </select></label>
        <label className="field"><span className="flabel">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={lineId ? 'e.g. Could this be Kandoori?' : 'e.g. Month end is on Friday.'} /></label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy}>Send reminder</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
