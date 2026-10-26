import { useEffect, useMemo, useState } from 'react';
import { rpc } from '../lib/supabase';
import { lkr, fmtDate } from '../lib/format';

// Finance Admin: match a deposit slip to the bank cheque by cheque.
// The bank often shows one recorded cheque as several cheque lines (366,000 = 300,000 + 66,000).
// For each cheque on the slip the app suggests the bank lines adding up to it; the admin can hand-pick them.
// A cheque with two or more lines is split into the cheques the bank shows when saved.

const cents = (n) => Math.round(Number(n) * 100);
const digits = (s) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const looksCheque = (l) => Boolean(l.cheque_no) || /\b(chq|cheque|cheq)/i.test(l.narration ?? '');
// the cheque number the bank gives a line: its cheque column, else a 6-digit number in the narration
export const numberOn = (l) => String(l.cheque_no ?? '').replace(/\D/g, '') || (String(l.narration ?? '').match(/(?<!\d)\d{6}(?!\d)/)?.[0] ?? '');

// Sets of lines adding up to `target` (cents): singles first, then pairs, threes… (each size searched in
// preference order of `items`, so the likeliest sets come first and small sets are never crowded out).
function subsets(items, target, { maxLen = 8, maxFound = 30, budget = 60000 } = {}) {
  const n = items.length;
  const found = [];
  if (target <= 0) return found;
  for (let size = 1; size <= Math.min(maxLen, n) && found.length < maxFound; size += 1) {
    const pick = [];
    let steps = 0;
    const go = (i, sum) => {
      if (pick.length === size) { if (sum === target) found.push([...pick]); return; }
      for (let j = i; j <= n - (size - pick.length); j += 1) {
        if (found.length >= maxFound || (steps += 1) > budget) return;
        if (sum + items[j].c > target) continue;
        pick.push(items[j]); go(j + 1, sum + items[j].c); pick.pop();
      }
    };
    go(0, 0);
  }
  return found;
}
// best kind of line throughout (ticked, cheque deposits, not before the deposit), then fewest dates,
// then the closest dates, then fewest lines
const rank = (opts) => opts.map((o) => { const worst = Math.max(...o.map((p) => p.s)); return { o, k: [Math.floor(worst / 100), new Set(o.map((p) => p.d)).size, worst, o.length, o.reduce((s, p) => s + p.s, 0)] }; })
  .sort((a, b) => a.k.reduce((r, v, i) => r || v - b.k[i], 0)).map((x) => x.o);

function solve(qs, cand, tries) {
  if (!qs.length) return [];
  const [q, ...more] = qs;
  for (const o of rank(subsets(cand, cents(q.amount))).slice(0, 12)) {
    const ids = new Set(o.map((p) => p.id));
    const r = solve(more, cand.filter((p) => !ids.has(p.id)), tries);
    if (r) return [[q.id, o.map((p) => p.id)], ...r];
    if ((tries.n += 1) > 400) return null;
  }
  return null;
}

// For each cheque, the bank lines that most likely make it up.
// Returns { groups: { [chequeId]: [lineIds] }, complete }.
export function suggestGroups(cheques, lines, { depositDate = null, prefer = [] } = {}) {
  const pref = new Set(prefer);
  const score = (l) => (pref.has(l.id) ? 0 : 1000) + (looksCheque(l) ? 0 : 200)
    + (depositDate ? (days(l.txn_date, depositDate) < -1 ? 100 : 0) + Math.min(60, Math.abs(days(l.txn_date, depositDate))) : 0);
  const biggest = Math.max(0, ...cheques.map((q) => cents(q.amount)));
  const pool = lines.filter((l) => cents(l.credit) > 0 && cents(l.credit) <= biggest)
    .map((l) => ({ id: l.id, c: cents(l.credit), s: score(l), d: l.txn_date, l }))
    .sort((a, b) => a.s - b.s || a.id - b.id);
  const groups = Object.fromEntries(cheques.map((q) => [q.id, []]));
  const used = new Set();
  // a line carrying the cheque's own number and amount is that cheque
  for (const q of cheques) {
    const n = digits(q.cheque_no);
    const hit = n && pool.find((p) => !used.has(p.id) && p.c === cents(q.amount)
      && (digits(p.l.cheque_no) === n || String(p.l.narration ?? '').split(/\D+/).map((x) => x.replace(/^0+/, '')).includes(n)));
    if (hit) { groups[q.id] = [hit.id]; used.add(hit.id); }
  }
  const rest = cheques.filter((q) => !groups[q.id].length).sort((a, b) => cents(b.amount) - cents(a.amount));
  const free = pool.filter((p) => !used.has(p.id));
  const near = depositDate ? free.filter((p) => pref.has(p.id) || (days(p.d, depositDate) >= -3 && days(p.d, depositDate) <= 21)) : free;
  for (const cand of near.length < free.length ? [near, free] : [free]) {
    const sol = solve(rest, cand.slice(0, 40), { n: 0 });
    if (sol) { for (const [qid, ids] of sol) groups[qid] = ids; return { groups, complete: true }; }
  }
  // no full answer: fill what can be found cheque by cheque
  for (const q of rest) {
    const best = rank(subsets(free.filter((p) => !used.has(p.id)).slice(0, 40), cents(q.amount)))[0];
    if (best) { groups[q.id] = best.map((p) => p.id); best.forEach((p) => used.add(p.id)); }
  }
  return { groups, complete: false };
}

