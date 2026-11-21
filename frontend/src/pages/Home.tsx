import { useNavigate } from 'react-router-dom';
import homeCss from '../styles/home.css?raw';
import { usePageStyles } from '../hooks/usePageStyles';
import { HomeToast } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { HOME_FEATURES } from '../config/homeFeatures';

/**
 * Dashboard after login, shown inside the AppShell (sidebar = navigation, incl. My Profile).
 * Cards, images, text, colours and fonts come from design-reference/home_page_files/home_page.html.
 */
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
      <main className="shell cs-home">
        <div className="cs-pagehead">
          <section className="heading">
            <p className="eyebrow">Your shop, at a glance</p>
            <h1>What would you like to do?</h1>
            <p>Choose a tool to get started.</p>
          </section>
          <div className="cs-pagehead-actions">
            <button className="top-action" type="button" data-action="Notifications" aria-label="Notifications" onClick={() => showToast('Notifications')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path>
              </svg>
              <span>Notifications</span>
            </button>
          </div>
        </div>
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
          <span>A little help for your shop</span>
        </footer>
      </main>
      <HomeToast text={text} show={show} />
    </>
  );
}
