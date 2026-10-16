import { Link, useLocation } from 'react-router-dom';
import BrandMark from './BrandMark.jsx';
import { LogoutIcon, ChevronLeftIcon } from './icons.jsx';

const ROLE_LABELS = { donor: 'Donor', requester: 'Requester', admin: 'Admin' };

export default function Sidebar({ user, navItems, onLogout, open, onNavigate, brandTo = '/', collapsed = false, onToggleCollapse }) {
  const initials = user?.name ? user.name.trim().charAt(0).toUpperCase() : '?';
  const location = useLocation();
  const currentPathWithSearch = location.pathname + location.search;

  return (
    <aside className={`sidebar${open ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`}>
      <button
        type="button"
        className="sidebar-collapse-btn"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronLeftIcon size={16} />
      </button>

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
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={18} />
              <span className="sidebar-link-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span className="sidebar-user-avatar">{initials}</span>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.name}</div>
            <div className="sidebar-user-role">{ROLE_LABELS[user?.role] || user?.role}</div>
          </div>
        </div>
        <button onClick={onLogout} className="sidebar-link" title={collapsed ? 'Log out' : undefined}>
          <LogoutIcon size={18} />
          <span className="sidebar-link-label">Log out</span>
        </button>
      </div>
    </aside>
  );
}
