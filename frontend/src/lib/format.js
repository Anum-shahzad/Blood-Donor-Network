// Date helpers shared across pages. All accept ISO strings, 'YYYY-MM-DD'
// strings, Dates or millisecond timestamps, and return '' for bad input.
function toDate(value) {
  if (value == null || value === '') return null;
  const d =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00`) // plain dates are calendar days, not instants
      : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value) {
  const d = toDate(value);
  return d ? d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}

export function formatDateTime(value) {
  const d = toDate(value);
  return d
    ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
}

export function timeAgo(value, now = Date.now()) {
  const d = toDate(value);
  if (!d) return '';
  const mins = Math.max(0, Math.floor((now - d.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// <input type="datetime-local"> gives a zone-less local time. Convert it to a
// real instant (ISO, UTC) before sending, so the server stores the moment the
// person meant regardless of the server's time zone.
export function localInputToIso(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// Value for a datetime-local `min` attribute: "now" in local time.
export function nowForLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function todayForDateInput() {
  return nowForLocalInput().slice(0, 10);
}

export function humanizeStatus(status) {
  return String(status || '').replace(/_/g, ' ');
}

// Unambiguous display of a datetime-local value ("2026-10-16T21:30" ->
// "16 Oct 2026, 09:30 PM"). Display only: the value sent to the server is
// still produced by localInputToIso. Parsed by hand to avoid time zone shifts.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatLocalInputClear(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value || '');
  if (!m) return '';
  const [, y, mo, d, hh, mm] = m;
  const date = `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
  if (hh === undefined) return date;
  const h = Number(hh);
  return `${date}, ${String(h % 12 || 12).padStart(2, '0')}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}
