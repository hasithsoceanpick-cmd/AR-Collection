import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../../lib/supabase';
import { compact, dmy, downloadSkus, groupColor, groupOrder, kg, money, num0, num1, periods, qtyOf } from '../../lib/analysis';
import { Columns, Spark } from '../../components/Charts';
import { AnPage, DataNote, Loading, ModeNote, useAnMode, useAnStatus } from './AnCommon';

// Finance moves an item to another group (or a new one); an empty choice goes back to the group worked out from its description.
function GroupEdit({ item, names, onDone }) {
  const [v, setV] = useState(item.grp_set ? item.grp : '');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await rpc('cc_an_group_set', { p_item_no: item.item_no, p_grp: v === '__new' ? other : v }); await onDone(); } catch (x) { setErr(x.message); setBusy(false); }
  }
  return (
    <form className="an-groupedit" onSubmit={save}>
      <select value={v} onChange={(e) => setV(e.target.value)} aria-label={`Group for ${item.item_no}`} autoFocus>
        <option value="">{item.grp_default} (from the description)</option>
        {names.filter((n) => n !== item.grp_default).map((n) => <option key={n} value={n}>{n}</option>)}
        <option value="__new">New group…</option>
      </select>
      {v === '__new' && <input value={other} maxLength={40} onChange={(e) => setOther(e.target.value)} placeholder="Group name" aria-label="New group name" />}
      <button className="btn small primary" type="submit" disabled={busy || (v === '__new' && !other.trim())}>{busy ? 'Saving…' : 'Save'}</button>
      <button className="link small" type="button" onClick={() => onDone(false)} disabled={busy}>Cancel</button>
      {err && <span className="error small">{err}</span>}
    </form>
  );
}

