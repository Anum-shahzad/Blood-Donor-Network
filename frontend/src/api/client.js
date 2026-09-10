const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}
