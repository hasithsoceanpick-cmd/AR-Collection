import { useRef, useState } from 'react';
import { compressImage } from '../lib/image';
import { uploadMine, rpc } from '../lib/supabase';

export const MAX_RECEIPT_FILES = 10;
let seq = 0;

// Several files for one receipt: photos (compressed) or PDFs (as is, up to 10 MB each).
// items: [{ key, path }] for files already saved, [{ key, blob, ext, type, name }] for new ones.
export default function ReceiptInput({ label, items, onChange }) {
  const camRef = useRef(null);
  const fileRef = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const room = MAX_RECEIPT_FILES - items.length;

  async function pick(e) {
    const picked = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!picked.length) return;
    setError(''); setBusy(true);
    const added = []; const problems = [];
    for (const f of picked.slice(0, room)) {
      try {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name} is over 10 MB. Save a smaller copy or take a photo instead.`);
          added.push({ key: `n${++seq}`, blob: f, ext: 'pdf', type: 'application/pdf', name: f.name });
        } else {
          added.push({ key: `n${++seq}`, blob: await compressImage(f), ext: 'jpg', type: 'image/jpeg', name: f.name });
        }
      } catch (err) { problems.push(err.message); }
    }
    if (picked.length > room) problems.push(`At most ${MAX_RECEIPT_FILES} files per receipt: ${picked.length - room} not added.`);
    if (added.length) onChange([...items, ...added]);
    setError(problems.join(' '));
    setBusy(false);
  }

  const remove = (key) => onChange(items.filter((x) => x.key !== key));
  const isPdf = (x) => (x.path ? /\.pdf$/i.test(x.path) : x.type === 'application/pdf');

  return (
    <div className="photo-input">
      <span className="flabel">{label}</span>
      {items.length > 0 && (
        <ul className="receipt-files">
          {items.map((x, i) => (
            <li key={x.key} className="picked">
              <div>
                <strong>{i + 1}. {isPdf(x) ? 'PDF' : 'Photo'}{x.path ? ', attached earlier' : ''}</strong>
                {x.name && <span className="muted">{x.name}</span>}
              </div>
              <button type="button" className="btn ghost" onClick={() => remove(x.key)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {room > 0 && (
        <div className="photo-buttons">
          <button type="button" className="btn" onClick={() => camRef.current.click()} disabled={busy}>{items.length ? 'Take another photo' : 'Take photo'}</button>
          <button type="button" className="btn ghost" onClick={() => fileRef.current.click()} disabled={busy}>
            {busy ? 'Preparing…' : items.length ? 'Add images or PDFs' : 'Choose images or PDFs'}
          </button>
        </div>
      )}
      {items.length > 0 && <span className="hint">{items.length} file{items.length === 1 ? '' : 's'} on this receipt{room > 0 ? `; you can add up to ${room} more` : ''}.</span>}
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={pick} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// Files already saved on a collection, as items for ReceiptInput.
export const keptItems = (c) => [c.receipt_path, ...(c.receipt_more ?? [])].filter(Boolean).map((path) => ({ key: path, path }));

// Upload the new files (in order) and return every file's path, first = main file.
export async function uploadReceiptItems(items, kind) {
  const paths = [];
  for (const x of items) paths.push(x.path ?? await uploadMine(x.blob, kind, x.ext, x.type));
  return paths;
}

// Save every file on the receipt (after the receipt itself is saved). The receipt is already
// saved by then, so a failure here is reported rather than stopping the person.
export async function attachFiles(id, paths) {
  try { await rpc('cc_set_receipt_files', { p_id: id, p_paths: paths }); }
  catch (e) { window.alert(`Saved, but the receipt files could not all be attached: ${e.message} Open it and add them from its page.`); }
}
