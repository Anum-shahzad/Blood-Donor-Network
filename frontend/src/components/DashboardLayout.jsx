import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import BrandMark from './BrandMark.jsx';
import { GridIcon, HomeIcon, MenuIcon } from './icons.jsx';

// Only routes that actually exist in App.jsx are listed here — one
// dashboard route per role, plus the public home page. Nothing invented.
function navItemsFor(role) {
  const dashboardPath =
    role === 'donor' ? '/donor/dashboard' : role === 'requester' ? '/requester/dashboard' : '/admin/dashboard';

  return [
    { to: dashboardPath, label: 'Dashboard', icon: GridIcon, end: true },
    { to: '/', label: 'Home', icon: HomeIcon },
  ];
}

export default function DashboardLayout({ user, onLogout, children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navItems = navItemsFor(user?.role);

  return (
    <div className="app-shell">
      <div className="dashboard-topbar">
        <button
          className="sidebar-toggle"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
        >
          <MenuIcon />
        </button>
        <span className="topbar-brand" style={{ fontSize: '0.95rem' }}>
          <BrandMark size={26} />
          Blood Donor Network
        </span>
        <span style={{ width: 38 }} aria-hidden="true" />
      </div>

      {drawerOpen && <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} />}

      <Sidebar
        user={user}
        navItems={navItems}
        onLogout={onLogout}
        open={drawerOpen}
        onNavigate={() => setDrawerOpen(false)}
      />

      <main className="dashboard-main">{children}</main>
    </div>
  );
}
