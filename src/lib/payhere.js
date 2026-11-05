// Reads PayHere exports (Payments or Payouts, .xlsx or .csv) in the browser.
// Columns are matched by their caption, so order and extra columns don't matter.

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Bank lines that finance matches, never Sales: HNB card batches and PayHere payouts.
export const FINANCE_ONLY = /MERCHANT SLIPS|PAYHERE/i;
export const isPayHereLine = (l) => /PAYHERE/i.test(l?.narration ?? '');
// The same rule on a bank_credits query.
export const skipFinanceOnly = (q) => q.not('narration', 'ilike', '%MERCHANT SLIPS%').not('narration', 'ilike', '%PAYHERE%');

const PAYMENT_COLUMNS = {
  payment_no: ['paymentno'],
  paid_at: ['date'],
  customer_name: ['customername'],
  email: ['customeremail'],
  phone: ['customerphone'],
  method: ['paymentmethod'],
  order_id: ['merchantorderid'],
  currency: ['currency'],
  gross: ['grossamountrs', 'grossamount'],
  converted: ['convertedgrossamountrs', 'convertedgrossamount'],
  fee: ['fee'],
  net: ['netamount'],
  status: ['paymentstatus'],
  payout_no: ['payoutno'],
  payout_ref: ['paymentref'],
};
const PAYOUT_COLUMNS = {
  payout_ref_id: ['id'],
  payout_no: ['payoutno'],
  payout_at: ['date'],
  amount: ['amountrs', 'amount'],
  bank_ref: ['bankreference'],
};

function findHeader(rows, columns, required) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = (rows[r] ?? []).map(norm);
    const map = {};
    for (const [key, names] of Object.entries(columns)) {
      const i = cells.findIndex((c) => names.includes(c));
      if (i >= 0) map[key] = i;
    }
    if (required.every((k) => map[k] !== undefined)) return { row: r, map };
  }
  return null;
}

const text = (v) => {
  if (v == null) return null;
  const s = (typeof v === 'number' && Number.isInteger(v) ? v.toFixed(0) : String(v)).trim();
  return s === '' ? null : s;
};
export const toNum = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
// "2026-10-28 17:30:17" as printed; an Excel date number becomes the same form.
const stamp = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 0) {
    const ms = Math.round((v - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
  const d = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (d) return `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')} ${(d[4] ?? '0').padStart(2, '0')}:${d[5] ?? '00'}:${d[6] ?? '00'}`;
  return null;
};
const r2 = (n) => Math.round(Number(n) * 100) / 100;

// → { kind: 'payments' | 'payouts', rows, summary, problems }
export async function readPayHere(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const all = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const problems = [];

  const ph = findHeader(all, PAYMENT_COLUMNS, ['payment_no', 'order_id', 'gross']);
  if (ph) {
    const c = (r, k) => (ph.map[k] === undefined ? null : r[ph.map[k]]);
    const rows = [];
    for (const r of all.slice(ph.row + 1)) {
      if (!r || r.every((v) => v == null || v === '')) continue;
      const no = text(c(r, 'payment_no'));
      if (!no) continue;
      const cur = text(c(r, 'currency'));
      const gross = cur && cur !== 'LKR' && toNum(c(r, 'converted')) != null ? toNum(c(r, 'converted')) : toNum(c(r, 'gross'));
      const fee = toNum(c(r, 'fee')) ?? 0;
      const net = toNum(c(r, 'net')) ?? (gross != null ? r2(gross - fee) : null);
      if (gross == null) { problems.push(`Payment ${no}: no amount`); continue; }
      rows.push({
        payment_no: no, paid_at: stamp(c(r, 'paid_at')), customer_name: text(c(r, 'customer_name')), email: text(c(r, 'email')),
        phone: text(c(r, 'phone')), method: text(c(r, 'method')), order_id: text(c(r, 'order_id')),
        gross: r2(gross), fee: r2(fee), net: r2(net), status: text(c(r, 'status')),
        payout_no: text(c(r, 'payout_no')), payout_ref: text(c(r, 'payout_ref')),
      });
    }
    const days = rows.map((x) => x.paid_at?.slice(0, 10)).filter(Boolean).sort();
    const status = {};
    for (const x of rows) status[x.status ?? 'no status'] = (status[x.status ?? 'no status'] ?? 0) + 1;
    return {
      kind: 'payments', rows, problems,
      summary: {
        count: rows.length, from: days[0] ?? null, to: days[days.length - 1] ?? null, status,
        payouts: new Set(rows.map((x) => x.payout_no).filter(Boolean)).size,
        gross: r2(rows.reduce((a, x) => a + x.gross, 0)), fee: r2(rows.reduce((a, x) => a + x.fee, 0)), net: r2(rows.reduce((a, x) => a + x.net, 0)),
      },
    };
  }

  const oh = findHeader(all, PAYOUT_COLUMNS, ['payout_no', 'amount', 'bank_ref']);
  if (oh) {
    const c = (r, k) => (oh.map[k] === undefined ? null : r[oh.map[k]]);
    const rows = [];
    for (const r of all.slice(oh.row + 1)) {
      if (!r || r.every((v) => v == null || v === '')) continue;
      const no = text(c(r, 'payout_no'));
      if (!no) continue;
      const amount = toNum(c(r, 'amount'));
      if (amount == null) { problems.push(`Payout ${no}: no amount`); continue; }
      rows.push({ payout_ref_id: text(c(r, 'payout_ref_id')), payout_no: no, payout_at: stamp(c(r, 'payout_at')), amount: r2(amount), bank_ref: text(c(r, 'bank_ref')) });
    }
    const days = rows.map((x) => x.payout_at?.slice(0, 10)).filter(Boolean).sort();
    return {
      kind: 'payouts', rows, problems,
      summary: { count: rows.length, from: days[0] ?? null, to: days[days.length - 1] ?? null, net: r2(rows.reduce((a, x) => a + x.amount, 0)) },
    };
  }
  throw new Error(`${file.name} isn't a PayHere Payments or Payouts export (no "Payment No" / "Merchant Order ID" or "PayOut No" / "Bank Reference" columns).`);
}
