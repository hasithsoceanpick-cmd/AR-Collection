import { STATUS, KIND_LABEL } from './workflow';

// Receipts recorded in the app but not in BC yet (cc_ar_pending), grouped by customer and by invoice.
// byCust[customer_no] = { list: one entry per receipt with the invoices it settles, total, n }
// byDoc['customer_no|doc_no'] = the receipts settling that invoice, each with what it puts on it
export function groupPending(items = []) {
  const byCust = {};
  const byDoc = {};
  for (const x of items) {
    const c = (byCust[x.customer_no] ??= { map: new Map() });
    const k = `${x.src}:${x.id}`;
    if (!c.map.has(k)) c.map.set(k, { ...x, docs: [] });
    if (x.doc_no) {
      c.map.get(k).docs.push({ doc_no: x.doc_no, applied: x.applied });
      (byDoc[`${x.customer_no}|${x.doc_no}`] ??= []).push(x);
    }
  }
  for (const c of Object.values(byCust)) {
    c.list = [...c.map.values()];
    c.total = c.list.reduce((a, r) => a + Number(r.amount ?? 0), 0);
    c.n = c.list.length;
    delete c.map;
  }
  return { byCust, byDoc };
}

export const receiptKind = (x) => (x.src === 'payhere' ? 'PayHere web payment' : KIND_LABEL[x.kind] ?? x.kind);

// Where the receipt is on its way to BC.
export function receiptStage(x) {
  if (x.src === 'payhere') return 'Payout not in BC yet';
  if (x.bc_docs?.length) return `In ${x.bc_docs.join(', ')}, not in the customer ledger upload yet`;
  return 'Not exported to BC yet';
}

export const statusOf = (x) => (x.src === 'payhere' ? null : STATUS[x.status] ?? { label: x.status, tone: 'grey' });
