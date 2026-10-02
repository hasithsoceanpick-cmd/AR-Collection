import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, rpc, db, SCHEMA } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

export default function Notifications() {
  const { session } = useAuth();
  const uid = session.user.id;
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const boxRef = useRef(null);

  const load = useCallback(async () => {
    const { data } = await db.from('notifications').select('*')
      .order('created_at', { ascending: false }).limit(30);
    setItems(data ?? []);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel(`notes-${uid}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: SCHEMA, table: 'notifications', filter: `user_id=eq.${uid}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, load]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const unread = items.filter((n) => !n.read_at).length;

  async function openItem(n) {
    setOpen(false);
    if (!n.read_at) { await rpc('cc_mark_read', { p_ids: [n.id] }); load(); }
    nav(n.link ?? (n.collection_id ? `/c/${n.collection_id}` : '/deposits'));
  }
  async function markAll() { await rpc('cc_mark_read', { p_ids: null }); load(); }

  return (
    <div className="notes" ref={boxRef}>
      <button className="bell" onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `${unread} unread notifications` : 'Notifications'} aria-expanded={open}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zm-2 15a2 2 0 0 0 4 0"
            fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        {unread > 0 && <span className="badge">{unread}</span>}
      </button>
      {open && (
        <div className="note-panel" role="dialog" aria-label="Notifications">
          <div className="note-head">
            <strong>Notifications</strong>
            {unread > 0 && <button className="link" onClick={markAll}>Mark all read</button>}
          </div>
          {items.length === 0 && <p className="muted pad">Nothing yet. Updates on your collections appear here.</p>}
          <ul>
            {items.map((n) => (
              <li key={n.id}>
                <button className={n.read_at ? 'note' : 'note unread'} onClick={() => openItem(n)}>
                  <span>{n.message}</span>
                  <small>{fmtDateTime(n.created_at)}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
