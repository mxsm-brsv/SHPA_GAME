// «Антистресс» → Слаймы: мягкое тело из кольца точек (пружины + давление + память формы).
// «Мять» — тянешь и вдавливаешь, внутри лопаются пузырьки или хрустят шарики.
// «Резать» — свайп через слайм делит его на два, между кусками тянутся нити. Кусок, притащенный к другому, сливается.
import { clamp, frame, local, offscreen, Parts, type CalmCtx, type Scene } from './calm-kit';

export interface Kind { id: string; name: string; base: string; dark: string; light: string; alpha: number; gloss: number; glitter?: string[]; beads?: string[]; bolts?: boolean; metal?: boolean; cloud?: boolean }
export const KINDS: Kind[] = [
  { id: 'glossy', name: 'Глянцевый', base: '#4fb8ff', dark: '#1f5fcf', light: '#c9f1ff', alpha: 0.88, gloss: 0.75, glitter: ['#ffffff', '#e0f7ff', '#ffd6f5', '#fff3a8'] },
  { id: 'cloud', name: 'Облачко', base: '#ffb3d6', dark: '#ec79ae', light: '#fff1f8', alpha: 1, gloss: 0.22, cloud: true },
  { id: 'crunch', name: 'Хрустящий', base: '#8ff0c0', dark: '#2fb47c', light: '#e6fff3', alpha: 0.9, gloss: 0.55, beads: ['#ffffff', '#ffe0f0', '#d9ecff'] },
  { id: 'gold', name: 'Золотой металлик', base: '#f2c14e', dark: '#9c6b10', light: '#fff4c2', alpha: 1, gloss: 0.6, metal: true, glitter: ['#fff8d6', '#ffe08a'] },
  { id: 'profkom', name: 'Профком', base: '#0396DA', dark: '#0B2A3D', light: '#a8e3ff', alpha: 0.92, gloss: 0.7, bolts: true, glitter: ['#ffffff', '#ffd24a'] },
];

interface Dot { i: number; r: number; s: number; c: string; a: number }
export interface Slime { n: number; x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array; fx: Float32Array; fy: Float32Array; A0: number; rest: number; kind: Kind; dots: Dot[]; bub: { i: number; r: number; s: number; t: number }[]; cx: number; cy: number; R: number }
interface Strand { a: Slime; ia: number; b: Slime; ib: number }

const KS = 2600, KD = 14, KP = 2200, KSH = 22, GRAV = 520, DAMP = 2.3;

export function makeSlime(pts: { x: number; y: number; vx?: number; vy?: number }[], kind: Kind, A0?: number): Slime {
  const n = pts.length;
  const s: Slime = {
    n, x: new Float32Array(n), y: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n), fx: new Float32Array(n), fy: new Float32Array(n),
    A0: 0, rest: 0, kind, dots: [], bub: [], cx: 0, cy: 0, R: 0,
  };
  pts.forEach((p, i) => { s.x[i] = p.x; s.y[i] = p.y; s.vx[i] = p.vx ?? 0; s.vy[i] = p.vy ?? 0; });
  const a = area(s);
  if (a < 0) { s.x.reverse(); s.y.reverse(); s.vx.reverse(); s.vy.reverse(); }
  s.A0 = A0 ?? Math.abs(a);
  s.R = Math.sqrt(s.A0 / Math.PI);
  s.rest = (2 * Math.PI * s.R) / n;
  fillDots(s);
  return s;
}
export function circleSlime(cx: number, cy: number, R: number, kind: Kind) {
  const n = clamp(Math.round((2 * Math.PI * R) / 9), 18, 60);
  return makeSlime(Array.from({ length: n }, (_, i) => ({ x: cx + Math.cos((i / n) * Math.PI * 2) * R, y: cy + Math.sin((i / n) * Math.PI * 2) * R })), kind);
}
function fillDots(s: Slime) {
  const k = s.kind, m = Math.round(s.A0 / 520);
  s.dots = [];
  const add = (cols: string[], cnt: number, sz: [number, number]) => {
    for (let j = 0; j < cnt; j++) s.dots.push({ i: (Math.random() * s.n) | 0, r: Math.sqrt(Math.random()) * 0.86, s: sz[0] + Math.random() * (sz[1] - sz[0]), c: cols[(Math.random() * cols.length) | 0], a: Math.random() * 6.28 });
  };
  if (k.beads) add(k.beads, Math.round(m * 1.4), [3.5, 6]);
  if (k.glitter) add(k.glitter, m, [1.2, 2.8]);
  if (k.bolts) add(['#ffffff'], Math.max(3, Math.round(m / 5)), [7, 11]);
  if (k.cloud) add(['#ffffff'], Math.round(m / 2), [5, 12]);
}
export function area(s: Slime) {
  let A = 0;
  for (let i = 0, n = s.n; i < n; i++) { const j = (i + 1) % n; A += s.x[i] * s.y[j] - s.x[j] * s.y[i]; }
  return A / 2;
}
function centroid(s: Slime) {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0, n = s.n; i < n; i++) {
    const j = (i + 1) % n, cr = s.x[i] * s.y[j] - s.x[j] * s.y[i];
    A += cr; cx += (s.x[i] + s.x[j]) * cr; cy += (s.y[i] + s.y[j]) * cr;
  }
  A /= 2;
  if (Math.abs(A) < 1e-3) return { cx: s.x[0], cy: s.y[0], A };
  return { cx: cx / (6 * A), cy: cy / (6 * A), A };
}

