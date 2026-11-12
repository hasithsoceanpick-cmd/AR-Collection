import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, rpc } from '../lib/supabase';
import { lkr, fmtDate } from '../lib/format';
import { downloadJournal, journalText } from '../lib/bcjournal';
import { useAuth } from '../lib/auth';
import { MatchBc, Renumber } from '../components/DocNumbers';
import CloseMonth from '../components/CloseMonth';
import ChequeLines from '../components/ChequeLines';

const numOf = (no) => Number(String(no ?? '').replace(/\D/g, ''));
// exported before under a BAKRC number, not posted yet (goes again)
const isAgain = (r) => Boolean(r.doc_no && !r.preassigned && String(r.doc_no).startsWith('BAKRC-'));

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
  no_payout_line: { text: 'No Sampath credit paired with this payout yet (PayHere page)', block: true },
  payments_open: { text: 'PayHere payments with no invoice yet (PayHere page)', block: true },
  payments_unconfirmed: { text: "PayHere matches or Sales' splits waiting for your confirmation (PayHere page)", block: true },
  split_mismatch: { text: "A PayHere payment's split doesn't add up to the payment (PayHere page)", block: true },
  payments_missing: { text: "Payments of this payout aren't in the app: upload a PayHere Payments export that covers it", block: true },
  invoice_gone: { text: 'An invoice on this payout is no longer open in the customer ledger (already settled?)', block: true },
  total_mismatch: { text: "The journal doesn't add up to the bank credit", block: true },
  posted_under_old: { text: 'BC already has this posted under an earlier (reopened) number: not exported again. Match BC numbers removes the copy.', block: true },
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
      const l = await db.from('statement_lines').select('id, txn_date, narration, reference, cheque_no, credit').eq('deposit_id', depositId).order('id');
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
          ? <ChequeLines deposit={{ id: depositId }} cheques={cheques} lines={lines} matched onDone={onDone} onCancel={() => setSplit(false)} />
          : <p className="hint">The bank shows {lines.length} lines for {cheques.length} recorded cheque{cheques.length === 1 ? '' : 's'}?{' '}
              <button type="button" className="link" onClick={() => setSplit(true)}>Match cheque by cheque (split a cheque the bank shows as several)</button></p>)
        : <p className="warn-text">The bank shows {lines.length} lines for {cheques.length} recorded cheque{cheques.length === 1 ? '' : 's'}: if a cheque is really several, a Finance Admin can split it to match the bank.</p>)}
      {split ? null : (<>
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
      </>)}
    </div>
  );
}

