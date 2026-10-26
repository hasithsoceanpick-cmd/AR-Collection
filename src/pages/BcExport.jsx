import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, rpc } from '../lib/supabase';
import { lkr, fmtDate } from '../lib/format';
import { downloadJournal, journalText } from '../lib/bcjournal';
import { useAuth } from '../lib/auth';
import { NumberCheck, NumberSeries, Renumber } from '../components/DocNumbers';
import ChequeSplit from '../components/ChequeSplit';

const ISSUE = {
  needs_split: { text: "Waiting for Sales' cheque split", block: true },
  cheque_map: { text: 'Say which cheque is on this bank line', block: true },
  no_customer: { text: 'Customer not in the BC customer list', block: true },
  no_bank_code: { text: 'Bank account has no BC code (Bank page)', block: true },
  no_invoices: { text: 'No invoices from Sales: export unapplied?', block: false },
  credit_memo: { text: 'Includes a credit memo: apply it manually in BC', block: false },
  drafts_open: { text: 'Card sales on this batch not set off by Sales yet', block: true },
  drafts_review: { text: 'Card payments on this batch waiting for your review', block: true },
  no_bank_line: { text: 'No Amana credit matched to this batch yet', block: true },
  total_mismatch: { text: "The journal doesn't add up to the bank credit", block: true },
};
const today = () => new Date().toISOString().slice(0, 10);

