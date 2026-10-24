import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import BrandMark from './BrandMark.jsx';
import AccountNotices from './AccountNotices.jsx';
import {
  GridIcon,
  HomeIcon,
  MenuIcon,
  DropletIcon,
  ClockIcon,
  HeartIcon,
  IdCardIcon,
  SlidersIcon,
  FileTextIcon,
  RadarIcon,
  ArchiveIcon,
  GaugeIcon,
  ShieldCheckIcon,
  UsersIcon,
  AlertCircleIcon,
} from './icons.jsx';

function navItemsFor(role) {
  if (role === 'donor') {
    return [
      { to: '/donor/dashboard?tab=tab-home', label: 'Home', icon: HomeIcon, isDefault: true },
      { to: '/donor/dashboard?tab=tab-feed', label: 'Emergency Matches', icon: DropletIcon },
      { to: '/donor/dashboard?tab=tab-cooldown', label: 'Cooldown & History', icon: ClockIcon },
      { to: '/donor/dashboard?tab=tab-commitments', label: 'My Commitments', icon: HeartIcon },
      { to: '/donor/dashboard?tab=tab-card', label: 'Identity Card', icon: IdCardIcon },
      { to: '/donor/dashboard?tab=tab-verification', label: 'Verification', icon: ShieldCheckIcon },
      { to: '/donor/dashboard?tab=tab-settings', label: 'Settings', icon: SlidersIcon },
    ];
  }

  if (role === 'requester') {
    return [
      { to: '/requester/dashboard?tab=tab-home', label: 'Home', icon: HomeIcon, isDefault: true },
      { to: '/requester/dashboard?tab=tab-active', label: 'Active Requests', icon: ClockIcon },
      { to: '/requester/dashboard?tab=tab-post', label: 'Post Emergency', icon: FileTextIcon },
      { to: '/requester/dashboard?tab=tab-radar', label: 'Matched Radar', icon: RadarIcon },
      { to: '/requester/dashboard?tab=tab-archive', label: 'Requests Archive', icon: ArchiveIcon },
    ];
  }

  if (role === 'admin') {
    return [
      { to: '/admin/dashboard?tab=tab-home', label: 'Home', icon: HomeIcon, isDefault: true },
      { to: '/admin/dashboard?tab=tab-analytics', label: 'Network Analytics', icon: GaugeIcon },
      { to: '/admin/dashboard?tab=tab-verifications', label: 'Verification Queue', icon: ShieldCheckIcon },
      { to: '/admin/dashboard?tab=tab-id-review', label: 'ID & Evidence Review', icon: IdCardIcon },
      { to: '/admin/dashboard?tab=tab-donors', label: 'Donor Registry', icon: UsersIcon },
      { to: '/admin/dashboard?tab=tab-fraud', label: 'Abuse & Fraud', icon: AlertCircleIcon },
    ];
  }

  return [{ to: '/', label: 'Home', icon: HomeIcon }];
}

export default function DashboardLayout({ user, onLogout, children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('sidebar-collapsed', next ? '1' : '0');
      } catch {
        /* storage unavailable; the preference just won't persist */
      }
      return next;
    });
  }
  const navItems = navItemsFor(user?.role);
  const HOME_BY_ROLE = {
    donor: '/donor/dashboard?tab=tab-home',
    requester: '/requester/dashboard?tab=tab-home',
    admin: '/admin/dashboard?tab=tab-home',
  };
  const brandTo = HOME_BY_ROLE[user?.role] || '/';

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
        brandTo={brandTo}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />

      <main className="dashboard-main">
        {user?.role !== 'admin' && <AccountNotices />}
        {children}
      </main>
    </div>
  );
}
