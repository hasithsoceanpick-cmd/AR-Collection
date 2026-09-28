import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, uploadMine } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { lkr, ref, fmtDate, todayISO, personName } from '../lib/format';
import PhotoInput from '../components/PhotoInput';
import SignedImage from '../components/SignedImage';
import DepositLink from '../components/DepositLink';

function RecordDeposit({ accounts, onDone }) {
  const [items, setItems] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [slipTotal, setSlipTotal] = useState('');
  const [reference, setReference] = useState('');
  const [slip, setSlip] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('collections').select('id, customer_name, collected_amount, collected_at, driver_id, cheques(cheque_no, bank)')
      .eq('kind', 'cheque').eq('status', 'received').is('deposit_id', null).order('collected_at');
    setItems(data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const sum = useMemo(() => (items ?? []).filter((c) => picked.has(c.id)).reduce((s, c) => s + Number(c.collected_amount), 0), [items, picked]);
  const slipNum = Number(String(slipTotal).replace(/,/g, '')) || 0;
  const matches = picked.size > 0 && Math.abs(sum - slipNum) < 0.005;
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (!slip) throw new Error('Take a photo of the deposit slip.');
      const path = await uploadMine(slip, 'slip', 'jpg', 'image/jpeg');
      await rpc('cc_create_deposit', { p_account_id: Number(accountId), p_date: date, p_slip_total: slipNum,
        p_reference: reference, p_slip_path: path, p_collection_ids: [...picked] });
      setPicked(new Set()); setSlipTotal(''); setReference(''); setSlip(null);
      await load(); await onDone();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (items === null) return <p className="muted">Loading…</p>;
  if (items.length === 0) return <div className="facts"><h2>Record a deposit</h2><p className="muted">No cheques are waiting to be deposited.</p></div>;

  return (
    <form className="action" onSubmit={save}>
      <h2>Record a deposit</h2>
      <p className="hint">One slip at a time. Tick every collection whose cheques are on this slip.</p>
      <ul className="checklist">
        {items.map((c) => (
          <li key={c.id} className={picked.has(c.id) ? 'on' : ''}>
            <label>
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
              <span><strong>{c.customer_name}</strong>
                <span className="muted small">{ref(c.id)} · cheque {c.cheques.map((q) => q.cheque_no).join(', ')}</span></span>
              <span className="num">{lkr(c.collected_amount)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="grid2">
        <label className="field"><span className="flabel">Bank account</span>
          <select required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose the account</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
        <label className="field"><span className="flabel">Deposit date</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span className="flabel">Slip total (LKR, from the slip)</span>
          <input required inputMode="decimal" value={slipTotal} onChange={(e) => setSlipTotal(e.target.value)} /></label>
        <label className="field"><span className="flabel">Slip or reference number</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
      </div>
      <div className={matches ? 'total ok' : 'total warn'}>
        <span>Ticked cheques: LKR {lkr(sum)}</span>
        {picked.size > 0 && slipNum > 0 && !matches && <span>That doesn't match the slip total of LKR {lkr(slipNum)}. Check for a missing or extra cheque.</span>}
      </div>
      <PhotoInput label="Photo of the deposit slip" value={slip} onChange={setSlip} />
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy || !matches || !accountId}>{busy ? 'Saving…' : 'Save deposit'}</button>
    </form>
  );
}

export default function Deposits() {
  const { role } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [deposits, setDeposits] = useState(null);
  const [lines, setLines] = useState({});
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    const [a, d] = await Promise.all([
      supabase.from('bank_accounts').select('id, name').eq('active', true).order('name'),
      supabase.from('deposits').select('*, account:bank_accounts(name), creator:profiles!deposits_created_by_fkey(full_name,email), collections(id, customer_name, collected_amount, status)')
        .is('cancelled_at', null).order('created_at', { ascending: false }).limit(100),
    ]);
    setAccounts(a.data ?? []);
    setDeposits(d.data ?? []);
    const ids = (d.data ?? []).map((x) => x.line_id).filter(Boolean);
    if (ids.length) {
      const { data } = await supabase.from('bank_credits').select('id, txn_date, narration').in('id', ids);
      setLines(Object.fromEntries((data ?? []).map((l) => [l.id, l])));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const waiting = (deposits ?? []).filter((d) => !d.line_id);
  const done = (deposits ?? []).filter((d) => d.line_id);

  const Card = ({ d }) => (
    <div className="facts" id={`d${d.id}`}>
      <div className="page-head">
        <h2>Slip D-{d.id}: LKR {lkr(d.slip_total)}</h2>
        <span className={d.line_id ? 'stamp tone-green' : 'stamp tone-teal'}>{d.line_id ? 'In bank' : 'Awaiting bank'}</span>
      </div>
      <p className="muted">{d.account?.name}, deposited {fmtDate(d.deposit_date)}{d.reference ? `, ref ${d.reference}` : ''}, recorded by {personName(d.creator)}</p>
      <ul className="plain">
        {d.collections.map((c) => <li key={c.id}><Link to={`/c/${c.id}`}>{ref(c.id)}</Link> {c.customer_name}, LKR {lkr(c.collected_amount)}</li>)}
      </ul>
      {d.line_id && lines[d.line_id] && <p>Bank line: {fmtDate(lines[d.line_id].txn_date)}, {lines[d.line_id].narration}</p>}
      <div className="row">
        <button className="link" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? 'Hide slip' : 'Show slip photo'}</button>
      </div>
      {open === d.id && <div className="slip-photo"><SignedImage path={d.slip_path} alt={`Slip D-${d.id}`} /></div>}
      {role === 'finance' && !d.line_id && <DepositLink deposit={d} onDone={load} />}
    </div>
  );

  return (
    <section>
      <div className="page-head"><h1>Deposits</h1></div>
      {(role === 'driver' || role === 'finance') && <RecordDeposit accounts={accounts} onDone={load} />}
      <h2 className="section-title">Awaiting the bank ({waiting.length})</h2>
      {deposits === null ? <p className="muted">Loading…</p> : waiting.length === 0 ? <p className="muted">None.</p> : waiting.map((d) => <Card key={d.id} d={d} />)}
      <h2 className="section-title">Matched to the bank</h2>
      {done.length === 0 ? <p className="muted">None yet.</p> : done.slice(0, 30).map((d) => <Card key={d.id} d={d} />)}
    </section>
  );
}
