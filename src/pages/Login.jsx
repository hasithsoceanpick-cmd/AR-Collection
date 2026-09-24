import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function signIn(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message === 'Invalid login credentials'
      ? 'That email and password do not match. Check them, or email yourself a sign-in link.'
      : error.message);
    setBusy(false);
  }

  async function sendLink() {
    if (!email.trim()) { setError('Enter your email first.'); return; }
    setBusy(true); setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    if (error) setError(error.message); else setSent(true);
    setBusy(false);
  }

  return (
    <div className="login">
      <div className="login-card">
        <img src="/icon.svg" alt="" width="48" height="48" />
        <h1>Cheque Collection</h1>
        {sent ? (
          <p>Check <strong>{email}</strong> for a sign-in link. Open it on this device.</p>
        ) : (
          <form onSubmit={signIn} className="stack">
            <label className="field"><span className="flabel">Email</span>
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field"><span className="flabel">Password</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn primary" disabled={busy || !password}>Sign in</button>
            <button type="button" className="link" onClick={sendLink} disabled={busy}>
              No password or forgot it? Email me a sign-in link
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
