import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { IS_DEMO, switchMode, rpc } from '../lib/supabase';
import Notifications from './Notifications';
import InstallButton from './InstallButton';
import GlobalSearch from './GlobalSearch';
import UploadMenu from './UploadMenu';
import Icon from './Icon';
import { useChatUnread } from '../lib/chat';
import { financeSections, sectionFor, countOf, SETTINGS_PATHS } from '../lib/sections';

const ROLE_LABEL = { sales: 'Sales', driver: 'Driver', finance: 'Finance', executive: 'Management' };

// The menu for every role but finance (finance has sections: lib/sections.js).
export function navLinks(role, isAdmin = false) {
  const s = role === 'sales', f = role === 'finance', d = role === 'driver';
  if (role === 'executive') return [
    { to: '/', label: 'Overview', end: true, main: true },
    { to: '/collections', label: 'Collections', main: true },
    { to: '/reports', label: 'Reports', main: true },
    { to: '/customer-list', label: 'Customers' },
    { to: '/aging', label: 'Customer aging' },
    { to: '/deposits', label: 'Deposits' },
    { to: '/cash', label: 'Cash' },
    { to: '/merchant', label: 'Merchant statements' },
    { to: '/payhere', label: 'PayHere' },
    { to: '/not-in-bc', label: 'Not in BC yet' },
    { to: '/bank-rec', label: 'Bank rec' },
    { to: '/bc-check', label: 'BC check' },
    { to: '/chat', label: 'Team chat', chat: true },
    { to: '/account', label: 'Account' },
  ];
  return [
    { to: '/', label: 'Collections', end: true, main: true },
    ...(f && isAdmin ? [{ to: '/admin', label: 'Admin overview' }] : []),
    ...(s || f ? [{ to: '/new', label: 'New collection', main: true }, { to: '/transfer', label: 'Record transfer' }, { to: '/card', label: 'Record card payment' },
      { to: '/cash', label: s ? 'Cash handover' : 'Cash' }, { to: '/merchant', label: 'Merchant statements' },
      { to: '/payhere', label: s ? 'PayHere web payments' : 'PayHere' }, { to: '/not-in-bc', label: 'Not in BC yet' }] : []),
    ...(d || f ? [{ to: '/deposits', label: 'Deposits', main: true }] : []),
    { to: '/reports', label: 'Reports', main: true },
    ...(s || f ? [{ to: '/customer-list', label: 'Customers' }, { to: '/aging', label: 'Customer aging' }] : []),
    ...(f ? [{ to: '/overview', label: 'Overview' }, { to: '/bank', label: 'Bank' }, { to: '/bc-export', label: 'Export to BC' },
      { to: '/bc-check', label: 'BC check' }, { to: '/bank-rec', label: 'Bank rec' }] : []),
    ...(s || f ? [{ to: '/customers', label: 'Customer data' }] : []),
    ...(f ? [{ to: '/photos', label: 'Photo storage' }, { to: '/users', label: 'People' }] : []),
    ...(f && isAdmin ? [{ to: '/backup', label: 'Data backup' }] : []),
    { to: '/chat', label: 'Team chat', chat: true },
    { to: '/account', label: 'Account' },
  ];
}

const VIEWS = [
  { value: '', label: 'Finance Admin' }, { value: 'executive', label: 'Management' },
  { value: 'finance', label: 'Finance' }, { value: 'sales', label: 'Sales' }, { value: 'driver', label: 'Driver' },
];

