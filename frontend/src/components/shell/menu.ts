import type { TranslationKey } from '../../i18n/locales/en';

interface MenuItem {
  to: string;
  icon: string;
  label: TranslationKey;
  /** Other paths that highlight this item. */
  also?: string[];
}

/** Side menu (same order on desktop, tablet and the mobile drawer). */
export const MENU: MenuItem[] = [
  { to: '/home', icon: 'home', label: 'nav.home' },
  { to: '/assistant', icon: 'mic', label: 'nav.assistant' },
  { to: '/products', icon: 'inventory_2', label: 'nav.products' },
  { to: '/customers', icon: 'group', label: 'nav.customers' },
  { to: '/reports', icon: 'inbox', label: 'nav.myReports' },
  { to: '/report-issue', icon: 'report', label: 'nav.reportIssue', also: ['/report-sent'] },
  { to: '/profile', icon: 'person', label: 'nav.profile' },
];
