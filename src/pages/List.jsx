import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, COLLECTION_SELECT, db, SCHEMA } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { isOpen, waitingOnMe, nextStepText } from '../lib/workflow';
import { lkr, ref, fmtDate, personName, daysAgo } from '../lib/format';
import StatusStamp from '../components/StatusStamp';

export default function List() {
  const { role, session, isAdmin } = useAuth();
  const uid = session.user.id;
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await db.from('collections').select(COLLECTION_SELECT).neq('kind', 'cash')
      .order('created_at', { ascending: false }).limit(500);
    if (error) setError(error.message); else setRows(data);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel('collections-list')
      .on('postgres_changes', { event: '*', schema: SCHEMA, table: 'collections' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const groups = useMemo(() => {
    const all = rows ?? [];
    const mine = all.filter((c) => waitingOnMe(c, role, uid, isAdmin));
    const open = all.filter(isOpen);
    const done = all.filter((c) => !isOpen(c));
    if (role === 'driver') {
      const byDate = (a, b) => (a.collection_date ?? '9').localeCompare(b.collection_date ?? '9');
      mine.sort(byDate);
    }
    return { mine, open, done, all };
  }, [rows, role, uid, isAdmin]);

  const tabs = [
    ...(role !== 'executive' ? [{ key: 'mine', label: 'For you', list: groups.mine }] : []),
    { key: 'open', label: 'Open', list: groups.open },
    { key: 'done', label: 'Closed', list: groups.done },
  ];
  const active = tab ?? (groups.mine.length ? 'mine' : 'open');
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  const term = q.trim().toLowerCase();
  const shown = term
    ? groups.all.filter((c) =>
        [c.customer_name, c.customer_no, c.invoice_refs, ref(c.id), c.location_text].some((v) => v?.toLowerCase().includes(term)))
    : current.list;

  const rejected = role === 'sales' ? groups.all.filter((c) => c.status === 'rejected' && (c.created_by === uid || isAdmin)) : [];
  const photosDue = role === 'finance' ? groups.done.filter((c) =>
    !c.photos_deleted_at && c.collected_amount != null && daysAgo(c.closed_at ?? c.cancelled_at) >= 30).length : 0;

  return (
    <section>
      {photosDue > 0 && (
        <div className="notice">
          {photosDue} finished collection{photosDue > 1 ? 's have' : ' has'} photos older than 30 days.{' '}
          <Link to="/photos">Back up and free space</Link>
        </div>
      )}
      {rejected.length > 0 && (
        <div className="notice danger-notice">
          Finance rejected {rejected.length === 1 ? 'a collection' : `${rejected.length} collections`} back to you:{' '}
          {rejected.map((c, i) => <span key={c.id}>{i > 0 && ', '}<Link to={`/c/${c.id}`}>{ref(c.id)} {c.customer_name}</Link></span>)}.
          Open {rejected.length === 1 ? 'it' : 'each one'}, correct the invoices or settlement instructions, and send it back.
        </div>
      )}
      <div className="page-head">
        <h1>Collections</h1>
        {(role === 'sales' || role === 'finance') && (
          <div className="row">
            <Link className="btn primary" to="/new">New collection</Link>
            <Link className="btn" to="/transfer">Record transfer</Link>
            <Link className="btn" to="/card">Record card payment</Link>
          </div>
        )}
      </div>

      <div className="list-tools">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={!term && active === t.key}
              className={!term && active === t.key ? 'tab on' : 'tab'} onClick={() => { setTab(t.key); setQ(''); }}>
              {t.label} <span className="count">{t.list.length}</span>
            </button>
          ))}
        </div>
        <input className="search" type="search" placeholder="Search customer, code, invoice or CC number"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search collections" />
      </div>

      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows !== null && shown.length === 0 && (
        <div className="empty">
          {term ? <p>Nothing matches “{q}”.</p>
            : active === 'mine' ? <p>Nothing is waiting on you.</p>
            : role === 'sales' ? <p>When a customer says a cheque is ready, record it with <Link to="/new">New collection</Link>.</p>
            : <p>No collections here yet.</p>}
        </div>
      )}

      <ul className="rows">
        {shown.map((c) => (
          <li key={c.id}>
            <Link to={`/c/${c.id}`} className="row-link">
              <div className="row-main">
                <span className="row-customer">{c.customer_name}</span>
                <span className="row-meta">
                  <span>{ref(c.id)}</span>
                  {c.kind === 'transfer' && <span className="kind-tag">Transfer</span>}
                  {c.kind === 'card' && <span className="kind-tag">Card</span>}
                  {c.notes?.startsWith('Practice scenario') && <span className="practice-tag">Practice</span>}
                  {c.customer_no && <span>{c.customer_no}</span>}
                  {c.invoice_refs && <span>Inv. {c.invoice_refs}</span>}
                </span>
                <span className="row-next">
                  {c.kind === 'cheque' && (c.status === 'assigned' || c.status === 'received')
                    ? `${personName(c.driver)}${c.collection_date && c.status === 'assigned' ? `, ${fmtDate(c.collection_date)}` : ''}`
                    : isOpen(c) ? nextStepText(c) : fmtDate(c.closed_at ?? c.cancelled_at)}
                </span>
              </div>
              <div className="row-side">
                <span className="row-amount">
                  {lkr(c.collected_amount ?? c.expected_amount)}
                  {c.amount_changed && <span className="flag" title="Collected amount differs from expected">changed</span>}
                </span>
                <StatusStamp status={c.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
