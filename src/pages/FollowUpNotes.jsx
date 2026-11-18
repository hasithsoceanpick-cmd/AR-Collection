import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { payMethodLabel } from '../lib/followup';
import NotesList from '../components/NotesList';

// The Notes tab: every note is an action point, grouped by customer. Customers with overdue action points come first;
// tick an action point off when it's done. Finance sees every note; Sales their own and the ones finance shows them.
export default function FollowUpNotes() {
  const { reloadToday } = useOutletContext() ?? {};
  const [show, setShow] = useState('open');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [lateOnly, setLateOnly] = useState(false);

  const load = useCallback(async () => {
    try { setData(await rpc('cc_ar_notes_board', { p_show: show })); setError(''); } catch (e) { setError(e.message); }
  }, [show]);
  useEffect(() => { setData(null); load(); }, [load]);
  async function changed() { await load(); reloadToday?.(); }

  const term = q.trim().toLowerCase();
  const customers = useMemo(() => (data?.customers ?? [])
    .map((c) => ({ ...c, notes: c.notes.filter((n) => (!who || n.by_id === who) && (!lateOnly || n.overdue)) }))
    .filter((c) => c.notes.length > 0 && (!term || `${c.name} ${c.customer_no}`.toLowerCase().includes(term))), [data, who, lateOnly, term]);
  const nNotes = customers.reduce((a, c) => a + c.notes.length, 0);
  const nLate = customers.reduce((a, c) => a + c.notes.filter((n) => n.overdue).length, 0);

  return (
    <section className="wide fu-notes-page">
      <div className="page-head">
        <div>
          <h1>Notes</h1>
          <p className="lede">Every note on a customer or an invoice is an action point. Customers with overdue ones come first, newest notes on top.
            Tick a note off when it’s done; it moves to Cleared with who did it and how.</p>
        </div>
      </div>
      <div className="filters">
        <div className="tabs" role="tablist" aria-label="Show">
          {[['open', 'Open'], ['cleared', 'Cleared']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={show === k} className={`tab${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{l}</button>
          ))}
        </div>
        <input className="search" type="search" placeholder="Search customer name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
        {(data?.writers?.length ?? 0) > 1 && (
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Written by">
            <option value="">Written by anyone</option>
            {[...data.writers].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
        {show === 'open' && <label className="small"><input type="checkbox" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} /> Overdue only</label>}
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <p className="muted small fu-notes-sum">{show === 'open'
            ? <>{nNotes} open action point{nNotes === 1 ? '' : 's'} for {customers.length} customer{customers.length === 1 ? '' : 's'}{nLate > 0 && <> · <strong className="fu-late-text">{nLate} overdue</strong></>}</>
            : <>{nNotes} cleared action point{nNotes === 1 ? '' : 's'} (the latest 500)</>}</p>
          {customers.length === 0 ? <div className="empty"><p>{show === 'open' ? 'No open action points.' : 'Nothing cleared yet.'}</p></div> : (
            <div className="fu-notes-cards">
              {customers.map((c) => (
                <article key={c.customer_no} className={`mi-card fu-notes-card${c.overdue_n > 0 ? ' late' : ''}`} aria-label={c.name}>
                  <header className="fu-notes-head">
                    <div>
                      <Link className="fu-name" to={`/customer/${encodeURIComponent(c.customer_no)}#follow-up`}>{c.name}</Link>
                      <div className="muted small">{c.customer_no}{c.seg ? ` · ${c.seg}` : ''} · {c.owner ?? <em>Unassigned</em>}</div>
                    </div>
                    <div className="fu-notes-tags">
                      {c.is_staff && <span className="pill staff">Staff</span>}
                      {c.pay_method && <span className="pill method">{payMethodLabel(c.pay_method)}</span>}
                      {show === 'open' && c.overdue_n > 0 && <span className="pill bad">{c.overdue_n} overdue</span>}
                      <span className="pill muted">{c.notes.length} {show === 'open' ? 'open' : 'cleared'}</span>
                    </div>
                  </header>
                  <NotesList customerNo={c.customer_no} notes={c.notes} showDoc canWrite={show === 'open' && data.can.write} onChanged={changed} />
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
