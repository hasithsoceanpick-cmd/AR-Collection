import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { lkr, ref } from '../lib/format';
import { KIND_LABEL, STATUS } from '../lib/workflow';
import NoteEditor from './NoteEditor';
import InvoiceNotes from './InvoiceNotes';
import {
  CHANNELS, OUTCOMES, METHODS, REASONS, RESOLVERS, RESOLUTIONS, PROMISE, ACTIVE,
  channelLabel, outcomeLabel, methodLabel, reasonLabel, resolverLabel, resolutionLabel, dmy, dmyTime, addDays, zero, collectionLink,
} from '../lib/followup';

const num = (v) => Number(String(v ?? '').replace(/,/g, ''));
const docsText = (inv) => (inv ?? []).map((i) => i.doc_no).join(', ');

// Log a contact (or correct an earlier one): channel, who, outcome, invoices, note, next action, and the promise or dispute.
function ContactForm({ data, corrects, onCancel, onSaved }) {
  const today = data.today;
  const inv = data.invoices;
  const [channel, setChannel] = useState(corrects?.channel ?? 'call');
  const [person, setPerson] = useState(corrects?.contact_person ?? data.customer.contact ?? '');
  const [outcome, setOutcome] = useState(corrects?.outcome ?? '');
  const [docs, setDocs] = useState(() => new Set((corrects?.invoices ?? []).map((i) => i.doc_no).filter((d) => inv.some((x) => x.doc_no === d))));
  const [note, setNote] = useState(corrects?.note ?? '');
  const [next, setNext] = useState('');
  const [pAmt, setPAmt] = useState('');
  const [pOn, setPOn] = useState('');
  const [pMethod, setPMethod] = useState('');
  const [dAmt, setDAmt] = useState('');
  const [dReason, setDReason] = useState('');
  const [dRole, setDRole] = useState('');
  const [dOn, setDOn] = useState('');
  const [dCn, setDCn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ticked = inv.filter((i) => docs.has(i.doc_no));
  const tickedSum = ticked.reduce((a, i) => a + Number(i.remaining), 0);
  const toggle = (d) => setDocs((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  const needNext = outcome && outcome !== 'paid_already' && !(outcome === 'promised' && pOn) && !(outcome === 'disputed' && dOn);

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    const p = {
      customer_no: data.customer.customer_no, channel, contact_person: person, outcome, note, invoices: [...docs],
      next_action_on: next || null, corrects_id: corrects?.id ?? null,
    };
    if (outcome === 'promised') p.promise = { amount: pAmt === '' ? (tickedSum || null) : num(pAmt), promised_on: pOn || null, method: pMethod || null };
    if (outcome === 'disputed') p.dispute = { amount: dAmt === '' ? null : num(dAmt), reason: dReason || null, owner_role: dRole || null, expected_on: dOn || null, credit_note_expected: dCn === '' ? null : num(dCn) };
    try { const r = await rpc('cc_ar_log_contact', { p }); await onSaved(r, p); }
    catch (x) { setErr(x.message); setBusy(false); }
  }

  const quickDates = [['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]];
  return (
    <form className="fu-form" onSubmit={save}>
      {corrects && <p className="notice small">Correcting the entry of {dmyTime(corrects.at)} by {corrects.by}. The old entry stays in the history, marked as corrected{corrects.outcome === 'promised' ? ', and its promise is cancelled' : corrects.outcome === 'disputed' ? ', and its dispute is withdrawn' : ''}.</p>}
      <fieldset className="field"><legend className="flabel">How</legend>
        <div className="chips">{CHANNELS.map((c) => <button key={c.key} type="button" className={channel === c.key ? 'chip on' : 'chip'} aria-pressed={channel === c.key} onClick={() => setChannel(c.key)}>{c.label}</button>)}</div>
      </fieldset>
      <label className="field"><span className="flabel">Who you spoke to</span>
        <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Name or role, e.g. Accounts" /></label>
      <fieldset className="field"><legend className="flabel">Outcome</legend>
        <div className="chips">{OUTCOMES.map((o) => <button key={o.key} type="button" className={outcome === o.key ? 'chip on' : 'chip'} aria-pressed={outcome === o.key} onClick={() => setOutcome(o.key)}>{o.label}</button>)}</div>
      </fieldset>

      <fieldset className="field"><legend className="flabel">Invoices discussed{outcome === 'disputed' ? '' : ' (optional)'}</legend>
        {inv.length === 0 ? <p className="hint">No open invoices in the latest ledger upload.</p> : (
          <div className="fu-inv">
            {inv.map((i) => (
              <label key={i.doc_no} className={`fu-inv-row${docs.has(i.doc_no) ? ' on' : ''}`}>
                <input type="checkbox" checked={docs.has(i.doc_no)} onChange={() => toggle(i.doc_no)} />
                <span className="fu-inv-doc"><strong>{i.doc_no}</strong><span className="muted small">due {dmy(i.due_date)}{i.late > 0 ? ` · ${i.late} days overdue` : ' · not due'}</span></span>
                <span className="fu-inv-tags">{i.disputed && <span className="pill warn">Disputed</span>}{i.promised && <span className="pill muted">Promised</span>}</span>
                <span className="num">{lkr(i.remaining)}</span>
              </label>
            ))}
            {ticked.length > 0 && <p className="hint">{ticked.length} ticked: LKR {lkr(tickedSum)}</p>}
          </div>
        )}
      </fieldset>

      {outcome === 'promised' && (
        <div className="fu-sub">
          <h3>Promise to pay</h3>
          <div className="fu-grid">
            <label className="field"><span className="flabel">Amount (LKR)</span>
              <input inputMode="decimal" value={pAmt} onChange={(e) => setPAmt(e.target.value)} placeholder={tickedSum ? tickedSum.toFixed(2) : '0.00'} />
              {pAmt === '' && tickedSum > 0 && <span className="hint">The invoices ticked, unless you type another amount</span>}</label>
            <label className="field"><span className="flabel">Pay by</span><input type="date" min={today} value={pOn} onChange={(e) => setPOn(e.target.value)} required /></label>
            <label className="field"><span className="flabel">How (optional)</span>
              <select value={pMethod} onChange={(e) => setPMethod(e.target.value)}><option value="">Not said</option>{METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
          </div>
          {pMethod === 'cheque_pickup' && <p className="hint">After saving you can create the cheque collection, with these invoices ticked.</p>}
        </div>
      )}
      {outcome === 'disputed' && (
        <div className="fu-sub">
          <h3>Dispute</h3>
          <div className="fu-grid">
            <label className="field"><span className="flabel">Amount disputed (LKR)</span>
              <input inputMode="decimal" value={dAmt} onChange={(e) => setDAmt(e.target.value)} placeholder={tickedSum ? tickedSum.toFixed(2) : 'Tick the invoices'} /></label>
            <label className="field"><span className="flabel">Reason</span>
              <select value={dReason} onChange={(e) => setDReason(e.target.value)} required><option value="">Choose…</option>{REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
            <label className="field"><span className="flabel">Who resolves it</span>
              <select value={dRole} onChange={(e) => setDRole(e.target.value)} required><option value="">Choose…</option>{RESOLVERS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
            <label className="field"><span className="flabel">Expected resolved by</span><input type="date" min={today} value={dOn} onChange={(e) => setDOn(e.target.value)} /></label>
            <label className="field"><span className="flabel">Credit note expected (LKR, optional)</span><input inputMode="decimal" value={dCn} onChange={(e) => setDCn(e.target.value)} /></label>
          </div>
        </div>
      )}

      <label className="field"><span className="flabel">Note{outcome === 'other' ? '' : ' (optional)'}</span>
        <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was said" required={outcome === 'other'} /></label>
      {outcome !== 'paid_already' && (
        <div className="field">
          <span className="flabel">Next action{needNext ? '' : ' (optional)'}</span>
          <div className="row">
            <input type="date" min={today} value={next} onChange={(e) => setNext(e.target.value)} aria-label="Next action date" required={Boolean(needNext)} />
            {quickDates.map(([l, n]) => <button key={l} type="button" className="chip" onClick={() => setNext(addDays(today, n))}>{l}</button>)}
          </div>
          {outcome === 'promised' && !next && <span className="hint">Left blank, it is the promised date.</span>}
          {outcome === 'disputed' && !next && dOn && <span className="hint">Left blank, it is the expected resolution date.</span>}
        </div>
      )}
      {err && <p className="error">{err}</p>}
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy || !outcome}>{busy ? 'Saving…' : corrects ? 'Save the correction' : 'Save'}</button>
        <button className="btn ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function PromiseItem({ p, data, onChanged }) {
  const st = PROMISE[p.status];
  const [cancel, setCancel] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const active = ACTIVE.includes(p.status);
  async function doCancel(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await rpc('cc_ar_promise_cancel', { p_id: p.id, p_reason: why }); await onChanged(); } catch (x) { setErr(x.message); setBusy(false); }
  }
  return (
    <li className="fu-item">
      <div className="fu-item-main">
        <span className={`pill ${st.tone}`}>{st.label}</span>
        <strong>LKR {lkr(p.amount)}</strong> by {dmy(p.promised_on)}{p.method ? ` · ${methodLabel(p.method)}` : ''}
        {!zero(p.received) && p.status !== 'cancelled' && <span className="muted small"> · LKR {lkr(p.received)} received</span>}
        <div className="muted small">
          {p.invoices?.length ? `${docsText(p.invoices)} · ` : ''}logged by {p.by} on {dmy(p.at)}
          {p.status === 'grace' && ` · broken if nothing comes in by ${dmy(p.deadline)}`}
          {p.cancelled_at && ` · cancelled by ${p.cancelled_by}: ${p.cancel_reason}`}
        </div>
      </div>
      <div className="fu-item-act">
        {p.collection_id && <Link to={`/c/${p.collection_id}`}>{ref(p.collection_id)}</Link>}
        {data.can.write && active && p.method === 'cheque_pickup' && !p.collection_id && <Link className="btn small" to={collectionLink(data.customer.customer_no, p)}>Create collection</Link>}
        {data.can.write && active && !cancel && <button type="button" className="link small" onClick={() => setCancel(true)}>Cancel</button>}
      </div>
      {cancel && (
        <form className="fu-inline" onSubmit={doCancel}>
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why is it cancelled?" aria-label="Reason" required />
          <button className="btn small" type="submit" disabled={busy || !why.trim()}>{busy ? 'Cancelling…' : 'Cancel the promise'}</button>
          <button className="link small" type="button" onClick={() => setCancel(false)}>Keep it</button>
          {err && <span className="error small">{err}</span>}
        </form>
      )}
    </li>
  );
}

function DisputeItem({ d, data, onChanged }) {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function resolve(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await rpc('cc_ar_dispute_resolve', { p_id: d.id, p_outcome: outcome, p_amount: amt === '' ? null : num(amt), p_note: note || null }); await onChanged(); }
    catch (x) { setErr(x.message); setBusy(false); }
  }
  return (
    <li className="fu-item">
      <div className="fu-item-main">
        <span className={`pill ${d.status === 'resolved' ? 'muted' : d.late ? 'bad' : 'warn'}`}>{d.status === 'resolved' ? resolutionLabel(d.outcome) : d.late ? 'Past its date' : 'Open'}</span>
        <strong>LKR {lkr(d.amount)}</strong> · {reasonLabel(d.reason)} · {resolverLabel(d.owner_role)} to resolve{d.expected_on ? ` by ${dmy(d.expected_on)}` : ''}
        <div className="muted small">
          {docsText(d.invoices)}{d.credit_note_expected ? ` · credit note expected LKR ${lkr(d.credit_note_expected)}` : ''} · opened by {d.by} on {dmy(d.at)}
          {d.note ? ` · ${d.note}` : ''}
          {d.status === 'resolved' && ` · resolved by ${d.resolved_by} on ${dmy(d.resolved_at)}${d.outcome_amount ? `, LKR ${lkr(d.outcome_amount)}` : ''}${d.outcome_note ? `: ${d.outcome_note}` : ''}`}
        </div>
      </div>
      <div className="fu-item-act">{data.can.write && d.status === 'open' && !open && <button type="button" className="link small" onClick={() => setOpen(true)}>Resolve</button>}</div>
      {open && (
        <form className="fu-inline" onSubmit={resolve}>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="How it was resolved" required>
            <option value="">How was it resolved?</option>
            {RESOLUTIONS.filter((r) => !r.finance || role === 'finance').map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          {['credit_note', 'partly_accepted', 'written_off'].includes(outcome) && <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="Amount (LKR)" aria-label="Amount" required={outcome === 'credit_note'} />}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
          <button className="btn small" type="submit" disabled={busy || !outcome}>{busy ? 'Saving…' : 'Resolve'}</button>
          <button className="link small" type="button" onClick={() => setOpen(false)}>Cancel</button>
          {err && <span className="error small">{err}</span>}
        </form>
      )}
    </li>
  );
}

function Remind({ data, onDone }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  async function send(e) {
    e.preventDefault(); setBusy(true); setErr(''); setMsg('');
    try { const who = await rpc('cc_ar_remind', { p_customer_no: data.customer.customer_no, p_note: note || null }); setMsg(`Reminded ${who}.`); setOpen(false); setNote(''); await onDone(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  if (!open) return <>{msg && <span className="ok-text small">{msg}</span>}<button type="button" className="btn small" onClick={() => setOpen(true)}>Remind {data.customer.owner}</button></>;
  return (
    <form className="fu-inline" onSubmit={send}>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Reminder note" />
      <button className="btn small primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reminder'}</button>
      <button className="link small" type="button" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="error small">{err}</span>}
    </form>
  );
}

function OwnerPicker({ data, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function change(e) {
    setBusy(true); setErr('');
    try { await rpc('cc_ar_set_owner', { p_customers: [data.customer.customer_no], p_user: e.target.value || null }); await onDone(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <label className="fu-owner">
      <span className="muted small">Owner</span>
      <select value={data.customer.owner_id ?? ''} onChange={change} disabled={busy} aria-label="Owner">
        <option value="">Unassigned</option>
        {(data.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.role === 'finance' ? ' (finance)' : ''}</option>)}
      </select>
      {err && <span className="error small">{err}</span>}
    </label>
  );
}

// The follow-up panel on a customer's page: owner, net to chase, log a contact, promises, disputes, money on its way, history.
export default function FollowUpPanel({ customerNo }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);     // null | { corrects }
  const [saved, setSaved] = useState(null);
  const [allHistory, setAllHistory] = useState(false);

  const load = useCallback(async () => {
    try { setData(await rpc('cc_ar_customer', { p_customer_no: customerNo })); setError(''); } catch (e) { setError(e.message); }
  }, [customerNo]);
  useEffect(() => { setData(null); setForm(null); setSaved(null); load(); }, [load]);

  const history = useMemo(() => {
    if (!data) return [];
    const promiseOf = Object.fromEntries(data.promises.filter((p) => p.contact_id).map((p) => [p.contact_id, p]));
    const disputeOf = Object.fromEntries(data.disputes.filter((d) => d.contact_id).map((d) => [d.contact_id, d]));
    return [
      ...data.contacts.map((c) => ({ kind: 'contact', at: c.at, c, p: promiseOf[c.id], d: disputeOf[c.id] })),
      ...data.log.map((l) => ({ kind: 'log', at: l.at, l })),
      ...(data.notes ?? []).map((n) => ({ kind: 'note', at: n.at, n })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [data]);

  if (error) return <section id="follow-up" className="mi-card fu-panel"><div className="mi-head"><h2>Follow-up</h2></div><p className="error fu-pad">{error}</p></section>;
  if (!data) return <section id="follow-up" className="mi-card fu-panel"><div className="mi-head"><h2>Follow-up</h2></div><p className="muted fu-pad">Loading…</p></section>;
  const c = data.customer;
  const s = data.summary;
  const active = data.promises.filter((p) => ACTIVE.includes(p.status));
  const openD = data.disputes.filter((d) => d.status === 'open');
  const brokenRecent = data.promises.filter((p) => p.status === 'broken').length;
  const shownHistory = allHistory ? history : history.slice(0, 8);

  async function afterSave(r, p) {
    setForm(null);
    setSaved(p.outcome === 'promised' && p.promise?.method === 'cheque_pickup' && r.promise_id ? r.promise_id : 'ok');
    await load();
  }
  const savedPromise = typeof saved === 'number' ? data.promises.find((p) => p.id === saved) : null;

  return (
    <section id="follow-up" className="mi-card fu-panel" aria-label="Follow-up">
      <div className="mi-head">
        <div>
          <h2>Follow-up</h2>
          <span className="muted small">
            {c.scope !== 'local' ? 'Not on the follow-up list' : c.owner ? <>Owner: <strong>{c.owner}</strong>{c.owner_source === 'bc' ? ` (BC salesperson ${c.salesperson_code})` : ''}</> : 'No owner yet'}
          </span>
        </div>
        <div className="row fu-head-act">
          {data.can.admin && c.scope === 'local' && <OwnerPicker data={data} onDone={load} />}
          {data.can.remind && <Remind data={data} onDone={load} />}
          {data.can.write && !form && <button type="button" className="btn primary small" onClick={() => { setSaved(null); setForm({}); }}>Log a contact</button>}
        </div>
      </div>

      {c.scope === 'no_group' && <p className="notice fu-pad">This customer has no posting group in BC, so it isn't on the follow-up list. Give it one in BC and upload the customer list again.</p>}
      <div className="fu-flags fu-pad">
        {!c.terms && <span className="pill warn">No payment terms in BC</span>}
        {s.in_credit && <span className="pill warn">In credit overall: finance to check</span>}
        {s.over_limit && <span className="pill bad">Over the credit limit of LKR {lkr(c.credit_limit)}</span>}
        {brokenRecent > 0 && <span className="pill bad">{brokenRecent} broken promise{brokenRecent === 1 ? '' : 's'}</span>}
      </div>
      <dl className="fu-sum">
        <div><dt>Overdue</dt><dd>{lkr(s.overdue)}</dd></div>
        <div><dt>On its way</dt><dd>{lkr(s.on_way)}</dd></div>
        <div><dt>Unapplied credits</dt><dd>{lkr(s.credits)}</dd></div>
        <div><dt>Disputed</dt><dd>{lkr(s.disputed)}</dd></div>
        <div className="fu-net"><dt>Net to chase</dt><dd>{lkr(s.net)}</dd></div>
      </dl>
      {c.scope === 'local' && (data.note || data.can.write) && (
        <div className="fu-pad fu-custnote"><span className="flabel">Note</span>
          <NoteEditor customerNo={c.customer_no} note={data.note} canWrite={data.can.write} onSaved={load} /></div>
      )}

      {saved && (
        <p className="ok-text fu-pad">Saved.{savedPromise && savedPromise.method === 'cheque_pickup' && !savedPromise.collection_id && <> <Link to={collectionLink(c.customer_no, savedPromise)}>Create the cheque collection</Link> with its invoices ticked.</>}</p>
      )}
      {form && <div className="fu-pad"><ContactForm data={data} corrects={form.corrects} onCancel={() => setForm(null)} onSaved={afterSave} /></div>}

      {(active.length > 0 || openD.length > 0) && (
        <div className="fu-pad">
          {active.length > 0 && <><h3>Promises</h3><ul className="fu-list">{active.map((p) => <PromiseItem key={p.id} p={p} data={data} onChanged={load} />)}</ul></>}
          {openD.length > 0 && <><h3>Open disputes</h3><ul className="fu-list">{openD.map((d) => <DisputeItem key={d.id} d={d} data={data} onChanged={load} />)}</ul></>}
        </div>
      )}

      {c.scope === 'local' && (data.invoices.length > 0 || data.closed_notes?.length > 0) && (
        <details className="fu-pad fu-onway" open>
          <summary><strong>Invoices and notes ({data.invoices.length} open)</strong> <span className="muted small">a note on any invoice line</span></summary>
          <InvoiceNotes customerNo={c.customer_no} data={data} onChange={load} />
        </details>
      )}

      {data.on_way.length > 0 && (
        <details className="fu-pad fu-onway">
          <summary><strong>Money on its way ({data.on_way.length})</strong> <span className="muted small">recorded in the app, not in the BC ledger yet</span></summary>
          <ul className="fu-list">{data.on_way.map((w) => (
            <li key={`${w.src}-${w.id}`} className="fu-item">
              <div className="fu-item-main">
                {w.src === 'payhere' ? <span className="pill muted">PayHere</span> : <span className={`stamp tone-${STATUS[w.status]?.tone ?? 'grey'}`}>{STATUS[w.status]?.label ?? w.status}</span>}
                {' '}<strong>LKR {lkr(w.amount)}</strong> · {w.src === 'payhere' ? 'web payment' : KIND_LABEL[w.kind] ?? w.kind} · {dmy(w.at)}
                <div className="muted small">{w.docs?.length ? `In ${w.docs.join(', ')}, not in the customer ledger upload yet` : 'Not exported to BC yet'}{w.by ? ` · recorded by ${w.by}` : ''}</div>
              </div>
              <div className="fu-item-act">{w.href && <Link to={w.href}>{w.src === 'collection' ? ref(w.id) : 'Open'}</Link>}</div>
            </li>
          ))}</ul>
        </details>
      )}

      <div className="fu-pad">
        <h3>History</h3>
        {history.length === 0 ? <p className="muted">Nothing logged yet.</p> : (
          <ol className="fu-timeline">
            {shownHistory.map((h) => (h.kind === 'contact' ? (
              <li key={`c${h.c.id}`} className={h.c.corrected_by ? 'fu-corrected' : ''}>
                <span className="fu-when">{dmyTime(h.at)}</span>
                <div>
                  <strong>{channelLabel(h.c.channel)}{h.c.contact_person ? ` with ${h.c.contact_person}` : ''}: {outcomeLabel(h.c.outcome).toLowerCase()}</strong>
                  <span className="muted small"> · {h.c.by}</span>
                  {h.c.note && <p className="fu-note">{h.c.note}</p>}
                  <div className="muted small">
                    {h.c.invoices?.length > 0 && <>Invoices {h.c.invoices.map((i) => `${i.doc_no} (${lkr(i.remaining)})`).join(', ')} · </>}
                    {h.p && <>Promise LKR {lkr(h.p.amount)} by {dmy(h.p.promised_on)}: <span className={`pill ${PROMISE[h.p.status].tone}`}>{PROMISE[h.p.status].label}</span> · </>}
                    {h.d && <>Dispute LKR {lkr(h.d.amount)}, {reasonLabel(h.d.reason).toLowerCase()} · </>}
                    {h.c.next_action_on ? `Next action ${dmy(h.c.next_action_on)}` : 'No next action'}
                    {h.c.corrects_id && ' · corrects an earlier entry'}
                  </div>
                  {h.c.corrected_by ? <div className="small">Corrected by a later entry</div>
                    : data.can.write && !form && <button type="button" className="link small" onClick={() => { setSaved(null); setForm({ corrects: h.c }); }}>Correct</button>}
                </div>
              </li>
            ) : h.kind === 'note' ? (
              <li key={`n${h.n.id}`} className="fu-noteh">
                <span className="fu-when">{dmyTime(h.at)}</span>
                <div><strong>{h.n.doc_no ? `Note on ${h.n.doc_no}` : 'Customer note'}{h.n.text ? (h.n.replaces_id ? ' changed' : '') : ' cleared'}</strong>
                  <span className="muted small"> · {h.n.by}</span>{h.n.text && <p className="fu-note">{h.n.text}</p>}</div>
              </li>
            ) : (
              <li key={`l${h.l.at}${h.l.action}`} className="fu-log">
                <span className="fu-when">{dmyTime(h.at)}</span>
                <div><span>{h.l.note}</span><span className="muted small"> · {h.l.by}</span></div>
              </li>
            )))}
          </ol>
        )}
        {history.length > shownHistory.length && <button type="button" className="link" onClick={() => setAllHistory(true)}>Show all {history.length}</button>}
        {data.promises.some((p) => !ACTIVE.includes(p.status)) && (
          <details className="fu-past"><summary className="small">Past promises ({data.promises.filter((p) => !ACTIVE.includes(p.status)).length})</summary>
            <ul className="fu-list">{data.promises.filter((p) => !ACTIVE.includes(p.status)).map((p) => <PromiseItem key={p.id} p={p} data={data} onChanged={load} />)}</ul>
          </details>
        )}
        {data.disputes.some((d) => d.status !== 'open') && (
          <details className="fu-past"><summary className="small">Resolved disputes ({data.disputes.filter((d) => d.status !== 'open').length})</summary>
            <ul className="fu-list">{data.disputes.filter((d) => d.status !== 'open').map((d) => <DisputeItem key={d.id} d={d} data={data} onChanged={load} />)}</ul>
          </details>
        )}
      </div>
    </section>
  );
}
