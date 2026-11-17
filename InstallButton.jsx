import { useEffect, useState } from 'react';
import { canInstall, onInstallChange, promptInstall } from '../lib/install';

// Shown in the header only when this browser can install the app right now.
export default function InstallButton() {
  const [show, setShow] = useState(canInstall());
  useEffect(() => onInstallChange(() => setShow(canInstall())), []);
  if (!show) return null;
  return (
    <button className="install-btn" onClick={promptInstall} title="Install Collections as an app on this device">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v11m0 0l-4-4m4 4l4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span>Install app</span>
    </button>
  );
}
