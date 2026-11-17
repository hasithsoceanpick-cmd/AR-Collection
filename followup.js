// AR follow-up: labels, statuses and small helpers shared by the worklist, the customer panel and the promises page.

export const CHANNELS = [
  { key: 'call', label: 'Call' }, { key: 'visit', label: 'Visit' }, { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' }, { key: 'meeting', label: 'Meeting' },
];
export const OUTCOMES = [
  { key: 'promised', label: 'Promised to pay' }, { key: 'disputed', label: 'Disputed' }, { key: 'no_answer', label: 'No answer' },
  { key: 'call_back', label: 'Call back' }, { key: 'paid_already', label: 'Says paid already' }, { key: 'other', label: 'Other' },
];
export const METHODS = [
  { key: 'cheque_pickup', label: 'Cheque pickup' }, { key: 'transfer', label: 'Bank transfer' }, { key: 'cash', label: 'Cash' }, { key: 'card', label: 'Card' },
];
export const REASONS = [
  { key: 'quality', label: 'Quality' }, { key: 'short_weight', label: 'Short weight' }, { key: 'price', label: 'Price' },
  { key: 'missing_po_grn', label: 'Missing PO or GRN' }, { key: 'returned_goods', label: 'Returned goods' },
  { key: 'credit_note_pending', label: 'Credit note pending' }, { key: 'wrong_customer', label: 'Wrong customer' }, { key: 'other', label: 'Other' },
];
export const RESOLVERS = [
  { key: 'sales', label: 'Sales' }, { key: 'finance', label: 'Finance' }, { key: 'qa', label: 'QA' }, { key: 'operations', label: 'Operations' },
];
export const RESOLUTIONS = [
  { key: 'credit_note', label: 'Credit note raised' }, { key: 'accepted', label: 'Customer accepted' }, { key: 'partly_accepted', label: 'Partly accepted' },
  { key: 'written_off', label: 'Written off', finance: true }, { key: 'withdrawn', label: 'Withdrawn' },
];
export const PROMISE = {
  open: { label: 'Open', tone: 'muted' },
  due_today: { label: 'Due today', tone: 'warn' },
  grace: { label: 'Late, in grace', tone: 'warn' },
  kept: { label: 'Kept', tone: 'ok' },
  part_kept: { label: 'Part kept', tone: 'warn' },
  broken: { label: 'Broken', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};
export const ACTIVE = ['open', 'due_today', 'grace'];

const find = (list, k) => list.find((x) => x.key === k)?.label ?? k;
export const channelLabel = (k) => find(CHANNELS, k);
export const outcomeLabel = (k) => find(OUTCOMES, k);
export const methodLabel = (k) => find(METHODS, k);
export const reasonLabel = (k) => find(REASONS, k);
export const resolverLabel = (k) => find(RESOLVERS, k);
export const resolutionLabel = (k) => find(RESOLUTIONS, k);

// dd/mm/yyyy (the follow-up screens' date format)
export function dmy(d) {
  if (!d) return '—';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; }
  const t = new Date(d);
  return `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}/${t.getFullYear()}`;
}
export const dmyTime = (d) => {
  if (!d) return '—';
  const t = new Date(d);
  return `${dmy(t)} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
};

// yyyy-mm-dd n days from a yyyy-mm-dd date (no time zone shifts)
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export const money = (n) => Number(n || 0);
export const zero = (n) => Math.abs(Number(n || 0)) < 0.005;

// Where a promise to collect a cheque opens New collection, with its invoices ticked.
export const collectionLink = (customerNo, p) => {
  const q = new URLSearchParams({ customer: customerNo, promise: String(p.id), amount: Number(p.amount).toFixed(2) });
  const docs = (p.invoices ?? []).map((i) => i.doc_no).filter(Boolean);
  if (docs.length) q.set('invoices', docs.join(','));
  return `/new?${q.toString()}`;
};
