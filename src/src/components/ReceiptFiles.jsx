import { useState } from 'react';
import { rpc } from '../lib/supabase';
import SignedImage from './SignedImage';
import ReceiptInput, { keptItems, uploadReceiptItems } from './ReceiptInput';

// A transfer's receipt or a card payment's slip: every file, and (for whoever recorded it,
// while it is still open) adding or removing files.
export default function ReceiptFiles({ c, label, short, kind, photosGone, canEdit, onDone }) {
  const paths = [c.receipt_path, ...(c.receipt_more ?? [])].filter(Boolean);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await rpc('cc_set_receipt_files', { p_id: c.id, p_paths: await uploadReceiptItems(items, kind) });
      setItems(null);
      await onDone();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <>
      <h2>{label}{paths.length > 1 ? ` (${paths.length} files)` : ''}</h2>
      {paths.length ? (photosGone ? <div className="img-missing">{label} deleted after backup</div> : (
        <div className="slip-photos">
          {paths.map((p, i) => <div className="slip-photo" key={p}><SignedImage path={p} alt={paths.length > 1 ? `${label} ${i + 1}` : label} /></div>)}
        </div>
      )) : <p>No {short}. Reason given: {c.no_receipt_reason}</p>}
      {canEdit && !photosGone && items === null && (
        <p><button className="btn small" onClick={() => { setItems(keptItems(c)); setError(''); }}>{paths.length ? 'Add or remove files' : `Attach the ${short}`}</button></p>
      )}
      {items !== null && (
        <form className="action quiet receipt-edit" onSubmit={save}>
          <ReceiptInput label={`${label}: one or more photos or PDFs`} items={items} onChange={setItems} />
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="btn primary" disabled={busy || (!items.length && !c.no_receipt_reason)}>{busy ? 'Saving…' : 'Save files'}</button>
            <button type="button" className="btn ghost" onClick={() => setItems(null)}>Cancel</button>
          </div>
        </form>
      )}
    </>
  );
}
