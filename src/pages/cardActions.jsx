import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc, db } from '../lib/supabase';
import { lkr, fmtDate } from '../lib/format';
import DraftPicker, { cardNo } from '../components/DraftPicker';
import ReceiptFiles from '../components/ReceiptFiles';

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

// The merchant statement sale this card payment is set off against (if any).
export function useCardDraft(c) {
  const [draft, setDraft] = useState(undefined);
  useEffect(() => {
    if (c?.kind !== 'card') return;
    db.from('merchant_drafts').select('*, batch:merchant_batches(id, hnbms_no, pres_date, line_id)').eq('collection_id', c.id).maybeSingle()
      .then(({ data }) => setDraft(data ?? null));
  }, [c?.id, c?.kind, c?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  return draft;
}

export function CardFacts({ c, draft, photosGone, canEditFiles = false, onDone }) {
  return (
    <div className="facts">
      <h2>Card</h2>
      <dl>
        <dt>Charged on</dt><dd>{fmtDate(c.card_date)}</dd>
        <dt>Card ending</dt><dd>{c.card_last4 || <span className="muted">not given</span>}</dd>
        <dt>Merchant statement</dt>
        <dd>{draft === undefined ? '…' : draft ? (
          <>
            <Link to={`/merchant?batch=${draft.batch.id}`}>{draft.batch.hnbms_no}</Link>, batch {fmtDate(draft.batch.pres_date)}:
            sale on {fmtDate(draft.txn_date)}, card {cardNo(draft.card_first6, draft.card_last4)}, LKR {lkr(draft.amount)}
            <div className="muted small">HNB commission LKR {lkr(draft.commission)}, net paid into Amana LKR {lkr(draft.net)}</div>
            {draft.card_last4 && c.card_last4 && draft.card_last4 !== c.card_last4 && <div className="warn-text small">The slip's card ending ({c.card_last4}) differs from the statement ({draft.card_last4}); Sales confirmed it.</div>}
          </>
        ) : <span className="muted">Not set off yet</span>}</dd>
      </dl>
      <ReceiptFiles c={c} label="Card slip" short="slip" kind="card-slip" photosGone={photosGone} canEdit={canEditFiles} onDone={onDone} />
      {c.notes && <p className="quote">Notes: {c.notes}</p>}
    </div>
  );
}

// Sales: set a parked card payment off against its sale and send it to finance.
export function CardSetOffPanel({ c, onDone }) {
  const [draft, setDraft] = useState(null);
  const [ok, setOk] = useState(false);
  const { busy, error, run } = useAction(onDone);
  const mismatch = draft && draft.card_last4 && c.card_last4 && draft.card_last4 !== c.card_last4;
  return (
    <div className="action">
      <h2>Set off against the merchant statement</h2>
      <p className="hint">Parked: finance can't see this yet. Once the merchant statement with this sale is in the app, pick the sale
        (LKR {lkr(c.collected_amount)}, within a day of {fmtDate(c.card_date)}) and send it. If the amount or date was wrong, change the entry first.</p>
      <DraftPicker amount={Number(c.collected_amount)} cardDate={c.card_date} value={draft} onChange={(d) => { setDraft(d); setOk(false); }} />
      {mismatch && (
        <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          The statement shows the card ending {draft.card_last4}, the slip {c.card_last4}. I've checked: this is the right sale.</label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy || !draft || (mismatch && !ok)}
          onClick={() => run(() => rpc('cc_card_send', { p_id: c.id, p_draft_id: draft.draft_id, p_allow_mismatch: Boolean(mismatch && ok) }))}>
          Set off and send to finance</button>
        <Link className="btn" to={`/card?edit=${c.id}`}>Change the entry</Link>
      </div>
    </div>
  );
}

// Finance: accept a card payment, or send it back to Sales (the sale is freed for another set-off).
export function CardReviewPanel({ c, draft, onDone }) {
  const [note, setNote] = useState('');
  const [back, setBack] = useState(c.status === 'closed');
  const { busy, error, run } = useAction(onDone);
  const invTotal = c.settlement?.length ? c.settlement.reduce((t, s) => t + Number(s.remaining_amount), 0) : null;
  const differs = invTotal != null && Math.abs(Number(c.collected_amount) - invTotal) >= 0.005;
  return (
    <div className="action">
      <h2>{back ? 'Send back to Sales' : 'Review this card payment'}</h2>
      {!back && <p className="hint">Check the sale on the merchant statement, the slip and the invoices, then close it. The batch goes to BC once every sale on it is closed and its Amana credit is matched.</p>}
      {back && <p className="hint">The payment goes back to Sales as parked, and its sale on the statement is freed so it can be set off again.</p>}
      {!back && differs && <p className="warn-text">Card LKR {lkr(c.collected_amount)} vs invoices LKR {lkr(invTotal)}: {Number(c.collected_amount) < invTotal ? 'short payment, settles the oldest invoices first' : 'overpayment, the excess stays unapplied'}.</p>}
      {!back && draft === null && <p className="error">Not set off against a sale. Send it back to Sales.</p>}
      <label className="field"><span className="flabel">{back ? 'What needs correcting?' : 'Note (optional)'}</span>
        <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        {back ? (
          <>
            <button className="btn danger" disabled={busy} onClick={() => run(() => rpc('cc_card_send_back', { p_id: c.id, p_reason: note }))}>Send back</button>
            {c.status === 'review' && <button className="btn ghost" onClick={() => setBack(false)}>Back</button>}
          </>
        ) : (
          <>
            <button className="btn primary" disabled={busy || !draft} onClick={() => run(() => rpc('cc_card_close', { p_id: c.id, p_note: note }))}>Checked, close it</button>
            <button className="btn ghost" onClick={() => setBack(true)}>Something's wrong</button>
          </>
        )}
      </div>
    </div>
  );
}

// Finance: send a closed card payment back (only while its batch isn't exported).
export function CardReopenPanel({ c, draft, onDone }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Send back to Sales</button>;
  return <CardReviewPanel c={c} draft={draft} onDone={onDone} />;
}
