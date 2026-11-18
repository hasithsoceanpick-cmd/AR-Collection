import { PROMISE, payMethodLabel as payLabel } from './followup';
import { todayISO } from './format';
import { receiptKind, statusOf } from './pending';
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

// Ageing by posting (invoice) date: how long since the invoice was posted, whatever its due date.
// tone: which colour of the due-date buckets it borrows.
export const POST_BUCKETS = [
  { key: 'p30', label: '0–30 days', tone: 'not_due' },
  { key: 'p60', label: '31–60 days', tone: 'd30' },
  { key: 'p90', label: '61–90 days', tone: 'd60' },
  { key: 'p120', label: '91–120 days', tone: 'd90' },
  { key: 'over120', label: 'Over 120 days', tone: 'over90' },
];
export function postBucketOf(age) {
  if (age <= 30) return 'p30';
  if (age <= 60) return 'p60';
  if (age <= 90) return 'p90';
  if (age <= 120) return 'p120';
  return 'over120';
}
export const postBucketLabel = (age) => POST_BUCKETS.find((b) => b.key === postBucketOf(age)).label;
// whole days from one yyyy-mm-dd date to another
export const daysFrom = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
export const BASIS = {
  due: { label: 'Due date', buckets: BUCKETS, old90: ['over90'] },
  posting: { label: 'Posting date', buckets: POST_BUCKETS, old90: ['p120', 'over120'] },
};
// Adds to each customer row its posting-date buckets and its oldest open invoice's days since posting.
// The buckets add up to the same as the due-date ones: both are everything open that isn't a credit.
export function withPostingAge(rows, entries, asAt) {
  const byNo = {};
  for (const e of entries) {
    const t = (byNo[e.customer_no] ??= Object.fromEntries([...POST_BUCKETS.map((b) => [b.key, 0]), ['age_oldest', null]]));
    if (Number(e.remaining) > 0) {
      const age = daysFrom(e.posting_date, asAt);
      t[postBucketOf(age)] += Number(e.remaining);
      t.age_oldest = Math.max(t.age_oldest ?? 0, age);
    }
  }
  return rows.map((r) => ({ ...r, ...(byNo[r.customer_no] ?? Object.fromEntries(POST_BUCKETS.map((b) => [b.key, 0]))) }));
}

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
// pending: from groupPending (receipts in the app not in BC yet), or null. basis: 'due' or 'posting'.
// With 'posting', rows and entries come through withPostingAge. stats: customer no. -> cc_ar_customer_stats row, or null.
export async function downloadAging({ asAt, rows, entries, names, marks = null, pending = null, basis = 'due', stats = null }) {
  const XLSX = await import('xlsx');
  const B = BASIS[basis] ?? BASIS.due;
  const pendTotal = (c) => (pending?.byCust[c] ? num(pending.byCust[c].total) : null);
  const st = (c) => stats?.[c] ?? null;
  const noteText = (list) => (list ?? []).map((n) => `${n.text} (${n.by}, ${ddmmyyyy(String(n.at).slice(0, 10))}${n.due_on ? `, due ${ddmmyyyy(n.due_on)}` : ''})`).join(' | ');
  const sum = (f) => num(rows.reduce((a, r) => a + Number(f(r) ?? 0), 0));
  // the customers sheet, column by column: [heading, value of a row, kind (money / date), width, total of the column or null]
  const scols = [
    ['Customer No.', (r) => r.customer_no, null, 12, null],
    ['Customer', (r) => r.name, null, 38, () => `Total: ${rows.length} customer${rows.length === 1 ? '' : 's'}`],
    ['Group', (r) => r.group ?? '', null, 10, null],
    ['Payment terms', (r) => r.terms ?? '', null, 12, null],
    ...B.buckets.map((bk) => [bk.label, (r) => num(r[bk.key]), 'money', 15, () => sum((r) => r[bk.key])]),
    ['Unapplied credits', (r) => num(r.credits), 'money', 16, () => sum((r) => r.credits)],
    ['Balance', (r) => num(r.balance), 'money', 16, () => sum((r) => r.balance)],
    ...(pending ? [['In the app, not in BC', (r) => pendTotal(r.customer_no), 'money', 18, () => sum((r) => pendTotal(r.customer_no))]] : []),
    ...(stats ? [
      ['Payment method', (r) => payLabel(st(r.customer_no)?.pay_method) ?? '', null, 16, null],
      ['Staff purchases', (r) => (st(r.customer_no)?.is_staff ? 'Yes' : ''), null, 9, null],
      ['Last payment', (r) => (st(r.customer_no)?.last_pay ? excelDate(st(r.customer_no).last_pay.on) : null), 'date', 12, null],
      ['Days since last payment', (r) => (st(r.customer_no)?.last_pay ? daysFrom(st(r.customer_no).last_pay.on, asAt) : null), null, 10, null],
      ['Last payment in', (r) => (st(r.customer_no)?.last_pay ? (st(r.customer_no).last_pay.src === 'app' ? `The app (${st(r.customer_no).last_pay.ref})` : `BC (${st(r.customer_no).last_pay.ref})`) : 'No payment on record'), null, 22, null],
      ['Avg days to pay (12 months)', (r) => st(r.customer_no)?.avg_days ?? null, null, 11, null],
      ['Invoices averaged', (r) => st(r.customer_no)?.avg_days_n || null, null, 9, null],
      ['Avg balance owed (12 month-ends)', (r) => (st(r.customer_no)?.avg_balance != null ? num(st(r.customer_no).avg_balance) : null), 'money', 16, () => sum((r) => st(r.customer_no)?.avg_balance)],
      ['Promised (still expected)', (r) => (Number(st(r.customer_no)?.promised_open) ? num(st(r.customer_no).promised_open) : null), 'money', 16, () => sum((r) => st(r.customer_no)?.promised_open)],
      ['Open notes on the customer', (r) => noteText(st(r.customer_no)?.notes), null, 60, null],
    ] : []),
  ];
  const at = (list, kind) => list.map((c, i) => (c[2] === kind ? i : -1)).filter((i) => i >= 0);
  const summary = [
    [`Customer aging as at ${ddmmyyyy(asAt)} (by ${basis === 'posting' ? 'posting' : 'due'} date, LKR)`], [],
    scols.map((c) => c[0]),
    ...rows.map((r) => scols.map((c) => c[1](r))),
    scols.map((c) => (c[4] ? c[4]() : '')),
  ];
  const key = (c, d) => `${c}|${d}`;
  const notesBy = new Map();
  for (const n of marks?.notes ?? []) { const k = key(n.customer_no, n.doc_no); notesBy.set(k, [...(notesBy.get(k) ?? []), n]); }
  const promiseBy = new Map((marks?.promises ?? []).map((p) => [key(p.customer_no, p.doc_no), p]));
  // the entries sheet, column by column: [heading, value of an entry, kind (date / money), width]
  const pendList = (e) => pending?.byDoc[key(e.customer_no, e.document_no)] ?? [];
  const promiseOf = (e) => promiseBy.get(key(e.customer_no, e.document_no));
  const notesOf = (e) => notesBy.get(key(e.customer_no, e.document_no));
  const cols = [
    ['Customer No.', (e) => e.customer_no, null, 12],
    ['Customer', (e) => names[e.customer_no] ?? e.customer_no, null, 34],
    ['Posting date', (e) => excelDate(e.posting_date), 'date', 12],
    ['Due date', (e) => excelDate(e.due_date), 'date', 12],
    ['Days since posting', (e) => Math.max(0, daysFrom(e.posting_date, asAt)), null, 9],
    ['Days overdue', (e) => Math.max(0, e.late), null, 8],
    [`Bucket (by ${basis === 'posting' ? 'posting' : 'due'} date)`, (e) => (Number(e.remaining) < 0 ? 'Unapplied credit'
      : basis === 'posting' ? postBucketLabel(daysFrom(e.posting_date, asAt)) : bucketLabel(e.late)), null, 16],
    ['Type', (e) => docType(e.document_type, e.original), null, 12],
    ['Document No.', (e) => e.document_no, null, 16],
    ['Description', (e) => e.description ?? '', null, 30],
    ['Original amount', (e) => num(e.original), 'money', 16],
    ['Remaining', (e) => num(e.remaining), 'money', 16],
    ...(marks ? [
      ['Promised by', (e) => (promiseOf(e) ? excelDate(promiseOf(e).promised_on) : null), 'date', 12],
      ['Promised amount', (e) => (promiseOf(e) ? num(promiseOf(e).amount) : null), 'money', 16],
      ['Promise status', (e) => (promiseOf(e) ? (PROMISE[promiseOf(e).status]?.label ?? promiseOf(e).status) : ''), null, 14],
      ['Note', (e) => noteText(notesOf(e)), null, 60],
    ] : []),
    ...(pending ? [
      ['In the app, not in BC', (e) => (pendList(e).length ? num(pendList(e).reduce((a, x) => a + Number(x.applied ?? 0), 0)) : null), 'money', 18],
      ['Receipts in the app', (e) => pendList(e).map((x) => `${x.ref} ${receiptKind(x)}${statusOf(x) ? ` (${statusOf(x).label})` : ''}${x.instructions ? `: ${x.instructions}` : ''}`).join('; '), null, 60],
    ] : []),
  ];
  const detail = [cols.map((c) => c[0]), ...entries.map((e) => cols.map((c) => c[1](e)))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, summary, { money: at(scols, 'money'), dates: at(scols, 'date'), widths: scols.map((c) => c[3]),
    filterFrom: 2, filterTo: summary.length - 2 }), 'Aging');
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, detail, { dates: at(cols, 'date'), money: at(cols, 'money'), widths: cols.map((c) => c[3]), filterFrom: 0, filterTo: detail.length - 1 }), 'Open entries');
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

