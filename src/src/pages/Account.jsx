import { useState } from 'react';
import { supabase, rpcLive } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { canInstall, isInstalled, promptInstall, browserKind, onInstallChange } from '../lib/install';
import { useEffect } from 'react';

export default function Account() {
  const { profile, reloadProfile, signOut } = useAuth();
  const [name, setName] = useState(profile.full_name);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function saveName(e) {
    e.preventDefault(); setMsg(''); setError('');
    try { await rpcLive('cc_set_my_name', { p_name: name }); await reloadProfile(); setMsg('Name saved.'); }
    catch (err) { setError(err.message); }
  }
  async function savePw(e) {
    e.preventDefault(); setMsg(''); setError('');
    if (pw.length < 8) { setError('Use at least 8 characters.'); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setError(error.message); else { setPw(''); setMsg('Password set. Use it next time you sign in.'); }
  }

  return (
    <section className="narrow">
      <div className="page-head"><h1>Account</h1></div>
      <p className="muted">{profile.email}</p>
      <form onSubmit={saveName} className="stack">
        <label className="field"><span className="flabel">Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button className="btn">Save name</button>
      </form>
      <form onSubmit={savePw} className="stack">
        <label className="field"><span className="flabel">New password</span>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <button className="btn">Set password</button>
      </form>
      {msg && <p className="hint">{msg}</p>}
      {error && <p className="error">{error}</p>}
      <InstallHelp />
      <button className="btn ghost" onClick={signOut}>Sign out</button>
    </section>
  );
}

const STEPS = {
  chrome: ['In the address bar, click the install icon (a screen with a down arrow) on the right, or open the ⋮ menu → Cast, save and share → Install page as app.', 'Click Install. Collections opens in its own window and appears in the Start menu and taskbar.'],
  edge: ['Open the ⋯ menu → Apps → Install this site as an app.', 'Click Install. Collections opens in its own window; pin it to the taskbar if you like.'],
  android: ['In Chrome, open the ⋮ menu → Install app (or Add to Home screen).', 'Confirm. Collections appears with your other apps.'],
  ios: ['Open this site in Safari (not Chrome).', 'Tap Share (the square with an arrow) → Add to Home Screen → Add.'],
  safari: ['On a Mac with Safari 17 or later: File menu → Add to Dock.', 'Or use Chrome or Edge instead.'],
  firefox: ['Firefox on computers cannot install web apps.', 'Open this address in Chrome or Edge and install from there.'],
};

function InstallHelp() {
  const [can, setCan] = useState(canInstall());
  useEffect(() => onInstallChange(() => setCan(canInstall())), []);
  const kind = browserKind();
  return (
    <div className="facts">
      <h2>Install as an app</h2>
      {isInstalled() ? <p className="ok-text">You're using the installed app.</p> : (
        <>
          <p>Installing puts Collections in its own window with an icon on your desktop, taskbar or home screen. It stays live-linked: everything is the same as in the browser.</p>
          {can && <button className="btn primary" onClick={promptInstall}>Install app</button>}
          <ol className="plain">{STEPS[kind].map((t) => <li key={t}>{t}</li>)}</ol>
        </>
      )}
    </div>
  );
}
