import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { IS_DEMO, openAnalysis, rpc } from '../../lib/supabase';
import { dmy, mLong } from '../../lib/analysis';
import { Spark } from '../../components/Charts';

// What has been uploaded, the settings and the windows that can be chosen. Loaded once and kept for a minute.
let cached = null;
export function useAnStatus() {
  const [status, setStatus] = useState(cached?.data ?? null);
  const [error, setError] = useState('');
  const load = useCallback(async (force = false) => {
    if (!force && cached && Date.now() - cached.at < 60000) { setStatus(cached.data); return cached.data; }
    try { const d = await rpc('cc_an_status'); cached = { at: Date.now(), data: d }; setStatus(d); setError(''); return d; } catch (e) { setError(e.message); return null; }
  }, []);
  useEffect(() => { if (!IS_DEMO) load(); }, [load]);
  return { status, error, reload: () => load(true) };
}

// The window's last month, kept in the address (?to=2026-10) so a link opens the same view.
export function useEndMonth() {
  const [sp, setSp] = useSearchParams();
  const to = sp.get('to');
  const end = to && /^\d{4}-\d{2}$/.test(to) ? `${to}-01` : null;
  const set = (iso) => { const n = new URLSearchParams(sp); if (iso) n.set('to', iso.slice(0, 7)); else n.delete('to'); setSp(n, { replace: true }); };
  return [end, set];
}
export const withTo = (path, end) => (end ? `${path}${path.includes('?') ? '&' : '?'}to=${end.slice(0, 7)}` : path);

export function WindowPicker({ status, end, onChange }) {
  const list = status?.end_months ?? [];
  const value = end ?? status?.default_end ?? '';
  if (!list.length) return null;
  return (
    <label className="field inline an-window">
      <span className="flabel">12 months to</span>
      <select value={value} onChange={(e) => onChange(e.target.value === status.default_end ? null : e.target.value)} aria-label="12 months to">
        {list.map((m) => <option key={m} value={m}>{mLong(m)}{m === status.default_end ? ' (last full month)' : ''}</option>)}
      </select>
    </label>
  );
}

// The page frame: Analysis reads live data, and only finance and management can open it.
export function AnPage({ title, lede, children, actions, wide = true }) {
  if (IS_DEMO) {
    return (
      <section className="narrow">
        <h1>Analysis</h1>
        <div className="notice">
          <p>Analysis always reads live data, so it isn't part of Demo.</p>
          <button type="button" className="btn primary" onClick={() => openAnalysis(window.location.pathname)}>Open Analysis on live</button>
        </div>
      </section>
    );
  }
  return (
    <section className={`${wide ? 'wide ' : ''}an-page`}>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {lede && <p className="lede">{lede}</p>}
        </div>
        {actions && <div className="an-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function DataNote({ status }) {
  if (!status) return null;
  const e = status.entries;
  if (!e?.n) {
    return (
      <div className="notice an-nodata">
        <p><strong>No item ledger entries yet.</strong> Quantities, SKUs and prices need BC's Item Ledger Entries.{' '}
          {status.can?.change ? <Link to="/analysis/uploads">Upload them on Uploads</Link> : 'Finance uploads them on Uploads.'}</p>
      </div>
    );
  }
  return (
    <p className="muted small an-datanote">Local customers only. Customer ledger to {dmy(status.ledger?.last)}; item ledger {dmy(e.first)} to {dmy(e.last)}.
      {' '}Amounts are LKR.</p>
  );
}

export function Tile({ label, value, sub, spark, color, to }) {
  const body = (
    <>
      <span className="an-tile-label">{label}</span>
      <span className="an-tile-value">{value}</span>
      {sub && <span className="an-tile-sub">{sub}</span>}
      {spark && <Spark values={spark} width={110} height={26} color={color} />}
    </>
  );
  return to ? <Link className="an-tile link" to={to}>{body}</Link> : <div className="an-tile">{body}</div>;
}

export function Loading({ error, what = 'Loading…' }) {
  if (error) return <p className="error">{error}</p>;
  return <p className="muted">{what}</p>;
}

// Pills for the watchlists a customer is on.
export function WatchPills({ watch }) {
  if (!watch?.length) return null;
  const txt = (w) => (w.kind === 'slower' ? `Paying ${Math.round(w.slower_by)} days slower`
    : w.kind === 'less' ? (w.reason === 'quiet' ? `No order for ${w.days_since} days` : `Buying ${Math.abs(Math.round(w.change_pct))}% less`)
      : 'Billed more than collected');
  return <span className="an-pills">{watch.map((w) => <span key={w.kind} className="pill warn">{txt(w)}</span>)}</span>;
}