function ChequeMap({ depositId, onDone, admin }) {
  const [split, setSplit] = useState(false);
  const [lines, setLines] = useState(null);
  const [cheques, setCheques] = useState([]);
  const [pick, setPick] = useState({});
  const [error, setError] = useState('');
  useEffect(() => {
    (async () => {
      const l = await db.from('statement_lines').select('id, txn_date, narration, cheque_no, credit').eq('deposit_id', depositId).order('id');
      const c = await db.from('collections').select('id, customer_name, cheques!cheques_collection_id_fkey(id, cheque_no, amount, returned_at)').eq('deposit_id', depositId).neq('status', 'cancelled');
      setLines(l.data ?? []); setCheques((c.data ?? []).flatMap((x) => x.cheques.filter((q) => !q.returned_at).map((q) => ({ ...q, customer: x.customer_name }))));
    })();
  }, [depositId]);
  if (!lines) return <p className="muted">Loading…</p>;
  const save = async () => {
    setError('');
    try {
      await rpc('cc_bc_map_cheques', { p_deposit_id: depositId, p_map: Object.entries(pick).flatMap(([cid, lid]) => (lid ? [{ line_id: Number(lid), cheque_id: Number(cid) }] : [])) });
      onDone();
    } catch (e) { setError(e.message); }
  };
  return (
    <div className="action">
      <h2>Which bank line carries which cheque?</h2>
      <p className="hint">The app couldn't tell from the cheque numbers and amounts. Choose the bank line for each cheque on this slip.</p>
      {lines.length > cheques.length && (admin
        ? (split
          ? <ChequeSplit cheques={cheques} lines={lines} onSplit={onDone} onCancel={() => setSplit(false)} />
          : <p className="hint">The bank shows {lines.length} lines for {cheques.length} recorded cheque{cheques.length === 1 ? '' : 's'}?{' '}
              <button type="button" className="link" onClick={() => setSplit(true)}>Split a recorded cheque to match the bank</button></p>)
        : <p className="warn-text">The bank shows {lines.length} lines for {cheques.length} recorded cheque{cheques.length === 1 ? '' : 's'}: if one cheque is really two, a Finance Admin can split it to match the bank.</p>)}
      {cheques.map((q) => (
        <div className="row-2" key={q.id}>
          <span>{q.customer}: cheque {q.cheque_no}, LKR {lkr(q.amount)}</span>
          <select value={pick[q.id] ?? ''} onChange={(e) => setPick({ ...pick, [q.id]: e.target.value })}>
            <option value="">Choose the bank line…</option>
            {lines.map((l) => <option key={l.id} value={l.id}>{fmtDate(l.txn_date)} · LKR {lkr(l.credit)} · {l.narration}</option>)}
          </select>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={cheques.some((q) => !pick[q.id])} onClick={save}>Save</button>
    </div>
  );
}

export default function BcExport() {
  const { role, isAdmin } = useAuth();
  const [rows, setRows] = useState(null);
  const [nextNo, setNextNo] = useState('');
  const [sel, setSel] = useState(new Set());
  const [unapplied, setUnapplied] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [mapDeposit, setMapDeposit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [bcOk, setBcOk] = useState(false);
  const [numState, setNumState] = useState({ app: 0, bc: 0 });

  const load = useCallback(async () => {
    setError('');
    try {
      const [c0, m, s] = await Promise.all([rpc('cc_bc_candidates'), rpc('cc_bc_merchant_candidates'), db.from('doc_series').select('next_no').eq('code', 'BAKRC').maybeSingle()]);
      const c = [...(c0 ?? []), ...(m ?? [])].sort((a, b) => String(a.txn_date).localeCompare(String(b.txn_date)));
      setRows(c);
      if (s.data?.next_no) setNextNo(String(s.data.next_no));
      setSel(new Set((c ?? []).filter((r) => !(r.built.issues ?? []).some((i) => ISSUE[i]?.block) && !(r.built.issues ?? []).includes('no_invoices')).map((r) => r.key)));
    } catch (e) { setError(e.message); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const blocked = (r) => (r.built.issues ?? []).some((i) => ISSUE[i]?.block);
  const newCount = useMemo(() => (rows ?? []).filter((r) => sel.has(r.key) && !r.doc_no).length, [rows, sel]);
  const needsNew = newCount > 0;
  const selTotal = (rows ?? []).filter((r) => sel.has(r.key)).reduce((a, r) => a + Number(r.credit), 0);
  // unapplied ticks: bank lines by id, cash receipts as negative ids, merchant batches as 'B<id>'
  const uid = (r) => (r.batch_id ? `B${r.batch_id}` : r.cash_id ? -r.cash_id : r.line_id);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleUnapplied = (r) => {
    const id = uid(r), on = !unapplied.has(id);
    setUnapplied((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });
    setSel((s) => { const n = new Set(s); on ? n.add(r.key) : n.delete(r.key); return n; });
  };

  const doExport = async () => {
    setBusy(true); setError(''); setResult(null); setCopied(false);
    try {
      const picked = (rows ?? []).filter((r) => sel.has(r.key));
      const lineIds = picked.filter((r) => r.line_id && !r.batch_id).map((r) => r.line_id);
      const cashIds = picked.filter((r) => r.cash_id).map((r) => r.cash_id);
      const batchIds = picked.filter((r) => r.batch_id).map((r) => r.batch_id);
      let res = { docs: [], skipped: [], next_no: needsNew ? Number(nextNo) : null };
      if (lineIds.length || cashIds.length) {
        res = await rpc('cc_bc_export', {
          p_line_ids: lineIds, p_first_no: needsNew ? Number(nextNo) : null,
          p_unapplied_ok: [...unapplied].filter((x) => typeof x === 'number'), p_cash_ids: cashIds, p_bc_numbers_ok: bcOk,
        });
      }
      if (batchIds.length) {
        // merchant batches continue the BAKRC numbering after the bank-line documents
        const m = await rpc('cc_bc_export_merchant', {
          p_batch_ids: batchIds, p_first_no: res.next_no ?? (needsNew ? Number(nextNo) : null),
          p_unapplied_ok: [...unapplied].filter((x) => typeof x === 'string').map((x) => Number(x.slice(1))), p_bc_numbers_ok: bcOk,
        });
        res = { docs: [...res.docs, ...m.docs], skipped: [...res.skipped, ...m.skipped], next_no: m.next_no };
      }
      setResult(res);
      if (res.docs.length) await downloadJournal(res.docs, `BC Cash Receipt Journal ${res.docs[0].doc_no}${res.docs.length > 1 ? ` to ${res.docs[res.docs.length - 1].doc_no}` : ''} (${today()}).xlsx`);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const copy = async () => { await navigator.clipboard.writeText(journalText(result.docs)); setCopied(true); };

  if (rows === null) return <p className="muted">Loading…</p>;
  const groups = [
    { key: 'new', title: 'Ready to export', list: rows.filter((r) => (!r.doc_no || r.preassigned) && !blocked(r)) },
    { key: 'again', title: 'Exported but not in BC yet', hint: 'BC doesn\'t show these yet. Export again with the same numbers if they weren\'t posted.', list: rows.filter((r) => r.doc_no && !r.preassigned) },
    { key: 'blocked', title: 'Needs attention first', list: rows.filter((r) => (!r.doc_no || r.preassigned) && blocked(r)) },
  ];

  return (
    <section className="wide">
      <div className="page-head"><h1>Export to BC</h1></div>
      <p className="lede">Closed receipts matched to a bank line (one BAKRC number per bank line, the bank as balancing account), HNB card batches (one BAKRC per batch: customers at the full card amount, the 3% commission to G/L 204003, Amana as balancing account),
        and received cash handovers (one CSHRC number per customer, balancing account 103700 Cash In Hand). One journal line per invoice from Sales' instructions. A document keeps its number when exported again; if BC posted it under another number, use Change number so the app matches BC.</p>
      {error && <p className="error">{error}</p>}

      {result && (
        <div className="facts ok-box">
          <h2>Exported {result.docs.length} document{result.docs.length === 1 ? '' : 's'}</h2>
          {result.docs.length > 0 && <p>{result.docs[0].doc_no}{result.docs.length > 1 ? ` to ${result.docs[result.docs.length - 1].doc_no}` : ''}: the Excel file has downloaded.
            Paste it into the BC Cash Receipt Journal, or copy the lines here and paste into the journal page (same column order).</p>}
          <div className="btn-row">
            {result.docs.length > 0 && <button className="btn primary" onClick={copy}>{copied ? 'Copied' : 'Copy journal lines'}</button>}
            {result.docs.length > 0 && <button className="btn" onClick={() => downloadJournal(result.docs, `BC Cash Receipt Journal (${today()}).xlsx`)}>Download again</button>}
          </div>
          {result.skipped.length > 0 && <p className="warn-text">{result.skipped.length} line(s) were not exported: {result.skipped.map((s) => s.issues.join(', ')).join('; ')}.</p>}
          <p className="hint">After posting in BC, upload the bank and customer ledgers on <Link to="/bc-check">BC check</Link> to confirm.</p>
        </div>
      )}

      {rows.length === 0 ? <p className="muted">Nothing to export: every closed receipt is confirmed posted.</p> : (
        <>
          <div className="facts export-bar">
            <label>First new BAKRC number
              <input inputMode="numeric" value={nextNo} onChange={(e) => setNextNo(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 2557" />
            </label>
            <p className="hint">{needsNew ? <>New numbers start at <strong>BAKRC-{String(nextNo || '0').padStart(7, '0')}</strong>. Check it's the next free number in BC.</> : 'The selected documents already have their numbers.'}</p>
            {needsNew && <NumberCheck code="BAKRC" first={nextNo} count={newCount} bcOk={bcOk} setBcOk={setBcOk} onState={setNumState} />}
            <div className="export-go">
              <span>{sel.size} document{sel.size === 1 ? '' : 's'} · LKR {lkr(selTotal)}</span>
              <button className="btn primary" disabled={busy || role !== 'finance' || sel.size === 0 || (needsNew && (!nextNo || numState.app > 0 || (numState.bc > 0 && !bcOk)))} onClick={doExport}>{busy ? 'Exporting…' : 'Export to Excel'}</button>
            </div>
          </div>

          {groups.map((g) => g.list.length > 0 && (
            <div className="facts" key={g.key}>
              <h2>{g.title} ({g.list.length})</h2>
              {g.hint && <p className="hint">{g.hint}</p>}
              <div className="table-wrap flat">
                <table className="table">
                  <thead><tr><th></th><th>Bank date</th><th>Account</th><th>Bank line</th><th>Customer and invoices</th><th className="num">LKR</th><th>Document</th></tr></thead>
                  <tbody>
                    {g.list.map((r) => {
                      const lines = r.built.lines ?? [];
                      const custs = [...new Set(lines.map((l) => l.account_name).filter(Boolean))];
                      const invs = lines.map((l) => l.applies_doc_no).filter(Boolean);
                      const issues = r.built.issues ?? [];
                      return (
                        <Fragment key={r.key}>
                          <tr className={sel.has(r.key) ? 'row-picked' : ''}>
                            <td><input type="checkbox" checked={sel.has(r.key)} disabled={blocked(r) || role !== 'finance'} onChange={() => toggle(r.key)} aria-label="Export this line" /></td>
                            <td>{fmtDate(r.txn_date)}</td>
                            <td>{r.account}</td>
                            <td className="narr">{r.narration}{r.reference ? <div className="muted small">{r.reference}</div> : null}</td>
                            <td>
                              {custs.join(', ') || <span className="muted">—</span>}
                              <div className="muted small">{invs.length ? invs.join(', ') : 'no invoices'} · {lines.length} journal line{lines.length === 1 ? '' : 's'}{' '}
                                <button className="link" onClick={() => setOpen(open === r.key ? null : r.key)}>{open === r.key ? 'hide' : 'show'}</button></div>
                              {issues.map((i) => <div key={i} className={ISSUE[i]?.block ? 'error small' : 'warn-text small'}>{ISSUE[i]?.text ?? i}
                                {i === 'no_invoices' && <label className="check inline"><input type="checkbox" checked={unapplied.has(uid(r))} disabled={role !== 'finance'} onChange={() => toggleUnapplied(r)} /> Export unapplied</label>}
                                {i === 'cheque_map' && role === 'finance' && <button className="link" onClick={() => setMapDeposit(r.deposit_id)}>Choose</button>}
                                {i === 'needs_split' && <> · {r.collection_id ? <Link to={`/c/${r.collection_id}`}>open</Link> : 'ask Sales'}</>}
                              </div>)}
                            </td>
                            <td className="num">{lkr(r.credit)}</td>
                            <td>{r.doc_no ? <><strong>{r.doc_no}</strong><div className="muted small">{r.preassigned ? 'given at receipt' : `exported ${r.export_count}×`}</div>
                              {role === 'finance' && (r.cash_id ? <Renumber kind="cash" id={r.cash_id} onDone={load} /> : <Renumber docNo={r.doc_no} onDone={load} />)}</> : <span className="muted">new</span>}</td>
                          </tr>
                          {open === r.key && (
                            <tr className="sub-row"><td></td><td colSpan={6}>
                              <table className="table inner">
                                <thead><tr><th>Account</th><th>Description</th><th>Applies to</th><th>Ext. Doc No.</th><th>Comment</th><th className="num">Credit</th><th className="num">Debit</th></tr></thead>
                                <tbody>{lines.map((l) => (
                                  <tr key={l.line_no}><td>{l.account_no} {l.account_name}</td><td>{l.description}</td><td>{l.applied ? l.applies_doc_no : <span className="muted">unapplied</span>}</td>
                                    <td>{l.ext_doc_no}</td><td className="narr">{l.comment}</td><td className="num">{l.amount < 0 ? lkr(-l.amount) : ''}</td><td className="num">{l.amount > 0 ? lkr(l.amount) : ''}</td></tr>
                                ))}</tbody>
                              </table>
                            </td></tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
      {role === 'finance' && <NumberSeries />}
      {mapDeposit && <ChequeMap depositId={mapDeposit} admin={isAdmin && role === 'finance'} onDone={() => { setMapDeposit(null); load(); }} />}
    </section>
  );
}
