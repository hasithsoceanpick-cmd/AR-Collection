import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, rpc } from '../lib/supabase';
import { lkr, fmtDate, fmtDateTime, todayISO, daysAgo } from '../lib/format';
import { SalesReminderForm } from '../components/Reminders';

// Finance Admins: one card per bank account. The bank statement balance, the items not yet in BC
// (split by who to follow up), and BC's bank book balance, the same way Bank rec works them out.
const n = (x) => Number(x ?? 0);
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const STAGE = {
  to_export: { label: 'Not exported to BC', to: '/bc-export', link: 'Export to BC' },
  exported: { label: 'Exported, not in BC yet', to: '/bc-check', link: 'BC check' },
  differs: { label: 'In BC with differences', to: '/bc-check', link: 'BC check' },
  card_batch: { label: 'Card batch: add the merchant statement', to: '/merchant', link: 'Merchant statements' },
  tagged: { label: 'Post it in BC', to: '/bank-rec', link: 'Bank rec' },
};
const STAGE_SHORT = { to_export: ['not exported'], exported: ['exported'], differs: ['differs in BC', 'differ in BC'], card_batch: ['card batch', 'card batches'], tagged: ['tagged'] };
const stageText = (k, c) => `${c} ${STAGE_SHORT[k][c === 1 ? 0 : STAGE_SHORT[k].length - 1]}`;
const VIEW_TITLE = { debit: 'Uncleared debits', credit: 'Uncleared credits', sales: 'Waiting on Sales: no reference sent', finance: 'Waiting on Finance: not in BC yet', bc: 'In BC, not on the statement' };

function Row({ label, amount, sub, open, onClick, className = '', count, children }) {
  const body = (
    <>
      <span className="rec-label">{label}{count != null && <span className="rec-count"> ({count})</span>}{children}</span>
      <span className="amt">{amount}</span>
      <span className="chev" aria-hidden="true">{onClick ? '›' : ''}</span>
    </>
  );
  const cls = `rec-row ${sub ? 'sub' : ''} ${className}`;
  return onClick
    ? <button type="button" className={cls} aria-expanded={open} onClick={onClick}>{body}</button>
    : <div className={cls}>{body}</div>;
}

