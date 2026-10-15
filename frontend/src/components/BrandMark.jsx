import LogoMark from './LogoMark.jsx';

// App-wide logo symbol (public topbar, sidebar, auth screens). `size` is the
// symbol's height in px. Uses the white variant on dark backgrounds
// (sidebar, auth card) and the brand gradient everywhere else.
export default function BrandMark({ onDark = false, size = 34 }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <LogoMark variant={onDark ? 'white' : 'gradient'} height={size} />
    </span>
  );
}
