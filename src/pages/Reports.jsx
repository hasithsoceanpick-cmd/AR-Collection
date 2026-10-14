import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { supabase, rpc, db, SCHEMA } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { STATUS, TAGS, KIND_LABEL } from '../lib/workflow';
import { lkr, ref, fmtDate, fmtDateTime, todayISO, daysAgo } from '../lib/format';
import { TILE_URL, TILE_ATTR } from '../components/MapPicker';
import StatusStamp from '../components/StatusStamp';
import { SalesReminderForm } from '../components/Reminders';

const MAP_COLORS = { submitted: '#E68A2E', assigned: '#2E3A87', collected: '#3E9FD6' };
const MAP_LABELS = { submitted: 'Waiting for a driver', assigned: 'Assigned', collected: 'Collected, still with the driver' };

function FitAll({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 14);
    else if (points.length > 1) map.fitBounds(points, { padding: [30, 30], maxZoom: 15 });
  }, [points, map]);
  return null;
}

function MapReport() {
  const { role, session, isAdmin } = useAuth();
  const [rows, setRows] = useState(null);
  const [show, setShow] = useState({ submitted: true, assigned: true, collected: true });
  const [driver, setDriver] = useState(role === 'driver' && !isAdmin ? session.user.id : '');
  const [when, setWhen] = useState(role === 'driver' ? 'today' : 'all');

  const [err, setErr] = useState('');
  const load = useCallback(() => rpc('cc_report_map').then((r) => { setErr(''); setRows(r); }).catch((e) => { setErr(e.message); setRows([]); }), []);
  useEffect(() => {
    load();
    const ch = supabase.channel('report-map').on('postgres_changes', { event: '*', schema: SCHEMA, table: 'collections' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const drivers = useMemo(() => {
    const m = new Map();
    for (const r of rows ?? []) if (r.driver_id) m.set(r.driver_id, r.driver);
    return [...m.entries()];
  }, [rows]);

  const today = todayISO();
  const filtered = (rows ?? []).filter((r) => show[r.status]
    && (!driver || r.driver_id === driver)
    && (when === 'all' || (when === 'today' && r.collection_date === today) || (when === 'overdue' && r.collection_date && r.collection_date < today)));
  const pinned = filtered.filter((r) => r.lat != null && r.lng != null);
  const unpinned = filtered.filter((r) => r.lat == null || r.lng == null);
  const points = useMemo(() => pinned.map((r) => [r.lat, r.lng]), [pinned.length, driver, when, show]); // eslint-disable-line
  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <>
      <div className="list-tools">
        <div className="legend">
          {Object.keys(MAP_COLORS).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} />
              <span className="dotkey" style={{ background: MAP_COLORS[k] }} /> {MAP_LABELS[k]}
            </label>
          ))}
        </div>
        <div className="row">
          <select value={driver} onChange={(e) => setDriver(e.target.value)} aria-label="Driver">
            <option value="">All drivers</option>
            {drivers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
          <select value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Collection date">
            <option value="all">Any date</option><option value="today">Today</option><option value="overdue">Overdue</option>
          </select>
        </div>
      </div>
      {err && <p className="error">Couldn't load the map: {err}</p>}
      <p className="hint">{filtered.length} cheque{filtered.length === 1 ? '' : 's'}, LKR {lkr(total)}.</p>
      <div className="map map-report">
        <MapContainer center={[7.2, 80.4]} zoom={8} scrollWheelZoom>
          <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
          <FitAll points={points} />
          {pinned.map((r) => (
            <CircleMarker key={r.id} center={[r.lat, r.lng]} radius={10}
              pathOptions={{ color: '#fff', weight: 2, fillColor: MAP_COLORS[r.status], fillOpacity: 0.95 }}>
              <Popup>
                <strong>{r.customer_name}</strong><br />
                LKR {lkr(r.amount)}<br />
                {MAP_LABELS[r.status]}{r.driver ? `, ${r.driver}` : ''}{r.collection_date ? `, ${fmtDate(r.collection_date)}` : ''}<br />
                <Link to={`/c/${r.id}`}>Open {ref(r.id)}</Link>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      {unpinned.length > 0 && (
        <div className="facts">
          <h2>Not on the map (no pin)</h2>
          <ul className="plain">{unpinned.map((r) => <li key={r.id}><Link to={`/c/${r.id}`}>{ref(r.id)}</Link> {r.customer_name}, LKR {lkr(r.amount)}, {MAP_LABELS[r.status]}</li>)}</ul>
        </div>
      )}
    </>
  );
}

function Reconciliation() {
  const { role } = useAuth();
  const [lines, setLines] = useState(null);
  const [deps, setDeps] = useState([]);
  const [open, setOpen] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [people, setPeople] = useState([]);
  const [reminded, setReminded] = useState({});
  const [remindLine, setRemindLine] = useState(null);
  const [remindAll, setRemindAll] = useState(false);
  const [sentMsg, setSentMsg] = useState(null);
  const [myParked, setMyParked] = useState({});   // Sales: bank line id → my parked payments that could be it

  // Finance: who is in Sales, and when each unidentified line was last reminded about.
  const loadReminders = useCallback(async () => {
    if (role !== 'finance') return;
    const r = await rpc('cc_line_reminders').catch(() => []);
    setReminded(Object.fromEntries((r ?? []).map((x) => [x.line_id ?? 'all', x])));
  }, [role]);
  useEffect(() => {
    if (role !== 'finance') return;
    db.from('profiles').select('id, full_name, email').eq('role', 'sales').eq('active', true).order('full_name').then(({ data }) => setPeople(data ?? []));
    loadReminders();
  }, [role, loadReminders]);
  async function reminderSent(lineId, who) {
    await loadReminders();
    setRemindLine(null); setRemindAll(false);
    setSentMsg({ lineId, text: `Reminder sent to ${who}.` });
  }

  useEffect(() => {
    if (role !== 'sales' || lines === null) return;
    rpc('cc_parked_candidates').then((d) => {
      const m = {};
      for (const p of d ?? []) for (const l of p.lines) (m[l.id] ??= []).push({ ...p, line: l });
      setMyParked(m);
    }).catch(() => setMyParked({}));
  }, [role, lines]);

  const load = useCallback(async () => {
    try {
      const [l, d, o] = await Promise.all([
        db.from('bank_credits').select('*').is('link_kind', null).order('txn_date').limit(1000),
        rpc('cc_report_unlinked_deposits'),
        rpc('cc_report_open'),
      ]);
      if (l.error) throw new Error(l.error.message);
      setLines(l.data ?? []); setDeps(d ?? []); setOpen((o ?? []).filter((x) => x.kind === 'transfer'));
    } catch (e) { setError(`Couldn't load the reconciliation: ${e.message}`); setLines([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function tag(id, t) {
    let note = null;
    if (t === 'other') { note = window.prompt('What is this line? (e.g. loan, refund)'); if (!note) return; }
    setBusy(true); setError('');
    try { await rpc('cc_tag_line', { p_line_id: id, p_tag: t, p_note: note }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (lines === null) return <p className="muted">Loading…</p>;
  const byAcct = lines.reduce((m, l) => ((m[l.account_name] ??= []).push(l), m), {});
  const sum = (a, k) => a.reduce((s, x) => s + Number(x[k]), 0);
  const isCard = (l) => /MERCHANT SLIPS/i.test(l.narration);
  const customerLines = lines.filter((l) => !isCard(l));
  const cols = 5 + (role === 'sales' || role === 'finance' ? 1 : 0) + (role === 'finance' ? 1 : 0);
  const lastAll = reminded.all;

  return (
    <>
      <div className="kpis">
        <div><span>{lines.length}</span>money-in lines not identified<small>LKR {lkr(sum(lines, 'credit'))}</small></div>
        <div><span>{deps.length}</span>deposit slips not yet in the bank<small>LKR {lkr(sum(deps, 'slip_total'))}</small></div>
        <div><span>{open.length}</span>transfers awaiting finance<small>LKR {lkr(sum(open, 'amount'))}</small></div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="facts">
        <h2>Money in the bank, not yet identified</h2>
        <p className="hint">Every one of these should become a receipt in the app, or be tagged by finance as not a customer receipt. HNB merchant settlements (card sales) clear when finance adds the merchant statement that shows their batch.</p>
        {lines.length === 0 && <p className="muted">Everything is identified.</p>}
        {role === 'finance' && customerLines.length > 0 && (
          <div className="remind">
            <p className="remind-what"><strong>{customerLines.length} customer line{customerLines.length === 1 ? '' : 's'} not identified</strong>, LKR {lkr(sum(customerLines, 'credit'))}, the oldest {daysAgo(customerLines[0].txn_date)} days. Remind Sales to check which are their customers' payments.</p>
            {lastAll && <p className="hint">Last reminded by {lastAll.last_by} on {fmtDateTime(lastAll.last_at)} ({lastAll.to_names}).</p>}
            {sentMsg && sentMsg.lineId === null && <p className="ok-text">{sentMsg.text}</p>}
            {remindAll
              ? <SalesReminderForm people={people} onSent={(who) => reminderSent(null, who)} onCancel={() => setRemindAll(false)} />
              : <div className="row"><button className="btn" onClick={() => { setRemindAll(true); setSentMsg(null); }}>Remind Sales about all of them</button></div>}
          </div>
        )}
        {Object.entries(byAcct).map(([acct, ls]) => (
          <div key={acct}>
            <h3 className="subhead">{acct}: {ls.length} lines, LKR {lkr(sum(ls, 'credit'))}</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Narration</th><th>Ref</th><th className="num">LKR</th><th className="num">Days</th>{(role === 'sales' || role === 'finance') && <th></th>}{role === 'finance' && <th>Tag as</th>}</tr></thead>
                <tbody>
                  {ls.map((l) => (
                    <Fragment key={l.id}>
                    <tr>
                      <td>{fmtDate(l.txn_date)}</td><td>{l.narration}</td><td>{l.reference}</td>
                      <td className="num">{lkr(l.credit)}</td><td className="num">{daysAgo(l.txn_date)}</td>
                      {(role === 'sales' || role === 'finance') && <td>{isCard(l)
                        ? <Link className="small" to="/merchant" title="HNB card sales, paid in batches. Finance matches it to a merchant statement batch.">Card batch: merchant statement</Link>
                        : <>
                          {myParked[l.id] ? myParked[l.id].map((p) => (
                            <Link key={p.id} className="btn small primary" to={`/c/${p.id}?line=${l.id}`} title={`Your parked payment from ${p.customer_name}, LKR ${lkr(p.amount)}`}>Match parked {ref(p.id)}</Link>
                          )) : <Link className="btn small" to={`/transfer?line=${l.id}`}>Record</Link>}
                          {role === 'finance' && (
                            <div className="line-remind">
                              <button className="link small" onClick={() => { setRemindLine(remindLine === l.id ? null : l.id); setSentMsg(null); }}>Remind Sales</button>
                              {sentMsg?.lineId === l.id && <span className="ok-text small">{sentMsg.text}</span>}
                              {reminded[l.id] && <span className="muted small">Reminded {fmtDateTime(reminded[l.id].last_at)}{reminded[l.id].to_names !== 'Sales' ? ` (${reminded[l.id].to_names})` : ''}</span>}
                            </div>
                          )}
                        </>}</td>}
                      {role === 'finance' && <td className="tag-btns">{Object.entries(TAGS).map(([k, v]) => <button key={k} className="link" disabled={busy} onClick={() => tag(l.id, k)}>{v}</button>)}</td>}
                    </tr>
                    {remindLine === l.id && (
                      <tr className="remind-row"><td colSpan={cols}>
                        <div className="remind">
                          <p className="remind-what"><strong>Remind Sales about LKR {lkr(l.credit)} on {fmtDate(l.txn_date)}</strong> ({l.narration}). The reminder opens Record transfer on this line.</p>
                          <SalesReminderForm lineId={l.id} people={people} onSent={(who) => reminderSent(l.id, who)} onCancel={() => setRemindLine(null)} />
                        </div>
                      </td></tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="facts">
        <h2>Deposit slips not yet seen in the bank</h2>
        {deps.length === 0 ? <p className="muted">None.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Slip</th><th>Account</th><th>Deposited</th><th className="num">Cheques</th><th className="num">LKR</th><th className="num">Days</th></tr></thead>
            <tbody>{deps.map((d) => (
              <tr key={d.id}><td><Link to={`/deposits#d${d.id}`}>D-{d.id}</Link></td><td>{d.account}</td><td>{fmtDate(d.deposit_date)}</td>
                <td className="num">{d.collections}</td><td className="num">{lkr(d.slip_total)}</td><td className="num">{daysAgo(d.deposit_date)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="facts">
        <h2>Transfers waiting on finance or sales</h2>
        {open.length === 0 ? <p className="muted">None.</p> : (
          <ul className="plain">{open.map((t) => <li key={t.id}><Link to={`/c/${t.id}`}>{ref(t.id)}</Link> {t.customer_name}, LKR {lkr(t.amount)}, {STATUS[t.status]?.label}</li>)}</ul>
        )}
      </div>
    </>
  );
}

const BANDS = [
  { label: '0–2 days', min: 0, max: 2 }, { label: '3–7 days', min: 3, max: 7 },
  { label: '8–14 days', min: 8, max: 14 }, { label: 'Over 14 days', min: 15, max: Infinity },
];

function Ageing() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { rpc('cc_report_open').then(setRows).catch((e) => { setErr(e.message); setRows([]); }); }, []);
  if (rows === null) return <p className="muted">Loading…</p>;
  if (err) return <p className="error">Couldn't load the report: {err}</p>;
  const withAge = rows.map((r) => ({ ...r, age: daysAgo(r.created_at), stage: daysAgo(r.status_at) })).sort((a, b) => b.age - a.age);
  return (
    <>
      <div className="kpis">
        {BANDS.map((b) => {
          const inB = withAge.filter((r) => r.age >= b.min && r.age <= b.max);
          return <div key={b.label}><span>{inB.length}</span>{b.label}<small>LKR {lkr(inB.reduce((s, r) => s + Number(r.amount), 0))}</small></div>;
        })}
      </div>
      {withAge.length === 0 ? <p className="muted">Nothing open.</p> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Item</th><th>Customer</th><th>Type</th><th>Stage</th><th className="num">LKR</th><th className="num">Age (days)</th><th className="num">In this stage</th><th>Driver</th></tr></thead>
          <tbody>{withAge.map((r) => (
            <tr key={r.id} className={r.stage > 5 ? 'stale' : ''}>
              <td><Link to={`/c/${r.id}`}>{ref(r.id)}</Link></td><td>{r.customer_name}</td><td>{KIND_LABEL[r.kind]}</td>
              <td><StatusStamp status={r.status} /></td><td className="num">{lkr(r.amount)}</td>
              <td className="num">{r.age}</td><td className="num">{r.stage}</td><td>{r.driver ?? ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="hint">Rows are highlighted when an item has sat in the same stage for more than 5 days.</p>
    </>
  );
}

function Returned() {
  const { role } = useAuth();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { rpc('cc_report_returned').then(setRows).catch((e) => { setErr(e.message); setRows([]); }); }, []);
  if (rows === null) return <p className="muted">Loading…</p>;
  if (err) return <p className="error">Couldn't load the report: {err}</p>;
  if (rows.length === 0) return <p className="muted">No returned cheques.</p>;
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Item</th><th>Customer</th><th>Cheque</th><th className="num">LKR</th><th>Reason</th><th>Returned</th><th>Replacement</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}>
          <td><Link to={`/c/${r.id}`}>{ref(r.id)}</Link></td><td>{r.customer_name}</td>
          <td>{r.cheque_no}{r.bank ? `, ${r.bank}` : ''}</td><td className="num">{lkr(r.cheque_amount)}</td>
          <td>{r.reason}</td><td>{fmtDate(r.returned_at)}</td>
          <td>{r.replacement_id ? <><Link to={`/c/${r.replacement_id}`}>{ref(r.replacement_id)}</Link> <StatusStamp status={r.replacement_status} /></>
            : (role === 'sales' || role === 'finance') ? <Link to={`/new?replaces=${r.id}`}>Raise replacement</Link> : 'None yet'}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

const TABS = [
  { key: 'map', label: 'Collections map', C: MapReport },
  { key: 'rec', label: 'Bank reconciliation', C: Reconciliation },
  { key: 'age', label: 'Open by age', C: Ageing },
  { key: 'ret', label: 'Returned cheques', C: Returned },
];

export default function Reports() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'recon' ? 'rec' : 'map');
  const T = TABS.find((t) => t.key === tab);
  return (
    <section className="wide">
      <div className="page-head"><h1>Reports</h1></div>
      <div className="tabs report-tabs" role="tablist">
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'tab on' : 'tab'} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      <T.C />
    </section>
  );
}
