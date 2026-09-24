import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import JSZip from 'jszip';
import { supabase, rpc, BUCKET } from '../lib/supabase';
import { lkr, ref, fmtDate, daysAgo, personName } from '../lib/format';

const safe = (s) => String(s ?? '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60) || 'unnamed';
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const endDate = (c) => c.closed_at ?? c.cancelled_at;

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
      .select('*, cheques(*), driver:profiles!collections_driver_id_fkey(full_name,email)')
      .in('status', ['closed', 'cancelled']).is('photos_deleted_at', null)
      .order('closed_at', { ascending: true, nullsFirst: false });
    if (error) { setError(error.message); return; }
    setRows(data.filter((c) => c.cheques.length > 0 || c.deposit_slip_path));
    const l = await supabase.from('backup_log').select('*, by:profiles(full_name,email)').order('done_at', { ascending: false }).limit(10);
    setLog(l.data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const due = useMemo(() => (rows ?? []).filter((c) => daysAgo(endDate(c)) >= days), [rows, days]);
  const chosen = due.filter((c) => picked.has(c.id));
  const fileCount = (list) => list.reduce((n, c) => n + c.cheques.length + (c.deposit_slip_path ? 1 : 0), 0);
  const allBackedUp = chosen.length > 0 && chosen.every((c) => c.backed_up_at);

  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setPicked(chosen.length === due.length ? new Set() : new Set(due.map((c) => c.id)));

  async function backup() {
    setBusy(true); setError('');
    try {
      const zip = new JSZip();
      const used = new Set();
      const unique = (p) => { let n = p, i = 2; while (used.has(n)) n = p.replace(/\.jpg$/, `_${i++}.jpg`); used.add(n); return n; };
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
        for (const q of c.cheques) {
          const file = await add(q.photo_path, unique(`${folder}/${ref(c.id)}_chq-${safe(q.cheque_no)}_LKR-${q.amount}.jpg`));
          lines.push([...base, q.cheque_no, q.bank, q.cheque_date, q.amount, personName(c.driver),
            c.collected_at?.slice(0, 10), c.deposit_date, c.deposit_reference, endDate(c)?.slice(0, 10), file].map(csvCell).join(','));
        }
        if (c.deposit_slip_path) {
          const file = await add(c.deposit_slip_path, unique(`${folder}/${ref(c.id)}_deposit-slip.jpg`));
          lines.push([...base, '', '', '', '', personName(c.driver), c.collected_at?.slice(0, 10),
            c.deposit_date, c.deposit_reference, endDate(c)?.slice(0, 10), file].map(csvCell).join(','));
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
      const paths = chosen.flatMap((c) => [...c.cheques.map((q) => q.photo_path), c.deposit_slip_path].filter(Boolean));
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
        Cheque and deposit-slip photos of finished collections can be removed to free up space.
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
                    <td className="num">{c.cheques.length + (c.deposit_slip_path ? 1 : 0)}</td>
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
