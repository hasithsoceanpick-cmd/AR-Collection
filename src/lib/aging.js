// Customer aging and ledgers: bucket names, entry labels and the Excel downloads.

export const BUCKETS = [
  { key: 'not_due', label: 'Not due' },
  { key: 'd30', label: '1–30 days' },
  { key: 'd60', label: '31–60 days' },
  { key: 'd90', label: '61–90 days' },
  { key: 'over90', label: 'Over 90 days' },
];
export const OVERDUE = ['d30', 'd60', 'd90', 'over90'];

export function bucketOf(late) {
  if (late <= 0) return 'not_due';
  if (late <= 30) return 'd30';
  if (late <= 60) return 'd60';
  if (late <= 90) return 'd90';
  return 'over90';
}
export const bucketLabel = (late) => BUCKETS.find((b) => b.key === bucketOf(late)).label;

// BC leaves the document type blank on cash receipt journal lines
export const docType = (type, amount) => type || (Number(amount) < 0 ? 'Receipt' : '');

const KIND = {
  'Realized Loss': 'Exchange loss (realised)', 'Realized Gain': 'Exchange gain (realised)',
  'Unrealized Loss': 'Exchange loss (unrealised)', 'Unrealized Gain': 'Exchange gain (unrealised)',
  'Correction of Remaining Amount': 'Rounding correction', 'Payment Discount': 'Payment discount',
};
export const kindLabel = (kind) => KIND[kind] ?? kind;

// Entries packed as arrays by cc_aging → objects
export const unpack = (fields, rows) => rows.map((r) => Object.fromEntries(fields.map((f, i) => [f, r[i]])));

const excelDate = (iso) => (iso ? (Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - Date.UTC(1899, 11, 30)) / 86400000 : null);
const ddmmyyyy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

function sheet(XLSX, rows, { dates = [], money = [], widths = [], filterFrom = null, filterTo = null } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = 0; r <= range.e.r; r += 1) {
    for (const c of dates) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.t === 'n') cell.z = 'dd/mm/yyyy'; }
    for (const c of money) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.t === 'n') cell.z = '#,##0.00;[Red]-#,##0.00'; }
  }
  ws['!cols'] = widths.map((wch) => ({ wch }));
  if (filterFrom != null) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: filterFrom, c: 0 }, e: { r: filterTo, c: range.e.c } }) };
  return ws;
}

const num = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

// The aging report: a summary per customer and every open entry.
export async function downloadAging({ asAt, rows, entries, names }) {
  const XLSX = await import('xlsx');
  const head = ['Customer No.', 'Customer', 'Group', 'Payment terms', ...BUCKETS.map((b) => b.label), 'Unapplied credits', 'Balance'];
  const keys = [...BUCKETS.map((b) => b.key), 'credits', 'balance'];
  const sum = (k) => num(rows.reduce((a, r) => a + Number(r[k] ?? 0), 0));
  const summary = [
    [`Customer aging as at ${ddmmyyyy(asAt)} (by due date, LKR)`], [],
    head,
    ...rows.map((r) => [r.customer_no, r.name, r.group ?? '', r.terms ?? '', ...keys.map((k) => num(r[k]))]),
    ['', `Total: ${rows.length} customer${rows.length === 1 ? '' : 's'}`, '', '', ...keys.map(sum)],
  ];
  const detail = [
    ['Customer No.', 'Customer', 'Posting date', 'Due date', 'Days overdue', 'Bucket', 'Type', 'Document No.', 'Description', 'Original amount', 'Remaining'],
    ...entries.map((e) => [e.customer_no, names[e.customer_no] ?? e.customer_no, excelDate(e.posting_date), excelDate(e.due_date), Math.max(0, e.late),
      Number(e.remaining) < 0 ? 'Unapplied credit' : bucketLabel(e.late), docType(e.document_type, e.original), e.document_no, e.description ?? '', num(e.original), num(e.remaining)]),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, summary, { money: [4, 5, 6, 7, 8, 9, 10], widths: [12, 38, 10, 12, 15, 15, 15, 15, 15, 16, 16], filterFrom: 2, filterTo: summary.length - 2 }), 'Aging');
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, detail, { dates: [2, 3], money: [9, 10], widths: [12, 34, 12, 12, 8, 16, 12, 16, 30, 16, 16], filterFrom: 0, filterTo: detail.length - 1 }), 'Open entries');
  XLSX.writeFile(wb, `Customer aging ${asAt}.xlsx`);
}

// One customer's statement: the ledger with its running balance, and what is open, aged.
export async function downloadStatement(data) {
  const XLSX = await import('xlsx');
  const c = data.customer;
  let bal = Number(data.opening);
  const ledger = [
    [`${c.name} (${c.customer_no})`], [`Statement ${ddmmyyyy(data.from)} to ${ddmmyyyy(data.to)}, LKR`], [],
    ['Date', 'Type', 'Document No.', 'Description', 'Due date', 'Debit', 'Credit', 'Balance', 'Open'],
    [null, 'Opening balance', '', '', null, null, null, num(bal), null],
    ...data.lines.map((l) => {
      bal += Number(l.amount);
      const initial = l.kind === 'Initial Entry';
      return [excelDate(l.date), initial ? docType(l.doc_type, l.amount) : kindLabel(l.kind), l.doc_no ?? '', l.description ?? '', excelDate(l.due_date),
        Number(l.amount) > 0 ? num(l.amount) : null, Number(l.amount) < 0 ? num(-l.amount) : null, num(bal), initial && Math.abs(Number(l.remaining)) >= 0.005 ? num(l.remaining) : null];
    }),
    [null, 'Closing balance', '', '', null, null, null, num(data.closing), null],
  ];
  const open = [
    [`Open as at ${ddmmyyyy(data.to)}`], [],
    ['Posting date', 'Due date', 'Days overdue', 'Bucket', 'Type', 'Document No.', 'Description', 'Original amount', 'Remaining'],
    ...data.open.map((o) => [excelDate(o.date), excelDate(o.due_date), Math.max(0, o.late), Number(o.remaining) < 0 ? 'Unapplied credit' : bucketLabel(o.late),
      docType(o.doc_type, o.original), o.doc_no, o.description ?? '', num(o.original), num(o.remaining)]),
    [], ...BUCKETS.map((b) => [b.label, null, null, null, null, null, null, null, num(data.buckets[b.key])]),
    ['Unapplied credits', null, null, null, null, null, null, null, num(data.buckets.credits)],
    ['Balance', null, null, null, null, null, null, null, num(data.buckets.balance)],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, ledger, { dates: [0, 4], money: [5, 6, 7, 8], widths: [12, 26, 16, 34, 12, 15, 15, 16, 15] }), 'Ledger');
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, open, { dates: [0, 1], money: [7, 8], widths: [12, 12, 8, 16, 12, 16, 34, 16, 16] }), 'Open');
  XLSX.writeFile(wb, `${c.customer_no} statement ${data.from} to ${data.to}.xlsx`);
}
