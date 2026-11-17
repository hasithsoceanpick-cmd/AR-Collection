import { CHEQUE_STEPS, TRANSFER_STEPS, CARD_STEPS } from '../lib/workflow';

export default function Progress({ status, kind = 'cheque' }) {
  if (['cancelled', 'returned', 'relink'].includes(status)) return null;
  const steps = kind === 'transfer' ? TRANSFER_STEPS : kind === 'card' ? CARD_STEPS : CHEQUE_STEPS;
  const at = steps.findIndex((s) => s.status === status);
  return (
    <ol className="progress" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.status} className={i < at ? 'done' : i === at ? (status === 'closed' ? 'done' : 'now') : ''}
          aria-current={i === at ? 'step' : undefined}>
          <span className="dot" />
          <span className="plabel">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
