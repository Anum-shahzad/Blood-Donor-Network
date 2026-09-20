import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiPost } from '../api/client.js';
import { saveSession, dashboardPathFor } from '../auth/session.js';
import TopBar from '../components/TopBar.jsx';
import BrandMark from '../components/BrandMark.jsx';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await apiPost('/api/auth/login', { email, password });
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
