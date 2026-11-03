import QRCode from '../lib/qrcode-vendor.js';

/** SVG с QR-кодом (масштабируется под контейнер). Уровень коррекции M — читается с проектора и с экрана телефона. */
export function qrSvg(text: string, opts: { dark?: string; light?: string } = {}) {
  const q = new QRCode(-1, 0 /* M */);
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const m = 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  }
  const size = n + m * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR-код"><rect width="${size}" height="${size}" fill="${opts.light ?? '#fff'}"/><path d="${d}" fill="${opts.dark ?? '#000'}"/></svg>`;
}
