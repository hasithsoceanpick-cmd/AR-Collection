import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpc } from '../../lib/supabase';
import { compact, dmy, downloadCustomer, groupColor, groupOrder, kg, money, mShort, num0, num1, PALETTE, pct, payWindow, payWindowText, qtyOf, windowLabel } from '../../lib/analysis';
import { payMethodLabel } from '../../lib/followup';
import { Columns, DayBars, Lines, Spark } from '../../components/Charts';
import { AnPage, Loading, Tile, useAnStatus, useEndMonth, WatchPills, WindowPicker, withTo } from './AnCommon';

const BASIS = { promise: 'their promise', habit: 'how they usually pay', 'due date': 'the due date' };
const vs = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${num1(v)}%`);

// Analysis → one customer: 12 months of buying and paying, SKUs and prices, payment days, open invoices.
export default function AnCustomer() {
  const { no } = useParams();
  const { status } = useAnStatus();
  const [end, setEnd] = useEndMonth();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError(''); setD(null);
    rpc('cc_an_customer', { p_customer: no, p_end: end }).then((x) => { if (live) setD(x); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [no, end]);

  if (!d) return <AnPage title="Customer"><Loading error={error} /></AnPage>;
  const c = d.customer; const s = d.series; const labels = d.months.map(mShort);
  const pw = payWindow(d.pay_days.n);
  const kgGroups = d.groups.filter((g) => g.is_kg).sort(groupOrder);
  const unitGroups = d.groups.filter((g) => !g.is_kg);
  const dropped = d.items.filter((i) => i.change === 'dropped');
  const added = d.items.filter((i) => i.change === 'new');
  const tb = kgGroups.reduce((a, g) => a + g.before, 0); const tn = kgGroups.reduce((a, g) => a + g.now, 0);
  const expected = d.invoices.reduce((a, i) => a + Number(i.expected), 0);
  return (
    <AnPage title={c.name}
      lede={<>{c.customer_no}{c.grp ? ` · ${c.grp}` : ''} · {c.owner ?? 'No owner'} · Terms {c.terms ?? (c.bc_terms ? `${c.bc_terms} (BC)` : 'not set')}
        {c.pay_method ? ` · Pays by ${payMethodLabel(c.pay_method)}` : ''} · {windowLabel(d.months)}</>}
      actions={<>
        <WindowPicker status={status} end={end} onChange={setEnd} />
        <button type="button" className="btn" onClick={() => downloadCustomer(d, status)}>Download Excel</button>
      </>}>
      <p className="an-crumbs small"><Link to={withTo('/analysis/customers', end)}>All customers</Link> · <Link to={`/customer/${encodeURIComponent(c.customer_no)}`}>Collections customer page</Link>
        {' '}<WatchPills watch={d.watch} /></p>
      <div className="an-tiles">
        <Tile label="Billed" value={`LKR ${compact(d.total.billed)}`} spark={s.billed} />
        <Tile label="Collected" value={`LKR ${compact(d.total.collected)}`} sub={`${pct(d.total.cvb)} of billed`} spark={s.collected} />
        <Tile label="Paid on time" value={pct(d.total.on_time)} sub={`${pct(d.total.paid)} paid so far`} spark={s.on_time} />
        <Tile label="Days to pay" value={num0(d.total.days)} spark={s.days} />
        <Tile label="Kg" value={kg(d.total.kg)} sub={`last order ${dmy(c.last_order)}`} spark={s.kg} />
        <Tile label="Usually pays" value={payWindowText(pw)} sub={pw ? `${pw.share}% of ${pw.total} receipts` : ''} />
        <Tile label="Balance now" value={`LKR ${money(c.balance)}`} />
      </div>
      <div className="an-grid2">
        <Columns title="Billed and collected by month (LKR)" labels={labels} fmt={money}
          series={[{ name: 'Billed', color: PALETTE[0], values: s.billed }, { name: 'Collected', color: PALETTE[1], values: s.collected }]} />
        <Lines title="How invoices were paid (%)" labels={labels} fmt={pct} yFmt={(v) => `${v}%`} yMax={100}
          series={[{ name: '% paid on time', color: PALETTE[0], values: s.on_time }, { name: '% paid so far', color: PALETTE[1], values: s.paid },
            { name: 'Collected vs billed', color: PALETTE[2], values: s.cvb }]} />
        {kgGroups.length > 0 && <Columns stack title="Kg by group" labels={labels} fmt={(v) => kg(v)}
          series={kgGroups.map((g) => ({ name: g.grp, color: groupColor(g.grp), values: g.qty }))} />}
        {unitGroups.map((g) => <Columns key={g.grp} title={g.grp} labels={labels} fmt={(v) => num1(v)} series={[{ name: g.grp, color: groupColor(g.grp), values: g.qty }]} />)}
        <Lines title="Days to pay, by the month paid" labels={labels} fmt={(v) => (v == null ? '—' : `${num0(v)} days`)} yFmt={num0}
          series={[{ name: 'Days to pay', color: PALETTE[0], values: s.days }]} />
        <DayBars title={`Days of the month receipts came in${pw ? ` (usually ${payWindowText(pw)})` : ''}`} counts={d.pay_days.n} amounts={d.pay_days.amount}
          fmtAmount={(v) => `LKR ${money(v)}`} highlight={pw} />
        <Lines title="Balance at each month end (LKR)" labels={labels} fmt={money} series={[{ name: 'Balance', color: PALETTE[0], values: s.balance }]} />
      </div>

      <h2>SKUs</h2>
      {d.items.length === 0 ? <p className="muted">No item sales in these 12 months.</p> : (
        <>
          {(dropped.length > 0 || added.length > 0 || kgGroups.length > 1) && (
            <div className="an-mix">
              {dropped.length > 0 && <p><strong>Stopped buying</strong> (bought in 3 or more of the first 9 months, none since {mShort(d.recent_from)}):{' '}
                {dropped.map((i) => `${i.description} (last ${dmy(i.last_on)})`).join('; ')}</p>}
              {added.length > 0 && <p><strong>Started buying</strong> since {mShort(d.recent_from)}: {added.map((i) => i.description).join('; ')}</p>}
              {tb > 0 && tn > 0 && kgGroups.length > 1 && (
                <p className="small">Share of kg, first 9 months → last 3: {kgGroups.map((g) => `${g.grp} ${Math.round((100 * g.before) / tb)}% → ${Math.round((100 * g.now) / tn)}%`).join(' · ')}</p>
              )}
            </div>
          )}
          <div className="table-wrap">
            <table className="table an-skutable">
              <thead><tr>
                <th scope="col">Item</th><th scope="col">Group</th><th scope="col" className="num">12 months</th><th scope="col">By month</th>
                <th scope="col" className="num">Price per kg</th><th scope="col" className="num">Vs going rate</th><th scope="col">Last order</th>
              </tr></thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.item_no}>
                    <td><Link to={withTo(`/analysis/sku/${encodeURIComponent(i.item_no)}`, end)}>{i.description}</Link>
                      <span className="muted small"> {i.item_no}</span>
                      {i.change && <span className={`pill ${i.change === 'dropped' ? 'warn' : 'muted'}`}>{i.change === 'dropped' ? 'Stopped' : 'New'}</span>}
                      {Number(i.free_qty) > 0 && <span className="muted small"> · {qtyOf(i.free_qty, i.is_kg ? 'KG' : i.uom)} free</span>}</td>
                    <td className="an-groupcell"><span className="key-rect" style={{ background: groupColor(i.grp) }} /> {i.grp}</td>
                    <td className="num">{qtyOf(i.total_qty, i.is_kg ? 'KG' : i.uom)}</td>
                    <td><Spark values={i.qty} /></td>
                    <td className="num">{i.is_kg ? money(i.price_all) : <span className="muted small">{money(i.price_all)} / {i.uom}</span>}</td>
                    <td className="num" title="Against all customers' price for the same item in the same months">{vs(i.vs_pct)}</td>
                    <td>{dmy(i.last_on)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Open invoices and when to expect them</h2>
      {d.invoices.length === 0 ? <p className="muted">Nothing open.</p> : (
        <>
          <p className="muted small">LKR {money(expected)} still to come. Each invoice is dated by {BASIS.promise} where there is one, then by {BASIS.habit}
            {d.invoices[0]?.habit_days != null ? ` (${d.invoices[0].habit_days} days from the invoice date)` : ''}, otherwise {BASIS['due date']}.</p>
          <div className="table-wrap">
            <table className="table an-invtable">
              <thead><tr><th scope="col">Invoice</th><th scope="col">Posted</th><th scope="col">Due</th><th scope="col" className="num">Open</th>
                <th scope="col" className="num">In the app</th><th scope="col">Expected</th><th scope="col">Based on</th></tr></thead>
              <tbody>{d.invoices.map((i) => (
                <tr key={i.document_no}><td>{i.document_no}</td><td>{dmy(i.posting_date)}</td><td>{dmy(i.due_date)}</td><td className="num">{money(i.remaining)}</td>
                  <td className="num">{Number(i.in_app) ? money(i.in_app) : ''}</td><td>{dmy(i.expected_on)}</td><td>{BASIS[i.basis]}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </AnPage>
  );
}
