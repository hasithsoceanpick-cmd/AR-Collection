import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { navLinks } from '../components/Layout';

// Phone menu: everything that doesn't fit in the bottom bar.
export default function More() {
  const { role } = useAuth();
  return (
    <section className="narrow">
      <div className="page-head"><h1>Menu</h1></div>
      <ul className="menu-list">
        {navLinks(role).filter((l) => !l.main).map((l) => <li key={l.to}><Link to={l.to}>{l.label}</Link></li>)}
      </ul>
    </section>
  );
}
