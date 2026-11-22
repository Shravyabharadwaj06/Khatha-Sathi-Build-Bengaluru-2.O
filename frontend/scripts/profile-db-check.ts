/**
 * OPT-IN check that the Profile page reads and writes the DATABASE (not the browser), per account.
 * Writes only to the test account given in E2E_TEST_EMAIL (its voice volume); demo is only read.
 *   E2E_ALLOW_WRITES=1 E2E_BASE=http://localhost:5180 E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... npx tsx scripts/profile-db-check.ts
 */
import { chromium, type Page } from '@playwright/test';

if (process.env.E2E_ALLOW_WRITES !== '1') {
  console.error('Refusing to run: this writes to the live database. Set E2E_ALLOW_WRITES=1.');
  process.exit(2);
}
const BASE = (process.env.E2E_BASE ?? 'http://localhost:5180').replace(/\/$/, '');
const TEST = { email: process.env.E2E_TEST_EMAIL ?? '', password: process.env.E2E_TEST_PASSWORD ?? '' };
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.click('#tab-email');
  await page.fill('#identifier-input', email);
  await page.fill('#password-input', password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/home', { timeout: 20_000 });
}
const value = (page: Page, sel: string) => page.inputValue(sel);
async function openProfile(page: Page) {
  await page.goto(`${BASE}/profile`);
  await page.waitForLoadState('networkidle');
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // A stale, shared browser copy like the old code wrote (another account's details).
  await page.goto(`${BASE}/`);
  await page.evaluate(() =>
    localStorage.setItem('chotu.profile.settings', JSON.stringify({ shopName: 'SOMEONE ELSE SHOP', ownerName: 'Someone Else', gstNumber: 'LEAKED-GST' })),
  );

  await login(page, 'demo@chotu.shop', 'Demo@1234');
  await openProfile(page);
  check('Demo profile shows the shop name from the database', (await value(page, '#shop-name-input')) === 'Sri Lakshmi Kirana Stores', await value(page, '#shop-name-input'));
  check('Demo profile shows the GST number from the database', (await value(page, '#gst-input')) === '29ABCDE1234F1Z5', await value(page, '#gst-input'));
  check('The stale shared browser copy is ignored and deleted', (await page.evaluate(() => localStorage.getItem('chotu.profile.settings'))) === null);
  await page.goto(`${BASE}/logout`);
  await page.waitForURL('**/login');

  await login(page, TEST.email, TEST.password);
  await openProfile(page);
  const shop = await value(page, '#shop-name-input');
  check("Second account on the same browser sees only its own shop (not demo's)", shop !== 'Sri Lakshmi Kirana Stores' && shop !== 'SOMEONE ELSE SHOP', shop);
  check('No sample GST number is shown for an account without one', (await value(page, '#gst-input')) === '', await value(page, '#gst-input'));
  const volume = page.locator('input[type="range"]').first();
  const before = Number(await volume.inputValue());
  const target = before === 55 ? 65 : 55;
  await volume.fill(String(target));
  if (!(await value(page, '#address-input'))) await page.fill('#address-input', 'test data from the 22 Nov audit');
  await page.locator('button', { hasText: 'Save' }).last().click();
  await page.getByText('Settings saved successfully!').waitFor({ timeout: 15_000 }).catch(() => {});
  check('Save reports success', (await page.getByText('Settings saved successfully!').count()) > 0);
  await ctx.close();

  // Fresh browser (no localStorage at all): the saved value must come back from the database.
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  await login(page2, TEST.email, TEST.password);
  await openProfile(page2);
  const after = Number(await page2.locator('input[type="range"]').first().inputValue());
  check(`Voice volume ${target} is loaded back from the database in a fresh browser`, after === target, `${before} -> ${after}`);
  await page2.goto(`${BASE}/logout`);
  await ctx2.close();
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
