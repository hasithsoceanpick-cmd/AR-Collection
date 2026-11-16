import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { dmy, dmyTime } from '../lib/followup';
import { TERM_PRESETS, presetOf, termsRule } from '../lib/terms';

const int = (v) => (String(v ?? '').trim() === '' ? null : Number(v));

// A customer's credit terms in the app. Finance Admins set them; everyone who can open the customer sees them.
// Where a customer has terms with days, its invoices age from the invoice date + those days instead of BC's due date.
export default function CreditTerms({ customerNo, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [preset, setPreset] = useState('');
  const [label, setLabel] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setData(await rpc('cc_customer_terms', { p_customer_no: customerNo })); setError(''); } catch (e) { setError(e.message); }
  }, [customerNo]);
  useEffect(() => { setData(null); setEditing(false); load(); }, [load]);

  function start() {
    const t = data.terms;
    const k = presetOf(t);
    setPreset(k || 'd30'); setLabel(t?.terms ?? ''); setMin(t?.min_days ?? ''); setMax(t?.max_days ?? ''); setNote(t?.note ?? ''); setErr(''); setEditing(true);
  }
  function pick(k) {
    setPreset(k);
    const p = TERM_PRESETS.find((x) => x.key === k);
    if (p) { setLabel(p.terms); setMin(p.min ?? ''); setMax(p.max ?? ''); }
    else if (String(min) === String(max)) setMax('');   // Other…: a single-day term keeps its outer limit the same unless one is typed
  }
  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    const p = TERM_PRESETS.find((x) => x.key === preset);
    try {
      await rpc('cc_customer_terms_set', { p_customer_no: customerNo, p_terms: p ? p.terms : label, p_min: p ? p.min : int(min), p_max: p ? p.max : int(max), p_note: note || null });
      setEditing(false); await load(); await onChanged?.();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setErr('');
    try { await rpc('cc_customer_terms_set', { p_customer_no: customerNo, p_terms: '', p_min: null, p_max: null, p_note: null }); setEditing(false); await load(); await onChanged?.(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }

  if (error) return null;   // credit terms not installed yet, or not for this role
  if (!data) return <div className="terms-box"><span className="muted small">Credit terms…</span></div>;
  const t = data.terms;
  return (
    <div className="terms-box" id="credit-terms">
      {!editing ? (
        <div className="terms-view">
          <div>
            <span className="flabel">Credit terms</span>
            {t ? <><strong className="terms-name">{t.terms}</strong> <span className="small">{termsRule(t)}</span></>
              : <span className="small">None in the app: invoices age by BC’s due dates</span>}
            <div className="muted small">
              {t && <>{t.source === 'file' ? 'From the terms file' : 'Set in the app'}{t.by ? ` by ${t.by}` : ''} on {dmy(t.at)}{t.note ? ` · ${t.note}` : ''} · </>}
              BC payment terms: {data.bc_terms ?? 'none'}
            </div>
          </div>
          {data.can_edit && <button type="button" className="btn small" onClick={start}>{t ? 'Change' : 'Set credit terms'}</button>}
        </div>
      ) : (
        <form className="terms-form" onSubmit={save}>
          <label className="field"><span className="flabel">Credit terms</span>
            <select value={preset} onChange={(e) => pick(e.target.value)} aria-label="Credit terms">
              {TERM_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.terms}</option>)}
              <option value="other">Other…</option>
            </select></label>
          {preset === 'other' && (
            <div className="terms-grid">
              <label className="field"><span className="flabel">Name</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 21 days" required maxLength={80} /></label>
              <label className="field"><span className="flabel">Overdue after (days)</span><input type="number" min="0" max="365" value={min} onChange={(e) => setMin(e.target.value)} placeholder="blank: no fixed days" /></label>
              <label className="field"><span className="flabel">Outer limit (days)</span><input type="number" min="0" max="365" value={max} onChange={(e) => setMax(e.target.value)} placeholder="same as above" /></label>
            </div>
          )}
          <p className="hint">{(() => {
            const p = TERM_PRESETS.find((x) => x.key === preset);
            const rule = termsRule(preset === 'other' ? { min_days: int(min), max_days: int(max) ?? int(min) } : p ? { min_days: p.min, max_days: p.max } : null);
            return rule ? `${rule[0].toUpperCase()}${rule.slice(1)}. ` : '';
          })()}Open invoices are aged again straight away.</p>
          <label className="field"><span className="flabel">Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. agreed with the GM, Nov 2026" /></label>
          {err && <p className="error small">{err}</p>}
          <div className="row">
            <button className="btn primary small" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="link small" type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            {t && <button className="link small terms-remove" type="button" onClick={remove} disabled={busy}>Remove (use BC’s due dates)</button>}
          </div>
        </form>
      )}
      {data.history.length > 0 && !editing && (
        <details className="terms-history"><summary className="small">History ({data.history.length})</summary>
          <ul>{data.history.map((h) => <li key={h.at} className="small"><span className="muted">{dmyTime(h.at)} · {h.by ?? 'file'}</span> {h.note}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
