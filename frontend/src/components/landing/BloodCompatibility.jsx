import { useState } from 'react';
import { Link } from 'react-router-dom';

const TYPES = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

// A donor can give to a recipient when the donor's red-cell antigens are a
// subset of the recipient's (O has none) and the donor is Rh-negative or the
// recipient is Rh-positive. No lookup table needed.
function parse(type) {
  const abo = type.slice(0, -1);
  return { rh: type.endsWith('+'), antigens: abo === 'O' ? [] : abo.split('') };
}
export function canGive(donor, recipient) {
  const d = parse(donor);
  const r = parse(recipient);
  return d.antigens.every((a) => r.antigens.includes(a)) && (!d.rh || r.rh);
}

function PillRow({ types }) {
  if (types.length === 0) {
    return <p className="lp-compat-none">No matches among the 8 types.</p>;
  }
  return (
    <ul className="lp-compat-pillrow">
      {types.map((t) => (
        <li key={t} className="lp-compat-pill">{t}</li>
      ))}
    </ul>
  );
}

export default function BloodCompatibility() {
  const [type, setType] = useState('A+');

  const receivesFrom = TYPES.filter((t) => canGive(t, type));
  const donatesTo = TYPES.filter((t) => canGive(type, t));

  return (
    <div className="lp-compat-card">
      <h3 className="lp-compat-title">Select your blood type</h3>

      <div className="lp-compat-typerow" role="group" aria-label="Choose your blood type">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className="lp-compat-typepill"
            aria-pressed={type === t}
            onClick={() => setType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="lp-compat-panel" key={`recv-${type}`}>
        <span className="lp-compat-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2C9 7 5 11.5 5 15.5a7 7 0 0 0 14 0C19 11.5 15 7 12 2Z" fill="currentColor" /></svg>
        </span>
        <div className="lp-compat-panel-body">
          <h4>Can receive from</h4>
          <PillRow types={receivesFrom} />
        </div>
      </div>

      <div className="lp-compat-panel" key={`give-${type}`}>
        <span className="lp-compat-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2C9 7 5 11.5 5 15.5a7 7 0 0 0 14 0C19 11.5 15 7 12 2Z" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
        </span>
        <div className="lp-compat-panel-body">
          <h4>Can donate to</h4>
          <PillRow types={donatesTo} />
        </div>
      </div>

      <p className="lp-compat-fine">Guide for red blood cells only. Hospitals always confirm with a cross-match before transfusion.</p>
      <Link to={`/signup?bloodType=${type}`} className="lp-btn lp-btn-primary lp-btn-sm">
        Continue as {type}
      </Link>
    </div>
  );
}
