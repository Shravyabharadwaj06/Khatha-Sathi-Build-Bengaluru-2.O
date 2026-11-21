/**
 * AI Assistant (/assistant) checks, in MOCK mode (no backend, no Gnani credits):
 *   npm run test:assistant          (builds with VITE_USE_MOCK_API=true, then runs this)
 *   npx tsx scripts/assistant-check.ts   (re-use the existing dist/ build)
 *
 * Uses Chromium's fake microphone (--use-fake-device-for-media-stream) for the recorder test
 * and Playwright's fake clock for the 15-second auto-stop. Screenshots go to visual-diff/assistant/.
 */
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'visual-diff', 'assistant');
const PORT = 4331;
const BASE = `http://localhost:${PORT}`;
const SESSION = JSON.stringify({ token: 't', user: { id: 'demo', name: 'Demo', email: 'demo@chotu.shop', phone: '9876543210', city: 'Bengaluru', businessDomain: 'Grocery' } });
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

const results: { name: string; ok: boolean; detail: string }[] = [];
const consoleIssues: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function open(browser: Browser, opts: { width?: number; micIntroSeen?: boolean; storage?: Record<string, string> } = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 390, height: 844 }, permissions: ['microphone'], reducedMotion: 'reduce' });
  await ctx.addInitScript(
    ([session, seen, extra]) => {
      localStorage.setItem('chotu.session', session as string);
      if (seen) localStorage.setItem('chotu.voice.micIntroSeen', '1');
      for (const [k, v] of Object.entries(extra as Record<string, string>)) localStorage.setItem(k, v);
      // No real speech output during tests.
      if ('speechSynthesis' in window) window.speechSynthesis.speak = () => {};
    },
    [SESSION, !!opts.micIntroSeen, opts.storage ?? {}] as const,
  );
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleIssues.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleIssues.push(`pageerror: ${e.message}`));
  return { ctx, page };
}

async function goto(page: Page) {
  await page.goto(`${BASE}/assistant`);
  await page.waitForSelector('[data-testid="mic"]');
}

async function idle(page: Page) {
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-testid="status"]')?.textContent ?? '';
    return !/thinking|Saving|Listening/.test(s);
  }, undefined, { timeout: 10_000 });
}

async function say(page: Page, text: string) {
  if (!(await page.locator('[data-testid="text-input"]').isVisible())) await page.click('[data-testid="toggle-text"]');
  await page.fill('[data-testid="text-input"]', text);
  await page.click('[data-testid="text-send"]');
  await page.waitForTimeout(50);
  await idle(page);
}

