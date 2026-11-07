// «Антистресс» → Ковры: пылесос, щётка, пена и мойка. Чем грязнее ковёр — тем больше этапов.
// Слои ковра — отдельные холсты: чистый узор, пыль и пятна, засохшая грязь, пена, мокрые полосы.
// Прогресс считаем по реальным пикселям слоя (уменьшенная копия 48×N), почти дочистил — остаток тает сам.
import { icon } from '../art/icons';
import { el, esc } from '../lib/dom';
import { clamp, easeInOut, frame, local, offscreen, Parts, rng, type CalmCtx, type Scene } from './calm-kit';

type Tool = 'vac' | 'scrub' | 'foam' | 'rinse';
type Dirt = 'dust' | 'stains' | 'mud' | 'party';
type G = CanvasRenderingContext2D;
type Pat = (g: G, w: number, h: number, R: () => number) => void;
interface Carpet { id: string; name: string; dirt: Dirt; ratio: number; seed: number; pat: Pat; small?: boolean }

const LEVEL: Record<Dirt, { n: number; label: string; stages: Tool[] }> = {
  dust: { n: 1, label: 'Пыль', stages: ['rinse'] },
  stains: { n: 2, label: 'Пятна', stages: ['foam', 'rinse'] },
  mud: { n: 3, label: 'Грязь', stages: ['scrub', 'foam', 'rinse'] },
  party: { n: 4, label: 'После вечерки', stages: ['vac', 'scrub', 'foam', 'rinse'] },
};

const svg = (p: string) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const TOOL: Record<Tool, { name: string; hint: string; svg: string }> = {
  vac: { name: 'Пылесос', hint: 'Собери пылесосом конфетти и крошки', svg: svg('<path d="M3 19h11l2-5H6Z"/><path d="M11 14V7a3 3 0 0 1 6 0v2"/><path d="M17 9h3"/>') },
  scrub: { name: 'Щётка', hint: 'Оттирай засохшую грязь — води туда-сюда', svg: svg('<rect x="3" y="10" width="18" height="6" rx="3"/><path d="M6 16v4M10 16v4M14 16v4M18 16v4"/><path d="M9 10V5h6v5"/>') },
  foam: { name: 'Пена', hint: 'Покрой ковёр пеной целиком', svg: svg('<circle cx="8" cy="14" r="4"/><circle cx="15.5" cy="8.5" r="3.5"/><circle cx="17" cy="17" r="2.5"/>') },
  rinse: { name: 'Мойка', hint: 'Смывай полосами сверху вниз', svg: svg('<path d="M12 3s-5.5 6-5.5 10.5a5.5 5.5 0 0 0 11 0C17.5 9 12 3 12 3Z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>') },
};
const THR: Record<Tool, number> = { vac: 0.95, scrub: 0.965, foam: 0.9, rinse: 0.975 };

// ---------- Узоры ----------
function diamond(g: G, x: number, y: number, rw: number, rh: number) {
  g.beginPath(); g.moveTo(x, y - rh); g.lineTo(x + rw, y); g.lineTo(x, y + rh); g.lineTo(x - rw, y); g.closePath();
}
function star(g: G, x: number, y: number, ro: number, ri: number, n: number, rot = 0) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n, r = i % 2 ? ri : ro;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
}
function circle(g: G, x: number, y: number, r: number) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); }
function bolt(g: G, x: number, y: number, s: number) {
  g.beginPath();
  g.moveTo(x + 0.15 * s, y - 0.5 * s); g.lineTo(x - 0.28 * s, y + 0.06 * s); g.lineTo(x - 0.02 * s, y + 0.06 * s);
  g.lineTo(x - 0.15 * s, y + 0.5 * s); g.lineTo(x + 0.28 * s, y - 0.08 * s); g.lineTo(x + 0.02 * s, y - 0.08 * s); g.closePath();
}

/** Ворс: тонкое плетение, искорки, тень к краям. */
function fabric(g: G, w: number, h: number, R: () => number) {
  g.fillStyle = '#000';
  g.globalAlpha = 0.07; for (let x = 0; x < w; x += 2.5) g.fillRect(x, 0, 0.8, h);
  g.globalAlpha = 0.05; for (let y = 0; y < h; y += 2.5) g.fillRect(0, y, w, 0.8);
  g.fillStyle = '#fff'; g.globalAlpha = 0.08;
  for (let i = 0; i < (w * h) / 50; i++) g.fillRect(R() * w, R() * h, 1, 1);
  g.globalAlpha = 1;
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
}

/** Персидский: кайма с розетками, поле с ромбиками, угловые полукруги, медальон-звезда. p: поле, кайма, светлый, золото, акцент */
const persian = (p: string[]): Pat => (g, w, h) => {
  const b = Math.round(w * 0.12);
  g.fillStyle = p[1]; g.fillRect(0, 0, w, h);
  g.fillStyle = p[0]; g.fillRect(b * 0.16, b * 0.16, w - b * 0.32, h - b * 0.32);
  g.fillStyle = p[1]; g.fillRect(b * 0.3, b * 0.3, w - b * 0.6, h - b * 0.6);
  const rose = (x: number, y: number, r: number) => {
    g.fillStyle = p[2];
    for (let k = 0; k < 4; k++) { circle(g, x + Math.cos(k * 1.5708) * r * 0.55, y + Math.sin(k * 1.5708) * r * 0.55, r * 0.42); g.fill(); }
    g.fillStyle = p[4]; circle(g, x, y, r * 0.38); g.fill();
    g.fillStyle = p[3]; circle(g, x, y, r * 0.16); g.fill();
  };
  const mid = b * 0.65, rr = b * 0.27;
  const nx = Math.max(2, Math.round((w - 2 * mid) / (b * 0.95))), ny = Math.max(2, Math.round((h - 2 * mid) / (b * 0.95)));
  for (let i = 0; i <= nx; i++) { const x = mid + ((w - 2 * mid) * i) / nx; rose(x, mid, rr); rose(x, h - mid, rr); }
  for (let i = 1; i < ny; i++) { const y = mid + ((h - 2 * mid) * i) / ny; rose(mid, y, rr); rose(w - mid, y, rr); }
  g.strokeStyle = p[3]; g.lineWidth = 1.6;
  g.strokeRect(b * 0.3, b * 0.3, w - b * 0.6, h - b * 0.6);
  g.strokeRect(b, b, w - 2 * b, h - 2 * b);
  const fx = b + 2, fy = b + 2, fw = w - 2 * b - 4, fh = h - 2 * b - 4;
  g.fillStyle = p[0]; g.fillRect(fx, fy, fw, fh);
  g.fillStyle = p[3]; g.globalAlpha = 0.32;
  for (let y = fy + 10, r = 0; y < fy + fh - 4; y += 16, r++) for (let x = fx + 10 + (r % 2) * 8; x < fx + fw - 4; x += 16) { diamond(g, x, y, 2.6, 3.4); g.fill(); }
  g.globalAlpha = 1;
  g.save(); g.beginPath(); g.rect(fx, fy, fw, fh); g.clip();
  const cr = Math.min(fw, fh) * 0.24;
  for (const [x, y] of [[fx, fy], [fx + fw, fy], [fx, fy + fh], [fx + fw, fy + fh]]) {
    g.fillStyle = p[1]; circle(g, x, y, cr); g.fill();
    g.strokeStyle = p[3]; g.lineWidth = 1.5; circle(g, x, y, cr * 0.8); g.stroke();
    g.fillStyle = p[2]; circle(g, x, y, cr * 0.42); g.fill();
    g.fillStyle = p[4]; circle(g, x, y, cr * 0.2); g.fill();
  }
  g.restore();
  const cx = w / 2, cy = h / 2, M = Math.min(fw, fh) * 0.36, sy = (fh / fw) * 0.9;
  g.fillStyle = p[1]; diamond(g, cx, cy, M * 1.3, M * 1.3 * sy); g.fill();
  g.strokeStyle = p[3]; g.lineWidth = 2; g.stroke();
  g.lineWidth = 1; diamond(g, cx, cy, M * 1.08, M * 1.08 * sy); g.stroke();
  g.fillStyle = p[2]; circle(g, cx, cy, M * 0.78); g.fill();
  g.fillStyle = p[4]; star(g, cx, cy, M * 0.72, M * 0.46, 8); g.fill();
  g.fillStyle = p[1]; circle(g, cx, cy, M * 0.34); g.fill();
  g.fillStyle = p[3]; star(g, cx, cy, M * 0.24, M * 0.1, 8, 0.39); g.fill();
  for (const s of [-1, 1]) {
    const py = cy + s * (M * 1.3 * sy + M * 0.28);
    g.fillStyle = p[1]; diamond(g, cx, py, M * 0.22, M * 0.3); g.fill();
    g.fillStyle = p[3]; circle(g, cx, py, M * 0.07); g.fill();
  }
};