function ViewAs() {
  const { actingRole, setView } = useAuth();
  return (
    <label className="viewas" title="Finance Admins can work in any role's view">
      <span>View as</span>
      <select value={actingRole ?? ''} onChange={(e) => setView(e.target.value)} aria-label="View as">
        {VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
      </select>
    </label>
  );
}

const badge = (n) => (n > 0 ? <span className="nav-badge" aria-label={`${n} waiting`}>{n > 99 ? '99+' : n}</span> : null);

// A section's tabs, and its "New" menu where it has one.
function SectionTabs({ section, path, today }) {
  const menu = useRef(null);
  if (section.tabs.length < 2 && !section.actions) return null;
  return (
    <div className="sec-bar">
      {section.tabs.length > 1 && (
        <nav className="sec-tabs" aria-label={section.label}>
          {section.tabs.map((t) => {
            const on = sectionFor(path, [{ ...section, tabs: [t] }]) !== null;
            return <Link key={t.to} to={t.to} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>{t.label}{badge(countOf(t.count, today))}</Link>;
          })}
        </nav>
      )}
      {section.actions && (
        <details className="sec-new" ref={menu}>
          <summary className="btn primary"><Icon name="plus" size={18} />New receipt</summary>
          <ul>{section.actions.map((a) => <li key={a.to}><Link to={a.to} onClick={() => { if (menu.current) menu.current.open = false; }}>{a.label}</Link></li>)}</ul>
        </details>
      )}
    </div>
  );
}

export default function Layout() {
  const { profile, role, isAdmin, actingRole } = useAuth();
  const fin = role === 'finance';
  const unread = useChatUnread();
  const loc = useLocation();
  const [today, setToday] = useState(null);
  const last = useRef(0);

  // finance: everything waiting (Today page, menu counts), refreshed every 2 minutes and when moving between pages
  const loadToday = useCallback(async () => {
    if (!fin) return;
    last.current = Date.now();
    try { setToday(await rpc('cc_finance_today')); } catch { /* keep the last counts */ }
  }, [fin]);
  useEffect(() => {
    if (!fin) { setToday(null); return undefined; }
    loadToday();
    const t = setInterval(loadToday, 120000);
    return () => clearInterval(t);
  }, [fin, loadToday]);
  useEffect(() => { if (fin && Date.now() - last.current > 20000) loadToday(); }, [loc.pathname, fin, loadToday]);

  const sections = fin ? financeSections(isAdmin) : [];
  const here = fin ? sectionFor(loc.pathname, sections) : null;
  const inSettings = fin && SETTINGS_PATHS.some((p) => loc.pathname === p || loc.pathname.startsWith(`${p}/`));
  const links = fin ? [] : navLinks(role, isAdmin);

  return (
    <div className={`shell${fin ? ' fin' : ''}${IS_DEMO ? ' is-demo' : ''}`}>
      <header className="topbar">
        <Link className="brand" to="/" aria-label="Collections, Round Island: home">
          <span className="brand-bars" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-name">Collections<small>Round Island</small></span>
        </Link>
        {fin && <GlobalSearch />}
        {fin && <UploadMenu files={today?.files} />}
        <InstallButton />
        <div className="modeswitch" role="group" aria-label="Section">
          <button className={IS_DEMO ? '' : 'on'} aria-pressed={!IS_DEMO} onClick={() => IS_DEMO && switchMode(false)}>Live</button>
          <button className={IS_DEMO ? 'on' : ''} aria-pressed={IS_DEMO} onClick={() => !IS_DEMO && switchMode(true)}>Demo</button>
        </div>
        {isAdmin && <ViewAs />}
        {fin && (
          <Link className="icon-btn" to="/chat" aria-label={unread > 0 ? `Team chat, ${unread} unread` : 'Team chat'}>
            <Icon name="chat" size={22} />{unread > 0 && <span className="icon-dot">{unread > 99 ? '99+' : unread}</span>}
          </Link>
        )}
        <div className="who">
          <span className="who-name">{profile?.full_name}</span>
          <span className="who-role">{isAdmin && !actingRole ? 'Finance Admin' : ROLE_LABEL[role]}{isAdmin && actingRole ? ' view' : ''}</span>
        </div>
        <Notifications />
        {fin && <Link className="icon-btn top-settings" to="/settings" aria-label="Settings"><Icon name="gear" size={22} /></Link>}
      </header>
      {isAdmin && actingRole && (
        <div className="view-banner" role="status">
          You're working in the <strong>{ROLE_LABEL[actingRole]}</strong> view, with that role's screens and permissions. As an admin you can act on any
          {actingRole === 'driver' ? " driver's jobs" : actingRole === 'sales' ? " sales person's items" : ' item'}.
          <button className="link" onClick={() => document.querySelector('.viewas select')?.focus()}>Change view</button>
        </div>
      )}
      {IS_DEMO && (
        <div className="demo-banner" role="status">
          <strong>Demo</strong> September 2026 data and practice scenarios. Anything you do here stays in the demo; live is never touched.
        </div>
      )}
      <nav className="sidenav" aria-label="Main">
        {fin ? (<>
          {sections.map((s, i) => {
            const on = here?.section.key === s.key;
            return (
              <Link key={s.key} to={s.to} className={`${on ? 'active ' : ''}${i < 4 ? 'nav-main' : 'nav-extra'} nav-sec`} aria-current={on ? 'page' : undefined}>
                <Icon name={s.icon} /><span className="nav-label"><span className="nav-long">{s.label}</span><span className="nav-short">{s.short}</span></span>{badge(countOf(s.count, today))}
              </Link>
            );
          })}
          <Link to="/settings" className={`${inSettings ? 'active ' : ''}nav-extra nav-sec nav-settings`}><Icon name="gear" /><span className="nav-label">Settings</span></Link>
          <NavLink to="/more" className="nav-more nav-sec"><Icon name="menu" /><span className="nav-label">More</span>{unread > 0 && <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>}</NavLink>
        </>) : (<>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={l.main ? 'nav-main' : 'nav-extra'}>
              {l.label}{l.chat && unread > 0 && <span className="nav-badge" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}
            </NavLink>
          ))}
          <NavLink to="/more" className="nav-more">More{unread > 0 && <span className="nav-badge" aria-label={`${unread} unread in Team chat`}>{unread > 99 ? '99+' : unread}</span>}</NavLink>
        </>)}
      </nav>
      <main className="content">
        {here && <SectionTabs section={here.section} path={loc.pathname} today={today} />}
        <Outlet context={{ today, reloadToday: loadToday }} />
      </main>
    </div>
  );
}
