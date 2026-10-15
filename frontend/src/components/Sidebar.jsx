import { Link, useLocation } from 'react-router-dom';
import BrandMark from './BrandMark.jsx';
import { LogoutIcon } from './icons.jsx';

const ROLE_LABELS = { donor: 'Donor', requester: 'Requester', admin: 'Admin' };

export default function Sidebar({ user, navItems, onLogout, open, onNavigate, brandTo = '/' }) {
  const initials = user?.name ? user.name.trim().charAt(0).toUpperCase() : '?';
  const location = useLocation();
  const currentPathWithSearch = location.pathname + location.search;

  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`}>
      <Link to={brandTo} className="sidebar-brand" onClick={onNavigate}>
        <BrandMark onDark size={32} />
        <span className="sidebar-brand-text">Blood Donor Network</span>
      </Link>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const isActive = item.to.includes('?')
            ? currentPathWithSearch === item.to || (location.pathname === item.to.split('?')[0] && !location.search && item.isDefault)
            : location.pathname === item.to;

          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={`sidebar-link${isActive ? ' is-active' : ''}`}
            >
              <item.icon size={18} />
              {item.label}
            </Link>
          );
        })}
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
