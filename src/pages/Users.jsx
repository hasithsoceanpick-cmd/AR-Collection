import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';

function UserRow({ u, self, onSaved }) {
  const [name, setName] = useState(u.full_name);
  const [role, setRole] = useState(u.role ?? '');
  const [active, setActive] = useState(u.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = name !== u.full_name || role !== (u.role ?? '') || active !== u.active;

  async function save() {
    setBusy(true); setError('');
    try { await rpc('cc_set_user', { p_user: u.id, p_name: name, p_role: role || null, p_active: active }); await onSaved(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <tr className={!u.role ? 'needs-role' : ''}>
      <td><input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" /><div className="muted small">{u.email}</div></td>
      <td>
        <select value={role} onChange={(e) => setRole(e.target.value)} disabled={self} aria-label="Role">
          <option value="">No access</option>
          <option value="sales">Sales</option>
          <option value="driver">Driver</option>
          <option value="finance">Finance</option>
        </select>
      </td>
      <td><label className="check"><input type="checkbox" checked={active} disabled={self} onChange={(e) => setActive(e.target.checked)} /> Active</label></td>
      <td>
        <button className="btn" disabled={!changed || busy} onClick={save}>Save</button>
        {error && <div className="error small">{error}</div>}
      </td>
    </tr>
  );
}

export default function Users() {
  const { session, reloadProfile } = useAuth();
  const [users, setUsers] = useState(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at');
    setUsers(data ?? []);
    reloadProfile();
  }, [reloadProfile]);
  useEffect(() => { load(); }, [load]);

  return (
    <section>
      <div className="page-head"><h1>People</h1></div>
      <p className="lede">
        To add someone, go to your Supabase project → Authentication → Users → Add user, enter their
        email and a starting password, and tick “Auto confirm”. They appear here; give them a role and save.
      </p>
      {users === null ? <p className="muted">Loading…</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Access</th><th /></tr></thead>
            <tbody>
              {users.map((u) => <UserRow key={`${u.id}-${u.role}-${u.active}-${u.full_name}`} u={u} self={u.id === session.user.id} onSaved={load} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
