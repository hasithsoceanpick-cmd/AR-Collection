import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, db } from '../lib/supabase';
import { readRows, findHeaderRow, headerCells, suggestMapping, parseStatement } from '../lib/statement';
import { lkr, fmtDate, fmtDateTime, ref as ccRef, personName } from '../lib/format';
import { TAGS } from '../lib/workflow';

const FIELDS = [
  { key: 'date', label: 'Transaction date', required: true },
  { key: 'narration', label: 'Narration (one or more columns)', multi: true },
  { key: 'credit', label: 'Credit (money in)' },
  { key: 'debit', label: 'Debit (money out)' },
  { key: 'amount', label: 'Single amount column (instead of debit/credit)' },
  { key: 'balance', label: 'Balance (for the check)' },
  { key: 'reference', label: 'Bank reference' },
  { key: 'cheque', label: 'Cheque number' },
];

// ---------- Column setup ----------
function ColumnSetup({ account, onSaved, onClose }) {
  const [rows, setRows] = useState(null);
  const [hdr, setHdr] = useState(-1);
  const [map, setMap] = useState(null);
  const [test, setTest] = useState(null);
  const [error, setError] = useState('');

  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(''); setTest(null);
    try {
      const r = await readRows(f);
      const h = findHeaderRow(r);
      setRows(r); setHdr(h);
      setMap(h >= 0 ? suggestMapping(headerCells(r, h)) : null);
      if (h < 0) setError("Couldn't find the header row automatically. Pick it from the list below.");
    } catch (err) { setError(err.message); }
  }

  const cells = rows && hdr >= 0 ? headerCells(rows, hdr) : [];
  useEffect(() => {
    if (!rows || !map) return;
    try { setTest(parseStatement(rows, map)); setError(''); }
    catch (err) { setTest(null); setError(err.message); }
  }, [rows, map]);

  async function save() {
    const { error } = await db.from('bank_accounts').update({ mapping: map }).eq('id', account.id);
    if (error) setError(error.message); else onSaved();
  }

  const candidates = rows ? rows.slice(0, 40).map((r, i) => ({ i, t: (r ?? []).filter((v) => v != null && String(v).trim()).join(' · ') }))
    .filter((x) => x.t) : [];

  return (
    <div className="action">
      <h2>Column setup for {account.name}</h2>
      <p className="hint">Choose any statement file downloaded from this account's online banking. The app finds the header row; check each field points at the right column. This is saved and reused for every upload.</p>
      <label className="btn file-btn">Choose a statement file<input type="file" accept=".xls,.xlsx,.csv" hidden onChange={pick} /></label>
      {rows && (
        <label className="field"><span className="flabel">Header row</span>
          <select value={hdr} onChange={(e) => { const h = Number(e.target.value); setHdr(h); setMap(suggestMapping(headerCells(rows, h))); }}>
            <option value={-1}>Choose the row with the column names</option>
            {candidates.map((c) => <option key={c.i} value={c.i}>Row {c.i + 1}: {c.t.slice(0, 90)}</option>)}
          </select>
        </label>
      )}
      {map && (
        <div className="grid2">
          {FIELDS.map((f) => (
            <label key={f.key} className="field"><span className="flabel">{f.label}</span>
              {f.multi ? (
                <select multiple size={Math.min(6, cells.length)} value={map.narration ?? []}
                  onChange={(e) => setMap((m) => ({ ...m, narration: [...e.target.selectedOptions].map((o) => o.value) }))}>
                  {cells.map((c) => <option key={c.idx} value={c.text}>{c.text}</option>)}
                </select>
              ) : (
                <select value={map[f.key] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value || null }))}>
                  <option value="">{f.required ? 'Choose' : 'Not used'}</option>
                  {cells.map((c) => <option key={c.idx} value={c.text}>{c.text}</option>)}
                </select>
              )}
            </label>
          ))}
        </div>
      )}
      {test && (
        <div className="preview">
          <p><strong>Test read:</strong> {test.lines.length} lines from {fmtDate(test.from)} to {fmtDate(test.to)}.
            Money in LKR {lkr(test.lines.reduce((s, l) => s + l.credit, 0))}, money out LKR {lkr(test.lines.reduce((s, l) => s + l.debit, 0))}.
            Compare these with the bank's totals.</p>
          <LinesTable lines={test.lines.slice(0, 6)} />
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={!test} onClick={save}>Save column setup</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function LinesTable({ lines }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Date</th><th>Narration</th><th>Reference</th><th className="num">Out</th><th className="num">In</th><th className="num">Balance</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{fmtDate(l.txn_date)}</td><td>{l.narration}</td><td>{l.reference}</td>
              <td className="num">{l.debit ? lkr(l.debit) : ''}</td><td className="num">{l.credit ? lkr(l.credit) : ''}</td>
              <td className="num">{l.balance != null ? lkr(l.balance) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Upload ----------
function Upload({ accounts, onDone }) {
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const account = accounts.find((a) => String(a.id) === String(accountId));

  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !account) return;
    setFile(f); setParsed(null); setPreview(null); setMsg(''); setError(''); setBusy(true);
    try {
      const p = parseStatement(await readRows(f), account.mapping);
      setParsed(p);
      setPreview(await rpc('cc_import_statement', { p_account_id: account.id, p_file: f.name, p_rows: p.lines, p_commit: false }));
    } catch (err) { setError(err.message); setFile(null); }
    finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true); setError('');
    try {
      const r = await rpc('cc_import_statement', { p_account_id: account.id, p_file: file.name, p_rows: parsed.lines, p_commit: true });
      setMsg(`${r.new} new line${r.new === 1 ? '' : 's'} added to ${account.name}.`);
      setFile(null); setParsed(null); setPreview(null);
      await onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="facts">
      <h2>Upload a statement</h2>
      <div className="grid2">
        <label className="field"><span className="flabel">Bank account</span>
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setParsed(null); setPreview(null); }}>
            <option value="">Choose an account</option>
            {accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.account_no})</option>)}
          </select>
        </label>
        <div className="field"><span className="flabel">Statement file</span>
          {account && !account.mapping
            ? <span className="hint">Set up this account's columns first (Accounts below).</span>
            : <label className={`btn file-btn${!account ? ' disabled' : ''}`}>{busy && !preview ? 'Reading…' : 'Choose Excel file'}
                <input type="file" accept=".xls,.xlsx,.csv" hidden onChange={pick} disabled={!account || busy} /></label>}
        </div>
      </div>
      {preview && (
        <div className="preview">
          <p><strong>{file.name}</strong>: {preview.in_file} lines in the file, {fmtDate(parsed.from)} to {fmtDate(parsed.to)}.</p>
          <ul className="plain">
            {preview.before_start > 0 && <li>{preview.before_start} dated before {fmtDate(preview.track_from)} are ignored.</li>}
            <li>{preview.already_held} already in the app.</li>
            <li><strong>{preview.new} new line{preview.new === 1 ? '' : 's'} to add.</strong></li>
          </ul>
          {preview.balance_check === 'ok' && <p className="ok-text">Balance check: after this upload the app's balance (LKR {lkr(preview.app_balance)}) agrees with the bank.</p>}
          {preview.balance_check === 'mismatch' && <p className="warn-text">Balance check: after this upload the app's balance would be LKR {lkr(preview.app_balance)}, which doesn't match the bank's balance on the last date in this file. Lines may be missing from an earlier statement, or the opening balance may be wrong. You can still add the lines.</p>}
          {preview.new > 0 && <LinesTable lines={preview.new_lines} />}
          <div className="row">
            <button className="btn primary" onClick={commit} disabled={busy || preview.new === 0}>{preview.new ? `Add ${preview.new} line${preview.new === 1 ? '' : 's'}` : 'Nothing new to add'}</button>
            <button className="btn ghost" onClick={() => { setFile(null); setParsed(null); setPreview(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ---------- Accounts ----------
const BLANK = { bank: '', account_no: '', name: '', bc_code: '', track_from: '2026-10-01', opening_balance: '' };

function AccountForm({ initial, onSaved, onClose }) {
  const [f, setF] = useState(initial ? { ...initial, opening_balance: initial.opening_balance ?? '' } : BLANK);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault(); setError('');
    const row = {
      bank: f.bank.trim(), account_no: f.account_no.trim(), name: f.name.trim(), bc_code: f.bc_code.trim() || null,
      track_from: f.track_from, opening_balance: f.opening_balance === '' ? null : Number(String(f.opening_balance).replace(/,/g, '')),
    };
    const q = initial ? db.from('bank_accounts').update(row).eq('id', initial.id) : db.from('bank_accounts').insert(row);
    const { error } = await q;
    if (error) setError(error.message.includes('duplicate') ? 'That account number is already set up.' : error.message);
    else onSaved();
  }
  return (
    <form className="action" onSubmit={save}>
      <h2>{initial ? `Edit ${initial.name}` : 'Add a bank account'}</h2>
      <div className="grid2">
        <label className="field"><span className="flabel">Bank</span><input required value={f.bank} onChange={set('bank')} placeholder="Sampath" /></label>
        <label className="field"><span className="flabel">Account number</span><input required value={f.account_no} onChange={set('account_no')} placeholder="021810001590" /></label>
        <label className="field"><span className="flabel">Short name</span><input required value={f.name} onChange={set('name')} placeholder="Sampath 1590" /></label>
        <label className="field"><span className="flabel">BC bank account code</span><input value={f.bc_code} onChange={set('bc_code')} placeholder="SAMPATH-CA-LKR-590" /></label>
        <label className="field"><span className="flabel">Track statement lines from</span><input type="date" required value={f.track_from} onChange={set('track_from')} /></label>
        <label className="field"><span className="flabel">Balance at the end of the day before (optional)</span>
          <input inputMode="decimal" value={f.opening_balance} onChange={set('opening_balance')} placeholder="Enables the balance check" /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="btn primary">Save</button><button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
    </form>
  );
}

// ---------- Lines ----------
function LinesBrowser({ accounts }) {
  const [accountId, setAccountId] = useState('');
  const [filter, setFilter] = useState('open');
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!accountId) { setLines([]); return; }
    let q = db.from('statement_lines').select('*').eq('account_id', accountId).order('txn_date', { ascending: false }).order('id').limit(1000);
    if (filter === 'open') q = q.gt('credit', 0).is('link_kind', null);
    if (filter === 'credits') q = q.gt('credit', 0);
    if (filter === 'debits') q = q.gt('debit', 0);
    const { data, error } = await q;
    if (error) setError(error.message); else setLines(data);
  }, [accountId, filter]);
  useEffect(() => { load(); }, [load]);

  async function tag(l, t) {
    let note = null;
    if (t === 'other') { note = window.prompt('What is this line? (e.g. loan, refund)'); if (!note) return; }
    setBusy(true); setError('');
    try { await rpc('cc_tag_line', { p_line_id: l.id, p_tag: t, p_note: note }); await load(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function untag(l) {
    setBusy(true);
    try { await rpc('cc_untag_line', { p_line_id: l.id }); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="facts">
      <h2>Statement lines</h2>
      <div className="list-tools">
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
          <option value="">Choose an account</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div className="tabs" role="tablist">
          {[['open', 'Unlinked money in'], ['credits', 'All money in'], ['debits', 'Money out'], ['all', 'All']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'tab on' : 'tab'} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {accountId && lines.length === 0 && <p className="muted">Nothing here.</p>}
      {lines.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Narration</th><th>Ref</th><th className="num">Out</th><th className="num">In</th><th>Linked to</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{fmtDate(l.txn_date)}</td><td>{l.narration}</td><td>{l.reference}</td>
                  <td className="num">{l.debit > 0 ? lkr(l.debit) : ''}</td><td className="num">{l.credit > 0 ? lkr(l.credit) : ''}</td>
                  <td>
                    {l.link_kind === 'deposit' && <Link to={`/deposits#d${l.deposit_id}`}>Slip D-{l.deposit_id}</Link>}
                    {l.link_kind === 'transfer' && <Link to={`/c/${l.collection_id}`}>{ccRef(l.collection_id)}</Link>}
                    {l.link_kind === 'tag' && <>{TAGS[l.tag]}{l.tag_note ? `: ${l.tag_note}` : ''} <button className="link" disabled={busy} onClick={() => untag(l)}>undo</button></>}
                    {!l.link_kind && l.credit > 0 && (
                      <span className="tag-btns">
                        {Object.entries(TAGS).map(([k, v]) => <button key={k} className="link" disabled={busy} onClick={() => tag(l, k)}>{v}</button>)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Bank() {
  const [accounts, setAccounts] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | account
  const [mapping, setMapping] = useState(null);

  const load = useCallback(async () => {
    const [a, u] = await Promise.all([
      db.from('bank_accounts').select('*').order('name'),
      db.from('statement_uploads').select('*, by:profiles(full_name,email)').order('done_at', { ascending: false }).limit(200),
    ]);
    setAccounts(a.data ?? []);
    setUploads(u.data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const lastUpload = useMemo(() => {
    const m = {};
    for (const u of uploads) if (!m[u.account_id]) m[u.account_id] = u;
    return m;
  }, [uploads]);

  if (accounts === null) return <p className="muted">Loading…</p>;

  return (
    <section>
      <div className="page-head"><h1>Bank</h1></div>
      <p className="lede">Upload statements as often as you like: only lines the app doesn't already hold are added, and nothing already here changes.</p>

      <Upload accounts={accounts} onDone={load} />

      <div className="facts">
        <div className="page-head"><h2>Accounts</h2>
          <button className="btn" onClick={() => { setEditing('new'); setMapping(null); }}>Add account</button></div>
        {editing && <AccountForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
        {mapping && <ColumnSetup account={mapping} onClose={() => setMapping(null)} onSaved={() => { setMapping(null); load(); }} />}
        {accounts.length === 0 ? <p className="muted">No accounts yet. Add each account that receives customer money.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Account</th><th>BC code</th><th>Tracking from</th><th>Columns</th><th>Last upload</th><th /></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.name}</strong><div className="muted small">{a.bank} {a.account_no}</div></td>
                    <td>{a.bc_code || <span className="warn-text">Missing</span>}</td>
                    <td>{fmtDate(a.track_from)}</td>
                    <td>{a.mapping ? 'Set up' : <span className="warn-text">Not set up</span>}</td>
                    <td>{lastUpload[a.id] ? <>{fmtDateTime(lastUpload[a.id].done_at)}<div className="muted small">
                      +{lastUpload[a.id].lines_added} lines, {personName(lastUpload[a.id].by)}
                      {lastUpload[a.id].balance_check === 'mismatch' && <span className="warn-text"> · balance didn't agree</span>}</div></> : '—'}</td>
                    <td className="row">
                      <button className="link" onClick={() => { setMapping(a); setEditing(null); }}>Columns</button>
                      <button className="link" onClick={() => { setEditing(a); setMapping(null); }}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LinesBrowser accounts={accounts} />
    </section>
  );
}
