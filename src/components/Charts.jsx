import { useLayoutEffect, useRef, useState } from 'react';
import { compact } from '../lib/analysis';

// Small SVG charts for the Analysis pages: thin marks, hairline grid, one axis, legend for 2+ series,
// a hover / keyboard tooltip, and the figures as a table under each chart.

const SURFACE = '#fcfcfb';
const GRID = '#e1e0d9';
const AXIS = '#c3c2b7';
const MUTED = '#898781';

function useWidth(ref, fallback = 640) {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.clientWidth || fallback);
    const ro = new ResizeObserver(() => setW(el.clientWidth || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return w;
}

// Clean ticks from lo to hi (0 always included).
function ticks(lo, hi, n = 4) {
  lo = Math.min(0, lo); hi = Math.max(0, hi);
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
  const t0 = Math.floor(lo / step) * step; const t1 = Math.ceil(hi / step) * step;
  const out = [];
  for (let v = t0; v <= t1 + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

// A column with a 4px rounded data end and a square base.
function colPath(x, w, y0, y1) {
  const up = y1 < y0; const h = Math.abs(y1 - y0);
  if (h < 0.5) return '';
  const r = Math.min(4, w / 2, h);
  if (up) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

function Legend({ series, kind = 'rect' }) {
  if (series.length < 2) return null;
  return (
    <ul className="chart-legend">
      {series.map((s) => (
        <li key={s.name}>
          {kind === 'line' ? <span className="key-line" style={{ background: s.color }} /> : <span className="key-rect" style={{ background: s.color }} />}
          {s.name}
        </li>
      ))}
    </ul>
  );
}

function Tip({ tip, kind }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" role="status" style={{ left: tip.x, top: tip.y, transform: tip.flip ? 'translate(-100%, -100%)' : 'translate(0, -100%)' }}>
      <div className="chart-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.name} className="chart-tip-row">
          <span className={kind === 'line' ? 'key-line' : 'key-rect'} style={{ background: r.color }} />
          <strong>{r.value}</strong><span>{r.name}</span>
        </div>
      ))}
    </div>
  );
}

