// Credit terms kept in the app: the usual ones, and how to describe them.
export const TERM_PRESETS = [
  { key: 'cod', terms: 'COD', min: 0, max: 0 },
  { key: 'codbt3', terms: 'COD or bank transfer within 3 days', min: 3, max: 3 },
  { key: 'd7', terms: '7 days', min: 7, max: 7 },
  { key: 'd14', terms: '14 days', min: 14, max: 14 },
  { key: 'd30', terms: '30 days', min: 30, max: 30 },
  { key: 'd30-40', terms: '30–40 days', min: 30, max: 40 },
  { key: 'd30-45', terms: '30–45 days', min: 30, max: 45 },
  { key: 'd45', terms: '45 days', min: 45, max: 45 },
  { key: 'd60', terms: '60 days', min: 60, max: 60 },
  { key: 'adv', terms: '100% advance', min: 0, max: 0 },
  { key: 'b2b', terms: 'Bill to bill', min: null, max: null },
];

export const presetOf = (t) => (t ? TERM_PRESETS.find((p) => p.terms === t.terms && p.min === t.min_days && p.max === t.max_days)?.key ?? 'other' : '');

// "overdue after 30 days, priority after 40" etc.
export function termsRule(t) {
  if (!t) return '';
  if (t.min_days == null) return 'no fixed days: invoices age by BC’s due date';
  if (t.max_days > t.min_days) return `overdue ${t.min_days} days after the invoice, more priority after ${t.max_days}`;
  if (t.min_days === 0) return 'due on the invoice date';
  return `due ${t.min_days} day${t.min_days === 1 ? '' : 's'} after the invoice`;
}
