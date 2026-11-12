import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, COLLECTION_SELECT, db, SCHEMA, rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { isOpen, waitingOnMe, nextStepText, STATUS } from '../lib/workflow';
import { lkr, ref, fmtDate, personName, daysAgo } from '../lib/format';
import StatusStamp from '../components/StatusStamp';
import { BACKUP_DUE_DAYS } from './Backup';

export default function List() {
  const { role, session, isAdmin } = useAuth();
  const uid = session.user.id;
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [params, setParams] = useSearchParams();
  // a filter from a link (Today): ?status=a,b&kind=cheque&title=…
  const fStatus = (params.get('status') ?? '').split(',').filter(Boolean);
  const fKind = params.get('kind');
  const fTitle = params.get('title') || fStatus.map((x) => STATUS[x]?.label ?? x).join(', ');
  const [matches, setMatches] = useState({});   // Sales: parked payment id → bank lines that could be it
  const [lastBackup, setLastBackup] = useState(undefined);   // Finance Admin: when the last data backup was taken

  const load = useCallback(async () => {
    const { data, error } = await db.from('collections').select(COLLECTION_SELECT).neq('kind', 'cash')
      .order('created_at', { ascending: false }).limit(500);
    if (error) setError(error.message); else setRows(data);
  }, []);

  useEffect(() => {
    if (!(role === 'finance' && isAdmin)) return;
    db.from('data_backups').select('taken_at').order('taken_at', { ascending: false }).limit(1)
      .then(({ data, error: e }) => setLastBackup(e ? undefined : data?.[0]?.taken_at ?? null));
  }, [role, isAdmin]);

  useEffect(() => {
    if (role !== 'sales') return;
    rpc('cc_parked_candidates').then((d) => setMatches(Object.fromEntries((d ?? []).filter((x) => x.lines.length).map((x) => [x.id, x.lines]))))
      .catch(() => setMatches({}));
  }, [role, rows]);

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
  const filtered = fStatus.length ? groups.all.filter((c) => fStatus.includes(c.status) && (!fKind || c.kind === fKind)) : null;
  const shown = (term
    ? groups.all.filter((c) =>
        [c.customer_name, c.customer_no, c.invoice_refs, ref(c.id), c.location_text].some((v) => v?.toLowerCase().includes(term)))
    : filtered ?? current.list).filter((c) => kind === 'all' || c.kind === kind);
  const kinds = [['all', 'All'], ['cheque', 'Cheques'], ['transfer', 'Transfers'], ['card', 'Card payments']];

  const rejected = role === 'sales' ? groups.all.filter((c) => c.status === 'rejected' && (c.created_by === uid || isAdmin)) : [];
  const parkedFound = role === 'sales' ? groups.all.filter((c) => c.status === 'parked' && matches[c.id]) : [];
  const photosDue = role === 'finance' ? groups.done.filter((c) =>
    !c.photos_deleted_at && c.collected_amount != null && daysAgo(c.closed_at ?? c.cancelled_at) >= 30).length : 0;

  return (
    <section>
      {lastBackup !== undefined && (lastBackup === null || daysAgo(lastBackup) >= BACKUP_DUE_DAYS) && (
        <div className="notice">
          {lastBackup === null ? 'No data backup has been taken yet.' : `The last data backup was ${daysAgo(lastBackup)} days ago.`}{' '}
          <Link to="/backup">Take a backup</Link>
        </div>
      )}
      {photosDue > 0 && (
        <div className="notice">
          {photosDue} finished collection{photosDue > 1 ? 's have' : ' has'} photos older than 30 days.{' '}
          <Link to="/photos">Back up and free space</Link>
        </div>
      )}
      {rejected.length > 0 && (
        <div className="notice danger-notice">
          Finance sent {rejected.length === 1 ? 'a receipt' : `${rejected.length} receipts`} back to you:{' '}
          {rejected.map((c, i) => <span key={c.id}>{i > 0 && ', '}<Link to={`/c/${c.id}`}>{ref(c.id)} {c.customer_name}</Link></span>)}.
          Open {rejected.length === 1 ? 'it' : 'each one'}, correct it, and send it back.
        </div>
      )}
      {parkedFound.length > 0 && (
        <div className="notice ok-notice">
          {parkedFound.length === 1 ? 'A parked payment' : `${parkedFound.length} parked payments`} may now be in the bank:{' '}
          {parkedFound.map((c, i) => {
            const l = matches[c.id][0];
            return <span key={c.id}>{i > 0 && '; '}<Link to={`/c/${c.id}?line=${l.id}`}>{ref(c.id)} {c.customer_name}</Link> (LKR {lkr(l.credit)}, {fmtDate(l.txn_date)}, {l.account_name})</span>;
          })}. Open {parkedFound.length === 1 ? 'it' : 'each one'} to check the line, link it and send it to finance.
        </div>
      )}
      <div className="page-head">
        <h1>{role === 'finance' ? 'Receipts' : 'Collections'}</h1>
        {role === 'sales' && (
          <div className="row">
            <Link className="btn primary" to="/new">New collection</Link>
            <Link className="btn" to="/transfer">Record transfer</Link>
            <Link className="btn" to="/card">Record card payment</Link>
          </div>
        )}
      </div>

      {filtered && (
        <div className="filter-bar" role="status">
          <span>Showing <strong>{fTitle}</strong> ({shown.length})</span>
          <button type="button" className="link" onClick={() => setParams({})}>Show all receipts</button>
        </div>
      )}
      <div className="list-tools">
        {!filtered && <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={!term && active === t.key}
              className={!term && active === t.key ? 'tab on' : 'tab'} onClick={() => { setTab(t.key); setQ(''); }}>
              {t.label} <span className="count">{t.list.length}</span>
            </button>
          ))}
        </div>}
        <input className="search" type="search" placeholder="Search customer, code, invoice or CC number"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search collections" />
      </div>
      {role !== 'driver' && (
        <div className="chips" role="group" aria-label="Kind">
          {kinds.map(([k, label]) => <button key={k} type="button" className={kind === k ? 'chip on' : 'chip'} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>)}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows !== null && shown.length === 0 && (
        <div className="empty">
          {term ? <p>Nothing matches “{q}”.</p>
            : filtered ? <p>Nothing here now.</p>
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
                    : c.status === 'parked' && matches[c.id] ? `Bank line found (${matches[c.id].length > 1 ? `${matches[c.id].length} possible` : `LKR ${lkr(matches[c.id][0].credit)}, ${fmtDate(matches[c.id][0].txn_date)}`}): open to link it`
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
