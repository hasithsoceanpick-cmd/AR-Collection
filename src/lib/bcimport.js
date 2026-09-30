// Reads Business Central "Open in Excel" exports (or CSV) in the browser.
// Columns are matched by their BC caption, so column order doesn't matter
// and extra columns are ignored.

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const CUSTOMER_COLUMNS = {
  customer_no: ['no', 'customerno'],
  name: ['name', 'customername'],
  address: ['address'],
  address2: ['address2'],
  city: ['city'],
  phone: ['phoneno', 'phone', 'mobilephoneno'],
  contact: ['contact', 'contactname'],
  customer_group: ['customerpostinggroup'],
  payment_terms: ['paymenttermscode'],
  currency_code: ['currencycode'],
};
const CUSTOMER_REQUIRED = { customer_no: 'No.', name: 'Name' };

const LEDGER_COLUMNS = {
  entry_no: ['entryno'],
  customer_no: ['customerno'],
  posting_date: ['postingdate'],
  document_type: ['documenttype'],
  document_no: ['documentno'],
  external_document_no: ['externaldocumentno'],
  description: ['description'],
  due_date: ['duedate'],
  currency_code: ['currencycode'],
  original_amount: ['originalamtlcy', 'originalamountlcy', 'originalamount'],
  remaining_lcy: ['remainingamtlcy', 'remainingamountlcy'],
  remaining: ['remainingamount'],
  open: ['open'],
};
const LEDGER_REQUIRED = { customer_no: 'Customer No.', document_no: 'Document No.' };

async function readSheet(file) {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' }); // dates stay as Excel serial numbers
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}

// Find the header row (BC puts it on row 1, but allow a title above it).
function mapHeader(rows, columns, required) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = (rows[r] ?? []).map(norm);
    const map = {};
    for (const [key, names] of Object.entries(columns)) {
      const i = cells.findIndex((c) => names.includes(c));
      if (i >= 0) map[key] = i;
    }
    if (Object.keys(required).every((k) => map[k] !== undefined)) return { row: r, map };
  }
  return null;
}

function toISODate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 0) {
    // Excel serial day number → calendar date, done in UTC so the time zone can't shift it.
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  }
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // dd/mm/yyyy (Sri Lanka)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : null;
}

const toText = (v) => (v == null ? '' : String(v).trim());
const isTrue = (v) => v === true || ['true', 'yes', '1'].includes(String(v).trim().toLowerCase());

function missingMessage(kind, required) {
  const names = Object.values(required).map((n) => `“${n}”`).join(' and ');
  return `This doesn't look like a ${kind} export: couldn't find the ${names} columns. ` +
    'Export it from Business Central with Share → Open in Excel and upload that file unchanged.';
}

export async function parseCustomers(file) {
  const rows = await readSheet(file);
  const h = mapHeader(rows, CUSTOMER_COLUMNS, CUSTOMER_REQUIRED);
  if (!h) throw new Error(missingMessage('customer list', CUSTOMER_REQUIRED));
  const get = (row, k) => (h.map[k] === undefined ? null : row[h.map[k]]);
  const out = [];
  for (const row of rows.slice(h.row + 1)) {
    const no = toText(get(row, 'customer_no'));
    if (!no) continue;
    out.push({
      customer_no: no,
      name: toText(get(row, 'name')) || no,
      address: [toText(get(row, 'address')), toText(get(row, 'address2'))].filter(Boolean).join(', '),
      city: toText(get(row, 'city')),
      phone: toText(get(row, 'phone')),
      contact: toText(get(row, 'contact')),
      customer_group: toText(get(row, 'customer_group')),
      payment_terms: toText(get(row, 'payment_terms')),
      currency_code: toText(get(row, 'currency_code')),
    });
  }
  if (!out.length) throw new Error('The file has the right columns but no customers in it.');
  return out;
}

export async function parseLedger(file) {
  const rows = await readSheet(file);
  const h = mapHeader(rows, LEDGER_COLUMNS, LEDGER_REQUIRED);
  if (!h) throw new Error(missingMessage('customer ledger entries', LEDGER_REQUIRED));
  if (h.map.remaining_lcy === undefined && h.map.remaining === undefined) {
    throw new Error('Couldn\'t find the “Remaining Amount” column. In Business Central, add it with Personalize, then export again.');
  }
  const useLcy = h.map.remaining_lcy !== undefined;
  const get = (row, k) => (h.map[k] === undefined ? null : row[h.map[k]]);
  const out = [];
  let skippedClosed = 0;
  for (const row of rows.slice(h.row + 1)) {
    const customer = toText(get(row, 'customer_no'));
    const doc = toText(get(row, 'document_no'));
    if (!customer || !doc) continue;
    const remaining = toNumber(get(row, useLcy ? 'remaining_lcy' : 'remaining'));
    const open = h.map.open === undefined ? true : isTrue(get(row, 'open'));
    if (!open || !remaining) { skippedClosed++; continue; }
    out.push({
      entry_no: toNumber(get(row, 'entry_no')),
      customer_no: customer,
      posting_date: toISODate(get(row, 'posting_date')),
      document_type: toText(get(row, 'document_type')),
      document_no: doc,
      external_document_no: toText(get(row, 'external_document_no')),
      description: toText(get(row, 'description')),
      due_date: toISODate(get(row, 'due_date')),
      currency_code: useLcy ? '' : toText(get(row, 'currency_code')),
      original_amount: toNumber(get(row, 'original_amount')),
      remaining_amount: remaining,
    });
  }
  return { rows: out, skippedClosed, customers: new Set(out.map((r) => r.customer_no)).size,
    hasOriginal: h.map.original_amount !== undefined };
}

// Supabase returns at most 1,000 rows per request; page through larger tables.
export async function fetchAll(query) {
  const size = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await query().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    all.push(...data);
    if (data.length < size) return all;
    from += size;
  }
}
