// Thin wrapper around localStorage so components don't touch it directly.
// One place to change if the storage strategy ever changes.
export function saveSession(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

// True when the JWT's own `exp` claim is in the past (or the token is junk).
function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

// Returns the logged-in user, or null. Never throws: corrupted storage or an
// expired token simply counts as "logged out" and is cleaned up.
export function getUser() {
  try {
    const token = localStorage.getItem('token');
    const raw = localStorage.getItem('user');
    if (!token || !raw) return null;
    if (isTokenExpired(token)) {
      clearSession();
      return null;
    }
    const user = JSON.parse(raw);
    return user && user.id && user.role ? user : null;
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

// Where to send someone right after they log in or sign up.
export function dashboardPathFor(role) {
  if (role === 'donor') return '/donor/dashboard';
  if (role === 'requester') return '/requester/dashboard';
  if (role === 'admin') return '/admin/dashboard';
  return '/';
}

// Where an "I can donate" button should go for the current visitor.
// Guests sign up as donors, donors go to their dashboard (that is where real
// requests are accepted), and requesters/admins get no donate button (null).
export function donateLinkFor(user) {
  if (!user) return '/signup?role=donor';
  if (user.role === 'donor') return '/donor/dashboard';
  return null;
}
