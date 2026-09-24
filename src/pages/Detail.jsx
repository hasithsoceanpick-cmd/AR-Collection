import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, rpc, COLLECTION_SELECT } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { isOpen } from '../lib/workflow';
import { lkr, ref, fmtDate, fmtDateTime, personName } from '../lib/format';
import StatusStamp from '../components/StatusStamp';
import Progress from '../components/Progress';
import MapView, { directionsUrl } from '../components/MapView';
import SignedImage from '../components/SignedImage';
import { AssignPanel, CollectPanel, ReceivePanel, DepositPanel, ClosePanel, CancelPanel } from './actions';

export default function Detail() {
  const { id } = useParams();
  const { role, session } = useAuth();
  const uid = session.user.id;
  const [c, setC] = useState(undefined);
  const [cheques, setCheques] = useState([]);
  const [events, setEvents] = useState([]);

  const load = useCallback(async () => {
    const [a, b, e] = await Promise.all([
      supabase.from('collections').select(COLLECTION_SELECT).eq('id', id).maybeSingle(),
      supabase.from('cheques').select('*').eq('collection_id', id).order('id'),
      supabase.from('events').select('*, actor:profiles(full_name,email)').eq('collection_id', id).order('id'),
    ]);
    setC(a.data ?? null);
    setCheques(b.data ?? []);
    setEvents(e.data ?? []);
  }, [id]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`collection-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'collections', filter: `id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);

  if (c === undefined) return <p className="muted">Loading…</p>;
  if (c === null) return (
    <div className="empty"><p>This collection doesn't exist or isn't shared with you.</p><Link to="/">Back to collections</Link></div>
  );

  const isDriver = role === 'driver' && c.driver_id === uid;
  const isFinance = role === 'finance';
  const canEdit = (role === 'sales' && c.created_by === uid && c.status === 'submitted')
    || (isFinance && ['submitted', 'assigned'].includes(c.status));
  const canCancel = (isFinance && isOpen(c)) || (role === 'sales' && c.created_by === uid && c.status === 'submitted');
  const photosGone = Boolean(c.photos_deleted_at);
  const shownAmount = c.collected_amount ?? c.expected_amount;

  return (
    <section className="detail">
      <Link to="/" className="back">All collections</Link>

      <div className="slip">
        <div className="slip-top">
          <span className="slip-ref">{ref(c.id)}</span>
          <span className="slip-date">Recorded {fmtDate(c.created_at)} by {personName(c.creator)}</span>
        </div>
        <div className="slip-payee">
          <span className="slip-cap">Received from</span>
          <h1>{c.customer_name}</h1>
        </div>
        <div className="slip-amount">
          <span className="slip-cap">{c.collected_amount != null ? 'Collected' : 'Expected'}</span>
          <span className="slip-figure">LKR {lkr(shownAmount)}</span>
          {c.amount_changed && (
            <span className="slip-changed">Expected LKR {lkr(c.expected_amount)}. The amount changed at collection.</span>
          )}
        </div>
        {c.invoice_refs && <p className="slip-memo">For invoice {c.invoice_refs}</p>}
        <div className="slip-stamp"><StatusStamp status={c.status} big /></div>
      </div>

      <Progress status={c.status} />

      {c.status === 'cancelled' && (
        <div className="notice">Cancelled {fmtDate(c.cancelled_at)}: {c.cancel_reason}</div>
      )}

      {/* The action for whoever is next */}
      {isFinance && ['submitted', 'assigned'].includes(c.status) && <AssignPanel c={c} onDone={load} />}
      {(isDriver || isFinance) && c.status === 'assigned' && <CollectPanel c={c} onDone={load} asFinance={!isDriver} />}
      {isFinance && c.status === 'collected' && <ReceivePanel c={c} onDone={load} />}
      {(isDriver || isFinance) && c.status === 'received' && <DepositPanel c={c} onDone={load} />}
      {isFinance && c.status === 'deposited' && <ClosePanel c={c} onDone={load} />}

      <div className="facts">
        <h2>Where and who</h2>
        <dl>
          {c.location_text && <><dt>Address</dt><dd>{c.location_text}</dd></>}
          {c.contact_person && <><dt>Contact</dt><dd>{c.contact_person}</dd></>}
          {c.contact_phone && <><dt>Phone</dt><dd><a href={`tel:${c.contact_phone}`}>{c.contact_phone}</a></dd></>}
          {c.driver_id && <><dt>Driver</dt><dd>{personName(c.driver)}</dd></>}
          {c.collection_date && <><dt>Collection date</dt><dd>{fmtDate(c.collection_date)}</dd></>}
          {c.instructions && <><dt>Instructions</dt><dd>{c.instructions}</dd></>}
          {c.notes && <><dt>Notes from sales</dt><dd>{c.notes}</dd></>}
        </dl>
        {c.lat != null && c.lng != null ? (
          <>
            <MapView lat={c.lat} lng={c.lng} />
            <a className="btn" href={directionsUrl(c.lat, c.lng)} target="_blank" rel="noreferrer">Directions in Google Maps</a>
          </>
        ) : <p className="muted">No map pin was added.</p>}
      </div>

      {cheques.length > 0 && (
        <div className="facts">
          <h2>Cheques</h2>
          {c.collection_note && <p className="quote">Driver's note: {c.collection_note}</p>}
          <ul className="cheque-list">
            {cheques.map((q) => (
              <li key={q.id}>
                {photosGone ? <div className="img-missing">Photo deleted after backup</div>
                  : <SignedImage path={q.photo_path} alt={`Cheque ${q.cheque_no}`} />}
                <div>
                  <strong>No. {q.cheque_no}</strong>
                  <span>{q.bank || 'Bank not given'}</span>
                  <span>Dated {fmtDate(q.cheque_date)}</span>
                  <span className="num">LKR {lkr(q.amount)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.deposit_slip_path && (
        <div className="facts">
          <h2>Deposit</h2>
          <dl>
            <dt>Deposited on</dt><dd>{fmtDate(c.deposit_date)}</dd>
            {c.deposit_reference && <><dt>Reference</dt><dd>{c.deposit_reference}</dd></>}
          </dl>
          <div className="slip-photo">
            {photosGone ? <div className="img-missing">Photo deleted after backup</div>
              : <SignedImage path={c.deposit_slip_path} alt="Deposit slip" />}
          </div>
        </div>
      )}

      <div className="facts">
        <h2>History</h2>
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <span className="t-when">{fmtDateTime(e.created_at)}</span>
              <span className="t-what"><strong>{personName(e.actor)}</strong> {e.action}{e.note ? `: ${e.note}` : ''}</span>
            </li>
          ))}
        </ol>
      </div>

      {(canEdit || canCancel) && (
        <div className="quiet-actions">
          {canEdit && <Link className="btn ghost" to={`/c/${c.id}/edit`}>Edit details</Link>}
          {canCancel && <CancelPanel c={c} onDone={load} />}
        </div>
      )}
    </section>
  );
}
