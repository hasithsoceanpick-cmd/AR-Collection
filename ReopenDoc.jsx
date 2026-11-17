import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { lkr, fmtDate, fmtDateTime } from '../lib/format';

// Finance Admins: a document the app counts as posted in BC, but BC doesn't have it.
// Shows why the app thinks it's posted, then reopens it so it can be exported to BC again.
export default function ReopenDoc({ docNo, onDone, label = 'Not in BC? Reopen it' }) {
  const { role, isAdmin } = useAuth();
  const [ev, setEv] = useState(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('same');
  const [entries, setEntries] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  if (!(role === 'finance' && isAdmin) || !docNo) return null;

  async function start() {
    setOpen(true); setError(''); setDone(null);
    try {
      const e = await rpc('cc_bc_doc_evidence', { p_doc_no: docNo });
      setEv(e); setMode(e.can_keep_number ? 'same' : 'new'); setEntries('');
    } catch (err) { setError(err.message); }
  }
  async function reopen(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const bc = ev.live_bank || ev.live_cust;
      await rpc('cc_bc_reopen', { p_doc_id: ev.id, p_note: note, p_new_number: mode === 'new', p_entries: mode === 'new' && bc ? entries : null });
      setDone(mode); setOpen(false);
      await onDone?.(mode === 'same'
        ? `${docNo} reopened. It is in Export to BC under "Exported, not posted yet": download it again from there (same number).`
        : `${docNo} reopened. What it covered is back in Export to BC as new and gets the next BAKRC number when you export it.`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (done) return (
    <p className="ok-text small reopen-done">
      {docNo} reopened. {done === 'same'
        ? <>It is in <Link to="/bc-export">Export to BC</Link> under &quot;Exported, not posted yet&quot;: download it again from there (same number).</>
        : <>It is back in <Link to="/bc-export">Export to BC</Link> as new and gets the next BAKRC number when you export it.</>}
    </p>
  );
  if (!open) return <button type="button" className="link small" onClick={start}>{label}</button>;
  if (!ev) return <div className="reopen">{error ? <p className="error">{error}</p> : <p className="muted">Checking {docNo}…</p>}</div>;

  const hasBc = ev.live_bank || ev.live_cust;
  const live = (ev.bank_entries ?? []).filter((x) => !x.reversed);
  return (
    <form className="reopen" onSubmit={reopen}>
      <h3>Reopen {ev.doc_no}</h3>
      <p className="small">{ev.kind === 'card batch' ? `Card batch ${ev.item}` : ev.kind === 'PayHere payout' ? ev.item : ev.kind === 'cash receipt' ? `Cash receipt ${ev.item}` : `Bank line: ${ev.item ?? ''}`}
        {' · '}LKR {lkr(ev.total)} on {fmtDate(ev.posting_date)} · exported {ev.export_count}×</p>
      <div className="reopen-why">
        <strong>Why the app counts it as posted</strong>
        <ul className="plain">{(ev.why ?? []).map((w) => <li key={w}>{w}</li>)}</ul>
        {live.length > 0 && (
          <div className="table-wrap flat"><table className="table small">
            <thead><tr><th>BC entry</th><th className="hide-sm">Bank</th><th>Date</th><th className="num">LKR</th><th className="hide-sm">Uploaded</th></tr></thead>
            <tbody>{live.map((x) => <tr key={x.entry_no}><td>{x.entry_no}</td><td className="hide-sm">{x.bank_code}</td><td>{fmtDate(x.posting_date)}</td><td className="num">{lkr(x.amount)}</td><td className="hide-sm">{fmtDateTime(x.uploaded_at)}</td></tr>)}</tbody>
          </table></div>
        )}
        <p className="muted small">BC ledgers last uploaded: bank {ev.bank_upload_at ? fmtDateTime(ev.bank_upload_at) : 'never'}, customer {ev.cust_upload_at ? fmtDateTime(ev.cust_upload_at) : 'never'}.</p>
      </div>

      {ev.can_keep_number ? (
        <fieldset className="reopen-opt">
          <label><input type="radio" name="rm" checked={mode === 'same'} onChange={() => setMode('same')} />
            <span>Export it again with the same number, {ev.doc_no} <span className="muted small">(nothing in the BC ledgers uploaded is under it)</span></span></label>
          {ev.can_new_number && <label><input type="radio" name="rm" checked={mode === 'new'} onChange={() => setMode('new')} />
            <span>Give it a new BAKRC number <span className="muted small">(e.g. {ev.doc_no} is already used in BC for something else)</span></span></label>}
        </fieldset>
      ) : !ev.can_new_number ? (
        <p className="warn-text">The BC ledgers uploaded have entries under {ev.doc_no}. A cash receipt keeps its CSHRC number: if BC doesn&apos;t have it, upload a newer
          customer ledger, or send the receipt back to give it a new number.</p>
      ) : (
        <fieldset className="reopen-opt">
          <p className="small">The BC ledgers uploaded have entries under {ev.doc_no}, so it is exported again under a <strong>new</strong> BAKRC number.
            Look the number up in Business Central first. What are those entries?</p>
          <label><input type="radio" name="re" checked={entries === 'not_in_bc'} onChange={() => setEntries('not_in_bc')} />
            <span>Not in BC, or reversed there <span className="muted small">(the app stops counting them; a newer upload that still shows them brings them back)</span></span></label>
          <label><input type="radio" name="re" checked={entries === 'other_document'} onChange={() => setEntries('other_document')} />
            <span>A different BC document that uses the same number <span className="muted small">(left as they are)</span></span></label>
        </fieldset>
      )}

      {(ev.can_keep_number || ev.can_new_number) && (
        <>
          <label className="field"><span className="flabel">Why isn&apos;t it posted in BC?</span>
            <textarea required rows="2" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="E.g. the journal was never imported; checked Amana bank ledger in BC on 7 Nov" /></label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="btn small primary" disabled={busy || !note.trim() || (mode === 'new' && hasBc && !entries)}>
              {busy ? 'Reopening…' : mode === 'same' ? `Reopen ${ev.doc_no}` : 'Reopen under a new number'}</button>
            <button type="button" className="link" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      )}
      {!(ev.can_keep_number || ev.can_new_number) && <div className="row"><button type="button" className="link" onClick={() => setOpen(false)}>Close</button></div>}
    </form>
  );
}