export interface Grab { s: Slime; w: Float32Array; ox: Float32Array; oy: Float32Array; px: number; py: number }

/** Один подшаг физики для всех слаймов. */
export function stepSlimes(list: Slime[], dt: number, box: { w: number; floor: number }, grab: Grab | null, strands: Strand[]) {
  for (const s of list) {
    const { n, x: X, y: Y, vx: VX, vy: VY, fx: FX, fy: FY } = s;
    const c = centroid(s);
    s.cx = c.cx; s.cy = c.cy;
    const P = (KP * (s.A0 - c.A)) / s.A0;
    FX.fill(0); FY.fill(0);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = X[j] - X[i], dy = Y[j] - Y[i], l = Math.hypot(dx, dy) || 0.001;
      const ux = dx / l, uy = dy / l;
      const rv = (VX[j] - VX[i]) * ux + (VY[j] - VY[i]) * uy;
      const f = KS * (l - s.rest) / s.rest * 10 + KD * rv;
      FX[i] += f * ux; FY[i] += f * uy; FX[j] -= f * ux; FY[j] -= f * uy;
      const pf = P * 0.5;
      FX[i] += pf * dy; FY[i] -= pf * dx; FX[j] += pf * dy; FY[j] -= pf * dx;
    }
    for (let i = 0; i < n; i++) {
      const rx = X[i] - c.cx, ry = Y[i] - c.cy, r = Math.hypot(rx, ry) || 0.001;
      FX[i] += KSH * (c.cx + (rx / r) * s.R - X[i]);
      FY[i] += KSH * (c.cy + (ry / r) * s.R - Y[i]) + GRAV;
    }
  }
  if (grab) {
    const s = grab.s;
    for (let i = 0; i < s.n; i++) {
      const w = grab.w[i];
      if (w < 0.01) continue;
      s.fx[i] += w * (1400 * (grab.px + grab.ox[i] - s.x[i]) - 26 * s.vx[i]);
      s.fy[i] += w * (1400 * (grab.py + grab.oy[i] - s.y[i]) - 26 * s.vy[i]);
    }
  }
  for (const st of strands) {
    const dx = st.b.x[st.ib] - st.a.x[st.ia], dy = st.b.y[st.ib] - st.a.y[st.ia];
    st.a.fx[st.ia] += dx * 45; st.a.fy[st.ia] += dy * 45; st.b.fx[st.ib] -= dx * 45; st.b.fy[st.ib] -= dy * 45;
  }
  const damp = Math.max(0, 1 - DAMP * dt);
  for (const s of list) {
    const { n, x: X, y: Y, vx: VX, vy: VY, fx: FX, fy: FY } = s;
    for (let i = 0; i < n; i++) {
      VX[i] = (VX[i] + FX[i] * dt) * damp; VY[i] = (VY[i] + FY[i] * dt) * damp;
      X[i] += VX[i] * dt; Y[i] += VY[i] * dt;
      if (Y[i] > box.floor) { Y[i] = box.floor; if (VY[i] > 0) VY[i] *= -0.05; VX[i] *= 0.86; }
      if (Y[i] < 6) { Y[i] = 6; if (VY[i] < 0) VY[i] = 0; }
      if (X[i] < 6) { X[i] = 6; if (VX[i] < 0) VX[i] *= -0.2; }
      if (X[i] > box.w - 6) { X[i] = box.w - 6; if (VX[i] > 0) VX[i] *= -0.2; }
    }
  }
}

