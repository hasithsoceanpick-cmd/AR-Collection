import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, uploadMine, db } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { lkr, ref, fmtDate, todayISO, personName } from '../lib/format';
import PhotoInput from '../components/PhotoInput';
import SignedImage from '../components/SignedImage';
import DepositLink from '../components/DepositLink';
import StatementAside from '../components/StatementAside';

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

  const [loadError, setLoadError] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await db.from('collections').select('id, customer_name, collected_amount, collected_at, driver_id, cheques!cheques_collection_id_fkey(cheque_no, bank)')
      .eq('kind', 'cheque').eq('status', 'received').is('deposit_id', null).order('collected_at');
    setLoadError(error ? error.message : '');
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
  if (loadError) return <div className="facts"><h2>Record a deposit</h2><p className="error">Couldn't load the cheques waiting to be deposited: {loadError}</p></div>;
  if (items.length === 0) return <div className="facts"><h2>Record a deposit</h2><p className="muted">No cheques are waiting to be deposited.</p></div>;

  return (
    <div className="split">
    <form className="action split-main" onSubmit={save}>
      <h2>Record a deposit</h2>
      <p className="hint">Record the slip as soon as you've banked it: one slip at a time, ticking every collection whose cheques are on it.
        No bank line is needed now. Finance matches the slip to the bank statement once the cheques clear, usually a day or two later.</p>
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
      <div className={`total ${picked.size === 0 || slipNum === 0 ? 'neutral' : matches ? 'ok' : 'warn'}`}>
        <span>Ticked cheques: LKR {lkr(sum)}{slipNum > 0 ? ` · Slip total: LKR ${lkr(slipNum)}` : ''}</span>
        {picked.size > 0 && slipNum > 0 && (matches
          ? <span>The slip total matches the ticked cheques.</span>
          : <span>These don't match. Check for a cheque missing from the ticks, or an extra one ticked.</span>)}
        {(picked.size === 0 || slipNum === 0) && <span>The slip total you type must equal the cheques you tick.</span>}
      </div>
      <PhotoInput label="Photo of the deposit slip" value={slip} onChange={setSlip} />
      {error && <p className="error">{error}</p>}
      {(() => {
        const missing = picked.size === 0 ? 'Tick the cheques on this slip'
          : !accountId ? 'Choose the bank account'
          : slipNum === 0 ? 'Enter the slip total'
          : !matches ? 'The slip total must equal the ticked cheques'
          : !slip ? 'Add the slip photo' : null;
        return (
          <>
            <button className="btn primary" disabled={busy || Boolean(missing)}>{busy ? 'Saving…' : 'Save deposit'}</button>
            {missing && !busy && <p className="hint">{missing} to save.</p>}
          </>
        );
      })()}
    </form>
    <StatementAside accountId={accountId} focusDate={date} />
    </div>
  );
}

export default function Deposits() {
  const { role } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [deposits, setDeposits] = useState(null);
  const [lines, setLines] = useState({});
  const [open, setOpen] = useState(null);
  const [listError, setListError] = useState('');

  const load = useCallback(async () => {
    const [a, d] = await Promise.all([
      db.from('bank_accounts').select('id, name').eq('active', true).order('name'),
      db.from('deposits').select('*, account:bank_accounts(name), creator:profiles!deposits_created_by_fkey(full_name,email), collections(id, customer_name, collected_amount, status)')
        .is('cancelled_at', null).order('created_at', { ascending: false }).limit(100),
    ]);
    setAccounts(a.data ?? []);
    setListError(a.error?.message || d.error?.message || '');
    setDeposits(d.data ?? []);
    const ids = (d.data ?? []).filter((x) => x.closed_at).map((x) => x.id);
    if (ids.length) {
      const { data } = await db.from('bank_credits').select('id, deposit_id, txn_date, narration, credit').in('deposit_id', ids);
      const m = {};
      for (const l of data ?? []) (m[l.deposit_id] ??= []).push(l);
      setLines(m);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const waiting = (deposits ?? []).filter((d) => !d.closed_at);
  const done = (deposits ?? []).filter((d) => d.closed_at);

  const Card = ({ d }) => (
    <div className="facts" id={`d${d.id}`}>
      <div className="page-head">
        <h2>Slip D-{d.id}: LKR {lkr(d.slip_total)}</h2>
        <span className={d.closed_at ? 'stamp tone-green' : 'stamp tone-teal'}>{d.closed_at ? 'In bank' : 'Awaiting bank'}</span>
      </div>
      <p className="muted">{d.account?.name}, deposited {fmtDate(d.deposit_date)}{d.reference ? `, ref ${d.reference}` : ''}, recorded by {personName(d.creator)}</p>
      <ul className="plain">
        {d.collections.map((c) => <li key={c.id}><Link to={`/c/${c.id}`}>{ref(c.id)}</Link> {c.customer_name}, LKR {lkr(c.collected_amount)}</li>)}
      </ul>
      {d.closed_at && lines[d.id] && (
        <ul className="plain">{lines[d.id].map((l) => <li key={l.id}>In the bank {fmtDate(l.txn_date)}: {l.narration}, LKR {lkr(l.credit)}</li>)}</ul>
      )}
      <div className="row">
        {d.slip_path ? <button className="link" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? 'Hide slip' : 'Show slip photo'}</button>
          : <span className="muted small">No slip photo (imported record)</span>}
      </div>
      {open === d.id && <div className="slip-photo"><SignedImage path={d.slip_path} alt={`Slip D-${d.id}`} /></div>}
      {role === 'finance' && !d.closed_at && <DepositLink deposit={d} onDone={load} />}
    </div>
  );

  return (
    <section className="split-page">
      <div className="page-head"><h1>Deposits</h1></div>
      {listError && <p className="error">Couldn't load deposits: {listError}</p>}
      {(role === 'driver' || role === 'finance') && <RecordDeposit accounts={accounts} onDone={load} />}
      <h2 className="section-title">Awaiting the bank ({waiting.length})</h2>
      {deposits === null ? <p className="muted">Loading…</p> : waiting.length === 0 ? <p className="muted">None.</p> : waiting.map((d) => <Card key={d.id} d={d} />)}
      <h2 className="section-title">Matched to the bank</h2>
      {done.length === 0 ? <p className="muted">None yet.</p> : done.slice(0, 30).map((d) => <Card key={d.id} d={d} />)}
    </section>
  );
}