function TableView({ labels, series, fmt, caption }) {
  return (
    <details className="chart-table">
      <summary>Show the figures</summary>
      <div className="table-wrap">
        <table className="table compact">
          <caption className="sr-only">{caption}</caption>
          <thead><tr><th scope="col">Month</th>{series.map((s) => <th key={s.name} scope="col" className="num">{s.name}</th>)}</tr></thead>
          <tbody>{labels.map((l, i) => (
            <tr key={l}><th scope="row">{l}</th>{series.map((s) => <td key={s.name} className="num">{fmt(s.values[i])}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}

const PAD = { l: 52, r: 12, t: 10, b: 26 };

// Columns side by side for each label (one or two series), or stacked (stack = true).
export function Columns({ title, labels, series, fmt, yFmt = compact, height = 220, stack = false, table = true, note }) {
  const box = useRef(null);
  const W = useWidth(box);
  const [tip, setTip] = useState(null);
  const n = labels.length;
  const H = height;
  const plotW = Math.max(10, W - PAD.l - PAD.r); const plotH = H - PAD.t - PAD.b;
  let lo = 0; let hi = 0;
  if (stack) {
    labels.forEach((_, i) => { let s = 0; series.forEach((se) => { s += Math.max(0, Number(se.values[i]) || 0); }); hi = Math.max(hi, s); });
  } else {
    series.forEach((se) => se.values.forEach((v) => { if (v != null) { lo = Math.min(lo, Number(v)); hi = Math.max(hi, Number(v)); } }));
  }
  const tk = ticks(lo, hi);
  const y = (v) => PAD.t + plotH - ((v - tk[0]) / (tk.at(-1) - tk[0])) * plotH;
  const band = plotW / n;
  const k = stack ? 1 : series.length;
  const bw = Math.max(2, Math.min(24, (band * 0.7 - 2 * (k - 1)) / k));
  const groupW = bw * k + 2 * (k - 1);
  const show = (i, el) => {
    const rect = el.getBoundingClientRect(); const host = box.current.getBoundingClientRect();
    const x = rect.left - host.left + rect.width / 2;
    setTip({ x, y: 4, flip: x > host.width * 0.6, title: labels[i], rows: series.map((s) => ({ name: s.name, color: s.color, value: fmt(s.values[i]) })) });
  };
  const every = n > 8 && W < 520 ? 3 : n > 8 && W < 760 ? 2 : 1;
  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}
      <Legend series={series} />
      <div className="chart-box" ref={box} onMouseLeave={() => setTip(null)}>
        <svg width={W} height={H} role="img" aria-label={title}>
          {tk.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth="1" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">{yFmt(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const x0 = PAD.l + band * i + (band - groupW) / 2;
            let acc = 0;
            return (
              <g key={l}>
                {stack ? series.map((s, j) => {
                  const v = Math.max(0, Number(s.values[i]) || 0);
                  if (!v) return null;
                  const top = series.slice(j + 1).every((t) => !(Number(t.values[i]) > 0));
                  const yb = y(acc); acc += v; const yt = y(acc);
                  const gap = j > 0 && acc - v > 0 ? 2 : 0; // the 2px surface gap between segments
                  const d = top ? colPath(x0, bw, yb - gap, yt) : `M${x0},${yb - gap}V${yt}H${x0 + bw}V${yb - gap}Z`;
                  return d ? <path key={s.name} d={d} fill={s.color} /> : null;
                }) : series.map((s, j) => {
                  const v = s.values[i];
                  if (v == null || Number(v) === 0) return null;
                  return <path key={s.name} d={colPath(x0 + j * (bw + 2), bw, y(0), y(Number(v)))} fill={s.color} />;
                })}
                {i % every === 0 && <text x={PAD.l + band * i + band / 2} y={H - 8} textAnchor="middle" className="chart-axis">{l}</text>}
                <rect className="chart-hit" x={PAD.l + band * i} y={PAD.t} width={band} height={plotH} fill="transparent" tabIndex={0}
                  aria-label={`${l}: ${series.map((s) => `${s.name} ${fmt(s.values[i])}`).join(', ')}`}
                  onMouseEnter={(e) => show(i, e.currentTarget)} onFocus={(e) => show(i, e.currentTarget)} onBlur={() => setTip(null)} />
              </g>
            );
          })}
        </svg>
        <Tip tip={tip} />
      </div>
      {note && <p className="muted small chart-note">{note}</p>}
      {table && <TableView labels={labels} series={series} fmt={fmt} caption={title} />}
    </figure>
  );
}

// Lines on one axis (gaps where a month has no value), with a crosshair that snaps to the nearest month.
export function Lines({ title, labels, series, fmt, yFmt, height = 220, yMax = null, table = true, note }) {
  const box = useRef(null);
  const W = useWidth(box);
  const [at, setAt] = useState(null);
  const n = labels.length;
  const H = height;
  const plotW = Math.max(10, W - PAD.l - PAD.r); const plotH = H - PAD.t - PAD.b;
  let hi = 0; let lo = 0;
  series.forEach((s) => s.values.forEach((v) => { if (v != null) { hi = Math.max(hi, Number(v)); lo = Math.min(lo, Number(v)); } }));
  if (yMax != null) hi = Math.max(yMax, hi);
  const tk = ticks(lo, hi);
  const x = (i) => PAD.l + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const y = (v) => PAD.t + plotH - ((v - tk[0]) / (tk.at(-1) - tk[0])) * plotH;
  const yf = yFmt ?? compact;
  const pathOf = (vals) => {
    let d = ''; let pen = false;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i)},${y(Number(v))}`; pen = true; });
    return d;
  };
  const move = (e) => {
    const host = box.current.getBoundingClientRect();
    const px = e.clientX - host.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / plotW) * (n - 1))));
    setAt(i);
  };
  const every = n > 8 && W < 520 ? 3 : n > 8 && W < 760 ? 2 : 1;
  const tip = at == null ? null : { x: x(at), y: 4, flip: x(at) > W * 0.6, title: labels[at],
    rows: series.map((s) => ({ name: s.name, color: s.color, value: fmt(s.values[at]) })) };
  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}
      <Legend series={series} kind="line" />
      <div className="chart-box" ref={box} onMouseMove={move} onMouseLeave={() => setAt(null)}>
        <svg width={W} height={H} role="img" aria-label={title}>
          {tk.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth="1" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">{yf(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % every === 0 ? <text key={l} x={x(i)} y={H - 8} textAnchor="middle" className="chart-axis">{l}</text> : null))}
          {at != null && <line x1={x(at)} x2={x(at)} y1={PAD.t} y2={PAD.t + plotH} stroke={MUTED} strokeWidth="1" />}
          {series.map((s) => (
            <g key={s.name}>
              <path d={pathOf(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((v, i) => {
                const lone = v != null && (i === 0 || s.values[i - 1] == null) && (i === n - 1 || s.values[i + 1] == null);
                const show = v != null && (i === at || lone || i === s.values.map((q) => q != null).lastIndexOf(true));
                return show ? <circle key={i} cx={x(i)} cy={y(Number(v))} r="4" fill={s.color} stroke={SURFACE} strokeWidth="2" /> : null;
              })}
            </g>
          ))}
          {labels.map((l, i) => (
            <rect key={l} className="chart-hit" x={x(i) - (plotW / Math.max(1, n - 1)) / 2} y={PAD.t} width={plotW / Math.max(1, n - 1)} height={plotH}
              fill="transparent" tabIndex={0} aria-label={`${l}: ${series.map((s) => `${s.name} ${fmt(s.values[i])}`).join(', ')}`}
              onFocus={() => setAt(i)} onBlur={() => setAt(null)} />
          ))}
        </svg>
        <Tip tip={tip} kind="line" />
      </div>
      {note && <p className="muted small chart-note">{note}</p>}
      {table && <TableView labels={labels} series={series} fmt={fmt} caption={title} />}
    </figure>
  );
}

// A 12-point trend for a table row: muted line, the latest month as a dot.
export function Spark({ values, width = 84, height = 22, color = '#2a78d6' }) {
  const vals = (values ?? []).map((v) => (v == null ? null : Number(v)));
  const real = vals.filter((v) => v != null);
  if (real.length < 2) return <span className="spark-none" aria-hidden="true" />;
  const lo = Math.min(0, ...real); const hi = Math.max(...real, lo + 1);
  const x = (i) => 2 + ((width - 4) * i) / (vals.length - 1);
  const y = (v) => height - 3 - ((v - lo) / (hi - lo)) * (height - 6);
  let d = ''; let pen = false;
  vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i)},${y(v)}`; pen = true; });
  const li = vals.map((v) => v != null).lastIndexOf(true);
  return (
    <svg className="spark" width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke="#b8b6ae" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={x(li)} cy={y(vals[li])} r="2.5" fill={color} />
    </svg>
  );
}