/** Килим: полосы с ромбами, зигзагами и крестиками. p[0] — фон, остальные — цвета полос */
const kilim = (p: string[]): Pat => (g, w, h) => {
  g.fillStyle = p[0]; g.fillRect(0, 0, w, h);
  const bands = Math.max(5, Math.round(h / (w * 0.16)));
  const bh = h / bands, k = p.length - 1;
  for (let i = 0; i < bands; i++) {
    const y = i * bh;
    const c1 = p[1 + (i % k)], c2 = p[1 + ((i + 2) % k)];
    g.fillStyle = c1; g.fillRect(0, y + bh * 0.08, w, bh * 0.84);
    const n = Math.max(3, Math.round(w / (bh * 0.95))), s = w / n;
    for (let j = 0; j < n; j++) {
      const x = j * s + s / 2;
      if (i % 3 === 0) {
        g.fillStyle = c2; diamond(g, x, y + bh / 2, s * 0.44, bh * 0.36); g.fill();
        g.fillStyle = p[0]; diamond(g, x, y + bh / 2, s * 0.22, bh * 0.18); g.fill();
        g.fillStyle = c1; diamond(g, x, y + bh / 2, s * 0.08, bh * 0.07); g.fill();
      } else if (i % 3 === 1) {
        g.fillStyle = c2; g.beginPath(); g.moveTo(x - s / 2, y + bh * 0.92); g.lineTo(x, y + bh * 0.1); g.lineTo(x + s / 2, y + bh * 0.92); g.closePath(); g.fill();
        g.fillStyle = p[0]; g.beginPath(); g.moveTo(x - s * 0.2, y + bh * 0.92); g.lineTo(x, y + bh * 0.5); g.lineTo(x + s * 0.2, y + bh * 0.92); g.closePath(); g.fill();
      } else {
        g.fillStyle = c2; g.fillRect(x - s * 0.08, y + bh * 0.2, s * 0.16, bh * 0.6); g.fillRect(x - s * 0.28, y + bh * 0.42, s * 0.56, bh * 0.16);
      }
    }
    g.fillStyle = p[0]; g.globalAlpha = 0.55;
    g.fillRect(0, y + bh * 0.08, w, 1.6); g.fillRect(0, y + bh * 0.9, w, 1.6);
    g.globalAlpha = 1;
  }
};

/** Ковёр ШПА: синее поле, горы, большие буквы, молнии по кайме. */
const shpa: Pat = (g, w, h) => {
  g.fillStyle = '#0B2A3D'; g.fillRect(0, 0, w, h);
  const b = w * 0.075;
  const sky = g.createLinearGradient(0, b, 0, h - b);
  sky.addColorStop(0, '#0396DA'); sky.addColorStop(1, '#5fc4f0');
  g.fillStyle = sky; g.fillRect(b, b, w - 2 * b, h - 2 * b);
  g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(b * 0.55, b * 0.55, w - b * 1.1, h - b * 1.1);
  g.fillStyle = '#FFD24A';
  const step = w * 0.09;
  for (let x = b; x < w - b * 0.5; x += step) { bolt(g, x, b * 0.28, b * 0.42); g.fill(); bolt(g, x, h - b * 0.28, b * 0.42); g.fill(); }
  for (let y = b + step; y < h - b; y += step) { bolt(g, b * 0.28, y, b * 0.42); g.fill(); bolt(g, w - b * 0.28, y, b * 0.42); g.fill(); }
  g.save(); g.beginPath(); g.rect(b, b, w - 2 * b, h - 2 * b); g.clip();
  g.fillStyle = '#FFD24A'; circle(g, w * 0.74, h * 0.56, w * 0.09); g.fill();
  const ridge = (base: number, amp: number, col: string, seed: number) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(b, h);
    const n = 7;
    for (let i = 0; i <= n; i++) { const x = b + ((w - 2 * b) * i) / n; const y = base - (i % 2 ? amp * (0.7 + ((i * seed) % 5) / 10) : amp * 0.15); g.lineTo(x, y); }
    g.lineTo(w - b, h); g.closePath(); g.fill();
  };
  ridge(h * 0.8, h * 0.17, '#2fa9e3', 3);
  ridge(h * 0.86, h * 0.14, '#ffffff', 7);
  ridge(h * 0.93, h * 0.08, '#0B2A3D', 2);
  g.restore();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `400 ${Math.round(w * 0.27)}px 'Russo One', Rubik, sans-serif`;
  g.fillText('ШПА', w / 2, h * 0.36);
  g.font = `700 ${Math.round(w * 0.048)}px Rubik, sans-serif`;
  g.fillText('ШКОЛА ПРОФСОЮЗНОГО АКТИВА', w / 2, h * 0.44);
  g.font = `600 ${Math.round(w * 0.042)}px Rubik, sans-serif`; g.globalAlpha = 0.85;
  g.fillText('МЭИ · 7–8 НОЯБРЯ', w / 2, h * 0.5); g.globalAlpha = 1;
};

