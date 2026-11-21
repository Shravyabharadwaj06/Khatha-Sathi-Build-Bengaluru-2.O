/**
 * App shell + dashboard checks (mock mode, uses the existing dist/):
 *   npm run test:shell        (builds with VITE_USE_MOCK_API=true first)
 *
 * Side menu links / active item / aria-current, tablet icon rail labels, mobile drawer (button, Esc,
 * outside tap, item tap, focus moves in and stays in), Log out, no sideways scroll on any route at
 * 1440 / 1024 / 390, AA contrast of the menu, and the Home behaviours that used to be pixel-compared
 * against the Stitch export (card toasts, toast hides after 1.8 s, hover lift, keyboard focus ring).
 */
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = 4351;
const BASE = `http://localhost:${PORT}`;
const SESSION = JSON.stringify({ token: 't', user: { id: 'demo', name: 'Demo Shop', email: 'demo@chotu.shop', phone: '9876543210', city: 'Bengaluru', businessDomain: 'Grocery' } });
const MENU = ['/home', '/assistant', '/products', '/customers', '/reports', '/report-issue', '/profile'];
const ROUTES = ['/', '/login', '/signup', '/terms', '/privacy', ...MENU];
const PUBLIC = new Set(['/', '/login', '/signup', '/terms', '/privacy']);
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

const isFile = async (p: string) => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url ?? '/', BASE).pathname);
  let file = normalize(join(DIST, url));
  if (!file.startsWith(DIST) || !(await isFile(file))) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
});

