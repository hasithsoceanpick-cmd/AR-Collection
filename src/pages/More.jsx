import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { navLinks } from '../components/Layout';
import { useChatUnread } from '../lib/chat';
import { financeSections } from '../lib/sections';

// Phone menu: everything that doesn't fit in the bottom bar.
export default function More() {
  const { role, isAdmin } = useAuth();
  const unread = useChatUnread();
  if (role === 'finance') {
    return (
      <section className="narrow">
        <div className="page-head"><h1>Menu</h1></div>
        {financeSections(isAdmin).filter((s) => s.key !== 'today').map((s) => (
          <div key={s.key} className="more-sec">
            <h2>{s.label}</h2>
            <ul className="menu-list">
              {s.tabs.map((t) => <li key={t.to}><Link to={t.to}>{t.label.replace(/^\d /, '')}</Link></li>)}
              {(s.actions ?? []).map((a) => <li key={a.to}><Link to={a.to}>{a.label}</Link></li>)}
            </ul>
          </div>
        ))}
        <div className="more-sec">
          <h2>Settings</h2>
          <ul className="menu-list">
            <li><Link to="/chat">Team chat{unread > 0 && <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>}</Link></li>
            <li><Link to="/users">People</Link></li>
            <li><Link to="/photos">Photo storage</Link></li>
            {isAdmin && <li><Link to="/backup">Data backup</Link></li>}
            <li><Link to="/account">Account</Link></li>
          </ul>
        </div>
      </section>
    );
  }
  return (
    <section className="narrow">
      <div className="page-head"><h1>Menu</h1></div>
      <ul className="menu-list">
        {navLinks(role, isAdmin).filter((l) => !l.main).map((l) => <li key={l.to}><Link to={l.to}>{l.label}{l.chat && unread > 0 && <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>}</Link></li>)}
      </ul>
    </section>
  );
}
