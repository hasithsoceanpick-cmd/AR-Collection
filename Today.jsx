import { useEffect } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { lkr, fmtDay as fmtDate, fmtDateTime } from '../lib/format';

const DAY = 86400000;
const daysSince = (d, today) => (d ? Math.round((new Date(`${today}T00:00:00`) - new Date(`${String(d).slice(0, 10)}T00:00:00`)) / DAY) : null);
const ago = (n) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);

// A file's freshness: up to date (yesterday or today), or how old.
function freshness(date, today, okDays = 1) {
  const n = daysSince(date, today);
  if (n === null) return { state: 'Never uploaded', cls: 'old' };
  return n <= okDays ? { state: 'Up to date', cls: 'fresh' } : { state: `${n} days old`, cls: 'old' };
}

function Row({ q, label, to, note, empty = 'Nothing waiting', today }) {
  const n = Number(q?.count ?? 0);
  const oldest = q?.oldest ? `Oldest ${fmtDate(q.oldest)} (${ago(daysSince(q.oldest, today))})` : '';
  return (
    <Link className={`tq${n ? '' : ' tq-zero'}`} to={to}>
      <span className="tq-count">{n}</span>
      <span className="tq-main"><span className="tq-label">{label}</span><span className="tq-note">{n ? note ?? oldest : empty}</span></span>
      <span className="tq-amt">{n && Number(q?.amount) ? lkr(q.amount) : ''}</span>
    </Link>
  );
}

