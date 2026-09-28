import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import JSZip from 'jszip';
import { supabase, rpc, BUCKET } from '../lib/supabase';
import { lkr, ref, fmtDate, daysAgo, personName } from '../lib/format';

const safe = (s) => String(s ?? '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60) || 'unnamed';
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const endDate = (c) => c.closed_at ?? c.cancelled_at;

// Every stored file belonging to a collection: cheque photos, transfer receipt,
// its deposit slip (shared with other collections on the slip) or an older single slip.
function filesOf(c) {
  const f = c.cheques.map((q) => ({ path: q.photo_path, kind: 'cheque', q }));
  if (c.receipt_path) f.push({ path: c.receipt_path, kind: 'receipt' });
  if (c.deposit?.slip_path) f.push({ path: c.deposit.slip_path, kind: 'slip', shared: true });
  else if (c.deposit_slip_path) f.push({ path: c.deposit_slip_path, kind: 'slip' });
  return f;
}

export default function Photos() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState(null);
  const [log, setLog] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('collections')
      .select('*, cheques(*), driver:profiles!collections_driver_id_fkey(full_name,email), deposit:deposits(id, slip_path, deposit_date, reference, collections(id, photos_deleted_at))')
      .in('status', ['closed', 'cancelled']).is('photos_deleted_at', null)
      .order('closed_at', { ascending: true, nullsFirst: false });
    if (error) { setError(error.message); return; }
    setRows(data.filter((c) => filesOf(c).length > 0));
    const l = await supabase.from('backup_log').select('*, by:profiles(full_name,email)').order('done_at', { ascending: false }).limit(10);
    setLog(l.data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const due = useMemo(() => (rows ?? []).filter((c) => daysAgo(endDate(c)) >= days), [rows, days]);
  const chosen = due.filter((c) => picked.has(c.id));
  const fileCount = (list) => list.reduce((n, c) => n + filesOf(c).length, 0);
  const allBackedUp = chosen.length > 0 && chosen.every((c) => c.backed_up_at);

  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setPicked(chosen.length === due.length ? new Set() : new Set(due.map((c) => c.id)));

  async function backup() {
    setBusy(true); setError('');
    try {
      const zip = new JSZip();
      const used = new Set();
      const unique = (p) => { let n = p, i = 2; while (used.has(n)) n = p.replace(/(\.\w+)$/, `_${i++}$1`); used.add(n); return n; };
      const lines = [['CC number', 'Customer no', 'Customer', 'Invoice(s)', 'Status', 'Expected LKR', 'Cheque no', 'Bank', 'Cheque date',
        'Cheque LKR', 'Driver', 'Collected on', 'Deposit date', 'Deposit ref', 'Closed/cancelled on', 'File'].join(',')];
      const total = fileCount(chosen);
      let done = 0, missing = 0;

      async function add(path, name) {
        setStatus(`Downloading ${++done} of ${total}…`);
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        if (error) { missing++; return '(photo missing)'; }
        zip.file(name, data);
        return name;
      }

      for (const c of chosen) {
        const folder = `${(endDate(c) ?? '').slice(0, 7)}/${safe(c.customer_name)}`;
        const base = [ref(c.id), c.customer_no, c.customer_name, c.invoice_refs, c.status, c.expected_amount];
        for (const f of filesOf(c)) {
          const ext = /\.pdf$/i.test(f.path) ? 'pdf' : 'jpg';
          const name = f.kind === 'cheque' ? `${ref(c.id)}_chq-${safe(f.q.cheque_no)}_LKR-${f.q.amount}.${ext}`
            : f.kind === 'receipt' ? `${ref(c.id)}_transfer-receipt.${ext}`
            : `${ref(c.id)}_deposit-slip${c.deposit ? `-D${c.deposit.id}` : ''}.${ext}`;
          const file = await add(f.path, unique(`${folder}/${name}`));
          lines.push([...base, f.q?.cheque_no ?? '', f.q?.bank ?? '', f.q?.cheque_date ?? '', f.q?.amount ?? '', personName(c.driver),
            c.collected_at?.slice(0, 10), c.deposit?.deposit_date ?? c.deposit_date, c.deposit?.reference ?? c.deposit_reference,
            endDate(c)?.slice(0, 10), file].map(csvCell).join(','));
        }
      }
      zip.file('cheques.csv', '\ufeff' + lines.join('\r\n'));
      setStatus('Building the zip file…');
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cheque-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);

      if (missing) {
        setError(`${missing} photo(s) could not be downloaded, so this backup was not marked complete. Check the zip and try again.`);
      } else {
        await rpc('cc_record_backup', { p_ids: chosen.map((c) => c.id), p_files: total });
        setStatus(`Backup downloaded: ${total} photos. Keep the zip somewhere safe before deleting.`);
      }
      await load();
    } catch (e) { setError(e.message); setStatus(''); }
    finally { setBusy(false); }
  }

  async function remove() {
    const n = fileCount(chosen);
    if (!window.confirm(`Permanently delete ${n} photos from ${chosen.length} collection(s)? The cheque details stay. This cannot be undone.`)) return;
    setBusy(true); setError('');
    try {
      const ids = new Set(chosen.map((c) => c.id));
      const paths = [...new Set(chosen.flatMap((c) => filesOf(c).filter((f) => !f.shared
        || c.deposit.collections.every((x) => ids.has(x.id) || x.photos_deleted_at)).map((f) => f.path)))];
      for (let i = 0; i < paths.length; i += 100) {
        setStatus(`Deleting ${Math.min(i + 100, paths.length)} of ${paths.length}…`);
        const { error } = await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
        if (error) throw new Error(`Delete stopped: ${error.message}`);
      }
      const count = await rpc('cc_mark_photos_deleted', { p_ids: chosen.map((c) => c.id) });
      setStatus(`Deleted photos for ${count} collection(s).`);
      setPicked(new Set());
      await load();
    } catch (e) { setError(e.message); setStatus(''); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <div className="page-head"><h1>Photo storage</h1></div>
      <p className="lede">
        Cheque photos, deposit slips and transfer receipts of finished items can be removed to free up space.
        A deposit slip shared by several collections is only deleted once all of them are.
        Download a backup first; deleting is only possible after that. The cheque details always stay.
      </p>

      <div className="list-tools">
        <label className="inline-field">Finished at least
          <input type="number" min="0" value={days} onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))} />
          days ago
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      {status && <p className="hint">{status}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows && due.length === 0 && <div className="empty"><p>No finished collections older than {days} days still have photos.</p></div>}

      {due.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Select all" checked={chosen.length === due.length} onChange={toggleAll} /></th>
                  <th>Collection</th><th>Customer</th><th className="num">LKR</th><th>Finished</th><th className="num">Photos</th><th>Backup</th>
                </tr>
              </thead>
              <tbody>
                {due.map((c) => (
                  <tr key={c.id}>
                    <td><input type="checkbox" aria-label={`Select ${ref(c.id)}`} checked={picked.has(c.id)} onChange={() => toggle(c.id)} /></td>
                    <td><Link to={`/c/${c.id}`}>{ref(c.id)}</Link></td>
                    <td>{c.customer_name}</td>
                    <td className="num">{lkr(c.collected_amount ?? c.expected_amount)}</td>
                    <td>{fmtDate(endDate(c))}</td>
                    <td className="num">{filesOf(c).length}</td>
                    <td>{c.backed_up_at ? fmtDate(c.backed_up_at) : <span className="muted">Not yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row sticky-actions">
            <button className="btn primary" disabled={busy || chosen.length === 0} onClick={backup}>
              Download backup{chosen.length ? ` (${fileCount(chosen)} photos)` : ''}
            </button>
            <button className="btn danger" disabled={busy || !allBackedUp} onClick={remove}
              title={allBackedUp ? '' : 'Download a backup of every selected collection first'}>
              Delete photos
            </button>
            {chosen.length > 0 && !allBackedUp && <span className="hint">Back up the selected collections to enable delete.</span>}
          </div>
        </>
      )}

      {log.length > 0 && (
        <div className="facts">
          <h2>Recent backups</h2>
          <ul className="plain">
            {log.map((b) => (
              <li key={b.id}>{fmtDate(b.done_at)}: {b.file_count} photos from {b.collection_ids.length} collection(s), by {personName(b.by)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
