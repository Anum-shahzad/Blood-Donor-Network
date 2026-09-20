import { NavLink, Link } from 'react-router-dom';
import BrandMark from './BrandMark.jsx';
import { LogoutIcon } from './icons.jsx';

const ROLE_LABELS = { donor: 'Donor', requester: 'Requester', admin: 'Admin' };

export default function Sidebar({ user, navItems, onLogout, open, onNavigate }) {
  const initials = user?.name ? user.name.trim().charAt(0).toUpperCase() : '?';

  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`}>
      <Link to="/" className="sidebar-brand" onClick={onNavigate}>
        <BrandMark onDark size={32} />
        <span className="sidebar-brand-text">Blood Donor Network</span>
      </Link>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span className="sidebar-user-avatar">{initials}</span>
          <div>
            <div className="sidebar-user-name">{user?.name}</div>
            <div className="sidebar-user-role">{ROLE_LABELS[user?.role] || user?.role}</div>
          </div>
        </div>
        <button onClick={onLogout} className="sidebar-link">
          <LogoutIcon size={18} />
          Log out
        </button>
      </div>
    </aside>
  );
}
