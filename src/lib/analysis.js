// Analysis workspace: formatting, colours, the "usually pays" window, change colouring and the Excel downloads.
import { dmy } from './followup';

// ---------- numbers and months ----------
const n0 = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 1 });
const n2 = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num0 = (v) => (v == null ? '—' : n0.format(Number(v)));
export const num1 = (v) => (v == null ? '—' : n1.format(Number(v)));
export const money = (v) => (v == null ? '—' : n2.format(Number(v)));
export const pct = (v) => (v == null ? '—' : `${n1.format(Number(v))}%`);
export const kg = (v) => (v == null ? '—' : `${n1.format(Number(v))} kg`);
export const qtyOf = (v, uom = 'KG') => (v == null ? '—' : uom === 'KG' ? kg(v) : `${n1.format(Number(v))} ${uom}`);
export const days = (v) => (v == null ? '—' : `${n0.format(Number(v))} day${Number(v) === 1 ? '' : 's'}`);
// 1,250 / 12.5K / 4.2M: for tiles and chart axes
export function compact(v) {
  if (v == null) return '—';
  const a = Math.abs(Number(v)); const s = Number(v) < 0 ? '-' : '';
  if (a >= 1e6) return `${s}${n1.format(a / 1e6)}M`;
  if (a >= 1e4) return `${s}${n1.format(a / 1e3)}K`;
  return `${s}${n0.format(a)}`;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const mShort = (iso) => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}` : '');
export const mLong = (iso) => (iso ? `${MONTH[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');
export const windowLabel = (months) => (months?.length ? `${mLong(months[0])} to ${mLong(months[months.length - 1])}` : '');
// The two windows: the 12 months to today, or to the end of the last complete month.
export const MODES = [['todate', '12 months to date'], ['month', '12 months to the last complete month']];
export const modeLabel = (m) => (m === 'month' ? '12 months to the last complete month' : '12 months to date');
export const rangeText = (from, to) => (from && to ? `${dmy(from)} to ${dmy(to)}` : '');
// Each month of a window, with the days it covers when the window starts or ends part-way through it (12 months to date).
export function periods(months, from, to) {
  const list = months ?? [];
  return list.map((m, i) => {
    const end = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
    const a = i === 0 && from ? Number(from.slice(8, 10)) : 1;
    const b = i === list.length - 1 && to && to.slice(0, 7) === m.slice(0, 7) ? Number(to.slice(8, 10)) : end;
    const partial = a !== 1 || b !== end;
    const label = mShort(m);
    const part = partial ? `${a} to ${b} ${MON[Number(m.slice(5, 7)) - 1]}` : '';
    return { m, label, part, partial, title: partial ? `${label} (${part})` : label };
  });
}
export { dmy };
export const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;
export const sum = (a) => (a ?? []).reduce((s, v) => s + (Number(v) || 0), 0);

// ---------- colours (the validated reference palette, light mode; a group keeps its colour everywhere) ----------
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const GROUP_SLOT = { Fillets: 0, Portions: 1, 'Whole fish': 2, 'Value-added': 3, 'Live fish and fingerlings': 4, 'By-products': 5, Other: 6 };
export const OTHER_GREY = '#898781';
// Stacks and legends go in slot order, so neighbouring colours are the validated pairs.
export const groupOrder = (a, b) => (GROUP_SLOT[a.grp] ?? 7) - (GROUP_SLOT[b.grp] ?? 7) || a.grp.localeCompare(b.grp);
export function groupColor(name) {
  if (name in GROUP_SLOT) return PALETTE[GROUP_SLOT[name]];
  return PALETTE[7]; // finance's own groups share the last slot; the legend and labels carry the name
}

// ---------- the customer grid ----------
export const METRICS = [
  { key: 'kg', label: 'Kg', long: 'Kg bought (sold less returned)', kind: 'amount', fmt: num1 },
  { key: 'billed', label: 'Billed', long: 'Billed (invoices less credit notes)', kind: 'amount', fmt: num0 },
  { key: 'collected', label: 'Collected', long: 'Collected (receipts)', kind: 'amount', fmt: num0 },
  { key: 'on_time', label: '% paid on time', long: '% of the month\'s invoices paid by their due date', kind: 'pct', fmt: pct },
  { key: 'paid', label: '% paid so far', long: '% of the month\'s invoices paid by today', kind: 'pct', fmt: pct },
  { key: 'cvb', label: 'Collected vs billed', long: 'Collected in the month ÷ billed in the month', kind: 'pct', fmt: pct },
  { key: 'days', label: 'Days to pay', long: 'Days from invoice to payment, for payments made that month', kind: 'days', fmt: num0 },
];
export const metricOf = (k) => METRICS.find((m) => m.key === k) ?? METRICS[0];

// A cell's change against the customer's own 12-month average: 'b2' / 'b1' better, 'w1' / 'w2' worse, '' about the same.
// Amounts by ratio (±20% / ±40%), percentages by points (±10 / ±20), days to pay by days (±7 / ±14, fewer is better).
export function changeClass(v, list, kind) {
  if (v == null) return '';
  const vals = (list ?? []).filter((x) => x != null).map(Number);
  if (vals.length < 3) return '';
  const avg = kind === 'amount' ? sum(list) / 12 : vals.reduce((a, b) => a + b, 0) / vals.length; // the window is 12 months
  if (kind === 'amount') {
    if (avg <= 0 || Number(v) === 0) return ''; // a month with nothing is left blank, not coloured
    const r = Number(v) / avg - 1;
    return r >= 0.4 ? 'b2' : r >= 0.2 ? 'b1' : r <= -0.4 ? 'w2' : r <= -0.2 ? 'w1' : '';
  }
  const d = Number(v) - avg;
  if (kind === 'pct') return d >= 20 ? 'b2' : d >= 10 ? 'b1' : d <= -20 ? 'w2' : d <= -10 ? 'w1' : '';
  return d <= -14 ? 'b2' : d <= -7 ? 'b1' : d >= 14 ? 'w2' : d >= 7 ? 'w1' : '';
}
export const CHANGE_WORDS = { b2: 'well above usual', b1: 'above usual', w1: 'below usual', w2: 'well below usual' };
export const changeWords = (cls, kind) => {
  if (!cls) return '';
  if (kind === 'days') return { b2: 'much quicker than usual', b1: 'quicker than usual', w1: 'slower than usual', w2: 'much slower than usual' }[cls];
  return CHANGE_WORDS[cls];
};

// The days of the month a customer usually pays: the shortest run of days (wrapping round the month end) holding
// half or more of its receipts. hist: 31 receipt counts, day 1 first. Null with fewer than 3 receipts.
export function payWindow(hist) {
  const h = (hist ?? []).map((x) => Number(x) || 0);
  const total = h.reduce((a, b) => a + b, 0);
  if (h.length !== 31 || total < 3) return null;
  let best = null;
  for (let len = 1; len <= 31 && !best; len += 1) {
    for (let s = 0; s < 31; s += 1) {
      let n = 0;
      for (let k = 0; k < len; k += 1) n += h[(s + k) % 31];
      if (n * 2 >= total && (!best || n > best.n)) best = { from: s + 1, to: ((s + len - 1) % 31) + 1, n, len };
    }
  }
  const peak = h.indexOf(Math.max(...h)) + 1;
  return { ...best, total, share: Math.round((100 * best.n) / total), peak };
}
export function payWindowText(w) {
  if (!w) return 'Too few receipts to tell';
  return w.from === w.to ? `On the ${ordinal(w.from)}` : `${ordinal(w.from)} to ${ordinal(w.to)}`;
}

// ---------- Excel ----------
const serial = (iso) => (iso ? (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000 : null);
const r2 = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
// cols: [[header, kind, width]], kind: 'text' | 'money' | 'num' | 'pct' | 'date' | 'int'
function sheet(XLSX, title, cols, rows) {
  const aoa = [];
  if (title) aoa.push(...title.map((t) => [t]), []);
  const head = aoa.length;
  aoa.push(cols.map((c) => c[0]));
  for (const r of rows) aoa.push(r.map((v, i) => (cols[i]?.[1] === 'date' ? serial(v) : ['money', 'num', 'pct'].includes(cols[i]?.[1]) ? r2(v) : v)));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const fmt = { money: '#,##0.00;[Red]-#,##0.00', num: '#,##0.0;[Red]-#,##0.0', pct: '0.0"%"', date: 'dd/mm/yyyy', int: '#,##0' };
  for (let r = head + 1; r < aoa.length; r += 1) {
    cols.forEach((c, i) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c: i })];
      if (cell && cell.t === 'n' && fmt[c[1]]) cell.z = fmt[c[1]];
    });
  }
  ws['!cols'] = cols.map((c) => ({ wch: c[2] ?? 12 }));
  if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: head, c: 0 }, e: { r: head + rows.length, c: cols.length - 1 } }) };
  return ws;
}
async function book(name, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, sheet(XLSX, s.title, s.cols, s.rows), s.name.slice(0, 31));
  XLSX.writeFile(wb, name);
}
const stamp = (status) => `Local customers. Customer ledger to ${dmy(status?.ledger?.last)}, item ledger to ${dmy(status?.entries?.last)}. Downloaded ${dmy(new Date().toISOString().slice(0, 10))}.`;
const monthCols = (x, kind, w = 11) => periods(x.months, x.from, x.to).map((p) => [p.partial ? `${p.label} (${p.part})` : p.label, kind, w]);

