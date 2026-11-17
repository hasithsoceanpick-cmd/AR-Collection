import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, rpc } from '../lib/supabase';
import { lkr, fmtDate, fmtDateTime } from '../lib/format';
import { useAuth } from '../lib/auth';

const sum = (xs, k) => xs.reduce((a, x) => a + Number(x[k] ?? 0), 0);
const minus1 = (iso) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };

async function exportRec(v) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const summary = [
    ['Bank reconciliation', v.account], ['BC bank account', v.bc_code], ['As at', fmtDate(v.as_at)], [],
    ['Balance per bank statement', Number(v.bank_balance ?? 0)],
    ['Balance per Business Central', Number(v.bc_balance ?? 0)],
    ['Add: in the bank, not yet in BC', Number(v.bank_items_total)],
    ['Less: in BC, not yet in the bank', Number(v.bc_items_total)],
    ['Reconciled balance', Number(v.bc_balance ?? 0) + Number(v.bank_items_total) - Number(v.bc_items_total)],
    ['Difference', Number(v.bc_balance ?? 0) + Number(v.bank_items_total) - Number(v.bc_items_total) - Number(v.bank_balance ?? 0)], [],
    ['Statement lines', v.counts.lines, 'matched', v.counts.lines_matched], ['BC entries', v.counts.entries, 'matched', v.counts.entries_matched],
    ['BC opening balance', Number(v.bc_opening ?? 0), v.bc_opening_source === 'entered' ? 'entered by finance' : 'from BC running balance'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Date', 'Narration', 'Reference', 'Amount', 'App document'],
    ...v.bank_not_in_bc.map((l) => [fmtDate(l.txn_date), l.narration, l.reference ?? '', Number(l.amount), l.doc_no ?? ''])]), 'In bank, not in BC');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Posting date', 'Document No.', 'Description', 'Comment', 'Ext. Doc No.', 'Amount', 'Entry No.'],
    ...v.bc_not_in_bank.map((e) => [fmtDate(e.posting_date), e.document_no ?? '', e.description ?? '', e.comment ?? '', e.ext_doc_no ?? '', Number(e.amount), e.entry_no])]), 'In BC, not in bank');
  XLSX.writeFile(wb, `Bank rec ${v.account} ${v.as_at}.xlsx`);
}

