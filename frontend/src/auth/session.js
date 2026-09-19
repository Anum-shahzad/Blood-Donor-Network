// Thin wrapper around localStorage so components don't touch it directly.
// Not meant to be clever — just one place to change if storage strategy
// ever changes.
export function saveSession(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

export function getUser() {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

// Where to send someone right after they log in or sign up.
export function dashboardPathFor(role) {
  if (role === 'donor') return '/donor/dashboard';
  if (role === 'requester') return '/requester/dashboard';
  return '/';
}