function BankCard({ a, view, pick }) {
  const isOpen = (v) => view?.id === a.id && view.view === v;
  const tap = (v, k) => (k > 0 ? () => pick(isOpen(v) ? null : { id: a.id, view: v }) : undefined);
  const hasBank = a.bank_balance != null, hasBc = a.bc_balance != null;
  const calc = hasBank ? n(a.bank_balance) - n(a.credits.total) + n(a.debits.total) + n(a.bc_only.total) : null;
  const diff = hasBank && hasBc ? Math.round((n(a.bc_balance) - calc) * 100) / 100 : null;
  const st = a.finance.stages ?? {};
  const bcOnly = n(a.bc_only.total);
  return (
    <article className="bank-card" aria-labelledby={`bank-${a.id}`}>
      <header>
        <h2 id={`bank-${a.id}`}>{a.name}</h2>
        <p className="bank-card-sub">
          {a.last_line_date ? `Statement to ${fmtDate(a.last_line_date)}` : 'No statement uploaded yet'}
          {' · '}{a.last_entry_date ? `BC to ${fmtDate(a.last_entry_date)}` : 'No BC ledger yet'}
        </p>
      </header>
      <div className="rec-lines">
        <Row label="Bank statement balance" amount={hasBank ? lkr(a.bank_balance) : '—'} className="rec-strong" />
        <Row label="Add: uncleared debits" count={a.debits.count} amount={lkr(a.debits.total)} open={isOpen('debit')} onClick={tap('debit', a.debits.count)} />
        <Row label="Less: uncleared credits" count={a.credits.count} amount={lkr(a.credits.total)} open={isOpen('credit')} onClick={tap('credit', a.credits.count)} />
        <Row sub label={<><i className="dot sales" aria-hidden="true" />Waiting on Sales: no reference sent</>} count={a.sales.count} amount={lkr(a.sales.total)}
          open={isOpen('sales')} onClick={tap('sales', a.sales.count)}>
          {a.sales.count > 0 && <small className="rec-note">oldest {daysAgo(a.sales.oldest)} days</small>}
        </Row>
        <Row sub label={<><i className="dot finance" aria-hidden="true" />Waiting on Finance: not in BC yet</>} count={a.finance.count} amount={lkr(a.finance.total)}
          open={isOpen('finance')} onClick={tap('finance', a.finance.count)}>
          {a.finance.count > 0 && <small className="rec-note">{Object.keys(STAGE).filter((k) => st[k]).map((k) => stageText(k, st[k])).join(' · ')}</small>}
        </Row>
        {a.bc_only.count > 0 && (
          <Row label={`${bcOnly < 0 ? 'Less' : 'Add'}: in BC, not on the statement`} count={a.bc_only.count} amount={lkr(Math.abs(bcOnly))}
            open={isOpen('bc')} onClick={tap('bc', a.bc_only.count)} />
        )}
        <Row label="Bank book balance (BC)" amount={hasBc ? lkr(a.bc_balance) : '—'} className={`rec-total ${hasBc ? '' : 'rec-none'}`} />
      </div>
      <div className="bank-card-foot">
        {!hasBank && <p className="hint">Add the account's opening balance on the <Link to="/bank">Bank</Link> page to get the statement balance.</p>}
        {!hasBc && <p className="hint">Upload BC's Bank Account Ledger Entries on <Link to="/bc-check">BC check</Link> to get the book balance.</p>}
        {diff != null && (diff === 0
          ? <p className="ok-text small">✓ Ties to BC</p>
          : <p className="warn-text small">Doesn't tie by LKR {lkr(Math.abs(diff))}: BC is {diff < 0 ? 'lower' : 'higher'} than the items explain. Check it on <Link to="/bank-rec">Bank rec</Link>.</p>)}
      </div>
    </article>
  );
}

function Lines({ rows, kind, people, reminded, onReminded }) {
  const [remindLine, setRemindLine] = useState(null);
  const [sent, setSent] = useState(null);
  const total = rows.reduce((s, r) => s + n(r.amount), 0);
  const sales = kind === 'sales', fin = kind === 'finance';
  const cols = sales ? 6 : fin ? 6 : 5;
  async function done(lineId, who) { await onReminded(); setRemindLine(null); setSent({ lineId, text: `Reminder sent to ${who}.` }); }
  return (
    <div className="table-wrap flat">
      <table className="table uncleared-table">
        <thead><tr>
          <th>Date</th><th>Narration</th>{fin ? <th>What</th> : <th>Ref</th>}<th className="num">LKR</th><th className="num">Days</th>
          {sales && <th>Follow up</th>}{fin && <th>Next step</th>}
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const s = STAGE[r.stage];
            return (
              <Fragment key={r.id}>
                <tr>
                  <td className="c-date">{fmtDate(r.txn_date)}</td>
                  <td className="c-narr narr">{r.narration}{fin && r.reference && <div className="small muted">{r.reference}</div>}</td>
                  {fin
                    ? <td className="c-what">
                      {r.what && <div>{r.what}</div>}
                      {(r.customers || r.invoices) && <div className="small">{[r.customers, r.invoices].filter(Boolean).join(' / ')}</div>}
                      {r.app_ref && <div className="small muted">{r.collection_id ? <Link to={`/c/${r.collection_id}`}>{r.app_ref}</Link> : r.app_ref}</div>}
                    </td>
                    : <td className="c-ref">{r.reference}</td>}
                  <td className="num c-amt">{lkr(r.amount)}</td>
                  <td className="num c-days"><span className="m-only">{daysAgo(r.txn_date)} days</span><span className="d-only">{daysAgo(r.txn_date)}</span></td>
                  {sales && (
                    <td className="c-act">
                      <div className="follow"><button className="link small" onClick={() => { setRemindLine(remindLine === r.id ? null : r.id); setSent(null); }}>Remind Sales</button>
                        <Link className="small" to={`/transfer?line=${r.id}`}>Record</Link></div>
                      {sent?.lineId === r.id && <div className="ok-text small">{sent.text}</div>}
                      {reminded[r.id] && <div className="muted small">Reminded {fmtDateTime(reminded[r.id].last_at)}{reminded[r.id].to_names !== 'Sales' ? ` (${reminded[r.id].to_names})` : ''}</div>}
                    </td>
                  )}
                  {fin && (
                    <td className="c-act">
                      <div>{s?.label}{r.doc_no && (r.stage === 'exported' || r.stage === 'differs') && <>: <span className="nowrap">{r.doc_no}</span></>}</div>
                      {s && <Link className="small" to={s.to}>{s.link}</Link>}
                    </td>
                  )}
                </tr>
                {remindLine === r.id && (
                  <tr className="remind-row"><td colSpan={cols}>
                    <div className="remind">
                      <p className="remind-what"><strong>Remind Sales about LKR {lkr(r.amount)} on {fmtDate(r.txn_date)}</strong> ({r.narration}). The reminder opens Record transfer on this line.</p>
                      <SalesReminderForm lineId={r.id} people={people} onSent={(who) => done(r.id, who)} onCancel={() => setRemindLine(null)} />
                    </div>
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={3}>{plural(rows.length, 'line')}</td><td className="num">{lkr(total)}</td><td className="c-pad" colSpan={cols - 4} /></tr></tfoot>
      </table>
    </div>
  );
}

function SalesGroup({ rows, people, reminded, onReminded, heading }) {
  const [all, setAll] = useState(false);
  const [msg, setMsg] = useState('');
  const last = reminded.all;
  return (
    <div className="detail-group">
      {heading && <h3 className="subhead"><i className="dot sales" aria-hidden="true" />Waiting on Sales: no reference sent ({rows.length})</h3>}
      <p className="hint">Money in the bank that no one in Sales has identified yet. Remind them, or record it yourself if you know whose payment it is.</p>
      <div className="remind">
        {last && <p className="hint">All unidentified lines last reminded by {last.last_by} on {fmtDateTime(last.last_at)} ({last.to_names}).</p>}
        {msg && <p className="ok-text">{msg}</p>}
        {all
          ? <SalesReminderForm people={people} onSent={async (who) => { await onReminded(); setAll(false); setMsg(`Reminder sent to ${who}.`); }} onCancel={() => setAll(false)} />
          : <div className="row"><button className="btn" onClick={() => { setAll(true); setMsg(''); }}>Remind Sales about every unidentified line</button></div>}
      </div>
      <Lines rows={rows} kind="sales" people={people} reminded={reminded} onReminded={onReminded} />
    </div>
  );
}

function FinanceGroup({ rows, heading }) {
  return (
    <div className="detail-group">
      {heading && <h3 className="subhead"><i className="dot finance" aria-hidden="true" />Waiting on Finance: not in BC yet ({rows.length})</h3>}
      <p className="hint">Sales (or the driver) sent the reference, or finance identified it; it isn't in BC's bank ledger yet. Card batches clear when the merchant statement with their batch is added.</p>
      <Lines rows={rows} kind="finance" />
    </div>
  );
}

function Detail({ account, view, asAt, onClose }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [people, setPeople] = useState([]);
  const [reminded, setReminded] = useState({});
  const ref = useRef(null);
  const loadReminders = useCallback(async () => {
    const r = await rpc('cc_line_reminders').catch(() => []);
    setReminded(Object.fromEntries((r ?? []).map((x) => [x.line_id ?? 'all', x])));
  }, []);
  useEffect(() => {
    setD(null); setError('');
    rpc('cc_admin_bank_items', { p_account_id: account.id, p_as_at: asAt }).then(setD).catch((e) => setError(e.message));
  }, [account.id, asAt]);
  useEffect(() => {
    if (view !== 'sales' && view !== 'credit') return;
    db.from('profiles').select('id, full_name, email').eq('role', 'sales').eq('active', true).order('full_name').then(({ data }) => setPeople(data ?? []));
    loadReminders();
  }, [view, loadReminders]);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [account.id, view]);

  const lines = d?.lines ?? [];
  const debits = lines.filter((l) => l.side === 'debit');
  const sales = lines.filter((l) => l.side === 'credit' && l.grp === 'sales');
  const finance = lines.filter((l) => l.side === 'credit' && l.grp === 'finance');
  return (
    <section className="facts bank-detail" ref={ref} aria-labelledby="bank-detail-title">
      <div className="detail-head">
        <h2 id="bank-detail-title">{account.name}: {VIEW_TITLE[view]}</h2>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!d && !error && <p className="muted">Loading…</p>}
      {d && view === 'debit' && (
        <div className="detail-group">
          <p className="hint">Money out of the bank that isn't in BC's bank ledger yet. Post them in BC; once BC's ledger is uploaded again they clear by themselves (same amount and date), or match them on <Link to="/bank-rec">Bank rec</Link>.</p>
          <Lines rows={debits} kind="debit" />
        </div>
      )}
      {d && (view === 'credit' || view === 'sales') && sales.length > 0 && <SalesGroup rows={sales} people={people} reminded={reminded} onReminded={loadReminders} heading={view === 'credit'} />}
      {d && (view === 'credit' || view === 'finance') && finance.length > 0 && <FinanceGroup rows={finance} heading={view === 'credit'} />}
      {d && view === 'bc' && (
        <div className="detail-group">
          <p className="hint">In BC's bank ledger but not on the bank statement up to {fmtDate(asAt)}. Usually a date or amount that differs from the bank's; check the entry in BC, or match it on <Link to="/bank-rec">Bank rec</Link>.</p>
          <div className="table-wrap flat">
            <table className="table uncleared-table bc-table">
              <thead><tr><th>Posting date</th><th>Document</th><th>Description</th><th className="num">LKR</th></tr></thead>
              <tbody>{d.bc_only.map((e) => (
                <tr key={e.entry_no}><td className="c-date">{fmtDate(e.posting_date)}</td><td className="c-ref">{e.document_no}</td>
                  <td className="c-narr">{e.description}{e.comment && <div className="muted small">{e.comment}</div>}</td>
                  <td className={`num c-amt ${n(e.amount) < 0 ? 'out' : ''}`}>{lkr(e.amount)}</td></tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={3}>{plural(d.bc_only.length, 'entry', 'entries')}</td><td className="num">{lkr(d.bc_only.reduce((s, e) => s + n(e.amount), 0))}</td></tr></tfoot>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export default function AdminOverview() {
  const [asAt, setAsAt] = useState(todayISO());
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState(null);   // { id: account id, view: 'debit' | 'credit' | 'sales' | 'finance' | 'bc' }

  useEffect(() => {
    if (!asAt) return;
    setError('');
    rpc('cc_admin_bank_overview', { p_as_at: asAt }).then(setD).catch((e) => setError(e.message));
  }, [asAt]);

  const accounts = d?.accounts ?? [];
  const open = view && accounts.find((a) => a.id === view.id);
  return (
    <section className="wide overview admin-overview">
      <div className="page-head">
        <h1>Admin overview</h1>
        <label className="inline-field">As at
          <input type="date" value={asAt} max={todayISO()} onChange={(e) => { setAsAt(e.target.value); setView(null); }} />
        </label>
      </div>
      <h2 className="ov-title">Bank accounts</h2>
      <p className="lede">Each card takes the bank statement balance to BC's bank book balance. Click a line to see the items behind it and who to follow up.</p>
      {error && <p className="error">Couldn't load the overview: {error}</p>}
      {!d && !error && <p className="muted">Loading…</p>}
      {d && accounts.length === 0 && <p className="muted">No active bank accounts. Add them on the <Link to="/bank">Bank</Link> page.</p>}
      <div className="bank-cards">
        {accounts.map((a) => <BankCard key={a.id} a={a} view={view} pick={setView} />)}
      </div>
      {open && <Detail key={`${open.id}-${asAt}`} account={open} view={view.view} asAt={d.as_at} onClose={() => setView(null)} />}
    </section>
  );
}
