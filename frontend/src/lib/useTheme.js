import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'lp-theme';

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null; // storage blocked (private mode etc.) — just don't persist
  }
}

// First visit follows the device setting; after the person picks, their
// choice wins and is remembered.
function initialTheme() {
  const stored = readStored();
  if (stored) return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Theme for the public pages (landing + emergency). The value is applied by
// the page as data-theme on its .lp-page wrapper, so the dashboards and
// auth pages are unaffected.
export default function useTheme() {
  const [theme, setTheme] = useState(initialTheme);

  // Keep the browser chrome (scrollbars, overscroll area, form controls) in
  // step with the page while it is on screen, and restore it on leave.
  useEffect(() => {
    const root = document.documentElement;
    const prevScheme = root.style.colorScheme;
    const prevBg = document.body.style.background;
    root.style.colorScheme = theme;
    document.body.style.background = theme === 'dark' ? '#151515' : '';
    return () => {
      root.style.colorScheme = prevScheme;
      document.body.style.background = prevBg;
    };
  }, [theme]);

  // Follow the OS if it changes and the person hasn't chosen manually.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = (e) => {
      if (!readStored()) setTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    // Cross-fade colours for a moment instead of snapping. The class only
    // exists for ~0.45s, so it never slows normal hover/transform transitions.
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const pages = document.querySelectorAll('.lp-page');
      pages.forEach((el) => el.classList.add('lp-theme-switching'));
      window.setTimeout(() => pages.forEach((el) => el.classList.remove('lp-theme-switching')), 450);
    }
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* not persisted */
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
