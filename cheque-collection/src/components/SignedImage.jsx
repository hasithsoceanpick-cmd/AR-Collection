import { useEffect, useState } from 'react';
import { supabase, BUCKET } from '../lib/supabase';

export default function SignedImage({ path, alt }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    supabase.storage.from(BUCKET).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!live) return;
      if (error) setFailed(true); else setUrl(data.signedUrl);
    });
    return () => { live = false; };
  }, [path]);
  if (failed) return <div className="img-missing">Photo not available</div>;
  if (!url) return <div className="img-missing">Loading photo…</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="img-link">
      <img src={url} alt={alt} loading="lazy" />
    </a>
  );
}
