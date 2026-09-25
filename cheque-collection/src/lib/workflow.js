// Mirrors the status flow enforced in supabase/schema.sql.
export const STATUS = {
  submitted: { label: 'With finance', tone: 'amber' },
  assigned:  { label: 'To collect',   tone: 'blue' },
  collected: { label: 'Collected',    tone: 'violet' },
  received:  { label: 'To deposit',   tone: 'blue' },
  deposited: { label: 'Deposited',    tone: 'teal' },
  closed:    { label: 'Closed',       tone: 'green' },
  cancelled: { label: 'Cancelled',    tone: 'grey' },
};

// The six steps shown on the progress line (cancelled sits outside it).
export const STEPS = [
  { status: 'submitted', label: 'Recorded' },
  { status: 'assigned',  label: 'Driver assigned' },
  { status: 'collected', label: 'Collected' },
  { status: 'received',  label: 'Finance received' },
  { status: 'deposited', label: 'Deposited' },
  { status: 'closed',    label: 'Closed' },
];

export const isOpen = (c) => !['closed', 'cancelled'].includes(c.status);

// Is the next move on this collection the current user's?
export function waitingOnMe(c, role, userId) {
  if (role === 'finance') return ['submitted', 'collected', 'deposited'].includes(c.status);
  if (role === 'driver') return c.driver_id === userId && ['assigned', 'received'].includes(c.status);
  return false;
}

export function nextStepText(c) {
  switch (c.status) {
    case 'submitted': return 'Finance to assign a driver';
    case 'assigned':  return 'Driver to collect';
    case 'collected': return 'Driver to hand cheques to finance';
    case 'received':  return 'Cheques to be deposited';
    case 'deposited': return 'Finance to verify the deposit';
    default: return '';
  }
}
