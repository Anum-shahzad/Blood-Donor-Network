// Minimal inline icon set. All icons inherit color via currentColor so they
// work on both the red sidebar and white dashboard cards without variants.
const base = {
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
};

export function GridIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function HomeIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M4 11.5 12 4l8 7.5M6 10v9h5v-5h2v5h5v-9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LogoutIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 16l4-4-4-4M20 12H9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MenuIcon({ size = 20 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function DropletIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 2.5c-3.5 4.3-6.5 8.2-6.5 11.8a6.5 6.5 0 0 0 13 0c0-3.6-3-7.5-6.5-11.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function MapPinIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function CalendarIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <rect x="3.5" y="5" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ShieldCheckIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 3 5 6v5.5c0 4.6 3 8 7 9.5 4-1.5 7-4.9 7-9.5V6l-7-3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 12.2 11.2 14.5 15.4 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
