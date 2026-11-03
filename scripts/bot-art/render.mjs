// node scripts/bot-art/render.mjs — рисует public/bot/start.jpg, description.png (640×360) и avatar.jpg
import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? 'playwright');
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../public/bot');
// шрифты встраиваем в CSS как data:, чтобы страница рисовалась без сервера
const fontsDir = resolve(here, '../../src/fonts');
const inlineFonts = { name: 'inline-fonts', setup(b) { b.onLoad({ filter: /fonts\.css$/ }, (a) => ({ loader: 'text',
  contents: readFileSync(a.path, 'utf8').replace(/url\(\.\/([\w-]+\.woff2)\)/g, (_, f) => `url(data:font/woff2;base64,${readFileSync(resolve(fontsDir, f)).toString('base64')})`) })); } };
const r = await build({ entryPoints: [resolve(here, 'entry.ts')], bundle: true, format: 'esm', write: false, platform: 'node', plugins: [inlineFonts] });
const m = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const b = await chromium.launch();
const shot = async (html, w, h, file, type) => {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html); await p.waitForTimeout(400);
  await p.screenshot({ path: resolve(out, file), type, ...(type === 'jpeg' ? { quality: 88 } : {}) });
  await p.close();
};
await shot(m.banner(1280, 720), 1280, 720, 'start.jpg', 'jpeg');
await shot(m.banner(640, 360), 640, 360, 'description.png', 'png');
await shot(m.avatar(640), 640, 640, 'avatar.jpg', 'jpeg');
await b.close();
console.log('ok');
