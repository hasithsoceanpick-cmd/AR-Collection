// Puts statement lines back into the bank's true order and gives each a running
// balance. Some banks list a day's lines newest first, so within each day the
// lines are chained by the bank's printed balances:
//   previous balance + money in - money out = this line's balance.
const near = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.005;
const start = (l) => (l.balance == null ? null : Number(l.balance) - Number(l.credit) + Number(l.debit));

export function orderStatement(lines, openingBalance = null) {
  const byDay = new Map();
  for (const l of [...lines].sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : a.id - b.id))) {
    if (!byDay.has(l.txn_date)) byDay.set(l.txn_date, []);
    byDay.get(l.txn_date).push(l);
  }
  const out = [];
  let cur = openingBalance == null ? null : Number(openingBalance);
  for (const day of byDay.values()) {
    const rest = [...day];
    while (rest.length) {
      let i = cur == null ? -1 : rest.findIndex((l) => near(start(l), cur));
      if (i < 0 && cur == null) {
        // No known balance yet: begin with the line no other line of the day leads into.
        i = rest.findIndex((l) => !rest.some((o) => o !== l && near(o.balance, start(l))));
      }
      if (i < 0) i = 0;
      const [l] = rest.splice(i, 1);
      const running = l.balance != null ? Number(l.balance) : cur != null ? cur + Number(l.credit) - Number(l.debit) : null;
      out.push({ ...l, running, chained: cur != null && near(start(l), cur) });
      cur = running;
    }
  }
  return out;
}
