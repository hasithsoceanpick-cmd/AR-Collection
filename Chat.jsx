import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { supabase, rpcLive } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { compressImage } from '../lib/image';
import { CHAT_BUCKET, uploadChatImage, refreshChatUnread } from '../lib/chat';
import SignedImage from '../components/SignedImage';

const PAGE = 100;
const ROLE = { sales: 'Sales', driver: 'Driver', finance: 'Finance', executive: 'Management' };
const SELECT = 'id, body, image_path, created_at, deleted_at, author, who:profiles!chat_messages_author_fkey(full_name, email, role, is_admin)';
const dayOf = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeOf = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// One small group chat for everyone who uses the app: suggestions, questions, anything.
export default function Chat() {
  const { session, isAdmin } = useAuth();
  const uid = session.user.id;
  const [msgs, setMsgs] = useState(null);
  const [more, setMore] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [text, setText] = useState('');
  const [img, setImg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef(null);
  const fileRef = useRef(null);
  const stick = useRef(true);   // keep the newest message in view unless the person scrolled up

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('chat_messages').select(SELECT).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    if (e) { setError(`Couldn't load the chat: ${e.message}`); setMsgs([]); return; }
    setMore(data.length > limit);
    setMsgs(data.slice(0, limit).reverse());
    rpcLive('cc_chat_read').then(refreshChatUnread).catch(() => {});
  }, [limit]);

  useEffect(() => {
    load();
    const ch = supabase.channel('team-chat')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  async function attach(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Attach an image (a screenshot or photo).'); return; }
    setError('');
    try { setImg({ blob: await compressImage(file), name: file.name || 'Pasted screenshot' }); } catch (e) { setError(e.message); }
  }

  async function send(e) {
    e?.preventDefault();
    if (busy || (!text.trim() && !img)) return;
    setBusy(true); setError('');
    try {
      const path = img ? await uploadChatImage(img.blob) : null;
      await rpcLive('cc_chat_post', { p_body: text, p_image: path });
      setText(''); setImg(null); stick.current = true;
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function remove(m) {
    if (!window.confirm('Delete this message for everyone?')) return;
    try { await rpcLive('cc_chat_delete', { p_id: m.id }); await load(); } catch (err) { setError(err.message); }
  }

  return (
    <section className="narrow chat-page">
      <div className="page-head"><h1>Team chat</h1></div>
      <p className="lede">Suggestions for the app, questions, anything for the whole team. Everyone who uses the app sees this chat, in Live and Demo.</p>

      <div className="chat-log" ref={logRef} aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {msgs === null && <p className="muted">Loading…</p>}
        {more && <p className="chat-older"><button className="link" onClick={() => { stick.current = false; setLimit((n) => n + PAGE); }}>Show earlier messages</button></p>}
        {msgs?.length === 0 && <p className="muted chat-empty">No messages yet. Start with a suggestion for the app.</p>}
        {msgs?.map((m, i) => {
          const mine = m.author === uid;
          const newDay = i === 0 || dayOf(msgs[i - 1].created_at) !== dayOf(m.created_at);
          const who = m.who ?? {};
          return (
            <Fragment key={m.id}>
              {newDay && <div className="chat-day"><span>{dayOf(m.created_at)}</span></div>}
              <div className={`chat-msg${mine ? ' mine' : ''}`}>
                <div className="chat-meta">
                  <strong>{mine ? 'You' : who.full_name || who.email || 'Someone'}</strong>
                  {!mine && <span>{who.is_admin ? 'Finance Admin' : ROLE[who.role] ?? ''}</span>}
                  <time dateTime={m.created_at}>{timeOf(m.created_at)}</time>
                  {!m.deleted_at && (mine || isAdmin) && <button className="link small" onClick={() => remove(m)}>Delete</button>}
                </div>
                {m.deleted_at ? <p className="chat-body muted">Message deleted</p> : (
                  <>
                    {m.body && <p className="chat-body">{m.body}</p>}
                    {m.image_path && <div className="chat-img"><SignedImage path={m.image_path} bucket={CHAT_BUCKET} alt="Screenshot" /></div>}
                  </>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>

      <form className="chat-compose" onSubmit={send}>
        {img && (
          <div className="picked"><div><strong>Screenshot attached</strong><span className="muted">{img.name}</span></div>
            <button type="button" className="btn ghost" onClick={() => setImg(null)}>Remove</button></div>
        )}
        <textarea rows="2" maxLength={2000} value={text} aria-label="Message"
          placeholder="Write a message. Paste a screenshot with Ctrl+V. Ctrl+Enter sends."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e); }}
          onPaste={(e) => { const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); attach(f); } }} />
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="btn primary" disabled={busy || (!text.trim() && !img)}>{busy ? 'Sending…' : 'Send'}</button>
          <button type="button" className="btn ghost" onClick={() => fileRef.current.click()} disabled={busy}>Attach screenshot</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ''; }} />
      </form>
    </section>
  );
}
