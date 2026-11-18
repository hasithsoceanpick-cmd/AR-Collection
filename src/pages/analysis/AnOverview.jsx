import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../../lib/supabase';
import { compact, downloadOverview, groupColor, groupOrder, kg, money, mShort, num0, num1, pct, PALETTE, windowLabel } from '../../lib/analysis';
import { Columns, Lines } from '../../components/Charts';
import { AnPage, DataNote, Loading, Tile, useAnStatus, useEndMonth, WindowPicker, withTo } from './AnCommon';

// Analysis → Overview: the 12 months at a glance, the watchlists and the next 4 weeks' expected cash.
export default function AnOverview() {
  const { status } = useAnStatus();
  const [end, setEnd] = useEndMonth();
  const [ov, setOv] = useState(null);
  const [side, setSide] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    rpc('cc_an_overview', { p_end: end }).then((d) => { if (live) setOv(d); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [end]);
  useEffect(() => {
    let live = true;
    Promise.all([rpc('cc_an_watchlists'), rpc('cc_an_forecast')]).then(([wl, fc]) => { if (live) setSide({ wl, fc }); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const labels = ov?.months.map(mShort) ?? [];
  const bm = ov?.by_month ?? [];
  const fishGroups = (ov?.groups ?? []).filter((g) => g.is_kg && g.grp !== 'By-products').sort(groupOrder);
  const byp = (ov?.groups ?? []).find((g) => g.grp === 'By-products');
  const others = (ov?.groups ?? []).filter((g) => !g.is_kg);
  const next4 = side ? side.fc.weeks.reduce((a, w) => a + Number(w.amount), 0) : null;
  return (
    <AnPage title="Analysis" lede={ov ? `Local customers, ${windowLabel(ov.months)}.` : 'Local customers.'}
      actions={<>
        <WindowPicker status={status} end={end} onChange={setEnd} />
        <button type="button" className="btn" disabled={!ov} onClick={() => downloadOverview(ov, status)}>Download Excel</button>
      </>}>
      <DataNote status={status} />
      {!ov ? <Loading error={error} /> : (
        <>
          <div className="an-tiles">
            <Tile label="Billed" value={`LKR ${compact(ov.year.billed)}`} sub="invoices less credit notes" spark={bm.map((m) => m.billed)} />
            <Tile label="Collected" value={`LKR ${compact(ov.year.collected)}`} sub={`${pct(ov.year.cvb_pct)} of billed`} spark={bm.map((m) => m.collected)} />
            <Tile label="Paid on time" value={pct(ov.year.on_time_pct)} sub="of invoices due, by value" spark={bm.map((m) => m.on_time_pct)} />
            <Tile label="Days to pay" value={num0(ov.year.days)} sub="average, weighted by amount" spark={bm.map((m) => m.days)} />
            <Tile label="Fish products" value={kg(ov.year.fish_kg)} sub={`${num0(ov.year.customers)} customers bought or were billed`} spark={bm.map((m) => m.fish_kg)} />
            <Tile label="By-products" value={kg(ov.year.byp_kg)} spark={bm.map((m) => m.byp_kg)} />
          </div>
          <div className="an-tiles an-tiles-links">
            <Tile to="/analysis/forecast" label="Expected in the next 4 weeks" value={next4 == null ? '…' : `LKR ${compact(next4)}`}
              sub={side ? `${side.fc.weeks.reduce((a, w) => a + w.n, 0)} invoices, by how each customer pays` : ''} />
            <Tile to="/analysis/watchlists?list=slower" label="Paying slower" value={side ? num0(side.wl.slower.length) : '…'} sub="customers, last 3 months vs 12" />
            <Tile to="/analysis/watchlists?list=less" label="Buying less" value={side ? num0(side.wl.less.length) : '…'} sub="regular buyers, last 30 days" />
            <Tile to="/analysis/watchlists?list=gap" label="Billed more than collected" value={side ? num0(side.wl.gap.length) : '…'} sub="customers, last 3 months" />
          </div>
          <div className="an-grid2">
            <Columns title="Billed and collected by month (LKR)" labels={labels} fmt={money}
              series={[{ name: 'Billed', color: PALETTE[0], values: bm.map((m) => m.billed) }, { name: 'Collected', color: PALETTE[1], values: bm.map((m) => m.collected) }]} />
            <Lines title="How invoices were paid (%)" labels={labels} fmt={pct} yFmt={(v) => `${v}%`} yMax={100}
              series={[{ name: '% paid on time', color: PALETTE[0], values: bm.map((m) => m.on_time_pct) },
                { name: '% paid so far', color: PALETTE[1], values: bm.map((m) => m.paid_pct) },
                { name: 'Collected vs billed', color: PALETTE[2], values: bm.map((m) => m.cvb_pct) }]}
              note="Paid on time and paid so far follow each month's invoices; collected vs billed compares the month's receipts with its invoices." />
            <Columns stack title="Fish products by group (kg)" labels={labels} fmt={(v) => kg(v)} yFmt={compact}
              series={fishGroups.map((g) => ({ name: g.grp, color: groupColor(g.grp), values: g.qty }))} />
            <Lines title="Days to pay, by the month paid" labels={labels} fmt={(v) => (v == null ? '—' : `${num0(v)} days`)} yFmt={(v) => num0(v)}
              series={[{ name: 'Days to pay', color: PALETTE[0], values: bm.map((m) => m.days) }]}
              note="Clearing old invoices pushes a month up: open the customers to see who." />
          </div>
          {(byp || others.length > 0) && (
            <div className="an-grid2">
              {byp && <Columns title="By-products (kg)" labels={labels} fmt={(v) => kg(v)} series={[{ name: 'By-products', color: groupColor('By-products'), values: byp.qty }]} />}
              {others.map((g) => (
                <Columns key={g.grp} title={`${g.grp} (${g.uom})`} labels={labels} fmt={(v) => `${num1(v)} ${g.uom}`}
                  series={[{ name: g.grp, color: groupColor(g.grp), values: g.qty }]} />
              ))}
            </div>
          )}
          <p className="an-next"><Link to={withTo('/analysis/customers', end)}>Customers month by month</Link> · <Link to={withTo('/analysis/skus', end)}>SKUs and prices</Link></p>
        </>
      )}
    </AnPage>
  );
}
