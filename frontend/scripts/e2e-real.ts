/**
 * OPT-IN end-to-end walkthrough in a real browser against the REAL backend and the live Supabase database.
 * It WRITES data, so it only runs with E2E_ALLOW_WRITES=1. Every run signs up a NEW test account
 * (e2e.<timestamp>@chotu.shop, its own shop) and writes only there; the demo account is only read.
 * The ledger is append-only, so these test shops stay in the database: run it on a dev project.
 *
 *   # backend running (ASR/TTS mock = no Gnani credits), frontend dev server in real mode:
 *   VITE_USE_MOCK_API=false VITE_USE_MOCK_VOICE=false VITE_API_BASE_URL=http://localhost:8010 npx vite --port 5180
 *   E2E_ALLOW_WRITES=1 E2E_BASE=http://localhost:5180 E2E_OTP=<DEV_OTP_CODE> npx tsx scripts/e2e-real.ts
 *
 * Checks: sign up, products (+search), customers (+search by phone), history + payment (with Confirm),
 * voice bill -> Confirm -> DB, logout/login persistence, demo account reads, report an issue,
 * no console errors, no failed requests, no sideways scroll at 360/390/768/1024/1440 on every page.
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

if (process.env.E2E_ALLOW_WRITES !== '1') {
  console.error('Refusing to run: this writes to the live database. Set E2E_ALLOW_WRITES=1.');
  process.exit(2);
}
const BASE = (process.env.E2E_BASE ?? 'http://localhost:5180').replace(/\/$/, '');
const OTP = process.env.E2E_OTP ?? '';
const STAMP = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const USER = { email: `e2e.${STAMP}@chotu.shop`, phone: `9${STAMP.slice(-9)}`, password: 'E2e@Pass1234', name: 'E2E Tester' };
const CUSTOMER_PHONE = `8${STAMP.slice(-9)}`;
const OUT = resolve(import.meta.dirname, '..', '..', 'audit-evidence', 'e2e-real');
const WIDTHS = [360, 390, 768, 1024, 1440];

const results: { ok: boolean; name: string }[] = [];
const issues: string[] = [];
const aborted: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ ok, name });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function newPage(browser: Browser, width = 1440): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') issues.push(`console ${m.type()} @${new URL(page.url()).pathname}: ${m.text()}`);
  });
  page.on('pageerror', (e) => issues.push(`pageerror @${new URL(page.url()).pathname}: ${e.message}`));
  page.on('requestfailed', (r) => {
    // ERR_ABORTED = the browser cancelled an in-flight request because the test navigated away; not an app error.
    if (r.failure()?.errorText === 'net::ERR_ABORTED') aborted.push(`${r.method()} ${new URL(r.url()).pathname}`);
    else issues.push(`request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`);
  });
  page.on('response', (r) => {
    // 4xx/5xx from the API are only OK where a test provokes them on purpose (none do through the UI below).
    if (r.status() >= 400 && /:\d{4}\//.test(r.url()) && !r.url().startsWith(BASE)) issues.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  return { ctx, page };
}

const textOf = async (page: Page, selector: string) =>
  ((await page.locator(selector).first().textContent({ timeout: 5_000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();

async function say(page: Page, text: string) {
  if (!(await page.locator('[data-testid="text-input"]').isVisible())) await page.click('[data-testid="toggle-text"]');
  await page.fill('[data-testid="text-input"]', text);
  await page.click('[data-testid="text-send"]');
  await page.waitForTimeout(100);
  await page.waitForFunction(() => !/thinking|Saving|Listening/.test(document.querySelector('[data-testid="status"]')?.textContent ?? ''), undefined, { timeout: 20_000 });
}

/** Waits (max 5 s) for a search result to show; the check after it still decides pass/fail. */
const settled = (expected: ReturnType<Page['locator']>) => expected.first().waitFor({ timeout: 5_000 }).catch(() => {});

