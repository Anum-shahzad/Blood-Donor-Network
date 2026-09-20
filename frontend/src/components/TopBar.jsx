import { Link } from 'react-router-dom';
import BrandMark from './BrandMark.jsx';

const ROLE_LABELS = { donor: 'Donor', requester: 'Requester', admin: 'Admin' };

export default function TopBar({ user, onLogout, navLinks }) {
  return (
    <header className="topbar">
      <Link to="/" className="topbar-brand">
        <BrandMark size={30} />
        Blood Donor Network
      </Link>

      {navLinks && navLinks.length > 0 && (
        <nav className="topbar-nav">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      )}

      {user ? (
        <div className="topbar-right">
          <span>{user.name}</span>
          <span className="role-pill">{ROLE_LABELS[user.role] || user.role}</span>
          <button onClick={onLogout} className="btn-text">
            Log out
          </button>
        </div>
      ) : (
        <div className="topbar-actions">
          <Link to="/login" className="btn btn-secondary">
            Log in
          </Link>
          <Link to="/signup" className="btn btn-primary">
            Sign up
          </Link>
        </div>
      )}
    </header>
  );
}