export function downloadOverview(ov, status) {
  const t = [`Analysis overview: ${modeLabel(ov.mode)}, ${rangeText(ov.from, ov.to)}`, stamp(status)];
  const rows = ov.by_month.map((m, i) => [periods(ov.months, ov.from, ov.to)[i].title, m.billed, m.collected, m.cvb_pct, m.on_time_pct, m.paid_pct, m.days, m.fish_kg, m.byp_kg, m.item_amount, m.customers]);
  const y = ov.year;
  rows.push(['12 months', y.billed, y.collected, y.cvb_pct, y.on_time_pct, y.paid_pct, y.days, y.fish_kg, y.byp_kg, y.item_amount, y.customers]);
  return book(`Analysis overview to ${ov.to}.xlsx`, [
    { name: 'By month', title: t, rows, cols: [['Month', 'text', 10], ['Billed', 'money', 15], ['Collected', 'money', 15], ['Collected vs billed %', 'pct', 12],
      ['% paid on time', 'pct', 12], ['% paid so far', 'pct', 12], ['Days to pay', 'int', 10], ['Fish kg', 'num', 12], ['By-products kg', 'num', 14],
      ['Item sales (excl. VAT)', 'money', 16], ['Customers', 'int', 10]] },
    { name: 'Kg by group', title: t, cols: [['Group', 'text', 24], ['Unit', 'text', 6], ...monthCols(ov, 'num'), ['12 months', 'num', 12]],
      rows: ov.groups.map((g) => [g.grp, g.is_kg ? 'kg' : g.uom, ...g.qty, g.total]) },
  ]);
}

