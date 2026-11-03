// Сборка превью в один HTML-файл без Vite (esbuild). Демо-режим: без сервера, всё в браузере.
// Запуск: node scripts/build-preview.mjs [выходной.html]   (BANK_PATH — путь к полному банку вопросов JSON)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? resolve(root, 'dist-preview/index.html'));
const bank = process.env.BANK_PATH ? resolve(process.env.BANK_PATH) : resolve(root, 'src/data/sample-questions.json');
const env = (k, d = '') => JSON.stringify(process.env[k] ?? d);

const res = await build({
  entryPoints: [resolve(root, 'src/main.ts')],
  bundle: true, format: 'esm', target: 'es2020', minify: true, write: false, outdir: 'out',
  loader: { '.woff2': 'dataurl', '.json': 'json' },
  alias: { '@bank': bank },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': env('VITE_SUPABASE_URL'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': env('VITE_SUPABASE_ANON_KEY'),
    'import.meta.env.VITE_BOT_USERNAME': env('VITE_BOT_USERNAME'),
    'import.meta.env.VITE_TEST_MODE': env('VITE_TEST_MODE', '1'),
    'import.meta.env.VITE_YANDEX_MAPS_KEY': env('VITE_YANDEX_MAPS_KEY'),
    'import.meta.env.VITE_LIVE_JSON': env('VITE_LIVE_JSON', '0'),
  },
  legalComments: 'none',
  logLevel: 'warning',
});
const js = res.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = res.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
const tpl = readFileSync(resolve(root, 'index.html'), 'utf8')
  .replace(/<title>[^<]*<\/title>/, '<title>Игра ШПА — превью</title>')
  .replace(/\s*<script type="module" src="[^"]*"><\/script>/, '');
// replace с функцией: в коде встречаются «$&» и «$'», которые строковая замена поняла бы как шаблоны
const html = tpl.replace('</head>', () => `<style>${css}</style>\n</head>`).replace('</body>', () => `<script type="module">${js}</script>\n</body>`);
mkdirSync(dirname(out), { recursive: true });
// --fragment: без <html>/<head>/<body> — для публикации как артефакт (обёртку добавляет площадка)
const fragment = `<title>Игра ШПА</title>\n<style>:root{color-scheme:dark}${css}</style>\n<div id="app"></div>\n<script type="module">${js}</script>\n`;
writeFileSync(out, process.argv.includes('--fragment') ? fragment : html);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} КБ`);
