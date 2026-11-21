/**
 * Builds frontend/ui-compare.html (gitignored): before / after screenshots side by side for every route
 * and width. Run scripts/ui-shots.ts for ui-before and ui-after first.
 *   npx tsx scripts/ui-compare.ts
 */
import { readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ROUTES = ['landing', 'login', 'signup', 'terms', 'privacy', 'home', 'assistant', 'products', 'customers', 'profile', 'report-issue', 'report-sent', 'reports'];
const WIDTHS = [1440, 1024, 390];

async function main() {
  const before = new Set(await readdir(join(ROOT, 'ui-before')));
  const after = new Set(await readdir(join(ROOT, 'ui-after')));
  const rows = ROUTES.flatMap((r) =>
    WIDTHS.map((w) => {
      const f = `${r}-${w}.png`;
      const cell = (dir: string, has: boolean) =>
        has ? `<a href="${dir}/${f}" target="_blank"><img src="${dir}/${f}" alt="${r} ${w}px ${dir}" loading="lazy"></a>` : '<p class="missing">not captured</p>';
      return `<section id="${r}-${w}"><h2>/${r === 'landing' ? '' : r} <span>${w}px</span></h2><div class="pair w${w}">
<figure><figcaption>Before</figcaption>${cell('ui-before', before.has(f))}</figure>
<figure><figcaption>After</figcaption>${cell('ui-after', after.has(f))}</figure></div></section>`;
    }),
  );
  const nav = ROUTES.map((r) => `<a href="#${r}-1440">/${r === 'landing' ? '' : r}</a>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CHOTU.ai UI polish: before / after</title>
<style>
body{margin:0;background:#faf9f5;color:#0f0f56;font:15px/1.5 'Work Sans',system-ui,sans-serif}
header{position:sticky;top:0;z-index:2;padding:12px 24px;background:#fff;border-bottom:1px solid #0f0f56}
h1{margin:0 0 6px;font:700 24px 'Barlow Condensed',system-ui,sans-serif;text-transform:uppercase}
nav{display:flex;flex-wrap:wrap;gap:6px}nav a{padding:4px 8px;border:1px solid #0f0f5633;border-radius:4px;color:#0f0f56;text-decoration:none;font-size:13px}
main{padding:24px}section{margin:0 0 40px}h2{margin:0 0 8px;font-size:18px}h2 span{color:#464650;font-weight:400}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.pair.w390{grid-template-columns:repeat(2,minmax(0,420px))}
figure{margin:0;background:#fff;border:1px solid #0f0f5633;border-radius:8px;padding:8px}figcaption{font-weight:700;margin:0 0 6px}
img{display:block;width:100%;height:auto;border:1px solid #0f0f5622}.missing{color:#93000a}
</style></head><body><header><h1>UI polish: before / after</h1><nav>${nav}</nav></header><main>${rows.join('\n')}</main></body></html>`;
  await writeFile(join(ROOT, 'ui-compare.html'), html);
  console.log(`Wrote ${join(ROOT, 'ui-compare.html')} (${rows.length} comparisons)`);
}

void main();
