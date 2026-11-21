import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import shellCss from '../../styles/app-shell.css?raw';
import logo from '../../assets/chotu-logo-transparent.png';
import { usePageStyles } from '../../hooks/usePageStyles';
import { useI18n } from '../../i18n/useI18n';
import { MENU } from './menu';

/** Pages that manage their own full-height layout (no container padding). */
const FLUSH_ROUTES = new Set(['/assistant']);

function MenuList({ pathname, onNavigate, idPrefix }: { pathname: string; onNavigate?: () => void; idPrefix: string }) {
  const { t } = useI18n();
  return (
    <>
      <ul className="cs-menu" role="list">
        {MENU.map((item) => {
          const active = pathname === item.to || !!item.also?.includes(pathname);
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                id={`${idPrefix}-${item.to.slice(1)}`}
                className={`cs-link${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
                data-menu={item.to}
              >
                <span className="material-symbols-outlined cs-link-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="cs-link-label">{t(item.label)}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
      <div className="cs-menu-foot">
        <Link to="/logout" className="cs-link cs-logout" onClick={onNavigate} data-menu="/logout">
          <span className="material-symbols-outlined cs-link-icon" aria-hidden="true">
            logout
          </span>
          <span className="cs-link-label">{t('nav.logout')}</span>
        </Link>
      </div>
    </>
  );
}

/**
 * Shared layout for every logged-in page: sidebar (desktop), icon rail (tablet),
 * top bar + slide-in drawer (mobile). Its CSS is injected only while a protected
 * route is mounted, so Landing / Log in / Sign up are never affected.
 */
export default function AppShell() {
  usePageStyles({ css: [shellCss] });
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => menuButton.current?.focus());
  }, []);

  // Move focus into the drawer when it opens; lock page scroll behind it.
  useEffect(() => {
    if (!open) return;
    const first = drawer.current?.querySelector<HTMLElement>('a, button');
    first?.focus();
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    const desktop = window.matchMedia('(min-width: 768px)');
    const onResize = () => desktop.matches && setOpen(false);
    window.addEventListener('keydown', onKey);
    desktop.addEventListener('change', onResize);
    return () => {
      document.documentElement.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onResize);
    };
  }, [open, close]);

  // New page: close the drawer and start at the top.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Keep Tab inside the drawer while it is open.
  const trapFocus = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !drawer.current) return;
    const items = Array.from(drawer.current.querySelectorAll<HTMLElement>('a, button'));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const flush = FLUSH_ROUTES.has(pathname);

  return (
    <div className={`cs-root${flush ? ' cs-root--flush' : ''}`}>
      <a className="cs-skip" href="#cs-content">
        Skip to content
      </a>

      {/* Mobile top bar */}
      <div className="cs-topbar">
        <button
          ref={menuButton}
          type="button"
          className="cs-menu-button"
          aria-label={t('nav.menu')}
          aria-expanded={open}
          aria-controls="cs-drawer"
          onClick={() => setOpen(true)}
          data-testid="menu-button"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            menu
          </span>
        </button>
        <Link to="/home" className="cs-brand cs-brand--top" aria-label="CHOTU.ai home">
          <img src={logo} alt="CHOTU.ai" />
        </Link>
        <span className="cs-topbar-spacer" aria-hidden="true" />
      </div>

      {/* Desktop sidebar / tablet icon rail */}
      <nav className="cs-sidebar" aria-label={t('nav.mainMenu')}>
        <Link to="/home" className="cs-brand" aria-label="CHOTU.ai home">
          <img src={logo} alt="CHOTU.ai" />
        </Link>
        <MenuList pathname={pathname} idPrefix="side" />
      </nav>

      {/* Mobile drawer */}
      {open && <div className="cs-backdrop" onClick={() => close()} data-testid="menu-backdrop" aria-hidden="true" />}
      <div
        id="cs-drawer"
        ref={drawer}
        className={`cs-drawer${open ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.mainMenu')}
        hidden={!open}
        onKeyDown={trapFocus}
        data-testid="menu-drawer"
      >
        <div className="cs-drawer-head">
          <Link to="/home" className="cs-brand" aria-label="CHOTU.ai home" onClick={() => close(false)}>
            <img src={logo} alt="CHOTU.ai" />
          </Link>
          <button type="button" className="cs-menu-button" aria-label={t('nav.closeMenu')} onClick={() => close()} data-testid="menu-close">
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>
        <nav aria-label={t('nav.mainMenu')}>
          <MenuList pathname={pathname} idPrefix="drawer" onNavigate={() => close(false)} />
        </nav>
      </div>

      <div className="cs-content" id="cs-content" tabIndex={-1}>
        <div className="cs-container">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