function polyArea(p: { x: number; y: number }[]) {
  let A = 0;
  for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; A += p[i].x * p[j].y - p[j].x * p[i].y; }
  return A / 2;
}
type VP = { x: number; y: number; vx: number; vy: number };
function resample(p: VP[], m: number): VP[] {
  const segs: number[] = [];
  let per = 0;
  for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; const l = Math.hypot(p[j].x - p[i].x, p[j].y - p[i].y); segs.push(l); per += l; }
  const out: VP[] = [];
  let i = 0, acc = 0;
  for (let k = 0; k < m; k++) {
    const target = (k / m) * per;
    while (acc + segs[i] < target && i < p.length - 1) { acc += segs[i]; i++; }
    const j = (i + 1) % p.length, t = segs[i] ? (target - acc) / segs[i] : 0;
    out.push({ x: p[i].x + (p[j].x - p[i].x) * t, y: p[i].y + (p[j].y - p[i].y) * t, vx: p[i].vx + (p[j].vx - p[i].vx) * t, vy: p[i].vy + (p[j].vy - p[i].vy) * t });
  }
  return out;
}

/** Разрез прямой A→B. Возвращает два новых слайма или null, если свайп не прошёл насквозь. */
export function splitSlime(s: Slime, ax: number, ay: number, bx: number, by: number, minArea = 650): [Slime, Slime, { x: number; y: number }[]] | null {
  const n = s.n, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  if (L2 < 400) return null;
  const side = (i: number) => (s.x[i] - ax) * dy - (s.y[i] - ay) * dx;
  const cr: { i: number; p: VP }[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, si = side(i), sj = side(j);
    if ((si > 0) !== (sj > 0)) {
      const t = si / (si - sj);
      const p = { x: s.x[i] + (s.x[j] - s.x[i]) * t, y: s.y[i] + (s.y[j] - s.y[i]) * t, vx: (s.vx[i] + s.vx[j]) / 2, vy: (s.vy[i] + s.vy[j]) / 2 };
      const u = ((p.x - ax) * dx + (p.y - ay) * dy) / L2;
      if (u < -0.02 || u > 1.02) return null;
      cr.push({ i, p });
    }
  }
  if (cr.length !== 2) return null;
  const [c0, c1] = cr;
  let mvx = 0, mvy = 0;
  for (let i = 0; i < n; i++) { mvx += s.vx[i]; mvy += s.vy[i]; }
  mvx /= n; mvy /= n;
  const chord = (from: VP, to: VP) => {
    const l = Math.hypot(to.x - from.x, to.y - from.y), k = Math.max(0, Math.floor(l / (s.rest * 1.1)));
    const out: VP[] = [];
    for (let q = 1; q <= k; q++) { const t = q / (k + 1); out.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, vx: mvx, vy: mvy }); }
    return out;
  };
  const pt = (i: number): VP => ({ x: s.x[i], y: s.y[i], vx: s.vx[i], vy: s.vy[i] });
  const A: VP[] = [c0.p];
  for (let i = (c0.i + 1) % n; ; i = (i + 1) % n) { A.push(pt(i)); if (i === c1.i) break; }
  A.push(c1.p, ...chord(c1.p, c0.p));
  const B: VP[] = [c1.p];
  for (let i = (c1.i + 1) % n; ; i = (i + 1) % n) { B.push(pt(i)); if (i === c0.i) break; }
  B.push(c0.p, ...chord(c0.p, c1.p));
  const aA = Math.abs(polyArea(A)), aB = Math.abs(polyArea(B));
  if (aA < minArea || aB < minArea) return null;
  const mk = (p: VP[], a: number) => {
    const m = clamp(Math.round((2 * Math.PI * Math.sqrt(a / Math.PI)) / 8), 14, 56);
    return makeSlime(resample(p, m), s.kind, a);
  };
  const sa = mk(A, aA), sb = mk(B, aB);
  // разлетаются от линии разреза
  const nl = Math.sqrt(L2), nx = dy / nl, ny = -dx / nl;
  const push = (q: Slime, sign: number) => { for (let i = 0; i < q.n; i++) { q.vx[i] += nx * sign * 70; q.vy[i] += ny * sign * 70 - 30; } };
  const ca = centroid(sa);
  const sgn = (ca.cx - ax) * nx + (ca.cy - ay) * ny > 0 ? 1 : -1;
  push(sa, sgn); push(sb, -sgn);
  return [sa, sb, [c0.p, c1.p]];
}

