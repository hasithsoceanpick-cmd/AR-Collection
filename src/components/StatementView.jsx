import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, rpc } from '../lib/supabase';
import { fetchAll } from '../lib/bcimport';
import { orderStatement } from '../lib/statementOrder';
import { lkr, ref, fmtDate } from '../lib/format';
import { TAGS } from '../lib/workflow';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (d) => (d ? d.slice(0, 7) : null);
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// Finance: a bank account's statement as uploaded, in the bank's own order with its running
// balance, showing what every line is linked to. `highlightIds` = the line(s) the current item clears.
export default function StatementView({ accountId, highlightIds = [], focusDate = null, allowTag = false, compact = false }) {
  const [account, setAccount] = useState(null);
  const [lines, setLines] = useState(null);
  const [labels, setLabels] = useState({ c: {}, d: {} });
  const [month, setMonth] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const focusRef = useRef(null);
  const hi = useMemo(() => new Set(highlightIds), [highlightIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    try {
      const [{ data: a }, ls] = await Promise.all([
        db.from('bank_accounts').select('id, name, opening_balance').eq('id', accountId).single(),
        fetchAll(() => db.from('statement_lines').select('*').eq('account_id', accountId).order('txn_date').order('id')),
      ]);
      const cids = [...new Set(ls.filter((l) => l.collection_id).map((l) => l.collection_id))];
      const dids = [...new Set(ls.filter((l) => l.deposit_id).map((l) => l.deposit_id))];
      const [c1, c2] = await Promise.all([
        cids.length ? db.from('collections').select('id, customer_name').in('id', cids) : { data: [] },
        dids.length ? db.from('collections').select('id, customer_name, deposit_id').in('deposit_id', dids) : { data: [] },
      ]);
      const c = Object.fromEntries((c1.data ?? []).map((x) => [x.id, x.customer_name]));
      const d = {};
      for (const x of c2.data ?? []) (d[x.deposit_id] ??= []).push(x.customer_name);
      setAccount(a); setLines(ls); setLabels({ c, d });
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { setLines(null); load(); }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ordered = useMemo(() => (lines ? orderStatement(lines, account?.opening_balance) : []), [lines, account]);
  const months = useMemo(() => [...new Set(ordered.map((l) => monthOf(l.txn_date)))], [ordered]);
  const shownMonth = month ?? (monthOf(focusDate) && months.includes(monthOf(focusDate)) ? monthOf(focusDate) : months[months.length - 1]);
  const shown = shownMonth === 'all' ? ordered : ordered.filter((l) => monthOf(l.txn_date) === shownMonth);

  useEffect(() => { focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [shown.length, [...hi].join(',')]); // eslint-disable-line

  async function tag(l, t) {
    let note = null;
    if (t === 'other') { note = window.prompt('What is this line? (e.g. loan, refund)'); if (!note) return; }
    setBusy(true);
    try { await rpc('cc_tag_line', { p_line_id: l.id, p_tag: t, p_note: note }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function untag(l) {
    setBusy(true);
    try { await rpc('cc_untag_line', { p_line_id: l.id }); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (error) return <p className="error">{error}</p>;
  if (!lines) return <p className="muted">Loading the statement…</p>;
  if (!lines.length) return <p className="muted">No statement lines uploaded for this account yet.</p>;

  const ins = shown.filter((l) => l.credit > 0);
  const rec = ins.filter((l) => l.link_kind === 'deposit' || l.link_kind === 'transfer' || l.link_kind === 'cash');
  const tagged = ins.filter((l) => l.link_kind === 'tag');
  const unid = ins.filter((l) => !l.link_kind);
  const sum = (a) => a.reduce((s, l) => s + Number(l.credit), 0);
  let firstHi = true;

  return (
    <div className={compact ? 'stmt compact' : 'stmt'}>
      <div className="stmt-head">
        <strong>{account?.name} statement</strong>
        <select value={shownMonth} onChange={(e) => setMonth(e.target.value)} aria-label="Period">
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          <option value="all">Whole statement</option>
        </select>
      </div>
      <div className="stmt-sum">
        <span><b>{ins.length}</b> money-in lines</span>
        <span className="s-ok"><b>{rec.length}</b> linked to receipts, LKR {lkr(sum(rec))}</span>
        {tagged.length > 0 && <span><b>{tagged.length}</b> tagged, LKR {lkr(sum(tagged))}</span>}
        <span className={unid.length ? 's-warn' : 's-ok'}><b>{unid.length}</b> unidentified, LKR {lkr(sum(unid))}</span>
        {hi.size > 0 && <span className="s-this">Highlighted: the line{hi.size > 1 ? 's' : ''} this item clears</span>}
      </div>
      <div className="stmt-table">
        <table className="table">
          <thead><tr><th>Date</th><th>Narration</th>{!compact && <th>Ref / Chq</th>}<th className="num">Out</th><th className="num">In</th><th className="num">Balance</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((l) => {
              const isHi = hi.has(l.id);
              const refProp = isHi && firstHi ? (firstHi = false, focusRef) : undefined;
              const cls = isHi ? 'this-item' : l.debit > 0 ? 'out' : !l.link_kind ? 'unid' : '';
              return (
                <tr key={l.id} ref={refProp} className={cls}>
                  <td>{fmtDate(l.txn_date)}</td>
                  <td className="narr">{l.narration}</td>
                  {!compact && <td>{[l.reference, l.cheque_no].filter(Boolean).join(' · ')}</td>}
                  <td className="num">{l.debit > 0 ? lkr(l.debit) : ''}</td>
                  <td className="num">{l.credit > 0 ? lkr(l.credit) : ''}</td>
                  <td className="num">{l.running != null ? lkr(l.running) : ''}</td>
                  <td className="st">
                    {isHi && <span className="this-tag">This item</span>}
                    {l.link_kind === 'transfer' && <Link to={`/c/${l.collection_id}`}>{ref(l.collection_id)} {labels.c[l.collection_id] ?? ''}</Link>}
                    {l.link_kind === 'deposit' && <Link to={`/deposits#d${l.deposit_id}`}>Slip D-{l.deposit_id}: {(labels.d[l.deposit_id] ?? []).join(', ')}</Link>}
                    {l.link_kind === 'cash' && <Link to="/cash">Cash handed over and banked</Link>}
                    {l.link_kind === 'tag' && <>{TAGS[l.tag]}{l.tag_note ? `: ${l.tag_note}` : ''}{allowTag && <> <button className="link" disabled={busy} onClick={() => untag(l)}>undo</button></>}</>}
                    {!l.link_kind && l.credit > 0 && !isHi && (
                      <>
                        <span className="warn-text">Unidentified</span>
                        {allowTag && <span className="tag-btns"> {Object.entries(TAGS).map(([k, v]) => <button key={k} className="link" disabled={busy} onClick={() => tag(l, k)}>{v}</button>)}</span>}
                      </>
                    )}
                    {l.debit > 0 && !l.link_kind && <span className="muted">Money out</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
