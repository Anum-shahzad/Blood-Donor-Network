import { Link } from 'react-router-dom';

const ROLE_LABELS = { donor: 'Donor', requester: 'Requester', admin: 'Admin' };

export default function TopBar({ user, onLogout }) {
  return (
    <header className="topbar">
      <Link to="/" className="topbar-brand">
        Blood Donor Network
      </Link>
      {user && (
        <div className="topbar-right">
          <span>{user.name}</span>
          <span className="role-pill">{ROLE_LABELS[user.role] || user.role}</span>
          <button onClick={onLogout} className="btn-text">
            Log out
          </button>
        </div>
      )}
    </header>
  );
}
