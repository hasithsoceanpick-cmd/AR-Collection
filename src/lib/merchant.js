// Reads an HNB merchant statement from the text the OCR engine returns.
// The reading is never trusted blindly: each draft must satisfy
//   commission = rate × amount   and   net = amount − commission,
// each batch's drafts must add up to the printed "Processing Dt. Ttl", and
// finance confirms the statement's count and total against its footer.

export const COMMISSION_RATE = 0.03;

// Characters OCR commonly confuses with digits, inside a number.
const DIGIT_LIKE = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', Z: '2', z: '2', A: '4', S: '5', s: '5', $: '5', '§': '5', G: '6', b: '6', T: '7', B: '8', '%': '8', g: '9', q: '9' };
const toDigits = (s) => String(s).split('').map((ch) => DIGIT_LIKE[ch] ?? ch).join('');
const r2 = (n) => Math.round(Number(n) * 100) / 100;

// "2,000.00" "6.712.40" "7459.30" "21.752.25CR" "TAS9.30" → number (the last separator before 2 digits is the decimal point)
export function readAmount(token) {
  if (token == null) return null;
  let s = toDigits(String(token).replace(/CR$|DR$/i, '').replace(/\s+/g, ''));
  s = s.replace(/[^0-9.,]/g, '');
  const m = s.match(/^(.*?)[.,](\d{2})$/);
  if (!m) return /^\d+$/.test(s) ? Number(s) : null;
  const whole = m[1].replace(/[.,]/g, '');
  if (!/^\d+$/.test(whole)) return null;
  return Number(`${whole}.${m[2]}`);
}

// dd/mm/yyyy with OCR noise ("16082026", "18,08'2026", "22°08'2026")
export function readDate(token) {
  const d = toDigits(String(token)).replace(/[^0-9]/g, '');
  if (d.length !== 8) return null;
  const dd = d.slice(0, 2), mm = d.slice(2, 4), yyyy = d.slice(4);
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31 || +yyyy < 2020 || +yyyy > 2100) return null;
  return `${yyyy}-${mm}-${dd}`;
}

