// Reads bank statement Excel files. Every bank lays its file out differently,
// so each account stores a "mapping": which header names hold the date,
// narration, debit, credit, balance and reference. The header row is found by
// looking for those names, so title blocks above it and footers below it are ignored.

export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export async function readRows(file) {
  const XLSX = await import('xlsx');
  // raw: text files (CSV, and HTML pages saved as .xls like Sampath's) keep their cells exactly as
  // printed, so 01/09/2026 stays 1 September instead of being read the American way (9 January).
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}

// ---------- values ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => {
  const Y = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  const M = Number(m), D = Number(d);
  if (!(M >= 1 && M <= 12 && D >= 1 && D <= 31 && Y > 1990 && Y < 2100)) return null;
  return `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
};

export function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null; // not an Excel date serial
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);            // 2026-09-01
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);           // 01/09/2026 (day first, Sri Lanka)
  if (m) return iso(m[3], m[2], m[1]);
  m = s.match(/^(\d{1,2})[-\s/.]([A-Za-z]{3,4})[-\s/.,]*(\d{2,4})\b/); // 28-Sep-2026, 28 Sep 2026
  if (m && MONTHS[m[2].toLowerCase()]) return iso(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  return null;
}

// "12,023.15" → 12023.15, "-" → 0, "1,303,641.35CR" → 1303641.35, "500.00 DR" → -500, "(25.00)" → -25
export function parseAmount(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/lkr|rs\.?/gi, '').replace(/,/g, '').trim();
  if (s === '' || s === '-' || s === '--') return null;
  let sign = 1;
  if (/dr$/i.test(s)) { sign = -1; s = s.replace(/dr$/i, ''); }
  else if (/cr$/i.test(s)) s = s.replace(/cr$/i, '');
  if (/^\(.*\)$/.test(s)) { sign = -sign; s = s.slice(1, -1); }
  const n = Number(s.trim());
  return Number.isFinite(n) ? sign * n : null;
}

// ---------- header detection & mapping suggestions ----------
const HINTS = {
  date: [/^(txn|transaction|trade|posting|tran|post)\.? ?date$/, /^date$/, /date/],
  narration: [/description|particulars|narrative|narration|details|remarks/],
  debit: [/debit|withdrawal|dr amount/],
  credit: [/credit|deposit|cr amount/],
  amount: [/^amount$/, /^amount \(/],
  balance: [/^balance/, /running balance/, /balance/],
  reference: [/^ref ?no\.?$/, /transaction reference/, /^reference$/, /^tran(saction)? ?id$/, /ref/],
  cheque: [/cheque|chq/],
  direction: [/^cr ?\/ ?dr$/, /^dr ?\/ ?cr$/, /^c ?\/ ?d$/, /^d ?\/ ?c$/, /^(debit|credit) ?\/ ?(credit|debit)$/],
};

function scoreRow(cells) {
  const c = cells.map(norm).filter(Boolean);
  if (c.length < 3) return 0;
  let s = 0;
  if (c.some((x) => /date/.test(x))) s += 2;
  if (c.some((x) => HINTS.narration[0].test(x))) s += 2;
  if (c.some((x) => /credit|debit|amount/.test(x))) s += 2;
  if (c.some((x) => /balance/.test(x))) s += 1;
  return s;
}

export function findHeaderRow(rows) {
  let best = -1, bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const sc = scoreRow(rows[i] ?? []);
    if (sc > bestScore) { best = i; bestScore = sc; }
  }
  return bestScore >= 5 ? best : -1;
}

export const headerCells = (rows, i) =>
  (rows[i] ?? []).map((v, idx) => ({ idx, text: String(v ?? '').replace(/\s+/g, ' ').trim() })).filter((c) => c.text);

export function suggestMapping(cells) {
  const used = new Set();
  const pick = (key, avoid = []) => {
    for (const re of HINTS[key]) {
      const hit = cells.find((c) => !used.has(c.idx) && re.test(norm(c.text)) && !avoid.some((a) => a.test(norm(c.text))));
      if (hit) { used.add(hit.idx); return hit.text; }
    }
    return null;
  };
  const m = {};
  m.date = pick('date', [/value|effective/]);
  m.debit = pick('debit');
  m.credit = pick('credit');
  m.amount = m.debit || m.credit ? null : pick('amount');
  m.direction = m.amount ? pick('direction') : null;
  m.balance = pick('balance', [/opening|available|calc/]);
  m.cheque = pick('cheque');
  m.reference = pick('reference', [/other/]);
  const narr = cells.filter((c) => !used.has(c.idx) && (HINTS.narration[0].test(norm(c.text)) || norm(c.text) === 'transaction type'));
  m.narration = narr.map((c) => c.text);
  return m;
}

// ---------- known bank layouts ----------
// A layout fixes the columns for every account of that bank, so a new account needs no column setup.
const DFCC_MAPPING = {
  format: 'dfcc', date: 'Transaction Date', credit: 'Credit', debit: 'Debit', balance: 'Running Balance',
  reference: 'Transaction Reference', cheque: 'Reference/Cheque No.', narration: ['Transaction Type', 'Other Reference', 'Narrative'],
};
export const FORMATS = {
  dfcc: {
    label: 'DFCC Bank "Statement by period"',
    mapping: DFCC_MAPPING,
    detect: (cells) => ['transaction date', 'transaction type', 'running balance', 'reference/cheque no.', 'narrative'].every((h) => cells.includes(h)),
    forBank: (text) => /\bdfcc\b/i.test(text ?? ''),
  },
};

// The layout a file is in (by its header row), or null.
export function detectFormat(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cells = (rows[i] ?? []).map(norm);
    for (const [key, f] of Object.entries(FORMATS)) if (f.detect(cells)) return key;
  }
  return null;
}
// The layout every account of a bank uses (from the bank's name or BC code), or null.
export const formatForBank = (...texts) => Object.keys(FORMATS).find((k) => texts.some((t) => FORMATS[k].forBank(t))) ?? null;
export const mappingFor = (format) => (FORMATS[format] ? { ...FORMATS[format].mapping } : null);

// The account number printed above the table ("Account No: 101001182286-LKR"), digits only, or null.
export function statementAccountNo(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const r = rows[i] ?? [];
    const at = r.findIndex((v) => /^\s*a\/?c(count)?\.?\s*(no|number|num)\.?\s*:?\s*$/i.test(String(v ?? '')));
    if (at < 0) continue;
    const val = r.slice(at + 1).find((v) => /\d{5,}/.test(String(v ?? '')));
    if (val) return String(val).match(/\d[\d\s-]*\d/)[0].replace(/\D/g, '');
  }
  return null;
}
const digits = (s) => String(s ?? '').replace(/\D/g, '');
// Does the file's account number belong to this account? null when the file doesn't say.
export function sameAccount(fileNo, accountNo) {
  const a = digits(fileNo), b = digits(accountNo);
  if (!a || !b) return null;
  return a.includes(b) || b.includes(a);
}

// DFCC fills empty parts of its text columns with " - ": "-  - 20261001 -" → "20261001".
const dfccText = (s) => String(s ?? '').split(/\s+/).filter((w) => w && w !== '-').join(' ');
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- parsing with a saved mapping ----------
function locate(rows, mapping) {
  const want = [mapping.date, ...(mapping.credit ? [mapping.credit] : []), ...(mapping.amount ? [mapping.amount] : [])].map(norm);
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const cells = (rows[i] ?? []).map(norm);
    if (want.every((w) => cells.includes(w))) {
      const col = (name) => (name ? cells.indexOf(norm(name)) : -1);
      return {
        row: i,
        date: col(mapping.date), debit: col(mapping.debit), credit: col(mapping.credit), amount: col(mapping.amount),
        balance: col(mapping.balance), reference: col(mapping.reference), cheque: col(mapping.cheque), direction: col(mapping.direction),
        narration: (mapping.narration ?? []).map(col).filter((x) => x >= 0),
      };
    }
  }
  return null;
}

// Some banks wrap text in apostrophes ('187655/007162086/ACH/...'); drop them.
const text = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().replace(/^['"]+|['"]+$/g, '').trim());
// Cheque number at the start of a clearing description: 187655/007162086/ACH/31-08-2026, 1154/007278134/TFRO/...
const chequeFromNarration = (s) => { const m = String(s).match(/(?:^|\|\s*)0*(\d{3,})\/\d{5,}\/[A-Z]{2,}\//); return m ? m[1] : ''; };
const dash = (s) => (s === '-' || s === '--' ? '' : s);

export function parseStatement(rows, mapping) {
  if (!mapping?.date || !(mapping.credit || mapping.amount)) {
    throw new Error('This account has no column setup yet. Set up its columns first.');
  }
  const at = locate(rows, mapping);
  if (!at) {
    throw new Error(`Couldn't find the columns “${mapping.date}” and “${mapping.credit || mapping.amount}” in this file. ` +
      'Check it is a statement for this account, or redo the column setup if the bank changed its layout.');
  }
  const out = [];
  let skipped = 0;
  for (const r of rows.slice(at.row + 1)) {
    if (!r) continue;
    const d = parseDate(r[at.date]);
    if (!d) { if (r.some((v) => text(v))) skipped++; continue; }
    let debit = 0, credit = 0;
    if (at.amount >= 0) {
      const a = parseAmount(r[at.amount]) ?? 0;
      const dir = at.direction >= 0 ? text(r[at.direction]).toUpperCase() : '';
      if (dir.startsWith('D')) debit = Math.abs(a);          // Cr/Dr column says which way
      else if (dir.startsWith('C')) credit = Math.abs(a);
      else if (a >= 0) credit = a; else debit = -a;          // otherwise the sign does
    } else {
      debit = Math.abs(parseAmount(r[at.debit]) ?? 0);
      credit = Math.abs(parseAmount(r[at.credit]) ?? 0);
    }
    if (!debit && !credit) { skipped++; continue; }
    let narration, chequeNo;
    if (mapping.format === 'dfcc') {
      // drop parts that only repeat an earlier one ("OCEANPICK xPRIVATEx LIMITED N/A" and "…LIMITED|N/A")
      const parts = [];
      for (const p of at.narration.map((i) => dfccText(text(r[i])))) {
        if (p && !parts.some((q) => squash(q).includes(squash(p)) || squash(p).includes(squash(q)))) parts.push(p);
      }
      narration = parts.join(' | ');
      const c = at.cheque >= 0 ? text(r[at.cheque]) : '';
      chequeNo = /^\d{4,10}$/.test(c) ? c : '';        // the column also holds transfer references (FT…)
    } else {
      narration = at.narration.map((i) => dash(text(r[i]))).filter(Boolean).join(' | ');
      chequeNo = (at.cheque >= 0 ? dash(text(r[at.cheque])) : '') || chequeFromNarration(narration);
    }
    out.push({
      txn_date: d,
      narration,
      reference: at.reference >= 0 ? dash(text(r[at.reference])) : '',
      cheque_no: chequeNo,
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      balance: at.balance >= 0 ? parseAmount(r[at.balance]) : null,
    });
  }
  if (!out.length) throw new Error('No transaction lines were found under the header row.');
  const dates = out.map((l) => l.txn_date).sort();
  return { lines: out, skipped, from: dates[0], to: dates[dates.length - 1] };
}
