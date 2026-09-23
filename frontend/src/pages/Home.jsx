import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client.js';
import '../styles/landing.css';

export default function Home() {
  const pageRef = useRef(null);
  const [navOpen, setNavOpen] = useState(false);
  const [connected, setConnected] = useState(null);

  // Live backend status, shown in the hero — same check the app already
  // performs, wired into the prototype's status-dot/status-line markup.
  useEffect(() => {
    apiGet('/api/health')
      .then((data) => setConnected(data.db === 'connected'))
      .catch(() => setConnected(false));
  }, []);

  // Single orchestrated reveal-on-scroll pass, ported from the prototype's
  // script.js into a React effect (IntersectionObserver over .lp-reveal).
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return undefined;
    const revealEls = root.querySelectorAll('.lp-reveal');
    if (!revealEls.length) return undefined;

    if (!('IntersectionObserver' in window)) {
      revealEls.forEach((el) => el.classList.add('lp-is-visible'));
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('lp-is-visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealEls.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  function closeNav() {
    setNavOpen(false);
  }

  return (
    <div className="lp-page" ref={pageRef}>
      <a className="lp-skip-link" href="#lp-main">
        Skip to content
      </a>

      <header className={`lp-site-header${navOpen ? ' lp-nav-open' : ''}`}>
        <div className="lp-container lp-header-inner">
          <a href="#" className="lp-logo" aria-label="Blood Donor Network home">
            <span className="lp-logo-mark" aria-hidden="true">
              <svg width="22" height="26" viewBox="0 0 22 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M11 1C11 1 1 12.5 1 18C1 22.4183 5.47715 26 11 26C16.5228 26 21 22.4183 21 18C21 12.5 11 1 11 1Z"
                  fill="var(--lp-red-primary)"
                />
              </svg>
            </span>
            Blood Donor Network
          </a>
          <nav className="lp-main-nav" aria-label="Primary">
            <a href="#how-it-works" onClick={closeNav}>How it works</a>
            <a href="#donors" onClick={closeNav}>For donors</a>
            <a href="#patients" onClick={closeNav}>For patients</a>
            <a href="#safety" onClick={closeNav}>Safety</a>
            <a href="#about" onClick={closeNav}>About</a>
          </nav>
          <div className="lp-header-actions">
            <Link to="/signup" className="lp-btn lp-btn-primary lp-btn-sm">
              Find a donor
            </Link>
            <button
              className="lp-nav-toggle"
              aria-expanded={navOpen}
              aria-controls="lp-main-nav"
              aria-label="Toggle menu"
              onClick={() => setNavOpen((v) => !v)}
              type="button"
            >
              <span></span>
              <span></span>
              <span></span>
            </button>
          </div>
        </div>
      </header>

      <main id="lp-main">
        {/* HERO */}
        <section className="lp-hero">
          <div className="lp-hero-media-bg">
            <img
              src="/images/hero-transfusion.png"
              alt="A unit of blood ready for transfusion in a hospital ward"
              loading="eager"
            />
          </div>
          <div className="lp-container">
            <div className="lp-hero-overlay-card lp-reveal">
              <p className="lp-hero-eyebrow">Sukkur, Pakistan</p>
              <h1>When every minute matters, finding a donor shouldn&rsquo;t depend on who you know.</h1>
              <p className="lp-hero-sub">
                Blood Donor Network connects people who urgently need blood with available, compatible
                donors nearby — through one coordinated network, not a chain of phone calls.
              </p>
              <div className="lp-hero-actions">
                <Link to="/signup" className="lp-btn lp-btn-primary">
                  Find blood
                </Link>
                <Link to="/signup" className="lp-btn lp-btn-secondary-light">
                  Become a donor
                </Link>
              </div>
              {connected !== null && (
                <p className="lp-status-line">
                  <span className={`lp-status-dot${connected ? '' : ' lp-is-down'}`}></span>
                  {connected ? 'System status: operational' : 'System status: having trouble reaching the server'}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* PROBLEM */}
        <section className="lp-section lp-problem" id="about">
          <div className="lp-container">
            <div className="lp-problem-intro lp-reveal">
              <p className="lp-eyebrow lp-center">The problem</p>
              <h2 className="lp-center">In an emergency, searching shouldn&rsquo;t be the hardest part.</h2>
            </div>

            <div className="lp-flowchart lp-reveal" style={{ '--delay': '100ms' }}>
              <div className="lp-flow-row lp-flow-row-before">
                <span className="lp-flow-row-label">Today</span>
                <div className="lp-flow-chain">
                  <div className="lp-flow-node">
                    <span className="lp-flow-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M4 5h16v11H8l-4 4V5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="lp-flow-label">Post in a group</span>
                  </div>
                  <span className="lp-flow-arrow" aria-hidden="true"></span>
                  <div className="lp-flow-node">
                    <span className="lp-flow-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M4 6h16M4 12h16M4 18h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className="lp-flow-label">Forwarded onward</span>
                  </div>
                  <span className="lp-flow-arrow" aria-hidden="true"></span>
                  <div className="lp-flow-node">
                    <span className="lp-flow-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M12 7v5l3.2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className="lp-flow-label">Hours of waiting</span>
                  </div>
                  <span className="lp-flow-arrow" aria-hidden="true"></span>
                  <div className="lp-flow-node lp-flow-node-end">
                    <span className="lp-flow-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path
                          d="M4 4v6h6M20 20v-6h-6"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path d="M4.5 15A8 8 0 0 0 19 16.5M19.5 9A8 8 0 0 0 5 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className="lp-flow-label">Search restarts</span>
                  </div>
                </div>
              </div>

              <div className="lp-flow-row lp-flow-row-after">
                <span className="lp-flow-row-label">With Blood Donor Network</span>
                <div className="lp-flow-chain">
                  <div className="lp-flow-node">
                    <span className="lp-flow-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <rect x="5" y="3.5" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M9 8h6M9 12h6M9 16h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className="lp-flow-label">Request created</span>
                  </div>
                  <span className="lp-flow-arrow" aria-hidden="true"></span>
                  <div className="lp-flow-node">
                    <span className="lp-flow-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path
                          d="M12 3.5 4 7v5c0 4.5 3.3 7.6 8 8.5 4.7-.9 8-4 8-8.5V7l-8-3.5Z"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinejoin="round"
                        />
                        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="lp-flow-label">Compatibility checked</span>
                  </div>
                  <span className="lp-flow-arrow" aria-hidden="true"></span>
                  <div className="lp-flow-node">
                    <span className="lp-flow-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path
                          d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11Z"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinejoin="round"
                        />
                        <circle cx="12" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.6" />
                      </svg>
                    </span>
                    <span className="lp-flow-label">Donors surfaced</span>
                  </div>
                  <span className="lp-flow-arrow" aria-hidden="true"></span>
                  <div className="lp-flow-node lp-flow-node-end">
                    <span className="lp-flow-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M3 13l4-4 3 3 6-6 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M15 6h6v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M4 19h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className="lp-flow-label">Direct connection</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="lp-section lp-how-it-works" id="how-it-works">
          <div className="lp-container">
            <p className="lp-eyebrow lp-center">How it works</p>
            <h2 className="lp-center">A request finds its way to the right person, step by step.</h2>
            <ol className="lp-timeline lp-reveal">
              <li className="lp-timeline-step">
                <span className="lp-step-num">01</span>
                <h3>Create a request</h3>
                <p>Blood type, urgency, hospital or location, and a way to be reached.</p>
              </li>
              <li className="lp-timeline-step">
                <span className="lp-step-num">02</span>
                <h3>The network checks compatibility</h3>
                <p>Matching considers blood-type compatibility, distance, and current availability.</p>
              </li>
              <li className="lp-timeline-step">
                <span className="lp-step-num">03</span>
                <h3>Suitable donors are surfaced</h3>
                <p>Available donors nearby see requests they may be able to help with.</p>
              </li>
              <li className="lp-timeline-step">
                <span className="lp-step-num">04</span>
                <h3>People connect</h3>
                <p>The requester reaches out to a donor directly to arrange donation.</p>
              </li>
              <li className="lp-timeline-step">
                <span className="lp-step-num">05</span>
                <h3>The request resolves</h3>
                <p>Status moves from Pending to Fulfilled — or Expired if it isn&rsquo;t met in time.</p>
              </li>
            </ol>
          </div>
        </section>

        {/* FOR PATIENTS */}
        <section className="lp-section lp-split" id="patients">
          <div className="lp-container lp-split-grid">
            <div className="lp-split-copy lp-reveal">
              <p className="lp-eyebrow">For people who need blood</p>
              <h2>You shouldn&rsquo;t have to broadcast an emergency to everyone you know.</h2>
              <p className="lp-lede">Tell us what&rsquo;s needed, and let the network do the searching.</p>
              <ul className="lp-check-list">
                <li>Enter the blood type needed and how urgent it is</li>
                <li>Add the hospital or location</li>
                <li>Leave a contact number</li>
                <li>See relevant, available donors as they&rsquo;re found</li>
                <li>Reach out to a suitable donor directly</li>
              </ul>
              <Link to="/signup" className="lp-btn lp-btn-primary">
                Find blood
              </Link>
            </div>
            <div className="lp-split-visual lp-reveal" style={{ '--delay': '100ms' }}>
              <div className="lp-ui-panel">
                <p className="lp-ui-panel-title">New blood request</p>
                <div className="lp-ui-field"><span>Blood type</span><strong>O+</strong></div>
                <div className="lp-ui-field"><span>Urgency</span><strong className="lp-pill lp-pill-urgent">High</strong></div>
                <div className="lp-ui-field"><span>Hospital</span><strong>City Hospital, Sukkur</strong></div>
                <div className="lp-ui-field"><span>Contact</span><strong>Add phone number</strong></div>
                <button className="lp-ui-submit" type="button">Submit request</button>
              </div>
            </div>
          </div>
        </section>

        {/* FOR DONORS */}
        <section className="lp-section lp-split lp-split-reverse" id="donors">
          <div className="lp-container lp-split-grid">
            <div className="lp-split-visual lp-reveal">
              <div className="lp-ui-panel lp-ui-panel-dark">
                <p className="lp-ui-panel-title">Available to donate</p>
                <div className="lp-ui-field"><span>Blood type</span><strong>A+</strong></div>
                <div className="lp-ui-field"><span>Location</span><strong>Sukkur</strong></div>
                <div className="lp-ui-field"><span>Availability</span><strong className="lp-pill lp-pill-available">Available</strong></div>
                <button className="lp-ui-submit lp-ui-submit-light" type="button">Review nearby requests</button>
              </div>
            </div>
            <div className="lp-split-copy lp-reveal" style={{ '--delay': '100ms' }}>
              <p className="lp-eyebrow">For donors</p>
              <h2>One donation can become someone else&rsquo;s second chance.</h2>
              <p className="lp-lede">
                Your profile stays yours to control — set your availability, and step forward when it&rsquo;s a good
                time for you.
              </p>
              <ul className="lp-check-list">
                <li>Create a donor profile with your blood type</li>
                <li>Add basic eligibility information</li>
                <li>Set your availability on or off, any time</li>
                <li>See requests near you that match your type</li>
                <li>Respond when you&rsquo;re able to help</li>
              </ul>
              <Link to="/signup" className="lp-btn lp-btn-secondary">
                Become a donor
              </Link>
            </div>
          </div>
        </section>

        {/* MATCHING */}
        <section className="lp-section lp-matching">
          <div className="lp-container">
            <p className="lp-eyebrow lp-center">Matching</p>
            <h2 className="lp-center">
              The right match isn&rsquo;t just the right blood type. It&rsquo;s the right donor, available at the
              right time.
            </h2>
            <div className="lp-matching-equation lp-reveal">
              <div className="lp-equation-item">
                <span className="lp-equation-icon" aria-hidden="true">＋</span>
                <h3>Compatibility</h3>
                <p>Blood-type compatibility rules decide who can donate to whom.</p>
              </div>
              <span className="lp-equation-op" aria-hidden="true">+</span>
              <div className="lp-equation-item">
                <span className="lp-equation-icon" aria-hidden="true">◎</span>
                <h3>Proximity</h3>
                <p>Donors closer to the hospital or location are surfaced first.</p>
              </div>
              <span className="lp-equation-op" aria-hidden="true">+</span>
              <div className="lp-equation-item">
                <span className="lp-equation-icon" aria-hidden="true">●</span>
                <h3>Availability</h3>
                <p>Only donors who&rsquo;ve marked themselves available are shown.</p>
              </div>
              <span className="lp-equation-op" aria-hidden="true">=</span>
              <div className="lp-equation-item lp-equation-result">
                <h3>A relevant donor</h3>
                <p>Not a guarantee — a better starting point than an open broadcast.</p>
              </div>
            </div>
          </div>
        </section>

        {/* SAFETY */}
        <section className="lp-section lp-safety" id="safety">
          <div className="lp-container">
            <p className="lp-eyebrow">Safety &amp; trust</p>
            <h2>Built to be accountable, not anonymous.</h2>
            <div className="lp-safety-grid lp-reveal">
              <div className="lp-safety-item">
                <h3>Identifiable accounts</h3>
                <p>Donors and requesters use real accounts, not anonymous posts.</p>
              </div>
              <div className="lp-safety-item">
                <h3>Visible request status</h3>
                <p>Every request shows its state clearly: Pending, Fulfilled, or Expired.</p>
              </div>
              <div className="lp-safety-item">
                <h3>Basic eligibility on file</h3>
                <p>Donors provide basic eligibility information as part of their profile.</p>
              </div>
              <div className="lp-safety-item">
                <h3>Data handled responsibly</h3>
                <p>Contact details are only shared as part of connecting for a request.</p>
              </div>
            </div>
          </div>
        </section>

        {/* EMOTIONAL MOMENT */}
        <section className="lp-section lp-emotional">
          <div className="lp-emotional-media">
            <img src="/images/donation-moment.png" alt="A blood donation in progress at a clinic" loading="lazy" />
          </div>
          <div className="lp-container">
            <div className="lp-emotional-copy lp-reveal">
              <h2>Some emergencies are measured in minutes.</h2>
              <p>Behind every request is a person waiting for help. Behind every donor is someone choosing to give it.</p>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="lp-section lp-final-cta">
          <div className="lp-container lp-final-cta-inner lp-reveal">
            <h2>Be part of the network when someone needs it most.</h2>
            <div className="lp-hero-actions">
              <Link to="/signup" className="lp-btn lp-btn-primary">
                Find blood
              </Link>
              <Link to="/signup" className="lp-btn lp-btn-secondary">
                Become a donor
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-site-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-logo">Blood Donor Network</span>
            <p>A coordinated network for blood emergencies.</p>
          </div>
          <nav className="lp-footer-nav" aria-label="Footer">
            <a href="#how-it-works">How it works</a>
            <Link to="/signup">Find blood</Link>
            <Link to="/signup">Become a donor</Link>
            <a href="#about">About</a>
            <a href="#safety">Safety &amp; privacy</a>
            <Link to="/login">Log in</Link>
          </nav>
        </div>
        <div className="lp-container">
          <p className="lp-footer-copy">&copy; 2026 Blood Donor Network. Sukkur, Pakistan.</p>
        </div>
      </footer>
    </div>
  );
}
