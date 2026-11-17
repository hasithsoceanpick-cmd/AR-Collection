import { Link } from 'react-router-dom';
import { lkr } from '../lib/format';
import { dmy } from '../lib/followup';
import { receiptKind, receiptStage, statusOf } from '../lib/pending';

// What the app holds for a customer or an invoice that BC doesn't have yet: each receipt, its status,
// what it puts on the invoice(s) and the settlement instructions as written.
// receipts: from groupPending. docNo: the invoice in question (null for the customer's whole list).
export default function PendingCard({ receipts, docNo = null }) {
  const n = receipts.length;
  return (
    <div className="pending-card">
      <p className="pending-card-head"><strong>{docNo ? `${docNo}: ` : ''}in the app, not in BC yet</strong>
        <span className="muted small"> · {n} receipt{n === 1 ? '' : 's'}</span></p>
      <ul>
        {receipts.map((x) => {
          const st = statusOf(x);
          const on = docNo ? Number(x.applied ?? 0) : null;
          return (
            <li key={`${x.src}-${x.id}-${x.doc_no ?? ''}`}>
              <div className="pending-line">
                <span>{x.href ? <Link to={x.href}>{x.ref}</Link> : <strong>{x.ref}</strong>} · {receiptKind(x)}</span>
                {st && <span className={`stamp tone-${st.tone}`}>{st.label}</span>}
              </div>
              <div className="pending-card-amt">
                {docNo
                  ? (on < 0
                    ? <>Credit of <strong>LKR {lkr(-on)}</strong> used in this receipt of LKR {lkr(x.amount)}</>
                    : <><strong>LKR {lkr(on)}</strong>{' '}to {docNo}{Math.abs(on - Number(x.amount)) >= 0.005 && <span className="muted"> of a receipt of LKR {lkr(x.amount)}</span>}</>)
                  : <><strong>LKR {lkr(x.amount)}</strong>{x.docs?.length
                    ? <span className="muted"> · for {x.docs.map((d) => `${d.doc_no}${d.applied != null && Math.abs(Number(d.applied) - Number(x.amount)) >= 0.005 ? ` (${lkr(d.applied)})` : ''}`).join(', ')}</span>
                    : <span className="muted"> · no invoice given</span>}</>}
              </div>
              <div className="muted small">{dmy(x.at)}{x.by ? ` · recorded by ${x.by}` : ''} · {receiptStage(x)}</div>
              {x.instructions && <p className="pending-instr"><span className="muted small">Settlement instructions:</span> {x.instructions}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
