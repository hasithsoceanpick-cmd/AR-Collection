import { useMemo, useState } from 'react';
import { rpc } from '../lib/supabase';
import { lkr } from '../lib/format';

// Finance Admin: the bank shows a recorded cheque as two or more cheques (Sales recorded one).
// Split it into the cheques the bank shows; the invoices it settles are shared across them in order.
// cheques: the slip's cheques [{ id, cheque_no, amount, customer }]; lines: bank lines [{ id, credit, cheque_no, narration }]
let seq = 0;
const cents = (n) => Math.round(Number(n) * 100);
const numberOn = (l) => String(l.cheque_no ?? '').replace(/\D/g, '') || (String(l.narration ?? '').match(/\d{6}/)?.[0] ?? '');

// The bank lines no recorded cheque matches exactly, and the recorded cheque they most likely are.
export function proposeSplit(cheques, lines, preselect = null) {
  const used = new Set();
  const free = [];
  for (const q of cheques) {
    if (q.id === preselect) { free.push(q); continue; }
    const hit = lines.find((l) => !used.has(l.id) && cents(l.credit) === cents(q.amount));
    if (hit) used.add(hit.id); else free.push(q);
  }
  const rest = lines.filter((l) => !used.has(l.id));
  const restTotal = rest.reduce((s, l) => s + cents(l.credit), 0);
  const cheque = free.find((q) => q.id === preselect) ?? free.find((q) => cents(q.amount) === restTotal) ?? free.find((q) => cents(q.amount) > Math.max(0, ...rest.map((l) => cents(l.credit)))) ?? free[0] ?? cheques[0];
  const parts = rest.length >= 2 ? rest.map((l) => ({ k: ++seq, cheque_no: numberOn(l), amount: Number(l.credit).toFixed(2), from: l }))
    : [{ k: ++seq, cheque_no: cheque?.cheque_no ?? '', amount: '' }, { k: ++seq, cheque_no: '', amount: '' }];
  return { chequeId: cheque?.id ?? null, parts };
}

export default function ChequeSplit({ cheques, lines, preselect = null, submitLabel = 'Split the cheque', onSplit, onCancel }) {
  const first = useMemo(() => proposeSplit(cheques, lines, preselect), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [chequeId, setChequeId] = useState(first.chequeId);
  const [parts, setParts] = useState(first.parts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const q = cheques.find((x) => x.id === chequeId);
  const total = parts.reduce((s, p) => s + cents(String(p.amount).replace(/,/g, '') || 0), 0);
  const diff = q ? cents(q.amount) - total : 0;
  const ready = q && parts.length >= 2 && parts.every((p) => p.cheque_no.trim() && Number(String(p.amount).replace(/,/g, '')) > 0) && diff === 0;
  const set = (k, f, v) => setParts((ps) => ps.map((p) => (p.k === k ? { ...p, [f]: v } : p)));

  async function save() {
    setBusy(true); setError('');
    try {
      const r = await rpc('cc_cheque_split', { p_cheque_id: chequeId, p_parts: parts.map((p) => ({ cheque_no: p.cheque_no.trim(), amount: String(p.amount).replace(/,/g, '') })) });
      await onSplit?.(r);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="cheque-split">
      <h3 className="subhead">Split the recorded cheque into the cheques the bank shows</h3>
      <p className="hint">Sales recorded one cheque, the bank shows more. Give each cheque as on the bank statement; they must add up to the recorded cheque.
        The invoices it settles are shared across them in order, and Sales is told.</p>
      <label className="field"><span className="flabel">Recorded cheque</span>
        <select value={chequeId ?? ''} onChange={(e) => setChequeId(Number(e.target.value))}>
          {cheques.map((x) => <option key={x.id} value={x.id}>{x.customer ? `${x.customer}: ` : ''}cheque {x.cheque_no}, LKR {lkr(x.amount)}</option>)}
        </select></label>
      <div className="table-wrap flat">
        <table className="table split-parts">
          <thead><tr><th>Cheque no. (bank)</th><th className="num">LKR</th><th>From the bank line</th><th aria-label="Remove" /></tr></thead>
          <tbody>{parts.map((p) => (
            <tr key={p.k}>
              <td><input inputMode="numeric" value={p.cheque_no} onChange={(e) => set(p.k, 'cheque_no', e.target.value)} aria-label="Cheque number" /></td>
              <td><input className="num" inputMode="decimal" value={p.amount} onChange={(e) => set(p.k, 'amount', e.target.value)} aria-label="Amount" /></td>
              <td className="small muted">{p.from ? `${p.from.narration ?? ''} · LKR ${lkr(p.from.credit)}` : '—'}</td>
              <td>{parts.length > 2 && <button type="button" className="link danger-text" onClick={() => setParts((ps) => ps.filter((x) => x.k !== p.k))} aria-label="Remove this cheque">✕</button>}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td>Total</td><td className="num">{lkr(total / 100)}</td><td colSpan={2}>{q && diff !== 0 && <span className="warn-text">{diff > 0 ? `LKR ${lkr(diff / 100)} short of` : `LKR ${lkr(-diff / 100)} over`} the recorded LKR {lkr(q.amount)}</span>}</td></tr></tfoot>
        </table>
      </div>
      <div className="row">
        <button type="button" className="btn small ghost" onClick={() => setParts((ps) => [...ps, { k: ++seq, cheque_no: '', amount: '' }])}>Add a cheque</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !ready} onClick={save}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
