// Сборка симуляции esbuild'ом и запуск: node scripts/balance/run.mjs [n]
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const r = await build({ entryPoints: [here + 'sim.ts'], bundle: true, write: false, format: 'esm', platform: 'node', define: { 'import.meta.env': '{}' }, logLevel: 'error' });
const m = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const st = process.argv[3] ? process.argv[3].split(',').map(Number) : undefined;
console.log(m.report(st, undefined, Number(process.argv[2] ?? 30)));
