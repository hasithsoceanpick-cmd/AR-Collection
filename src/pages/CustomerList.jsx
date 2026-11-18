import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { lkr, fmtDate, todayISO } from '../lib/format';
import { downloadNoTerms } from '../lib/aging';
import { PAY_METHODS, payMethodLabel } from '../lib/followup';
import LedgerStatus from '../components/LedgerStatus';

// Every customer from BC with what they owe; each opens their ledger.
export default function CustomerList() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [params] = useSearchParams();
  const [only, setOnly] = useState(params.get('show') === 'noterms' ? 'noterms' : 'owing');
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [terms, setTerms] = useState(null);   // customer no. -> credit terms in the app (null: not installed or not loaded)
  const [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState(null);   // customer no. -> payment method / staff (null: not installed)
  const [method, setMethod] = useState('');

  useEffect(() => {
    rpc('cc_customer_list', { p_as_at: todayISO() }).then(setData).catch((e) => { setError(e.message); setData({ rows: [] }); });
    rpc('cc_customer_profiles').then((p) => setProfiles(Object.fromEntries((p?.rows ?? []).map((x) => [x.customer_no, x])))).catch(() => {});
    rpc('cc_customer_terms', { p_customer_no: null })
      .then((t) => setTerms(Object.fromEntries((t?.terms ?? []).map((x) => [x.customer_no, x])))).catch(() => {});
  }, []);
  // no credit period: no terms in the app, or terms without days (e.g. bill to bill)
  const noPeriod = (r) => terms != null && terms[r.customer_no]?.min_days == null;

  const groups = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.group).filter(Boolean))].sort(), [data]);
  const term = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) => (!term || [r.name, r.customer_no, r.city, r.phone].some((v) => v?.toLowerCase().includes(term)))
      && (!group || r.group === group)
      && (!method || (method === 'none' ? !profiles?.[r.customer_no]?.pay_method : profiles?.[r.customer_no]?.pay_method === method))
      && (only === 'all' || (only === 'owing' && Math.abs(Number(r.balance)) >= 0.005) || (only === 'overdue' && Number(r.overdue) >= 0.005)
        || (only === 'noterms' && noPeriod(r))));
    const val = (r) => (sort.key === 'name' ? r.name.toLowerCase() : ['last_invoice', 'last_receipt'].includes(sort.key) ? r[sort.key] ?? '' : Number(r[sort.key] ?? 0));
    return [...list].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir || a.name.localeCompare(b.name));
  }, [data, term, group, only, sort, terms, method, profiles]);   // eslint-disable-line react-hooks/exhaustive-deps
  const by = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'name' ? 1 : -1 }));
  const arrow = (key) => (sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');
  const sum = (k) => shown.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const counts = useMemo(() => ({
    all: data?.rows.length ?? 0,
    owing: (data?.rows ?? []).filter((r) => Math.abs(Number(r.balance)) >= 0.005).length,
    overdue: (data?.rows ?? []).filter((r) => Number(r.overdue) >= 0.005).length,
    noterms: (data?.rows ?? []).filter(noPeriod).length,
  }), [data, terms]);   // eslint-disable-line react-hooks/exhaustive-deps
  async function download() {
    setBusy(true);
    try { await downloadNoTerms({ rows: shown, terms: terms ?? {}, all: only !== 'noterms' }); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="wide">
      <div className="page-head">
        <h1>Customers</h1>
        <div className="row">
          {terms != null && <button type="button" className="btn" disabled={!shown.length || busy} onClick={download}>{busy ? 'Preparing…' : 'Download Excel'}</button>}
          <Link className="btn" to="/aging">Customer aging</Link>
        </div>
      </div>
      <p className="lede">Every customer in BC's customer list with what they owe today. Open one for their ledger, open invoices and the receipts recorded in the app.</p>
      {error && <p className="error">{error}</p>}
      <LedgerStatus status={data?.status} />
      {data === null ? <p className="muted">Loading…</p> : (
        <>
          <div className="filters">
            <input className="search" type="search" placeholder="Search name, number, city or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
            {groups.length > 1 && (
              <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Customer group">
                <option value="">All groups</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            {profiles && (
              <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">
                <option value="">Every payment method</option>
                {PAY_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                <option value="none">Not set</option>
              </select>
            )}
            <div className="tabs" role="tablist" aria-label="Show">
              {[['owing', 'With a balance'], ['overdue', 'Overdue'], ['all', 'All'], ...(terms != null ? [['noterms', 'No credit period']] : [])].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={only === k} className={`tab${only === k ? ' on' : ''}`} onClick={() => setOnly(k)}>{l} ({counts[k]})</button>
              ))}
            </div>
          </div>
          {only === 'noterms' && (
            <p className="hint">Customers with no credit period in the app: no terms, or terms without days such as bill to bill. Their invoices age by BC’s due dates.
              {' '}Download Excel gives this list in the credit terms file layout: fill in Payment Terms Code (and BANK Transfers for COD/BT), then upload it on BC customer files → Credit terms. Blank rows are left as they are.</p>
          )}
          {shown.length === 0 ? <div className="empty"><p>No customer matches.</p></div> : (
            <div className="table-wrap">
              <table className="table customers-table">
                <thead><tr>
                  <th><button type="button" className="th-sort" onClick={() => by('name')}>Customer{arrow('name')}</button></th>
                  <th>Group</th><th>{terms != null ? 'Credit terms' : 'Terms'}</th>{profiles && <th>Pays by</th>}
                  <th className="num"><button type="button" className="th-sort" onClick={() => by('balance')}>Balance{arrow('balance')}</button></th>
                  <th className="num"><button type="button" className="th-sort" onClick={() => by('overdue')}>Overdue{arrow('overdue')}</button></th>
                  <th><button type="button" className="th-sort" onClick={() => by('last_invoice')}>Last invoice{arrow('last_invoice')}</button></th>
                  <th><button type="button" className="th-sort" onClick={() => by('last_receipt')}>Last receipt{arrow('last_receipt')}</button></th>
                </tr></thead>
                <tbody>{shown.map((r) => (
                  <tr key={r.customer_no} className="click" onClick={() => nav(`/customer/${encodeURIComponent(r.customer_no)}`)}>
                    <td><Link to={`/customer/${encodeURIComponent(r.customer_no)}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                      <div className="muted small">{[r.customer_no, r.city, r.phone].filter(Boolean).join(' · ')}{r.incomplete ? ' · history incomplete' : ''}{!r.in_list ? ' · not in the customer list' : ''}</div>
                      {profiles?.[r.customer_no]?.is_staff && <span className="pill staff">Staff</span>}</td>
                    <td>{r.group ?? '—'}</td>
                    <td>{terms == null ? (r.terms ?? '—') : terms[r.customer_no]
                      ? <>{terms[r.customer_no].terms}{terms[r.customer_no].min_days == null && <div className="muted small">no fixed days</div>}</>
                      : <span className="muted">None{r.terms ? <div className="small">BC: {r.terms}</div> : ''}</span>}</td>
                    {profiles && <td>{payMethodLabel(profiles[r.customer_no]?.pay_method) ?? <span className="muted">–</span>}</td>}
                    <td className="num strong">{Math.abs(Number(r.balance)) < 0.005 ? '–' : lkr(r.balance)}</td>
                    <td className={`num${Number(r.overdue) >= 0.005 ? ' late' : ' zero'}`}>{Number(r.overdue) >= 0.005 ? lkr(r.overdue) : '–'}</td>
                    <td>{fmtDate(r.last_invoice)}</td>
                    <td>{fmtDate(r.last_receipt)}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><td>Total ({shown.length})</td><td /><td />{profiles && <td />}<td className="num">{lkr(sum('balance'))}</td><td className="num">{lkr(sum('overdue'))}</td><td /><td /></tr></tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