async function login(page: Page, method: 'phone' | 'email', identifier: string, password: string) {
  await page.goto(`${BASE}/login`);
  if (method === 'email') await page.click('#tab-email');
  await page.fill('#identifier-input', identifier);
  await page.fill('#password-input', password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/home', { timeout: 20_000 });
}

async function logout(page: Page) {
  await page.goto(`${BASE}/logout`);
  await page.waitForURL('**/login', { timeout: 20_000 });
}

async function noSidewaysScroll(browser: Browser, routes: string[], session: string | null) {
  const wide: string[] = [];
  for (const width of WIDTHS) {
    const { ctx, page } = await newPage(browser, width);
    if (session) await ctx.addInitScript((s) => localStorage.getItem('chotu.session') ?? localStorage.setItem('chotu.session', s), session);
    for (const route of routes) {
      await page.goto(`${BASE}${route}`);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) wide.push(`${route}@${width}: +${overflow}px`);
      await page.screenshot({ path: join(OUT, `${route.replace(/\W+/g, '_') || 'root'}-${width}.png`), fullPage: true });
    }
    await ctx.close();
  }
  return wide;
}

async function run(browser: Browser) {
  await mkdir(OUT, { recursive: true });
  const { ctx, page } = await newPage(browser);

  // ------------------------------------------------------------ 1-3. open site, sign up, dashboard
  await page.goto(`${BASE}/`);
  check('Landing page opens', (await page.title()).length > 0);
  await page.goto(`${BASE}/signup`);
  await page.fill('#email', USER.email);
  await page.fill('#owner-name', USER.name);
  await page.fill('#phone', USER.phone);
  await page.click('#send-otp-btn');
  await page.waitForTimeout(800);
  await page.fill('#otp', OTP);
  await page.fill('#password', USER.password);
  await page.fill('#confirm-password', USER.password);
  await page.fill('#city', 'Bengaluru');
  await page.selectOption('#domain-select', 'Grocery');
  await page.click('#signup-form button[type=submit]');
  await page.waitForURL('**/home', { timeout: 30_000 }).catch(() => {});
  check('Sign up (real OTP flow, dev code) lands on /home', new URL(page.url()).pathname === '/home', new URL(page.url()).pathname);

  // ------------------------------------------------------------ 4-5. products + search
  await page.click('[data-action="Update products"]');
  await page.waitForURL('**/products');
  await page.locator('input[name="name"]').fill('Tata Salt 1kg');
  await page.locator('input[name="selling_price"]').fill('28');
  await page.locator('input[name="stock_quantity"]').fill('10');
  await page.locator('input[name="unit"]').fill('packet');
  await page.locator('form button[type=submit]').click();
  await page.locator('.management-table td', { hasText: 'Tata Salt 1kg' }).first().waitFor({ timeout: 15_000 });
  check('Add product → appears in the list', true);
  // (Aliases such as "namak" exist only on seeded products: the product form has no alias field.)
  await page.fill('#product-search', 'salt');
  await settled(page.locator('.management-table tbody tr', { hasText: 'Tata Salt 1kg' }));
  check('Product search "salt" finds Tata Salt', (await page.locator('.management-table tbody tr', { hasText: 'Tata Salt 1kg' }).count()) === 1);
  await page.fill('#product-search', '');

  // ------------------------------------------------------------ customers + search by phone
  await page.click('.cs-sidebar [data-menu="/customers"]');
  await page.waitForURL('**/customers');
  await page.fill('#customer-name', 'Ramesh');
  await page.fill('#customer-phone', CUSTOMER_PHONE);
  await page.fill('#customer-opening-balance', '100');
  await page.locator('form button[type=submit]').click();
  await page.locator('.management-table td', { hasText: 'Ramesh' }).first().waitFor({ timeout: 15_000 });
  check('Add customer Ramesh with opening balance ₹100', (await textOf(page, '.management-table tbody tr td[data-label="Due"]')) === '₹100');
  await page.fill('#customer-search', CUSTOMER_PHONE.slice(-5));
  await settled(page.locator('.management-table tbody tr', { hasText: 'Ramesh' }));
  check('Customer search by last 5 phone digits finds Ramesh', (await page.locator('.management-table tbody tr', { hasText: 'Ramesh' }).count()) === 1);
  await page.fill('#customer-search', 'zzzz-no-match');
  await settled(page.locator('.management-table-empty'));
  check('Customer search with no match shows an empty state', (await page.locator('.management-table-empty').count()) === 1);
  await page.fill('#customer-search', '');

  // ------------------------------------------------------------ 6/10/11. voice bill -> Confirm -> DB
  await page.click('.cs-sidebar [data-menu="/assistant"]');
  await page.waitForURL('**/assistant');
  await say(page, 'Ramesh ko 2 Tata Salt udhaar');
  const draftTotal = await textOf(page, '[data-testid="draft-total"]');
  check('Assistant: "Ramesh ko 2 Tata Salt udhaar" → draft ₹56', draftTotal === '₹56', draftTotal);
  await page.locator('[data-testid="confirm"]').last().click();
  await page.waitForSelector('[data-testid="card-saved"]', { timeout: 20_000 });
  check('Assistant: Confirm → Saved', true, await textOf(page, '[data-testid="card-saved"]'));
  const draftsBefore = await page.locator('[data-testid="card-draft"]').count();
  await say(page, 'Ramesh ko 500 rupaye udhaar diya');
  const feedTail = await textOf(page, '[data-testid="card-error-NOT_UNDERSTOOD"] >> nth=-1');
  check('Assistant: "Ramesh ko 500 rupaye udhaar diya" is NOT a payment draft (explains udhaar needs items)',
    (await page.locator('[data-testid="card-draft"]').count()) === draftsBefore && /Tata Salt|Saaman/.test(feedTail), feedTail.slice(0, 120));

  // ------------------------------------------------------------ 7-9. history, items, payment with Confirm
  await page.click('.cs-sidebar [data-menu="/customers"]');
  await page.locator('a', { hasText: 'History' }).first().click();
  await page.waitForURL('**/customers/*');
  await page.locator('.management-balance', { hasText: '₹' }).waitFor();
  check('History: balance ₹156 (100 opening + 56 voice bill)', (await textOf(page, '.management-balance')) === '₹156', await textOf(page, '.management-balance'));
  check('Customers menu item stays active on the history page', (await page.locator('.cs-sidebar [data-menu="/customers"][aria-current="page"]').count()) === 1);
  check('History lists the bill and the opening balance', (await page.locator('.management-table-history tbody tr').count()) === 2);
  await page.locator('button', { hasText: 'Items' }).first().click();
  await page.locator('.management-history-items li').first().waitFor();
  check('History: bill items shown', (await textOf(page, '.management-history-items')).includes('2 × Tata Salt 1kg'), await textOf(page, '.management-history-items'));
  await page.fill('#payment-amount', '1000');
  await page.click('button:has-text("Record payment")');
  check('Payment over the due is refused before saving', (await textOf(page, '.management-notice-error')).includes('more than the due'));
  await page.fill('#payment-amount', '60');
  await page.click('button:has-text("Record payment")');
  check('Payment asks for Confirm before saving', (await page.locator('button:has-text("Confirm ₹60 cash")').count()) === 1);
  check('…and the balance has not changed yet', (await textOf(page, '.management-balance')) === '₹156');
  await page.click('button:has-text("Confirm ₹60 cash")');
  await page.locator('.management-balance', { hasText: '₹96' }).waitFor({ timeout: 15_000 });
  check('Payment ₹60 confirmed → balance ₹96', true);
  check('History now has 3 entries', (await page.locator('.management-table-history tbody tr').count()) === 3);
  const historyUrl = page.url();

  // ------------------------------------------------------------ report an issue + my reports
  await page.click('.cs-sidebar [data-menu="/report-issue"]');
  await page.fill('#issue-description', `E2E TEST report ${STAMP}: please ignore.`);
  await page.locator('button[type=submit]').click();
  await page.waitForURL('**/report-sent', { timeout: 20_000 }).catch(() => {});
  check('Report an issue → /report-sent', new URL(page.url()).pathname === '/report-sent');
  await page.click('.cs-sidebar [data-menu="/reports"]');
  await page.getByText(`E2E TEST report ${STAMP}`).first().waitFor({ timeout: 15_000 }).catch(() => {});
  check('My reports lists the new report', (await page.getByText(`E2E TEST report ${STAMP}`).count()) > 0);
  await page.click('.cs-sidebar [data-menu="/profile"]');
  await page.waitForTimeout(1500);
  check('Profile loads the signed-up owner', (await page.locator(`input[value="${USER.name}"]`).count()) > 0 || (await page.getByText(USER.name).count()) > 0);

  // ------------------------------------------------------------ 13-14. logout, login (phone), persisted
  await logout(page);
  await login(page, 'phone', USER.phone, USER.password);
  await page.goto(historyUrl);
  await page.locator('.management-balance', { hasText: '₹96' }).waitFor({ timeout: 15_000 }).catch(() => {});
  check('After logout + login: balance still ₹96, 3 entries', (await textOf(page, '.management-balance')) === '₹96' && (await page.locator('.management-table-history tbody tr').count()) === 3);
  await logout(page);

  // ------------------------------------------------------------ demo account (read-only)
  await login(page, 'phone', '9876543210', 'Demo@1234');
  const session = await page.evaluate(() => localStorage.getItem('chotu.session'));
  await page.click('.cs-sidebar [data-menu="/customers"]');
  await page.locator('.management-table tbody tr').nth(10).waitFor({ timeout: 15_000 });
  check('Demo: 11 customers load from the database', (await page.locator('.management-table tbody tr').count()) === 11);
  await page.fill('#customer-search', 'ravi');
  await settled(page.locator('.management-table tbody tr', { hasText: 'Ravi' }).nth(1));
  check('Demo: search "ravi" finds both Ravis', (await page.locator('.management-table tbody tr', { hasText: 'Ravi' }).count()) === 2);
  await page.fill('#customer-search', 'ramesh');
  await settled(page.locator('tr', { hasText: 'Ramesh' }));
  await page.locator('tr', { hasText: 'Ramesh' }).locator('a', { hasText: 'History' }).click();
  await page.locator('.management-balance', { hasText: '₹840' }).waitFor({ timeout: 15_000 }).catch(() => {});
  check('Demo: Ramesh history shows ₹840 and 3 entries', (await textOf(page, '.management-balance')) === '₹840' && (await page.locator('.management-table-history tbody tr').count()) === 3);
  const demoRameshUrl = new URL(page.url()).pathname;
  await page.click('.cs-sidebar [data-menu="/assistant"]');
  await say(page, 'Ramesh ka balance kitna hai?');
  check('Demo: assistant answers Ramesh = ₹840 from the database', (await page.locator('.va-feed').textContent())?.includes('₹840') ?? false);
  await page.click('.cs-sidebar [data-menu="/products"]');
  await page.locator('.management-table tbody tr').first().waitFor({ timeout: 15_000 });
  check('Demo: products load', (await page.locator('.management-table tbody tr').count()) > 10);
  await logout(page);
  await ctx.close();

  // ------------------------------------------------------------ responsive: every page, 5 widths
  const publicWide = await noSidewaysScroll(browser, ['/', '/login', '/signup', '/terms', '/privacy'], null);
  const appWide = await noSidewaysScroll(browser, ['/home', '/assistant', '/products', '/customers', demoRameshUrl, '/profile', '/report-issue', '/reports'], session);
  check('No page scrolls sideways at 360/390/768/1024/1440 (13 pages)', publicWide.length + appWide.length === 0, [...publicWide, ...appWide].join(', '));

  check('No console errors/warnings, no failed or 4xx/5xx API requests', issues.length === 0, issues.slice(0, 8).join(' | '));
  console.log(`      (info) ${aborted.length} requests cancelled by test navigation (net::ERR_ABORTED)`);
}

const browser = await chromium.launch();
try {
  await run(browser);
} catch (error) {
  check('walkthrough finished without an exception', false, String(error).split('\n')[0]);
} finally {
  await browser.close();
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed  (test account: ${USER.email})`);
process.exit(passed === results.length ? 0 : 1);
