import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../lib/supabase';
import { parseCustomers, parseLedger } from '../lib/bcimport';
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

function UploadBox({ title, steps, noun, parse, describe, warn, upload, last, onDone }) {
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
      setMsg(`Uploaded ${n.toLocaleString()} ${noun}.`);
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
            <button className="btn primary" onClick={send} disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
            <button className="btn ghost" onClick={() => { setFile(null); setParsed(null); }} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className="hint">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default function CustomerData() {
  const [last, setLast] = useState({});
  const [ledgerCustomers, setLedgerCustomers] = useState(0);

  const load = useCallback(async () => {
    const q = (kind) => supabase.from('imports').select('*, by:profiles(full_name,email)')
      .eq('kind', kind).order('done_at', { ascending: false }).limit(1).maybeSingle();
    const [c, l] = await Promise.all([q('customers'), q('ledger')]);
    setLast({ customers: c.data, ledger: l.data });
    const { data } = await supabase.from('customer_ledger').select('customer_no').limit(5000);
    setLedgerCustomers(new Set((data ?? []).map((r) => r.customer_no)).size);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="narrow">
      <div className="page-head"><h1>Customer data</h1></div>
      <p className="lede">
        Upload these from Business Central so customers can be picked from a list and their open
        invoices appear on a new collection. Upload the open invoices whenever they may have
        changed, ideally each morning.
      </p>

      <UploadBox
        title="Customer list"
        noun="customers"
        last={last.customers}
        steps={[
          'Open Customers in Business Central.',
          'Clear any filters so every customer is listed.',
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
          'Make sure Customer No., Document No. and Remaining Amount are showing (Personalize if not).',
          'Choose Share → Open in Excel and upload that file here.',
        ]}
        parse={parseLedger}
        describe={(p) => `${p.rows.length.toLocaleString()} open entries for ${p.customers.toLocaleString()} customers`
          + (p.skippedClosed ? ` (${p.skippedClosed.toLocaleString()} closed or zero rows ignored).` : '.')}
        warn={(p) => p.customers <= 2 && ledgerCustomers > 5
          ? `This file only covers ${p.customers} customer${p.customers === 1 ? '' : 's'}, but the app currently holds open invoices for ${ledgerCustomers}. Uploading replaces them all. Check the export wasn't filtered to one customer.`
          : ''}
        upload={(name, p) => rpc('cc_import_ledger', { p_file: name, p_rows: p.rows })}
        onDone={load}
      />
    </section>
  );
}
