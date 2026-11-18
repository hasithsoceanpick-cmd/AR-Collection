import { useState } from 'react';
import { rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { dmy, addDays } from '../lib/followup';
import { todayISO } from '../lib/format';

const short = (t) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

// Write or edit a note: the text, an optional due date and (finance, new notes) whether Sales see it.
// Ctrl+Enter saves, Esc cancels, so notes can be typed quickly during the review.
function NoteForm({ customerNo, docNo, note = null, finance, onDone }) {
  const [text, setText] = useState(note?.text ?? '');
  const [due, setDue] = useState(note?.due_on ?? '');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const today = todayISO();
  const what = docNo ? `note on ${docNo}` : 'note';
  async function save() {
    if (!text.trim()) { setErr('Write the note'); return; }
    setBusy(true); setErr('');
    try {
      if (note) await rpc('cc_ar_note_edit', { p_id: note.id, p_text: text, p_due_on: due || null });
      else await rpc('cc_ar_note_add', { p_customer_no: customerNo, p_doc_no: docNo, p_text: text, p_due_on: due || null, p_shared: finance && shared });
      await onDone(true);
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <form className="fu-noteed" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <textarea rows="2" value={text} maxLength={2000} autoFocus aria-label={note ? 'Edit the note' : what[0].toUpperCase() + what.slice(1)}
        placeholder={docNo ? 'Note on this invoice: what needs doing?' : 'Note on this customer: what needs doing?'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
          if (e.key === 'Escape') { e.preventDefault(); onDone(false); }
        }} />
      <div className="fu-noteed-act">
        <label className="note-due-field small">Due <input type="date" value={due} min={note?.due_on && note.due_on < today ? note.due_on : today} max={addDays(today, 366)}
          onChange={(e) => setDue(e.target.value)} aria-label="Due date (optional)" /></label>
        {due && <span className="muted small fu-dmy">{dmy(due)}</span>}
        {due && <button type="button" className="link small" onClick={() => setDue('')}>No date</button>}
        {finance && !note && <label className="note-share small"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Show to Sales</label>}
      </div>
      <div className="fu-noteed-act">
        <button className="btn small primary" type="submit" disabled={busy || !text.trim()}>{busy ? 'Saving…' : note ? 'Save changes' : 'Add note'}</button>
        <button className="link small" type="button" onClick={() => onDone(false)} disabled={busy}>Cancel</button>
        <span className="muted small fu-keys">Ctrl+Enter saves</span>
      </div>
      {err && <p className="error small">{err}</p>}
    </form>
  );
}

// One note (an action point): tick it off when it's done, edit it (its writer), show it to Sales (finance).
function NoteItem({ n, customerNo, showDoc, finance, compact, onChanged }) {
  const [mode, setMode] = useState(null);   // null | 'edit' | 'clear'
  const [how, setHow] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function act(fn, args) {
    setBusy(true); setErr('');
    try { await rpc(fn, args); setMode(null); setHow(''); await onChanged?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const cleared = !!n.cleared_at;
  if (mode === 'edit') {
    return <li className="ap-note"><NoteForm customerNo={customerNo} docNo={n.doc_no} note={n} finance={finance} onDone={async (saved) => { setMode(null); if (saved) await onChanged?.(); }} /></li>;
  }
  return (
    <li className={`ap-note${n.overdue ? ' note-late' : ''}${cleared ? ' note-cleared-item' : ''}`}>
      {!cleared && n.can_clear && mode !== 'clear'
        ? <button type="button" className="note-check" onClick={() => setMode('clear')} aria-label={`Tick off: ${short(n.text)}`} title="Tick off when done" />
        : <span className={`note-check${cleared ? ' done' : ' none'}`} aria-hidden="true" />}
      <div className="note-body">
        <p className="fu-noteline">
          {showDoc && n.doc_no && <strong className="note-doc">{n.doc_no}: </strong>}
          <span className="fu-notetext">{n.text}</span>
          <span className="muted small"> · {n.by}, {dmy(n.at)}{n.edited ? ' (edited)' : ''}</span>
          {n.due_on && !cleared && <span className={`note-due${n.overdue ? ' late' : ''}`}>{n.overdue ? 'Overdue since' : 'Due'} {dmy(n.due_on)}</span>}
          {n.shared && <span className="note-shared small" title="Finance has shown this note to the customer's owner">Shown to Sales</span>}
        </p>
        {cleared && (
          <p className="muted small note-cleared">Ticked off by {n.cleared_by}, {dmy(n.cleared_at)}{n.cleared_note ? `: ${n.cleared_note}` : ''}
            {n.can_clear && <> <button type="button" className="link small" disabled={busy} onClick={() => act('cc_ar_note_reopen', { p_id: n.id })}>Open again</button></>}</p>
        )}
        {mode === 'clear' && (
          <form className="note-clear" onSubmit={(e) => { e.preventDefault(); act('cc_ar_note_clear', { p_id: n.id, p_note: how || null }); }}>
            <input value={how} maxLength={500} autoFocus onChange={(e) => setHow(e.target.value)} placeholder="How was it resolved? (optional)" aria-label="How it was resolved (optional)"
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setMode(null); } }} />
            <button className="btn small primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Tick off'}</button>
            <button className="link small" type="button" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
          </form>
        )}
        {!cleared && mode === null && (n.can_edit || (n.can_share && !compact)) && (
          <div className="note-act">
            {n.can_edit && <button type="button" className="link small" onClick={() => setMode('edit')} aria-label={`Edit the note: ${short(n.text)}`}>Edit</button>}
            {n.can_share && !compact && <label className="note-share small"><input type="checkbox" checked={!!n.shared} disabled={busy}
              onChange={(e) => act('cc_ar_note_share', { p_id: n.id, p_shared: e.target.checked })} aria-label={`Show to Sales: ${short(n.text)}`} /> Show to Sales</label>}
          </div>
        )}
        {err && <p className="error small">{err}</p>}
      </div>
    </li>
  );
}

