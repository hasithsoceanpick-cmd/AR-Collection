import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc } from '../../lib/supabase';
import { dmy, downloadWatchlists, kg, money, num0, num1, rangeText } from '../../lib/analysis';
import { AnPage, DataNote, Loading, ModeNote, useAnMode, useAnStatus } from './AnCommon';

const LISTS = [['slower', 'Paying slower'], ['less', 'Buying less'], ['gap', 'Billed more than collected']];
const cust = (r) => (
  <td><Link to={`/analysis/customer/${encodeURIComponent(r.customer_no)}`}>{r.name}</Link>
    <span className="muted small"> {r.customer_no}{r.grp ? ` · ${r.grp}` : ''}{r.owner ? ` · ${r.owner}` : ''}</span></td>
);

// Finance sets when a customer goes on a list.
function Settings({ s, onSaved }) {
  const [v, setV] = useState({ less_pct: s.less_pct, quiet_days: s.quiet_days, slower_days: s.slower_days, gap_min: s.gap_min });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await rpc('cc_an_settings_set', { p_less_pct: Number(v.less_pct), p_quiet_days: Number(v.quiet_days), p_slower_days: Number(v.slower_days), p_gap_min: Number(v.gap_min) });
      await onSaved();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form className="an-settings" onSubmit={save}>
      <label className="field"><span className="flabel">Buying less: kg down by (%)</span><input type="number" min="5" max="95" value={v.less_pct} onChange={set('less_pct')} /></label>
      <label className="field"><span className="flabel">or no order for (days)</span><input type="number" min="7" max="90" value={v.quiet_days} onChange={set('quiet_days')} /></label>
      <label className="field"><span className="flabel">Paying slower by (days)</span><input type="number" min="1" max="90" value={v.slower_days} onChange={set('slower_days')} /></label>
      <label className="field"><span className="flabel">Billed above collected by (LKR, 3 months)</span><input type="number" min="0" step="1000" value={v.gap_min} onChange={set('gap_min')} /></label>
      <div className="an-settings-act">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="link" type="button" onClick={() => onSaved(false)} disabled={busy}>Cancel</button>
      </div>
      {err && <p className="error small">{err}</p>}
    </form>
  );
}

// Analysis → Watchlists: customers paying slower, buying less, or billed more than they pay.
export default function AnWatchlists() {
  const { status, reload } = useAnStatus();
  const [sp, setSp] = useSearchParams();
  const list = LISTS.some(([k]) => k === sp.get('list')) ? sp.get('list') : 'slower';
  const [mode] = useAnMode();
  const [wl, setWl] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => rpc('cc_an_watchlists', { p_mode: mode }).then((d) => { setWl(d); setError(''); }).catch((e) => setError(e.message)), [mode]);
  useEffect(() => { load(); }, [load]);
  const s = wl?.settings;
  return (
    <AnPage title="Watchlists" lede="Customers whose buying or paying has changed."
      actions={<button type="button" className="btn" disabled={!wl} onClick={() => downloadWatchlists(wl, status)}>Download Excel</button>}>
      <ModeNote data={wl} />
      <DataNote status={status} />
      {!wl ? <Loading error={error} /> : (
        <>
          <div className="tabs" role="tablist" aria-label="Watchlist">
            {LISTS.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={list === k} className={`tab${list === k ? ' on' : ''}`}
                onClick={() => setSp(k === 'slower' ? {} : { list: k }, { replace: true })}>{l} ({wl[k].length})</button>
            ))}
          </div>
          <div className="an-rule">
            {list === 'slower' && <p>Days to pay from {rangeText(wl.recent_from, wl.to)} at least <strong>{s.slower_days} days</strong> more than over the
              12 months ({rangeText(wl.from, wl.to)}), from 2 payments lately and 4 in the year. Clearing an old invoice counts too: open the customer to see which.</p>}
            {list === 'less' && <p>Regular buyers (orders on 3 or more days in the 90 days before) whose kg in the 30 days to {dmy(wl.anchor)} is at least
              <strong> {s.less_pct}% below</strong> their 30-day average, or who haven't ordered for <strong>{s.quiet_days} days</strong>.</p>}
            {list === 'gap' && <p>Billed at least <strong>LKR {money(s.gap_min)}</strong> more than collected from {rangeText(wl.recent_from, wl.to)},
              with the balance higher at the end than before.</p>}
            {status?.can?.change && !editing && <button type="button" className="link small" onClick={() => setEditing(true)}>Change these limits</button>}
          </div>
          {editing && <Settings s={s} onSaved={async (saved) => { setEditing(false); if (saved !== false) { await load(); await reload(); } }} />}
          <div className="table-wrap">
            {list === 'slower' && (
              <table className="table">
                <thead><tr><th scope="col">Customer</th><th scope="col" className="num">Days to pay lately</th><th scope="col" className="num">Usual</th>
                  <th scope="col" className="num">Slower by</th><th scope="col" className="num">Payments lately / in 12 months</th></tr></thead>
                <tbody>{wl.slower.map((r) => (
                  <tr key={r.customer_no}>{cust(r)}<td className="num">{num0(r.recent_days)}</td><td className="num">{num0(r.usual_days)}</td>
                    <td className="num"><strong>{num0(r.slower_by)} days</strong></td><td className="num">{r.recent_n} / {r.usual_n}</td></tr>
                ))}</tbody>
              </table>
            )}
            {list === 'less' && (
              <table className="table">
                <thead><tr><th scope="col">Customer</th><th scope="col" className="num">Last 30 days</th><th scope="col" className="num">Usual per 30 days</th>
                  <th scope="col" className="num">Change</th><th scope="col">Last order</th></tr></thead>
                <tbody>{wl.less.map((r) => (
                  <tr key={r.customer_no}>{cust(r)}<td className="num">{kg(r.recent_kg)}</td><td className="num">{kg(r.usual_kg)}</td>
                    <td className="num"><strong>{r.reason === 'quiet' ? `No order for ${r.days_since} days` : `${num1(r.change_pct)}%`}</strong></td>
                    <td>{dmy(r.last_on)}</td></tr>
                ))}</tbody>
              </table>
            )}
            {list === 'gap' && (
              <table className="table">
                <thead><tr><th scope="col">Customer</th><th scope="col" className="num">Billed</th><th scope="col" className="num">Collected</th><th scope="col" className="num">Gap</th>
                  <th scope="col" className="num">Balance before</th><th scope="col" className="num">Balance at the end</th></tr></thead>
                <tbody>{wl.gap.map((r) => (
                  <tr key={r.customer_no}>{cust(r)}<td className="num">{money(r.billed)}</td><td className="num">{money(r.collected)}</td>
                    <td className="num"><strong>{money(r.gap)}</strong></td><td className="num">{money(r.bal_before)}</td><td className="num">{money(r.bal_now)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
          {wl[list].length === 0 && <p className="muted">Nobody on this list.</p>}
        </>
      )}
    </AnPage>
  );
}