export default function BankRec() {
  const { role } = useAuth();
  const canAct = role === 'finance';
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [asAt, setAsAt] = useState('');
  const [v, setV] = useState(null);
  const [selL, setSelL] = useState(new Set());
  const [selE, setSelE] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState('');

  useEffect(() => {
    db.from('bank_accounts').select('id, name, track_from').eq('active', true).order('name').then(({ data }) => {
      setAccounts(data ?? []);
      if (data?.length) setAccountId(String(data[0].id));
    });
  }, []);
  useEffect(() => {
    if (!accountId) return;
    db.from('statement_lines').select('txn_date').eq('account_id', accountId).order('txn_date', { ascending: false }).limit(1)
      .then(({ data }) => setAsAt(data?.[0]?.txn_date ?? new Date().toISOString().slice(0, 10)));
  }, [accountId]);

  const load = useCallback(async () => {
    if (!accountId || !asAt) return;
    setError('');
    try { setV(await rpc('cc_rec_view', { p_account_id: Number(accountId), p_as_at: asAt })); setSelL(new Set()); setSelE(new Set()); }
    catch (e) { setError(e.message); }
  }, [accountId, asAt]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, okMsg) => { setBusy(true); setError(''); setMsg(''); try { const r = await fn(); setMsg(typeof okMsg === 'function' ? okMsg(r) : okMsg); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const pickedL = useMemo(() => (v?.bank_not_in_bc ?? []).filter((l) => selL.has(l.id)), [v, selL]);
  const pickedE = useMemo(() => (v?.bc_not_in_bank ?? []).filter((e) => selE.has(e.entry_no)), [v, selE]);
  const tl = sum(pickedL, 'amount'), te = sum(pickedE, 'amount');
  const toggle = (set, setter, id) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n); };
  const acct = accounts.find((a) => String(a.id) === accountId);

  const recon = v && v.bc_balance != null && v.bank_balance != null ? Number(v.bc_balance) + Number(v.bank_items_total) - Number(v.bc_items_total) : null;
  const diff = recon != null ? Math.round((recon - Number(v.bank_balance)) * 100) / 100 : null;

  return (
    <section className="wide">
      <div className="page-head"><h1>Bank reconciliation</h1></div>
      <div className="row-2 rec-pick">
        <label>Account<select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>As at<input type="date" value={asAt} onChange={(e) => setAsAt(e.target.value)} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="ok-text">{msg}</p>}
      {!v ? <p className="muted">Loading…</p> : (
        <>
          <div className="facts rec-summary">
            <table className="table summary-table"><tbody>
              <tr><td>Balance per bank statement</td><td className="num">{v.bank_balance != null ? lkr(v.bank_balance) : <span className="warn-text">enter the account's opening balance on the Bank page</span>}</td></tr>
              <tr><td>Balance per Business Central</td><td className="num">{v.bc_balance != null ? lkr(v.bc_balance) : <span className="warn-text">upload BC's bank ledger, or enter BC's balance below</span>}</td></tr>
              <tr><td>Add: in the bank, not yet in BC ({v.bank_not_in_bc.length})</td><td className="num">{lkr(v.bank_items_total)}</td></tr>
              <tr><td>Less: in BC, not yet in the bank ({v.bc_not_in_bank.length})</td><td className="num">{lkr(-Number(v.bc_items_total))}</td></tr>
              <tr className="total-row"><td>Difference</td><td className={`num ${diff === 0 ? 'ok-text' : diff != null ? 'error' : ''}`}>{diff != null ? lkr(diff) : '—'}</td></tr>
            </tbody></table>
            <p className="hint">
              {v.counts.lines_matched} of {v.counts.lines} statement lines and {v.counts.entries_matched} of {v.counts.entries} BC entries matched.
              {v.bc_opening != null && <> BC's balance before {fmtDate(v.track_from)}: LKR {lkr(v.bc_opening)} ({v.bc_opening_source === 'entered' ? 'entered by finance' : "from BC's running balance"}).</>}
              {v.last_bc_upload && <> BC ledger last uploaded {fmtDateTime(v.last_bc_upload)}{v.last_entry_date ? `, entries to ${fmtDate(v.last_entry_date)}` : ''}.</>}
            </p>
            <div className="btn-row">
              {canAct && <button className="btn primary" disabled={busy} onClick={() => run(() => rpc('cc_rec_auto', { p_account_id: Number(accountId) }), (n) => `${n} matched automatically (exact amount and date).`)}>Match automatically</button>}
              <button className="btn" onClick={() => exportRec(v)}>Export to Excel</button>
            </div>
            {canAct && (
              <details className="hint"><summary>BC's balance at {acct ? fmtDate(minus1(acct.track_from)) : 'the start'} (optional override)</summary>
                <div className="row-2"><input inputMode="decimal" placeholder="e.g. 738781.26" value={opening} onChange={(e) => setOpening(e.target.value)} />
                  <button className="btn" disabled={busy} onClick={() => run(() => rpc('cc_set_bc_opening', { p_account_id: Number(accountId), p_amount: opening === '' ? null : Number(opening.replace(/,/g, '')) }), 'BC opening balance saved.')}>Save</button></div>
                <p>Leave empty to use BC's own running balance from the uploaded ledger.</p>
              </details>
            )}
          </div>

          {v.suggestions.length > 0 && (
            <div className="facts">
              <h2>Same amount, a few days apart ({v.suggestions.length})</h2>
              <p className="hint">Confirm each pair if it's the same transaction.</p>
              <div className="table-wrap flat"><table className="table">
                <thead><tr><th>Bank</th><th>BC</th><th className="num">LKR</th><th></th></tr></thead>
                <tbody>{v.suggestions.map((s) => (
                  <tr key={`${s.line_id}-${s.entry_no}`}>
                    <td>{fmtDate(s.txn_date)} · {s.narration}</td><td>{fmtDate(s.posting_date)} · {s.description}</td><td className="num">{lkr(s.amount)}</td>
                    <td>{canAct && <button className="btn small" disabled={busy} onClick={() => run(() => rpc('cc_rec_match', { p_account_id: Number(accountId), p_line_ids: [s.line_id], p_entry_nos: [s.entry_no], p_kind: 'confirmed' }), 'Matched.')}>Confirm</button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          )}

          {canAct && (pickedL.length > 0 || pickedE.length > 0) && (
            <div className="facts sticky-bar">
              <strong>Match by hand:</strong> {pickedL.length} bank line{pickedL.length === 1 ? '' : 's'} LKR {lkr(tl)} · {pickedE.length} BC entr{pickedE.length === 1 ? 'y' : 'ies'} LKR {lkr(te)}
              {Math.abs(tl - te) < 0.005 && pickedL.length && pickedE.length
                ? <button className="btn primary" disabled={busy} onClick={() => run(() => rpc('cc_rec_match', { p_account_id: Number(accountId), p_line_ids: [...selL], p_entry_nos: [...selE] }), 'Matched.')}>Match these</button>
                : <span className="warn-text"> The two sides must be equal.</span>}
            </div>
          )}

          <div className="ov-flags">
            <div className="facts">
              <h2>In the bank, not in BC ({v.bank_not_in_bc.length})</h2>
              <div className="table-wrap flat rec-list"><table className="table">
                <thead><tr>{canAct && <th></th>}<th>Date</th><th>Narration</th><th className="num">LKR</th></tr></thead>
                <tbody>{v.bank_not_in_bc.map((l) => (
                  <tr key={l.id} className={selL.has(l.id) ? 'row-picked' : ''}>
                    {canAct && <td><input type="checkbox" checked={selL.has(l.id)} onChange={() => toggle(selL, setSelL, l.id)} /></td>}
                    <td>{fmtDate(l.txn_date)}</td>
                    <td className="narr">{l.narration}{l.doc_no && <div className="warn-text small">{l.doc_no}: exported, not (correctly) in BC</div>}{!l.doc_no && l.link_kind && <div className="muted small">receipt not yet exported</div>}</td>
                    <td className={`num ${Number(l.amount) < 0 ? 'out' : ''}`}>{lkr(l.amount)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
            <div className="facts">
              <h2>In BC, not in the bank ({v.bc_not_in_bank.length})</h2>
              <div className="table-wrap flat rec-list"><table className="table">
                <thead><tr>{canAct && <th></th>}<th>Date</th><th>Document</th><th className="num">LKR</th></tr></thead>
                <tbody>{v.bc_not_in_bank.map((e) => (
                  <tr key={e.entry_no} className={selE.has(e.entry_no) ? 'row-picked' : ''}>
                    {canAct && <td><input type="checkbox" checked={selE.has(e.entry_no)} onChange={() => toggle(selE, setSelE, e.entry_no)} /></td>}
                    <td>{fmtDate(e.posting_date)}</td>
                    <td className="narr">{e.document_no} · {e.description}{e.comment && <div className="muted small">{e.comment}</div>}</td>
                    <td className={`num ${Number(e.amount) < 0 ? 'out' : ''}`}>{lkr(e.amount)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          </div>

          {v.matches.length > 0 && (
            <div className="facts">
              <h2>Matched by hand or confirmed ({v.matches.length})</h2>
              <ul className="plain">{v.matches.map((m) => (
                <li key={m.id}>{m.kind === 'confirmed' ? 'Confirmed' : 'Manual'} match: {m.lines.length} bank line{m.lines.length === 1 ? '' : 's'} with {m.entries.length} BC entr{m.entries.length === 1 ? 'y' : 'ies'}, {fmtDateTime(m.created_at)}
                  {canAct && <> · <button className="link" disabled={busy} onClick={() => run(() => rpc('cc_rec_unmatch', { p_match_id: m.id }), 'Unmatched.')}>Undo</button></>}</li>
              ))}</ul>
              <p className="hint">{v.auto_matches} automatic match{v.auto_matches === 1 ? '' : 'es'} and every exported app document confirmed in BC are matched as well.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
