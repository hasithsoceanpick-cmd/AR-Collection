import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase, rpc } from '../lib/supabase';
import { ref } from '../lib/format';
import MapPicker from '../components/MapPicker';

const EMPTY = {
  customer_name: '', invoice_refs: '', expected_amount: '', contact_person: '',
  contact_phone: '', location_text: '', lat: null, lng: null, notes: '',
};

export default function CollectionForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const nav = useNavigate();
  const [f, setF] = useState(editing ? null : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) return;
    supabase.from('collections').select('*').eq('id', id).single().then(({ data, error }) => {
      if (error) { setError('Collection not found'); return; }
      const v = {};
      for (const k of Object.keys(EMPTY)) v[k] = data[k] ?? (k === 'lat' || k === 'lng' ? null : '');
      setF(v);
    });
  }, [editing, id]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const payload = { ...f, expected_amount: String(f.expected_amount).replace(/,/g, '') };
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

  return (
    <section className="narrow">
      <div className="page-head">
        <h1>{editing ? `Edit ${ref(id)}` : 'New collection'}</h1>
      </div>
      {!editing && <p className="lede">The customer has a cheque ready. Record it here and finance will send a driver.</p>}
      <form onSubmit={save} className="stack">
        <label className="field"><span className="flabel">Customer name</span>
          <input required value={f.customer_name} onChange={set('customer_name')} />
        </label>
        <div className="grid2">
          <label className="field"><span className="flabel">Amount (LKR)</span>
            <input required inputMode="decimal" value={f.expected_amount} onChange={set('expected_amount')} placeholder="250000.00" />
          </label>
          <label className="field"><span className="flabel">Invoice(s) being paid</span>
            <input value={f.invoice_refs} onChange={set('invoice_refs')} placeholder="SI-1001, SI-1002" />
          </label>
        </div>
        <div className="grid2">
          <label className="field"><span className="flabel">Contact person</span>
            <input value={f.contact_person} onChange={set('contact_person')} />
          </label>
          <label className="field"><span className="flabel">Contact phone</span>
            <input type="tel" value={f.contact_phone} onChange={set('contact_phone')} />
          </label>
        </div>
        <label className="field"><span className="flabel">Address or directions</span>
          <input value={f.location_text} onChange={set('location_text')} placeholder="No. 12, Galle Road, Wellawatte — 2nd floor office" />
        </label>
        <div className="field">
          <span className="flabel">Pin on the map</span>
          <MapPicker lat={f.lat} lng={f.lng} onChange={(lat, lng) => setF((s) => ({ ...s, lat, lng }))} />
        </div>
        <label className="field"><span className="flabel">Notes for finance</span>
          <textarea rows="3" value={f.notes} onChange={set('notes')} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="btn primary" disabled={busy}>{editing ? 'Save changes' : 'Send to finance'}</button>
          <Link className="btn ghost" to={editing ? `/c/${id}` : '/'}>Cancel</Link>
        </div>
      </form>
    </section>
  );
}
