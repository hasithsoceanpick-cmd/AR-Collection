import { useEffect, useState } from 'react';
import { usePlatform } from './store';
import { supabase } from '../supabase';

/** One person's alert settings (table workspace_alert_prefs; no row = every alert). */
export type AlertPrefs = {
  own_tasks: 'all' | 'high' | 'off';
  given_tasks: 'all' | 'dates' | 'off';
  given_high_only: boolean;
  other_tasks: boolean;
  messages: boolean;
  reminders: boolean;
  signoff: boolean;
  summaries: boolean;
};
const EVERYTHING: AlertPrefs = { own_tasks: 'all', given_tasks: 'all', given_high_only: false, other_tasks: true,
  messages: true, reminders: true, signoff: true, summaries: true };
const HIGH_ONLY: AlertPrefs = { own_tasks: 'high', given_tasks: 'dates', given_high_only: true, other_tasks: false,
  messages: true, reminders: true, signoff: true, summaries: true };
const same = (a: AlertPrefs, b: AlertPrefs) => (Object.keys(a) as (keyof AlertPrefs)[]).every(k => a[k] === b[k]);

function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg alert-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={`seg-btn ${value === v ? 'on' : ''}`}
          onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

/**
 * "My alerts": what reaches this person's bell and phone. Alerts they switch off are never stored (the database drops
 * them in workspace_alert_filter); the work itself still shows in the apps.
 */
export default function AlertSettings({ onClose }: { onClose: () => void }) {
  const { me, dept, isAdmin, userHasApp, toast, fail } = usePlatform();
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null);
  const [saved, setSaved] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const tasks = isAdmin || (!!dept && userHasApp(me.id, 'tasks'));
  const messages = isAdmin || (!!dept && userHasApp(me.id, 'messages'));

  useEffect(() => {
    supabase.from('workspace_alert_prefs').select('*').eq('user_id', me.id).maybeSingle().then(({ data, error }) => {
      if (error) { fail(error); onClose(); return; }
      setSaved(!!data);
      const p = { ...EVERYTHING };
      if (data) for (const k of Object.keys(EVERYTHING) as (keyof AlertPrefs)[]) (p as Record<string, unknown>)[k] = data[k];
      setPrefs(p);
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof AlertPrefs>(k: K, v: AlertPrefs[K]) => setPrefs(p => p && { ...p, [k]: v });

  async function save() {
    if (!prefs) return;
    setBusy(true);
    const row = { ...prefs, updated_at: new Date().toISOString() };
    const { error } = saved
      ? await supabase.from('workspace_alert_prefs').update(row).eq('user_id', me.id)
      : await supabase.from('workspace_alert_prefs').insert({ user_id: me.id, ...row });
    setBusy(false);
    if (error) return fail(error);
    toast(same(prefs, EVERYTHING) ? 'Alerts saved — you\'ll get every alert' : 'Alerts saved — new alerts follow your choices');
    onClose();
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal alert-settings" role="dialog" aria-label="My alerts">
        <div className="modal-head">
          <strong>My alerts</strong>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {!prefs ? <div className="modal-body"><div className="muted">Loading…</div></div> : (
          <div className="modal-body">
            <p className="muted small">What reaches your bell and your phone. Work you switch off here still shows in the app —
              on Home, in your lists and in each task's history. Only new alerts change.</p>
            <div className="alert-presets">
              <span className="muted small">Quick choice:</span>
              <button type="button" className={`btn sm ${same(prefs, HIGH_ONLY) ? 'on' : ''}`} onClick={() => setPrefs({ ...HIGH_ONLY })}>
                High priority only</button>
              <button type="button" className={`btn sm ${same(prefs, EVERYTHING) ? 'on' : ''}`} onClick={() => setPrefs({ ...EVERYTHING })}>
                Everything</button>
            </div>

            {tasks && <>
              <div className="alert-group">
                <div className="alert-label"><strong>My tasks</strong><span className="muted small">given to me or mine — new task, due today, moved, missed, comments…</span></div>
                <Seg label="My tasks" value={prefs.own_tasks} onChange={v => set('own_tasks', v)}
                  options={[['all', 'All alerts'], ['high', 'High priority only'], ['off', 'None']]} />
              </div>
              <div className="alert-group">
                <div className="alert-label"><strong>Tasks I gave to others</strong></div>
                <Seg label="Tasks I gave to others" value={prefs.given_tasks} onChange={v => set('given_tasks', v)}
                  options={[['all', 'All alerts'], ['dates', 'Deadline moved or missed'], ['off', 'None']]} />
                {prefs.given_tasks !== 'off' && (
                  <label className="alert-check"><input type="checkbox" checked={prefs.given_high_only}
                    onChange={e => set('given_high_only', e.target.checked)} /> High priority only</label>
                )}
              </div>
              <div className="alert-group">
                <label className="alert-check"><input type="checkbox" checked={prefs.other_tasks} onChange={e => set('other_tasks', e.target.checked)} />
                  <span><strong>Other tasks</strong> <span className="muted small">— ones I help on or follow, and the team's as a manager
                    (missed, escalated, moved)</span></span></label>
              </div>
            </>}

            <div className="alert-group">
              <div className="alert-label"><strong>Also</strong></div>
              {messages && <label className="alert-check"><input type="checkbox" checked={prefs.messages} onChange={e => set('messages', e.target.checked)} />
                <span>Messages <span className="muted small">— one-to-one chats, @mentions, announcements</span></span></label>}
              {tasks && <label className="alert-check"><input type="checkbox" checked={prefs.reminders} onChange={e => set('reminders', e.target.checked)} />
                <span>My reminders</span></label>}
              <label className="alert-check"><input type="checkbox" checked={prefs.signoff} onChange={e => set('signoff', e.target.checked)} />
                <span>Sign-off requests{isAdmin ? ' and new sign-ups' : ''} <span className="muted small">— any priority</span></span></label>
              {tasks && <label className="alert-check"><input type="checkbox" checked={prefs.summaries} onChange={e => set('summaries', e.target.checked)} />
                <span>Summaries <span className="muted small">— morning team summary, weekly summary, month-end</span></span></label>}
            </div>
            <p className="muted tiny">Shared notes and the phone-alert test always come through.</p>
          </div>
        )}
        <div className="modal-foot row gap">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!prefs || busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </>
  );
}
