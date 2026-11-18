import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpc } from '../../lib/supabase';
import { dmy, downloadSku, groupColor, money, mShort, num0, num1, PALETTE, qtyOf, windowLabel } from '../../lib/analysis';
import { Columns, Lines, Spark } from '../../components/Charts';
import { AnPage, Loading, useAnStatus, useEndMonth, WindowPicker, withTo } from './AnCommon';

const vs = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${num1(v)}%`);

// Analysis → one SKU: the going rate month by month, and each customer's quantity and price against it.
export default function AnSku() {
  const { item } = useParams();
  const { status } = useAnStatus();
  const [end, setEnd] = useEndMonth();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('qty');
  useEffect(() => {
    let live = true;
    setError(''); setD(null);
    rpc('cc_an_sku', { p_item: item, p_end: end }).then((x) => { if (live) setD(x); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [item, end]);
  if (!d) return <AnPage title="SKU"><Loading error={error} /></AnPage>;
  const it = d.item; const unit = it.is_kg ? 'kg' : it.uom; const labels = d.months.map(mShort);
  const rows = [...d.customers].sort(sort === 'price' ? (a, b) => (a.vs_pct ?? 999) - (b.vs_pct ?? 999) : (a, b) => b.total_qty - a.total_qty);
  return (
    <AnPage title={it.description} lede={<>{it.item_no} · <span className="key-rect" style={{ background: groupColor(it.grp) }} /> {it.grp} · {windowLabel(d.months)}</>}
      actions={<>
        <WindowPicker status={status} end={end} onChange={setEnd} />
        <button type="button" className="btn" onClick={() => downloadSku(d, status)}>Download Excel</button>
      </>}>
      <p className="an-crumbs small"><Link to={withTo('/analysis/skus', end)}>All SKUs</Link></p>
      <div className="an-grid2">
        <Lines title={`Going rate per ${unit} (LKR, excl. VAT)`} labels={labels} fmt={money} yFmt={num0}
          series={[{ name: 'Going rate', color: groupColor(it.grp), values: d.by_month.avg }]}
          note={`All local customers' sales amount ÷ ${unit} on priced sale lines. 12 months: LKR ${money(d.price_all)} per ${unit}.`} />
        <Columns title={`Sold by month (${unit})`} labels={labels} fmt={(v) => qtyOf(v, it.is_kg ? 'KG' : it.uom)}
          series={[{ name: 'Sold', color: PALETTE[0], values: d.by_month.qty }]} />
      </div>
      <h2>Customers</h2>
      <div className="filters">
        <label className="field inline"><span className="flabel">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort customers">
            <option value="qty">Most bought first</option><option value="price">Lowest price against the going rate first</option>
          </select></label>
      </div>
      <div className="table-wrap">
        <table className="table an-skucust">
          <thead><tr><th scope="col">Customer</th><th scope="col" className="num">12 months</th><th scope="col">By month</th><th scope="col" className="num">Months</th>
            <th scope="col" className="num">Price per {unit}</th><th scope="col" className="num">Vs going rate</th><th scope="col" className="num">Free</th><th scope="col">Last order</th></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.customer_no}>
              <td><Link to={withTo(`/analysis/customer/${encodeURIComponent(c.customer_no)}`, end)}>{c.name}</Link><span className="muted small"> {c.customer_no}{c.grp ? ` · ${c.grp}` : ''}</span></td>
              <td className="num">{qtyOf(c.total_qty, it.is_kg ? 'KG' : it.uom)}</td>
              <td><Spark values={c.qty} color={groupColor(it.grp)} /></td>
              <td className="num">{c.months}</td>
              <td className="num">{money(c.price_all)}</td>
              <td className="num" title="Against all customers' price for this item in the same months, weighted by what this customer bought">{vs(c.vs_pct)}</td>
              <td className="num">{Number(c.free_qty) ? num1(c.free_qty) : ''}</td>
              <td>{dmy(c.last_on)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </AnPage>
  );
}