const results: { ok: boolean }[] = [];
const consoleIssues: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function open(browser: Browser, width: number, loggedIn = true) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript('globalThis.__name = (f) => f;');
  if (loggedIn) await ctx.addInitScript((s) => localStorage.getItem('chotu.session') ?? localStorage.setItem('chotu.session', s), SESSION);
  await ctx.route(/127\.0\.0\.1:8000|localhost:8000/, (r) => r.abort()); // no backend in mock mode
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && consoleIssues.push(`[${width}] ${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => consoleIssues.push(`[${width}] pageerror: ${e.message}`));
  return { ctx, page };
}
const path = (page: Page) => new URL(page.url()).pathname;
const activeItems = (page: Page, scope: string) =>
  page.evaluate((sel) => Array.from(document.querySelectorAll(`${sel} [aria-current="page"]`)).map((a) => a.getAttribute('data-menu')), scope);

/** WCAG relative-luminance contrast of two rgb() colours. */
function contrast(a: string, b: string) {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

async function run(browser: Browser) {
  // ---------------------------------------------------------------- desktop sidebar
  {
    const { ctx, page } = await open(browser, 1440);
    await page.goto(`${BASE}/home`);
    await page.waitForSelector('.cs-sidebar');
    let allOk = true;
    const wrong: string[] = [];
    for (const to of MENU) {
      await page.click(`.cs-sidebar [data-menu="${to}"]`);
      await page.waitForURL(`**${to}`);
      // The URL changes (pushState) before React re-renders the menu; wait for that render, then check strictly.
      await page.waitForSelector(`.cs-sidebar [data-menu="${to}"][aria-current="page"]`, { timeout: 2000 }).catch(() => {});
      const active = await activeItems(page, '.cs-sidebar');
      if (path(page) !== to || active.length !== 1 || active[0] !== to) {
        allOk = false;
        wrong.push(`${to}: at ${path(page)}, active=${active.join(',')}`);
      }
    }
    check('Desktop: every side-menu link opens its page and is the only aria-current item', allOk, wrong.join(' | '));
    const look = await page.evaluate(() => {
      const a = document.querySelector('.cs-sidebar [aria-current="page"]')!;
      const s = getComputedStyle(a);
      return { bg: s.backgroundColor, bar: s.borderLeftColor, barW: s.borderLeftWidth, color: s.color };
    });
    check('Desktop: active item = pale-blue background + indigo left bar', look.bg === 'rgb(194, 220, 227)' && look.bar === 'rgb(15, 15, 86)' && look.barW === '3px', JSON.stringify(look));

    // contrast (AA: 4.5:1 for normal text)
    const pairs = await page.evaluate(() => {
      const side = getComputedStyle(document.querySelector('.cs-sidebar')!).backgroundColor;
      const out: [string, string, string][] = [];
      document.querySelectorAll('.cs-sidebar .cs-link').forEach((a) => {
        const s = getComputedStyle(a);
        out.push([a.getAttribute('data-menu') ?? '', s.color, s.backgroundColor === 'rgba(0, 0, 0, 0)' ? side : s.backgroundColor]);
      });
      return out;
    });
    const low = pairs.map(([n, fg, bg]) => [n, contrast(fg, bg)] as const).filter(([, c]) => c < 4.5);
    check('Accessibility: menu text contrast is at least 4.5:1 (AA)', low.length === 0, low.map(([n, c]) => `${n} ${c.toFixed(2)}`).join(', ') || `min ${Math.min(...pairs.map(([, fg, bg]) => contrast(fg, bg))).toFixed(1)}:1`);

    // keyboard: Tab reaches the menu, Enter opens the item
    await page.goto(`${BASE}/home`);
    await page.waitForSelector('.cs-sidebar');
    let reached = '';
    for (let i = 0; i < 8 && !reached.includes('/customers'); i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.getAttribute('data-menu') ?? '');
    }
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    await page.keyboard.press('Enter');
    await page.waitForURL('**/customers', { timeout: 3000 }).catch(() => {});
    check('Keyboard: Tab reaches menu items (visible focus), Enter opens them', reached === '/customers' && ring !== 'none' && path(page) === '/customers', `focus=${reached} outline=${ring}`);

    // Log out
    await page.click('.cs-sidebar [data-menu="/logout"]');
    await page.waitForURL('**/login', { timeout: 5000 }).catch(() => {});
    const session = await page.evaluate(() => localStorage.getItem('chotu.session') ?? sessionStorage.getItem('chotu.session'));
    const shellCss = await page.evaluate(() => Array.from(document.querySelectorAll('style[data-page-style]')).some((s) => (s.textContent ?? '').includes('.cs-sidebar')));
    check('Log out: goes to /login, session cleared', path(page) === '/login' && !session, `at ${path(page)}`);
    check('CSS isolation: no shell styles on the Log in page', !shellCss && (await page.locator('.cs-sidebar').count()) === 0);
    await ctx.close();
  }

  // ---------------------------------------------------------------- Home dashboard behaviour (was Stitch pixel states)
  {
    const { ctx, page } = await open(browser, 1440);
    await page.clock.install();
    await page.goto(`${BASE}/home`);
    await page.waitForSelector('.feature');
    const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.grid')!).gridTemplateColumns.split(' ').length);
    check('Home: same 6 cards, 3 columns on desktop', (await page.locator('.feature').count()) === 6 && cols === 3, `${cols} columns`);
    const toastText = async () => (await page.locator('.toast.show').textContent().catch(() => null))?.trim() ?? '';
    await page.click('[data-action="Quick View"]');
    await page.clock.runFor(300);
    const t1 = await toastText();
    await page.clock.runFor(1800);
    const gone = (await page.locator('.toast.show').count()) === 0;
    check('Home: Quick View shows its toast, which hides after ~1.8 s', t1.includes('Quick View') && gone, t1);
    await page.click('[data-action="Analytics dashboard"]');
    await page.clock.runFor(300);
    check('Home: Analytics dashboard still shows its toast', (await toastText()).includes('Analytics'));
    await page.click('[data-action="Notifications"]');
    await page.clock.runFor(300);
    check('Home: Notifications (now next to the heading) shows its toast', (await toastText()).includes('Notifications'));
    const before = await page.evaluate(() => getComputedStyle(document.querySelector('.feature:nth-child(2)')!).transform);
    await page.hover('.feature:nth-child(2)');
    await page.waitForTimeout(450); // CSS transition runs in real time, not on the fake clock
    const after = await page.evaluate(() => getComputedStyle(document.querySelector('.feature:nth-child(2)')!).transform);
    check('Home: card lifts on hover (same as Stitch)', before !== after && after.includes('-4'), `${before} → ${after}`);
    await page.focus('.feature:nth-child(1)');
    await page.keyboard.press('Tab');
    const focusRing = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement!);
      return `${document.activeElement?.className} ${s.outlineStyle} ${s.outlineWidth}`;
    });
    check('Home: keyboard focus ring on cards (3px)', focusRing.startsWith('feature') && focusRing.includes('solid 3px'), focusRing);
    const routes: [string, string][] = [['Update products', '/products'], ['Customer update', '/customers'], ['AI assistant', '/assistant'], ['Report an issue', '/report-issue']];
    const bad: string[] = [];
    for (const [label, to] of routes) {
      await page.goto(`${BASE}/home`);
      await page.click(`[data-action="${label}"]`);
      await page.waitForURL(`**${to}`, { timeout: 3000 }).catch(() => bad.push(label));
    }
    check('Home: cards open the same pages as before', bad.length === 0, bad.join(', '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- tablet icon rail
  {
    const { ctx, page } = await open(browser, 900);
    await page.goto(`${BASE}/products`);
    await page.waitForSelector('.cs-sidebar');
    const rail = await page.evaluate(() => Math.round(document.querySelector('.cs-sidebar')!.getBoundingClientRect().width));
    const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.cs-sidebar .cs-link-label')!).opacity);
    await page.focus('.cs-sidebar [data-menu="/products"]');
    await page.keyboard.press('Tab'); // keyboard-initiated focus on Customers → :focus-visible
    const shown = await page.evaluate(() => getComputedStyle(document.activeElement!.querySelector('.cs-link-label')!).opacity);
    check('Tablet: icon-only rail, label appears on keyboard focus', rail <= 80 && hidden === '0' && shown === '1', `rail ${rail}px, label ${hidden} → ${shown}`);
    await page.goto(`${BASE}/home`);
    await page.waitForSelector('.feature');
    const homeCols = await page.evaluate(() => getComputedStyle(document.querySelector('.grid')!).gridTemplateColumns.split(' ').length);
    check('Tablet: dashboard has 2 columns', homeCols === 2, `${homeCols}`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- mobile drawer
  {
    const { ctx, page } = await open(browser, 390);
    await page.goto(`${BASE}/home`);
    await page.waitForSelector('[data-testid="menu-button"]');
    check('Phone: sidebar hidden, ☰ button shown, drawer closed', !(await page.locator('.cs-sidebar').isVisible()) && (await page.locator('#cs-drawer').isHidden()));
    await page.click('[data-testid="menu-button"]');
    const expanded = await page.getAttribute('[data-testid="menu-button"]', 'aria-expanded');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('#cs-drawer'));
    const dialog = await page.evaluate(() => {
      const d = document.querySelector('#cs-drawer')!;
      return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true';
    });
    check('Drawer: ☰ opens it (aria-expanded), focus moves inside, role=dialog', expanded === 'true' && inside && dialog);
    let trapped = true;
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      if (!(await page.evaluate(() => !!document.activeElement?.closest('#cs-drawer')))) trapped = false;
    }
    check('Drawer: Tab keeps focus inside while open', trapped);
    await page.keyboard.press('Escape');
    const closedByEsc = await page.locator('#cs-drawer').isHidden();
    const focusBack = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    check('Drawer: Esc closes it and focus returns to ☰', closedByEsc && focusBack === 'menu-button', `focus on ${focusBack}`);
    await page.click('[data-testid="menu-button"]');
    await page.mouse.click(370, 450); // outside the 300px drawer
    check('Drawer: tapping outside closes it', await page.locator('#cs-drawer').isHidden());
    await page.click('[data-testid="menu-button"]');
    await page.click('#cs-drawer [data-menu="/reports"]');
    await page.waitForURL('**/reports');
    const active = await activeItems(page, '#cs-drawer');
    check('Drawer: choosing an item opens the page and closes the drawer', path(page) === '/reports' && (await page.locator('#cs-drawer').isHidden()), `active ${active.join(',') || '(drawer closed)'}`);
    await page.click('[data-testid="menu-button"]');
    check('Drawer: current page is marked aria-current', (await activeItems(page, '#cs-drawer')).join() === '/reports');
    await page.keyboard.press('Escape');
    await page.goto(`${BASE}/home`);
    const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.grid')!).gridTemplateColumns.split(' ').length);
    check('Phone: dashboard has 2 columns', cols === 2);
    await ctx.close();
  }

  // ---------------------------------------------------------------- no sideways scroll anywhere
  {
    const over: string[] = [];
    for (const width of [1440, 1024, 390]) {
      for (const route of ROUTES) {
        const { ctx, page } = await open(browser, width, !PUBLIC.has(route));
        await page.goto(BASE + route);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(150);
        const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (o > 0) over.push(`${route}@${width}: +${o}px`);
        await ctx.close();
      }
    }
    check('No page scrolls sideways at 1440 / 1024 / 390', over.length === 0, over.join(', '));
  }
}

async function main() {
  if (process.argv.includes('--build')) {
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_USE_MOCK_API: 'true' } });
  }
  await new Promise<void>((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  try {
    await run(browser);
  } catch (e) {
    check('Unexpected error', false, e instanceof Error ? e.message : String(e));
  } finally {
    await browser.close();
    server.close();
  }
  const issues = consoleIssues.filter((m) => !m.includes('Failed to load resource') && !m.includes('ERR_FAILED'));
  check('No console errors/warnings', issues.length === 0, issues.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
}

void main();
