/**
 * Interaction + flow checks (run after `npm run build`):
 *   npx tsx scripts/interaction-check.ts
 *
 * Part A: drives the SAME interaction on the original Stitch page and on the app, then
 *         pixel-diffs the viewport (hover, focus ring, mobile menu, tab switch, password
 *         toggles, OTP send, "Other" domain, toasts, rotator after N ms via a fake clock).
 * Part B: app-only flows: protected-route redirect, validation errors, login (local vs
 *         session storage), sign up, logout, OTP countdown, unknown route, keyboard nav.
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const REF = join(ROOT, 'design-reference');
const OUT = join(ROOT, 'visual-diff', 'interactions');
const PORT = 4321;
const BASE = `http://localhost:${PORT}`;
const SESSION = JSON.stringify({ token: 't', user: { id: 'demo', name: 'Demo', email: 'demo@chotu.shop', phone: '9876543210', city: 'Bengaluru', businessDomain: 'Grocery' } });

async function isFile(p: string) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url ?? '/', BASE).pathname);
  let file = url.startsWith('/__ref/') ? normalize(join(REF, url.slice(7))) : normalize(join(DIST, url));
  if (!url.startsWith('/__ref/') && !(await isFile(file))) file = join(DIST, 'index.html');
  if (!(await isFile(file))) return void res.writeHead(404).end();
  let body: Buffer | string = await readFile(file);
  if (file.endsWith(join('home_page_files', 'home_page.html'))) body = body.toString().replace(/file:\/\/\/C:\/Users\/shrav\/[^"]*?Home%20page_files\/css2/, 'css2');
  const ext = extname(file);
  res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript' : ext === '.png' ? 'image/png' : ext === '.jpg' ? 'image/jpeg' : 'text/css' });
  res.end(body);
});

type Step = (page: Page) => Promise<void>;
interface StateCase {
  name: string;
  width: number;
  original: string;
  app: string;
  session?: boolean;
  /** advance the fake clock by this many ms after load (rotators). Default: clock paused at 0. */
  advance?: number;
  steps: Step[];
}

const click = (sel: string): Step => (p) => p.click(sel);
const hover = (sel: string): Step => (p) => p.hover(sel);
const type = (sel: string, text: string): Step => (p) => p.fill(sel, text);
const select = (sel: string, value: string): Step => async (p) => {
  await p.selectOption(sel, value);
};
const wait = (ms: number): Step => (p) => p.clock.runFor(ms);

