import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../../lib/supabase';
import { parseItemLedger, parseItems } from '../../lib/bcimport';
import { dmy, num0 } from '../../lib/analysis';
import { fmtDateTime } from '../../lib/format';
import { AnPage, Loading, useAnStatus } from './AnCommon';

const CHUNK = 2000;
const KINDS = { item_entries: 'Item Ledger Entries', items: 'Items' };

// One BC file: pick it, check it, send it in parts under one batch, report what happened.
function UploadBox({ kind, title, hint, parse, fn, onDone }) {
  const input = useRef(null);
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setRes(null); setBusy('Reading the file…');
    try {
      const rows = await parse(file);
      const batch = `${kind}-${crypto.randomUUID()}`;
      const tot = { rows_in: 0, new: 0, changed: 0, not_sale: 0, export: 0, incomplete: 0 };
      for (let i = 0; i < rows.length; i += CHUNK) {
        setBusy(`Uploading ${num0(Math.min(i + CHUNK, rows.length))} of ${num0(rows.length)}…`);
        const r = await rpc(fn, { p_batch: batch, p_file: file.name, p_rows: rows.slice(i, i + CHUNK) });
        for (const k of Object.keys(tot)) tot[k] += Number(r[k] ?? 0);
      }
      setRes({ ...tot, file: file.name, first: rows.first, last: rows.last, warning: rows.warning });
      await onDone();
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  }
  return (
    <div className="mi-card an-upload">
      <h2>{title}</h2>
      <div className="small">{hint}</div>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv" hidden onChange={pick} aria-label={`Choose the ${title} file`} />
      <button type="button" className="btn primary" disabled={!!busy} onClick={() => input.current?.click()}>{busy || `Upload ${title}`}</button>
      {err && <p className="error">{err}</p>}
      {res && (
        <div className="notice" role="status">
          <p><strong>{res.file}</strong>: {num0(res.rows_in)} rows. {num0(res.new)} new, {num0(res.changed)} changed, {num0(res.rows_in - res.new - res.changed - res.not_sale - res.export - res.incomplete)} already there.</p>
          {kind === 'item_entries' && res.first && <p className="small">Posting dates {dmy(res.first)} to {dmy(res.last)}.</p>}
          {(res.export > 0 || res.not_sale > 0 || res.incomplete > 0) && (
            <p className="small">Skipped: {[res.export > 0 && `${num0(res.export)} for export customers`, res.not_sale > 0 && `${num0(res.not_sale)} not sales (other entry types)`,
              res.incomplete > 0 && `${num0(res.incomplete)} without an item, customer, date or quantity`].filter(Boolean).join(', ')}.</p>
          )}
          {res.warning && <p className="small">{res.warning}</p>}
        </div>
      )}
    </div>
  );
}

// Analysis → Uploads: BC Item Ledger Entries and Items. The customer ledger comes from the collections side.
export default function AnUploads() {
  const { status, error, reload } = useAnStatus();
  if (!status) return <AnPage title="Uploads"><Loading error={error} /></AnPage>;
  const e = status.entries;
  return (
    <AnPage title="Uploads" lede="The BC files the analysis reads. Uploading a file again only adds new entries and updates changed ones; nothing is deleted.">
      <div className="an-tiles">
        <div className="an-tile"><span className="an-tile-label">Item ledger entries</span><span className="an-tile-value">{num0(e.n)}</span>
          <span className="an-tile-sub">{e.n ? `${dmy(e.first)} to ${dmy(e.last)}, ${num0(e.customers)} customers, ${num0(e.items)} items` : 'none yet'}</span></div>
        <div className="an-tile"><span className="an-tile-label">Items</span><span className="an-tile-value">{num0(status.items.n)}</span>
          <span className="an-tile-sub">{status.items.at ? `updated ${fmtDateTime(status.items.at)}` : 'none yet'}</span></div>
        <div className="an-tile"><span className="an-tile-label">Customer ledger</span><span className="an-tile-value">{status.ledger.last ? dmy(status.ledger.last) : '—'}</span>
          <span className="an-tile-sub">latest posting date</span></div>
      </div>
      {status.can.change ? (
        <div className="an-uploads">
          <UploadBox kind="item_entries" title="Item Ledger Entries" fn="cc_an_import_item_entries" parse={parseItemLedger} onDone={reload}
            hint={<ol>
              <li>In BC, open <strong>Item Ledger Entries</strong> and filter <strong>Entry Type</strong> = Sale and the posting dates you need (the first time, from 01/07/2025).</li>
              <li>The page needs <strong>Source No.</strong> (the customer) and <strong>Sales Amount (Actual)</strong>: add them with Personalize if they're hidden.</li>
              <li>Share → <strong>Open in Excel</strong>, then upload that file unchanged. Export customers are left out.</li>
            </ol>} />
          <UploadBox kind="items" title="Items" fn="cc_an_import_items" parse={parseItems} onDone={reload}
            hint={<p>BC → <strong>Items</strong> → Open in Excel. The analysis uses the description, inventory posting group and base unit of measure. Upload it again when new items are added.</p>} />
          <div className="mi-card an-upload">
            <h2>Customer ledger</h2>
            <p className="small">Payments and invoices come from the <strong>Detailed Cust. Ledg. Entries</strong> already uploaded for the collections side. For the trends,
              upload it once from 01/07/2025 on <Link to="/customers">Customer data</Link> (it adds and updates; it never removes anything).</p>
          </div>
        </div>
      ) : <p className="muted">Finance uploads these files.</p>}
      <h2>Recent uploads</h2>
      {status.uploads.length === 0 ? <p className="muted">None yet.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">When</th><th scope="col">File</th><th scope="col">What</th><th scope="col" className="num">Rows</th><th scope="col" className="num">New</th>
              <th scope="col" className="num">Changed</th><th scope="col" className="num">Skipped</th><th scope="col">Dates</th><th scope="col">By</th></tr></thead>
            <tbody>{status.uploads.map((u) => (
              <tr key={`${u.at}-${u.file}`}><td>{fmtDateTime(u.at)}</td><td>{u.file}</td><td>{KINDS[u.kind]}</td><td className="num">{num0(u.rows_in)}</td>
                <td className="num">{num0(u.new)}</td><td className="num">{num0(u.changed)}</td><td className="num">{num0(u.skipped)}</td>
                <td>{u.first ? `${dmy(u.first)} to ${dmy(u.last)}` : ''}</td><td>{u.by}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </AnPage>
  );
}
