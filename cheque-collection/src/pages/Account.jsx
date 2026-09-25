import { useState } from 'react';
import { supabase, rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function Account() {
  const { profile, reloadProfile, signOut } = useAuth();
  const [name, setName] = useState(profile.full_name);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function saveName(e) {
    e.preventDefault(); setMsg(''); setError('');
    try { await rpc('cc_set_my_name', { p_name: name }); await reloadProfile(); setMsg('Name saved.'); }
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
      <div className="facts">
        <h2>Install on your phone</h2>
        <p>On Android, open this site in Chrome, tap the ⋮ menu, then “Add to Home screen”.
          On iPhone, open it in Safari, tap Share, then “Add to Home Screen”.</p>
      </div>
      <button className="btn ghost" onClick={signOut}>Sign out</button>
    </section>
  );
}