const STATES: StateCase[] = [
  { name: 'landing-mobile-menu-open', width: 390, original: '/__ref/landing_page.html', app: '/', steps: [click('.menu-toggle')] },
  { name: 'landing-btn-hover', width: 1440, original: '/__ref/landing_page.html', app: '/', steps: [hover('.actions .btn'), wait(300)] },
  { name: 'login-email-tab', width: 1440, original: '/__ref/log_in.html', app: '/login', steps: [click('#tab-email'), wait(300)] },
  { name: 'login-email-then-phone-tab', width: 1440, original: '/__ref/log_in.html', app: '/login', steps: [click('#tab-email'), click('#tab-phone'), wait(300)] },
  { name: 'login-password-visible', width: 1440, original: '/__ref/log_in.html', app: '/login', steps: [type('#password-input', 'secret12'), click('#password-toggle-btn'), wait(300)] },
  { name: 'login-input-focus', width: 1440, original: '/__ref/log_in.html', app: '/login', steps: [click('#identifier-input'), wait(300)] },
  { name: 'login-submit-hover', width: 1440, original: '/__ref/log_in.html', app: '/login', steps: [hover('button[type=submit]'), wait(300)] },
  { name: 'login-rotator-1600ms', width: 1440, original: '/__ref/log_in.html', app: '/login', advance: 1600 + 300, steps: [] },
  { name: 'login-rotator-urdu-rtl', width: 1440, original: '/__ref/log_in.html', app: '/login', advance: 1300 * 6 + 300 + 300, steps: [] },
  { name: 'signup-rotator-1180ms', width: 1440, original: '/__ref/sign_up.html', app: '/signup', advance: 1180 + 300, steps: [] },
  { name: 'signup-rotator-urdu-rtl', width: 1440, original: '/__ref/sign_up.html', app: '/signup', advance: 6000 + 180 + 300, steps: [] },
  { name: 'signup-send-otp', width: 1440, original: '/__ref/sign_up.html', app: '/signup', steps: [type('#phone', '9876543210'), click('#send-otp-btn'), wait(300)] },
  { name: 'signup-otp-countdown-12s', width: 1440, original: '/__ref/sign_up.html', app: '/signup', steps: [type('#phone', '9876543210'), click('#send-otp-btn'), wait(12000)] },
  { name: 'signup-otp-countdown-done', width: 1440, original: '/__ref/sign_up.html', app: '/signup', steps: [type('#phone', '9876543210'), click('#send-otp-btn'), wait(31000)] },
  { name: 'signup-domain-other', width: 1440, original: '/__ref/sign_up.html', app: '/signup', steps: [select('#domain-select', 'Other'), wait(300)] },
  { name: 'signup-domain-other-mobile', width: 390, original: '/__ref/sign_up.html', app: '/signup', steps: [select('#domain-select', 'Other'), wait(300)] },
  { name: 'signup-password-toggles', width: 1440, original: '/__ref/sign_up.html', app: '/signup', steps: [type('#password', 'abcdefgh'), type('#confirm-password', 'abcdefgh'), click('#pwd-toggle-icon'), click('#confirm-pwd-toggle-icon'), wait(300)] },
  // The 4 Home pixel states (card hover, card toast, toast gone after 1.8 s, keyboard focus ring) compared Home with
  // the Stitch export. Home is now the dashboard inside the app shell, so the same behaviours are checked
  // without pixels in scripts/shell-check.ts.
];

async function capture(browser: Browser, c: StateCase, url: string) {
  const ctx = await browser.newContext({ viewport: { width: c.width, height: 900 } });
  if (c.session) await ctx.addInitScript((s) => localStorage.setItem('chotu.session', s), SESSION);
  const page = await ctx.newPage();
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto(BASE + url);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  if (c.advance) await page.clock.runFor(c.advance);
  for (const s of c.steps) await s(page);
  await page.waitForTimeout(150); // let layout/paint settle (real time; fake clock stays paused)
  const buf = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await ctx.close();
  return PNG.sync.read(buf);
}

async function partA(browser: Browser) {
  const rows: string[] = [];
  let bad = 0;
  for (const c of STATES) {
    const a = await capture(browser, c, c.original);
    const b = await capture(browser, c, c.app);
    const diff = new PNG({ width: a.width, height: a.height });
    const px = a.width === b.width && a.height === b.height ? pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 }) : -1;
    await writeFile(join(OUT, `${c.name}-original.png`), PNG.sync.write(a));
    await writeFile(join(OUT, `${c.name}-app.png`), PNG.sync.write(b));
    await writeFile(join(OUT, `${c.name}-diff.png`), PNG.sync.write(diff));
    const pct = px < 0 ? NaN : (px / (a.width * a.height)) * 100;
    if (!(pct <= 0.1)) bad++;
    rows.push(`| ${c.name} | ${c.width} | ${Number.isNaN(pct) ? 'size mismatch' : pct.toFixed(4)} |`);
    console.log(`${c.name.padEnd(30)} ${String(c.width).padStart(4)}px  ${Number.isNaN(pct) ? 'SIZE MISMATCH' : pct.toFixed(4) + '%'}`);
  }
  return { table: ['| Interaction state | Width | Diff % |', '|---|---:|---:|', ...rows].join('\n'), bad };
}