// Receipts by day of the month: 31 thin columns.
export function DayBars({ title, counts, amounts, fmtAmount, height = 150, highlight = null }) {
  const box = useRef(null);
  const W = useWidth(box);
  const [tip, setTip] = useState(null);
  const H = height; const plotW = Math.max(10, W - PAD.l - PAD.r); const plotH = H - PAD.t - PAD.b;
  const hi = Math.max(1, ...counts);
  const tk = ticks(0, hi, Math.min(4, hi));
  const y = (v) => PAD.t + plotH - (v / tk.at(-1)) * plotH;
  const band = plotW / 31; const bw = Math.max(2, Math.min(14, band - 3));
  const inWin = (d) => highlight && (highlight.from <= highlight.to ? d >= highlight.from && d <= highlight.to : d >= highlight.from || d <= highlight.to);
  const show = (i, el) => {
    const rect = el.getBoundingClientRect(); const host = box.current.getBoundingClientRect();
    const x = rect.left - host.left + rect.width / 2;
    setTip({ x, y: 4, flip: x > host.width * 0.6, title: `Day ${i + 1}`,
      rows: [{ name: counts[i] === 1 ? 'receipt' : 'receipts', color: '#2a78d6', value: String(counts[i]) },
        ...(amounts ? [{ name: 'received', color: '#2a78d6', value: fmtAmount(amounts[i]) }] : [])] });
  };
  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}
      <div className="chart-box" ref={box} onMouseLeave={() => setTip(null)}>
        <svg width={W} height={H} role="img" aria-label={title}>
          {tk.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth="1" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">{t}</text>
            </g>
          ))}
          {highlight && (() => {
            const segs = highlight.from <= highlight.to ? [[highlight.from, highlight.to]] : [[highlight.from, 31], [1, highlight.to]];
            return segs.map(([a, b]) => <rect key={a} x={PAD.l + band * (a - 1)} y={PAD.t} width={band * (b - a + 1)} height={plotH} fill="#cde2fb" opacity="0.45" />);
          })()}
          {counts.map((c, i) => (
            <g key={i}>
              {c > 0 && <path d={colPath(PAD.l + band * i + (band - bw) / 2, bw, y(0), y(c))} fill={inWin(i + 1) ? '#2a78d6' : '#86b6ef'} />}
              {[1, 5, 10, 15, 20, 25, 31].includes(i + 1) && <text x={PAD.l + band * i + band / 2} y={H - 8} textAnchor="middle" className="chart-axis">{i + 1}</text>}
              <rect className="chart-hit" x={PAD.l + band * i} y={PAD.t} width={band} height={plotH} fill="transparent" tabIndex={0}
                aria-label={`Day ${i + 1}: ${c} receipt${c === 1 ? '' : 's'}`} onMouseEnter={(e) => show(i, e.currentTarget)} onFocus={(e) => show(i, e.currentTarget)}
                onBlur={() => setTip(null)} />
            </g>
          ))}
        </svg>
        <Tip tip={tip} />
      </div>
    </figure>
  );
}