// Finance's home page: everything waiting, in the order the work is done.
export default function Today() {
  const { profile } = useAuth();
  const { today: t, reloadToday } = useOutletContext() ?? {};
  useEffect(() => { reloadToday?.(); }, [reloadToday]);

  if (!t) return <section className="today"><h1>Today</h1><p className="muted">Loading what&apos;s waiting…</p></section>;
  const q = t.queue ?? {};
  const f = t.files ?? {};
  const day = t.today;
  const when = new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const ready = Number(q.ready?.count ?? 0);
  const banks = f.banks ?? [];
  const moneyLeft = Number(t.sections?.money_in ?? 0);
  const checkLeft = Number(q.not_posted?.count ?? 0) + Number(q.differs?.count ?? 0) + Number(q.reversals?.count ?? 0);
  const me = new Date(`${t.close?.can_close_from}T00:00:00`); me.setDate(me.getDate() - 1);
  const monthEnd = `${me.getFullYear()}-${String(me.getMonth() + 1).padStart(2, '0')}-${String(me.getDate()).padStart(2, '0')}`;
  const statementsDone = banks.length > 0 && banks.every((b) => b.upto >= monthEnd);
  const files = [
    ...banks.map((b) => ({ key: `b${b.id}`, name: b.name, upto: `Statement to ${fmtDate(b.upto)}`, ...freshness(b.upto, day, 2), to: '/bank' })),
    { key: 'm', name: 'HNB merchant', upto: f.merchant?.upto ? `Card batches to ${fmtDate(f.merchant.upto)}` : 'No statement yet', ...freshness(f.merchant?.upto, day, 3), to: '/merchant/new' },
    { key: 'p', name: 'PayHere', upto: f.payhere?.upto ? `Payments to ${fmtDate(f.payhere.upto)}` : 'No export yet', ...freshness(f.payhere?.upto, day, 3), to: '/payhere' },
    { key: 'bb', name: 'BC bank ledger', upto: f.bc_bank ? `Uploaded ${fmtDateTime(f.bc_bank)}` : 'Never uploaded', ...freshness(f.bc_bank, day, 1), to: '/bc-check' },
    { key: 'bcu', name: 'BC customer ledger', upto: f.bc_customer ? `Uploaded ${fmtDateTime(f.bc_customer)}` : 'Never uploaded', ...freshness(f.bc_customer, day, 1), to: '/bc-check' },
    { key: 'oi', name: 'Open invoices', upto: f.open_invoices ? `Uploaded ${fmtDateTime(f.open_invoices)}` : 'Never uploaded', ...freshness(f.open_invoices, day, 1), to: '/customers' },
  ];
  const last = t.close?.last;

  return (
    <section className="today">
      <div className="today-head">
        <div>
          <h1>Today</h1>
          <p className="lede">{when}{profile?.full_name ? ` · ${profile.full_name.split(' ')[0]}` : ''}: everything waiting for finance, in the order the work is done.</p>
        </div>
        {ready > 0 && <Link className="btn primary" to="/bc-export">Export {ready} document{ready === 1 ? '' : 's'} to BC</Link>}
      </div>

      <div className="t-card">
        <div className="t-card-head"><h2>Latest files</h2><span className="muted small">Upload any of them with <strong>Upload a file</strong> at the top</span></div>
        <div className="t-files">
          {files.map((x) => (
            <Link key={x.key} className="t-file" to={x.to}>
              <strong>{x.name}</strong><span className="muted small">{x.upto}</span><span className={`t-fresh ${x.cls}`}>{x.state}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="t-steps">
        <div className="t-card">
          <div className="t-step-head"><span className="t-step">Step 1</span><h2>Receipts</h2><span className="muted small">Cheques, cash and payments handed to finance</span></div>
          <Row today={day} q={q.assign} label="Cheque collections to give a driver" to="/collections?status=submitted&kind=cheque&title=Cheque collections to give a driver" />
          <Row today={day} q={q.receive_cheques} label="Collected cheques to receive" to="/collections?status=collected&kind=cheque&title=Collected cheques to receive" />
          <Row today={day} q={q.cash_count} label="Cash handovers to count and receive" to="/cash" />
          <Row today={day} q={q.review} label="Transfers and card payments to review" to="/collections?status=review&title=Transfers and card payments to review" />
        </div>
        <div className="t-card">
          <div className="t-step-head"><span className="t-step">Step 2</span><h2>Money in</h2><span className="muted small">Every bank credit matched to what it pays</span></div>
          <Row today={day} q={q.unidentified} label="Bank credits not identified" to="/money-in" />
          <Row today={day} q={q.deposits} label="Deposit slips not matched to the bank" to="/money-in" />
          <Row today={day} q={q.batches} label="Card batches without their Amana credit" to="/money-in" />
          <Row today={day} q={q.payouts} label="PayHere payouts without their Sampath credit" to="/money-in" />
          <Row today={day} q={q.cash_in_hand} label="Cash in hand to bank" to="/cash" note={Number(q.cash_in_hand?.count) ? `${q.cash_in_hand.count} cash receipt${q.cash_in_hand.count === 1 ? '' : 's'} not banked yet` : undefined} />
        </div>
        <div className="t-card">
          <div className="t-step-head"><span className="t-step">Step 3</span><h2>Business Central</h2><span className="muted small">Export, then check what BC posted</span></div>
          <Row today={day} q={q.ready} label="Ready to export" to="/bc-export" note="The file starts at BC's next BAKRC number" />
          <Row today={day} q={q.not_posted} label="Exported, not in BC yet" to="/bc-check" note={q.not_posted?.last_export ? `Last exported ${fmtDateTime(q.not_posted.last_export)}` : undefined} />
          <Row today={day} q={q.differs} label="BC differs from the app" to="/bc-check" />
          <Row today={day} q={q.reversals} label="Sent back or reopened: check in BC" to="/bc-check" />
        </div>
      </div>

      <div className="t-card">
        <div className="t-card-head"><h2>Waiting on someone else</h2></div>
        <div className="t-files t-wait">
          <Link className="t-file" to="/collections?status=rejected&title=Sent back to Sales"><strong>{q.sent_back?.count ?? 0} sent back to Sales</strong>
            <span className="muted small">{Number(q.sent_back?.count) ? `Not sent again · LKR ${lkr(q.sent_back.amount)}` : 'None'}</span></Link>
          <Link className="t-file" to="/collections?status=parked,relink&title=With Sales: parked or to relink"><strong>{q.with_sales?.count ?? 0} with Sales</strong>
            <span className="muted small">{Number(q.with_sales?.count) ? `Parked or to relink · LKR ${lkr(q.with_sales.amount)}` : 'None'}</span></Link>
          <Link className="t-file" to="/collections?status=assigned,received&kind=cheque&title=Cheques with drivers"><strong>{q.with_drivers?.count ?? 0} cheques with drivers</strong>
            <span className="muted small">{Number(q.with_drivers?.count) ? `To collect or deposit · LKR ${lkr(q.with_drivers.amount)}` : 'None'}</span></Link>
          <Link className="t-file" to="/collections?status=returned&title=Returned cheques"><strong>{q.returned?.count ?? 0} returned cheque{Number(q.returned?.count) === 1 ? '' : 's'}</strong>
            <span className="muted small">Last 60 days{Number(q.returned?.count) ? ` · LKR ${lkr(q.returned.amount)}` : ''}</span></Link>
        </div>
      </div>

      <div className="t-card">
        <div className="t-card-head"><h2>{t.close?.month} close</h2>
          {last && <span className="ok-text small">{last.month} closed {fmtDate(last.done_at)}{last.done_by ? ` by ${last.done_by}` : ''}</span>}</div>
        <ol className="t-close">
          <li className={statementsDone ? 'done' : ''}><strong>Statements to {fmtDate(monthEnd)}</strong>
            <span className="muted small">{banks.length ? banks.map((b) => `${b.name} to ${fmtDate(b.upto)}`).join(', ') : 'No statements yet'}</span></li>
          <li className={moneyLeft === 0 ? 'done' : ''}><strong>Everything matched</strong><span className="muted small">{moneyLeft ? `${moneyLeft} still to match` : 'Nothing to match'}</span></li>
          <li className={ready === 0 ? 'done' : ''}><strong>Exported to BC</strong><span className="muted small">{ready ? `${ready} ready to export` : 'Nothing to export'}</span></li>
          <li className={checkLeft === 0 ? 'done' : ''}><strong>BC check clean</strong><span className="muted small">{checkLeft ? `${checkLeft} to look at` : 'Nothing to look at'}</span></li>
          <li><strong>Bank recs in BC</strong><span className="muted small"><Link to="/bank-rec">Bank rec</Link> helps; tick it off in BC</span></li>
          <li><strong>Close {t.close?.month}</strong><span className="muted small"><Link to="/bc-close">Close the month</Link> from {fmtDate(t.close?.can_close_from)}</span></li>
        </ol>
      </div>
    </section>
  );
}
