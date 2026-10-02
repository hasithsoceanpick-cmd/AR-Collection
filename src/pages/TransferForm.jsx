import { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { supabase, rpc, uploadMine, db } from '../lib/supabase';
import { fetchAll } from '../lib/bcimport';
import { lkr, fmtDate, fmtDateTime } from '../lib/format';
import CustomerPicker from '../components/CustomerPicker';
import InvoicePicker from '../components/InvoicePicker';
import BankLinePicker from '../components/BankLinePicker';
import ReceiptInput from '../components/ReceiptInput';
import StatementAside from '../components/StatementAside';

export default function TransferForm() {
  const nav = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [fresh, setFresh] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [docs, setDocs] = useState([]);
  const [invoiceTotal, setInvoiceTotal] = useState(null);
  const [instructions, setInstructions] = useState('');
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [exact, setExact] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [line, setLine] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [noReceipt, setNoReceipt] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [method, setMethod] = useState('transfer');
  const [methodTouched, setMethodTouched] = useState(false);
  const [chequeNo, setChequeNo] = useState('');
  const [params] = useSearchParams();

  useEffect(() => {
    fetchAll(() => db.from('customers').select('customer_no,name').eq('in_latest_list', true).order('name'))
      .then(setCustomers).catch(() => setCustomers([]));
    rpc('cc_statement_freshness').then(setFresh).catch(() => setFresh([]));
  }, []);

  // Opened from an unidentified bank line (Reports → Bank reconciliation): start from that line.
  useEffect(() => {
    const id = Number(params.get('line'));
    if (!id) return;
    db.from('bank_credits').select('*').eq('id', id).is('link_kind', null).maybeSingle().then(({ data }) => {
      if (!data) { setError('That bank line has already been identified.'); return; }
      setAccountId(String(data.account_id)); setAmount(Number(data.credit).toFixed(2)); setAmountTouched(true);
      setExact(Math.round(Number(data.credit) * 100) / 100); pickLine(data);
    });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  // A line carrying a cheque number is most likely a cheque the customer deposited.
  function pickLine(l) {
    setLine(l);
    if (l && !methodTouched) {
      if (l.cheque_no) { setMethod('cheque'); setChequeNo(l.cheque_no); } else { setMethod('transfer'); setChequeNo(''); }
    }
  }

  const acct = fresh.find((a) => String(a.account_id) === String(accountId));
  const amountNum = Math.round((Number(String(amount).replace(/,/g, '')) || 0) * 100) / 100;

  // Look for bank lines only once the typed amount settles.
  useEffect(() => {
    const t = setTimeout(() => {
      setExact(amountNum > 0 ? amountNum : null);
      setLine((l) => (l && Math.round(Number(l.credit) * 100) / 100 === amountNum ? l : null));
    }, 400);
    return () => clearTimeout(t);
  }, [amountNum]);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (!customer) throw new Error('Choose the customer.');
      if (!line) throw new Error('Pick the bank line this payment arrived as.');
      if (method === 'cheque' && !chequeNo.trim()) throw new Error('Enter the cheque number.');
      let path = null;
      if (receipt) path = await uploadMine(receipt.blob, 'receipt', receipt.ext, receipt.type);
      else if (!noReceipt || !reason.trim()) throw new Error('Attach the receipt, or tick "No receipt" and give the reason.');
      const id = await rpc('cc_create_transfer', { p: {
        customer_no: customer.customer_no, customer_name: customer.name, settlement_docs: docs,
        settlement_instructions: instructions, account_id: Number(accountId), line_id: line.id,
        amount: amountNum, receipt_path: path, no_receipt_reason: path ? null : reason, notes,
        pay_method: method, cheque_no: method === 'cheque' ? chequeNo.trim() : null } });
      nav(`/c/${id}`);
    } catch (err) { setError(err.message); setBusy(false); }
  }


  return (
    <div className="split-page split">
    <section className="split-main">
      <div className="page-head"><h1>Record a transfer or cheque deposit</h1></div>
      <p className="lede">For money the customer paid straight into our bank: an online transfer, or a cheque they deposited themselves. It must already be on the bank statement in the app. Pick the customer and invoices, the amount, then its bank line.</p>

      <form onSubmit={save} className="stack">
        <fieldset className="field method-pick"><span className="flabel">How did the money arrive?</span>
          <label className="check"><input type="radio" name="method" checked={method === 'transfer'} onChange={() => { setMethod('transfer'); setMethodTouched(true); }} /> Bank transfer or online payment</label>
          <label className="check"><input type="radio" name="method" checked={method === 'cheque'} onChange={() => { setMethod('cheque'); setMethodTouched(true); if (!chequeNo && line?.cheque_no) setChequeNo(line.cheque_no); }} /> Cheque deposited by the customer into our account</label>
        </fieldset>
        {method === 'cheque' && (
          <label className="field"><span className="flabel">Cheque number</span>
            <input required inputMode="numeric" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} placeholder="As on the cheque or the bank line" />
            {line?.cheque_no && <span className="hint">Taken from the bank line ({line.narration}).</span>}
          </label>
        )}
        <div className="field"><span className="flabel">Customer</span>
          <CustomerPicker customers={customers} selected={customer} onSelect={(c) => { setCustomer(c); setDocs([]); setInvoiceTotal(null); }} />
        </div>

        {customer?.customer_no && (
          <div className="field"><span className="flabel">Invoices being settled</span>
            <InvoicePicker key={customer.customer_no} customerNo={customer.customer_no} selected={docs}
              onChange={(d, t) => { setDocs(d); setInvoiceTotal(d.length ? t : null); if (!amountTouched && d.length) setAmount(t.toFixed(2)); }} />
          </div>
        )}
        {customer && (
          <label className="field"><span className="flabel">Settlement instructions{docs.length ? ' (optional)' : ''}</span>
            <textarea rows="2" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="E.g. settle oldest first, or advance" />
          </label>
        )}

        {customer && (
          <label className="field"><span className="flabel">{method === 'cheque' ? 'Cheque amount (LKR)' : 'Transfer amount (LKR)'}</span>
            <input required inputMode="decimal" value={amount} placeholder="Exactly as it arrived in the bank"
              onChange={(e) => { setAmountTouched(true); setAmount(e.target.value); }} />
            {invoiceTotal != null && amountNum > 0 && Math.abs(amountNum - invoiceTotal) >= 0.005 && (
              <span className="warn-text">
                {amountNum < invoiceTotal
                  ? `LKR ${lkr(invoiceTotal - amountNum)} less than the ticked invoices: it will settle the oldest invoices first.`
                  : `LKR ${lkr(amountNum - invoiceTotal)} more than the ticked invoices: the excess stays unapplied on the customer.`}
              </span>
            )}
          </label>
        )}

        <label className="field"><span className="flabel">Paid into</span>
          <select required value={accountId} onChange={(e) => { setAccountId(e.target.value); setLine(null); }}>
            <option value="">Choose the bank account</option>
            {fresh.map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
          </select>
          {acct && <span className="hint">
            {acct.last_upload ? `Statement last updated ${fmtDateTime(acct.last_upload)}, with lines up to ${fmtDate(acct.last_line_date)}.` : 'No statement uploaded for this account yet.'}
            {' '}If today's transfer isn't listed, wait for finance's next upload.</span>}
        </label>

        {accountId && exact != null && (
          <div className="field"><span className="flabel">The bank line (LKR {lkr(exact)} only)</span>
            <BankLinePicker accountId={Number(accountId)} exact={exact} value={line?.id} onChange={pickLine} />
          </div>
        )}
        {accountId && exact == null && <p className="hint">Enter the amount to see the matching bank lines.</p>}

        {!noReceipt && <ReceiptInput label="Receipt (photo or PDF)" value={receipt} onChange={setReceipt} />}
        <label className="check"><input type="checkbox" checked={noReceipt} onChange={(e) => { setNoReceipt(e.target.checked); if (e.target.checked) setReceipt(null); }} /> No receipt available</label>
        {noReceipt && (
          <label className="field"><span className="flabel">Why is there no receipt?</span>
            <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer confirmed by phone" /></label>
        )}
        <label className="field"><span className="flabel">Notes for finance</span>
          <textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Send to finance'}</button>
          <Link className="btn ghost" to="/">Cancel</Link>
        </div>
      </form>
    </section>
    <StatementAside accountId={accountId} highlightIds={line ? [line.id] : []} focusDate={line?.txn_date ?? acct?.last_line_date} />
    </div>
  );
}
