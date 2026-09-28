import { useEffect, useRef, useState } from 'react';
import { compressImage } from '../lib/image';

// Returns a compressed JPEG Blob through onChange.
export default function PhotoInput({ label, value, onChange }) {
  const camRef = useRef(null);
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!value) { setPreview(null); return; }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setError('');
    try { onChange(await compressImage(f)); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="photo-input">
      <span className="flabel">{label}</span>
      {preview ? (
        <div className="photo-preview">
          <img src={preview} alt={label} />
          <button type="button" className="btn ghost" onClick={() => onChange(null)}>Retake</button>
        </div>
      ) : (
        <div className="photo-buttons">
          <button type="button" className="btn" onClick={() => camRef.current.click()} disabled={busy}>
            {busy ? 'Preparing…' : 'Take photo'}
          </button>
          <button type="button" className="btn ghost" onClick={() => fileRef.current.click()} disabled={busy}>
            Choose file
          </button>
        </div>
      )}
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
