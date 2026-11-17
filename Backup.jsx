import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, rpc, IS_DEMO } from '../lib/supabase';
import { fmtDateTime, daysAgo, personName } from '../lib/format';
import { takeBackup } from '../lib/backup';

export const BACKUP_DUE_DAYS = 7;

// Finance Admin: download every receipt, its settlement and everything around it, and see past backups.
export default function Backup() {
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await db.from('data_backups').select('*, by:profiles(full_name, email)').order('taken_at', { ascending: false }).limit(20);
    setLog(data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function go() {
    setBusy(true); setError(''); setDone(null);
    try {
      const r = await takeBackup(setStatus);
      await rpc('cc_backup_record', { p_file: r.file, p_counts: r.counts });
      setDone(r); setStatus('');
      await load();
    } catch (e) { setError(`The backup failed: ${e.message}`); setStatus(''); }
    finally { setBusy(false); }
  }

  const last = log?.[0];
  const age = last ? daysAgo(last.taken_at) : null;
  return (
    <section className="narrow backup-page">
      <div className="page-head"><h1>Data backup</h1></div>
      <p className="lede">Download everything in the app{IS_DEMO ? "'s Demo section" : ''} as one Excel file: every receipt (cheques, transfers, card and cash) with its invoice settlement,
        the cheques and how they were split, deposit slips, cash handovers, BC documents, each item's history and the bank lines. Keep the file somewhere safe.
        Take one at least every {BACKUP_DUE_DAYS} days.</p>

      {log !== null && (last
        ? <div className={`notice${age >= BACKUP_DUE_DAYS ? '' : ' ok-notice'}`}>Last backup {fmtDateTime(last.taken_at)} by {personName(last.by)}
            {age >= BACKUP_DUE_DAYS ? `: ${age} days ago, so one is due.` : '.'}</div>
        : <div className="notice">No backup has been taken yet.</div>)}

      <div className="action">
        <h2>Take a backup</h2>
        <p className="hint">It reads everything and downloads <strong>AR Collections backup (date).xlsx</strong>. Photos, receipts and slips are not in it: back those up from <Link to="/photos">Photo storage</Link>.</p>
        <div className="row"><button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Taking the backup…' : 'Download backup (Excel)'}</button></div>
        {status && <p className="hint">{status}</p>}
        {done && (
          <div>
            <p className="ok-text">Downloaded {done.file}.</p>
            <p className="hint">{Object.entries(done.counts).filter(([k]) => k !== 'Receipts (all fields)').map(([k, n]) => `${k}: ${n}`).join(' · ')}</p>
            {done.problems.length > 0 && <p className="error">Some parts could not be read: {done.problems.join('; ')}</p>}
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {log?.length > 0 && (
        <div className="facts">
          <h2>Backups taken</h2>
          <div className="table-wrap flat">
            <table className="table">
              <thead><tr><th>When</th><th>By</th><th className="num">Receipts</th><th className="num">Settlement lines</th><th>File</th></tr></thead>
              <tbody>{log.map((b) => (
                <tr key={b.id}><td>{fmtDateTime(b.taken_at)}</td><td>{personName(b.by)}</td>
                  <td className="num">{b.counts?.Receipts ?? ''}</td><td className="num">{b.counts?.Settlement ?? ''}</td><td className="small">{b.file_name}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
