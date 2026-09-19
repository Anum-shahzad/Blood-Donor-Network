import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiPost } from '../api/client.js';
import { saveSession, dashboardPathFor } from '../auth/session.js';
import TopBar from '../components/TopBar.jsx';

const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

export default function Signup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'donor',
    phone: '',
    city: '',
    blood_group: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = { ...form };
      if (payload.role !== 'donor') delete payload.blood_group;
      const data = await apiPost('/api/auth/signup', payload);
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
      <main className="page" style={{ maxWidth: 440 }}>
        <h1>Create an account</h1>

        <form onSubmit={handleSubmit} className="form-card">
          {error && <p className="error-banner">{error}</p>}

          <label className="field">
            Name
            <input value={form.name} onChange={update('name')} required />
          </label>
          <label className="field">
            Email
            <input type="email" value={form.email} onChange={update('email')} required />
          </label>
          <label className="field">
            Password
            <input type="password" value={form.password} onChange={update('password')} required minLength={8} />
          </label>
          <label className="field">
            I am a
            <select value={form.role} onChange={update('role')}>
              <option value="donor">Donor</option>
              <option value="requester">Requester</option>
            </select>
          </label>
          {form.role === 'donor' && (
            <label className="field">
              Blood group
              <select value={form.blood_group} onChange={update('blood_group')} required>
                <option value="" disabled>
                  Select your blood group
                </option>
                {BLOOD_GROUPS.map((bg) => (
                  <option key={bg} value={bg}>
                    {bg}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Phone
            <input value={form.phone} onChange={update('phone')} />
          </label>
          <label className="field">
            City
            <input value={form.city} onChange={update('city')} />
          </label>

          <button type="submit" disabled={submitting} className="btn btn-primary btn-block">
            {submitting ? 'Creating account...' : 'Sign up'}
          </button>
        </form>

        <p style={{ marginTop: '1rem' }}>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </main>
    </>
  );
}
