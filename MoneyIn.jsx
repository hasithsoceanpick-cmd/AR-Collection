import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr, fmtDay as fmtDate } from '../lib/format';
import { TAGS } from '../lib/workflow';
import Icon from '../components/Icon';

const KIND = { deposit: 'Deposit slip', batch: 'Card batch', payout: 'PayHere', parked: 'Parked transfer' };

// How each kind is matched to its bank credit (the same actions as on its own page).
const MATCH = {
  deposit: (w, lineId) => rpc('cc_link_deposit', { p_deposit_id: w.id, p_line_ids: [lineId] }),
  batch: (w, lineId) => rpc('cc_merchant_link_line', { p_batch_id: w.id, p_line_id: lineId }),
  payout: (w, lineId) => rpc('cc_payhere_link_line', { p_payout_id: w.id, p_line_id: lineId }),
};

function TagLine({ line, onDone }) {
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try { await rpc('cc_tag_line', { p_line_id: line.id, p_tag: tag, p_note: note || null }); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="mi-tag">
      <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag as">
        <option value="">Tag as…</option>
        {Object.entries(TAGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tag === 'other' ? 'What is it? (required)' : 'Note (optional)'} aria-label="Note" />
      <button className="btn small primary" type="button" disabled={busy || !tag || (tag === 'other' && !note.trim())} onClick={save}>{busy ? 'Saving…' : 'Tag'}</button>
      {err && <span className="error small">{err}</span>}
    </div>
  );
}

// Money in: bank credits nobody has identified, next to everything waiting for a bank credit, with the likely pairs.
export default function MoneyIn() {
  const { reloadToday } = useOutletContext() ?? {};
  const [params] = useSearchParams();
  const focus = Number(params.get('line')) || null;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [acc, setAcc] = useState('all');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');
  const [tagging, setTagging] = useState(null);
  const [all, setAll] = useState(false);
  const focusRef = useRef(null);

  const load = useCallback(async () => {
    try { setData(await rpc('cc_money_in')); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (focus && data) focusRef.current?.scrollIntoView({ block: 'center' }); }, [focus, data]);

  const credits = useMemo(() => data?.credits ?? [], [data]);
  const waiting = useMemo(() => data?.waiting ?? [], [data]);
  const accounts = useMemo(() => {
    const m = new Map();
    credits.forEach((c) => m.set(c.account_id, c.account));
    waiting.forEach((w) => w.account_id && m.set(w.account_id, w.account));
    return [...m.entries()].filter(([, name]) => name).sort((a, b) => a[1].localeCompare(b[1]));
  }, [credits, waiting]);
  const keep = (x) => acc === 'all' || x.account_id === acc;
  const byLine = useMemo(() => Object.fromEntries(credits.map((c) => [c.id, c])), [credits]);
  const byItem = useMemo(() => Object.fromEntries(waiting.map((w) => [`${w.kind}-${w.id}`, w])), [waiting]);
  const pairs = (data?.pairs ?? []).map((p) => ({ ...p, line: byLine[p.line_id], item: byItem[`${p.kind}-${p.id}`] }))
    .filter((p) => p.line && p.item && keep(p.line));
  const shownCredits = credits.filter(keep);
  const listCredits = all || focus ? shownCredits : shownCredits.slice(0, 40);
  const shownWaiting = waiting.filter(keep);
  const after = async () => { await load(); await reloadToday?.(); };

  async function match(p) {
    setBusy(`${p.kind}-${p.id}`); setError(''); setMsg('');
    try { await MATCH[p.kind](p.item, p.line_id); setMsg(`${p.item.ref} matched to the ${p.line.account} credit of ${fmtDate(p.line.date)}, LKR ${lkr(p.line.amount)}.`); await after(); }
    catch (e) { setError(`${p.item.ref}: ${e.message}`); } finally { setBusy(null); }
  }
  async function matchAll() {
    setBusy('all'); setError(''); setMsg('');
    let done = 0; const failed = [];
    for (const p of pairs) {
      try { await MATCH[p.kind](p.item, p.line_id); done += 1; } catch (e) { failed.push(`${p.item.ref}: ${e.message}`); }
    }
    setMsg(`${done} matched.`); if (failed.length) setError(failed.join(' '));
    setBusy(null); await after();
  }

  if (!data && !error) return <section className="wide"><h1>Money in</h1><p className="muted">Loading…</p></section>;
  return (
    <section className="wide money-in">
      <div className="page-head">
        <div>
          <h1>Money in</h1>
          <p className="lede">Bank credits nobody has identified yet, next to everything waiting for a bank credit. Likely pairs are on top: check each one and press Match.</p>
        </div>
        <Link className="btn" to="/bank"><Icon name="upload" size={18} />Upload a statement</Link>
      </div>

      {accounts.length > 1 && (
        <div className="chips" role="group" aria-label="Bank account">
          <button type="button" className={acc === 'all' ? 'chip on' : 'chip'} aria-pressed={acc === 'all'} onClick={() => setAcc('all')}>All accounts</button>
          {accounts.map(([id, name]) => <button key={id} type="button" className={acc === id ? 'chip on' : 'chip'} aria-pressed={acc === id} onClick={() => setAcc(id)}>{name}</button>)}
        </div>
      )}
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}

      <div className="mi-card">
        <div className="mi-head">
          <div><h2>Likely matches ({pairs.length})</h2><span className="muted small">The same amount on the same bank within a few days, and nothing else fits either side.</span></div>
          {pairs.length > 1 && <button className="btn primary small" type="button" disabled={busy !== null} onClick={matchAll}>{busy === 'all' ? 'Matching…' : `Match all ${pairs.length}`}</button>}
        </div>
        {pairs.length === 0 && <p className="muted mi-empty">No likely pairs right now. Match the rest on each item&apos;s own page (links below).</p>}
        {pairs.map((p) => (
          <div className="mi-pair" key={`${p.kind}-${p.id}`}>
            <div className="mi-side">
              <span className="muted small">{fmtDate(p.line.date)} · {p.line.account}</span>
              <strong className="mi-narr">{p.line.narration || p.line.reference}</strong>
              <span className="num">LKR {lkr(p.line.amount)}</span>
            </div>
            <Icon name="swap" size={26} className="mi-swap" />
            <div className="mi-side">
              <span className="muted small"><span className="pill">{KIND[p.kind]}</span> {p.item.ref}{p.item.n ? ` · ${p.item.n} item${p.item.n === 1 ? '' : 's'}` : ''}</span>
              <strong>{p.item.who || p.item.ref}</strong>
              <span className="muted small">{p.why}</span>
            </div>
            <button className="btn small" type="button" disabled={busy !== null} onClick={() => match(p)}>{busy === `${p.kind}-${p.id}` ? 'Matching…' : 'Match'}</button>
          </div>
        ))}
      </div>

      <div className="mi-cols">
        <div className="mi-card">
          <div className="mi-head"><div><h2>In the bank, not identified ({shownCredits.length})</h2>
            <span className="muted small">Sales are reminded about customer money. Tag what isn&apos;t a customer payment.</span></div></div>
          {shownCredits.length === 0 && <p className="muted mi-empty">Every credit is identified.</p>}
          {listCredits.map((c) => (
            <div key={c.id} ref={c.id === focus ? focusRef : null} className={`mi-row${c.id === focus ? ' mi-focus' : ''}`}>
              <span className="mi-date">{fmtDate(c.date)}</span>
              <span className="mi-main"><strong className="mi-narr">{c.narration || c.reference || 'Bank credit'}</strong>
                <span className="muted small">{c.account}{c.reference && c.narration ? ` · ${c.reference}` : ''}
                  {c.finance_only ? ' · pair it with its payout or card batch' : <> · <button type="button" className="link small" onClick={() => setTagging(tagging === c.id ? null : c.id)}>Tag</button></>}</span>
                {tagging === c.id && <TagLine line={c} onDone={() => { setTagging(null); after(); }} />}
              </span>
              <span className="num mi-amt">{lkr(c.amount)}</span>
            </div>
          ))}
          {!all && !focus && shownCredits.length > listCredits.length && (
            <button type="button" className="link mi-more" onClick={() => setAll(true)}>Show all {shownCredits.length}</button>
          )}
        </div>
        <div className="mi-card">
          <div className="mi-head"><div><h2>Waiting for a bank credit ({shownWaiting.length})</h2>
            <span className="muted small">Deposit slips, card batches, PayHere payouts and parked transfers</span></div></div>
          {shownWaiting.length === 0 && <p className="muted mi-empty">Nothing is waiting for a bank credit.</p>}
          {shownWaiting.map((w) => (
            <Link key={`${w.kind}-${w.id}`} className="mi-row mi-link" to={w.href}>
              <span className="mi-date">{w.date ? fmtDate(w.date) : ''}</span>
              <span className="mi-main"><strong><span className="pill">{KIND[w.kind]}</span> {w.who || w.ref}</strong>
                <span className="muted small">{w.ref}{w.account ? ` · ${w.account}` : ''}{w.matchable ? '' : ' · Sales links it when it shows'}</span></span>
              <span className="num mi-amt">{lkr(w.amount)}</span>
            </Link>
          ))}
          {Number(data?.cash_in_hand?.count) > 0 && (
            <Link className="mi-row mi-link" to="/cash">
              <span className="mi-date" />
              <span className="mi-main"><strong><span className="pill">Cash</span> Cash in hand, not banked</strong>
                <span className="muted small">{data.cash_in_hand.count} cash receipt{data.cash_in_hand.count === 1 ? '' : 's'} · match the cash deposit on Cash</span></span>
              <span className="num mi-amt">{lkr(data.cash_in_hand.amount)}</span>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
