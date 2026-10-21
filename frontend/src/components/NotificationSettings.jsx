import { useCallback, useEffect, useState } from 'react';
import { apiPatch } from '../api/client.js';
import {
  soundState as readSoundState, enableSound, disableSound, playAlertSound,
  browserNotificationState, requestBrowserPermission,
  pushSupport, getPushConfig, getCurrentSubscription, enablePush, disablePush,
} from '../lib/notifications.js';

const STATUS_BADGE = { on: 'badge-teal', off: 'badge-neutral', blocked: 'badge-amber', denied: 'badge-red', unsupported: 'badge-neutral' };

function StatusBadge({ kind, children }) {
  return <span className={`badge ${STATUS_BADGE[kind] || 'badge-neutral'}`} style={{ fontSize: '0.72rem' }}>{children}</span>;
}

const rowStyle = { background: 'var(--paper)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' };
const headStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' };
const noteStyle = { fontSize: '0.78rem', color: 'var(--ink-muted)', margin: '0.4rem 0 0' };

// Settings card: alert sound, browser notifications and Web Push, each with a
// plain status. Channel switches are saved on the server straight away.
export default function NotificationSettings({ profile, onSaved, onSoundChange, setError, setSuccess }) {
  const [sound, setSound] = useState(readSoundState());
  const [permission, setPermission] = useState(browserNotificationState());
  const [prefs, setPrefs] = useState({ browser: true, push: true });
  const [push, setPush] = useState({ loading: true, configured: false, thisDevice: false, devices: 0 });
  const [busy, setBusy] = useState('');
  const support = pushSupport();

  useEffect(() => {
    if (profile) setPrefs({ browser: Boolean(profile.notify_browser), push: Boolean(profile.notify_push) });
  }, [profile]);

  const loadPush = useCallback(async () => {
    try {
      const [cfg, sub] = await Promise.all([getPushConfig(), getCurrentSubscription()]);
      setPush({ loading: false, configured: cfg.configured, thisDevice: Boolean(sub), devices: cfg.devices });
    } catch {
      setPush((p) => ({ ...p, loading: false }));
    }
  }, []);
  useEffect(() => { loadPush(); }, [loadPush]);

  async function savePref(patch) {
    await apiPatch('/api/donors/me/settings', patch);
    if (onSaved) onSaved();
  }

  async function run(name, fn) {
    setBusy(name); setError(''); setSuccess('');
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  const onEnableSound = () => run('sound', async () => {
    const s = await enableSound();
    setSound(s); if (onSoundChange) onSoundChange(s);
    if (s === 'on') { playAlertSound(); setSuccess('Alert sound enabled. You just heard a test tone.'); }
    else setError('Your browser did not allow audio. Click the page and try again.');
  });
  const onDisableSound = () => { disableSound(); setSound('off'); if (onSoundChange) onSoundChange('off'); };

  const onEnableBrowser = () => run('browser', async () => {
    const p = await requestBrowserPermission();
    setPermission(p);
    if (p === 'granted') {
      await savePref({ notify_browser: true });
      setPrefs((x) => ({ ...x, browser: true }));
      setSuccess('Browser notifications enabled.');
    } else if (p === 'denied') {
      setError('Notifications are blocked for this site. Change it in your browser’s site settings.');
    }
  });
  const onToggleBrowser = () => run('browser', async () => {
    const next = !prefs.browser;
    await savePref({ notify_browser: next });
    setPrefs((x) => ({ ...x, browser: next }));
  });

  const onEnablePush = () => run('push', async () => {
    await enablePush();
    await savePref({ notify_push: true });
    setPermission(browserNotificationState());
    await loadPush();
    setSuccess('Push notifications enabled on this device.');
  });
  const onDisablePush = () => run('push', async () => {
    await disablePush();
    await loadPush();
    setSuccess('Push notifications turned off on this device.');
  });

  const browserKind = permission === 'unsupported' ? 'unsupported' : permission === 'denied' ? 'denied'
    : permission === 'granted' && prefs.browser ? 'on' : 'off';
  const browserLabel = { unsupported: 'Not supported', denied: 'Blocked', on: 'Enabled', off: permission === 'granted' ? 'Muted' : 'Not enabled' }[browserKind];

  const pushKind = !support.supported ? 'unsupported' : permission === 'denied' ? 'denied' : push.thisDevice ? 'on' : 'off';
  const pushLabel = { unsupported: 'Not supported', denied: 'Blocked', on: 'Enabled on this device', off: 'Not enabled' }[pushKind];

  return (
    <div className="form-card">
      <h3 style={{ marginTop: 0, marginBottom: '0.25rem', fontSize: '1.1rem' }}>Alert Notifications</h3>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: '1rem' }}>
        Urgent alerts always appear on this dashboard. These options add sound, system notifications and
        notifications that arrive even when the site is closed.
      </p>

      <div className="alert-settings-grid">
        {/* Sound */}
        <div style={rowStyle}>
          <div style={headStyle}>
            <strong style={{ fontSize: '0.9rem' }}>Alert sound</strong>
            <StatusBadge kind={sound === 'on' ? 'on' : sound === 'blocked' ? 'blocked' : sound === 'unsupported' ? 'unsupported' : 'off'}>
              {{ on: 'On', blocked: 'Needs a click', off: 'Off', unsupported: 'Not supported' }[sound]}
            </StatusBadge>
          </div>
          {sound !== 'unsupported' && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
              {sound !== 'on' && (
                <button type="button" className="btn btn-primary" onClick={onEnableSound} disabled={busy === 'sound'}>Enable Alert Sound</button>
              )}
              {sound === 'on' && (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => playAlertSound()}>Play test sound</button>
                  <button type="button" className="btn btn-secondary" onClick={onDisableSound}>Turn off</button>
                </>
              )}
            </div>
          )}
          <p style={noteStyle}>Browsers block audio until you click somewhere on the page, so you may need to enable it again after reopening the site.</p>
        </div>

        {/* Browser notifications */}
        <div style={rowStyle}>
          <div style={headStyle}>
            <strong style={{ fontSize: '0.9rem' }}>Browser notifications</strong>
            <StatusBadge kind={browserKind}>{browserLabel}</StatusBadge>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
            {permission === 'default' && (
              <button type="button" className="btn btn-primary" onClick={onEnableBrowser} disabled={busy === 'browser'}>Enable browser notifications</button>
            )}
            {permission === 'granted' && (
              <button type="button" className="btn btn-secondary" onClick={onToggleBrowser} disabled={busy === 'browser'}>
                {prefs.browser ? 'Mute browser notifications' : 'Unmute browser notifications'}
              </button>
            )}
          </div>
          <p style={noteStyle}>
            {permission === 'unsupported' && 'This browser does not support notifications. Alerts still appear on this page.'}
            {permission === 'denied' && 'You blocked notifications for this site. To use them, allow notifications in your browser’s site settings.'}
            {permission === 'default' && 'Shows a notification when an urgent alert arrives while this tab is in the background. Your browser will ask for permission.'}
            {permission === 'granted' && 'Shows a notification when an urgent alert arrives while this tab is in the background.'}
          </p>
        </div>

        {/* Web push */}
        <div style={rowStyle}>
          <div style={headStyle}>
            <strong style={{ fontSize: '0.9rem' }}>Push notifications (works when the site is closed)</strong>
            <StatusBadge kind={pushKind}>{pushLabel}</StatusBadge>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
            {support.supported && push.configured && permission !== 'denied' && !push.thisDevice && (
              <button type="button" className="btn btn-primary" onClick={onEnablePush} disabled={busy === 'push'}>
                {busy === 'push' ? 'Enabling...' : 'Enable push on this device'}
              </button>
            )}
            {push.thisDevice && (
              <button type="button" className="btn btn-secondary" onClick={onDisablePush} disabled={busy === 'push'}>Turn off on this device</button>
            )}
          </div>
          <p style={noteStyle}>
            {!support.supported && support.reason === 'ios-needs-home-screen' &&
              'On iPhone and iPad, push works only after you add this website to your Home Screen (Share → Add to Home Screen) and open it from there. iOS 16.4 or newer is required.'}
            {!support.supported && support.reason !== 'ios-needs-home-screen' && 'This browser does not support push notifications.'}
            {support.supported && !push.loading && !push.configured && 'Push notifications are not set up on the server yet.'}
            {support.supported && push.configured && permission === 'denied' && 'Notifications are blocked for this site. Allow them in your browser’s site settings to use push.'}
            {support.supported && push.configured && permission !== 'denied' && (
              <>Devices registered on your account: {push.devices}. Push alerts are sent only for requests inside your alert radius. Signing out removes this device.</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
