import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db, rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { lkr, fmtDate, fmtDateTime } from '../lib/format';
import { fetchAll } from '../lib/bcimport';
import CustomerPicker from '../components/CustomerPicker';
import InvoicePicker from '../components/InvoicePicker';

export const chRef = (id) => `CH-${String(id).padStart(5, '0')}`;
const HANDOVER_SELECT = '*, creator:profiles!cash_handovers_created_by_fkey(full_name,email), receiver:profiles!cash_handovers_received_by_fkey(full_name,email)';
const LINE_SELECT = 'id, handover_id, customer_no, customer_name, settlement, settlement_instructions, invoice_refs, collected_amount, banked_amount, cshrc_no, status, received_at';
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const who = (p) => p?.full_name || p?.email || '—';

function statusOf(h, lines) {
  if (h.status === 'submitted') return { label: 'With finance', cls: 'warn' };
  if (h.status === 'returned') return { label: 'Sent back to Sales', cls: 'bad' };
  if (h.status === 'cancelled') return { label: 'Cancelled', cls: 'muted' };
  const live = lines.filter((l) => l.status !== 'cancelled');
  const left = live.reduce((a, l) => a + Number(l.collected_amount) - Number(l.banked_amount), 0);
  if (live.length && left < 0.005) return { label: 'Banked', cls: 'ok' };
  return { label: left < Number(h.total) - 0.004 ? `In hand LKR ${lkr(left)}` : 'Cash in hand', cls: 'warn' };
}

