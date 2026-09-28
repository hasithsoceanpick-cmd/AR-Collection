// Mirrors the status flow enforced in the database.
export const STATUS = {
  submitted: { label: 'With finance', tone: 'amber' },
  assigned:  { label: 'To collect',   tone: 'blue' },
  collected: { label: 'With driver',  tone: 'violet' },
  received:  { label: 'To deposit',   tone: 'blue' },
  deposited: { label: 'In bank?',     tone: 'teal' },
  review:    { label: 'To review',    tone: 'amber' },
  relink:    { label: 'Needs relink', tone: 'red' },
  closed:    { label: 'Closed',       tone: 'green' },
  returned:  { label: 'Returned',     tone: 'red' },
  cancelled: { label: 'Cancelled',    tone: 'grey' },
};

export const CHEQUE_STEPS = [
  { status: 'submitted', label: 'Recorded' },
  { status: 'assigned',  label: 'Driver assigned' },
  { status: 'collected', label: 'Collected' },
  { status: 'received',  label: 'Finance received' },
  { status: 'deposited', label: 'Deposited' },
  { status: 'closed',    label: 'In bank, closed' },
];
export const TRANSFER_STEPS = [
  { status: 'review', label: 'Recorded and linked' },
  { status: 'closed', label: 'Reviewed, closed' },
];

export const isOpen = (c) => !['closed', 'cancelled', 'returned'].includes(c.status);
export const KIND_LABEL = { cheque: 'Cheque', transfer: 'Transfer' };

// Is the next move on this item the current user's?
export function waitingOnMe(c, role, userId) {
  if (role === 'finance') return ['submitted', 'collected', 'deposited', 'review'].includes(c.status);
  if (role === 'driver') return c.driver_id === userId && ['assigned', 'received'].includes(c.status);
  if (role === 'sales') return c.created_by === userId && c.status === 'relink';
  return false;
}

export function nextStepText(c) {
  switch (c.status) {
    case 'submitted': return 'Finance to assign a driver';
    case 'assigned':  return 'Driver to collect';
    case 'collected': return 'Driver to hand cheques to finance';
    case 'received':  return 'Cheques to be deposited';
    case 'deposited': return 'Finance to match the slip to the bank';
    case 'review':    return 'Finance to review';
    case 'relink':    return 'Link to the right bank line';
    default: return '';
  }
}

export const TAGS = { cash_deposit: 'Cash deposit', internal: 'Internal transfer', other: 'Other' };
