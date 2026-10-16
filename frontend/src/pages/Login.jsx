import { useState } from 'react';
import { useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
import { apiPost } from '../api/client.js';
import { saveSession, getUser, dashboardPathFor } from '../auth/session.js';
import TopBar from '../components/TopBar.jsx';
import BrandMark from '../components/BrandMark.jsx';

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionExpired = params.get('expired') === '1';
  const accountSuspended = params.get('suspended') === '1';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const existing = getUser();
  if (existing) return <Navigate to={dashboardPathFor(existing.role)} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await apiPost('/api/auth/login', { email: email.trim(), password });
      saveSession(data.token, data.user);
      navigate(dashboardPathFor(data.user.role));
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <TopBar />
      <div className="auth-screen" style={{ backgroundImage: "url('/images/hero-donation.jpg')" }}>
        <div className="auth-card">
          <div className="auth-card-brand">
            <BrandMark onDark size={44} />
          </div>
          <h1>Welcome back</h1>
          <p className="auth-card-subtext">Log in to manage your donor status or blood requests.</p>

          <form onSubmit={handleSubmit}>
            {accountSuspended && !error && (
              <p className="error-banner">Your account has been suspended. Please contact the administrator.</p>
            )}
            {sessionExpired && !error && (
              <p className="error-banner">Your session has expired. Please log in again.</p>
            )}
            {error && <p className="error-banner">{error}</p>}
            <label className="field">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="field">
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button type="submit" disabled={submitting} className="btn btn-primary btn-block">
              {submitting ? 'Logging in...' : 'Log in'}
            </button>
          </form>

          <p className="auth-card-footer">
            Don't have an account? <Link to="/signup">Sign up</Link>
          </p>
        </div>
      </div>
    </>
  );
}
