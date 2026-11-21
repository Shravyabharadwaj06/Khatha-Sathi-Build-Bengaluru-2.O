/**
 * Screenshots of every route at 1440 / 1024 / 390 for the UI polish review, plus layout metrics.
 *   npx tsx scripts/ui-shots.ts ui-before      (uses the existing dist/, build it in mock mode first)
 *   npx tsx scripts/ui-shots.ts ui-after
 * Output (gitignored): <repo>/frontend/<dir>/<route>-<width>.png and <dir>/metrics.json
 */
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, process.argv[2] ?? 'ui-before');
const PORT = 4341;
const BASE = `http://localhost:${PORT}`;
const WIDTHS = [1440, 1024, 390];
export const ROUTES = ['/', '/login', '/signup', '/terms', '/privacy', '/home', '/assistant', '/products', '/customers', '/profile', '/report-issue', '/report-sent', '/reports'];
const PUBLIC = new Set(['/', '/login', '/signup', '/terms', '/privacy']);
const SESSION = JSON.stringify({ token: 't', user: { id: 'demo', name: 'Demo Shop', email: 'demo@chotu.shop', phone: '9876543210', city: 'Bengaluru', businessDomain: 'Grocery' } });
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

const isFile = async (p: string) => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

export const slug = (route: string) => (route === '/' ? 'landing' : route.slice(1));

async function main() {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url ?? '/', BASE).pathname);
    let file = normalize(join(DIST, url));
    if (!file.startsWith(DIST) || !(await isFile(file))) file = join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  });
  await new Promise<void>((r) => server.listen(PORT, r));
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const metrics: Record<string, unknown>[] = [];
  try {
    for (const route of ROUTES) {
      for (const width of WIDTHS) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        // tsx (esbuild keepNames) wraps named functions in __name(); define it inside the page.
        await ctx.addInitScript('globalThis.__name = (f) => f;');
        await ctx.addInitScript(
          ([session, isPublic]) => {
            window.setInterval = (() => 0) as unknown as typeof window.setInterval;
            if (!isPublic) localStorage.setItem('chotu.session', session as string);
          },
          [SESSION, PUBLIC.has(route)] as const,
        );
        // No backend in mock mode: block calls to it so pages show their "offline" state quickly.
        await ctx.route(/127\.0\.0\.1:8000|localhost:8000/, (r) => r.abort());
        const page = await ctx.newPage();
        await page.goto(BASE + route);
        await page.waitForLoadState('networkidle');
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {})));
        });
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(OUT, `${slug(route)}-${width}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
        const m = await page.evaluate(() => {
          const vis = (el: Element) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const h1 = document.querySelector('h1');
          const h1s = h1 ? getComputedStyle(h1) : null;
          const main = document.querySelector('main') ?? document.body.firstElementChild;
          const mr = main?.getBoundingClientRect();
          const buttons = Array.from(document.querySelectorAll('button, a[class*="btn"], input[type="submit"]')).filter(vis);
          const heights = [...new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().height)))].sort((a, b) => a - b);
          const radii = [...new Set(buttons.map((b) => getComputedStyle(b).borderTopLeftRadius))];
          const fonts = [...new Set(Array.from(document.querySelectorAll('p, label, input, button, td, th, li')).filter(vis).slice(0, 200).map((e) => getComputedStyle(e).fontFamily.split(',')[0].replace(/"/g, '')))];
          return {
            overflowX: document.documentElement.scrollWidth - window.innerWidth,
            pageHeight: document.documentElement.scrollHeight,
            title: document.title,
            h1: h1 ? { text: h1.textContent?.trim().slice(0, 40), font: h1s!.fontFamily.split(',')[0], size: h1s!.fontSize } : null,
            main: mr ? { left: Math.round(mr.left), width: Math.round(mr.width) } : null,
            buttonHeights: heights,
            buttonRadii: radii,
            bodyFonts: fonts,
          };
        });
        metrics.push({ route, width, ...m });
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  await writeFile(join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 1));
  console.log(`Saved ${metrics.length} screenshots + metrics.json to ${OUT}`);
}

void main();
