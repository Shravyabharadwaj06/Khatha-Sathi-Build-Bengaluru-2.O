import { useState } from 'react';
import { Link } from 'react-router-dom';

/** In-page section links: plain #hash on the Landing page (native smooth scroll), router link to /#hash elsewhere. */
function SectionLink({ hash, onLanding, onClick, children }: { hash: string; onLanding: boolean; onClick: () => void; children: string }) {
  return onLanding ? (
    <a href={`#${hash}`} onClick={onClick}>
      {children}
    </a>
  ) : (
    <Link to={{ pathname: '/', hash: `#${hash}` }} onClick={onClick}>
      {children}
    </Link>
  );
}

/** Landing header: markup identical to the Stitch export (ported mobile-menu script included). */
export function LandingHeader({ onLanding = false }: { onLanding?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <header className="wrap topbar">
      <Link className="brand" to="/" aria-label="CHOTU.ai home">
        CHOTU<span>.ai</span>
      </Link>
      <nav className={open ? 'nav open' : 'nav'} id="nav">
        <SectionLink hash="how" onLanding={onLanding} onClick={close}>How it works</SectionLink>
        <SectionLink hash="help" onLanding={onLanding} onClick={close}>Features</SectionLink>
        <SectionLink hash="faq" onLanding={onLanding} onClick={close}>FAQ</SectionLink>
      </nav>
      <div className="topright">
        <div className="actions">
          <Link to="/login">Log in</Link>
          <Link className="btn" to="/signup">Sign up</Link>
        </div>
        <button className="menu-toggle" aria-label="Toggle menu" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((o) => !o)}>
          ☰
        </button>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-inner">
          <Link className="brand" to="/">
            CHOTU<span>.ai</span>
          </Link>
          <nav className="footer-links">
            <Link to="/terms">Terms and Conditions</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/login">Log in</Link>
            <Link to="/signup">Sign up</Link>
          </nav>
        </div>
        <div className="copyright">© 2026 CHOTU.ai</div>
      </div>
    </footer>
  );
}
