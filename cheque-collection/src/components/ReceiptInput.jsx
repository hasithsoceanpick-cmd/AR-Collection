import { useRef, useState } from 'react';
import { compressImage } from '../lib/image';

// Image (compressed) or PDF (as is, up to 10 MB). onChange({ blob, ext, type, name }) or null.
export default function ReceiptInput({ label, value, onChange }) {
  const camRef = useRef(null);
  const fileRef = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(''); setBusy(true);
    try {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        if (f.size > 10 * 1024 * 1024) throw new Error('That PDF is over 10 MB. Save a smaller copy or take a photo instead.');
        onChange({ blob: f, ext: 'pdf', type: 'application/pdf', name: f.name });
      } else {
        onChange({ blob: await compressImage(f), ext: 'jpg', type: 'image/jpeg', name: f.name });
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="photo-input">
      <span className="flabel">{label}</span>
      {value ? (
        <div className="picked">
          <div><strong>{value.type === 'application/pdf' ? 'PDF attached' : 'Photo attached'}</strong><span className="muted">{value.name}</span></div>
          <button type="button" className="btn ghost" onClick={() => onChange(null)}>Remove</button>
        </div>
      ) : (
        <div className="photo-buttons">
          <button type="button" className="btn" onClick={() => camRef.current.click()} disabled={busy}>Take photo</button>
          <button type="button" className="btn ghost" onClick={() => fileRef.current.click()} disabled={busy}>
            {busy ? 'Preparing…' : 'Choose image or PDF'}
          </button>
        </div>
      )}
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={pick} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