export function downloadCustomers(cg, status) {
  const t = (m) => [`Customers: ${m.long}, ${rangeText(cg.from, cg.to)}`, stamp(status)];
  const base = [['Customer No.', 'text', 12], ['Customer', 'text', 34], ['Group', 'text', 9], ['Owner', 'text', 14]];
  const kindOf = (m) => (m.kind === 'pct' ? 'pct' : m.kind === 'days' ? 'int' : m.key === 'kg' ? 'num' : 'money');
  const summary = {
    name: 'Summary', title: [`Customers, ${modeLabel(cg.mode)}, ${rangeText(cg.from, cg.to)}`, stamp(status)],
    cols: [...base, ['Kg', 'num', 11], ['By-products kg', 'num', 13], ['Other units', 'num', 11], ['Billed', 'money', 15], ['Collected', 'money', 15],
      ['Collected vs billed %', 'pct', 11], ['% paid on time', 'pct', 11], ['% paid so far', 'pct', 11], ['Days to pay', 'int', 10],
      ['Usually pays', 'text', 16], ['Balance now', 'money', 15], ['Last order', 'date', 11]],
    rows: cg.rows.map((r) => [r.customer_no, r.name, r.grp, r.owner, r.total.kg, r.total.byp_kg, r.total.other_qty, r.total.billed, r.total.collected,
      r.total.cvb, r.total.on_time, r.total.paid, r.total.days, payWindowText(payWindow(r.pay_days)), r.balance, r.last_order]),
  };
  return book(`Analysis customers to ${cg.to}.xlsx`, [summary, ...METRICS.map((m) => ({
    name: m.label.replace('%', 'Pct'), title: t(m), cols: [...base, ...monthCols(cg, kindOf(m))],
    rows: cg.rows.map((r) => [r.customer_no, r.name, r.grp, r.owner, ...r[m.key]]),
  }))]);
}

