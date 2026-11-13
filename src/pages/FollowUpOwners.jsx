import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr } from '../lib/format';
import { zero } from '../lib/followup';

const SHOW = [
  { key: 'unowned', label: 'Overdue, no owner', test: (c) => !c.owner_id && !zero(c.overdue) },
  { key: 'overdue', label: 'Overdue', test: (c) => !zero(c.overdue) },
  { key: 'all', label: 'All local customers', test: () => true },
];

function CodeRow({ c, people, canEdit, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function change(e) {
    setBusy(true); setErr('');
    try { await rpc('cc_ar_set_salesperson', { p_code: c.code, p_user: e.target.value || null }); await onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <tr>
      <td><strong>{c.code}</strong></td><td className="num">{c.customers}</td>
      <td>{canEdit ? (
        <select value={c.user_id ?? ''} onChange={change} disabled={busy} aria-label={`Owner for ${c.code}`}>
          <option value="">Not mapped</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>) : (c.owner ?? <span className="muted">Not mapped</span>)}
        {err && <div className="error small">{err}</div>}</td>
    </tr>
  );
}

// Who follows up each local customer. Finance Admins assign owners; everyone in finance and management can see them.
export default function FollowUpOwners() {
  const [params, setParams] = useSearchParams();
  const show = SHOW.find((s) => s.key === params.get('show')) ?? SHOW[0];
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setData(await rpc('cc_ar_owners')); setError(''); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => (data?.customers ?? []).filter((c) => show.test(c)
    && (!q.trim() || `${c.name} ${c.customer_no} ${c.owner ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))), [data, show, q]);
  const canEdit = data?.can_edit;
  const people = data?.people ?? [];
  const allOn = list.length > 0 && list.every((c) => picked.has(c.customer_no));
  const flip = (no) => setPicked((s) => { const n = new Set(s); if (n.has(no)) n.delete(no); else n.add(no); return n; });

  async function assign(nos, user) {
    setBusy(true); setError(''); setMsg('');
    try {
      const n = await rpc('cc_ar_set_owner', { p_customers: nos, p_user: user || null });
      const who = people.find((p) => p.id === user)?.name;
      setMsg(n ? `${n} customer${n === 1 ? '' : 's'} ${who ? `now owned by ${who}` : 'now unassigned'}.` : 'Nothing changed.');
      setPicked(new Set()); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (!data && !error) return <section className="wide"><h1>Customer owners</h1><p className="muted">Loading…</p></section>;
  return (
    <section className="wide follow-up">
      <div className="page-head"><div>
        <h1>Customer owners</h1>
        <p className="lede">Each local customer&apos;s follow-ups go to its owner: the person assigned here, or BC&apos;s Salesperson Code when the customer list carries it.
          {canEdit ? ' Tick customers and assign them, or change one on its row.' : ' Finance Admins assign owners.'}</p>
      </div></div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="ok-text">{msg}</p>}
      {data && (
        <>
          <div className="kpis fu-kpis">
            <div><small>Local customers</small><span>{data.counts.customers}</span></div>
            <div><small>With an owner</small><span>{data.counts.owned}</span></div>
            <div className={data.counts.overdue_unowned ? 'fu-due' : ''}><small>Overdue, no owner</small><span>{data.counts.overdue_unowned}</span><small><Link to="/followup">on the worklist as Unassigned</Link></small></div>
          </div>
          <div className="filters">
            <input className="search" type="search" placeholder="Search customer or owner" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          <div className="chips" role="group" aria-label="Show">
            {SHOW.map((s) => <button key={s.key} type="button" className={show.key === s.key ? 'chip on' : 'chip'} aria-pressed={show.key === s.key}
              onClick={() => { setPicked(new Set()); setParams(s.key === 'unowned' ? {} : { show: s.key }, { replace: true }); }}>
              {s.label} <span className="count">{(data.customers ?? []).filter(s.test).length}</span></button>)}
          </div>
          {canEdit && picked.size > 0 && (
            <div className="fu-bulk" role="region" aria-label="Assign the ticked customers">
              <strong>{picked.size} ticked</strong>
              <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Assign to">
                <option value="">Choose the owner…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.role === 'finance' ? ' (finance)' : ''}</option>)}
                <option value="none">No owner</option>
              </select>
              <button className="btn primary small" type="button" disabled={busy || !to} onClick={() => assign([...picked], to === 'none' ? null : to)}>{busy ? 'Saving…' : 'Assign'}</button>
              <button className="link small" type="button" onClick={() => setPicked(new Set())}>Clear</button>
            </div>
          )}
          {list.length === 0 ? <div className="empty"><p>{show.key === 'unowned' ? 'Every overdue customer has an owner.' : 'No customer matches.'}</p></div> : (
            <div className="table-wrap">
              <table className="table fu-table fu-owners">
                <thead><tr>
                  {canEdit && <th className="c-pick"><input type="checkbox" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(list.map((c) => c.customer_no)))} aria-label="Tick all shown" /></th>}
                  <th>Customer</th><th className="num">Overdue</th><th className="num">Balance</th><th>Owner</th>
                </tr></thead>
                <tbody>{list.map((c) => (
                  <tr key={c.customer_no} className={picked.has(c.customer_no) ? 'on' : ''}>
                    {canEdit && <td className="c-pick"><input type="checkbox" checked={picked.has(c.customer_no)} onChange={() => flip(c.customer_no)} aria-label={`Tick ${c.name}`} /></td>}
                    <td data-label="Customer"><Link to={`/customer/${encodeURIComponent(c.customer_no)}#follow-up`}>{c.name}</Link>
                      <div className="muted small">{c.customer_no} · {c.seg}{c.terms ? ` · ${c.terms}` : ' · no terms'}{c.salesperson_code ? ` · BC ${c.salesperson_code}` : ''}</div></td>
                    <td data-label="Overdue" className="num">{zero(c.overdue) ? <span className="muted">–</span> : lkr(c.overdue)}</td>
                    <td data-label="Balance" className="num">{lkr(c.balance)}</td>
                    <td data-label="Owner">{canEdit ? (
                      <select value={c.source === 'app' ? c.owner_id : ''} onChange={(e) => assign([c.customer_no], e.target.value || null)} disabled={busy} aria-label={`Owner of ${c.name}`}>
                        <option value="">{c.source === 'bc' ? `${c.owner} (from BC)` : 'Unassigned'}</option>
                        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>) : (c.owner ? <>{c.owner}{c.source === 'bc' && <span className="muted small"> (from BC)</span>}</> : <span className="muted">Unassigned</span>)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {data.codes.length > 0 && (
            <div className="mi-card fu-codes">
              <div className="mi-head"><div><h2>BC salesperson codes</h2><span className="muted small">From the customer list. Map each code to the person in the app; an owner set above wins.</span></div></div>
              <div className="table-wrap flat"><table className="table"><thead><tr><th>Code</th><th className="num">Customers</th><th>Owner in the app</th></tr></thead>
                <tbody>{data.codes.map((c) => <CodeRow key={c.code} c={c} people={people} canEdit={canEdit} onDone={load} />)}</tbody></table></div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
