import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import Notifications from './Notifications';

const ROLE_LABEL = { sales: 'Sales', driver: 'Driver', finance: 'Finance' };

export function navLinks(role) {
  const s = role === 'sales', f = role === 'finance', d = role === 'driver';
  return [
    { to: '/', label: 'Collections', end: true, main: true },
    ...(s || f ? [{ to: '/new', label: 'New collection', main: true }, { to: '/transfer', label: 'Record transfer' }] : []),
    ...(d || f ? [{ to: '/deposits', label: 'Deposits', main: true }] : []),
    { to: '/reports', label: 'Reports', main: true },
    ...(f ? [{ to: '/bank', label: 'Bank' }] : []),
    ...(s || f ? [{ to: '/customers', label: 'Customer data' }] : []),
    ...(f ? [{ to: '/photos', label: 'Photo storage' }, { to: '/users', label: 'People' }] : []),
    { to: '/account', label: 'Account' },
  ];
}

export default function Layout() {
  const { profile, role } = useAuth();
  const links = navLinks(role);
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width="28" height="28" />
          <span>Cheque Collection</span>
        </div>
        <div className="who">
          <span className="who-name">{profile?.full_name}</span>
          <span className="who-role">{ROLE_LABEL[role]}</span>
        </div>
        <Notifications />
      </header>
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
