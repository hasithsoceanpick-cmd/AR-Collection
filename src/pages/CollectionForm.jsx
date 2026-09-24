import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase, rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fetchAll } from '../lib/bcimport';
import { ref, lkr, fmtDateTime, personName } from '../lib/format';
import MapPicker from '../components/MapPicker';
import CustomerPicker from '../components/CustomerPicker';
import InvoicePicker from '../components/InvoicePicker';

const EMPTY = {
  customer: null, settlement_docs: [], settlement_instructions: '', expected_amount: '',
  contact_person: '', contact_phone: '', location_text: '', lat: null, lng: null, notes: '',
};

export default function CollectionForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const nav = useNavigate();
  const { role } = useAuth();
  const [f, setF] = useState(editing ? null : EMPTY);
  const [snapshot, setSnapshot] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [ledgerInfo, setLedgerInfo] = useState(null);
  const [invoiceTotal, setInvoiceTotal] = useState(null);
  const [amountTouched, setAmountTouched] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAll(() => supabase.from('customers')
      .select('customer_no,name,address,city,phone,contact,location_text,lat,lng')
      .eq('in_latest_list', true).order('name'))
      .then(setCustomers).catch(() => setCustomers([]));
    supabase.from('imports').select('done_at, by:profiles(full_name,email)').eq('kind', 'ledger')
      .order('done_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setLedgerInfo(data ?? false));
  }, []);

  useEffect(() => {
    if (!editing) return;
    supabase.from('collections').select('*').eq('id', id).single().then(({ data, error }) => {
      if (error) { setError('Collection not found'); return; }
      setSnapshot(data.settlement ?? []);
      setF({
        customer: { customer_no: data.customer_no, name: data.customer_name },
        settlement_docs: (data.settlement ?? []).map((s) => s.document_no),
        settlement_instructions: data.settlement_instructions ?? '',
        expected_amount: String(data.expected_amount),
        contact_person: data.contact_person ?? '', contact_phone: data.contact_phone ?? '',
        location_text: data.location_text ?? '', lat: data.lat, lng: data.lng, notes: data.notes ?? '',
      });
    });
  }, [editing, id]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  function pickCustomer(c) {
    setInvoiceTotal(null);
    setSnapshot([]);
    if (!editing) setAmountTouched(false);
    setF((s) => {
      if (!c) return { ...s, customer: null, settlement_docs: [] };
      const address = c.location_text || [c.address, c.city].filter(Boolean).join(', ');
      return {
        ...s, customer: { customer_no: c.customer_no, name: c.name }, settlement_docs: [],
        contact_person: c.contact || '', contact_phone: c.phone || '',
        location_text: address || '', lat: c.lat ?? null, lng: c.lng ?? null,
      };
    });
  }

  function pickInvoices(docs, total) {
    setInvoiceTotal(docs.length ? total : null);
    setF((s) => ({
      ...s, settlement_docs: docs,
      expected_amount: !amountTouched && docs.length ? total.toFixed(2) : s.expected_amount,
    }));
  }

  async function save(e) {
    e.preventDefault();
    if (!f.customer) { setError('Choose the customer.'); return; }
    setBusy(true); setError('');
    const payload = {
      customer_no: f.customer.customer_no, customer_name: f.customer.name,
      settlement_docs: f.settlement_docs, settlement_instructions: f.settlement_instructions,
      expected_amount: String(f.expected_amount).replace(/,/g, ''),
      contact_person: f.contact_person, contact_phone: f.contact_phone,
      location_text: f.location_text, lat: f.lat, lng: f.lng, notes: f.notes,
    };
    try {
      if (editing) {
        await rpc('cc_update_request', { p_id: Number(id), p: payload });
        nav(`/c/${id}`);
      } else {
        const newId = await rpc('cc_create', { p: payload });
        nav(`/c/${newId}`);
      }
    } catch (err) { setError(err.message); setBusy(false); }
  }

  if (!f) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const amountNum = Number(String(f.expected_amount).replace(/,/g, '')) || 0;
  const differs = invoiceTotal != null && Math.abs(amountNum - invoiceTotal) >= 0.005;

  return (
    <section className="narrow">
      <div className="page-head"><h1>{editing ? `Edit ${ref(id)}` : 'New collection'}</h1></div>
      {!editing && <p className="lede">The customer has a cheque ready. Record it here and finance will send a driver.</p>}

      {customers.length === 0 && (
        <div className="notice">
          No customer list has been uploaded yet, so you'll need to type the name.{' '}
          {(role === 'sales' || role === 'finance') && <Link to="/customers">Upload customer data</Link>}
        </div>
      )}

      <form onSubmit={save} className="stack">
        <div className="field">
          <span className="flabel">Customer</span>
          <CustomerPicker customers={customers} selected={f.customer} onSelect={pickCustomer} />
        </div>

        {f.customer?.customer_no && (
          <div className="field">
            <span className="flabel">Invoices being settled</span>
            {ledgerInfo && <span className="hint">Open invoices as uploaded {fmtDateTime(ledgerInfo.done_at)} by {personName(ledgerInfo.by)}.</span>}
            {ledgerInfo === false && <span className="hint">Open invoices haven't been uploaded yet. <Link to="/customers">Upload them</Link> or type instructions below.</span>}
            <InvoicePicker key={f.customer.customer_no} customerNo={f.customer.customer_no}
              selected={f.settlement_docs} onChange={pickInvoices} snapshot={snapshot}
              collectionId={editing ? Number(id) : null} />
          </div>
        )}

        {f.customer && (
          <>
            <label className="field">
              <span className="flabel">Settlement instructions{f.settlement_docs.length ? ' (optional)' : ''}</span>
              <textarea rows="2" value={f.settlement_instructions} onChange={set('settlement_instructions')}
                placeholder="E.g. settle the oldest invoices first, or advance against next order" />
            </label>

            <label className="field"><span className="flabel">Cheque amount (LKR)</span>
              <input required inputMode="decimal" value={f.expected_amount}
                onChange={(e) => { setAmountTouched(true); set('expected_amount')(e); }} placeholder="250000.00" />
              {differs && (
                <span className="hint">
                  Selected invoices total LKR {lkr(invoiceTotal)}.{' '}
                  <button type="button" className="link" onClick={() => { setAmountTouched(false); setF((s) => ({ ...s, expected_amount: invoiceTotal.toFixed(2) })); }}>
                    Use that amount
                  </button>
                </span>
              )}
            </label>

            <div className="grid2">
              <label className="field"><span className="flabel">Contact person</span>
                <input value={f.contact_person} onChange={set('contact_person')} />
              </label>
              <label className="field"><span className="flabel">Contact phone</span>
                <input type="tel" value={f.contact_phone} onChange={set('contact_phone')} />
              </label>
            </div>
            <label className="field"><span className="flabel">Address or directions</span>
              <input value={f.location_text} onChange={set('location_text')} placeholder="No. 12, Galle Road, Wellawatte, 2nd floor office" />
            </label>
            <div className="field">
              <span className="flabel">Pin on the map</span>
              <MapPicker lat={f.lat} lng={f.lng} onChange={(lat, lng) => setF((s) => ({ ...s, lat, lng }))} />
            </div>
            <label className="field"><span className="flabel">Notes for finance</span>
              <textarea rows="3" value={f.notes} onChange={set('notes')} />
            </label>
          </>
        )}

        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="btn primary" disabled={busy || !f.customer}>{editing ? 'Save changes' : 'Send to finance'}</button>
          <Link className="btn ghost" to={editing ? `/c/${id}` : '/'}>Cancel</Link>
        </div>
      </form>
    </section>
  );
}
