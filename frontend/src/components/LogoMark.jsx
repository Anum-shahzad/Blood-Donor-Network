import { useId } from 'react';

// Blood Donor Network symbol (the "Connected Life" droplet with two interlocked
// loops). One component, two looks:
//   variant="gradient"  brand red -> maroon (default; for light backgrounds)
//   variant="white"     solid white (for dark / maroon backgrounds)
//
// Gradient colours come from CSS variables so each surface can tune them:
//   --logo-a / --logo-b   (fallback to the brand palette #E44747 -> #781D32)
// The wordmark stays live text next to it, so it follows light/dark theme.
const PATH =
  'M108.37,133.47c6.27-2.1,11.85-4.26,17.6-5.71,1.43-.36,4.31,1.07,5.05,2.46,17.35,32.53,13.27,74.28-20.1,96.27-32.48,21.41-78.79,11.54-98.91-21-14.7-23.78-15.49-49.25-1.39-73.12,14.88-25.18,31.9-49.14,48.68-73.16,13.72-19.63,28.45-38.56,43.16-58.37,5.3,7.18,10.71,14.23,15.82,21.49,24.09,34.29,48.39,68.43,71.99,103.06,11.14,16.35,15.66,34.89,11.93,54.68-7.97,42.25-46.72,66.3-90.93,55.11,11.52-6.35,17.32-17.18,31.91-19.01,19.86-2.5,32.53-16.71,36.99-36.43,4.42-19.54-.72-36.81-16.71-49.43-16.28-12.85-34.48-13.24-52.85-4.61-25.66,12.05-34.27,43.3-19.05,68,1.63,2.65,3.38,5.22,5.77,8.89-6.16,2.44-11.6,5.1-17.34,6.55-1.69.43-5.04-2.04-6.3-4.02-26.3-41.26-1.47-103.05,55.73-105.79,5.7-.27,11.43-.04,18.55-.04-15.61-21.1-30.47-41.2-46.26-62.54-15.34,21.21-29.76,41.12-44.9,62.05,12.85.71,24.19,1.34,37.28,2.07-7.46,6.81-13.07,12.22-19.05,17.21-1.42,1.19-4.03,1.28-6.1,1.34-28.91.72-49.74,24.34-46.79,53.15,2.98,29.11,28.49,48.93,56.65,44.02,35.71-6.24,52.65-42.85,34.5-74.62-1.42-2.48-2.88-4.94-4.94-8.48Z';

export default function LogoMark({ variant = 'gradient', height = 28, className = '' }) {
  const gid = useId().replace(/:/g, '');
  const white = variant === 'white';
  return (
    <svg
      className={`logo-mark${className ? ' ' + className : ''}`}
      viewBox="0 0 204 238.4"
      height={height}
      width={(height * 204) / 238.4}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {!white && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0.2" x2="1" y2="0.8">
            <stop offset="0.12" stopColor="var(--logo-a, #E44747)" />
            <stop offset="1" stopColor="var(--logo-b, #781D32)" />
          </linearGradient>
        </defs>
      )}
      <path d={PATH} fill={white ? '#ffffff' : `url(#${gid})`} />
    </svg>
  );
}
