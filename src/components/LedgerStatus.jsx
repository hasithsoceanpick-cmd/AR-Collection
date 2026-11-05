import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime } from '../lib/format';

// Where the customer figures come from (the BC Detailed Customer Ledger Entries upload) and whether it is complete.
export default function LedgerStatus({ status, customer = false, incomplete = false }) {
  const { role } = useAuth();
  if (!status) return null;
  const upload = role === 'finance' ? <>Upload it on <Link to="/customers">Customer data</Link>.</> : 'Ask finance to upload it.';
  if (!Number(status.entries)) {
    return <div className="ledger-status warn"><strong>No customer ledger from BC yet.</strong> Balances and aging come from the BC Detailed Customer Ledger Entries. {upload}</div>;
  }
  const missing = customer ? incomplete : Number(status.orphans) > 0;
  return (
    <div className={`ledger-status${missing || Number(status.no_due_date) ? ' warn' : ''}`}>
      <p>From BC's Detailed Customer Ledger Entries, uploaded {fmtDateTime(status.uploaded_at)}: entries posted up to <strong>{fmtDate(status.latest_posting)}</strong>.
        Anything posted in BC after that isn't included.</p>
      {missing && (
        <p><strong>{incomplete ? "This customer's history is incomplete." : `History is missing for ${Number(status.orphan_customers).toLocaleString()} customer${Number(status.orphan_customers) === 1 ? '' : 's'}.`}</strong>{' '}
          The upload starts on {fmtDate(status.first_posting)}, but {customer ? "some of this customer's entries apply" : `${Number(status.orphans).toLocaleString()} of its entries apply`} to invoices or payments posted before that,
          so {incomplete ? 'its balance and aging are' : 'their balances and aging are'} not right. Export Detailed Customer Ledger Entries with no Posting Date filter. {upload}</p>
      )}
      {Number(status.no_due_date) > 0 && <p><strong>{Number(status.no_due_date).toLocaleString()} entries have no due date yet</strong> (uploaded before the aging was added), so they age from their posting date. Upload the detailed ledger again. {upload}</p>}
    </div>
  );
}
