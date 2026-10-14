import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { IS_DEMO, switchMode } from '../lib/supabase';
import Notifications from './Notifications';
import InstallButton from './InstallButton';

const ROLE_LABEL = { sales: 'Sales', driver: 'Driver', finance: 'Finance', executive: 'Management' };

export function navLinks(role) {
  const s = role === 'sales', f = role === 'finance', d = role === 'driver';
  if (role === 'executive') return [
    { to: '/', label: 'Overview', end: true, main: true },
    { to: '/collections', label: 'Collections', main: true },
    { to: '/reports', label: 'Reports', main: true },
    { to: '/deposits', label: 'Deposits' },
    { to: '/cash', label: 'Cash' },
    { to: '/merchant', label: 'Merchant statements' },
    { to: '/not-in-bc', label: 'Not in BC yet' },
    { to: '/bank-rec', label: 'Bank rec' },
    { to: '/bc-check', label: 'BC check' },
    { to: '/account', label: 'Account' },
  ];
  return [
    { to: '/', label: 'Collections', end: true, main: true },
    ...(s || f ? [{ to: '/new', label: 'New collection', main: true }, { to: '/transfer', label: 'Record transfer' }, { to: '/card', label: 'Record card payment' },
      { to: '/cash', label: s ? 'Cash handover' : 'Cash' }, { to: '/merchant', label: 'Merchant statements' }, { to: '/not-in-bc', label: 'Not in BC yet' }] : []),
    ...(d || f ? [{ to: '/deposits', label: 'Deposits', main: true }] : []),
    { to: '/reports', label: 'Reports', main: true },
    ...(f ? [{ to: '/overview', label: 'Overview' }, { to: '/bank', label: 'Bank' }, { to: '/bc-export', label: 'Export to BC' },
      { to: '/bc-check', label: 'BC check' }, { to: '/bank-rec', label: 'Bank rec' }] : []),
    ...(s || f ? [{ to: '/customers', label: 'Customer data' }] : []),
    ...(f ? [{ to: '/photos', label: 'Photo storage' }, { to: '/users', label: 'People' }] : []),
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

export default function Layout() {
  const { profile, role, isAdmin, actingRole } = useAuth();
  const links = navLinks(role);
  return (
    <div className={IS_DEMO ? 'shell is-demo' : 'shell'}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-bars" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-name">Collections<small>Round Island</small></span>
        </div>
        <InstallButton />
        <div className="modeswitch" role="group" aria-label="Section">
          <button className={IS_DEMO ? '' : 'on'} aria-pressed={!IS_DEMO} onClick={() => IS_DEMO && switchMode(false)}>Live</button>
          <button className={IS_DEMO ? 'on' : ''} aria-pressed={IS_DEMO} onClick={() => !IS_DEMO && switchMode(true)}>Demo</button>
        </div>
        {isAdmin && <ViewAs />}
        <div className="who">
          <span className="who-name">{profile?.full_name}</span>
          <span className="who-role">{isAdmin && !actingRole ? 'Finance Admin' : ROLE_LABEL[role]}{isAdmin && actingRole ? ' view' : ''}</span>
        </div>
        <Notifications />
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
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={l.main ? 'nav-main' : 'nav-extra'}>{l.label}</NavLink>
        ))}
        <NavLink to="/more" className="nav-more">More</NavLink>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
