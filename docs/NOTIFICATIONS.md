# Urgent alert notifications (free, browser-native)

Flow: **Dispatch Urgent Alert → backend → eligibility check → saved notification → in-app popup + sound → browser notification → Web Push**

No SMS, WhatsApp, e-mail or paid service is used. The existing WhatsApp/SMS checkboxes in Settings are untouched and still do nothing.

## One-time setup

1. **Install the new dependency** (backend):
   ```bash
   cd backend
   npm install
   ```
2. **Run the migration** (creates `notifications`, `push_subscriptions`, `push_deliveries`, and the `notify_browser` / `notify_push` columns; safe to re-run):
   ```bash
   mysql -u <user> -p <database> < src/db/migrations/012_notifications_and_web_push.sql
   ```
3. **Generate VAPID keys** (once; keep the private key secret):
   ```bash
   cd backend
   npm run vapid:generate
   ```
4. **Add them to the backend environment** (`backend/.env` locally, and your host's environment variables, e.g. Vercel → backend project → Settings → Environment Variables):
   ```
   VAPID_PUBLIC_KEY=<Public Key printed above>
   VAPID_PRIVATE_KEY=<Private Key printed above>
   VAPID_SUBJECT=mailto:you@example.com
   ```
   The frontend needs **no** key setting: it fetches the public key from `GET /api/notifications/push/config`. Changing the keys later invalidates every saved subscription (donors must re-enable push).
5. Redeploy the backend and the frontend. The frontend now ships `public/sw.js` (the service worker).

If the VAPID variables are missing, in-app popups, sound and browser notifications still work; the Push control shows "not set up on the server yet" and the API never claims a push was sent.

## How each channel behaves

| Channel | Needs | Works when |
|---|---|---|
| In-app popup + sound | Donor dashboard open; "In-App" ticked | Tab open. Sound needs a click on **Enable Alert Sound** (browser rule); it must be re-enabled after reopening the site |
| Browser notification | Donor clicks **Enable browser notifications** and grants permission | Tab open but in the background. The permission prompt appears only from that button, and never again once denied |
| Web Push | Donor clicks **Enable push on this device** | Site closed, if the browser/OS allows it |

Alerts are polled every 15 s while the tab is visible. A notification is announced (sound / system notification) once per browser; the same tag is used by in-page and push notifications so one device does not show it twice.

## Who gets notified (all decided on the server)

The alert button still targets one donor. After the existing `evaluateAlert` rules pass, `createUrgentAlertNotification` additionally requires: request verified, open, unexpired and with units still open; donor active, available, not committed, not in cooldown; blood-group compatible; **inside the donor's alert radius**; and at least one channel enabled. The same check runs again before each push is sent and on every poll. A donor outside their radius still sees the request in their feed (unchanged behaviour) but gets no notification, and the requester is told generically that no notification was sent, without revealing why.

Preferences: In-App → popup + sound; "Mute browser notifications" → `notify_browser`; push → `notify_push` plus an actual subscription.

## Tracking (what is and is not claimed)

- `notifications`: created once per request+donor (`dedupe_key`), `read_at` (dismissed), `acknowledged_at` (donor pressed Accept / View Request).
- `push_deliveries`: one row per device send. `accepted` means the push service (FCM / Mozilla / Apple) accepted the message, **not** that the donor saw it. Nothing in the app reports push as "seen".
- Failures: one automatic retry for network errors, 429 and 5xx; 404/410 removes the subscription; 5 consecutive failures remove it; a device that already has an `accepted` delivery is never sent the same notification again.
- Up to 5 devices per donor. Logging out removes the current device's subscription; the Settings button removes it too.

## Security

- VAPID private key only in backend env; never sent to the browser.
- Subscription endpoints must be `https` URLs on known push-service hosts (FCM, Mozilla, Apple, Windows). Anything else is rejected so the server cannot be pointed at internal addresses. Extra hosts: `PUSH_ENDPOINT_ALLOWED_HOSTS`.
- All notification routes require a logged-in donor and only touch that donor's rows.
- Push payloads contain only blood group, urgency, hospital, city, open units and a link; never phone numbers or patient details.

## Development limits and HTTPS

- Service workers, push and notifications need **HTTPS**, except on `localhost` (and `127.0.0.1`), which browsers treat as secure. Testing from a phone against `http://192.168.x.x` will not work; use your deployed HTTPS site or a tunnel.
- Production must be served over HTTPS (Vercel does this).
- If a browser's own push service is blocked on your network (some corporate networks, some regions), push will not arrive even though the app is configured correctly.

## iPhone / iPad

Web Push on iOS/iPadOS works only on **iOS 16.4 or newer** and only for a website **added to the Home Screen**: open the site in Safari → Share → **Add to Home Screen** → open it from the new icon → Settings → **Enable push on this device**. In normal Safari tabs, push is unavailable (the Settings card explains this). In-app popups work everywhere.

## Known limitations

- Opening a notification while logged out sends the donor to the login page, then to their dashboard (the unread alert popup is still there); the deep link is not restored after login.
- If a donor is logged out with no connection, the device's subscription is removed only the next time it contacts the server or when the push service reports it expired.
- The notification icon uses `/images/favicon.svg`; some platforms ignore SVG icons and show a default one. Add a PNG icon and point `public/sw.js` and `src/lib/notifications.js` at it if you want a custom one.
- Failed pushes are retried once inline, not by a background queue.
