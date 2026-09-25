import { STEPS } from '../lib/workflow';

export default function Progress({ status }) {
  if (status === 'cancelled') return null;
  const at = STEPS.findIndex((s) => s.status === status);
  return (
    <ol className="progress" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s.status} className={i < at ? 'done' : i === at ? 'now' : ''}
          aria-current={i === at ? 'step' : undefined}>
          <span className="dot" />
          <span className="plabel">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
