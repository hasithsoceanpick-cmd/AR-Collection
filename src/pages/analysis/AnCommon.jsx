import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IS_DEMO, openAnalysis, rpc } from '../../lib/supabase';
import { dmy, MODES, modeLabel, rangeText } from '../../lib/analysis';
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

// Which 12 months: to date (the default) or to the last complete month. Chosen on the Overview and remembered in this
// browser, so every Analysis page uses the same one.
const MODE_KEY = 'cc-an-mode';
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'month' ? 'month' : 'todate'; } catch { return 'todate'; } };
export function useAnMode() {
  const [mode, setMode] = useState(readMode);
  const set = (m) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* the choice just isn't remembered */ } setMode(m); };
  return [mode, set];
}

export function ModePicker({ mode, onChange, status }) {
  return (
    <div className="an-mode">
      <div className="tabs" role="tablist" aria-label="Which 12 months">
        {MODES.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} className={`tab${mode === k ? ' on' : ''}`} onClick={() => onChange(k)}>
            {l}{status?.windows?.[k] && <span className="an-mode-dates">{rangeText(status.windows[k].from, status.windows[k].to)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// On the other pages: which 12 months are shown, and where to change it.
export function ModeNote({ data }) {
  if (!data?.from) return null;
  return (
    <p className="an-modenote small"><strong>{modeLabel(data.mode)}</strong>: {rangeText(data.from, data.to)} · <Link to="/analysis">Change on the Overview</Link></p>
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
