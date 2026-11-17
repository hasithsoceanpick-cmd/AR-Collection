import { STATUS } from '../lib/workflow';

export default function StatusStamp({ status, big = false }) {
  const s = STATUS[status] ?? { label: status, tone: 'grey' };
  return <span className={`stamp tone-${s.tone}${big ? ' stamp-big' : ''}`}>{s.label}</span>;
}
