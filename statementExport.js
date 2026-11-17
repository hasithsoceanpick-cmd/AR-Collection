// Bank statements as Excel: the bank's own columns in the bank's order with the
// running balance, plus what each line is in the app and in Business Central.
import { db, rpc } from './supabase';
import { fetchAll } from './bcimport';
import { orderStatement } from './statementOrder';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m) => (m === 'all' ? 'whole statement' : `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`);
const shortMonth = (m) => (m === 'all' ? 'All' : `${MONTHS[Number(m.slice(5, 7)) - 1].slice(0, 3)} ${m.slice(0, 4)}`);

const HEAD = ['Txn Date', 'Description / Particulars', 'Ref No', 'Cheque No', 'Debit', 'Credit', 'Balance',
  'Status', 'Customer', 'Invoice(s)', 'In the app', 'BC document', 'BC status', 'Reference'];
const MONEY = [4, 5, 6];
const WIDTHS = [11, 48, 16, 11, 14, 14, 16, 22, 30, 24, 24, 17, 22, 60];

// One account: every line, in the bank's order, with its running balance and references.
export async function statementData(account) {
  const [lines, refs] = await Promise.all([
    fetchAll(() => db.from('statement_lines').select('id, txn_date, narration, reference, cheque_no, debit, credit, balance')
      .eq('account_id', account.id).order('txn_date').order('id')),
    rpc('cc_statement_refs', { p_account_id: account.id }),
  ]);
  const byId = new Map((refs ?? []).map((r) => [r.id, r]));
  return orderStatement(lines, account.opening_balance).map((l) => {
    const r = byId.get(l.id) ?? {};
    return { ...l, status: r.status, customers: r.customers, invoices: r.invoices, app_ref: r.app_ref,
      bc_doc: r.bc_doc, bc_status: r.bc_status, book_ref: r.reference };
  });
}

// Excel date serial for a yyyy-mm-dd date: exact, whatever the computer's time zone.
const excelDate = (iso) => (Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - Date.UTC(1899, 11, 30)) / 86400000;
const txt = (v) => (v == null || v === '' ? null : String(v));

function sheetFor(XLSX, account, ordered, month) {
  const inPeriod = (l) => month === 'all' || l.txn_date.slice(0, 7) === month;
  const shown = ordered.filter(inPeriod);
  const before = month === 'all' ? [] : ordered.filter((l) => l.txn_date.slice(0, 7) < month);
  const opening = before.length ? before[before.length - 1].running : account.opening_balance != null ? Number(account.opening_balance) : null;
  const closing = shown.length ? shown[shown.length - 1].running : opening;
  const n = (v) => (v == null || v === '' ? null : Number(v));
  const rows = [
    HEAD,
    [null, month === 'all' ? 'Opening balance' : `Opening balance (${monthName(month)})`, null, null, null, null, opening],
    ...shown.map((l) => [
      excelDate(l.txn_date), txt(l.narration), txt(l.reference), txt(l.cheque_no),
      Number(l.debit) > 0 ? Number(l.debit) : null, Number(l.credit) > 0 ? Number(l.credit) : null, n(l.running),
      txt(l.status), txt(l.customers), txt(l.invoices), txt(l.app_ref), txt(l.bc_doc), txt(l.bc_status), txt(l.book_ref),
    ]),
    [null, `Totals: ${shown.length} line${shown.length === 1 ? '' : 's'}`, null, null,
      shown.reduce((a, l) => a + Number(l.debit), 0), shown.reduce((a, l) => a + Number(l.credit), 0), closing],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  for (let r = 1; r < rows.length; r += 1) {
    const d = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (d && d.t === 'n') d.z = 'dd/mm/yyyy';
    for (const c of MONEY) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.t === 'n') cell.z = '#,##0.00'; }
  }
  ws['!cols'] = WIDTHS.map((wch) => ({ wch }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 2, c: HEAD.length - 1 } }) };
  return ws;
}

// Excel sheet names: at most 31 characters, none of : \ / ? * [ ]
const sheetName = (s) => s.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);

// Download one workbook: a sheet per account for the month ('YYYY-MM', or 'all' for every line held).
// `data` (optional) = account id → statementData rows already loaded.
export async function downloadStatements(accounts, month, data = {}) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const a of accounts) {
    const ordered = data[a.id] ?? await statementData(a);
    let name = sheetName(month === 'all' ? a.name : `${a.name} - ${shortMonth(month).slice(0, 3)}`);
    for (let i = 2; used.has(name); i += 1) name = sheetName(`${name.slice(0, 28)} ${i}`);
    used.add(name);
    XLSX.utils.book_append_sheet(wb, sheetFor(XLSX, a, ordered, month), name);
  }
  const file = accounts.length === 1
    ? `${accounts[0].name} statement ${month === 'all' ? '(whole statement)' : monthName(month)}.xlsx`
    : `Bank Statements with References - ${shortMonth(month)}.xlsx`;
  XLSX.writeFile(wb, file.replace(/[\\/:*?"<>|]/g, ' '));
}