export function downloadCustomer(d, status) {
  const c = d.customer; const s = d.series;
  const t = [`${c.name} (${c.customer_no}), ${rangeText(d.from, d.to)}`, stamp(status)];
  return book(`Analysis ${c.customer_no} to ${d.to}.xlsx`, [
    { name: 'By month', title: t, cols: [['Month', 'text', 10], ['Kg', 'num', 11], ['By-products kg', 'num', 13], ['Billed', 'money', 15], ['Collected', 'money', 15],
      ['Collected vs billed %', 'pct', 11], ['% paid on time', 'pct', 11], ['% paid so far', 'pct', 11], ['Days to pay', 'int', 10], ['Balance at month end', 'money', 16]],
      rows: periods(d.months, d.from, d.to).map((p, i) => [p.title, s.kg[i], s.byp_kg[i], s.billed[i], s.collected[i], s.cvb[i], s.on_time[i], s.paid[i], s.days[i], s.balance[i]]) },
    { name: 'SKUs', title: t, cols: [['Item', 'text', 11], ['Description', 'text', 40], ['Group', 'text', 16], ['Unit', 'text', 6], ['12 months', 'num', 11],
      ['Sales (excl. VAT)', 'money', 15], ['Price per unit', 'money', 12], ['Vs going rate %', 'pct', 11], ['Free (no price)', 'num', 11], ['Change', 'text', 9],
      ['Last order', 'date', 11], ...monthCols(d, 'num', 9)],
      rows: d.items.map((i) => [i.item_no, i.description, i.grp, i.is_kg ? 'kg' : i.uom, i.total_qty, i.total_amount, i.price_all, i.vs_pct, i.free_qty,
        i.change ?? '', i.last_on, ...i.qty]) },
    { name: 'Open invoices', title: t, cols: [['Invoice', 'text', 12], ['Posted', 'date', 11], ['Due', 'date', 11], ['Open', 'money', 14], ['In the app', 'money', 13],
      ['Expected', 'money', 14], ['Expected on', 'date', 11], ['Based on', 'text', 10]],
      rows: d.invoices.map((i) => [i.document_no, i.posting_date, i.due_date, i.remaining, i.in_app, i.expected, i.expected_on, i.basis]) },
    { name: 'Receipt days', title: t, cols: [['Day of month', 'int', 12], ['Receipts', 'int', 10], ['Amount', 'money', 15]],
      rows: d.pay_days.n.map((n, i) => [i + 1, n, d.pay_days.amount[i]]) },
  ]);
}

export function downloadSkus(sk, status) {
  const t = [`SKUs, ${rangeText(sk.from, sk.to)}`, stamp(status)];
  return book(`Analysis SKUs to ${sk.to}.xlsx`, [
    { name: 'Items', title: t, cols: [['Item', 'text', 11], ['Description', 'text', 44], ['Group', 'text', 18], ['Unit', 'text', 6], ['Customers', 'int', 10],
      ['12 months', 'num', 12], ['Sales (excl. VAT)', 'money', 15], ['Price per unit', 'money', 12], ['Last sale', 'date', 11], ...monthCols(sk, 'num', 9)],
      rows: sk.items.map((i) => [i.item_no, i.description, i.grp, i.is_kg ? 'kg' : i.uom, i.customers, i.total_qty, i.total_amount, i.price_all, i.last_on, ...i.qty]) },
    { name: 'Price per unit', title: t, cols: [['Item', 'text', 11], ['Description', 'text', 44], ...monthCols(sk, 'money', 10)],
      rows: sk.items.map((i) => [i.item_no, i.description, ...i.price]) },
    { name: 'Groups', title: t, cols: [['Group', 'text', 24], ['Unit', 'text', 6], ['Customers', 'int', 10], ['12 months', 'num', 12], ['Sales (excl. VAT)', 'money', 15],
      ...monthCols(sk, 'num', 10)], rows: sk.groups.map((g) => [g.grp, g.is_kg ? 'kg' : g.uom, g.customers, g.total_qty, g.total_amount, ...g.qty]) },
    { name: 'Mix changes', title: t, cols: [['Customer No.', 'text', 12], ['Customer', 'text', 34], ['Stopped buying', 'text', 60], ['Started buying', 'text', 40],
      ['Biggest share change (points)', 'num', 14]],
      rows: sk.mix.map((m) => [m.customer_no, m.name, m.dropped.map((x) => `${x.description} (last ${dmy(x.last_on)})`).join('; '),
        m.added.map((x) => x.description).join('; '), m.moved]) },
  ]);
}