/** Ковёр профкома: зелёный с золотом, круглый медальон, надпись по кругу, молния. */
const profkom: Pat = (g, w, h) => {
  g.fillStyle = '#c99a3b'; g.fillRect(0, 0, w, h);
  const b = w * 0.08;
  g.fillStyle = '#123d31'; g.fillRect(b * 0.35, b * 0.35, w - b * 0.7, h - b * 0.7);
  g.fillStyle = '#e8c36a';
  for (let x = b; x < w - b * 0.4; x += b * 0.9) { diamond(g, x, b * 0.68, b * 0.22, b * 0.22); g.fill(); diamond(g, x, h - b * 0.68, b * 0.22, b * 0.22); g.fill(); }
  g.fillStyle = '#1f5f4a'; g.fillRect(b, b, w - 2 * b, h - 2 * b);
  g.fillStyle = '#e8c36a'; g.globalAlpha = 0.28;
  for (let y = b + 9; y < h - b; y += 14) for (let x = b + 9; x < w - b; x += 14) { circle(g, x, y, 1.4); g.fill(); }
  g.globalAlpha = 1;
  const cx = w / 2, cy = h / 2, R0 = Math.min(w, h) * 0.36;
  g.fillStyle = '#123d31'; circle(g, cx, cy, R0); g.fill();
  g.strokeStyle = '#e8c36a'; g.lineWidth = 3; circle(g, cx, cy, R0 - 2); g.stroke();
  g.lineWidth = 1.2; circle(g, cx, cy, R0 * 0.7); g.stroke();
  const text = 'ПРОФКОМ · МЭИ · ПРОФКОМ · МЭИ · ';
  g.fillStyle = '#f3e3c3'; g.font = `700 ${Math.round(R0 * 0.14)}px Rubik, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < text.length; i++) {
    const a = -Math.PI / 2 + (i / text.length) * Math.PI * 2;
    g.save(); g.translate(cx + Math.cos(a) * R0 * 0.85, cy + Math.sin(a) * R0 * 0.85); g.rotate(a + Math.PI / 2); g.fillText(text[i], 0, 0); g.restore();
  }
  g.fillStyle = '#f3e3c3'; circle(g, cx, cy, R0 * 0.62); g.fill();
  g.fillStyle = '#e8c36a'; star(g, cx, cy, R0 * 0.58, R0 * 0.44, 12); g.fill();
  g.fillStyle = '#123d31'; circle(g, cx, cy, R0 * 0.42); g.fill();
  g.fillStyle = '#FFD24A'; bolt(g, cx, cy, R0 * 0.62); g.fill();
  g.strokeStyle = '#0B2A3D'; g.lineWidth = 1.5; g.stroke();
  for (const [x, y] of [[b * 2, b * 2], [w - b * 2, b * 2], [b * 2, h - b * 2], [w - b * 2, h - b * 2]]) {
    g.fillStyle = '#e8c36a'; star(g, x, y, b * 0.9, b * 0.35, 8); g.fill();
    g.fillStyle = '#123d31'; circle(g, x, y, b * 0.25); g.fill();
  }
};

const CARPETS: Carpet[] = [
  { id: 'mat', name: 'Коврик у входа в ГК', dirt: 'dust', ratio: 0.7, seed: 11, small: true, pat: kilim(['#2b2d42', '#ef8354', '#bfc0c0', '#4f5d75', '#ffd6a5']) },
  { id: 'bureau', name: 'Ковёр профбюро', dirt: 'stains', ratio: 1.42, seed: 23, pat: persian(['#8e1b2c', '#1d2b5a', '#f3e3c3', '#e2b65a', '#2e6f9e']) },
  { id: 'dorm', name: 'Ковёр из общаги', dirt: 'mud', ratio: 1.36, seed: 37, pat: kilim(['#f4ead5', '#1f7a7a', '#e76f51', '#264653', '#e9c46a']) },
  { id: 'party', name: 'Ковёр после вечерки', dirt: 'party', ratio: 1.42, seed: 41, pat: persian(['#4a1d6b', '#0f3d3e', '#f7e1d7', '#f2b5d4', '#ff7aa2']) },
  { id: 'shpa', name: 'Ковёр ШПА', dirt: 'mud', ratio: 1.38, seed: 53, pat: shpa },
  { id: 'profkom', name: 'Ковёр профкома', dirt: 'party', ratio: 1.3, seed: 67, pat: profkom },
];
const PALS = [
  ['#7a1f3d', '#203a43', '#f6e7cb', '#e0a96d', '#3f8f8b'], ['#264653', '#e76f51', '#f4ecd8', '#e9c46a', '#2a9d8f'],
  ['#3d0c45', '#103e5b', '#ffe8d6', '#ffb4a2', '#6d597a'], ['#1b4332', '#081c15', '#d8f3dc', '#d4a373', '#52b788'],
];
function randomCarpet(): Carpet {
  const seed = (Math.random() * 1e9) | 0, R = rng(seed);
  const p = PALS[(R() * PALS.length) | 0];
  const dirt: Dirt = (['stains', 'mud', 'party'] as Dirt[])[(R() * 3) | 0];
  return { id: 'random', name: 'Случайный ковёр', dirt, ratio: 1.25 + R() * 0.25, seed, pat: R() < 0.5 ? persian(p) : kilim([p[2], p[0], p[4], p[1], p[3]]) };
}

// ---------- Грязь ----------
function blot(g: G, x: number, y: number, r: number, R: () => number, color: string) {
  g.fillStyle = color; g.beginPath();
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, rr = r * (0.68 + R() * 0.5);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath(); g.fill();
}
function dust(g: G, w: number, h: number, R: () => number, k = 1) {
  g.fillStyle = 'rgba(128,110,88,0.86)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 60 * k; i++) {
    const x = R() * w, y = R() * h, r = (12 + R() * 46) * Math.sqrt(k);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const c = R() < 0.55 ? '86,68,50' : '170,154,130';
    gr.addColorStop(0, `rgba(${c},0.4)`); gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < (w * h) / 30; i++) {
    g.fillStyle = R() < 0.5 ? 'rgba(62,48,34,0.55)' : 'rgba(198,184,158,0.45)';
    const s = 0.8 + R() * 1.6; g.fillRect(R() * w, R() * h, s, s);
  }
  g.strokeStyle = 'rgba(46,36,26,0.6)'; g.lineWidth = 0.9;
  for (let i = 0; i < 16 * k; i++) {
    const x = R() * w, y = R() * h;
    g.beginPath(); g.moveTo(x, y);
    g.bezierCurveTo(x + (R() - 0.5) * 40, y + (R() - 0.5) * 40, x + (R() - 0.5) * 50, y + (R() - 0.5) * 50, x + (R() - 0.5) * 60, y + (R() - 0.5) * 60);
    g.stroke();
  }
}
function stains(g: G, w: number, h: number, R: () => number, n: number) {
  for (let i = 0; i < n; i++) {
    const x = w * (0.12 + R() * 0.76), y = h * (0.1 + R() * 0.8), r = (14 + R() * 26) * Math.min(1, w / 300);
    if (R() < 0.5) {
      g.fillStyle = 'rgba(110,70,35,0.38)'; g.beginPath(); g.ellipse(x, y, r, r * 0.9, R() * 3, 0, 7); g.fill();
      g.strokeStyle = 'rgba(74,42,16,0.72)'; g.lineWidth = 2.6; g.stroke();
      for (let k = 0; k < 4; k++) { circle(g, x + (R() - 0.5) * r * 3, y + (R() - 0.5) * r * 3, 1.5 + R() * 3); g.fillStyle = 'rgba(90,52,20,0.6)'; g.fill(); }
    } else {
      const col = R() < 0.5 ? 'rgba(128,28,72,0.52)' : 'rgba(156,112,18,0.48)';
      blot(g, x, y, r, R, col);
      for (let k = 0; k < 5; k++) blot(g, x + (R() - 0.5) * r * 3.4, y + (R() - 0.5) * r * 3.4, 2 + R() * 6, R, col);
    }
  }
}
function sneaker(g: G, x: number, y: number, a: number, s: number) {
  g.save(); g.translate(x, y); g.rotate(a); g.scale(s, s);
  g.fillStyle = 'rgba(46,30,16,0.85)';
  g.beginPath(); g.ellipse(0, -14, 13, 21, 0, 0, 7); g.fill();
  g.beginPath(); g.ellipse(0, 24, 10, 12, 0, 0, 7); g.fill();
  g.strokeStyle = 'rgba(150,120,84,0.85)'; g.lineWidth = 2;
  for (let k = -28; k < 32; k += 7) { if (k > 2 && k < 14) continue; g.beginPath(); g.moveTo(-9, k); g.lineTo(9, k + 2); g.stroke(); }
  g.restore();
}
function mud(g: G, w: number, h: number, R: () => number, n: number) {
  const sc = Math.min(1, w / 320);
  for (let i = 0; i < n; i++) blot(g, R() * w, R() * h, (30 + R() * 70) * sc, R, `rgba(${(76 + R() * 22) | 0},${(54 + R() * 14) | 0},${(34 + R() * 10) | 0},0.97)`);
  for (let i = 0; i < n * 0.7; i++) blot(g, R() * w, R() * h, (8 + R() * 20) * sc, R, 'rgba(142,114,80,0.65)');
  g.strokeStyle = 'rgba(38,26,16,0.75)'; g.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    let x = R() * w, y = R() * h;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (R() - 0.5) * 26 * sc; y += (R() - 0.5) * 26 * sc; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 2; i++) sneaker(g, w * (0.25 + R() * 0.5), h * (0.2 + R() * 0.6), R() * Math.PI * 2, sc);
}
const CONF = ['#ff4d6d', '#ffd23f', '#3bceac', '#5e60ce', '#ff9f1c', '#ffffff', '#9b5de5'];
interface Bit { x: number; y: number; rot: number; s: number; c: string; round: boolean; gone: boolean; fly: number; vx: number; vy: number; suck: number }
function confetti(w: number, h: number, R: () => number, n: number): Bit[] {
  const out: Bit[] = [];
  for (let i = 0; i < n; i++) {
    const crumb = R() < 0.22;
    out.push({ x: 6 + R() * (w - 12), y: 6 + R() * (h - 12), rot: R() * 6.28, s: crumb ? 1.6 + R() * 2.2 : 2.6 + R() * 2.6, c: crumb ? (R() < 0.5 ? '#c8913f' : '#8a5a2b') : CONF[(R() * CONF.length) | 0], round: crumb || R() < 0.25, gone: false, fly: 0, vx: 0, vy: 0, suck: 0 });
  }
  return out;
}
function drawBits(g: G, bits: Bit[], ox: number, oy: number, k: number) {
  for (const b of bits) {
    if (b.gone) continue;
    g.save(); g.translate(ox + b.x * k, oy + b.y * k); g.rotate(b.rot);
    g.globalAlpha = b.fly ? Math.max(0, 1 - b.fly * 2) : 1;
    g.fillStyle = b.c;
    if (b.round) { circle(g, 0, 0, b.s * k * 0.7); g.fill(); } else g.fillRect(-b.s * k, -b.s * k * 0.4, b.s * 2 * k, b.s * 0.8 * k);
    g.restore();
  }
  g.globalAlpha = 1;
}

/** Слои грязи для ковра (общая функция для превью и игры). */
function makeDirt(c: Carpet, w: number, h: number, R: () => number, dirtG: G, mudG: G | null) {
  const k = clamp((w * h) / (320 * 450), 0.15, 1.2);
  dust(dirtG, w, h, R, k);
  if (c.dirt !== 'dust') stains(dirtG, w, h, R, Math.round((c.dirt === 'stains' ? 9 : 6) * Math.max(0.4, k)));
  if (c.dirt === 'party') {
    for (let i = 0; i < (w * h) / 90; i++) { dirtG.fillStyle = CONF[(R() * CONF.length) | 0]; dirtG.globalAlpha = 0.7; dirtG.fillRect(R() * w, R() * h, 1.2, 1.2); }
    dirtG.globalAlpha = 1;
  }
  if (mudG && (c.dirt === 'mud' || c.dirt === 'party')) mud(mudG, w, h, R, Math.round((c.dirt === 'mud' ? 46 : 30) * Math.max(0.35, k)));
}

/** Пол — доски террасы. */
function deck(w: number, h: number) {
  const o = offscreen(w, h, Math.min(2, window.devicePixelRatio || 1));
  const g = o.g, R = rng(5);
  const ph = 44;
  for (let y = 0, i = 0; y < h; y += ph, i++) {
    g.fillStyle = i % 2 ? '#7d5236' : '#8a5c3d'; g.fillRect(0, y, w, ph - 2);
    g.fillStyle = '#4b2f1d'; g.fillRect(0, y + ph - 2, w, 2);
    g.strokeStyle = 'rgba(60,36,20,0.35)'; g.lineWidth = 1;
    for (let k = 0; k < 4; k++) { const yy = y + 6 + R() * (ph - 14); g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(w * 0.3, yy + (R() - 0.5) * 8, w * 0.6, yy + (R() - 0.5) * 8, w, yy); g.stroke(); }
    const off = (i % 3) * 70;
    for (let x = off; x < w; x += 210) { g.fillStyle = '#3a2416'; g.fillRect(x, y, 2, ph - 2); g.fillStyle = '#c9a27a'; circle(g, x + 8, y + 9, 1.6); g.fill(); circle(g, x + 8, y + ph - 11, 1.6); g.fill(); }
  }
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.8);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  return o.c;
}

/** Спрайты пены: мягкие белые шапки с пузырьками. */
function foamSprites() {
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < 6; i++) {
    const o = offscreen(40, 40, 2), g = o.g, R = rng(100 + i);
    for (let k = 0; k < 5; k++) {
      const x = 20 + (R() - 0.5) * 14, y = 20 + (R() - 0.5) * 14, r = 6 + R() * 7;
      const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.65, 'rgba(238,243,250,0.97)'); gr.addColorStop(1, 'rgba(200,212,228,0)');
      g.fillStyle = gr; circle(g, x, y, r); g.fill();
      if (R() < 0.6) { g.strokeStyle = 'rgba(170,188,212,0.7)'; g.lineWidth = 0.7; circle(g, x + 2, y + 1, r * 0.45); g.stroke(); }
    }
    out.push(o.c);
  }
  return out;
}

// ---------- Сцена ----------
export function carpetScene(cc: CalmCtx): Scene {
  const f = frame(cc, 'Ковры', { back: () => { if (current === -2) return false; drawPicker(); return true; } });
  const pick = el('<div class="calm-pick"></div>');
  f.wrap.appendChild(pick);
  const cv = f.canvas;
  let stopRun = () => {};
  let current = -2; // -2 — выбор ковра, -1 — случайный, 0… — ковёр из списка

  const drawPicker = () => {
    stopRun(); stopRun = () => {};
    current = -2;
    f.backLabel('‹ Все');
    cc.sfx.hush();
    f.hint(''); f.tools.innerHTML = '';
    f.info(`отмыто ${cc.store.carpets.length} из ${CARPETS.length}`);
    pick.classList.remove('hidden');
    pick.innerHTML = `<div class="calm-pick-t">Выбери ковёр. Чем грязнее — тем больше этапов: пылесос, щётка, пена и мойка.</div>
      ${CARPETS.map((c, i) => `<button class="calm-rug" data-i="${i}"><canvas></canvas><b>${esc(c.name)}</b>
        <span class="calm-lvl">${[1, 2, 3, 4].map((n) => `<i class="${n <= LEVEL[c.dirt].n ? 'on' : ''}"></i>`).join('')}<em>${LEVEL[c.dirt].label}</em></span>
        ${cc.store.carpets.includes(c.id) ? `<span class="calm-ok">${icon('check', 14, '#fff', 3)}</span>` : ''}</button>`).join('')}
      <button class="calm-rug calm-rug-rnd" data-i="-1"><div class="calm-rnd">?</div><b>Случайный ковёр</b><span class="calm-lvl"><em>узор и грязь — сюрприз</em></span></button>`;
    pick.querySelectorAll<HTMLButtonElement>('.calm-rug').forEach((b) => {
      const i = Number(b.dataset.i);
      b.addEventListener('click', () => { cc.sfx.wake(); cc.buzz('light'); run(i); });
      if (i < 0) return;
      const c = CARPETS[i];
      const pc = b.querySelector('canvas')!;
      const bw = 92, bh = 68;
      const sc = Math.min(bw / 100, bh / (100 * c.ratio));
      const w = 100 * sc, h = 100 * c.ratio * sc;
      pc.width = bw * 2; pc.height = bh * 2; pc.style.width = `${bw}px`; pc.style.height = `${bh}px`;
      const g = pc.getContext('2d')!;
      g.setTransform(2, 0, 0, 2, 0, 0);
      const ox = (bw - w) / 2, oy = (bh - h) / 2;
      const cl = offscreen(w, h, 2); c.pat(cl.g, w, h, rng(c.seed));
      const dl = offscreen(w, h, 2), ml = offscreen(w, h, 2);
      makeDirt(c, w, h, rng(c.seed + 1), dl.g, ml.g);
      g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 6; g.fillRect(ox, oy, w, h); g.shadowBlur = 0;
      g.drawImage(cl.c, ox, oy, w, h);
      // чистая диагональ — как будто по ковру уже прошлись мойкой
      for (const L of [dl, ml]) {
        L.g.globalCompositeOperation = 'destination-out';
        L.g.beginPath(); L.g.moveTo(w * 0.42, 0); L.g.lineTo(w * 0.7, 0); L.g.lineTo(w * 0.42, h); L.g.lineTo(w * 0.14, h); L.g.closePath(); L.g.fill();
      }
      g.drawImage(dl.c, ox, oy, w, h); g.drawImage(ml.c, ox, oy, w, h);
    });
  };

  const run = (i: number) => {
    current = i;
    f.backLabel('‹ Ковры');
    pick.classList.add('hidden');
    stopRun();
    stopRun = clean(i >= 0 ? CARPETS[i] : randomCarpet(), i);
  };

  function clean(c: Carpet, idx: number) {
    const R = rng(c.seed);
    const W0 = f.wrap.clientWidth || 360, H0 = f.wrap.clientHeight || 520;
    const maxW = (W0 - 44) * (c.small ? 0.86 : 1), maxH = H0 - 64;
    const lw = Math.round(Math.min(maxW, maxH / c.ratio)), lh = Math.round(lw * c.ratio);
    const S = Math.min(1.5, window.devicePixelRatio || 1);
    const cl = offscreen(lw, lh, S); c.pat(cl.g, lw, lh, R); fabric(cl.g, lw, lh, R);
    const dirt = offscreen(lw, lh, S), mudL = offscreen(lw, lh, S), foam = offscreen(lw, lh, S), wet = offscreen(lw, lh, S * 0.5);
    makeDirt(c, lw, lh, rng(c.seed + 1), dirt.g, mudL.g);
    const bits = c.dirt === 'party' ? confetti(lw, lh, R, Math.round(clamp((lw * lh) / 900, 60, 190))) : [];
    const sprites = foamSprites();
    // «было» — для карточки в конце
    const tb = offscreen(96, 96 * c.ratio, 2);
    for (const L of [cl.c, dirt.c, mudL.c]) tb.g.drawImage(L, 0, 0, 96, 96 * c.ratio);
    drawBits(tb.g, bits, 0, 0, 96 / lw);

    const stages = LEVEL[c.dirt].stages;
    let si = 0;
    const SW = 48, SH = Math.max(8, Math.round(48 * c.ratio));
    const samp = document.createElement('canvas'); samp.width = SW; samp.height = SH;
    const sg = samp.getContext('2d', { willReadFrequently: true })!;
    let lastSample: Uint8ClampedArray | null = null;
    const count = (src: HTMLCanvasElement, thr: number) => {
      sg.clearRect(0, 0, SW, SH); sg.drawImage(src, 0, 0, SW, SH);
      const d = sg.getImageData(0, 0, SW, SH).data; lastSample = d;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > thr) n++;
      return n;
    };
    const dirt0 = Math.max(1, count(dirt.c, 40)), mud0 = Math.max(1, count(mudL.c, 40));
    let fadeDirt = 1, fadeMud = 1, fadeFoam = 1;
    let finishing = 0, finTool: Tool | null = null, fillCells: [number, number][] = [];
    let done = false, shine = -1, sampleT = 0;
    let bg: HTMLCanvasElement | null = null, bgW = 0, bgH = 0;
    const parts = new Parts(600);

    const tools = () => {
      f.tools.innerHTML = `<div class="calm-stages">${stages.map((t, i) => `<div class="calm-stage ${i < si ? 'done' : i === si ? 'on' : ''}">${i < si ? icon('check', 18, 'currentColor', 3) : TOOL[t].svg}<span>${TOOL[t].name}</span></div>`).join('')}</div>
        <div class="calm-prog"><i data-prog style="width:0%"></i></div>`;
      f.hint(done ? '' : TOOL[stages[si]].hint);
      f.info(`${LEVEL[c.dirt].label} · этап ${Math.min(si + 1, stages.length)} из ${stages.length}`);
    };
    tools();
    const setProg = (p: number) => { const b = f.tools.querySelector<HTMLElement>('[data-prog]'); if (b) b.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`; };

    // геометрия на экране
    let W = W0, H = H0, k = 1, rx = 0, ry = 0, dw = lw, dh = lh;
    let g = cv.getContext('2d')!;
    const layout = () => {
      const r = f.wrap.getBoundingClientRect();
      if (Math.abs(r.width - W) > 1 || Math.abs(r.height - H) > 1 || cv.width === 0) { W = r.width || W; H = r.height || H; }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`;
        g = cv.getContext('2d')!;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      k = Math.min(1, (W - 44) / lw, (H - 64) / lh);
      dw = lw * k; dh = lh * k; rx = (W - dw) / 2; ry = (H - dh) / 2 + 4;
      if (!bg || bgW !== W || bgH !== H) { bg = deck(W, H); bgW = W; bgH = H; }
    };
    layout();

    // ввод
    let down = false, px = 0, py = 0, ax = 0, ay = 0, lastAx = 0, lastAy = 0, speed = 0, moved = 0, wig = 0;
    let touchOff = 0;
    const toLocal = (x: number, y: number) => ({ x: (x - rx) / k, y: (y - ry) / k });
    const inCarpet = (x: number, y: number) => x > -30 && y > -30 && x < lw + 30 && y < lh + 30;

    const stampRinse = (x: number, y: number) => {
      const bw = 86, bh = 22;
      for (const L of [dirt.g, foam.g]) { L.globalCompositeOperation = 'destination-out'; L.fillRect(x - bw / 2, y - bh / 2, bw, bh); L.globalCompositeOperation = 'source-over'; }
      wet.g.fillStyle = 'rgba(8,16,40,0.6)'; wet.g.fillRect(x - bw / 2, y - bh / 2, bw, bh);
    };
    const stampFoam = (x: number, y: number) => {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * 6.28, d = Math.random() * 22, r = 9 + Math.random() * 10;
        foam.g.drawImage(sprites[(Math.random() * sprites.length) | 0], x + Math.cos(a) * d - r, y + Math.sin(a) * d - r, r * 2, r * 2);
      }
    };
    const stampScrub = (x: number, y: number) => {
      const L = mudL.g;
      L.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * 30;
        L.globalAlpha = 0.45 + Math.random() * 0.55;
        circle(L, x + Math.cos(a) * d, y + Math.sin(a) * d, 2 + Math.random() * 4.5); L.fill();
      }
      L.globalAlpha = 1; L.globalCompositeOperation = 'source-over';
    };

    const apply = (x0: number, y0: number, x1: number, y1: number) => {
      if (done || finishing) return;
      const tool = stages[si];
      const a = toLocal(x0, y0), b = toLocal(x1, y1);
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const step = tool === 'rinse' ? 4 : tool === 'scrub' ? 5 : 6;
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 0; i <= n; i++) {
        const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n;
        if (!inCarpet(x, y)) continue;
        if (tool === 'rinse') stampRinse(x, y);
        else if (tool === 'foam') stampFoam(x, y);
        else if (tool === 'scrub') stampScrub(x, y);
        else if (tool === 'vac') for (const q of bits) if (!q.gone && !q.fly && !q.suck && (q.x - x) ** 2 + (q.y - y) ** 2 < 34 * 34) q.suck = 0.0001;
      }
      moved += dist;
      if (!inCarpet(b.x, b.y)) return;
      if (tool === 'rinse') {
        for (let i = 0; i < Math.min(6, 1 + dist / 6); i++) {
          parts.add({ x: x1 + (Math.random() - 0.5) * 86 * k, y: y1 - 10, vx: (Math.random() - 0.5) * 260, vy: -80 - Math.random() * 220, life: 0.45, size: 2 + Math.random() * 2, color: 'rgba(205,232,255,0.9)', grav: 900, kind: 'drop' });
          if (Math.random() < 0.5) parts.add({ x: x1 + (Math.random() - 0.5) * 80 * k, y: y1 + 12, vx: (Math.random() - 0.5) * 40, vy: 60 + Math.random() * 120, life: 0.6, size: 2 + Math.random() * 2.5, color: 'rgba(118,92,62,0.85)', grav: 700, kind: 'drop' });
        }
        cc.buzz('select', 70);
      } else if (tool === 'scrub') {
        if (Math.random() < 0.7) parts.add({ x: x1 + (Math.random() - 0.5) * 50 * k, y: y1 + (Math.random() - 0.5) * 30 * k, vx: (Math.random() - 0.5) * 200, vy: -60 - Math.random() * 120, life: 0.5, size: 2 + Math.random() * 3, color: Math.random() < 0.5 ? '#5b3f26' : '#8a6a46', grav: 800, kind: 'dot' });
        cc.buzz('soft', 85);
      } else if (tool === 'foam') {
        if (Math.random() < 0.35) cc.sfx.pop(2 + Math.random() * 1.5, 0.035);
        cc.buzz('select', 120);
      }
    };

    const vacuum = (dt: number) => {
      const p = toLocal(ax, ay);
      for (const b of bits) {
        if (b.gone || b.fly || !b.suck) continue;
        b.suck += dt / 0.13;
        b.x += (p.x - b.x) * Math.min(1, b.suck); b.y += (p.y - b.y) * Math.min(1, b.suck); b.rot += 20 * dt;
        if (b.suck >= 1) { b.gone = true; if (Math.random() < 0.4) cc.sfx.crunch(0.05); cc.buzz('light', 60); }
      }
      if (!down || done || finishing) return;
      for (const b of bits) {
        if (b.gone || b.fly || b.suck) continue;
        const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy);
        if (d < 64) {
          const pull = (1 - d / 64) * 900 + 140;
          b.vx += (dx / (d || 1)) * pull * dt; b.vy += (dy / (d || 1)) * pull * dt;
          b.x += b.vx * dt; b.y += b.vy * dt; b.rot += 12 * dt;
          if (Math.hypot(p.x - b.x, p.y - b.y) < 16) b.suck = 0.0001;
        }
      }
    };

    const onDown = (e: PointerEvent) => {
      if (done) return;
      cc.sfx.wake();
      cv.setPointerCapture?.(e.pointerId);
      const p = local(e, cv);
      touchOff = e.pointerType === 'mouse' ? 0 : 40;
      down = true; px = p.x; py = p.y; ax = p.x; ay = p.y - touchOff; lastAx = ax; lastAy = ay; moved = 0;
      f.hint('');
      apply(ax, ay, ax, ay);
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const p = local(e, cv);
      px = p.x; py = p.y;
      const nx = p.x, ny = p.y - touchOff;
      apply(ax, ay, nx, ny);
      ax = nx; ay = ny;
    };
    const onUp = () => { down = false; };
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);

    const sample = () => {
      if (done || finishing) return;
      const tool = stages[si];
      let p = 0;
      if (tool === 'rinse') p = 1 - count(dirt.c, 40) / dirt0;
      else if (tool === 'scrub') p = 1 - count(mudL.c, 40) / mud0;
      else if (tool === 'foam') p = count(foam.c, 110) / (SW * SH);
      else p = bits.filter((b) => b.gone || b.suck).length / Math.max(1, bits.length);
      setProg(p / THR[tool]);
      if (p >= THR[tool]) finishStage(tool);
    };

    const finishStage = (tool: Tool) => {
      finishing = 0.0001; finTool = tool;
      if (tool === 'foam' && lastSample) {
        const d: Uint8ClampedArray = lastSample;
        fillCells = [];
        for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) if (d[(y * SW + x) * 4 + 3] <= 110) fillCells.push([((x + 0.5) * lw) / SW, ((y + 0.5) * lh) / SH]);
        fillCells.sort(() => Math.random() - 0.5);
      }
      if (tool === 'vac') for (const b of bits) if (!b.gone && !b.suck) { b.fly = 0.0001; b.vx = (Math.random() - 0.5) * 120; b.vy = -260 - Math.random() * 200; }
      setProg(1);
    };

    const stageDone = () => {
      const tool = finTool!;
      if (tool === 'rinse') { dirt.g.clearRect(0, 0, lw, lh); foam.g.clearRect(0, 0, lw, lh); fadeDirt = 1; fadeFoam = 1; }
      if (tool === 'scrub') { mudL.g.clearRect(0, 0, lw, lh); fadeMud = 1; }
      if (tool === 'vac') bits.forEach((b) => { b.gone = true; });
      finishing = 0; finTool = null;
      si++;
      if (si >= stages.length) { complete(); return; }
      cc.sfx.ding(); cc.buzz('medium');
      cc.toast(`Готово! Дальше — ${TOOL[stages[si]].name.toLowerCase()}`);
      tools();
    };

    const complete = () => {
      done = true; shine = 0;
      tools();
      cc.sfx.chime(); cc.buzz('heavy');
      setTimeout(() => cc.buzz('medium'), 160);
      cc.add(c.dirt === 'dust' ? 6 : 10);
      if (c.id !== 'random' && !cc.store.carpets.includes(c.id)) { cc.store.carpets.push(c.id); cc.save(); }
      setTimeout(showDone, 1500);
    };

    const showDone = () => {
      if (current !== idx) return;
      const after = offscreen(96, 96 * c.ratio, 2); after.g.drawImage(cl.c, 0, 0, 96, 96 * c.ratio);
      const box = el(`<div class="calm-done"><div class="calm-done-box">
        <h2>Как новый!</h2><div class="small muted">${esc(c.name)} · ${stages.map((x) => TOOL[x].name.toLowerCase()).join(' → ')}</div>
        <div class="calm-ba"><figure data-b><figcaption>Было</figcaption></figure><figure data-a><figcaption>Стало</figcaption></figure></div>
        <button class="btn btn-gold btn-block" data-next>Следующий ковёр</button>
        <button class="btn btn-ghost btn-block" data-all>Все ковры</button></div></div>`);
      tb.c.style.width = '96px'; after.c.style.width = '96px';
      box.querySelector('[data-b]')!.prepend(tb.c); box.querySelector('[data-a]')!.prepend(after.c);
      box.querySelector('[data-next]')!.addEventListener('click', () => { box.remove(); cc.buzz('light'); run(idx >= 0 && idx < CARPETS.length - 1 ? idx + 1 : -1); });
      box.querySelector('[data-all]')!.addEventListener('click', () => { box.remove(); drawPicker(); });
      f.wrap.appendChild(box);
    };

    let alive = true, raf = 0, last = performance.now(), t = 0;
    const frameFn = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      layout();
      // скорость пальца
      const v = Math.hypot(ax - lastAx, ay - lastAy) / Math.max(dt, 0.001);
      speed += (clamp(v / 900, 0, 1) - speed) * Math.min(1, dt * 10);
      lastAx = ax; lastAy = ay;
      const tool = stages[Math.min(si, stages.length - 1)];
      if (tool === 'vac') vacuum(dt);
      // звук
      const on = down && !done && !finishing;
      cc.sfx.level('water', on && tool === 'rinse' ? 0.16 + speed * 0.3 : 0, { type: 'bandpass', f: 1300 + speed * 900, q: 0.6 });
      cc.sfx.level('scrub', on && tool === 'scrub' ? 0.04 + speed * 0.45 : 0, { type: 'highpass', f: 2400 + speed * 1600, q: 0.7 });
      cc.sfx.level('foam', on && tool === 'foam' ? 0.1 + speed * 0.18 : 0, { type: 'lowpass', f: 850, q: 1.6 });
      cc.sfx.level('vac', on && tool === 'vac' ? 0.2 : 0, { type: 'lowpass', f: 1100 + speed * 500, q: 2.2 });
      // авто-доводка этапа
      if (finishing) {
        finishing += dt / 0.5;
        const e = easeInOut(finishing);
        if (finTool === 'rinse') { fadeDirt = 1 - e; fadeFoam = 1 - e; }
        if (finTool === 'scrub') fadeMud = 1 - e;
        if (finTool === 'foam') { const n = Math.ceil(fillCells.length * dt / 0.4) + 2; for (const [x, y] of fillCells.splice(0, n)) stampFoam(x, y); }
        if (finishing >= 1) stageDone();
      }
      for (const b of bits) if (b.fly && !b.gone) { b.fly += dt; b.vy += 300 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += 8 * dt; if (b.fly > 0.5) b.gone = true; }
      // мокрые полосы высыхают
      wet.g.globalCompositeOperation = 'destination-out'; wet.g.fillStyle = `rgba(0,0,0,${Math.min(1, dt * 0.16)})`; wet.g.fillRect(0, 0, lw, lh); wet.g.globalCompositeOperation = 'source-over';
      sampleT += dt;
      if (sampleT > 0.2) { sampleT = 0; sample(); }
      parts.step(dt);

      // ---- рисуем
      g.drawImage(bg!, 0, 0, W, H);
      g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 22; g.shadowOffsetY = 10; g.fillStyle = '#000'; g.fillRect(rx, ry, dw, dh); g.restore();
      // бахрома
      const total = (si + (finishing ? finishing : 0)) / stages.length;
      const fr = Math.round(150 + 90 * total), fg2 = Math.round(132 + 95 * total), fb = Math.round(108 + 95 * total);
      g.strokeStyle = `rgb(${fr},${fg2},${fb})`; g.lineWidth = 2; g.lineCap = 'round';
      for (let x = rx + 4; x < rx + dw - 2; x += 5) {
        const s = Math.sin(x * 0.7) * 2;
        g.beginPath(); g.moveTo(x, ry); g.lineTo(x + s, ry - 11); g.stroke();
        g.beginPath(); g.moveTo(x, ry + dh); g.lineTo(x - s, ry + dh + 11); g.stroke();
      }
      g.drawImage(cl.c, rx, ry, dw, dh);
      g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.5; g.drawImage(wet.c, rx, ry, dw, dh); g.restore();
      if (fadeDirt > 0.01) { g.globalAlpha = fadeDirt; g.drawImage(dirt.c, rx, ry, dw, dh); }
      if (fadeMud > 0.01) { g.globalAlpha = fadeMud; g.drawImage(mudL.c, rx, ry, dw, dh); }
      if (fadeFoam > 0.01) { g.globalAlpha = fadeFoam; g.drawImage(foam.c, rx, ry, dw, dh); }
      g.globalAlpha = 1;
      drawBits(g, bits, rx, ry, k);
      parts.draw(g);
      // финальный блеск
      if (shine >= 0) {
        shine += dt;
        const p = shine / 1.1;
        if (p < 1) {
          g.save(); g.beginPath(); g.rect(rx, ry, dw, dh); g.clip();
          const x = rx - dh * 0.6 + (dw + dh * 1.2) * easeInOut(p);
          g.translate(x, ry + dh / 2); g.rotate(0.45);
          const gr = g.createLinearGradient(-50, 0, 50, 0);
          gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr; g.fillRect(-50, -dh * 1.2, 100, dh * 2.4);
          g.restore();
        }
        if (shine < 1.4 && Math.random() < 0.7) parts.add({ x: rx + Math.random() * dw, y: ry + Math.random() * dh, vx: 0, vy: -10, life: 0.7, size: 5 + Math.random() * 7, color: Math.random() < 0.6 ? '#ffffff' : '#ffe08a', grav: 0, kind: 'spark' });
      }
      // инструмент
      if (down && !done) drawTool(g, tool, ax, ay, px, py, k, t, speed, (wig += dt * (8 + speed * 30)));
      raf = requestAnimationFrame(frameFn);
    };
    raf = requestAnimationFrame(frameFn);

    return () => {
      alive = false; cancelAnimationFrame(raf);
      cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp); cv.removeEventListener('pointercancel', onUp);
      cc.sfx.hush();
      f.wrap.querySelector('.calm-done')?.remove();
    };
  }

  drawPicker();
  return { node: f.node, stop: () => { stopRun(); cc.sfx.hush(); } };
}

function drawTool(g: G, tool: Tool, x: number, y: number, fx: number, fy: number, k: number, t: number, speed: number, wig: number) {
  g.save();
  g.lineCap = 'round';
  if (tool === 'rinse') {
    const bw = 86 * k, bh = 22 * k;
    g.strokeStyle = '#ffcc33'; g.lineWidth = 8; g.beginPath(); g.moveTo(x, y + bh / 2 + 6); g.lineTo(fx, fy + 26); g.stroke();
    g.strokeStyle = '#2b3240'; g.lineWidth = 5; g.beginPath(); g.moveTo(x, y + bh / 2 + 2); g.lineTo(x, y + bh / 2 + 16); g.stroke();
    const gr = g.createLinearGradient(0, y - bh / 2, 0, y + bh / 2);
    gr.addColorStop(0, 'rgba(210,238,255,0.15)'); gr.addColorStop(0.5, 'rgba(225,245,255,0.6)'); gr.addColorStop(1, 'rgba(210,238,255,0.2)');
    g.fillStyle = gr; g.fillRect(x - bw / 2, y - bh / 2, bw, bh);
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const xx = x - bw / 2 + ((i * 37 + t * 900) % bw);
      g.beginPath(); g.moveTo(xx, y - bh / 2); g.lineTo(xx + 3, y + bh / 2); g.stroke();
    }
    g.fillStyle = '#2b3240'; g.fillRect(x - bw / 2 - 4, y + bh / 2, bw + 8, 7);
    g.fillStyle = '#ffcc33'; g.fillRect(x - bw / 2 - 4, y + bh / 2 + 5, bw + 8, 2);
  } else if (tool === 'foam') {
    g.strokeStyle = '#3a86ff'; g.lineWidth = 7; g.beginPath(); g.moveTo(x, y + 12); g.lineTo(fx, fy + 26); g.stroke();
    g.fillStyle = '#1d3557'; g.beginPath(); g.ellipse(x, y + 10, 9, 6, 0, 0, 7); g.fill();
    for (let i = 0; i < 6; i++) {
      const a = t * 3 + i * 1.05, r = 14 + Math.sin(t * 7 + i) * 3;
      g.fillStyle = 'rgba(255,255,255,0.75)'; circle(g, x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.6, 5 + (i % 3)); g.fill();
    }
  } else if (tool === 'scrub') {
    g.translate(x, y); g.rotate(Math.sin(wig) * (0.12 + speed * 0.3));
    const w = 64 * k, h = 26 * k;
    g.fillStyle = '#f2e3c6'; g.fillRect(-w / 2 + 3, h * 0.1, w - 6, h * 0.55);
    g.strokeStyle = 'rgba(120,100,70,0.6)'; g.lineWidth = 1;
    for (let i = -w / 2 + 6; i < w / 2 - 4; i += 4) { g.beginPath(); g.moveTo(i, h * 0.15); g.lineTo(i + 1, h * 0.65); g.stroke(); }
    const wood = g.createLinearGradient(0, -h / 2, 0, h * 0.2);
    wood.addColorStop(0, '#c47a3d'); wood.addColorStop(1, '#8a4a1f');
    g.fillStyle = wood; g.beginPath(); g.ellipse(0, -h * 0.12, w / 2, h * 0.38, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(-w * 0.12, -h * 0.28, w * 0.25, h * 0.08, 0, 0, 7); g.fill();
  } else {
    g.strokeStyle = '#6c757d'; g.lineWidth = 9; g.beginPath(); g.moveTo(x, y + 8); g.quadraticCurveTo(x + 20, fy, fx + 6, fy + 30); g.stroke();
    g.fillStyle = '#343a40'; g.beginPath(); g.moveTo(x - 36 * k, y + 8); g.lineTo(x + 36 * k, y + 8); g.lineTo(x + 26 * k, y - 8); g.lineTo(x - 26 * k, y - 8); g.closePath(); g.fill();
    g.fillStyle = '#111'; g.fillRect(x - 30 * k, y + 4, 60 * k, 4);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) { const r = 20 + ((t * 60 + i * 14) % 42); g.globalAlpha = 1 - (r - 20) / 42; circle(g, x, y, r); g.stroke(); }
  }
  g.restore();
}
