import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc, db } from '../lib/supabase';
import { parseCustomers, parseLedger, parseDetailedCustLedger } from '../lib/bcimport';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fmtDateTime, personName } from '../lib/format';

function LastUpload({ item, noun }) {
  if (!item) return <p className="hint">Not uploaded yet.</p>;
  return (
    <p className="hint">
      Last uploaded {fmtDateTime(item.done_at)} by {personName(item.by)}: {item.row_count.toLocaleString()} {noun}
      {item.file_name ? ` from ${item.file_name}` : ''}.
    </p>
  );
}

function UploadBox({ title, steps, noun, parse, describe, warn, upload, last, onDone, progress = '', doneMsg = null }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f); setParsed(null); setError(''); setMsg(''); setBusy(true);
    try { setParsed(await parse(f)); }
    catch (err) { setError(err.message); setFile(null); }
    finally { setBusy(false); }
  }

  async function send() {
    setBusy(true); setError('');
    try {
      const n = await upload(file.name, parsed);
      setMsg(doneMsg ? doneMsg(n) : `Uploaded ${n.toLocaleString()} ${noun}.`);
      setFile(null); setParsed(null);
      await onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const warning = parsed && warn ? warn(parsed) : '';

  return (
    <div className="facts">
      <h2>{title}</h2>
      <LastUpload item={last} noun={noun} />
      <details className="howto">
        <summary>How to export it from Business Central</summary>
        <ol>{steps.map((s) => <li key={s}>{s}</li>)}</ol>
      </details>
      <label className="btn file-btn">
        {busy && !parsed ? 'Reading the file…' : 'Choose Excel file'}
        <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={pick} disabled={busy} />
      </label>
      {parsed && (
        <div className="preview">
          <p><strong>{file.name}</strong>: {describe(parsed)}</p>
          {warning && <p className="warn-text">{warning}</p>}
          <div className="row">
            <button className="btn primary" onClick={send} disabled={busy}>{busy ? (progress || 'Uploading…') : 'Upload'}</button>
            <button className="btn ghost" onClick={() => { setFile(null); setParsed(null); }} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className="hint">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

const CHUNK = 2000;
// entries whose BC ledger entry (invoice or payment) is older than the file: the export was filtered by date
function missingHistory(rows) {
  const initial = new Set(rows.filter((r) => r.entry_type === 'Initial Entry').map((r) => r.cust_ledger_entry_no));
  return rows.filter((r) => !initial.has(r.cust_ledger_entry_no)).length;
}

export default function CustomerData() {
  const { role } = useAuth();
  const [last, setLast] = useState({});
  const [ledgerCustomers, setLedgerCustomers] = useState(0);
  const [progress, setProgress] = useState('');

  const load = useCallback(async () => {
    const q = (kind) => db.from('imports').select('*, by:profiles(full_name,email)')
      .eq('kind', kind).order('done_at', { ascending: false }).limit(1).maybeSingle();
    const [c, l, d] = await Promise.all([q('customers'), q('ledger'),
      db.from('bc_uploads').select('*, by:profiles(full_name,email)').eq('kind', 'cust_ledger').order('done_at', { ascending: false }).limit(1).maybeSingle()]);
    const n = await db.from('bc_cust_entries').select('entry_no', { count: 'exact', head: true });
    setLast({ customers: c.data, ledger: l.data, detail: d.data ? { ...d.data, row_count: n.count ?? 0 } : null });
    const { data } = await db.from('customer_ledger').select('customer_no').limit(5000);
    setLedgerCustomers(new Set((data ?? []).map((r) => r.customer_no)).size);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="narrow">
      <div className="page-head"><h1>Customer data</h1></div>
      <p className="lede">
        Upload these from Business Central so customers can be picked from a list and their open
        invoices appear on a new collection. Upload the open invoices whenever they may have
        changed, ideally each morning. Export customers (posting group EXPORT or IE-EXPORT, or a
        currency other than LKR) are left out of the app.
      </p>

      <UploadBox
        title="Customer list"
        noun="customers"
        last={last.customers}
        steps={[
          'Open Customers in Business Central.',
          'Clear any filters so every customer is listed, and make sure Customer Posting Group and Payment Terms Code are showing (Personalize if not). The Overview uses them.',
          'Choose Share → Open in Excel and save the file.',
          'Upload that file here without changing it.',
        ]}
        parse={parseCustomers}
        describe={(rows) => `${rows.length.toLocaleString()} customers found.`}
        upload={(name, rows) => rpc('cc_import_customers', { p_file: name, p_rows: rows })}
        onDone={load}
      />

      <UploadBox
        title="Open invoices (customer ledger entries)"
        noun="open entries"
        last={last.ledger}
        steps={[
          'Open Customer Ledger Entries in Business Central.',
          'Filter Open = Yes. Don\'t filter by customer: the upload replaces all open invoices.',
          'Make sure Customer No., Document No., Original Amount and Remaining Amount are showing (Personalize if not).',
          'Choose Share → Open in Excel and upload that file here.',
        ]}
        parse={parseLedger}
        describe={(p) => `${p.rows.length.toLocaleString()} open entries for ${p.customers.toLocaleString()} customers`
          + (p.skippedClosed ? ` (${p.skippedClosed.toLocaleString()} closed or zero rows ignored).` : '.')}
        warn={(p) => [
          p.customers <= 2 && ledgerCustomers > 5
            ? `This file only covers ${p.customers} customer${p.customers === 1 ? '' : 's'}, but the app currently holds open invoices for ${ledgerCustomers}. Uploading replaces them all. Check the export wasn't filtered to one customer.`
            : '',
          !p.hasOriginal
            ? 'This file has no "Original Amount" column. Without it, invoices part-paid in the app may be hidden too early once BC posts the payment. Add the column with Personalize and export again.'
            : '',
        ].filter(Boolean).join(' ')}
        upload={(name, p) => rpc('cc_import_ledger', { p_file: name, p_rows: p.rows })}
        onDone={load}
      />

      {role === 'finance' && (
        <UploadBox
          title="Customer ledger history (detailed customer ledger entries)"
          noun="entries in the app"
          last={last.detail}
          doneMsg={(n) => `Done: ${n.toLocaleString()} new entr${n === 1 ? 'y' : 'ies'} added; ones already in the app were kept.`}
          progress={progress}
          steps={[
            'Open Detailed Cust. Ledg. Entries in Business Central (search "Detailed Customer Ledger Entries").',
            'Clear every filter, the Posting Date filter too, so the whole history is included. Uploading again only adds what is new.',
            'Make sure Initial Entry Due Date, Cust. Ledger Entry No. and Amount (LCY) are showing (Personalize if not).',
            'Choose Share → Open in Excel and upload that file here. It is the same file BC check uses.',
          ]}
          parse={parseDetailedCustLedger}
          describe={(rows) => {
            const dates = rows.map((r) => r.posting_date).filter(Boolean).sort();
            return `${rows.length.toLocaleString()} entries for ${new Set(rows.map((r) => r.customer_no)).size.toLocaleString()} customers, posted ${dates[0] ?? '?'} to ${dates[dates.length - 1] ?? '?'}.`;
          }}
          warn={(rows) => [
            missingHistory(rows) > 0 ? `${missingHistory(rows).toLocaleString()} entries apply to invoices or payments posted before this file starts: it was exported with a Posting Date filter. Upload it anyway if you like, but balances and aging are only right once the whole history is in. Export again with no Posting Date filter.` : '',
            rows.some((r) => r.entry_type === 'Initial Entry' && !r.due_date) ? 'Some entries have no Initial Entry Due Date: add that column with Personalize and export again, or they age from their posting date.' : '',
          ].filter(Boolean).join(' ')}
          upload={async (name, rows) => {
            let added = 0;
            try {
              for (let i = 0; i < rows.length; i += CHUNK) {
                setProgress(`Uploading ${Math.min(i + CHUNK, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}…`);
                const r = await rpc('cc_import_cust_ledger', { p_file: name, p_rows: rows.slice(i, i + CHUNK) });
                added += Number(r?.new ?? 0);
              }
            } finally { setProgress(''); }
            return added;
          }}
          onDone={load}
        />
      )}
      <p className="hint">Balances and aging: <Link to="/customer-list">Customers</Link> · <Link to="/aging">Customer aging</Link>.</p>
    </section>
  );
}
