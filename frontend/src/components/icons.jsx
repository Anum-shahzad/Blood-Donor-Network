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

export function ClockIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HeartIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IdCardIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15 8h3M15 12h3M6 17c0-2 2-3 3-3s3 1 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function SlidersIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function PhoneIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MessageCircleIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CheckCircleIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="22 4 12 14.01 9 11.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertCircleIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function RadarIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 6a6 6 0 1 0 6 6 6 6 0 0 0-6-6zm0 10a4 4 0 1 1 4-4 4 4 0 0 1-4 4z" stroke="currentColor" strokeWidth="1.6" />
      <line x1="12" y1="12" x2="19" y2="5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ArchiveIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <polyline points="21 8 21 21 3 21 3 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="1" y="3" width="22" height="5" stroke="currentColor" strokeWidth="1.6" />
      <line x1="10" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function GaugeIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FileTextIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.6" />
      <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <polyline points="10 9 9 9 8 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function UsersIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CarIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path d="M5 17h14M5 17a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.5l2-3h7l2 3H19a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HospitalIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 9h6M12 6v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function XIcon({ size = 18 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 16 }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
