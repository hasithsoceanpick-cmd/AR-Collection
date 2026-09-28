import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase, rpc, uploadMine, db } from '../lib/supabase';
import { fetchAll } from '../lib/bcimport';
import { lkr, fmtDate, fmtDateTime } from '../lib/format';
import CustomerPicker from '../components/CustomerPicker';
import InvoicePicker from '../components/InvoicePicker';
import BankLinePicker from '../components/BankLinePicker';
import ReceiptInput from '../components/ReceiptInput';

export default function TransferForm() {
  const nav = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [fresh, setFresh] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [docs, setDocs] = useState([]);
  const [invoiceTotal, setInvoiceTotal] = useState(null);
  const [instructions, setInstructions] = useState('');
  const [accountId, setAccountId] = useState('');
  const [line, setLine] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [noReceipt, setNoReceipt] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAll(() => db.from('customers').select('customer_no,name').eq('in_latest_list', true).order('name'))
      .then(setCustomers).catch(() => setCustomers([]));
    rpc('cc_statement_freshness').then(setFresh).catch(() => setFresh([]));
  }, []);

  const acct = fresh.find((a) => String(a.account_id) === String(accountId));

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (!customer) throw new Error('Choose the customer.');
      if (!line) throw new Error('Pick the bank line this transfer arrived as.');
      let path = null;
      if (receipt) path = await uploadMine(receipt.blob, 'receipt', receipt.ext, receipt.type);
      else if (!noReceipt || !reason.trim()) throw new Error('Attach the receipt, or tick "No receipt" and give the reason.');
      const id = await rpc('cc_create_transfer', { p: {
        customer_no: customer.customer_no, customer_name: customer.name, settlement_docs: docs,
        settlement_instructions: instructions, account_id: Number(accountId), line_id: line.id,
        receipt_path: path, no_receipt_reason: path ? null : reason, notes } });
      nav(`/c/${id}`);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  const differs = line && invoiceTotal != null && Math.abs(Number(line.credit) - invoiceTotal) >= 0.005;

  return (
    <section className="narrow">
      <div className="page-head"><h1>Record a bank transfer</h1></div>
      <p className="lede">The transfer must already be on the bank statement in the app. Pick the customer and invoices, then the bank line it came in as.</p>

      <form onSubmit={save} className="stack">
        <div className="field"><span className="flabel">Customer</span>
          <CustomerPicker customers={customers} selected={customer} onSelect={(c) => { setCustomer(c); setDocs([]); setInvoiceTotal(null); }} />
        </div>

        {customer?.customer_no && (
          <div className="field"><span className="flabel">Invoices being settled</span>
            <InvoicePicker key={customer.customer_no} customerNo={customer.customer_no} selected={docs}
              onChange={(d, t) => { setDocs(d); setInvoiceTotal(d.length ? t : null); }} />
          </div>
        )}
        {customer && (
          <label className="field"><span className="flabel">Settlement instructions{docs.length ? ' (optional)' : ''}</span>
            <textarea rows="2" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="E.g. settle oldest first, or advance" />
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

        {accountId && (
          <div className="field"><span className="flabel">The bank line</span>
            <BankLinePicker accountId={Number(accountId)} amount={invoiceTotal} value={line?.id} onChange={setLine} />
            {line && <span className="hint">Amount recorded: LKR {lkr(line.credit)}, taken from the bank line.</span>}
            {differs && <span className="warn-text">The bank line is LKR {lkr(line.credit)} and the ticked invoices total LKR {lkr(invoiceTotal)}. Finance will see this at review.</span>}
          </div>
        )}

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
  );
}