function hull(p: { x: number; y: number; vx: number; vy: number }[]) {
  const pts = [...p].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: VP, a: VP, b: VP) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: VP[] = [], up: VP[] = [];
  for (const q of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
export function mergeSlimes(a: Slime, b: Slime): Slime {
  const pts: VP[] = [];
  for (const s of [a, b]) for (let i = 0; i < s.n; i++) pts.push({ x: s.x[i], y: s.y[i], vx: s.vx[i], vy: s.vy[i] });
  const h = hull(pts);
  const A0 = a.A0 + b.A0;
  const m = clamp(Math.round((2 * Math.PI * Math.sqrt(A0 / Math.PI)) / 9), 18, 60);
  return makeSlime(resample(h, m), a.kind, A0);
}

function pathOf(g: CanvasRenderingContext2D, s: Slime) {
  const { n, x: X, y: Y } = s;
  g.beginPath();
  g.moveTo((X[n - 1] + X[0]) / 2, (Y[n - 1] + Y[0]) / 2);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; g.quadraticCurveTo(X[i], Y[i], (X[i] + X[j]) / 2, (Y[i] + Y[j]) / 2); }
  g.closePath();
}
function inside(s: Slime, px: number, py: number) {
  let ins = false;
  for (let i = 0, j = s.n - 1; i < s.n; j = i++) {
    if ((s.y[i] > py) !== (s.y[j] > py) && px < ((s.x[j] - s.x[i]) * (py - s.y[i])) / (s.y[j] - s.y[i]) + s.x[i]) ins = !ins;
  }
  return ins;
}
function boltPath(g: CanvasRenderingContext2D, x: number, y: number, s: number, a: number) {
  g.save(); g.translate(x, y); g.rotate(a);
  g.beginPath(); g.moveTo(0.15 * s, -0.5 * s); g.lineTo(-0.28 * s, 0.06 * s); g.lineTo(-0.02 * s, 0.06 * s); g.lineTo(-0.15 * s, 0.5 * s); g.lineTo(0.28 * s, -0.08 * s); g.lineTo(0.02 * s, -0.08 * s); g.closePath();
  g.fill(); g.restore();
}

const beadCache = new Map<string, HTMLCanvasElement>();
function bead(c: string) {
  let b = beadCache.get(c);
  if (!b) {
    const o = offscreen(16, 16, 2), g = o.g;
    const gr = g.createRadialGradient(6, 5.5, 0.5, 8, 8, 8);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, c); gr.addColorStop(1, 'rgba(120,130,150,0.9)');
    g.fillStyle = gr; g.beginPath(); g.arc(8, 8, 7.5, 0, 7); g.fill();
    b = o.c; beadCache.set(c, b);
  }
  return b;
}