// Analysis → SKUs: kg by group and item, price per kg, and customers whose mix changed.
export default function AnSkus() {
  const { status } = useAnStatus();
  const [mode] = useAnMode();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [grp, setGrp] = useState('');
  const [editing, setEditing] = useState(null);
  const load = useCallback(async () => {
    try { setD(await rpc('cc_an_skus', { p_mode: mode })); setError(''); } catch (e) { setError(e.message); }
  }, [mode]);
  useEffect(() => { setD(null); load(); }, [load]);

  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (d?.items ?? []).filter((i) => (!t || `${i.item_no} ${i.description}`.toLowerCase().includes(t)) && (!grp || i.grp === grp))
      .sort((a, b) => Number(b.total_amount) - Number(a.total_amount));
  }, [d, q, grp]);
  const [all, setAll] = useState(false);
  const per = d ? periods(d.months, d.from, d.to) : [];
  const labels = per.map((x) => x.label); const titles = per.map((x) => x.title);
  const kgGroups = (d?.groups ?? []).filter((g) => g.is_kg);
  const fish = kgGroups.filter((g) => g.grp !== 'By-products').sort(groupOrder);
  return (
    <AnPage title="SKUs" lede={d ? `What local customers bought. Groups are worked out from each item's description${d.can.change ? '; change one with Change group' : ''}.` : 'What local customers bought.'}
      actions={<>
        <button type="button" className="btn" disabled={!d} onClick={() => downloadSkus(d, status)}>Download Excel</button>
      </>}>
      <ModeNote data={d} />
      <DataNote status={status} />
      {!d ? <Loading error={error} /> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Group</th><th scope="col" className="num">12 months</th><th scope="col" className="num">Sales (excl. VAT)</th>
                <th scope="col" className="num">Customers</th><th scope="col">By month</th></tr></thead>
              <tbody>{d.groups.map((g) => (
                <tr key={`${g.grp}-${g.is_kg}`}>
                  <th scope="row"><span className="key-rect" style={{ background: groupColor(g.grp) }} /> {g.grp}</th>
                  <td className="num">{qtyOf(g.total_qty, g.is_kg ? 'KG' : g.uom)}</td><td className="num">{money(g.total_amount)}</td>
                  <td className="num">{num0(g.customers)}</td><td><Spark values={g.qty} color={groupColor(g.grp)} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="an-grid2">
            {fish.length > 0 && <Columns stack title="Fish products by group (kg)" labels={labels} titles={titles} fmt={(v) => kg(v)}
              series={fish.map((g) => ({ name: g.grp, color: groupColor(g.grp), values: g.qty }))} />}
            {kgGroups.filter((g) => g.grp === 'By-products').map((g) => (
              <Columns key={g.grp} title="By-products (kg)" labels={labels} titles={titles} fmt={(v) => kg(v)} series={[{ name: g.grp, color: groupColor(g.grp), values: g.qty }]} />
            ))}
          </div>

          <h2>Items</h2>
          <div className="filters">
            <input className="search" type="search" placeholder="Search item number or description" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
            <select value={grp} onChange={(e) => setGrp(e.target.value)} aria-label="Group">
              <option value="">Every group</option>
              {d.groups.map((g) => <option key={`${g.grp}-${g.is_kg}`} value={g.grp}>{g.grp}</option>)}
            </select>
          </div>
          <div className="table-wrap">
            <table className="table an-items">
              <thead><tr><th scope="col">Item</th><th scope="col">Group</th><th scope="col" className="num">Customers</th><th scope="col" className="num">12 months</th>
                <th scope="col" className="num">Sales (excl. VAT), largest first</th><th scope="col" className="num">Price per kg</th><th scope="col">Price by month</th><th scope="col">Last sale</th></tr></thead>
              <tbody>{(all ? items : items.slice(0, 30)).map((i) => (
                <tr key={i.item_no}>
                  <td><Link to={`/analysis/sku/${encodeURIComponent(i.item_no)}`}>{i.description}</Link><span className="muted small"> {i.item_no}</span></td>
                  <td>{editing === i.item_no
                    ? <GroupEdit item={i} names={d.group_names} onDone={async (saved = true) => { setEditing(null); if (saved !== false) await load(); }} />
                    : <><span className="key-rect" style={{ background: groupColor(i.grp) }} /> {i.grp}{i.grp_set && <span className="muted small"> (set by finance)</span>}
                      {d.can.change && <> <button type="button" className="link small" onClick={() => setEditing(i.item_no)} aria-label={`Change group: ${i.item_no}`}>Change group</button></>}</>}
                  </td>
                  <td className="num">{num0(i.customers)}</td>
                  <td className="num">{qtyOf(i.total_qty, i.is_kg ? 'KG' : i.uom)}</td>
                  <td className="num">{compact(i.total_amount)}</td>
                  <td className="num">{i.is_kg ? money(i.price_all) : <span className="small">{money(i.price_all)} / {i.uom}</span>}</td>
                  <td><Spark values={i.price} color={groupColor(i.grp)} /></td>
                  <td>{dmy(i.last_on)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          {items.length > 30 && !all && <button type="button" className="btn" onClick={() => setAll(true)}>Show all {items.length} items</button>}
          <h2>Customers whose mix changed</h2>
          <p className="muted small">Items bought in 3 or more months before {dmy(d.recent_from)} and none since, or a group's share of the customer's kg moving 20 points or more.</p>
          {d.mix.length === 0 ? <p className="muted">No changes.</p> : (
            <div className="table-wrap">
              <table className="table an-mixtable">
                <thead><tr><th scope="col">Customer</th><th scope="col">Stopped buying</th><th scope="col">Started buying</th><th scope="col">Share of kg, before {dmy(d.recent_from)} → since</th></tr></thead>
                <tbody>{d.mix.map((m) => (
                  <tr key={m.customer_no}>
                    <td><Link to={`/analysis/customer/${encodeURIComponent(m.customer_no)}`}>{m.name}</Link><span className="muted small"> {m.customer_no}</span></td>
                    <td>{m.dropped.length ? m.dropped.map((x) => <div key={x.item_no}>{x.description} <span className="muted small">({num1(x.qty_before)} kg, last {dmy(x.last_on)})</span></div>) : <span className="muted">—</span>}</td>
                    <td>{m.added.length ? m.added.map((x) => <div key={x.item_no}>{x.description}</div>) : <span className="muted">—</span>}</td>
                    <td>{m.shift ? m.shift.filter((g) => g.before || g.now).map((g) => <div key={g.grp}>{g.grp} {Math.round(g.before)}% → {Math.round(g.now)}%</div>) : <span className="muted">—</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AnPage>
  );
}