export default function ChequeLines({ deposit, cheques, lines, prefer = [], matched = false, onDone, onCancel, cancelLabel = 'Cancel', onLinesChange }) {
  const first = useMemo(() => suggestGroups(cheques, lines, { depositDate: matched ? null : deposit.deposit_date, prefer }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [groups, setGroups] = useState(first.groups);
  const [nums, setNums] = useState({});
  const [picking, setPicking] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const byId = useMemo(() => Object.fromEntries(lines.map((l) => [l.id, l])), [lines]);
  useEffect(() => { onLinesChange?.(Object.values(groups).flat()); }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps
  const owner = useMemo(() => Object.fromEntries(Object.entries(groups).flatMap(([qid, ids]) => ids.map((id) => [id, Number(qid)]))), [groups]);

  const numFor = (qq, id, k) => nums[id] ?? (numberOn(byId[id]) || (k === 0 ? qq.cheque_no : `${qq.cheque_no}-${k + 1}`));
  const state = cheques.map((qq) => {
    const ids = groups[qq.id] ?? [];
    const total = ids.reduce((s, id) => s + cents(byId[id]?.credit), 0);
    const ns = ids.length > 1 ? ids.map((id, k) => String(numFor(qq, id, k)).trim()) : [];
    const badNo = ns.some((n) => !n) || new Set(ns).size !== ns.length;
    return { qq, ids, total, diff: cents(qq.amount) - total, badNo };
  });
  const unused = matched ? lines.filter((l) => !owner[l.id]) : [];
  const ready = state.every((s) => s.ids.length && s.diff === 0 && !s.badNo) && unused.length === 0;
  const splits = state.filter((s) => s.ids.length > 1).length;

  const toggle = (qid, id) => setGroups((g) => {
    const mine = g[qid] ?? [];
    return { ...g, [qid]: mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id] };
  });
  const again = () => { const s = suggestGroups(cheques, lines, { depositDate: matched ? null : deposit.deposit_date, prefer }); setGroups(s.groups); setNums({}); };

  async function save() {
    setBusy(true); setError('');
    try {
      const map = state.map((s) => ({ cheque_id: s.qq.id, lines: s.ids.map((id, k) => ({ line_id: id, cheque_no: s.ids.length > 1 ? String(numFor(s.qq, id, k)).trim() : '' })) }));
      const r = await rpc('cc_deposit_split_match', { p_deposit_id: deposit.id, p_map: map });
      await onDone?.(r);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  const term = q.trim().toLowerCase().replace(/,/g, '');
  return (
    <div className="cheque-lines">
      <h3 className="subhead">Match cheque by cheque</h3>
      <p className="hint">The bank may show a cheque as several lines. Each cheque below needs the bank line(s) adding up to it.
        A cheque with two or more lines is split into the cheques the bank shows (numbers from the bank lines); its invoices are shared across them in order, and Sales is told.</p>
      {first.complete
        ? <p className="ok-text">Suggested from the bank statement: check each cheque's lines, or change them.</p>
        : <p className="warn-text">The app couldn't find bank lines adding up to every cheque. Pick the lines for the ones left.</p>}

      {state.map(({ qq, ids, total, diff, badNo }) => (
        <div key={qq.id} className={`cl-cheque ${ids.length && diff === 0 && !badNo ? 'done' : ''}`}>
          <div className="cl-head">
            <span><b>{qq.customer ? `${qq.customer}: ` : ''}cheque {qq.cheque_no}</b></span>
            <span className="num"><b>LKR {lkr(qq.amount)}</b></span>
          </div>
          {ids.length === 0 ? <p className="muted small">No bank line chosen yet.</p> : (
            <ul className="cl-lines">
              {ids.map((id, k) => {
                const l = byId[id];
                return (
                  <li key={id}>
                    <span className="lp-main">
                      <span className="lp-narr">{l.narration}</span>
                      <span className="lp-meta">
                        <span>{fmtDate(l.txn_date)}</span>
                        {l.reference && <span>Ref {l.reference}</span>}
                        {l.cheque_no && <span>Cheque {l.cheque_no}</span>}
                      </span>
                      {ids.length > 1 && (
                        <label className="cl-no"><span>Cheque no.</span>
                          <input inputMode="numeric" value={numFor(qq, id, k)} onChange={(e) => setNums((n) => ({ ...n, [id]: e.target.value }))} aria-label={`Cheque number for LKR ${lkr(l.credit)}`} />
                        </label>
                      )}
                    </span>
                    <span className="num lp-amt">{lkr(l.credit)}</span>
                    <button type="button" className="link danger-text" onClick={() => toggle(qq.id, id)} aria-label={`Take LKR ${lkr(l.credit)} off cheque ${qq.cheque_no}`}>✕</button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="cl-foot">
            <span className={diff === 0 && ids.length ? 'ok-text' : 'warn-text'}>
              {!ids.length ? `LKR ${lkr(qq.amount)} to find` : diff === 0 ? `✓ Adds up to LKR ${lkr(total / 100)}${ids.length > 1 ? `: split into ${ids.length} cheques` : ''}`
                : diff > 0 ? `LKR ${lkr(total / 100)}: short by LKR ${lkr(diff / 100)}` : `LKR ${lkr(total / 100)}: over by LKR ${lkr(-diff / 100)}`}
            </span>
            {badNo && <span className="warn-text">Give each line its own cheque number.</span>}
            <button type="button" className="link" onClick={() => { setPicking(picking === qq.id ? null : qq.id); setQ(''); }}>
              {picking === qq.id ? 'Done picking' : 'Pick the lines'}
            </button>
          </div>
          {picking === qq.id && (
            <div className="linepicker">
              <input type="search" placeholder="Filter by amount, narration, reference or cheque number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter bank lines" />
              <ul>
                {lines.filter((l) => (!owner[l.id] || owner[l.id] === qq.id)
                    && (!term || [l.narration, l.reference, l.cheque_no, String(l.credit)].some((v) => String(v ?? '').toLowerCase().includes(term))))
                  .sort((a, b) => (owner[b.id] === qq.id) - (owner[a.id] === qq.id) || (cents(b.credit) === diff) - (cents(a.credit) === diff) || String(b.txn_date).localeCompare(String(a.txn_date)))
                  .slice(0, 80).map((l) => (
                    <li key={l.id} className={owner[l.id] === qq.id ? 'on' : ''}>
                      <label>
                        <input type="checkbox" checked={owner[l.id] === qq.id} onChange={() => toggle(qq.id, l.id)} />
                        <span className="lp-main">
                          <span className="lp-narr">{l.narration || '(no narration)'}</span>
                          <span className="lp-meta">
                            <span>{fmtDate(l.txn_date)}</span>
                            {l.reference && <span>Ref {l.reference}</span>}
                            {l.cheque_no && <span>Cheque {l.cheque_no}</span>}
                            {owner[l.id] !== qq.id && diff > 0 && cents(l.credit) === diff && <span className="lp-exact">Makes up the rest</span>}
                          </span>
                        </span>
                        <span className="num lp-amt">{lkr(l.credit)}</span>
                      </label>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      ))}

      {unused.length > 0 && <p className="warn-text">Every bank line of the slip needs its cheque: {unused.map((l) => `LKR ${lkr(l.credit)}`).join(', ')} {unused.length === 1 ? "isn't" : "aren't"} on any cheque.</p>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !ready} onClick={save}>
          {busy ? 'Saving…' : matched ? (splits ? 'Split the cheques' : 'Save') : splits ? 'Split the cheques and match the slip' : 'Match the slip'}
        </button>
        <button type="button" className="btn ghost" onClick={again}>Suggest again</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>{cancelLabel}</button>}
      </div>
    </div>
  );
}
