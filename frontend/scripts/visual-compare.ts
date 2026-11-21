/**
 * Pixel comparison: original Stitch HTML (design-reference/) vs the built app (dist/).
 *
 *   npm run visual:compare            # builds, then compares
 *   npx tsx scripts/visual-compare.ts # compare the existing dist/
 *
 * One local HTTP server serves both:
 *   /__ref/...  -> design-reference/ (the untouched Stitch exports)
 *   /...        -> dist/ with SPA fallback
 * Output: visual-diff/<page>-<width>-{original,app,diff}.png and visual-diff/report.md
 *
 * Freezing: setInterval is stubbed on BOTH sides before any page script runs, so the
 * welcome rotators stay on their initial state; CSS animations are disabled by Playwright.
 * Fonts: waits for document.fonts.ready + every image to be decoded.
 * Only fix applied to an original: home_page.html links its font CSS through an absolute
 * file:///C:/Users/shrav/... path that only existed on the designer's machine; the server
 * rewrites that one URL to the sibling `css2` file, which is what the designer saw.
 */
import { createServer, type Server } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const REF = join(ROOT, 'design-reference');
const OUT = join(ROOT, 'visual-diff');
const PORT = 4319;
const BASE = `http://localhost:${PORT}`;
const WIDTHS = [1440, 1024, 768, 390, 360];
const HEIGHT = 900;
const FAIL_ABOVE = 0.1; // percent

const PAGES: { name: string; original: string; app: string; session?: boolean }[] = [
  { name: 'landing', original: '/__ref/landing_page.html', app: '/' },
  { name: 'login', original: '/__ref/log_in.html', app: '/login' },
  { name: 'signup', original: '/__ref/sign_up.html', app: '/signup' },
  // Home is no longer a pixel copy of the Stitch export: since feature/ui-polish it is the dashboard inside the
  // app shell (approved). Its behaviour (cards, toasts, focus ring) is checked in scripts/shell-check.ts.
];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '': 'text/css', // the exported "css2" font files have no extension
};

async function exists(p: string) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

function startServer(): Promise<Server> {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url ?? '/', BASE).pathname);
    let file: string;
    if (url.startsWith('/__ref/')) {
      file = normalize(join(REF, url.slice('/__ref/'.length)));
      if (!file.startsWith(REF)) return void res.writeHead(403).end();
    } else {
      file = normalize(join(DIST, url));
      if (!file.startsWith(DIST) || !(await exists(file))) file = join(DIST, 'index.html');
    }
    if (!(await exists(file))) return void res.writeHead(404).end();
    let body: Buffer | string = await readFile(file);
    if (file.endsWith(join('home_page_files', 'home_page.html'))) {
      body = body.toString('utf8').replace(/file:\/\/\/C:\/Users\/shrav\/[^"]*?Home%20page_files\/css2/, 'css2');
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  // Trigger lazy images, then return to top.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) => (img.complete ? img.decode().catch(() => {}) : new Promise((r) => img.addEventListener('load', r, { once: true })))),
    );
  });
  await page.waitForTimeout(400);
}

async function shoot(page: Page, url: string, file: string) {
  await page.goto(BASE + url);
  await settle(page);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' });
  return PNG.sync.read(await readFile(file));
}

function pad(img: PNG, w: number, h: number): PNG {
  if (img.width === w && img.height === h) return img;
  const out = new PNG({ width: w, height: h });
  out.data.fill(255);
  PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  const rows: { page: string; width: number; diff: number; size: string; pixels: number; exact: number }[] = [];
  const consoleIssues: string[] = [];

  try {
    for (const p of PAGES) {
      for (const width of WIDTHS) {
        const ctx = await browser.newContext({ viewport: { width, height: HEIGHT }, deviceScaleFactor: 1 });
        await ctx.addInitScript(() => {
          // Freeze rotators / countdowns on their initial state (same on both sides).
          window.setInterval = (() => 0) as unknown as typeof window.setInterval;
        });
        if (p.session) {
          await ctx.addInitScript(() => {
            localStorage.setItem('chotu.session', JSON.stringify({ token: 'visual-test', user: { id: 'demo', name: 'Demo', email: 'demo@chotu.shop', phone: '9876543210', city: 'Bengaluru', businessDomain: 'Grocery' } }));
          });
        }
        const page = await ctx.newPage();
        page.on('console', (m) => {
          if ((m.type() === 'error' || m.type() === 'warning') && !page.url().includes('/__ref/')) consoleIssues.push(`[${p.name} ${width}] ${m.type()}: ${m.text()}`);
        });
        page.on('pageerror', (e) => {
          if (!page.url().includes('/__ref/')) consoleIssues.push(`[${p.name} ${width}] pageerror: ${e.message}`);
        });

        const a = await shoot(page, p.original, join(OUT, `${p.name}-${width}-original.png`));
        const b = await shoot(page, p.app, join(OUT, `${p.name}-${width}-app.png`));
        const w = Math.max(a.width, b.width);
        const h = Math.max(a.height, b.height);
        const A = pad(a, w, h);
        const B = pad(b, w, h);
        const diff = new PNG({ width: w, height: h });
        const pixels = pixelmatch(A.data, B.data, diff.data, w, h, { threshold: 0.1 });
        // Strict check: pixels whose RGBA bytes differ at all (no tolerance, no anti-aliasing allowance).
        let exact = 0;
        for (let i = 0; i < A.data.length; i += 4) if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2] || A.data[i + 3] !== B.data[i + 3]) exact++;
        await writeFile(join(OUT, `${p.name}-${width}-diff.png`), PNG.sync.write(diff));
        const pct = (pixels / (w * h)) * 100;
        const size = a.width === b.width && a.height === b.height ? `${a.width}×${a.height}` : `orig ${a.width}×${a.height} / app ${b.width}×${b.height}`;
        rows.push({ page: p.name, width, diff: pct, size, pixels, exact });
        console.log(`${p.name.padEnd(8)} ${String(width).padStart(4)}px  ${pct.toFixed(4).padStart(8)}%  (${pixels} px, ${exact} px byte-different)  ${size}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  const table = [
    '| Page | Width | Diff % (pixelmatch, threshold 0.1) | Diff px | Byte-different px | Screenshot size |',
    '|---|---:|---:|---:|---:|---|',
    ...rows.map((r) => `| ${r.page} | ${r.width} | ${r.diff.toFixed(4)} | ${r.pixels} | ${r.exact} | ${r.size} |`),
  ].join('\n');
  const issues = consoleIssues.length ? consoleIssues.map((c) => `- ${c}`).join('\n') : '- none';
  await writeFile(join(OUT, 'report.md'), `# Visual diff report\n\n${table}\n\n## App console errors/warnings\n\n${issues}\n`);
  console.log(`\n${table}\n\nApp console errors/warnings:\n${issues}`);
  const failed = rows.filter((r) => r.diff > FAIL_ABOVE);
  if (failed.length) {
    console.error(`\n${failed.length} page/width combinations above ${FAIL_ABOVE}%`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