// Notes (action points) on a customer line (docNo null) or an invoice: newest first. compact shows the latest and "+n more".
// onChanged is called after any change so the page can reload what it shows.
export default function NotesList({ customerNo, docNo = null, notes = [], canWrite, compact = false, showDoc = false, onChanged }) {
  const { role } = useAuth();
  const finance = role === 'finance';
  const [adding, setAdding] = useState(false);
  const [all, setAll] = useState(false);
  const list = notes ?? [];
  const shown = compact && !all ? list.slice(0, 1) : list;
  const more = list.length - shown.length;
  const what = docNo ? `note on ${docNo}` : 'note';
  return (
    <div className={`ap-notes${compact ? ' compact' : ''}`}>
      {shown.length > 0 && (
        <ul className="notes-list">
          {shown.map((n) => <NoteItem key={n.id} n={n} customerNo={customerNo} showDoc={showDoc} finance={finance} compact={compact} onChanged={onChanged} />)}
        </ul>
      )}
      {adding && <NoteForm customerNo={customerNo} docNo={docNo} finance={finance} onDone={async (saved) => { setAdding(false); if (saved) await onChanged?.(); }} />}
      {(more > 0 || (compact && all && list.length > 1) || (canWrite && !adding)) && (
        <div className="notes-act">
          {more > 0 && <button type="button" className="link small" onClick={() => setAll(true)}>+{more} more</button>}
          {compact && all && list.length > 1 && <button type="button" className="link small" onClick={() => setAll(false)}>Show fewer</button>}
          {canWrite && !adding && <button type="button" className="link small fu-addnote" onClick={() => setAdding(true)} aria-label={`Add a ${what}`}>Add note</button>}
        </div>
      )}
    </div>
  );
}
