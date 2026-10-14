import { useEffect } from 'react';

// Scroll- and pointer-driven effects for the landing page. Everything is
// written as CSS custom properties / data attributes on the .lp-page root, so
// React never re-renders for it and the CSS decides how it looks.
//
//   data-scrolled   true   once the page has moved (header shadow)
//   --lp-hero-shift px     gentle parallax on the hero photo
//   .lp-in-view            on .lp-loop-zone sections while on screen, so looping
//                          animations pause when nobody can see them
//
// Parallax is skipped when the visitor prefers reduced
// motion; the header shadow is state, not motion, so it stays.
export default function useMotion(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const reduceQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduce = () => Boolean(reduceQuery?.matches);
    const hero = root.querySelector('.lp-hero');
    const cleanups = [];

    // ---- scroll: header state + hero parallax (one rAF per frame)
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY || 0;
      root.dataset.scrolled = y > 8 ? 'true' : 'false';
      if (hero && !reduce()) {
        // Capped so the oversized photo never reveals an edge.
        root.style.setProperty('--lp-hero-shift', `${Math.min(44, y * 0.12).toFixed(1)}px`);
      }
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    cleanups.push(() => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    });

    // ---- pause looping animations while their section is off screen
    const zones = root.querySelectorAll('.lp-loop-zone');
    if (zones.length) {
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(
          (entries) => {
            entries.forEach((e) => e.target.classList.toggle('lp-in-view', e.isIntersecting));
          },
          { threshold: 0.05 }
        );
        zones.forEach((z) => io.observe(z));
        cleanups.push(() => io.disconnect());
      } else {
        zones.forEach((z) => z.classList.add('lp-in-view'));
      }
    }

    return () => cleanups.forEach((fn) => fn());
  }, [rootRef]);
}