// ---------- amount in words (rupees and cents) ----------
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function under1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const t = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : '');
  return [h ? `${ONES[h]} hundred` : '', h && r ? 'and' : '', t].filter(Boolean).join(' ');
}
export function amountInWords(amount) {
  const rupees = Math.floor(Number(amount) + 0.0001), cents = Math.round((Number(amount) - rupees) * 100);
  const parts = []; let n = rupees;
  for (const [size, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= size) { parts.push(`${under1000(Math.floor(n / size))} ${name}`); n %= size; }
  }
  if (n) parts.push(under1000(n));
  const words = `${parts.join(' ') || 'zero'} rupees${cents ? ` and ${under1000(cents)} cents` : ''} only`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// =====================================================================
export function CashList() {
  const { role } = useAuth();
  const [handovers, setHandovers] = useState(null);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const h = await db.from('cash_handovers').select(HANDOVER_SELECT).order('id', { ascending: false }).limit(300);
      if (h.error) throw new Error(h.error.message);
      const l = await fetchAll(() => db.from('collections').select(LINE_SELECT).eq('kind', 'cash').order('id'));
      setHandovers(h.data); setLines(l);
    } catch (e) { setError(e.message); setHandovers([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (handovers === null) return <p className="muted">Loading…</p>;

  const byH = (id) => lines.filter((l) => l.handover_id === id);
  const inHand = lines.filter((l) => l.status === 'received' && Number(l.collected_amount) - Number(l.banked_amount) > 0.004);
  const inHandTotal = inHand.reduce((a, l) => a + Number(l.collected_amount) - Number(l.banked_amount), 0);
  const waiting = handovers.filter((h) => h.status === 'submitted');

  return (
    <section className="wide">
      <div className="page-head">
        <h1>Cash handovers</h1>
        {role === 'sales' && <Link className="btn primary" to="/cash/new">New cash handover</Link>}
      </div>
      {error && <p className="error">{error}</p>}

      {role !== 'sales' && (
        <div className="kpi-grid">
          <div className="kpi"><span className="kpi-label">Cash in hand</span><span className="kpi-value">LKR {lkr(inHandTotal)}</span><span className="kpi-sub">{inHand.length} receipt line{inHand.length === 1 ? '' : 's'} not yet banked</span></div>
          <div className={`kpi${waiting.length ? ' kpi-warn' : ''}`}><span className="kpi-label">Waiting for finance</span><span className="kpi-value">{waiting.length}</span><span className="kpi-sub">LKR {lkr(waiting.reduce((a, h) => a + Number(h.total), 0))}</span></div>
        </div>
      )}

      {role === 'finance' && <BankCash inHand={inHand} onDone={load} />}

      {role !== 'sales' && inHand.length > 0 && (
        <div className="facts">
          <h2>Cash in hand ({inHand.length})</h2>
          <div className="table-wrap flat"><table className="table">
            <thead><tr><th>Received</th><th>Handover</th><th>CSHRC</th><th>Customer</th><th className="num">Received LKR</th><th className="num">Banked</th><th className="num">In hand</th></tr></thead>
            <tbody>{inHand.map((l) => (
              <tr key={l.id}><td>{fmtDate(l.received_at)}</td><td><Link to={`/cash/${l.handover_id}`}>{chRef(l.handover_id)}</Link></td><td>{l.cshrc_no}</td><td>{l.customer_name}</td>
                <td className="num">{lkr(l.collected_amount)}</td><td className="num">{lkr(l.banked_amount)}</td><td className="num"><strong>{lkr(Number(l.collected_amount) - Number(l.banked_amount))}</strong></td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <div className="facts">
        <h2>Handovers</h2>
        {handovers.length === 0 ? <p className="muted">None yet.</p> : (
          <div className="table-wrap flat"><table className="table">
            <thead><tr><th>No.</th><th>Recorded</th><th>By</th><th>Customers</th><th className="num">LKR</th><th>Status</th></tr></thead>
            <tbody>{handovers.map((h) => {
              const ls = byH(h.id).filter((l) => l.status !== 'cancelled' || h.status === 'cancelled');
              const st = statusOf(h, byH(h.id));
              return (
                <tr key={h.id}>
                  <td><Link to={`/cash/${h.id}`}><strong>{chRef(h.id)}</strong></Link></td>
                  <td>{fmtDateTime(h.created_at)}</td><td>{who(h.creator)}</td>
                  <td>{[...new Set(ls.map((l) => l.customer_name))].join(', ')}</td>
                  <td className="num">{lkr(h.total)}</td>
                  <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
      {role === 'finance' && <BankedHistory onDone={load} />}
    </section>
  );
}

// ---------- finance: match a cash deposit on the statement to receipts ----------
function BankCash({ inHand, onDone }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [lines, setLines] = useState([]);
  const [line, setLine] = useState(null);
  const [alloc, setAlloc] = useState({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { db.from('bank_accounts').select('id, name').eq('active', true).order('name').then(({ data }) => setAccounts(data ?? [])); }, []);
  useEffect(() => {
    setLine(null); setLines([]);
    if (!accountId) return;
    db.from('bank_credits').select('id, txn_date, narration, reference, credit').eq('account_id', accountId).is('link_kind', null).not('narration', 'ilike', '%MERCHANT SLIPS%')
      .order('txn_date', { ascending: false }).limit(300).then(({ data }) => setLines(data ?? []));
  }, [accountId]);
  // oldest receipts first, up to the deposit amount
  const fill = (amount) => {
    let left = r2(amount); const a = {};
    for (const l of [...inHand].sort((x, y) => String(x.received_at).localeCompare(String(y.received_at)) || x.id - y.id)) {
      if (left <= 0.004) break;
      const take = Math.min(left, r2(Number(l.collected_amount) - Number(l.banked_amount)));
      a[l.id] = take.toFixed(2); left = r2(left - take);
    }
    setAlloc(a);
  };
  const pick = (l) => { setLine(l); fill(l.credit); setError(''); setMsg(''); };
  const sum = Object.values(alloc).reduce((a, v) => a + (Number(v) || 0), 0);
  const shown = lines.filter((l) => !q || `${l.narration} ${l.reference} ${l.credit}`.toLowerCase().includes(q.toLowerCase()));
  const save = async () => {
    setBusy(true); setError('');
    try {
      await rpc('cc_cash_bank', { p_line_id: line.id, p_items: Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ collection_id: Number(id), amount: Number(v) })) });
      setMsg(`Matched LKR ${lkr(line.credit)} to the cash receipts.`); setLine(null); setAlloc({});
      setLines((ls) => ls.filter((x) => x.id !== line.id)); onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="action">
      <h2>Bank a cash deposit</h2>
      <p className="hint">Pick the cash deposit on the bank statement, then the receipts it carries. Banking part of the cash is fine; the rest stays in hand.</p>
      {msg && <p className="ok-text">{msg}</p>}
      <div className="row-2">
        <label className="field"><span className="flabel">Account</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        {accountId && <label className="field"><span className="flabel">Find the line</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Amount, narration or reference" /></label>}
      </div>
      {accountId && !line && (
        <div className="table-wrap flat rec-list"><table className="table">
          <thead><tr><th>Date</th><th>Narration</th><th className="num">LKR</th><th></th></tr></thead>
          <tbody>{shown.length === 0 ? <tr><td colSpan={4} className="muted">No unidentified money-in lines on this account.</td></tr> : shown.map((l) => (
            <tr key={l.id}><td>{fmtDate(l.txn_date)}</td><td className="narr">{l.narration}{l.reference && <div className="muted small">{l.reference}</div>}</td>
              <td className="num">{lkr(l.credit)}</td><td><button className="btn small" disabled={!inHand.length} onClick={() => pick(l)}>Use</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {line && (
        <>
          <p><strong>{fmtDate(line.txn_date)} · {line.narration} · LKR {lkr(line.credit)}</strong> <button className="link" onClick={() => setLine(null)}>change</button></p>
          <div className="table-wrap flat"><table className="table">
            <thead><tr><th>Receipt</th><th>Customer</th><th className="num">In hand</th><th className="num">Banked now</th></tr></thead>
            <tbody>{inHand.map((l) => (
              <tr key={l.id}><td>{l.cshrc_no} <span className="muted small">{chRef(l.handover_id)}</span></td><td>{l.customer_name}</td>
                <td className="num">{lkr(Number(l.collected_amount) - Number(l.banked_amount))}</td>
                <td><input className="num" inputMode="decimal" value={alloc[l.id] ?? ''} placeholder="0" onChange={(e) => setAlloc({ ...alloc, [l.id]: e.target.value.replace(/[^0-9.]/g, '') })} /></td></tr>
            ))}</tbody>
          </table></div>
          <div className={`total ${Math.abs(sum - Number(line.credit)) < 0.005 ? 'ok' : 'warn'}`}>
            <span>Receipts ticked: LKR {lkr(sum)} · Deposit: LKR {lkr(line.credit)}</span>
            {Math.abs(sum - Number(line.credit)) >= 0.005 && <span>These must be equal.</span>}
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={busy || Math.abs(sum - Number(line.credit)) >= 0.005} onClick={save}>Match the deposit</button>
        </>
      )}
    </div>
  );
}

function BankedHistory({ onDone }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => db.from('cash_bankings')
    .select('id, created_at, line_id, line:statement_lines(txn_date, narration, credit, account:bank_accounts(name)), items:cash_banking_items(amount, collection:collections(cshrc_no, customer_name, handover_id))')
    .order('id', { ascending: false }).limit(30).then(({ data, error: e }) => { if (e) setError(e.message); setRows(data ?? []); }), []);
  useEffect(() => { load(); }, [load]);
  if (!rows?.length) return null;
  const undo = async (lineId) => {
    setBusy(true); setError('');
    try { await rpc('cc_cash_unbank', { p_line_id: lineId }); await load(); onDone(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="facts">
      <h2>Cash banked</h2>
      {error && <p className="error">{error}</p>}
      <ul className="plain">{rows.map((b) => (
        <li key={b.id}>{fmtDate(b.line?.txn_date)} · {b.line?.account?.name} · LKR {lkr(b.line?.credit)}: {(b.items ?? []).map((i) => `${i.collection?.cshrc_no} ${lkr(i.amount)}`).join(', ')}
          {' '}<button className="link" disabled={busy} onClick={() => undo(b.line_id)}>Undo</button></li>
      ))}</ul>
    </div>
  );
}

// =====================================================================
// Sales: record a handover (or correct one sent back)
export function CashForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [rows, setRows] = useState([{ key: 1, customer: null, docs: [], total: null, amount: '', instructions: '' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [returnReason, setReturnReason] = useState('');
  useEffect(() => {
    fetchAll(() => db.from('customers').select('customer_no,name').eq('in_latest_list', true).order('name')).then(setCustomers).catch(() => setCustomers([]));
  }, []);
  useEffect(() => {
    if (!id) return;
    (async () => {
      const h = await db.from('cash_handovers').select('*').eq('id', id).single();
      const l = await db.from('collections').select(LINE_SELECT).eq('handover_id', id).neq('status', 'cancelled').order('id');
      setNotes(h.data?.notes ?? ''); setReturnReason(h.data?.return_reason ?? '');
      setRows((l.data ?? []).map((x, i) => ({ key: i + 1, customer: { customer_no: x.customer_no, name: x.customer_name }, docs: (x.settlement ?? []).map((s) => s.document_no),
        total: null, amount: String(x.collected_amount), instructions: x.settlement_instructions ?? '' })));
    })();
  }, [id]);
  const set = (k, patch) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const lines = rows.map((r, i) => {
        if (!r.customer) throw new Error(`Line ${i + 1}: choose the customer`);
        if (!(Number(r.amount) > 0)) throw new Error(`Line ${i + 1}: enter the cash amount`);
        if (!r.docs.length && !r.instructions.trim()) throw new Error(`Line ${i + 1}: tick the invoices, or type settlement instructions`);
        return { customer_no: r.customer.customer_no ?? null, customer_name: r.customer.name, amount: Number(r.amount), settlement_docs: r.docs, settlement_instructions: r.instructions.trim() || null };
      });
      const hid = await rpc('cc_cash_save', { p_id: id ? Number(id) : null, p: { notes, lines } });
      nav(`/cash/${hid}`);
    } catch (e2) { setError(e2.message); } finally { setBusy(false); }
  };
  return (
    <section className="narrow">
      <div className="page-head"><h1>{id ? `Correct ${chRef(id)}` : 'New cash handover'}</h1></div>
      <p className="lede">One handover for all the cash you're giving finance now. Add each customer with the invoices their cash settles.</p>
      {returnReason && <p className="warn-text">Finance sent this back: {returnReason}</p>}
      <form onSubmit={save} className="stack">
        {rows.map((r, i) => (
          <div className="facts cash-row" key={r.key}>
            <div className="cash-row-head"><h2>Customer {i + 1}</h2>{rows.length > 1 && <button type="button" className="link" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>Remove</button>}</div>
            <div className="field"><CustomerPicker customers={customers} selected={r.customer} onSelect={(c) => set(r.key, { customer: c, docs: [], total: null })} /></div>
            {r.customer?.customer_no && (
              <div className="field"><span className="flabel">Invoices being settled</span>
                <InvoicePicker key={`${r.key}-${r.customer.customer_no}`} customerNo={r.customer.customer_no} selected={r.docs}
                  onChange={(d, t) => set(r.key, { docs: d, total: d.length ? t : null, ...(d.length && !r.amount ? { amount: t.toFixed(2) } : {}) })} />
              </div>
            )}
            {r.customer && (
              <label className="field"><span className="flabel">Settlement instructions{r.docs.length ? ' (optional)' : ''}</span>
                <textarea rows="2" value={r.instructions} onChange={(e) => set(r.key, { instructions: e.target.value })} placeholder="E.g. settle oldest first, or advance" /></label>
            )}
            <label className="field"><span className="flabel">Cash received (LKR)</span>
              <input inputMode="decimal" value={r.amount} onChange={(e) => set(r.key, { amount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0.00" />
              {r.total != null && Number(r.amount) > 0 && Math.abs(Number(r.amount) - r.total) >= 0.005 && (
                <span className="warn-text">Invoices ticked total LKR {lkr(r.total)}; the cash is {Number(r.amount) < r.total ? 'short' : 'more'} by LKR {lkr(Math.abs(Number(r.amount) - r.total))}.</span>)}
            </label>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setRows([...rows, { key: Math.max(...rows.map((r) => r.key)) + 1, customer: null, docs: [], total: null, amount: '', instructions: '' }])}>Add another customer</button>
        <label className="field"><span className="flabel">Notes (optional)</span><textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="total ok"><span>Total cash: LKR {lkr(total)}</span><span>{rows.length} customer{rows.length === 1 ? '' : 's'}</span></div>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send to finance'}</button>
      </form>
    </section>
  );
}

// =====================================================================
function useHandover(id) {
  const [h, setH] = useState(undefined);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const a = await db.from('cash_handovers').select(HANDOVER_SELECT).eq('id', id).maybeSingle();
    const b = await db.from('collections').select(LINE_SELECT).eq('handover_id', id).order('id');
    setError(a.error?.message || b.error?.message || '');
    setH(a.data ?? null); setLines(b.data ?? []);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  return { h, lines, error, load };
}

export function CashDetail() {
  const { id } = useParams();
  const { role, session, isAdmin } = useAuth();
  const { h, lines, error, load } = useHandover(id);
  const [counted, setCounted] = useState('');
  const [first, setFirst] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (role === 'finance') db.from('doc_series').select('next_no').eq('code', 'CSHRC').maybeSingle().then(({ data }) => data?.next_no && setFirst(String(data.next_no))); }, [role]);
  if (h === undefined) return <p className="muted">Loading…</p>;
  if (!h) return <div className="empty"><p>{error || "This handover isn't available to you."}</p><Link to="/cash">Back to cash handovers</Link></div>;
  const live = lines.filter((l) => l.status !== 'cancelled' || h.status === 'cancelled');
  const st = statusOf(h, lines);
  const mine = h.created_by === session.user.id || isAdmin;
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const n = live.length;
  return (
    <section className="wide">
      <Link to="/cash" className="back">All cash handovers</Link>
      <div className="page-head"><h1>{chRef(h.id)}</h1><span className={`pill ${st.cls}`}>{st.label}</span></div>
      <p className="lede">Recorded by {who(h.creator)} on {fmtDateTime(h.created_at)}{h.received_at ? `; received by ${who(h.receiver)} on ${fmtDateTime(h.received_at)}` : ''}. Total LKR {lkr(h.total)}.</p>
      {error && <p className="error">{error}</p>}

      {h.status === 'received' && <p><Link className="btn primary" to={`/cash/${h.id}/receipt`}>Open the receipt to print and sign</Link></p>}

      <div className="facts">
        <h2>Customers ({n})</h2>
        <div className="table-wrap flat"><table className="table">
          <thead><tr><th>Customer</th><th>Invoices / instructions</th><th>CSHRC</th><th className="num">LKR</th>{h.status === 'received' && <th className="num">Banked</th>}</tr></thead>
          <tbody>{live.map((l) => (
            <tr key={l.id}><td>{l.customer_name}<div className="muted small">{l.customer_no ?? 'not in BC list'}</div></td>
              <td>{l.invoice_refs || <span className="muted">—</span>}{l.settlement_instructions && <div className="muted small">{l.settlement_instructions}</div>}</td>
              <td>{l.cshrc_no ?? <span className="muted">given when received</span>}</td><td className="num">{lkr(l.collected_amount)}</td>
              {h.status === 'received' && <td className="num">{lkr(l.banked_amount)}</td>}</tr>
          ))}</tbody>
        </table></div>
        {h.notes && <p className="hint">Notes: {h.notes}</p>}
        {h.return_reason && h.status === 'returned' && <p className="warn-text">Sent back: {h.return_reason}</p>}
        {h.cancel_reason && <p className="muted">Cancelled: {h.cancel_reason}</p>}
      </div>

      {role === 'finance' && h.status === 'submitted' && (
        <div className="action">
          <h2>Count and receive</h2>
          <p className="hint">Count the cash. If it matches, receive it: each customer gets a CSHRC number (from the first one below) and the receipt is ready to print and sign.</p>
          <div className="row-2">
            <label className="field"><span className="flabel">Cash counted (LKR)</span><input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={lkr(h.total)} /></label>
            <label className="field"><span className="flabel">First CSHRC number</span><input inputMode="numeric" value={first} onChange={(e) => setFirst(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 541" />
              {first && <span className="hint">CSHRC-{first.padStart(7, '0')}{n > 1 ? ` to CSHRC-${String(Number(first) + n - 1).padStart(7, '0')}` : ''}</span>}</label>
          </div>
          {counted !== '' && Math.abs(Number(counted) - Number(h.total)) >= 0.005 && <p className="warn-text">That's LKR {lkr(Math.abs(Number(counted) - Number(h.total)))} {Number(counted) < Number(h.total) ? 'short' : 'over'}. Count again, or send it back.</p>}
          <div className="btn-row">
            <button className="btn primary" disabled={busy || !first || counted === '' || Math.abs(Number(counted) - Number(h.total)) >= 0.005}
              onClick={() => run(() => rpc('cc_cash_receive', { p_id: h.id, p_counted: Number(counted), p_first_cshrc: Number(first) }))}>Receive the cash</button>
          </div>
          <label className="field"><span className="flabel">Or send it back to Sales</span><textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What doesn't match" /></label>
          <button className="btn" disabled={busy || !reason.trim()} onClick={() => run(() => rpc('cc_cash_return', { p_id: h.id, p_reason: reason }))}>Send back</button>
        </div>
      )}

      {role === 'sales' && mine && ['submitted', 'returned'].includes(h.status) && (
        <div className="action">
          {h.status === 'returned' && <p><Link className="btn primary" to={`/cash/${h.id}/edit`}>Correct and send again</Link></p>}
          <label className="field"><span className="flabel">Cancel this handover</span><textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why" /></label>
          <button className="btn" disabled={busy || !reason.trim()} onClick={() => run(() => rpc('cc_cash_cancel', { p_id: h.id, p_reason: reason }))}>Cancel handover</button>
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}

// =====================================================================
// The receipt both sides sign
export function CashReceipt() {
  const { id } = useParams();
  const { h, lines } = useHandover(id);
  const live = useMemo(() => lines.filter((l) => l.status !== 'cancelled'), [lines]);
  if (h === undefined) return <p className="muted">Loading…</p>;
  if (!h || h.status === 'submitted' || h.status === 'returned' || h.status === 'cancelled') {
    return <div className="empty"><p>The receipt is produced once finance has received the cash.</p><Link to={`/cash/${id}`}>Back to the handover</Link></div>;
  }
  return (
    <section className="receipt-page">
      <div className="no-print receipt-tools">
        <Link to={`/cash/${h.id}`} className="back">Back to {chRef(h.id)}</Link>
        <button className="btn primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <article className="receipt">
        <header className="rc-head">
          <div><div className="rc-co">Oceanpick Private Limited</div><div className="rc-addr">Round Island · No 532/4F, Sirikotha Lane, Colombo 03, Sri Lanka · +94 112 689 099</div></div>
          <div className="rc-title"><div>CASH HANDOVER RECEIPT</div><div className="rc-no">{chRef(h.id)}</div></div>
        </header>
        <dl className="rc-meta">
          <div><dt>Received on</dt><dd>{fmtDateTime(h.received_at)}</dd></div>
          <div><dt>Handed over by (Sales)</dt><dd>{who(h.creator)}</dd></div>
          <div><dt>Received by (Finance)</dt><dd>{who(h.receiver)}</dd></div>
        </dl>
        <table className="rc-table">
          <thead><tr><th>#</th><th>Customer</th><th>Customer No.</th><th>Invoices settled</th><th>Receipt No.</th><th className="num">Amount (LKR)</th></tr></thead>
          <tbody>{live.map((l, i) => (
            <tr key={l.id}><td>{i + 1}</td><td>{l.customer_name}</td><td>{l.customer_no ?? '—'}</td>
              <td>{l.invoice_refs || l.settlement_instructions || '—'}{l.invoice_refs && l.settlement_instructions ? <div className="rc-small">{l.settlement_instructions}</div> : null}</td>
              <td>{l.cshrc_no}</td><td className="num">{lkr(l.collected_amount)}</td></tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={5}>Total cash received</td><td className="num">{lkr(h.total)}</td></tr></tfoot>
        </table>
        <p className="rc-words"><strong>Amount in words:</strong> {amountInWords(h.total)}</p>
        {h.notes && <p className="rc-small">Notes: {h.notes}</p>}
        <div className="rc-sign">
          <div><div className="rc-line" /><div>Handed over by (Sales)</div><div className="rc-small">Name: {who(h.creator)} &nbsp; Date: ____________</div></div>
          <div><div className="rc-line" /><div>Received by (Finance)</div><div className="rc-small">Name: {who(h.receiver)} &nbsp; Date: ____________</div></div>
        </div>
        <footer className="rc-foot">Generated by Collections · Round Island · {chRef(h.id)} · printed {fmtDateTime(new Date().toISOString())}</footer>
      </article>
    </section>
  );
}