const DATE_RE = /(\d[\d\s/.,:;'°"-]{3,12}\d{4})/;
const AMOUNT_TOKEN = /[0-9OoDQIl|iZzASs$§GbTBgq][0-9OoDQIl|iZzASs$§GbTBgq.,]*[.,][0-9OoDQIl|iZzASs$§GbTBgq]{2}(?:CR|DR)?/g;

// Card "469176******9368", "469176 *****936%", "486296°*****061 1" → { first6, last4 }
function readCard(s) {
  const t = String(s);
  const first = toDigits(t).match(/(\d{6})/);
  const afterMask = t.slice(t.search(/[*°"]/) >= 0 ? t.search(/[*°"]/) : t.length).replace(/[*°"'`\s]/g, '');
  const last = toDigits(afterMask).replace(/[^0-9]/g, '').slice(-4);
  return { first6: first ? first[1] : '', last4: last.length === 4 ? last : '' };
}

// One screenshot's text → the rows it shows, in order:
//   { t: 'asat', date } | { t: 'pres', date } | { t: 'total', amount } | { t: 'draft', ...draft } | { t: 'unread', raw }
export function readItems(text) {
  const items = [];
  for (const line of String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (/AS\s*AT/i.test(line)) {
      const m = line.match(DATE_RE); if (m) items.push({ t: 'asat', date: readDate(m[1]) });
    }
    const pres = line.match(/Pres\.?\s*D\w?\.?\s*[:.]?\s*(.+)$/i);
    if (pres) {
      const d = pres[1].match(DATE_RE);
      items.push({ t: 'pres', date: d ? readDate(d[1]) : null, raw: line });
      continue;
    }
    if (/Processing/i.test(line)) {
      const toks = line.match(AMOUNT_TOKEN) ?? [];
      items.push({ t: 'total', amount: toks.length ? readAmount(toks[toks.length - 1]) : null, raw: line });
      continue;
    }
    if (/Draft/i.test(line)) {
      const [head, rest = ''] = line.split(/Sales\s*Draft/i);
      const dm = head.match(DATE_RE);
      const toks = rest.match(AMOUNT_TOKEN) ?? [];
      const nums = toks.slice(-3).map(readAmount);
      const cardPart = toks.length >= 3 ? rest.slice(0, rest.indexOf(toks[toks.length - 3])) : rest;
      const card = readCard(cardPart);
      items.push({
        t: 'draft', txn_date: dm ? readDate(dm[1]) : null, card_first6: card.first6, card_last4: card.last4,
        amount: nums.length === 3 ? nums[0] : null, commission: nums.length === 3 ? nums[1] : null, net: nums.length === 3 ? nums[2] : null,
        raw: line,
      });
    } else if (/\d[.,]\d{2}\s*CR/i.test(line)) {
      items.push({ t: 'unread', raw: line });
    }
  }
  return items;
}

// Two readings of the same statement row (from two overlapping screenshots).
// The reader can slip on a digit in one copy, so a sale matches on its date and
// two of its three amounts; batch totals match by position.
function sameRow(a, b) {
  if (a.t !== b.t) return false;
  if (a.t === 'pres') return !a.date || !b.date || a.date === b.date;
  if (a.t === 'total') return true;
  if (a.t === 'draft') {
    if (a.txn_date && b.txn_date && a.txn_date !== b.txn_date) return false;
    return ['amount', 'commission', 'net'].filter((k) => a[k] != null && a[k] === b[k]).length >= 2;
  }
  return false;
}
const rowIsSound = (x) => x.amount != null && x.commission != null && x.net != null
  && Math.abs(r2(x.amount * COMMISSION_RATE) - x.commission) <= 0.011 && Math.abs(r2(x.amount - x.commission) - x.net) < 0.005;

// Where the next screenshot picks up from the previous one: the longest run of rows
// at the end of `out` that shows again at the start of `rows`, allowing up to 2
// cut-off rows at the bottom of one and the top of the other. Needs a sale or a
// batch date in the run. Returns { pairs: [[outIndex, rowIndex]], cutOut, skipRows } or null.
function findOverlap(out, rows) {
  const keep = (x) => x.t === 'draft' || x.t === 'pres' || x.t === 'total';
  const A = out.map((x, i) => ({ x, i })).filter((r) => keep(r.x));
  const B = rows.map((x, i) => ({ x, i })).filter((r) => keep(r.x));
  let best = null;
  for (let ta = 0; ta <= 2; ta++) {
    for (let tb = 0; tb <= 2; tb++) {
      for (let n = Math.min(A.length - ta, B.length - tb); n >= 1; n--) {
        let same = true, anchors = 0;
        for (let i = 0; i < n && same; i++) {
          const a = A[A.length - ta - n + i].x, b = B[tb + i].x;
          same = sameRow(a, b);
          if (same && (a.t === 'draft' || (a.t === 'pres' && a.date && a.date === b.date))) anchors++;
        }
        if (!same) continue;
        if (anchors > 0 && (n >= 2 || (ta === 0 && tb === 0)) && (!best || n > best.n)) {
          const pairs = [];
          for (let i = 0; i < n; i++) pairs.push([A[A.length - ta - n + i].i, B[tb + i].i]);
          best = { n, pairs, cutOut: A[A.length - ta - 1].i + 1, skipRows: B[tb + n - 1].i + 1 };
        }
        break;
      }
    }
  }
  return best;
}

// Screenshots taken while scrolling usually overlap: the rows at the bottom of one
// show again at the top of the next. Join them, counting the repeated rows once and
// keeping whichever reading of each repeated row adds up.
// Returns the joined rows and how many were dropped as overlap.
export function joinItems(lists) {
  let out = [];
  let dropped = 0;
  for (const list of lists) {
    const rows = list.filter((x) => x.t !== 'asat' || !out.some((y) => y.t === 'asat'));
    const o = out.length ? findOverlap(out, rows) : null;
    if (!o) { out = [...out, ...rows]; continue; }
    dropped += o.n;
    const kept = out.slice(0, o.cutOut);
    for (const [ai, bi] of o.pairs) {
      const a = kept[ai], b = rows[bi];
      if (a.t === 'draft') {
        const better = !rowIsSound(a) && rowIsSound(b) ? { ...b } : { ...a };
        if (!/^\d{4}$/.test(better.card_last4 ?? '')) better.card_last4 = [a.card_last4, b.card_last4].find((c) => /^\d{4}$/.test(c ?? '')) ?? better.card_last4;
        if (!/^\d{6}$/.test(better.card_first6 ?? '')) better.card_first6 = [a.card_first6, b.card_first6].find((c) => /^\d{6}$/.test(c ?? '')) ?? better.card_first6;
        if (!better.txn_date) better.txn_date = a.txn_date ?? b.txn_date;
        kept[ai] = better;
      } else if (a.t === 'pres' && !a.date) kept[ai] = b;
      else if (a.t === 'total' && a.amount == null) kept[ai] = b;
    }
    out = [...kept, ...rows.slice(o.skipRows)];
  }
  return { items: out, dropped };
}

// Rows → { asAt, batches: [{ pres_date, printed_total, drafts: [...] }], unread: [...] }
export function buildStatement(items) {
  const out = { asAt: null, batches: [], unread: [] };
  let cur = null;
  for (const x of items) {
    if (x.t === 'asat') { if (!out.asAt) out.asAt = x.date; }
    else if (x.t === 'pres') { cur = { pres_date: x.date, printed_total: null, drafts: [] }; out.batches.push(cur); }
    else if (x.t === 'total') { if (cur) cur.printed_total = x.amount; }
    else if (x.t === 'draft') {
      if (!cur) { cur = { pres_date: null, printed_total: null, drafts: [] }; out.batches.push(cur); }
      const { t, ...d } = x; // eslint-disable-line no-unused-vars
      cur.drafts.push(d);
    } else if (x.t === 'unread') out.unread.push(x.raw);
  }
  return checkStatement(out);
}

// text → statement (one screenshot)
export function parseMerchantText(text) {
  return buildStatement(readItems(text));
}

// Adds problems to every draft and batch; a statement is clean only when there are none.
// A card number that couldn't be read is only a warning (the sale can still be set off).
export function checkStatement(st, rate = COMMISSION_RATE) {
  let problems = 0;
  for (const b of st.batches) {
    b.problems = [];
    b.warnings = [];
    if (!b.pres_date) b.problems.push('Batch date missing');
    for (const d of b.drafts) {
      d.problems = [];
      d.warnings = [];
      if (!d.txn_date) d.problems.push('Sale date missing');
      else if (b.pres_date && d.txn_date > b.pres_date) d.problems.push('Sale date is after the batch date');
      if (d.amount == null || d.commission == null || d.net == null) d.problems.push('Amount, commission or net missing');
      else {
        if (Math.abs(r2(d.amount * rate) - d.commission) > 0.011) d.problems.push(`Commission isn't ${Math.round(rate * 100)}% of the amount`);
        if (Math.abs(r2(d.amount - d.commission) - d.net) > 0.005) d.problems.push("Net isn't amount less commission");
      }
      if (!/^\d{4}$/.test(d.card_last4 ?? '')) d.warnings.push('Card number not read: type it from the screenshot if you can');
      problems += d.problems.length;
    }
    b.net_total = r2(b.drafts.reduce((a, d) => a + (Number(d.net) || 0), 0));
    if (!b.drafts.length) b.problems.push('No sales in this batch');
    if (b.printed_total == null) b.problems.push('Enter the printed batch total (Processing Dt. Ttl)');
    else if (Math.abs(b.printed_total - b.net_total) > 0.005) b.problems.push(`Sales add up to ${b.net_total.toFixed(2)}; the statement prints ${b.printed_total.toFixed(2)}`);
    problems += b.problems.length;
  }
  for (let i = 1; i < st.batches.length; i++) {
    const a = st.batches[i - 1].pres_date, b = st.batches[i].pres_date;
    if (a && b && b < a) st.batches[i].warnings.push('Batch dates out of order: check this date against the screenshot');
  }
  st.count = st.batches.reduce((a, b) => a + b.drafts.length, 0);
  st.gross = r2(st.batches.reduce((a, b) => a + b.drafts.reduce((x, d) => x + (Number(d.amount) || 0), 0), 0));
  st.commission = r2(st.batches.reduce((a, b) => a + b.drafts.reduce((x, d) => x + (Number(d.commission) || 0), 0), 0));
  st.net = r2(st.batches.reduce((a, b) => a + b.net_total, 0));
  st.problems = problems;
  return st;
}
