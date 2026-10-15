import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import BrandMark from './BrandMark.jsx';
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
      { to: '/donor/dashboard?tab=tab-settings', label: 'Settings', icon: SlidersIcon },
    ];
  }

  if (role === 'requester') {
    return [
      { to: '/requester/dashboard?tab=tab-active', label: 'Active Requests', icon: ClockIcon, isDefault: true },
      { to: '/requester/dashboard?tab=tab-post', label: 'Post Emergency', icon: FileTextIcon },
      { to: '/requester/dashboard?tab=tab-radar', label: 'Matched Radar', icon: RadarIcon },
      { to: '/requester/dashboard?tab=tab-archive', label: 'Requests Archive', icon: ArchiveIcon },
      { to: '/', label: 'Home', icon: HomeIcon },
    ];
  }

  if (role === 'admin') {
    return [
      { to: '/admin/dashboard?tab=tab-analytics', label: 'Network Analytics', icon: GaugeIcon, isDefault: true },
      { to: '/admin/dashboard?tab=tab-verifications', label: 'Verification Queue', icon: ShieldCheckIcon },
      { to: '/admin/dashboard?tab=tab-donors', label: 'Donor Registry', icon: UsersIcon },
      { to: '/admin/dashboard?tab=tab-fraud', label: 'Abuse & Fraud', icon: AlertCircleIcon },
      { to: '/admin/dashboard?tab=tab-settings', label: 'Policies & Settings', icon: SlidersIcon },
      { to: '/', label: 'Home', icon: HomeIcon },
    ];
  }

  return [{ to: '/', label: 'Home', icon: HomeIcon }];
}

export default function DashboardLayout({ user, onLogout, children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navItems = navItemsFor(user?.role);
  const brandTo = user?.role === 'donor' ? '/donor/dashboard?tab=tab-home' : '/';

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
      />

      <main className="dashboard-main">{children}</main>
    </div>
  );
}