const last = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]`).last();
const text = async (page: Page, testId: string) => ((await last(page, testId).textContent()) ?? '').replace(/\s+/g, ' ').trim();

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false, animations: 'disabled', caret: 'hide' });
}

async function run(browser: Browser) {
  // 1) Bill → clarify → choose → confirm → saved → undo → confirm reversal
  {
    const { ctx, page } = await open(browser);
    await goto(page);
    await shot(page, '01-empty-390');
    await say(page, 'Ravi ge 2 milk add maadu');
    const options = await page.locator('[data-testid="card-clarify"] .va-option').allTextContents();
    check('Bill: "Ravi ge 2 milk add maadu" asks which Ravi', options.length === 2 && options.some((o) => o.includes('Gandhi Nagar')) && options.some((o) => o.includes('Rice, yesterday')), options.join(' | '));
    check('Bill: "I heard" card shows the transcript', (await text(page, 'card-heard')).includes('Ravi ge 2 milk add maadu'));
    await shot(page, '02-clarify-390');
    await page.locator('[data-testid="card-clarify"] .va-option', { hasText: 'Gandhi Nagar' }).click();
    await idle(page);
    const cust = await text(page, 'draft-customer');
    const total = await text(page, 'draft-total');
    const mode = await text(page, 'mode-chip');
    check('Bill: draft for Ravi · Gandhi Nagar, 2 milk = ₹54 udhaar', cust.includes('Ravi · Gandhi Nagar') && total === '₹54' && mode.startsWith('Udhaar'), `${cust} / ${total} / ${mode}`);
    check('Bill: draft shows an expiry countdown', /\d:\d\d/.test(await text(page, 'draft-expiry')));
    await shot(page, '03-draft-390');
    await last(page, 'confirm').click();
    await idle(page);
    check('Bill: Confirm → Saved card', (await page.locator('[data-testid="card-saved"]').count()) === 1, await text(page, 'card-saved'));
    await shot(page, '04-saved-390');
    await last(page, 'undo').click();
    await idle(page);
    const undoCard = await text(page, 'card-draft');
    check('Undo: shows a reversal draft (not a delete) that needs Confirm', undoCard.includes('Undo (reversal)') && undoCard.includes('₹54') && undoCard.includes('reversal entry'), undoCard.slice(0, 120));
    await shot(page, '05-undo-draft-390');
    await last(page, 'confirm').click();
    await idle(page);
    check('Undo: confirm reversal → second Saved card, first one marked Reversed', (await page.locator('[data-testid="card-saved"]').count()) === 2 && (await page.locator('[data-testid="reversed"]').count()) === 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('Layout: no horizontal scroll at 390px', overflow <= 0, `overflow ${overflow}px`);
    const squashed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.va-feed > *')).filter((el) => el.scrollHeight > el.clientHeight + 1).length,
    );
    check('Layout: no card is cut off (feed scrolls instead)', squashed === 0, `${squashed} squashed`);
    const target = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.va button, .va a')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 44 && !el.classList.contains('va-link');
      }).length,
    );
    check('Accessibility: buttons are at least 44-48px tall', target === 0, `${target} too small`);
    await ctx.close();
  }

  // 2) Correction + follow-up item
  {
    const { ctx, page } = await open(browser);
    await goto(page);
    await say(page, 'Ravi ge 2 milk add maadu');
    await page.locator('[data-testid="card-clarify"] .va-option', { hasText: 'Gandhi Nagar' }).click();
    await idle(page);
    await say(page, 'Ravi alla, Ramesh');
    const cust = await text(page, 'draft-customer');
    const changes = await text(page, 'draft-changes');
    const oldState = await page.locator('[data-testid="draft-state"]').first().textContent();
    check('"Ravi alla, Ramesh": same bill, customer changed to Ramesh', cust.includes('Ramesh') && changes.includes('Ravi → Ramesh') && (oldState ?? '').includes('Updated below'), `${cust} / ${changes}`);
    await say(page, 'aur ek bread');
    check('"aur ek bread": item added, total ₹99', (await text(page, 'draft-total')) === '₹99', await text(page, 'draft-changes'));
    await shot(page, '06-correction-390');
    await last(page, 'cancel').click();
    await page.waitForSelector('[data-testid="card-cancelled"]', { timeout: 5000 }).catch(() => {});
    check('Cancel: nothing saved, Cancelled card shown', (await page.locator('[data-testid="card-cancelled"]').count()) === 1 && (await page.locator('[data-testid="card-saved"]').count()) === 0);
    await ctx.close();
  }

  // 3) Balance + explain (₹840 = 562 + 478 − 200)
  {
    const { ctx, page } = await open(browser);
    await goto(page);
    await say(page, 'Ramesh ka kitna baaki hai?');
    check('"Ramesh ka kitna baaki hai?" shows ₹840', (await text(page, 'balance-amount')) === '₹840', await text(page, 'balance-amount'));
    await say(page, 'Ramesh ka hisaab samjhao');
    const sum = await text(page, 'explain-sum');
    check('Explain shows ₹562 + ₹478 − ₹200 = ₹840', sum === '₹562 + ₹478 − ₹200 = ₹840', sum);
    check('Explain total matches the balance', (await text(page, 'card-explain')).includes('Matches the balance'));
    await say(page, 'Ramesh ki history dikhao');
    const history = await text(page, 'card-history');
    check('History timeline ends at ₹840 (running balance)', /bal ₹840\s*Balance now\s*₹840$/.test(history), history.slice(-60));
    await shot(page, '07-balance-explain-390');
    await ctx.close();
  }

  // 4) Reminder soft → firm, WhatsApp link
  {
    const { ctx, page } = await open(browser);
    await goto(page);
    await say(page, 'Ramesh ko reminder bhejo');
    const href = async () => (await last(page, 'whatsapp').getAttribute('href')) ?? '';
    const decoded = async () => decodeURIComponent((await href()).split('?text=')[1] ?? '');
    const softText = await text(page, 'reminder-text');
    check('Reminder: soft message with ₹840, WhatsApp link to 91 + Ramesh’s number',
      softText.includes('₹840') && softText.includes('Jab ho sake') && (await href()).startsWith('https://wa.me/919886054321?text=') && (await decoded()) === softText, softText);
    await last(page, 'tone-firm').click();
    const firmText = await text(page, 'reminder-text');
    check('Reminder: Firm switches text and link', firmText.includes('is hafte') && (await decoded()) === firmText && (await last(page, 'tone-firm').getAttribute('aria-pressed')) === 'true', firmText);
    check('Reminder: link opens WhatsApp in a new tab, nothing sent automatically', (await last(page, 'whatsapp').getAttribute('target')) === '_blank' && (await text(page, 'card-reminder')).includes('Nothing is sent automatically'));
    await shot(page, '08-reminder-390');
    await ctx.close();
  }

  // 5) Add product without a price
  {
    const { ctx, page } = await open(browser);
    await goto(page);
    await say(page, 'Add Tata Salt 1 kg');
    const price = await text(page, 'product-price');
    const warn = await text(page, 'draft-warnings');
    check('"Add Tata Salt 1 kg": product draft with price Not set + warning', price === 'Not set' && warn.includes('Price not set'), `${price} / ${warn}`);
    await last(page, 'confirm').click();
    await idle(page);
    check('Add product: confirm → Saved (price not set)', (await text(page, 'card-saved')).includes('price not set'));
    await shot(page, '09-product-390');
    await ctx.close();
  }

  // 6) Error cards
  {
    const { ctx, page } = await open(browser);
    await goto(page);
    await say(page, 'test busy');
    const busy = await text(page, 'card-error-GNANI_BUSY');
    check('Error: Gnani busy → "Chotu is busy, try again in a second" + Try again', busy.includes('Chotu is busy, try again in a second') && (await page.locator('[data-testid="card-error-GNANI_BUSY"] [data-testid="retry"]').count()) === 1, busy);
    await say(page, 'test limit');
    const limit = await text(page, 'card-error-DAILY_LIMIT_REACHED');
    check('Error: daily limit → message + Type instead (and browser voice if supported)', limit.includes("Today's voice limit is reached") && (await page.locator('[data-testid="card-error-DAILY_LIMIT_REACHED"] [data-testid="type-instead"]').count()) === 1, limit);
    await say(page, 'kuch bhi');
    check('Error: not understood → example chips', (await page.locator('[data-testid="card-error-NOT_UNDERSTOOD"] .va-chip-btn').count()) === 3);
    await shot(page, '10-errors-390');
    await ctx.close();
  }

  // 7) Recorder: mic intro, 15 s countdown and auto-stop (fake mic + fake clock)
  {
    const { ctx, page } = await open(browser);
    await page.clock.install();
    await goto(page);
    await page.keyboard.press('Space');
    check('Keyboard: Space opens the mic (first time: permission explainer)', await page.locator('[data-testid="mic-intro"]').isVisible());
    check('Mic intro has the privacy note', ((await page.locator('[data-testid="mic-intro"]').textContent()) ?? '').includes('not stored'));
    await shot(page, '11-mic-intro-390');
    await page.click('[data-testid="allow-mic"]');
    await page.waitForSelector('[data-testid="countdown"]');
    await page.waitForTimeout(1500); // record ~1.5 s of real (fake-device) audio
    const before = await text(page, 'countdown');
    await shot(page, '12-recording-390');
    await page.clock.runFor(9_000);
    const mid = await text(page, 'countdown');
    check('Recorder: countdown runs (0:15 → 0:0x)', /^0:1[3-5]$/.test(before) && /^0:0[3-6]$/.test(mid), `${before} → ${mid}`);
    await page.clock.runFor(7_000);
    await page.waitForSelector('[data-testid="card-heard"]', { timeout: 10_000 });
    await idle(page);
    const errors = await page.locator('[data-testid^="card-error"]').count();
    check('Recorder: auto-stops at 15 s, WAV accepted, request answered', errors === 0 && (await page.locator('[data-testid="countdown"]').count()) === 0 && (await text(page, 'balance-amount')) === '₹840', `errors ${errors}`);
    await ctx.close();
  }

  // 8) Language + mute remembered; Kannada reply
  {
    const { ctx, page } = await open(browser);
    await goto(page);
    await page.selectOption('[data-testid="language"]', 'kn-IN');
    await page.click('[data-testid="mute"]');
    await page.reload();
    await page.waitForSelector('[data-testid="mic"]');
    check('Language and mute are remembered', (await page.inputValue('[data-testid="language"]')) === 'kn-IN' && (await page.getAttribute('[data-testid="mute"]', 'aria-pressed')) === 'true');
    await say(page, 'Ramesh ka kitna baaki hai?');
    check('Kannada selected → balance still ₹840', (await text(page, 'balance-amount')) === '₹840');
    await ctx.close();
  }

  // 9) Wiring: Home card → /assistant, CSS does not leak back to Home
  {
    const { ctx, page } = await open(browser, { width: 1440 });
    await page.goto(`${BASE}/home`);
    await page.click('[data-action="AI assistant"]');
    await page.waitForURL('**/assistant');
    check('Home "AI assistant" card opens /assistant', new URL(page.url()).pathname === '/assistant');
    await shot(page, '13-desktop-1440');
    await page.click('[aria-label="Back to home"]');
    await page.waitForURL('**/home');
    const leaked = await page.evaluate(() => Array.from(document.querySelectorAll('style[data-page-style]')).some((s) => (s.textContent ?? '').includes('.va-dock')));
    check('CSS isolation: assistant styles removed after leaving', !leaked);
    await ctx.close();
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto(`${BASE}/assistant`);
    await guestPage.waitForURL('**/login', { timeout: 5000 }).catch(() => {});
    check('/assistant is protected (redirects to /login without a session)', new URL(guestPage.url()).pathname === '/login');
    await guest.close();
  }
}

async function main() {
  if (process.argv.includes('--build')) {
    // Always test the MOCK build, whatever the local .env says (real env vars beat .env files in Vite).
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_USE_MOCK_API: 'true', VITE_VOICE_INPUT: 'gnani' } });
  }
  await mkdir(OUT, { recursive: true });
  await new Promise<void>((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    await run(browser);
  } catch (e) {
    check('Unexpected error', false, e instanceof Error ? e.message : String(e));
  } finally {
    await browser.close();
    server.close();
  }
  const issues = consoleIssues.filter((m) => !m.includes('Failed to load resource'));
  check('No console errors/warnings', issues.length === 0, issues.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

void main();
