// Simple droplet-and-pulse mark used as the app's logo everywhere
// (public topbar, sidebar, auth screens). The project has no existing
// logo asset, so this is a lightweight icon rather than an imported image —
// it inherits color from CSS (.brand-mark), so it reads correctly on both
// white and deep-red backgrounds.
export default function BrandMark({ onDark = false, size = 34 }) {
  return (
    <span
      className={`brand-mark${onDark ? ' brand-mark--on-dark' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M12 2.5c-3.5 4.3-6.5 8.2-6.5 11.8a6.5 6.5 0 0 0 13 0c0-3.6-3-7.5-6.5-11.8Z"
          fill="currentColor"
        />
        <path
          d="M7.2 13.2c.3 2 1.9 3.4 3.8 3.6"
          stroke="#ffffff"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.85"
        />
      </svg>
    </span>
  );
}
