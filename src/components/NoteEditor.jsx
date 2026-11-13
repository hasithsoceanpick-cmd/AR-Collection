import { useState } from 'react';
import { rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { dmy } from '../lib/followup';

// A note on a customer line (docNo null) or an invoice line. Each save keeps the old version in the history.
// Ctrl+Enter saves, Esc cancels, so notes can be typed quickly during the review.
export default function NoteEditor({ customerNo, docNo = null, note, canWrite, onSaved, placeholder }) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const what = docNo ? `note on ${docNo}` : 'note';

  function start() { setText(note?.text ?? ''); setErr(''); setEditing(true); }
  async function save(value) {
    setBusy(true); setErr('');
    try {
      const id = await rpc('cc_ar_note', { p_customer_no: customerNo, p_doc_no: docNo, p_note: value });
      const v = value.trim();
      setEditing(false);
      await onSaved?.(v ? { id, text: v, by: profile?.full_name ?? 'You', at: new Date().toISOString() } : null);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <form className="fu-noteed" onSubmit={(e) => { e.preventDefault(); save(text); }}>
        <textarea rows="2" value={text} maxLength={2000} autoFocus aria-label={what[0].toUpperCase() + what.slice(1)}
          placeholder={placeholder ?? (docNo ? 'Note on this invoice' : 'Note on this customer')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(text); }
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
          }} />
        <div className="fu-noteed-act">
          <button className="btn small primary" type="submit" disabled={busy || (!text.trim() && !note)}>{busy ? 'Saving…' : 'Save note'}</button>
          <button className="link small" type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          {note && <button className="link small fu-clear" type="button" onClick={() => save('')} disabled={busy}>Clear note</button>}
          <span className="muted small fu-keys">Ctrl+Enter saves</span>
        </div>
        {err && <p className="error small">{err}</p>}
      </form>
    );
  }
  if (note) {
    return (
      <p className="fu-noteline">
        <span className="fu-notetext">{note.text}</span>
        <span className="muted small"> · {note.by}, {dmy(note.at)}</span>
        {canWrite && <> <button type="button" className="link small" onClick={start} aria-label={`Edit the ${what}`}>Edit</button></>}
      </p>
    );
  }
  return canWrite ? <button type="button" className="link small fu-addnote" onClick={start} aria-label={`Add a ${what}`}>Add note</button> : null;
}