// Customers and their credit terms, laid out like the credit terms file (No., Name, Customer Posting Group,
// Payment Terms Code, BANK Transfers) so it can be filled in and uploaded on BC customer files → Credit terms.
// Payment Terms Code is left blank: blank rows are skipped by the upload, so nothing changes until a code is typed.
export async function downloadNoTerms({ rows, terms, all = false }) {
  const XLSX = await import('xlsx');
  const why = (r) => {
    const t = terms[r.customer_no];
    if (!t) return 'No credit terms in the app';
    if (t.min_days == null) return `${t.terms}: no fixed days`;
    return t.terms;
  };
  const list = [
    ['No.', 'Name', 'Customer Posting Group', 'Payment Terms Code', 'BANK Transfers', all ? 'Credit terms in the app' : 'Why it is listed', 'BC payment terms',
      'Phone', 'City', 'Balance (LCY)', 'Overdue (LCY)', 'Last invoice', 'Last receipt'],
    ...rows.map((r) => [r.customer_no, r.name, r.group ?? '', '', '', why(r), r.terms ?? '', r.phone ?? '', r.city ?? '',
      num(r.balance), num(r.overdue), excelDate(r.last_invoice), excelDate(r.last_receipt)]),
  ];
  const how = [
    ['How to use this file'], [],
    ['1. Type the terms in Payment Terms Code, as in BC: e.g. 30DAYS, 30-40 DAYS, COD, COD/BT, 100%ADV, BILL TO BILL.'],
    ['2. For COD/BT, put the days for the bank transfer in BANK Transfers, e.g. "With in 3 days".'],
    ['3. Upload it on Customers → BC customer files → Credit terms (Finance Admins).'],
    ['Rows left blank are skipped, so customers you have not filled in keep what they have. The other columns are for reference and are ignored.'],
    [], [`${rows.length} customer${rows.length === 1 ? '' : 's'}, downloaded ${ddmmyyyy(todayISO())}.`],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, list, { dates: [11, 12], money: [9, 10], widths: [12, 38, 14, 20, 18, 34, 16, 16, 16, 16, 16, 12, 12], filterFrom: 0, filterTo: list.length - 1 }), 'Customers');
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, how, { widths: [110] }), 'How to use');
  XLSX.writeFile(wb, `${all ? 'Customers and credit terms' : 'Customers without a credit period'} ${todayISO()}.xlsx`);
}
