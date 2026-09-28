import { useEffect, useState } from 'react';
import { supabase, BUCKET } from '../lib/supabase';

// Shows a stored image, or a link for a stored PDF.
export default function SignedImage({ path, alt }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const isPdf = /\.pdf$/i.test(path);
  useEffect(() => {
    let live = true;
    supabase.storage.from(BUCKET).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!live) return;
      if (error) setFailed(true); else setUrl(data.signedUrl);
    });
    return () => { live = false; };
  }, [path]);
  if (failed) return <div className="img-missing">File not available</div>;
  if (!url) return <div className="img-missing">Loading…</div>;
  if (isPdf) return <a className="btn" href={url} target="_blank" rel="noreferrer">Open {alt} (PDF)</a>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="img-link">
      <img src={url} alt={alt} loading="lazy" />
    </a>
  );
}
