import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// React Router doesn't scroll to #anchors or reset scroll on navigation by
// itself — so "/#how-it-works" links from other pages did nothing.
export default function ScrollToHash() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return undefined;
    }
    const id = decodeURIComponent(hash.slice(1));
    // Wait a tick so the target page has rendered the element.
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
    return () => clearTimeout(t);
  }, [pathname, hash]);

  return null;
}
