import { useState } from 'react';
import { useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
import { apiPost } from '../api/client.js';
import { saveSession, getUser, dashboardPathFor } from '../auth/session.js';
import { todayForDateInput } from '../lib/format.js';
import TopBar from '../components/TopBar.jsx';
import BrandMark from '../components/BrandMark.jsx';

const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

export default function Signup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Links from the landing page preselect the role (?role=donor|requester)
  // and the blood group (?bloodType=O-) so the person doesn't start from zero.
  const roleParam = params.get('role');
  const bloodParam = params.get('bloodType');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: roleParam === 'requester' ? 'requester' : 'donor',
    phone: '',
    city: '',
    blood_group: BLOOD_GROUPS.includes(bloodParam) ? bloodParam : '',
    last_donation_date: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function setRole(role) {
    setForm((f) => ({ ...f, role }));
  }

  // Already signed in: no reason to see the signup form again.
  const existing = getUser();
  if (existing) return <Navigate to={dashboardPathFor(existing.role)} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
      };
      if (!payload.phone) delete payload.phone;
      if (payload.role !== 'donor') {
        delete payload.blood_group;
        delete payload.last_donation_date;
      } else if (!payload.last_donation_date) {
        delete payload.last_donation_date;
      }
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
      <div className="auth-screen" style={{ backgroundImage: "url('/images/hero-donation.jpg')" }}>
        <div className="auth-card">
          <div className="auth-card-brand">
            <BrandMark onDark size={44} />
          </div>
          <h1>Create an account</h1>
          <p className="auth-card-subtext">Join as a donor or a requester in a couple of minutes.</p>

          <form onSubmit={handleSubmit}>
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

            <div className="field">
              I am a
              <div className="segmented" role="radiogroup" aria-label="I am a">
                <button
                  type="button"
                  role="radio"
                  aria-checked={form.role === 'donor'}
                  className={`segmented-option${form.role === 'donor' ? ' is-active' : ''}`}
                  onClick={() => setRole('donor')}
                >
                  Donor
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={form.role === 'requester'}
                  className={`segmented-option${form.role === 'requester' ? ' is-active' : ''}`}
                  onClick={() => setRole('requester')}
                >
                  Requester
                </button>
              </div>
            </div>

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

            {form.role === 'donor' && (
              <label className="field">
                Last donation date (optional)
                <input
                  type="date"
                  max={todayForDateInput()}
                  value={form.last_donation_date}
                  onChange={update('last_donation_date')}
                />
              </label>
            )}

            <label className="field">
              Phone (optional)
              <input type="tel" value={form.phone} onChange={update('phone')} />
            </label>
            <label className="field">
              City
              <input value={form.city} onChange={update('city')} required minLength={2} />
            </label>

            <button type="submit" disabled={submitting} className="btn btn-primary btn-block">
              {submitting ? 'Creating account...' : 'Sign up'}
            </button>
          </form>

          <p className="auth-card-footer">
            Already have an account? <Link to="/login">Log in</Link>
          </p>
        </div>
      </div>
    </>
  );
}
