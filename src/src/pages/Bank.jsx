import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, db } from '../lib/supabase';
import { readRows, findHeaderRow, headerCells, suggestMapping, parseStatement, detectFormat, mappingFor, formatForBank,
  statementAccountNo, sameAccount, FORMATS } from '../lib/statement';
import { useAuth } from '../lib/auth';
import { lkr, fmtDate, fmtDateTime, ref as ccRef, personName } from '../lib/format';
import StatementView from '../components/StatementView';
import { downloadStatements, monthName } from '../lib/statementExport';

const FIELDS = [
  { key: 'date', label: 'Transaction date', required: true },
  { key: 'narration', label: 'Narration (one or more columns)', multi: true },
  { key: 'credit', label: 'Credit (money in)' },
  { key: 'debit', label: 'Debit (money out)' },
  { key: 'amount', label: 'Single amount column (instead of debit/credit)' },
  { key: 'direction', label: 'Cr/Dr column (with a single amount column)' },
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
  const [known, setKnown] = useState(null);

  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(''); setTest(null);
    try {
      const r = await readRows(f);
      const h = findHeaderRow(r);
      const fmt = detectFormat(r);
      setRows(r); setHdr(h); setKnown(fmt);
      setMap(fmt ? mappingFor(fmt) : h >= 0 ? suggestMapping(headerCells(r, h)) : null);
      if (h < 0 && !fmt) setError("Couldn't find the header row automatically. Pick it from the list below.");
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
      {known && <p className="ok-text">Recognised as a {FORMATS[known].label} file: the columns are set for you.</p>}
      {rows && (
        <label className="field"><span className="flabel">Header row</span>
          <select value={hdr} onChange={(e) => { const h = Number(e.target.value); setHdr(h); setKnown(null); setMap(suggestMapping(headerCells(rows, h))); }}>
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
                  onChange={(e) => { setKnown(null); setMap((m) => ({ ...m, format: undefined, narration: [...e.target.selectedOptions].map((o) => o.value) })); }}>
                  {cells.map((c) => <option key={c.idx} value={c.text}>{c.text}</option>)}
                </select>
              ) : (
                <select value={map[f.key] ?? ''} onChange={(e) => { setKnown(null); setMap((m) => ({ ...m, format: undefined, [f.key]: e.target.value || null })); }}>
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
  const [warn, setWarn] = useState('');
  const account = accounts.find((a) => String(a.id) === String(accountId));

  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !account) return;
    setFile(f); setParsed(null); setPreview(null); setMsg(''); setError(''); setWarn(''); setBusy(true);
    try {
      const rows = await readRows(f);
      const no = statementAccountNo(rows);
      if (sameAccount(no, account.account_no) === false) {
        const msg = `This statement is for account ${no}, not ${account.name} (${account.account_no}).`;
        if (account.mapping?.format) throw new Error(`${msg} Choose the right account.`);
        setWarn(`${msg} Check you chose the right account before adding the lines.`);
      }
      const p = parseStatement(rows, account.mapping);
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
          {warn && <p className="error">{warn}</p>}
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
const SHORT_BANK = [[/amana/i, 'Amana'], [/bank of ceylon|^boc/i, 'BOC'], [/commercial|^com-/i, 'Commercial'], [/dfcc/i, 'DFCC'],
  [/hatton|^hnb/i, 'HNB'], [/sampath/i, 'Sampath']];
const shortBank = (b) => SHORT_BANK.find(([re]) => re.test(b.bank ?? '') || re.test(b.code) || re.test(b.name))?.[1] ?? (b.bank ?? '');
const suffix = (b) => b.code.match(/(\d{3,4})$/)?.[1] ?? (b.account_no ?? '').slice(-4);

// Finance Admin: add an account the BC list doesn't have yet (or correct one), exactly as in Business Central.
function BcListForm({ initial, onSaved, onClose }) {
  const [f, setF] = useState(initial ?? { code: '', name: '', bank: '', account_no: '', currency: 'LKR' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault(); setError('');
    try { const code = await rpc('cc_bc_bank_account_save', { p: f }); onSaved(code); }
    catch (err) { setError(err.message); }
  }
  return (
    <form className="action" onSubmit={save}>
      <h2>{initial ? `Correct ${initial.code} in the BC list` : 'Add an account to the Business Central list'}</h2>
      <p className="hint">Type it exactly as on Business Central's Bank Accounts page: the code and name go into the journal's balancing account.</p>
      <div className="grid2">
        <label className="field"><span className="flabel">BC bank account no. (code)</span><input required value={f.code} onChange={set('code')} disabled={Boolean(initial)} placeholder="DFCC-CA-LKR-286" /></label>
        <label className="field"><span className="flabel">BC name</span><input required value={f.name} onChange={set('name')} placeholder="DFCC Bank 101001182286" /></label>
        <label className="field"><span className="flabel">Bank</span><input value={f.bank ?? ''} onChange={set('bank')} placeholder="DFCC Bank" /></label>
        <label className="field"><span className="flabel">Account number</span><input value={f.account_no ?? ''} onChange={set('account_no')} placeholder="101001182286" /></label>
        <label className="field"><span className="flabel">Currency</span><input value={f.currency ?? ''} onChange={set('currency')} placeholder="LKR" /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="btn primary">Save to the list</button><button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
    </form>
  );
}

function AccountForm({ initial, bcList, accounts, onSaved, onClose, onListChanged }) {
  const [f, setF] = useState(initial ? { ...initial, opening_balance: initial.opening_balance ?? '', bc_code: initial.bc_code ?? '' } : BLANK);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const taken = useMemo(() => new Map(accounts.filter((a) => a.id !== initial?.id && a.bc_code).map((a) => [a.bc_code, a.name])), [accounts, initial]);
  const bc = bcList.find((b) => b.code === f.bc_code);
  const fmt = bc ? formatForBank(bc.bank, bc.code, bc.name) : formatForBank(f.bank);

  function pickBc(code, list = bcList) {
    const b = list.find((x) => x.code === code);
    setF((s) => (!b ? { ...s, bc_code: '' } : initial ? { ...s, bc_code: code } : {
      ...s, bc_code: code, bank: shortBank(b), account_no: b.account_no ?? s.account_no, name: `${shortBank(b)} ${suffix(b)}`.trim(),
    }));
  }
  async function save(e) {
    e.preventDefault(); setError('');
    try {
      await rpc('cc_bank_account_save', { p: {
        id: initial?.id ?? null, bc_code: f.bc_code, bank: f.bank, account_no: f.account_no, name: f.name, track_from: f.track_from,
        opening_balance: f.opening_balance === '' ? null : String(f.opening_balance).replace(/,/g, ''),
        // a bank with a known statement layout needs no column setup
        mapping: fmt && (!initial || !initial.mapping) ? mappingFor(fmt) : null,
      } });
      onSaved();
    } catch (err) { setError(err.message); }
  }
  return (
    <>
      <form className="action" onSubmit={save}>
        <h2>{initial ? `Edit ${initial.name}` : 'Add a bank account'}</h2>
        <label className="field"><span className="flabel">Business Central bank account</span>
          <select required value={f.bc_code} onChange={(e) => pickBc(e.target.value)}>
            <option value="">Choose from the BC list</option>
            {bcList.map((b) => (
              <option key={b.code} value={b.code} disabled={taken.has(b.code)}>
                {b.code} · {b.name}{b.currency && b.currency !== 'LKR' ? ` (${b.currency})` : ''}{taken.has(b.code) ? ` (already set up: ${taken.get(b.code)})` : ''}
              </option>
            ))}
          </select>
          <span className="hint">Not in the list? <button type="button" className="link" onClick={() => setAdding(true)}>Add it to the BC list</button></span>
        </label>
        {bc && <p className="hint">Journal balancing account: <strong>{bc.code}</strong> · {bc.name}</p>}
        <div className="grid2">
          <label className="field"><span className="flabel">Bank</span><input required value={f.bank} onChange={set('bank')} placeholder="DFCC" /></label>
          <label className="field"><span className="flabel">Account number</span><input required value={f.account_no} onChange={set('account_no')} placeholder="101001182286" /></label>
          <label className="field"><span className="flabel">Short name</span><input required value={f.name} onChange={set('name')} placeholder="DFCC 286" /></label>
          <label className="field"><span className="flabel">Track statement lines from</span><input type="date" required value={f.track_from} onChange={set('track_from')} /></label>
          <label className="field"><span className="flabel">Balance at the end of the day before (optional)</span>
            <input inputMode="decimal" value={f.opening_balance} onChange={set('opening_balance')} placeholder="Enables the balance check" /></label>
        </div>
        {fmt && (!initial || !initial.mapping)
          ? <p className="ok-text">Statement columns: the {FORMATS[fmt].label} layout is set automatically.</p>
          : !initial && <p className="hint">After saving, set up the statement columns once from one of its statement files (Columns).</p>}
        {error && <p className="error">{error}</p>}
        <div className="row"><button className="btn primary">Save</button><button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
      </form>
      {adding && <BcListForm onClose={() => setAdding(false)} onSaved={async (code) => { setAdding(false); const list = await onListChanged(); pickBc(code, list); }} />}
    </>
  );
}

function BcList({ bcList, accounts, canEdit, onChanged }) {
  const [editing, setEditing] = useState(null);
  const inApp = new Map(accounts.filter((a) => a.bc_code).map((a) => [a.bc_code, a.name]));
  return (
    <details className="facts">
      <summary>Business Central bank account list ({bcList.length})</summary>
      <p className="hint">Every bank account in Business Central. {canEdit ? 'Pick from it when adding an account; add to it when BC gets a new account.' : 'A Finance Admin keeps it up to date.'}</p>
      {canEdit && <p><button className="btn small" onClick={() => setEditing({})}>Add to the list</button></p>}
      {editing && <BcListForm initial={editing.code ? editing : null} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await onChanged(); }} />}
      <div className="table-wrap flat">
        <table className="table">
          <thead><tr><th>BC code</th><th>BC name</th><th>Bank</th><th>Account no.</th><th>Currency</th><th>In the app</th>{canEdit && <th />}</tr></thead>
          <tbody>{bcList.map((b) => (
            <tr key={b.code}>
              <td>{b.code}</td><td>{b.name}</td><td>{b.bank ?? ''}</td><td>{b.account_no ?? ''}</td><td>{b.currency ?? ''}</td>
              <td>{inApp.get(b.code) ?? <span className="muted">—</span>}</td>
              {canEdit && <td><button className="link" onClick={() => setEditing(b)}>Correct</button></td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}

// ---------- Statement ----------
// Every account's statement for a month in one workbook, a sheet per account.
function DownloadAll({ accounts }) {
  const live = accounts.filter((a) => a.active !== false);
  const months = useMemo(() => {
    const now = new Date();
    const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let m = live.map((a) => (a.track_from ?? end).slice(0, 7)).sort()[0] ?? end;
    const out = [];
    while (m <= end && out.length < 120) {
      out.unshift(m);
      const [y, mo] = m.split('-').map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    return out;
  }, [live.map((a) => a.track_from).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [month, setMonth] = useState(months[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!live.length) return null;
  async function go() {
    setBusy(true); setError('');
    try { await downloadStatements(live, month); } catch (e) { setError(`Download failed: ${e.message}`); } finally { setBusy(false); }
  }
  return (
    <div className="download-all">
      <label className="field"><span className="flabel">Download every account's statement</span>
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month to download">
          {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          <option value="all">Everything held</option>
        </select></label>
      <button className="btn" disabled={busy} onClick={go}>{busy ? 'Preparing…' : 'Download Excel'}</button>
      <p className="hint">One sheet per account: the bank's lines with the running balance, and what each line is in the app and in Business Central (Posted / To Post).</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Statements({ accounts }) {
  const [accountId, setAccountId] = useState('');
  return (
    <div className="facts">
      <h2>Statements</h2>
      <DownloadAll accounts={accounts} />
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
        <option value="">Choose an account</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {accountId && <StatementView key={accountId} accountId={Number(accountId)} allowTag />}
    </div>
  );
}

export default function Bank() {
  const { isAdmin } = useAuth();
  const [accounts, setAccounts] = useState(null);
  const [bcList, setBcList] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | account
  const [mapping, setMapping] = useState(null);

  const load = useCallback(async () => {
    const [a, u, b] = await Promise.all([
      db.from('bank_accounts').select('*').order('name'),
      db.from('statement_uploads').select('*, by:profiles(full_name,email)').order('done_at', { ascending: false }).limit(200),
      db.from('bc_bank_accounts').select('*').eq('active', true).order('code'),
    ]);
    setAccounts(a.data ?? []);
    setUploads(u.data ?? []);
    setBcList(b.data ?? []);
    return b.data ?? [];
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
          {isAdmin && <button className="btn" onClick={() => { setEditing('new'); setMapping(null); }}>Add account</button>}</div>
        {!isAdmin && <p className="hint">A Finance Admin adds and changes bank accounts.</p>}
        {editing && <AccountForm initial={editing === 'new' ? null : editing} bcList={bcList} accounts={accounts} onListChanged={load}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
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
                    <td>{a.mapping?.format ? `${FORMATS[a.mapping.format]?.label.split(' "')[0] ?? a.mapping.format} layout` : a.mapping ? 'Set up' : <span className="warn-text">Not set up</span>}</td>
                    <td>{lastUpload[a.id] ? <>{fmtDateTime(lastUpload[a.id].done_at)}<div className="muted small">
                      +{lastUpload[a.id].lines_added} lines, {personName(lastUpload[a.id].by)}
                      {lastUpload[a.id].balance_check === 'mismatch' && <span className="warn-text"> · balance didn't agree</span>}</div></> : '—'}</td>
                    <td className="row">
                      <button className="link" onClick={() => { setMapping(a); setEditing(null); }}>Columns</button>
                      {isAdmin && <button className="link" onClick={() => { setEditing(a); setMapping(null); }}>Edit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BcList bcList={bcList} accounts={accounts} canEdit={isAdmin} onChanged={load} />

      <Statements accounts={accounts} />
    </section>
  );
}
