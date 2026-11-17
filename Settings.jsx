import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useChatUnread } from '../lib/chat';

// Finance: everything that isn't daily work, in one place.
export default function Settings() {
  const { isAdmin } = useAuth();
  const unread = useChatUnread();
  const items = [
    { to: '/users', label: 'People', sub: 'Who uses the app, their roles and Finance Admins' },
    { to: '/photos', label: 'Photo storage', sub: 'Back up and free the space of old receipt photos' },
    ...(isAdmin ? [{ to: '/backup', label: 'Data backup', sub: 'Download a copy of all the data' }] : []),
    { to: '/chat', label: 'Team chat', sub: unread > 0 ? `${unread} unread` : 'Messages with the team' },
    { to: '/account', label: 'Account', sub: 'Your name, password and sign out' },
  ];
  return (
    <section className="narrow">
      <div className="page-head"><h1>Settings</h1></div>
      <ul className="settings-list">
        {items.map((i) => <li key={i.to}><Link to={i.to}><strong>{i.label}</strong><span>{i.sub}</span></Link></li>)}
      </ul>
      {isAdmin && <p className="hint">Live / Demo and View as stay at the top of every page.</p>}
    </section>
  );
}