function drawSlime(g: CanvasRenderingContext2D, s: Slime, floor: number, t: number) {
  const k = s.kind;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < s.n; i++) { x0 = Math.min(x0, s.x[i]); x1 = Math.max(x1, s.x[i]); y0 = Math.min(y0, s.y[i]); y1 = Math.max(y1, s.y[i]); }
  const w = x1 - x0, h = y1 - y0;
  // тень
  const lift = clamp((floor - y1) / 80, 0, 1);
  const sg = g.createRadialGradient((x0 + x1) / 2, floor + 2, 2, (x0 + x1) / 2, floor + 2, w * 0.6);
  sg.addColorStop(0, `rgba(60,30,60,${0.3 * (1 - lift * 0.7)})`); sg.addColorStop(1, 'rgba(60,30,60,0)');
  g.fillStyle = sg; g.beginPath(); g.ellipse((x0 + x1) / 2, floor + 3, w * 0.6, 10, 0, 0, 7); g.fill();

  pathOf(g, s);
  let fill: CanvasGradient;
  if (k.metal) {
    fill = g.createLinearGradient(x0, y0, x1, y1);
    fill.addColorStop(0, k.light); fill.addColorStop(0.3, k.base); fill.addColorStop(0.5, k.dark); fill.addColorStop(0.68, k.light); fill.addColorStop(1, k.base);
  } else {
    fill = g.createLinearGradient(0, y0, 0, y1);
    fill.addColorStop(0, k.light); fill.addColorStop(0.35, k.base); fill.addColorStop(1, k.dark);
  }
  g.globalAlpha = k.alpha; g.fillStyle = fill; g.fill(); g.globalAlpha = 1;

  g.save(); g.clip();
  // начинка
  for (const d of s.dots) {
    const i = d.i % s.n, px = s.cx + (s.x[i] - s.cx) * d.r, py = s.cy + (s.y[i] - s.cy) * d.r;
    if (k.beads && d.s > 3.3) { g.drawImage(bead(d.c), px - d.s, py - d.s, d.s * 2, d.s * 2); continue; }
    if (k.bolts && d.s > 6.5) { g.fillStyle = d.c; g.globalAlpha = 0.9; boltPath(g, px, py, d.s * 1.6, d.a); g.globalAlpha = 1; continue; }
    if (k.cloud) { g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.arc(px, py, d.s, 0, 7); g.fill(); continue; }
    const tw = 0.55 + 0.45 * Math.sin(t * 3 + d.a * 5);
    g.fillStyle = d.c; g.globalAlpha = tw;
    g.fillRect(px - d.s / 2, py - d.s / 2, d.s, d.s);
    g.globalAlpha = 1;
  }
  // пузырьки
  for (const b of s.bub) {
    const i = b.i % s.n, px = s.cx + (s.x[i] - s.cx) * b.r, py = s.cy + (s.y[i] - s.cy) * b.r;
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.2; g.beginPath(); g.arc(px, py, b.s, 0, 7); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(px - b.s * 0.35, py - b.s * 0.35, b.s * 0.25, 0, 7); g.fill();
  }
  // объём: тень по краю изнутри
  pathOf(g, s);
  g.lineWidth = 24; g.strokeStyle = k.cloud ? 'rgba(160,60,110,0.12)' : 'rgba(10,20,60,0.2)'; g.stroke();
  // блики
  g.fillStyle = `rgba(255,255,255,${k.gloss * 0.7})`;
  g.beginPath(); g.ellipse(x0 + w * 0.33, y0 + h * 0.24, Math.max(4, w * 0.17), Math.max(2, h * 0.08), -0.45, 0, 7); g.fill();
  g.fillStyle = `rgba(255,255,255,${k.gloss})`;
  g.beginPath(); g.arc(x0 + w * 0.2, y0 + h * 0.36, Math.max(1.5, Math.min(w, h) * 0.035), 0, 7); g.fill();
  g.strokeStyle = `rgba(255,255,255,${k.gloss * 0.35})`; g.lineWidth = 3;
  g.beginPath(); g.ellipse(x0 + w * 0.55, y0 + h * 0.86, w * 0.3, h * 0.08, 0, 0.3, 2.8); g.stroke();
  g.restore();
  pathOf(g, s);
  g.lineWidth = 1.4; g.strokeStyle = k.cloud ? 'rgba(200,90,140,0.3)' : 'rgba(10,20,60,0.3)'; g.stroke();
}

