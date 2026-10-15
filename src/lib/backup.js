// Data backup: every receipt and its settlement, and everything around them, as one Excel workbook.
import { db, rpc, IS_DEMO } from './supabase';
import { fetchAll } from './bcimport';

const KIND = { cheque: 'Cheque', transfer: 'Transfer', card: 'Card', cash: 'Cash' };
const BC = { exported: 'Exported, not yet posted', posted: 'Posted', posted_diff: 'Posted with differences' };
const ccRef = (id) => (id == null ? null : `CC-${String(id).padStart(5, '0')}`);
const chRef = (id) => (id == null ? null : `CH-${String(id).padStart(5, '0')}`);
const pad = (n) => String(n).padStart(2, '0');
const day = (v) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : null);
const stamp = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const num = (v) => (v == null || v === '' ? null : Number(v));
// Excel holds at most 32,767 characters in a cell.
const cell = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'string' && v.length > 32000) return `${v.slice(0, 32000)}… (cut)`;
  return v;
};

// Read a whole table (in pages). A table that can't be read is reported, not fatal.
async function read(table, order = 'id') {
  try { return { rows: await fetchAll(() => db.from(table).select('*').order(order)) }; }
  catch (e) { return { rows: [], error: e.message }; }
}

export async function takeBackup(progress = () => {}) {
  const XLSX = await import('xlsx');
  const step = async (label, fn) => { progress(`Reading ${label}…`); return fn(); };

  const people = await step('people', () => read('profiles'));
  const name = (id) => { const p = people.rows.find((x) => x.id === id); return p ? p.full_name || p.email : id ?? null; };
  const accounts = await step('bank accounts', () => read('bank_accounts'));
  const acctName = (id) => accounts.rows.find((a) => a.id === id)?.name ?? id ?? null;

  const col = await step('receipts', () => read('collections'));
  const parked = await step('parked payments', () => rpc('cc_backup_parked').catch((e) => ({ collections: [], events: [], error: e.message })));
  const seen = new Set(col.rows.map((c) => c.id));
  const receipts = [...col.rows, ...(parked.collections ?? []).filter((c) => !seen.has(c.id))].sort((a, b) => a.id - b.id);

  const cheques = await step('cheques', () => read('cheques'));
  const splits = await step('cheque splits', () => read('cheque_allocations'));
  const deposits = await step('deposit slips', () => read('deposits'));
  const handovers = await step('cash handovers', () => read('cash_handovers'));
  const bankings = await step('cash banked', () => read('cash_bankings'));
  const bankItems = await step('cash banked lines', () => read('cash_banking_items', 'banking_id'));
  const docs = await step('BC documents', () => read('bc_docs'));
  const docLines = await step('BC document lines', () => read('bc_doc_lines'));
  const events = await step('history', () => read('events'));
  const lines = await step('bank lines', () => read('statement_lines'));
  const batches = await step('merchant batches', () => read('merchant_batches'));
  const drafts = await step('merchant sales', () => read('merchant_drafts'));
  const evSeen = new Set(events.rows.map((e) => e.id));
  const history = [...events.rows, ...(parked.events ?? []).filter((e) => !evSeen.has(e.id))].sort((a, b) => a.id - b.id);

  progress('Building the workbook…');
  // BC documents per receipt (through its journal lines, or as a cash receipt).
  const docById = new Map(docs.rows.map((d) => [d.id, d]));
  const docsOf = new Map();
  const addDoc = (cid, d) => { if (cid == null || !d) return; const s = docsOf.get(cid) ?? new Map(); s.set(d.id, d); docsOf.set(cid, s); };
  for (const l of docLines.rows) addDoc(l.collection_id, docById.get(l.doc_id));
  for (const d of docs.rows) addDoc(d.cash_collection_id, d);
  const docText = (cid) => [...(docsOf.get(cid)?.values() ?? [])].map((d) => d.doc_no).join(', ') || null;
  const docStatus = (cid) => [...(docsOf.get(cid)?.values() ?? [])].map((d) => (d.accepted_at ? 'Posted (accepted)' : BC[d.post_status] ?? d.post_status)).join(', ') || null;
  const lineById = new Map(lines.rows.map((l) => [l.id, l]));
  const chequesOf = (cid) => cheques.rows.filter((q) => q.collection_id === cid);

  const sheets = [];
  const add = (title, head, rows, note) => sheets.push({ title, head, rows, note });
  const raw = (title, t, extra = {}) => {
    const keys = t.rows.length ? Object.keys(t.rows[0]) : [];
    const ex = Object.entries(extra);
    add(title, [...ex.map(([k]) => k), ...keys], t.rows.map((r) => [...ex.map(([, f]) => f(r)), ...keys.map((k) => cell(r[k]))]), t.error);
  };

  add('Receipts', ['CC no', 'Kind', 'Status', 'Customer no', 'Customer', 'Expected LKR', 'Received LKR', 'Invoices', 'Settlement instructions',
    'Recorded', 'Recorded by', 'Driver', 'Collection date', 'Collected', 'Received by finance', 'Received by', 'Cheques', 'Deposit slip',
    'Paid into', 'Bank date', 'Bank narration', 'Bank ref', 'Pay method', 'Card date', 'Card last 4', 'Cash handover', 'CSHRC', 'Banked LKR',
    'BC document', 'BC status', 'Closed', 'Closed by', 'Cancelled', 'Cancel reason', 'Returned', 'Return reason', 'Rejected', 'Rejected note',
    'Replaces', 'Notes', 'Driver instructions', 'Contact', 'Phone', 'Address', 'Receipt files', 'No receipt reason'],
  receipts.map((c) => {
    const l = c.line_id ? lineById.get(c.line_id) : null;
    const qs = chequesOf(c.id);
    return [ccRef(c.id), KIND[c.kind] ?? c.kind, c.status, c.customer_no, c.customer_name, num(c.expected_amount), num(c.collected_amount),
      c.invoice_refs, c.settlement_instructions, stamp(c.created_at), name(c.created_by), c.driver_id ? name(c.driver_id) : null,
      day(c.collection_date), stamp(c.collected_at), stamp(c.received_at), c.received_by ? name(c.received_by) : null,
      qs.map((q) => `${q.cheque_no ?? '?'} (${q.bank ?? 'bank?'}) ${Number(q.amount).toFixed(2)}`).join('; ') || null,
      c.deposit_id ? `D-${c.deposit_id}` : null, c.account_id ? acctName(c.account_id) : l ? acctName(l.account_id) : null,
      day(l?.txn_date), l?.narration ?? null, l?.reference ?? null, c.kind === 'transfer' ? c.pay_method : null,
      day(c.card_date), c.card_last4, chRef(c.handover_id), c.cshrc_no, c.kind === 'cash' ? num(c.banked_amount) : null,
      docText(c.id), docStatus(c.id), stamp(c.closed_at), c.closed_by ? name(c.closed_by) : null, stamp(c.cancelled_at), c.cancel_reason,
      stamp(c.returned_at), c.return_reason, stamp(c.rejected_at), c.reject_note, ccRef(c.replaces_id), c.notes, c.instructions,
      c.contact_person, c.contact_phone, c.location_text,
      [c.receipt_path, ...(c.receipt_more ?? [])].filter(Boolean).length || null, c.no_receipt_reason].map(cell);
  }));

  add('Settlement', ['CC no', 'Kind', 'Status', 'Customer no', 'Customer', 'Receipt LKR', 'Document no', 'Document type', 'Posting date', 'Due date',
    'External doc no', 'Currency', 'Open amount when chosen', 'Settlement instructions', 'Recorded'],
  receipts.flatMap((c) => {
    const s = Array.isArray(c.settlement) ? c.settlement : [];
    const base = [ccRef(c.id), KIND[c.kind] ?? c.kind, c.status, c.customer_no, c.customer_name, num(c.collected_amount ?? c.expected_amount)];
    if (!s.length) return [[...base, null, null, null, null, null, null, null, c.settlement_instructions, stamp(c.created_at)].map(cell)];
    return s.map((x) => [...base, x.document_no, x.document_type, day(x.posting_date), day(x.due_date), x.external_document_no, x.currency_code,
      num(x.remaining_amount), c.settlement_instructions, stamp(c.created_at)].map(cell));
  }));

  const chequeById = new Map(cheques.rows.map((q) => [q.id, q]));
  raw('Cheques', cheques, { 'CC no': (q) => ccRef(q.collection_id) });
  raw('Cheque splits', splits, { 'CC no': (a) => ccRef(chequeById.get(a.cheque_id)?.collection_id), 'Cheque no': (a) => chequeById.get(a.cheque_id)?.cheque_no ?? null });
  raw('Deposit slips', deposits, { Slip: (d) => `D-${d.id}`, Account: (d) => acctName(d.account_id), 'Recorded by': (d) => name(d.created_by) });
  raw('Cash handovers', handovers, { Handover: (h) => chRef(h.id), 'Recorded by': (h) => name(h.created_by), 'Received by': (h) => (h.received_by ? name(h.received_by) : null) });
  const bankingById = new Map(bankings.rows.map((b) => [b.id, b]));
  raw('Cash banked', bankItems, { 'CC no': (i) => ccRef(i.collection_id), 'Bank date': (i) => day(lineById.get(bankingById.get(i.banking_id)?.line_id)?.txn_date) });
  raw('BC documents', docs, { Account: (d) => (d.account_id ? acctName(d.account_id) : null) });
  raw('BC document lines', docLines, { 'Document no': (l) => docById.get(l.doc_id)?.doc_no ?? null, 'CC no': (l) => ccRef(l.collection_id) });
  add('History', ['CC no', 'When', 'Who', 'What', 'Note', 'id', 'collection_id', 'actor', 'created_at'],
    history.map((e) => [ccRef(e.collection_id), stamp(e.created_at), e.actor ? name(e.actor) : null, e.action, e.note, e.id, e.collection_id, e.actor, e.created_at].map(cell)),
    events.error);
  raw('Bank lines', lines, { Account: (l) => acctName(l.account_id) });
  raw('Bank accounts', accounts);
  raw('Merchant batches', batches);
  raw('Merchant sales', drafts, { 'CC no': (d) => ccRef(d.collection_id) });
  const allKeys = receipts.length ? [...new Set(receipts.flatMap((r) => Object.keys(r)))] : [];
  add('Receipts (all fields)', allKeys, receipts.map((r) => allKeys.map((k) => cell(r[k]))), col.error);

  const now = new Date();
  const file = `AR Collections backup ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${IS_DEMO ? ' (DEMO)' : ''}.xlsx`;
  const counts = Object.fromEntries(sheets.map((s) => [s.title, s.rows.length]));
  const problems = sheets.filter((s) => s.note).map((s) => `${s.title}: ${s.note}`);
  if (parked.error) problems.push(`Parked payments: ${parked.error}`);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['AR Collections data backup'], ['Section', IS_DEMO ? 'Demo' : 'Live'], ['Taken', stamp(now.toISOString())], [],
    ['Sheet', 'Rows'], ...sheets.map((s) => [s.title, s.rows.length]), [],
    ...(problems.length ? [['Could not read'], ...problems.map((p) => [p])] : [['Everything was read.']]),
    [], ['Photos, receipts and slips are not in this file: back them up from Photo storage.'],
  ]), 'Summary');
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.head, ...s.rows]);
    ws['!cols'] = s.head.map((h) => ({ wch: Math.min(40, Math.max(10, String(h).length + 2)) }));
    if (s.rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: s.rows.length, c: s.head.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, s.title.slice(0, 31));
  }
  XLSX.writeFile(wb, file);
  return { file, counts, problems };
}
