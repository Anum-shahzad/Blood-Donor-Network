import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiPost } from '../api/client.js';
import { saveSession } from '../auth/session.js';

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
      navigate(data.user.role === 'donor' ? '/donor/dashboard' : '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={styles.main}>
      <h1>Create an account</h1>
      <form onSubmit={handleSubmit} style={styles.form}>
        <label>
          Name
          <input value={form.name} onChange={update('name')} required style={styles.input} />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={update('email')} required style={styles.input} />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            required
            minLength={8}
            style={styles.input}
          />
        </label>
        <label>
          I am a
          <select value={form.role} onChange={update('role')} style={styles.input}>
            <option value="donor">Donor</option>
            <option value="requester">Requester</option>
          </select>
        </label>
        {form.role === 'donor' && (
          <label>
            Blood group
            <select value={form.blood_group} onChange={update('blood_group')} required style={styles.input}>
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
        <label>
          Phone
          <input value={form.phone} onChange={update('phone')} style={styles.input} />
        </label>
        <label>
          City
          <input value={form.city} onChange={update('city')} style={styles.input} />
        </label>

        {error && <p style={styles.error}>{error}</p>}

        <button type="submit" disabled={submitting} style={styles.button}>
          {submitting ? 'Creating account...' : 'Sign up'}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}

const styles = {
  main: { fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 420, margin: '0 auto' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input: { display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem' },
  button: { padding: '0.6rem', marginTop: '0.5rem', cursor: 'pointer' },
  error: { color: '#b00020' },
};