export function slimeScene(cc: CalmCtx): Scene {
  const f = frame(cc, 'Слаймы');
  const cv = f.canvas;
  let g = cv.getContext('2d')!;
  let W = 360, H = 520, dpr = 1, floor = 470;
  let bg: HTMLCanvasElement | null = null;
  let ki = (cc.store.slime ?? 0) % KINDS.length;
  let mode: 'hand' | 'knife' = 'hand';
  let slimes: Slime[] = [];
  let strands: Strand[] = [];
  const parts = new Parts(300);

  const layout = () => {
    const r = f.wrap.getBoundingClientRect();
    const nw = Math.round(r.width) || 360, nh = Math.round(r.height) || 520, nd = Math.min(2, window.devicePixelRatio || 1);
    if (nw === W && nh === H && nd === dpr && bg) return;
    W = nw; H = nh; dpr = nd; floor = H - 46;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    g = cv.getContext('2d')!;
    const o = offscreen(W, H, dpr), s = o.g;
    const wall = s.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, '#3b2f6e'); wall.addColorStop(0.6, '#7d5aa6'); wall.addColorStop(1, '#5a3f86');
    s.fillStyle = wall; s.fillRect(0, 0, W, H);
    const ty = floor - 70;
    const tg = s.createLinearGradient(0, ty, 0, H);
    tg.addColorStop(0, '#e9e6f2'); tg.addColorStop(1, '#cfcade');
    s.fillStyle = tg; s.fillRect(0, ty, W, H - ty);
    s.strokeStyle = 'rgba(140,130,170,0.35)'; s.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      let x = (i * 71) % W, y = ty + 6;
      s.beginPath(); s.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += 14 + ((i * 7 + k * 13) % 19); y += ((k * 11 + i * 5) % 9) - 2; s.lineTo(x, Math.min(H, y)); }
      s.stroke();
    }
    s.fillStyle = 'rgba(255,255,255,0.5)'; s.fillRect(0, ty, W, 2);
    bg = o.c;
    if (!slimes.length) fresh();
  };
  const fresh = () => {
    const R = clamp(Math.min(W, H) * 0.27, 70, 120);
    slimes = [circleSlime(W / 2, floor - R - 30, R, KINDS[ki])];
    strands = [];
    f.info(KINDS[ki].name);
  };

  const drawTools = () => {
    f.tools.innerHTML = `<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
      <div class="calm-seg"><button class="${mode === 'hand' ? 'on' : ''}" data-m="hand">Мять</button><button class="${mode === 'knife' ? 'on' : ''}" data-m="knife">Резать</button></div>
      <span class="grow"></span>
      <button class="btn btn-ghost btn-sm" data-new>Новый слайм</button></div>`;
    f.tools.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.m as 'hand' | 'knife'; cc.buzz('light'); drawTools();
      f.hint(mode === 'hand' ? 'Тяни, вдавливай, тащи кусочки друг к другу — они слипнутся' : 'Проведи пальцем через слайм — разрежешь');
    }));
    f.tools.querySelector('[data-new]')!.addEventListener('click', () => {
      ki = (ki + 1) % KINDS.length; cc.store.slime = ki; cc.save(); cc.buzz('light'); cc.sfx.plop(0.35);
      slimes = []; fresh();
    });
  };
  drawTools();
  f.hint('Тяни, вдавливай, тащи кусочки друг к другу — они слипнутся');

  // ---------- ввод ----------
  let grab: Grab | null = null, down = false, knead = 0;
  let knife: { ax: number; ay: number; trail: { x: number; y: number; t: number }[]; cut: Set<Slime> } | null = null;
  let lastX = 0, lastY = 0;

  const startGrab = (s: Slime, x: number, y: number) => {
    const w = new Float32Array(s.n), ox = new Float32Array(s.n), oy = new Float32Array(s.n);
    const rad = Math.max(40, s.R * 0.6);
    for (let i = 0; i < s.n; i++) {
      const d = Math.hypot(s.x[i] - x, s.y[i] - y);
      w[i] = Math.exp(-(d * d) / (2 * rad * rad));
      ox[i] = s.x[i] - x; oy[i] = s.y[i] - y;
    }
    grab = { s, w, ox, oy, px: x, py: y };
  };
  const poke = (s: Slime, x: number, y: number) => {
    for (let i = 0; i < s.n; i++) {
      const d = Math.hypot(s.x[i] - x, s.y[i] - y);
      if (d < 50) {
        const rx = s.x[i] - s.cx, ry = s.y[i] - s.cy, r = Math.hypot(rx, ry) || 1, k = (1 - d / 50) * 220;
        s.vx[i] -= (rx / r) * k; s.vy[i] -= (ry / r) * k;
      }
    }
    if (s.kind.beads) { for (let i = 0; i < 4; i++) setTimeout(() => cc.sfx.crunch(0.16), i * 35); cc.buzz('rigid'); }
    else { cc.sfx.squish(0.32); cc.buzz('soft'); }
    if (!s.kind.beads) for (let i = 0; i < 2 + ((Math.random() * 3) | 0); i++) s.bub.push({ i: (Math.random() * s.n) | 0, r: 0.3 + Math.random() * 0.55, s: 2 + Math.random() * 3.5, t: 0.15 + Math.random() * 0.7 });
  };

  const onDown = (e: PointerEvent) => {
    cc.sfx.wake();
    cv.setPointerCapture?.(e.pointerId);
    const p = local(e, cv);
    down = true; lastX = p.x; lastY = p.y; knead = 0;
    f.hint('');
    if (mode === 'knife') { knife = { ax: p.x, ay: p.y, trail: [{ x: p.x, y: p.y, t: 0 }], cut: new Set() }; return; }
    let hit: Slime | null = null;
    for (let i = slimes.length - 1; i >= 0; i--) if (inside(slimes[i], p.x, p.y)) { hit = slimes[i]; break; }
    if (!hit) {
      let best = 1e9;
      for (const s of slimes) { const d = Math.hypot(s.cx - p.x, s.cy - p.y) - s.R; if (d < 28 && d < best) { best = d; hit = s; } }
    }
    if (hit) { slimes.splice(slimes.indexOf(hit), 1); slimes.push(hit); poke(hit, p.x, p.y); startGrab(hit, p.x, p.y); }
  };
  const onMove = (e: PointerEvent) => {
    if (!down) return;
    const p = local(e, cv);
    const dist = Math.hypot(p.x - lastX, p.y - lastY);
    lastX = p.x; lastY = p.y;
    if (knife) {
      knife.trail.push({ x: p.x, y: p.y, t: 0 });
      if (Math.hypot(p.x - knife.ax, p.y - knife.ay) > 30) tryCut(knife.ax, knife.ay, p.x, p.y);
      return;
    }
    if (grab) {
      grab.px = p.x; grab.py = p.y;
      knead += dist;
      if (knead > 22) {
        knead = 0;
        const s = grab.s;
        if (s.kind.beads) { cc.sfx.crunch(0.12 + Math.random() * 0.1); cc.buzz('select', 60); }
        else { cc.sfx.squish(0.1 + Math.random() * 0.08); cc.buzz('soft', 110); if (Math.random() < 0.5) s.bub.push({ i: (Math.random() * s.n) | 0, r: 0.3 + Math.random() * 0.6, s: 1.5 + Math.random() * 3, t: 0.2 + Math.random() * 0.5 }); }
      }
    }
  };
  const onUp = () => {
    down = false;
    if (grab) { cc.sfx.squish(0.12); grab = null; }
    knife = null;
  };
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);

  const tryCut = (ax: number, ay: number, bx: number, by: number) => {
    if (!knife) return;
    for (const s of [...slimes]) {
      if (knife.cut.has(s)) continue;
      if (slimes.length >= 10) { f.hint('Кусочков много — переключись на «Мять» и слепи их'); break; }
      const r = splitSlime(s, ax, ay, bx, by);
      if (!r) continue;
      const [a, b, ends] = r;
      slimes.splice(slimes.indexOf(s), 1, a, b);
      knife.cut.add(a); knife.cut.add(b);
      for (const t of [0.25, 0.5, 0.75]) {
        const qx = ends[0].x + (ends[1].x - ends[0].x) * t, qy = ends[0].y + (ends[1].y - ends[0].y) * t;
        const near = (q: Slime) => { let bi = 0, bd = 1e9; for (let i = 0; i < q.n; i++) { const d = Math.hypot(q.x[i] - qx, q.y[i] - qy); if (d < bd) { bd = d; bi = i; } } return bi; };
        strands.push({ a, ia: near(a), b, ib: near(b) });
      }
      strands = strands.filter((st) => slimes.includes(st.a) && slimes.includes(st.b));
      cc.sfx.squish(0.4); cc.sfx.whoosh(0.1); cc.buzz('rigid');
      for (let i = 0; i < 10; i++) {
        const t = Math.random();
        parts.add({ x: ends[0].x + (ends[1].x - ends[0].x) * t, y: ends[0].y + (ends[1].y - ends[0].y) * t, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 100, life: 0.5, size: 2 + Math.random() * 3, color: s.kind.base, grav: 700, kind: 'drop' });
      }
      cc.add(1);
    }
  };

  // ---------- кадр ----------
  let alive = true, raf = 0, last = performance.now(), t = 0;
  const step = (now: number) => {
    if (!alive) return;
    const dt = Math.min(0.04, (now - last) / 1000); last = now; t += dt;
    layout();
    const sub = 5, h = dt / sub;
    for (let k = 0; k < sub; k++) stepSlimes(slimes, h, { w: W, floor }, grab, strands);
    // нити рвутся
    for (let i = strands.length - 1; i >= 0; i--) {
      const st = strands[i];
      const ax = st.a.x[st.ia], ay = st.a.y[st.ia], bx = st.b.x[st.ib], by = st.b.y[st.ib];
      if (Math.hypot(bx - ax, by - ay) > 80 || !slimes.includes(st.a) || !slimes.includes(st.b)) {
        strands.splice(i, 1);
        if (slimes.includes(st.a)) {
          cc.sfx.pop(1.4 + Math.random() * 0.4, 0.08); cc.buzz('light', 40);
          for (let q = 0; q < 4; q++) parts.add({ x: (ax + bx) / 2, y: (ay + by) / 2, vx: (Math.random() - 0.5) * 80, vy: -20 - Math.random() * 40, life: 0.6, size: 2 + Math.random() * 2, color: st.a.kind.base, grav: 600, kind: 'drop' });
        }
      }
    }
    // слияние: тащишь кусок к другому
    if (grab) {
      const s = grab.s;
      for (const o of slimes) {
        if (o === s) continue;
        if (Math.hypot(o.cx - s.cx, o.cy - s.cy) < (o.R + s.R) * 0.78) {
          const m = mergeSlimes(s, o);
          slimes = slimes.filter((q) => q !== s && q !== o); slimes.push(m);
          strands = strands.filter((st) => slimes.includes(st.a) && slimes.includes(st.b));
          startGrab(m, grab.px, grab.py);
          cc.sfx.plop(0.5); cc.buzz('medium'); cc.add(1);
          break;
        }
      }
    }
    // пузырьки лопаются
    for (const s of slimes) for (let i = s.bub.length - 1; i >= 0; i--) {
      const b = s.bub[i]; b.t -= dt;
      if (b.t <= 0) {
        s.bub.splice(i, 1);
        cc.sfx.pop(2.3 + Math.random(), 0.05);
        const j = b.i % s.n;
        parts.add({ x: s.cx + (s.x[j] - s.cx) * b.r, y: s.cy + (s.y[j] - s.cy) * b.r, vx: 0, vy: 0, life: 0.25, size: b.s, color: 'rgba(255,255,255,0.9)', grav: 0, kind: 'ring' });
      }
    }
    parts.step(dt);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(bg!, 0, 0, W, H);
    for (const st of strands) {
      const ax = st.a.x[st.ia], ay = st.a.y[st.ia], bx = st.b.x[st.ib], by = st.b.y[st.ib];
      const d = Math.hypot(bx - ax, by - ay);
      g.strokeStyle = st.a.kind.base; g.globalAlpha = 0.85; g.lineCap = 'round';
      g.lineWidth = Math.max(1, 7 - d / 12);
      g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + d * 0.22, bx, by); g.stroke();
      g.globalAlpha = 1;
    }
    for (const s of slimes) drawSlime(g, s, floor, t);
    parts.draw(g);
    if (knife) {
      for (const p of knife.trail) p.t += dt;
      knife.trail = knife.trail.filter((p) => p.t < 0.25);
      if (knife.trail.length > 1) {
        g.lineCap = 'round'; g.lineJoin = 'round';
        for (let i = 1; i < knife.trail.length; i++) {
          const a = knife.trail[i - 1], b = knife.trail[i];
          g.strokeStyle = `rgba(255,255,255,${0.9 * (1 - b.t / 0.25)})`; g.lineWidth = 5 * (1 - b.t / 0.25) + 1;
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
      }
    }
    raf = requestAnimationFrame(step);
  };
  layout();
  raf = requestAnimationFrame(step);
  return {
    node: f.node,
    stop: () => {
      alive = false; cancelAnimationFrame(raf);
      cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp); cv.removeEventListener('pointercancel', onUp);
    },
  };
}
