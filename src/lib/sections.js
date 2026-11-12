// Finance's menu: six sections, each with its own tabs over the existing pages.
// `also`: other paths that belong to a tab (detail pages, forms). `count`: which Today figures its badge adds up.

export function financeSections(isAdmin = false) {
  return [
    { key: 'today', label: 'Today', short: 'Today', to: '/', icon: 'today', count: ['today'], tabs: [{ to: '/', label: 'Today', exact: true }] },
    { key: 'receipts', label: 'Receipts', short: 'Receipts', to: '/collections', icon: 'receipt', count: ['receipts'],
      tabs: [
        { to: '/collections', label: 'Receipts', also: ['/c/', '/new', '/transfer', '/card'], count: ['assign', 'receive_cheques', 'review'] },
        { to: '/cash', label: 'Cash handovers', also: ['/cash/'], count: ['cash_count'] },
        { to: '/deposits', label: 'Deposit slips' },
      ],
      actions: [
        { to: '/new', label: 'New cheque collection' },
        { to: '/transfer', label: 'Record a transfer' },
        { to: '/card', label: 'Record a card payment' },
      ] },
    { key: 'money', label: 'Money in', short: 'Money in', to: '/money-in', icon: 'bank', count: ['money_in'],
      tabs: [
        { to: '/money-in', label: 'Match', count: ['unidentified', 'deposits', 'batches', 'payouts'] },
        { to: '/bank', label: 'Statements' },
        { to: '/merchant', label: 'Card batches (HNB)', also: ['/merchant/'] },
        { to: '/payhere', label: 'PayHere' },
        { to: '/bank-rec', label: 'Bank rec' },
      ] },
    { key: 'bc', label: 'Business Central', short: 'BC', to: '/bc-export', icon: 'bc', count: ['bc'],
      tabs: [
        { to: '/bc-export', label: '1 Export', count: ['ready'] },
        { to: '/bc-check', label: '2 Check', also: ['/not-in-bc'], count: ['not_posted', 'differs', 'reversals'] },
        { to: '/bc-close', label: '3 Close the month' },
      ] },
    { key: 'customers', label: 'Customers', short: 'Customers', to: '/customer-list', icon: 'people',
      tabs: [
        { to: '/customer-list', label: 'Customers', also: ['/customer/'] },
        { to: '/aging', label: 'Aging' },
        { to: '/customers', label: 'BC customer files' },
      ] },
    { key: 'reports', label: 'Reports', short: 'Reports', to: '/reports', icon: 'chart',
      tabs: [
        { to: '/overview', label: 'Overview' },
        ...(isAdmin ? [{ to: '/admin', label: 'Bank balances' }] : []),
        { to: '/reports', label: 'Reports' },
      ] },
  ];
}

export const SETTINGS_PATHS = ['/settings', '/users', '/photos', '/backup', '/account', '/chat'];

const onTab = (t, path) => (t.exact ? path === t.to : path === t.to || path.startsWith(`${t.to}/`) || (t.also ?? []).some((a) => (a.endsWith('/') ? path.startsWith(a) : path === a)));

// The section and tab a path belongs to.
export function sectionFor(path, sections) {
  for (const s of sections) {
    const tab = s.tabs.find((t) => onTab(t, path));
    if (tab) return { section: s, tab };
  }
  return null;
}

// The badge for a section or tab: the sum of its Today figures.
export function countOf(keys, today) {
  if (!keys || !today) return 0;
  return keys.reduce((n, k) => {
    if (k === 'today') return n + Object.values(today.sections ?? {}).reduce((a, b) => a + Number(b || 0), 0);
    if (today.sections && k in today.sections) return n + Number(today.sections[k] || 0);
    return n + Number(today.queue?.[k]?.count || 0);
  }, 0);
}
