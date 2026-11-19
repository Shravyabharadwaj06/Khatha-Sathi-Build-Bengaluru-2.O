import { Link, useNavigate } from 'react-router-dom';
import homeCss from '../styles/home.css?raw';
import logo from '../assets/chotu-logo-transparent.png';
import { usePageStyles } from '../hooks/usePageStyles';
import { HomeToast } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { HOME_FEATURES } from '../config/homeFeatures';

/** Source: design-reference/home_page_files/home_page.html (the newer "home-with-logo" export). */
export default function Home() {
  usePageStyles({ css: [homeCss], title: 'CHOTU.ai | Your shop' });
  const { text, show, showToast } = useToast();
  const navigate = useNavigate();

  const open = (label: string, route?: string) => {
    if (route) navigate(route);
    else showToast(label);
  };

  return (
    <>
      <header className="shell topbar">
        {/* TODO: My Profile screen. Logout currently lives at /logout. */}
        <button className="top-action" type="button" data-action="My Profile" aria-label="My Profile" onClick={() => showToast('My Profile')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5"></circle>
            <path d="M4.8 20c.8-3.4 3.2-5.2 7.2-5.2s6.4 1.8 7.2 5.2"></path>
          </svg>
          <span>My Profile</span>
        </button>
        <Link className="wordmark" to="/home" aria-label="CHOTU.ai home">
          <img src={logo} alt="CHOTU.ai" className="wordmark-logo" />
        </Link>
        <button className="top-action" type="button" data-action="Notifications" aria-label="Notifications" onClick={() => showToast('Notifications')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path>
          </svg>
          <span>Notifications</span>
        </button>
      </header>
      <main className="shell">
        <section className="heading">
          <p className="eyebrow">Your shop, at a glance</p>
          <h1>What would you like to do?</h1>
          <p>Choose a tool to get started.</p>
        </section>
        <section className="grid" aria-label="Shop tools">
          {HOME_FEATURES.map((f) => (
            <button key={f.label} className="feature" type="button" data-action={f.label} onClick={() => open(f.label, f.route)}>
              <span className="art">
                <img src={f.image} alt={f.alt} loading={f.loading} />
              </span>
              <span className="label">
                <span>{f.label}</span>
                <span className="arrow" aria-hidden="true">
                  ↗
                </span>
              </span>
            </button>
          ))}
        </section>
        <footer className="footer">
          <img src={logo} alt="CHOTU.ai" className="footer-logo" />
          <span>A little help for your shop</span>
        </footer>
      </main>
      <HomeToast text={text} show={show} />
    </>
  );
}