async function partB(browser: Browser) {
  const results: string[] = [];
  const check = (name: string, ok: boolean, detail = '') => {
    results.push(`- [${ok ? 'x' : ' '}] ${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const fresh = async (w = 1440) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page, errors };
  };
  const allErrors: string[] = [];
  const at = async (page: Page, path: string) => {
    await page.waitForURL((u) => u.pathname === path, { timeout: 3000 }).catch(() => {});
    return new URL(page.url()).pathname === path;
  };

  {
    // "My Profile" moved from Home's top bar into the app-shell menu (feature/ui-polish).
    const { ctx, page, errors } = await fresh(360);
    await ctx.addInitScript((s) => localStorage.setItem('chotu.session', s), SESSION);
    await page.goto(BASE + '/home');
    await page.click('[data-testid="menu-button"]');
    await page.click('#cs-drawer [data-menu="/profile"]');
    check('Home (360px): menu → Profile navigates to /profile', await at(page, '/profile'));
    allErrors.push(...errors);
    await ctx.close();
  }

  {
    const { ctx, page, errors } = await fresh();
    await page.goto(BASE + '/home');
    check('Protected route: /home without session redirects to /login', await at(page, '/login'));
    await page.goto(BASE + '/does-not-exist');
    check('Unknown route redirects to /', await at(page, '/'));
    await page.goto(BASE + '/login');
    await page.click('button[type=submit]');
    const hint = await page.textContent('#identifier-hint');
    const hintColor = await page.$eval('#identifier-hint', (e) => getComputedStyle(e).color);
    const pwdErr = await page.textContent('#password-error');
    check('Login: empty submit shows errors in error colour (#ba1a1a)', hintColor === 'rgb(186, 26, 26)' && !!pwdErr, `${hint?.trim()} / ${pwdErr}`);
    await page.fill('#identifier-input', '12345');
    await page.fill('#password-input', 'x');
    await page.click('button[type=submit]');
    check('Login: phone must be 10 digits', (await page.textContent('#identifier-hint'))!.includes('10-digit'));
    await page.fill('#identifier-input', '9876543210');
    await page.fill('#password-input', 'wrong');
    await page.click('button[type=submit]');
    await page.waitForSelector('#password-error');
    check('Login: wrong PIN rejected by mock API', new URL(page.url()).pathname === '/login', (await page.textContent('#password-error')) ?? '');
    await page.click('#tab-email');
    await page.fill('#identifier-input', 'not-an-email');
    await page.click('button[type=submit]');
    check('Login: email tab validates email format', (await page.textContent('#identifier-hint'))!.includes('valid email'));
    await page.click('text=Forgot PIN?');
    await page.waitForTimeout(300);
    const toastOpacity = await page.$eval('[role=status]', (e) => getComputedStyle(e).opacity);
    check('Login: "Forgot PIN?" shows a toast and stays on /login', toastOpacity === '1' && new URL(page.url()).pathname === '/login');
    await page.click('#tab-phone');
    await page.fill('#identifier-input', '98765 43210');
    await page.fill('#password-input', '123456');
    await page.click('button[type=submit]');
    await page.waitForURL('**/home');
    const inLocal = await page.evaluate(() => !!localStorage.getItem('chotu.session'));
    check('Login: demo account → /home, session in localStorage (Remember checked)', inLocal);
    await page.goto(BASE + '/login');
    check('Logged-in user visiting /login is sent to /home', await at(page, '/home'));
    await page.goto(BASE + '/logout');
    await page.waitForURL('**/login');
    const cleared = await page.evaluate(() => !localStorage.getItem('chotu.session') && !sessionStorage.getItem('chotu.session'));
    check('Logout (/logout) clears session and goes to /login', cleared);
    await page.goto(BASE + '/home');
    check('After logout /home redirects to /login again', await at(page, '/login'));
    // Remember unchecked → sessionStorage
    await page.uncheck('input[type=checkbox]');
    await page.fill('#identifier-input', '9876543210');
    await page.fill('#password-input', '123456');
    await page.click('button[type=submit]');
    await page.waitForURL('**/home');
    const inSession = await page.evaluate(() => !!sessionStorage.getItem('chotu.session') && !localStorage.getItem('chotu.session'));
    check('Login: Remember unchecked → session in sessionStorage only', inSession);
    allErrors.push(...errors);
    await ctx.close();
  }

  {
    const { ctx, page, errors } = await fresh();
    await page.clock.install({ time: 0 });
    await page.goto(BASE + '/signup');
    await page.click('button[type=submit]');
    const errIds = await page.$$eval('[role=alert]', (els) => els.map((e) => e.id));
    check('Sign up: empty submit flags every required field', ['email-error', 'owner-name-error', 'phone-error', 'otp-error', 'password-error', 'confirm-password-error', 'city-error', 'domain-select-error'].every((id) => errIds.includes(id)), errIds.join(', '));
    check('Sign up: focus moves to first invalid field', (await page.evaluate(() => document.activeElement?.id)) === 'email');
    await page.fill('#phone', '5123456789');
    await page.click('#send-otp-btn');
    check('Sign up: Send OTP rejects non 6–9 mobile', (await page.textContent('#send-otp-btn'))!.trim() === 'Send OTP' && !!(await page.textContent('#phone-error')));
    await page.fill('#phone', '9123456789');
    await page.click('#send-otp-btn');
    check('Sign up: Send OTP → "Sent ✓", timer "Resend in 30s", Resend disabled', (await page.textContent('#send-otp-btn'))!.trim() === 'Sent ✓' && (await page.textContent('#otp-timer'))!.trim() === 'Resend in 30s' && (await page.isDisabled('#resend-btn')));
    await page.clock.runFor(10000);
    check('Sign up: countdown after 10 s shows "Resend in 20s"', (await page.textContent('#otp-timer'))!.trim() === 'Resend in 20s');
    await page.clock.runFor(20000);
    check('Sign up: after 30 s → "Didn\'t receive code?" and Resend enabled', (await page.textContent('#otp-timer'))!.trim() === "Didn't receive code?" && !(await page.isDisabled('#resend-btn')));
    await page.click('#resend-btn');
    check('Sign up: Resend restarts the 30 s countdown', (await page.textContent('#otp-timer'))!.trim() === 'Resend in 30s' && (await page.isDisabled('#resend-btn')));
    await page.fill('#email', 'bad@');
    await page.fill('#owner-name', 'Ravi');
    await page.fill('#otp', '12a');
    await page.fill('#password', 'short');
    await page.fill('#confirm-password', 'different');
    await page.fill('#city', 'Bengaluru');
    await page.selectOption('#domain-select', 'Other');
    check('Sign up: "Other" reveals and focuses "Enter your domain"', (await page.isVisible('#custom-domain')) && (await page.evaluate(() => document.activeElement?.id)) === 'custom-domain');
    await page.click('button[type=submit]');
    const t = async (id: string) => (await page.textContent(`#${id}`)) ?? '';
    check('Sign up: email format / OTP 6 digits / password ≥ 8 / match / custom domain', (await t('email-error')).includes('valid') && (await t('otp-error')).includes('6') && (await t('password-error')).includes('8') && (await t('confirm-password-error')).includes('match') && (await t('custom-domain-error')).length > 0);
    await page.selectOption('#domain-select', 'Grocery');
    check('Sign up: choosing a normal domain hides the "Other" field again', !(await page.isVisible('#custom-domain')));
    await page.fill('#email', 'ravi@kirana.com');
    await page.fill('#otp', '123456');
    await page.fill('#password', 'password123');
    await page.fill('#confirm-password', 'password123');
    await page.click('button[type=submit]');
    await page.clock.runFor(2000);
    await page.waitForURL('**/home');
    check('Sign up: valid form → account created, session stored, /home', await page.evaluate(() => !!localStorage.getItem('chotu.session')));
    allErrors.push(...errors);
    await ctx.close();
  }

  {
    const { ctx, page, errors } = await fresh(390);
    await page.goto(BASE + '/');
    await page.click('.menu-toggle');
    const expanded = await page.getAttribute('.menu-toggle', 'aria-expanded');
    await page.click('.nav a:nth-child(3)');
    await page.waitForTimeout(800);
    const closed = !(await page.$eval('#nav', (e) => e.classList.contains('open')));
    const faqTop = await page.$eval('#faq', (e) => Math.round(e.getBoundingClientRect().top));
    const atBottom = await page.evaluate(() => Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) <= 2);
    check('Landing: ☰ opens menu (aria-expanded=true), FAQ link scrolls to #faq and closes menu', expanded === 'true' && closed && (Math.abs(faqTop) <= 2 || atBottom), `faq top=${faqTop}, scrolled to page end=${atBottom}`);
    await page.click('.actions a:first-child');
    check('Landing: header "Log in" → /login', new URL(page.url()).pathname === '/login');
    await page.click('text=Create an Account');
    check('Log in: "Create an Account" → /signup', new URL(page.url()).pathname === '/signup');
    await page.click('[data-path=login]');
    check('Sign up: "Sign in" → /login', new URL(page.url()).pathname === '/login');
    await page.click('text=Back to Home');
    check('Auth: "Back to Home" → /', new URL(page.url()).pathname === '/');
    await page.click('.footer-links a:first-child');
    check('Landing footer: Terms → /terms (legal page renders)', new URL(page.url()).pathname === '/terms' && (await page.textContent('h1')) === 'Terms and Conditions');
    await page.click('.footer-links a:nth-child(2)');
    check('Privacy → /privacy', new URL(page.url()).pathname === '/privacy' && (await page.textContent('h1')) === 'Privacy Policy');
    await page.click('.menu-toggle');
    await page.click('.nav a:nth-child(2)');
    await page.waitForTimeout(800);
    const helpTop = await page.$eval('#help', (e) => Math.round(e.getBoundingClientRect().top));
    check('Legal page nav "Features" → /#help and scrolls there', new URL(page.url()).pathname === '/' && Math.abs(helpTop) <= 2, `help top=${helpTop}`);
    // CSS isolation: after visiting auth pages, Landing has no Tailwind styles and no stray body classes.
    const leak = await page.evaluate(() => ({
      styles: Array.from(document.querySelectorAll('style[data-page-style]')).length,
      bodyClass: document.body.className,
      tw: Array.from(document.styleSheets).some((s) => {
        try {
          return Array.from(s.cssRules).some((r) => r.cssText.includes('--tw-'));
        } catch {
          return false;
        }
      }),
    }));
    check('CSS isolation: only Landing CSS present after visiting auth/legal routes', leak.styles === 1 && leak.bodyClass === '' && !leak.tw, JSON.stringify(leak));
    await page.goto(BASE + '/login');
    const icon = await page.$eval('.material-symbols-outlined', (e) => ({ w: e.getBoundingClientRect().width, font: getComputedStyle(e).fontFamily }));
    await page.evaluate(() => document.fonts.ready);
    const iconW = await page.$eval('.material-symbols-outlined', (e) => e.getBoundingClientRect().width);
    check('Material Symbols render as icons (glyph width ≈ font size, not text)', iconW <= 20 && icon.font.includes('Material Symbols'), `arrow_back width=${iconW}px`);
    // Keyboard: Tab through login reaches tabs, inputs, toggle, checkbox, links, submit.
    const order: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim().slice(0, 18) || document.activeElement?.tagName || ''));
    }
    check('Keyboard: Tab order on /login reaches every control', ['tab-phone', 'tab-email', 'identifier-input', 'password-input', 'password-toggle-btn', 'Forgot PIN?'].every((x) => order.includes(x)), order.join(' → '));
    await page.focus('#tab-email');
    await page.keyboard.press('Enter');
    check('Keyboard: Enter on "Email ID" tab switches method', (await page.textContent('#identifier-label'))!.trim() === 'Email Address');
    allErrors.push(...errors);
    await ctx.close();
  }

  {
    // Reduced motion: rotators must not start (same as originals).
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.clock.install({ time: 0 });
    await page.goto(BASE + '/login');
    await page.clock.runFor(5000);
    check('prefers-reduced-motion: Log in rotator does not run', (await page.textContent('#multilingual-text')) === 'Welcome');
    await ctx.close();
  }

  check('No console errors/warnings in the app during flows', allErrors.length === 0, allErrors.join(' | '));
  return results;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await new Promise<void>((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  try {
    const a = await partA(browser);
    const b = await partB(browser);
    await writeFile(join(OUT, 'report.md'), `# Interaction checks\n\n## A. Original vs app, same interaction\n\n${a.table}\n\n## B. App flows\n\n${b.join('\n')}\n`);
    console.log(`\n${a.table}`);
    if (a.bad || b.some((l) => l.startsWith('- [ ]'))) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
