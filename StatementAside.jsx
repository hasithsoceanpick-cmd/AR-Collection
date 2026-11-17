import { useAuth } from '../lib/auth';
import StatementView from './StatementView';

// The chosen account's statement beside a form, for finance, Finance Admins and sales.
export function canSeeStatement(role, isAdmin) {
  return isAdmin || ['finance', 'sales', 'executive'].includes(role);
}

export default function StatementAside({ accountId, highlightIds = [], focusDate = null }) {
  const { role, isAdmin } = useAuth();
  if (!accountId || !canSeeStatement(role, isAdmin)) return null;
  return (
    <aside className="stmt-aside" aria-label="Bank statement">
      <StatementView key={accountId} accountId={Number(accountId)} highlightIds={highlightIds} focusDate={focusDate} compact />
    </aside>
  );
}
