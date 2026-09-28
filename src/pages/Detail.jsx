import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, COLLECTION_SELECT, db, SCHEMA } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { lkr, ref, fmtDate, fmtDateTime, personName } from '../lib/format';
import StatusStamp from '../components/StatusStamp';
import Progress from '../components/Progress';
import MapView, { directionsUrl } from '../components/MapView';
import SignedImage from '../components/SignedImage';
import DepositLink from '../components/DepositLink';
import {
  AssignPanel, CollectPanel, ReceivePanel, CancelPanel, TransferReviewPanel, RelinkPanel, ReopenPanel, ReturnChequePanel,
} from './actions';

export default function Detail() {
  const { id } = useParams();
  const { role, session } = useAuth();
  const uid = session.user.id;
  const [c, setC] = useState(undefined);
  const [cheques, setCheques] = useState([]);
  const [events, setEvents] = useState([]);
  const [deposit, setDeposit] = useState(null);
  const [line, setLine] = useState(null);
  const [depLines, setDepLines] = useState([]);
  const [replacement, setReplacement] = useState(null);

  const load = useCallback(async () => {
    const [a, b, e] = await Promise.all([
      db.from('collections').select(COLLECTION_SELECT).eq('id', id).maybeSingle(),
      db.from('cheques').select('*').eq('collection_id', id).order('id'),
      db.from('events').select('*, actor:profiles(full_name,email)').eq('collection_id', id).order('id'),
    ]);
    const col = a.data ?? null;
    setC(col); setCheques(b.data ?? []); setEvents(e.data ?? []);
    if (!col) return;
    let lineId = col.kind === 'transfer' ? col.line_id : null;
    if (col.deposit_id) {
      const { data } = await db.from('deposits').select('*, account:bank_accounts(name), collections(id, customer_name, collected_amount)')
        .eq('id', col.deposit_id).maybeSingle();
      setDeposit(data);
      const dl = await db.from('bank_credits').select('*').eq('deposit_id', col.deposit_id).order('txn_date');
      setDepLines(dl.data ?? []);
    } else { setDeposit(null); setDepLines([]); }
    if (lineId) {
      const { data } = await db.from('bank_credits').select('*').eq('id', lineId).maybeSingle();
      setLine(data);
    } else setLine(null);
    if (col.status === 'returned') {
      const { data } = await db.from('collections').select('id, status').eq('replaces_id', col.id).neq('status', 'cancelled').maybeSingle();
      setReplacement(data);
    }
  }, [id]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`collection-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: SCHEMA, table: 'collections', filter: `id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);

  if (c === undefined) return <p className="muted">Loading…</p>;
  if (c === null) return (
    <div className="empty"><p>This item doesn't exist or isn't shared with you.</p><Link to="/">Back to collections</Link></div>
  );

  const isTransfer = c.kind === 'transfer';
  const isDriver = role === 'driver' && c.driver_id === uid;
  const isFinance = role === 'finance';
  const isCreator = c.created_by === uid;
  const canEdit = !isTransfer && ((role === 'sales' && isCreator && c.status === 'submitted')
    || (isFinance && ['submitted', 'assigned'].includes(c.status)));
  const canCancel = (isFinance && ['submitted', 'assigned', 'collected', 'received', 'review', 'relink'].includes(c.status))
    || (role === 'sales' && isCreator && ['submitted', 'review', 'relink'].includes(c.status));
  const canReturn = isFinance && !isTransfer && ['deposited', 'closed'].includes(c.status) && cheques.some((q) => !q.returned_at);
  const photosGone = Boolean(c.photos_deleted_at);
  const shownAmount = c.collected_amount ?? c.expected_amount;

  return (
    <section className="detail">
      <Link to="/" className="back">All collections</Link>

      <div className="slip">
        <div className="slip-top">
          <span className="slip-ref">{ref(c.id)} · {isTransfer ? 'Bank transfer' : 'Cheque collection'}</span>
          <span className="slip-date">Recorded {fmtDate(c.created_at)} by {personName(c.creator)}</span>
        </div>
        <div className="slip-payee">
          <span className="slip-cap">Received from{c.customer_no ? `, customer ${c.customer_no}` : ''}</span>
          <h1>{c.customer_name}</h1>
        </div>
        <div className="slip-amount">
          <span className="slip-cap">{isTransfer ? 'Transferred' : c.collected_amount != null ? 'Collected' : 'Expected'}</span>
          <span className="slip-figure">LKR {lkr(shownAmount)}</span>
          {c.amount_changed && <span className="slip-changed">Expected LKR {lkr(c.expected_amount)}. The amount changed at collection.</span>}
        </div>
        {c.invoice_refs && <p className="slip-memo">Settling {c.invoice_refs}</p>}
        <div className="slip-stamp"><StatusStamp status={c.status} big /></div>
      </div>

      <Progress status={c.status} kind={c.kind} />

      {c.notes?.startsWith('Practice scenario') && <div className="notice practice-notice">Practice scenario: real customer and real open invoices, made up to show this stage. Try the next step yourself.</div>}
      {c.status === 'cancelled' && <div className="notice">Cancelled {fmtDate(c.cancelled_at)}: {c.cancel_reason}</div>}
      {c.replaces_id && <div className="notice">This replaces returned collection <Link to={`/c/${c.replaces_id}`}>{ref(c.replaces_id)}</Link>.</div>}
      {c.status === 'returned' && (
        <div className="notice danger-notice">
          Cheque returned {fmtDate(c.returned_at)}: {c.return_reason}.{' '}
          {replacement ? <>Replacement: <Link to={`/c/${replacement.id}`}>{ref(replacement.id)}</Link>.</>
            : (isFinance || (role === 'sales' && isCreator)) ? <Link to={`/new?replaces=${c.id}`}>Raise a replacement collection</Link>
            : 'No replacement raised yet.'}
        </div>
      )}
      {c.status === 'relink' && <div className="notice">This transfer isn't linked to a bank line.</div>}

      {/* The action for whoever is next */}
      {!isTransfer && isFinance && ['submitted', 'assigned'].includes(c.status) && <AssignPanel c={c} onDone={load} />}
      {!isTransfer && (isDriver || isFinance) && c.status === 'assigned' && <CollectPanel c={c} onDone={load} asFinance={!isDriver} />}
      {!isTransfer && isFinance && c.status === 'collected' && <ReceivePanel c={c} onDone={load} />}
      {!isTransfer && (isDriver || isFinance) && c.status === 'received' && (
        <div className="action quiet">
          <Link className="btn primary" to="/deposits">Record the deposit slip</Link>
          <span className="hint">Deposits are recorded per slip, so several collections can go on one.</span>
        </div>
      )}
      {!isTransfer && isFinance && c.status === 'deposited' && deposit && !deposit.closed_at && <DepositLink deposit={deposit} onDone={load} />}
      {isTransfer && isFinance && c.status === 'review' && <TransferReviewPanel c={c} line={line} onDone={load} />}
      {isTransfer && c.status === 'relink' && (isFinance || (role === 'sales' && isCreator)) && <RelinkPanel c={c} onDone={load} />}

      {(c.settlement?.length > 0 || c.settlement_instructions) && (
        <div className="facts">
          <h2>Settlement</h2>
          {c.settlement?.length > 0 && (
            <div className="table-wrap flat">
              <table className="table">
                <thead><tr><th>Document</th><th>Type</th><th>Posted</th><th>Due</th><th className="num">Open LKR</th></tr></thead>
                <tbody>
                  {c.settlement.map((s) => (
                    <tr key={s.document_no}>
                      <td>{s.document_no}</td><td>{s.document_type || '—'}</td>
                      <td>{fmtDate(s.posting_date)}</td><td>{fmtDate(s.due_date)}</td>
                      <td className="num">{lkr(s.remaining_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan="4">Total of invoices</td>
                  <td className="num">{lkr(c.settlement.reduce((t, s) => t + Number(s.remaining_amount), 0))}</td></tr></tfoot>
              </table>
            </div>
          )}
          {c.settlement_instructions && <p className="quote">Instructions: {c.settlement_instructions}</p>}
        </div>
      )}

      {isTransfer && (
        <div className="facts">
          <h2>Bank</h2>
          {line ? (
            <dl>
              <dt>Account</dt><dd>{line.account_name}</dd>
              <dt>Bank date</dt><dd>{fmtDate(line.txn_date)}</dd>
              <dt>Narration</dt><dd>{line.narration}</dd>
              {line.reference && <><dt>Reference</dt><dd>{line.reference}</dd></>}
              <dt>Amount</dt><dd>LKR {lkr(line.credit)}</dd>
            </dl>
          ) : <p className="muted">Not linked to a bank line.</p>}
          <h2>Receipt</h2>
          {c.receipt_path ? (photosGone ? <div className="img-missing">Receipt deleted after backup</div>
            : <div className="slip-photo"><SignedImage path={c.receipt_path} alt="Receipt" /></div>)
            : <p>No receipt. Reason given: {c.no_receipt_reason}</p>}
          {c.notes && <p className="quote">Notes: {c.notes}</p>}
        </div>
      )}

      {!isTransfer && (
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
      )}

      {cheques.length > 0 && (
        <div className="facts">
          <h2>Cheques</h2>
          {c.collection_note && <p className="quote">Driver's note: {c.collection_note}</p>}
          <ul className="cheque-list">
            {cheques.map((q) => (
              <li key={q.id}>
                {!q.photo_path ? <div className="img-missing">No photo (imported record)</div>
                  : photosGone ? <div className="img-missing">Photo deleted after backup</div>
                  : <SignedImage path={q.photo_path} alt={`Cheque ${q.cheque_no}`} />}
                <div>
                  <strong>No. {q.cheque_no}</strong>
                  <span>{q.bank || 'Bank not given'}</span>
                  <span>Dated {fmtDate(q.cheque_date)}</span>
                  <span className="num">LKR {lkr(q.amount)}</span>
                  {q.returned_at && <span className="warn-text">Returned {fmtDate(q.returned_at)}: {q.return_reason}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {deposit && (
        <div className="facts">
          <h2>Deposit slip D-{deposit.id}</h2>
          <dl>
            <dt>Account</dt><dd>{deposit.account?.name}</dd>
            <dt>Deposited on</dt><dd>{fmtDate(deposit.deposit_date)}</dd>
            {deposit.reference && <><dt>Reference</dt><dd>{deposit.reference}</dd></>}
            <dt>Slip total</dt><dd>LKR {lkr(deposit.slip_total)}</dd>
            <dt>On this slip</dt>
            <dd>{deposit.collections.map((x, i) => <span key={x.id}>{i > 0 && ', '}<Link to={`/c/${x.id}`}>{ref(x.id)}</Link> {x.customer_name}</span>)}</dd>
            <dt>In the bank</dt>
            <dd>{depLines.length ? depLines.map((l) => <div key={l.id}>{fmtDate(l.txn_date)}, {l.narration}, LKR {lkr(l.credit)}</div>) : 'Not matched yet'}</dd>
          </dl>
          <div className="slip-photo">
            {!deposit.slip_path ? <div className="img-missing">No slip photo (imported record)</div>
              : photosGone ? <div className="img-missing">Photo deleted after backup</div> : <SignedImage path={deposit.slip_path} alt="Deposit slip" />}
          </div>
        </div>
      )}
      {!deposit && c.deposit_slip_path && (
        <div className="facts">
          <h2>Earlier deposit slip</h2>
          <div className="slip-photo">{photosGone ? <div className="img-missing">Photo deleted after backup</div> : <SignedImage path={c.deposit_slip_path} alt="Deposit slip" />}</div>
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

      {(canEdit || canCancel || canReturn || (isFinance && c.status === 'closed')) && (
        <div className="quiet-actions">
          {canEdit && <Link className="btn ghost" to={`/c/${c.id}/edit`}>Edit details</Link>}
          {isFinance && c.status === 'closed' && <ReopenPanel c={c} onDone={load} />}
          {canReturn && <ReturnChequePanel c={c} cheques={cheques.filter((q) => !q.returned_at)} onDone={load} />}
          {canCancel && <CancelPanel c={c} onDone={load} />}
        </div>
      )}
    </section>
  );
}
