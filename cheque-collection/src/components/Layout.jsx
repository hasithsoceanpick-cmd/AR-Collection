import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import Notifications from './Notifications';

const ROLE_LABEL = { sales: 'Sales', driver: 'Driver', finance: 'Finance' };

export default function Layout() {
  const { profile, role } = useAuth();
  const links = [
    { to: '/', label: 'Collections', end: true },
    ...(role === 'sales' || role === 'finance'
      ? [{ to: '/new', label: 'New collection' }, { to: '/customers', label: 'Customer data' }] : []),
    ...(role === 'finance' ? [{ to: '/photos', label: 'Photo storage' }, { to: '/users', label: 'People' }] : []),
    { to: '/account', label: 'Account' },
  ];
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
          <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>
        ))}
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