export function downloadSku(d, status) {
  const it = d.item;
  const t = [`${it.description} (${it.item_no}), ${rangeText(d.from, d.to)}`, stamp(status)];
  return book(`Analysis ${it.item_no} to ${d.to}.xlsx`, [
    { name: 'Customers', title: t, cols: [['Customer No.', 'text', 12], ['Customer', 'text', 34], ['Group', 'text', 9], ['12 months', 'num', 11],
      ['Sales (excl. VAT)', 'money', 15], ['Price per unit', 'money', 12], ['Vs going rate %', 'pct', 11], ['Free (no price)', 'num', 11], ['Months bought', 'int', 9],
      ['Last order', 'date', 11], ...monthCols(d, 'num', 9)],
      rows: d.customers.map((c) => [c.customer_no, c.name, c.grp, c.total_qty, c.total_amount, c.price_all, c.vs_pct, c.free_qty, c.months, c.last_on, ...c.qty]) },
    { name: 'Going rate', title: t, cols: [['Month', 'text', 10], ['Quantity', 'num', 12], ['Sales (excl. VAT)', 'money', 15], ['Going rate per unit', 'money', 14]],
      rows: periods(d.months, d.from, d.to).map((p, i) => [p.title, d.by_month.qty[i], d.by_month.amount[i], d.by_month.avg[i]]) },
  ]);
}

export function downloadForecast(fc, status) {
  const t = [`Cash forecast from ${dmy(fc.today)}`, stamp(status)];
  const label = { w1: 'Week 1', w2: 'Week 2', w3: 'Week 3', w4: 'Week 4', late: 'Past their usual date', later: 'Later', in_app: 'Already in the app' };
  return book(`Cash forecast ${fc.today}.xlsx`, [
    { name: 'Invoices', title: t, cols: [['Customer No.', 'text', 12], ['Customer', 'text', 34], ['Owner', 'text', 14], ['Invoice', 'text', 12], ['Posted', 'date', 11],
      ['Due', 'date', 11], ['Open', 'money', 14], ['In the app', 'money', 13], ['Expected', 'money', 14], ['Expected on', 'date', 11], ['Based on', 'text', 10],
      ['Usual days to pay', 'int', 10], ['Week', 'text', 20]],
      rows: fc.rows.map((r) => [r.customer_no, r.name, r.owner, r.document_no, r.posting_date, r.due_date, r.remaining, r.in_app, r.expected, r.expected_on,
        r.basis, r.habit_days, label[r.bucket]]) },
    { name: 'Weeks', title: t, cols: [['Week', 'text', 22], ['From', 'date', 11], ['To', 'date', 11], ['Expected', 'money', 15], ['Invoices', 'int', 9], ['Customers', 'int', 10]],
      rows: [...fc.weeks.map((w, i) => [`Week ${i + 1}`, w.from, w.to, w.amount, w.n, w.customers]),
        ['Past their usual date', null, null, fc.late.amount, fc.late.n, null], ['Later', null, null, fc.later.amount, fc.later.n, null]] },
  ]);
}

export function downloadWatchlists(wl, status) {
  const t = (what) => [what, stamp(status)];
  const base = [['Customer No.', 'text', 12], ['Customer', 'text', 34], ['Group', 'text', 9], ['Owner', 'text', 14]];
  return book(`Watchlists ${modeLabel(wl.mode)} to ${wl.to}.xlsx`, [
    { name: 'Paying slower', title: t(`Paying ${wl.settings.slower_days}+ days slower: ${rangeText(wl.recent_from, wl.to)} against ${rangeText(wl.from, wl.to)}`),
      cols: [...base, ['Days to pay lately', 'num', 12], ['Payments lately', 'int', 10], ['Usual days to pay', 'num', 12], ['Payments in 12 months', 'int', 11], ['Slower by', 'num', 10]],
      rows: wl.slower.map((r) => [r.customer_no, r.name, r.grp, r.owner, r.recent_days, r.recent_n, r.usual_days, r.usual_n, r.slower_by]) },
    { name: 'Buying less', title: t(`Buying ${wl.settings.less_pct}% less, or no order in ${wl.settings.quiet_days} days, to ${dmy(wl.anchor)}`),
      cols: [...base, ['Kg last 30 days', 'num', 12], ['Usual kg per 30 days', 'num', 13], ['Change %', 'pct', 10], ['Last order', 'date', 11], ['Days since', 'int', 9],
        ['Order days before', 'int', 10]],
      rows: wl.less.map((r) => [r.customer_no, r.name, r.grp, r.owner, r.recent_kg, r.usual_kg, r.change_pct, r.last_on, r.days_since, r.days_before]) },
    { name: 'Sales vs collections', title: t(`Billed at least LKR ${money(wl.settings.gap_min)} more than collected, ${rangeText(wl.recent_from, wl.to)}`),
      cols: [...base, ['Billed', 'money', 15], ['Collected', 'money', 15], ['Gap', 'money', 15], ['Balance before', 'money', 15], ['Balance at the end', 'money', 15]],
      rows: wl.gap.map((r) => [r.customer_no, r.name, r.grp, r.owner, r.billed, r.collected, r.gap, r.bal_before, r.bal_now]) },
  ]);
}