// What typing BC's next number changes, shown before Export is pressed.
function LineUp({ plan }) {
  if (!plan) return null;
  const { errors = [], relabel = [], freed = [], renumber = [], below = [] } = plan;
  if (!errors.length && !relabel.length && !freed.length && !renumber.length && !below.length) return null;
  return (
    <div className="line-up">
      {errors.map((e) => <p key={e} className="error small">{e}</p>)}
      {relabel.length > 0 && <div><strong>Counted as posted, but BC can&apos;t have {relabel.length === 1 ? 'it' : 'them'} under {relabel.length === 1 ? 'that number' : 'those numbers'}:</strong>
        <ul className="plain small">{relabel.map((x) => <li key={x.id}><strong>{x.doc_no}</strong> → <strong>{x.new}</strong> · {x.item} · LKR {lkr(x.total)}<div className="muted">{x.why}</div></li>)}</ul></div>}
      {renumber.length > 0 && <div><strong>Exported before, not posted: {renumber.length === 1 ? 'goes' : 'go'} in this file under BC&apos;s next number{renumber.length === 1 ? '' : 's'}:</strong>
        <ul className="plain small">{renumber.map((x) => <li key={x.id}><strong>{x.old}</strong> → <strong>{x.new}</strong> · {x.item} · LKR {lkr(x.total)}</li>)}</ul>
        <p className="warn-text small">If their old lines are still in BC&apos;s Cash Receipt Journal, delete them before importing this file.</p></div>}
      {freed.length > 0 && <div><strong>Number{freed.length === 1 ? '' : 's'} given back (BC never had {freed.length === 1 ? 'it' : 'them'}):</strong>
        <ul className="plain small">{freed.map((x) => <li key={x.id}><strong>{x.doc_no}</strong> · {x.item} · LKR {lkr(x.total)}<div className="muted">{x.why}</div></li>)}</ul></div>}
      {below.length > 0 && <p className="warn-text small">Ticked though BC is past {below.length === 1 ? 'its number' : 'their numbers'}: {below.map((x) => x.doc_no).join(', ')}.
        Export {below.length === 1 ? 'it' : 'them'} again only if Business Central doesn&apos;t have {below.length === 1 ? 'it' : 'them'} (if it does, upload the latest ledgers on BC check instead).</p>}
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
  const [status, setStatus] = useState(null);
  const [bcNext, setBcNext] = useState('');     // Business Central's next BAKRC number, as finance types it
  const [plan, setPlan] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [c0, m, p, st, g] = await Promise.all([rpc('cc_bc_candidates'), rpc('cc_bc_merchant_candidates'), rpc('cc_bc_payhere_candidates'),
        rpc('cc_doc_numbers_status'), rpc('cc_bc_export_guards')]);
      // what BC already has under an earlier (reopened) number is never exported again
      const posted = (r) => (g ?? []).find((x) => (r.batch_id && x.batch_id === r.batch_id) || (r.payout_id && x.payout_id === r.payout_id)
        || (!r.batch_id && !r.payout_id && r.line_id && x.line_id === r.line_id));
      const c = [...(c0 ?? []), ...(m ?? []), ...(p ?? [])].sort((a, b) => String(a.txn_date).localeCompare(String(b.txn_date)))
        .map((r) => { const o = posted(r); return o ? { ...r, posted_as: o.doc_no, built: { ...r.built, issues: [...(r.built.issues ?? []), 'posted_under_old'] } } : r; });
      setRows(c); setStatus(st);
      const next = st?.BAKRC?.next_no ? String(st.BAKRC.next_no) : '';
      setNextNo(next); setBcNext(next);
      // an exported document goes again only if BC hasn't reached its number (else BC has it, or would refuse the file)
      setSel(new Set(c.filter((r) => !(r.built.issues ?? []).some((i) => ISSUE[i]?.block) && !(r.built.issues ?? []).includes('no_invoices')
        && (!isAgain(r) || numOf(r.doc_no) >= Number(next || 0))).map((r) => r.key)));
    } catch (e) { setError(e.message); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // typing BC's next number: documents exported before are ticked when BC hasn't reached their number
  const typeBcNext = (v) => {
    setBcNext(v);
    const n = Number(v);
    if (!n) return;
    setSel((s) => { const out = new Set(s); (rows ?? []).filter((r) => isAgain(r) && !blocked(r)).forEach((r) => (numOf(r.doc_no) >= n ? out.add(r.key) : out.delete(r.key))); return out; });
  };

  const blocked = (r) => (r.built.issues ?? []).some((i) => ISSUE[i]?.block);
  const newCount = useMemo(() => (rows ?? []).filter((r) => sel.has(r.key) && !r.doc_no).length, [rows, sel]);
  // the picked items that need BAKRC numbers (everything but cash receipts, which have CSHRC numbers)
  const picks = useMemo(() => {
    const p = (rows ?? []).filter((r) => sel.has(r.key));
    return { lines: p.filter((r) => r.line_id && !r.batch_id && !r.payout_id && !r.cash_id).map((r) => r.line_id),
      batches: p.filter((r) => r.batch_id).map((r) => r.batch_id), payouts: p.filter((r) => r.payout_id).map((r) => r.payout_id) };
  }, [rows, sel]);
  const needsNumbers = picks.lines.length + picks.batches.length + picks.payouts.length > 0;
  useEffect(() => {
    setPlan(null);
    if (!needsNumbers || !Number(bcNext) || !['finance', 'executive'].includes(role)) return undefined;
    setPlanBusy(true);
    let live = true;
    const t = setTimeout(() => {
      rpc('cc_bc_export_plan', { p_bc_next: Number(bcNext), p_line_ids: picks.lines, p_batch_ids: picks.batches, p_payout_ids: picks.payouts })
        .then((p) => { if (live) setPlan(p); }).catch((e) => { if (live) setPlan({ errors: [e.message] }); })
        .finally(() => { if (live) setPlanBusy(false); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [bcNext, picks, needsNumbers, role]);
  const selTotal = (rows ?? []).filter((r) => sel.has(r.key)).reduce((a, r) => a + Number(r.credit), 0);
  // unapplied ticks: bank lines by id, cash receipts as negative ids, merchant batches as 'B<id>', PayHere payouts as 'P<id>'
  const uid = (r) => (r.batch_id ? `B${r.batch_id}` : r.payout_id ? `P${r.payout_id}` : r.cash_id ? -r.cash_id : r.line_id);
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
      const lineIds = picked.filter((r) => r.line_id && !r.batch_id && !r.payout_id && !r.cash_id).map((r) => r.line_id);
      const cashIds = picked.filter((r) => r.cash_id).map((r) => r.cash_id);
      const batchIds = picked.filter((r) => r.batch_id).map((r) => r.batch_id);
      const payoutIds = picked.filter((r) => r.payout_id).map((r) => r.payout_id);
      const ticked = (p) => [...unapplied].filter((x) => typeof x === 'string' && x.startsWith(p)).map((x) => Number(x.slice(1)));
      // one call: bank lines and cash, card batches, PayHere payouts. The file starts at BC's next number as typed;
      // the app lines its numbers up with it in the same step, and if anything fails nothing changes
      const res = await rpc('cc_bc_export_all', {
        p_line_ids: lineIds, p_cash_ids: cashIds, p_batch_ids: batchIds, p_payout_ids: payoutIds,
        p_unapplied_lines: [...unapplied].filter((x) => typeof x === 'number'), p_unapplied_batches: ticked('B'), p_unapplied_payouts: ticked('P'),
        p_first_no: Number(nextNo) || null, p_bc_next: needsNumbers ? Number(bcNext) || null : null,
      });
      res.docs = [...res.docs].sort((a, b) => String(a.doc_no).localeCompare(String(b.doc_no)));
      setResult(res);
      if (res.docs.length) await downloadJournal(res.docs, `BC Cash Receipt Journal ${res.docs[0].doc_no}${res.docs.length > 1 ? ` to ${res.docs[res.docs.length - 1].doc_no}` : ''} (${today()}).xlsx`);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const copy = async () => { await navigator.clipboard.writeText(journalText(result.docs)); setCopied(true); };

  if (rows === null) return <p className="muted">Loading…</p>;
  const ns = status?.BAKRC ?? {};
  const typed = Number(bcNext) || 0;
  const numbered = (plan?.kept ?? 0) + newCount;
  const untickedBelow = rows.filter((r) => isAgain(r) && !blocked(r) && !sel.has(r.key) && typed && numOf(r.doc_no) < typed);
  const lined = result?.lined_up;
  const linedCount = lined ? (lined.relabel?.length ?? 0) + (lined.freed?.length ?? 0) + (lined.renumber?.length ?? 0) : 0;
  const groups = [
    { key: 'new', title: 'Ready to export', list: rows.filter((r) => (!r.doc_no || r.preassigned) && !blocked(r)) },
    { key: 'again', title: 'Exported but not in BC yet', hint: 'BC doesn\'t show these yet. They go again under BC\'s next numbers (ticked when BC hasn\'t reached their number).', list: rows.filter((r) => r.doc_no && !r.preassigned && !blocked(r)) },
    { key: 'blocked', title: 'Needs attention first', list: rows.filter((r) => blocked(r)) },
  ];

  return (
    <section className="wide">
      <div className="page-head"><h1>Export to BC</h1></div>
      <p className="lede">Closed receipts matched to a bank line (one BAKRC number per bank line, the bank as balancing account), HNB card batches (one BAKRC per batch: customers at the full card amount, the 3% commission to G/L 204003, Amana as balancing account),
        PayHere payouts (one BAKRC per payout: customers applied to their invoices, Round Island parts to G/L 102030 RI Current Account, the PayHere fee to G/L 204003, Sampath 590 as balancing account),
        and received cash handovers (one CSHRC number per customer, balancing account 103700 Cash In Hand). One journal line per invoice from Sales' instructions. Type Business Central&apos;s next BAKRC number next to Export: the file starts at that number and runs on with no gap, and the app lines its own numbers up with it. If BC posted a document under another number, use Change number.</p>
      {error && <p className="error">{error}</p>}

      {result && (
        <div className="facts ok-box">
          <h2>Exported {result.docs.length} document{result.docs.length === 1 ? '' : 's'}</h2>
          {result.docs.length > 0 && <p>{result.docs[0].doc_no}{result.docs.length > 1 ? ` to ${result.docs[result.docs.length - 1].doc_no}` : ''}: the Excel file has downloaded.
            Paste it into the BC Cash Receipt Journal, or copy the lines here and paste into the journal page (same column order).</p>}
          {linedCount > 0 && <p className="hint">Lined up with Business Central&apos;s next number {lined.bc_next}: {[
            lined.renumber?.length && `${lined.renumber.length} exported before went again under new numbers`,
            lined.relabel?.length && `${lined.relabel.length} counted as posted ${lined.relabel.length === 1 ? 'was' : 'were'} relabelled (${lined.relabel.map((x) => `${x.doc_no} → ${x.new}`).join(', ')})`,
            lined.freed?.length && `${lined.freed.length} number${lined.freed.length === 1 ? '' : 's'} given back (${lined.freed.map((x) => x.doc_no).join(', ')})`,
          ].filter(Boolean).join('; ')}.</p>}
          <div className="btn-row">
            {result.docs.length > 0 && <button className="btn primary" onClick={copy}>{copied ? 'Copied' : 'Copy journal lines'}</button>}
            {result.docs.length > 0 && <button className="btn" onClick={() => downloadJournal(result.docs, `BC Cash Receipt Journal (${today()}).xlsx`)}>Download again</button>}
          </div>
          {result.skipped.length > 0 && <p className="warn-text">{result.skipped.length} line(s) were not exported: {result.skipped.map((s) => s.issues.map((i) => (i === 'posted_under_old' ? `BC has it as ${s.doc_no}` : ISSUE[i]?.text ?? i)).join(', ')).join('; ')}.</p>}
          <p className="hint">After posting in BC, upload the bank and customer ledgers on <Link to="/bc-check">BC check</Link> to confirm.</p>
        </div>
      )}

      {rows.length === 0 ? <p className="muted">Nothing to export: every closed receipt is confirmed posted.</p> : (
        <>
          <div className="facts export-bar">
            <div className="next-no">
              <label>BC&apos;s next BAKRC number
                <input inputMode="numeric" value={bcNext} onChange={(e) => typeBcNext(e.target.value.replace(/\D/g, ''))} disabled={role !== 'finance'}
                  aria-label="Business Central's next BAKRC number" placeholder="e.g. 2728" /></label>
              <span className="muted small">From the No. Series in Business Central (Cash Receipt Journal). The app&apos;s next: {ns.next ?? 'not set'}
                {ns.bc_max ? ` · highest in BC's ledgers: ${ns.bc_max}` : ''}{ns.bc_next ? ` · last typed: ${ns.bc_next}, ${fmtDate(ns.bc_synced_at)}${ns.bc_synced_by ? ` by ${ns.bc_synced_by}` : ''}` : ''}</span>
            </div>
            <p className="hint">{!needsNumbers ? 'The selected documents need no BAKRC number.'
              : !typed ? 'Type BC\'s next BAKRC number: the file starts there.'
              : planBusy || !plan ? 'Checking the numbers…'
              : numbered > 0 ? <>{numbered} document{numbered === 1 ? '' : 's'} in this file: <strong>{plan.bc_next}</strong>{numbered > 1 ? <> to <strong>BAKRC-{String(typed + numbered - 1).padStart(7, '0')}</strong></> : null}, one after another.</> : null}</p>
            {needsNumbers && typed > 0 && <LineUp plan={plan} />}
            {untickedBelow.length > 0 && <p className="warn-text small">Not ticked: {untickedBelow.map((r) => r.doc_no).join(', ')}. BC is past {untickedBelow.length === 1 ? 'that number' : 'those numbers'},
              so BC probably has {untickedBelow.length === 1 ? 'it' : 'them'}: upload the latest ledgers on <Link to="/bc-check">BC check</Link>. Tick one only if Business Central doesn&apos;t have it.</p>}
            <div className="export-go">
              <span>{sel.size} document{sel.size === 1 ? '' : 's'} · LKR {lkr(selTotal)}</span>
              <button className="btn primary" disabled={busy || role !== 'finance' || sel.size === 0 || (needsNumbers && (!typed || planBusy || !plan || (plan.errors ?? []).length > 0))} onClick={doExport}>{busy ? 'Exporting…' : 'Export to Excel'}</button>
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
                                {i === 'posted_under_old' && r.posted_as && <> ({r.posted_as}{r.doc_no ? `; ${r.doc_no} is the copy` : ''})</>}
                                {r.payout_id && i !== 'no_invoices' && i !== 'posted_under_old' && <> · <Link to={`/payhere?payout=${r.payout_id}`}>open</Link></>}
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
      {['finance', 'executive'].includes(role) && <CloseMonth onDone={load} />}
      {['finance', 'executive'].includes(role) && <MatchBc onDone={load} />}
      {mapDeposit && <ChequeMap depositId={mapDeposit} admin={isAdmin && role === 'finance'} onDone={() => { setMapDeposit(null); load(); }} />}
    </section>
  );
}
