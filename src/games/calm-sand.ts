// «Антистресс» → Кинетический песок: проводишь ножом сверху вниз — ломтик отваливается, падает срезом вверх
// и рассыпается на песчинки. Внутри блоков — сюрпризы: слои, молния, буквы ШПА, мрамор.
// Блок рисуется в косоугольной проекции: передняя грань, верх и правый торец. Срез — это сечение блока
// в точке разреза, поэтому каждый новый ломтик показывает свою картинку.
import { clamp, easeOut, frame, hexRgb, local, offscreen, Parts, type CalmCtx, type Scene } from './calm-kit';

type RGB = [number, number, number];
type Col = (u: number, v: number, w: number) => RGB;
interface Spec { name: string; make: (L: number, bh: number, d: number) => Col; glitter?: number }
interface Tex { c: HTMLCanvasElement; d: Uint8ClampedArray; w: number; h: number }
interface Pt { x: number; y: number }
interface Slice { u0: number; u1: number; left: Tex; right: Tex; th: number; om: number; slide: number; wide: boolean; state: 'fall' | 'rest' | 'gone'; t: number; bx: number }
interface Grain { x: number; y: number; vx: number; vy: number; fy: number; c: string; delay: number }

const TS = 2;               // пикселей текстуры на CSS-пиксель
const KX = 0.62, KY = 0.42; // проекция глубины

// ---------- Узоры ----------
const wavyLayers = (cols: string[]): Spec['make'] => (_L, bh) => {
  const c = cols.map(hexRgb);
  return (u, v, w) => {
    const vv = v + Math.sin(u * 0.045 + w * 0.05) * 4 + Math.sin(u * 0.13) * 1.5;
    return c[clamp(Math.floor((vv / bh) * c.length), 0, c.length - 1)];
  };
};
const sunset: Spec['make'] = () => {
  const c = ['#ff6b6b', '#ff9f43', '#feca57', '#ff9ff3', '#a29bfe', '#48dbfb'].map(hexRgb);
  return (u, v, w) => c[((Math.floor((v + u * 0.35 + w * 0.3) / 16) % c.length) + c.length) % c.length];
};
const checker = (a: string, b: string, s = 17): Spec['make'] => () => {
  const A = hexRgb(a), B = hexRgb(b);
  return (u, v, w) => ((Math.floor(u / s) + Math.floor(v / s) + Math.floor(w / s)) & 1 ? A : B);
};
const marble = (a: string, b: string, c: string): Spec['make'] => () => {
  const A = hexRgb(a), B = hexRgb(b), C = hexRgb(c);
  return (u, v, w) => {
    const t = Math.sin(u * 0.045 + 2.4 * Math.sin(v * 0.05 + w * 0.08) + 1.4 * Math.sin(w * 0.05 - u * 0.02));
    if (t > 0.86) return C;
    const k = (t + 1) / 2;
    return [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k];
  };
};
function inPoly(x: number, y: number, p: number[][]) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
const BOLT = [[0.62, 0.12], [0.28, 0.54], [0.5, 0.54], [0.36, 0.9], [0.74, 0.44], [0.52, 0.44], [0.66, 0.12]];
const boltCore: Spec['make'] = (_L, bh, d) => {
  const shell = hexRgb('#1d3c78'), ring = hexRgb('#0396DA'), y = hexRgb('#ffd24a');
  return (u, v, w) => {
    const x = w / d, yy = v / bh;
    if (inPoly(x, yy, BOLT)) return y;
    const r = Math.hypot(x - 0.5, (yy - 0.5) * 0.7);
    return r > 0.33 && r < 0.38 ? ring : shell;
  };
};
/** Маски букв: глиф рисуется на холсте d×bh, берём альфу. */
function glyphMasks(d: number, bh: number) {
  const out: Uint8ClampedArray[] = [];
  for (const ch of ['Ш', 'П', 'А', 'heart']) {
    const c = document.createElement('canvas'); c.width = Math.ceil(d); c.height = Math.ceil(bh);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (ch === 'heart') {
      const s = Math.min(d, bh) * 0.36, x = d / 2, y = bh / 2;
      g.beginPath(); g.moveTo(x, y + s * 0.9);
      g.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
      g.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9); g.fill();
    } else {
      g.font = `400 ${Math.round(Math.min(d * 0.95, bh * 0.62))}px 'Russo One', Rubik, sans-serif`;
      g.fillText(ch, d / 2, bh / 2 + 2);
    }
    out.push(g.getImageData(0, 0, c.width, c.height).data);
  }
  return out;
}
const letters: Spec['make'] = (L, bh, d) => {
  const m = glyphMasks(d, bh), W = Math.ceil(d);
  const shell = hexRgb('#0396DA'), white = hexRgb('#ffffff'), pink = hexRgb('#ff5d8f'), deep = hexRgb('#0B2A3D');
  return (u, v, w) => {
    const k = clamp(Math.floor((u / L) * 4), 0, 3);
    const a = m[k][(Math.floor(v) * W + Math.floor(w)) * 4 + 3];
    if (a > 110) return k === 3 ? pink : white;
    return Math.abs(v - bh * 0.06) < 3 || Math.abs(v - bh * 0.94) < 3 ? deep : shell;
  };
};
const galaxy: Spec['make'] = () => {
  const A = hexRgb('#1c1f5a'), B = hexRgb('#5a2a8a'), C = hexRgb('#2a6fb0');
  return (u, v, w) => {
    const t = Math.sin(u * 0.03 + Math.sin(v * 0.06 + w * 0.04) * 2.2), s = Math.sin(v * 0.04 - w * 0.07 + u * 0.01);
    const p = t > 0.3 ? B : s > 0.5 ? C : A;
    return p;
  };
};

const SPECS: Spec[] = [
  { name: 'Радуга', make: wavyLayers(['#ff8fab', '#ffc46b', '#fff07a', '#8ef0a7', '#7cc8ff', '#b79bff']) },
  { name: 'Молния внутри', make: boltCore },
  { name: 'Буквы ШПА', make: letters },
  { name: 'Мрамор', make: marble('#f7a8c8', '#fff4f8', '#b05aa0') },
  { name: 'Шахматка', make: checker('#9be7c4', '#c8b6ff') },
  { name: 'Закат', make: sunset },
  { name: 'Звёздная пыль', make: galaxy, glitter: 0.02 },
  { name: 'Мятный шоколад', make: wavyLayers(['#5b3a29', '#b8f2d8', '#5b3a29', '#b8f2d8']) },
];

function texture(wPx: number, hPx: number, f: (i: number, j: number) => RGB, glitter = 0, shade = 1, grain = 1): Tex {
  const c = document.createElement('canvas'); c.width = Math.max(1, wPx); c.height = Math.max(1, hPx);
  const g = c.getContext('2d')!;
  const img = g.createImageData(c.width, c.height), d = img.data;
  for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) {
    const [r, gg, b] = f(i, j);
    let n = (1 + (Math.random() - 0.5) * 0.2 * grain) * shade;
    if (Math.random() < 0.05 * grain) n *= 0.8;
    const k = (j * c.width + i) * 4;
    if (glitter && Math.random() < glitter) { d[k] = 255; d[k + 1] = Math.random() < 0.5 ? 236 : 255; d[k + 2] = Math.random() < 0.5 ? 160 : 255; }
    else { d[k] = r * n; d[k + 1] = gg * n; d[k + 2] = b * n; }
    d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { c, d, w: c.width, h: c.height };
}
const px = (t: Tex, i: number, j: number) => {
  const k = (clamp(Math.floor(j), 0, t.h - 1) * t.w + clamp(Math.floor(i), 0, t.w - 1)) * 4;
  return `rgb(${t.d[k]},${t.d[k + 1]},${t.d[k + 2]})`;
};

/** Текстура tex[sx..sx+sw, sy..sy+sh] на параллелограмм: P0→P1 — по ширине, P0→P0+Dv — по высоте. */
function face(g: CanvasRenderingContext2D, tex: HTMLCanvasElement, sx: number, sw: number, sy: number, sh: number, P0: Pt, P1: Pt, Dv: Pt, shade = 0) {
  if (sw < 0.5 || sh < 0.5) return;
  g.save();
  g.transform((P1.x - P0.x) / sw, (P1.y - P0.y) / sw, Dv.x / sh, Dv.y / sh, P0.x, P0.y);
  g.drawImage(tex, sx, sy, sw, sh, -0.3, -0.3, sw + 0.6, sh + 0.6);
  if (shade) { g.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(20,10,30,${-shade})`; g.fillRect(-0.3, -0.3, sw + 0.6, sh + 0.6); }
  g.restore();
}

export function sandScene(cc: CalmCtx): Scene {
  const f = frame(cc, 'Кинетический песок');
  const cv = f.canvas;
  let g = cv.getContext('2d')!;
  let W = 360, H = 520, dpr = 1;
  let bg: HTMLCanvasElement | null = null, pile = offscreen(10, 10, 1);
  let L = 180, bh = 110, d = 70, bx = 16, yBot = 340, yBoard = 362;
  const D = () => ({ x: KX * d, y: -KY * d });

  // блок
  let si = (cc.store.blocks ?? 0) % SPECS.length;
  let spec = SPECS[si];
  let col: Col = () => [0, 0, 0];
  let front!: Tex, top!: Tex, rightFace!: Tex;
  let len = 0, enter = 0, cuts = 0, finished = -1, sweep = -1;
  const slices: Slice[] = [];
  const grains: Grain[] = [];
  const parts = new Parts(300);
  const cross = (u: number) => texture(Math.round(bh * TS), Math.round(d * TS), (i, j) => col(u, i / TS, j / TS), spec.glitter, 0.97, 0.7);

  const newBlock = () => {
    spec = SPECS[si % SPECS.length];
    col = spec.make(L, bh, d);
    front = texture(Math.round(L * TS), Math.round(bh * TS), (i, j) => col(i / TS, j / TS, 0), spec.glitter);
    top = texture(Math.round(L * TS), Math.round(d * TS), (i, j) => col(i / TS, 0, j / TS), spec.glitter, 1.08);
    rightFace = cross(L - 0.5);
    len = L; enter = 0; cuts = 0; finished = -1;
    f.info(spec.name);
    f.hint('Проведи ножом сверху вниз через блок');
    drawTools();
  };

  const drawTools = () => {
    f.tools.innerHTML = `<div class="row" style="gap:8px;align-items:center">
      <div class="grow small"><b>${spec.name}</b><div class="muted">Блок ${(cc.store.blocks ?? 0) + 1} · срезов: <span data-cuts>${cuts}</span></div></div>
      <button class="btn btn-ghost btn-sm" data-skip>Другой блок</button></div>`;
    f.tools.querySelector('[data-skip]')!.addEventListener('click', () => { cc.buzz('light'); cc.sfx.whoosh(); si++; slices.length = 0; grains.length = 0; pile.g.clearRect(0, 0, W, H); sweep = -1; newBlock(); });
  };

  const layout = () => {
    const r = f.wrap.getBoundingClientRect();
    const nw = Math.round(r.width) || 360, nh = Math.round(r.height) || 520;
    const nd = Math.min(2, window.devicePixelRatio || 1);
    if (nw === W && nh === H && nd === dpr && bg) return false;
    W = nw; H = nh; dpr = nd;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    g = cv.getContext('2d')!;
    const nL = Math.round(Math.min(W * 0.5, 240)), nbh = Math.round(clamp(H * 0.22, 80, 120)), nd2 = Math.round(Math.min(78, nL * 0.36));
    const changed = nL !== L || nbh !== bh || nd2 !== d;
    L = nL; bh = nbh; d = nd2;
    bx = Math.round(Math.max(12, W * 0.05));
    yBot = Math.round(H * 0.66); yBoard = yBot + 24;
    bg = scenery(W, H);
    pile = offscreen(W, H, dpr);
    return changed;
  };

  function scenery(w: number, h: number) {
    const o = offscreen(w, h, dpr), s = o.g;
    const sky = s.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2a2f6b'); sky.addColorStop(0.55, '#6b5aa8'); sky.addColorStop(1, '#2b2350');
    s.fillStyle = sky; s.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const x = ((i * 97) % w), y = (i * 53) % (h * 0.5), r = 18 + (i % 4) * 14;
      const gr = s.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,220,255,0.16)'); gr.addColorStop(1, 'rgba(255,220,255,0)');
      s.fillStyle = gr; s.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // доска
    const bd = d + 60, Dx = KX * bd, Dy = -KY * bd;
    const x0 = 4, x1 = w - 4 - Dx;
    s.fillStyle = '#d9b07a';
    s.beginPath(); s.moveTo(x0, yBoard); s.lineTo(x1, yBoard); s.lineTo(x1 + Dx, yBoard + Dy); s.lineTo(x0 + Dx, yBoard + Dy); s.closePath(); s.fill();
    s.save(); s.clip();
    s.strokeStyle = 'rgba(140,92,48,0.28)'; s.lineWidth = 1;
    for (let k = 0; k < 9; k++) { const t = k / 9; s.beginPath(); s.moveTo(x0 + Dx * t, yBoard + Dy * t); s.lineTo(x1 + Dx * t, yBoard + Dy * t); s.stroke(); }
    s.restore();
    const edge = s.createLinearGradient(0, yBoard, 0, yBoard + 16);
    edge.addColorStop(0, '#b8844b'); edge.addColorStop(1, '#8a5c30');
    s.fillStyle = edge; s.fillRect(x0, yBoard, x1 - x0, 16);
    s.fillStyle = '#8a5c30'; s.beginPath(); s.moveTo(x1, yBoard); s.lineTo(x1 + Dx, yBoard + Dy); s.lineTo(x1 + Dx, yBoard + Dy + 16); s.lineTo(x1, yBoard + 16); s.closePath(); s.fill();
    const sh = s.createLinearGradient(0, yBoard + 16, 0, yBoard + 40);
    sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = sh; s.fillRect(x0, yBoard + 16, x1 - x0, 24);
    return o.c;
  }

  // ---------- геометрия ломтика ----------
  const rot = (x: number, y: number, th: number) => ({ x: x * Math.cos(th) - y * Math.sin(th), y: x * Math.sin(th) + y * Math.cos(th) });
  const sliceCorners = (s: Slice) => {
    const w = s.u1 - s.u0, pvx = s.bx + s.u1 + s.slide, pvy = yBot;
    const P = (x: number, y: number) => { const r = rot(x, y, s.th); return { x: pvx + r.x, y: pvy + r.y }; };
    return { TL: P(-w, -bh), TR: P(0, -bh), BR: P(0, 0), BL: P(-w, 0), pvx, pvy };
  };
  const drawPrism = (TL: Pt, TR: Pt, BR: Pt, BL: Pt, u0: number, u1: number, left: Tex | null, right: Tex) => {
    const Dv = D();
    const sides: { a: Pt; b: Pt; draw: () => void }[] = [
      { a: TL, b: TR, draw: () => face(g, top.c, u0 * TS, (u1 - u0) * TS, 0, top.h, TL, TR, Dv, 0.06) },
      { a: TR, b: BR, draw: () => face(g, right.c, 0, right.w, 0, right.h, TR, BR, Dv, -0.1) },
      { a: BR, b: BL, draw: () => face(g, top.c, u0 * TS, (u1 - u0) * TS, 0, top.h, BL, BR, Dv, -0.35) },
      { a: BL, b: TL, draw: () => left && face(g, left.c, 0, left.w, 0, left.h, TL, BL, Dv, 0.02) },
    ];
    for (const s of sides) {
      const ex = s.b.x - s.a.x, ey = s.b.y - s.a.y;
      if (ey * Dv.x - ex * Dv.y > 0.01) s.draw();
    }
    face(g, front.c, u0 * TS, (u1 - u0) * TS, 0, front.h, TL, TR, { x: BL.x - TL.x, y: BL.y - TL.y });
    g.strokeStyle = 'rgba(30,10,40,0.18)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(TL.x, TL.y); g.lineTo(TR.x, TR.y); g.lineTo(BR.x, BR.y); g.lineTo(BL.x, BL.y); g.closePath(); g.stroke();
  };

  // ---------- разрез ----------
  let down = false, kx = 0, ky = 0, cutU = -1, prog = 0, locked = false, lastSpill = 0;
  const blockX = () => bx - (1 - easeOut(enter)) * (W * 0.9);

  const doCut = () => {
    let u = cutU;
    if (u < 10) u = 0;
    const left = u > 0 ? cross(u) : rightFace;
    slices.push({ u0: u, u1: len, left, right: rightFace, th: 0, om: 0, slide: 0, wide: len - u > bh * 0.8, state: 'fall', t: 0, bx: blockX() });
    len = u; rightFace = left;
    cuts++; locked = false; cutU = -1; prog = 0;
    const c = f.tools.querySelector('[data-cuts]'); if (c) c.textContent = String(cuts);
    cc.sfx.crunch(0.45); cc.sfx.whoosh(0.08);
    cc.buzz('rigid');
    f.hint('');
    if (len <= 0) { finished = 0; }
  };

  const crumble = (s: Slice) => {
    s.state = 'gone';
    const { pvx, pvy } = sliceCorners(s);
    const w = s.u1 - s.u0;
    const step = Math.max(2.2, Math.sqrt((w * bh) / 650));
    const Dv = D();
    for (let a = 0; a < w; a += step) for (let b = 0; b < bh; b += step) {
      const r = rot(a - w, b - bh, s.th);
      grains.push({ x: pvx + r.x, y: pvy + r.y, vx: (Math.random() - 0.3) * 70, vy: -Math.random() * 60, fy: yBot + 2 + Math.random() * (yBoard - yBot - 4), c: px(front, (s.u0 + a) * TS, b * TS), delay: Math.random() * 0.18 });
    }
    // сечение сверху (у лёгшего ломтика) — тоже в песок
    if (!s.wide) {
      const TLs = sliceCorners(s).TL, BLs = sliceCorners(s).BL;
      const st2 = Math.max(2.4, Math.sqrt((bh * d) / 420));
      for (let v = 0; v < bh; v += st2) for (let ww = 0; ww < d; ww += st2) {
        const t = v / bh, k = ww / d;
        grains.push({ x: TLs.x + (BLs.x - TLs.x) * t + Dv.x * k, y: TLs.y + (BLs.y - TLs.y) * t + Dv.y * k, vx: (Math.random() - 0.3) * 60, vy: -Math.random() * 50, fy: yBot + Dv.y * k + Math.random() * 6, c: px(s.left, v * TS, ww * TS), delay: 0.05 + Math.random() * 0.2 });
      }
    }
    for (let i = 0; i < 7; i++) setTimeout(() => cc.sfx.crunch(0.14 + Math.random() * 0.12), i * 38 + Math.random() * 20);
    cc.buzz('medium');
    setTimeout(() => cc.buzz('soft'), 90);
  };

  const onDown = (e: PointerEvent) => {
    if (enter < 1 || finished >= 0) return;
    cc.sfx.wake();
    cv.setPointerCapture?.(e.pointerId);
    const p = local(e, cv);
    down = true; kx = p.x; ky = p.y;
    if (!(locked && Math.abs(p.x - (blockX() + cutU + D().x / 2)) < 34)) { locked = false; prog = 0; cutU = -1; }
    move(p.x, p.y);
  };
  const move = (x: number, y: number) => {
    const Dv = D(), bxx = blockX();
    if (!locked) {
      kx = x; ky = y;
      const u = x - Dv.x / 2 - bxx;
      if (u > 2 && u < len - 3 && y > yBot - bh + Dv.y / 2 - 4) { locked = true; cutU = clamp(u, 0, len - 6); prog = 0; cc.sfx.crunch(0.25); cc.buzz('light'); }
      else return;
    }
    ky = y;
    kx = bxx + cutU + Dv.x / 2;
    const np = clamp((y - Dv.y / 2 - (yBot - bh)) / bh, 0, 1);
    if (np > prog) {
      const dv = np - prog;
      prog = np;
      lastSpill += dv * bh;
      while (lastSpill > 6) {
        lastSpill -= 6;
        cc.sfx.crunch(0.1 + Math.random() * 0.1);
        cc.buzz('select', 45);
        const vy = prog * bh;
        for (let i = 0; i < 3; i++) grains.push({ x: bxx + cutU + (Math.random() - 0.5) * 3, y: yBot - bh + vy, vx: (Math.random() - 0.5) * 50, vy: 20, fy: yBot + 2 + Math.random() * (yBoard - yBot - 4), c: px(front, cutU * TS, vy * TS), delay: 0 });
      }
      if (prog >= 1) doCut();
    }
  };
  const onMove = (e: PointerEvent) => { if (!down) return; const p = local(e, cv); move(p.x, p.y); };
  const onUp = () => { down = false; };
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);

  // ---------- кадр ----------
  let alive = true, raf = 0, last = performance.now(), t = 0;
  const step = (now: number) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (layout()) { slices.length = 0; grains.length = 0; newBlock(); }
    if (enter < 1) enter = Math.min(1, enter + dt / 0.6);
    const Dv = D();

    for (const s of slices) {
      if (s.state === 'fall') {
        if (s.wide) { s.slide += 30 * dt; s.t += dt; if (s.t > 0.22) crumble(s); }
        else {
          s.om += (5 + 16 * Math.sin(s.th + 0.12)) * dt;
          s.th += s.om * dt;
          if (s.th >= Math.PI / 2) {
            s.th = Math.PI / 2;
            if (s.om > 2.5) { s.om = -s.om * 0.22; cc.sfx.thud(0.3); cc.buzz('soft'); } else { s.om = 0; s.state = 'rest'; s.t = 0; }
          }
        }
      } else if (s.state === 'rest') { s.t += dt; if (s.t > 0.3) crumble(s); }
    }
    for (let i = slices.length - 1; i >= 0; i--) if (slices[i].state === 'gone') slices.splice(i, 1);

    // песчинки
    const pg = pile.g;
    for (let i = grains.length - 1; i >= 0; i--) {
      const q = grains[i];
      if (q.delay > 0) { q.delay -= dt; continue; }
      q.vy += 1300 * dt; q.vx *= 0.985;
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.y >= q.fy && q.vy > 0) {
        pg.fillStyle = q.c; pg.fillRect(q.x - 1.2, q.fy - 1.2, 2.4, 2.4);
        grains.splice(i, 1);
      }
    }

    // блок кончился → смахнуть песок, следующий
    if (finished >= 0) {
      finished += dt;
      if (finished > 1.1 && sweep < 0 && !slices.length && !grains.length) {
        sweep = 0;
        cc.add(5); cc.store.blocks = (cc.store.blocks ?? 0) + 1; cc.save();
        cc.sfx.chime(); cc.buzz('medium');
        cc.toast(`Блок «${spec.name}» разрезан!`);
      }
    }
    if (sweep >= 0) {
      sweep += dt / 0.55;
      if (sweep >= 1) { sweep = -1; pile.g.clearRect(0, 0, W, H); si++; newBlock(); }
    }

    // ---- рисуем
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(bg!, 0, 0, W, H);
    const so = sweep >= 0 ? easeOut(sweep) * W : 0;
    g.drawImage(pile.c, so, 0, W, H);
    // тень блока
    const bxx = blockX();
    if (len > 0) {
      g.fillStyle = 'rgba(40,20,10,0.25)';
      g.beginPath(); g.moveTo(bxx - 2, yBot + 1); g.lineTo(bxx + len + 4, yBot + 1); g.lineTo(bxx + len + Dv.x + 10, yBot + Dv.y); g.lineTo(bxx + Dv.x, yBot + Dv.y); g.closePath(); g.fill();
      const TL = { x: bxx, y: yBot - bh }, TR = { x: bxx + len, y: yBot - bh }, BR = { x: bxx + len, y: yBot }, BL = { x: bxx, y: yBot };
      drawPrism(TL, TR, BR, BL, 0, len, null, rightFace);
      // начатый разрез
      if (locked && cutU >= 0) {
        const cx = bxx + cutU;
        g.strokeStyle = 'rgba(30,10,30,0.5)'; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(cx, yBot - bh); g.lineTo(cx + Dv.x, yBot - bh + Dv.y); g.stroke();
        g.beginPath(); g.moveTo(cx, yBot - bh); g.lineTo(cx, yBot - bh + prog * bh); g.stroke();
      }
    }
    for (const s of slices) {
      const c = sliceCorners(s);
      drawPrism(c.TL, c.TR, c.BR, c.BL, s.u0, s.u1, s.left, s.right);
    }
    for (const q of grains) { g.fillStyle = q.c; g.fillRect(q.x - 1.2, q.y - 1.2, 2.4, 2.4); }
    if (spec.glitter && len > 0 && Math.random() < 0.25) parts.add({ x: bxx + Math.random() * len, y: yBot - bh + Math.random() * bh, vx: 0, vy: 0, life: 0.5, size: 3 + Math.random() * 3, color: '#fff6c8', grav: 0, kind: 'spark' });
    parts.step(dt); parts.draw(g);

    // нож
    if (len > 0 && finished < 0 && enter >= 1) {
      const hover = !down && !locked;
      const x = hover ? bxx + Math.max(len * 0.7, len - 34) + Dv.x / 2 : kx;
      const tipY = hover ? yBot - bh + Dv.y / 2 - 26 + Math.sin(t * 2.4) * 5 : locked ? yBot - bh + prog * bh + Dv.y / 2 : ky;
      knife(x, tipY, locked ? yBot - bh + Dv.y / 2 : null, hover ? 0.75 : 1);
    }
    raf = requestAnimationFrame(step);
  };

  function knife(x: number, tip: number, clipY: number | null, alpha: number) {
    g.save();
    g.globalAlpha = alpha;
    if (clipY !== null) { g.beginPath(); g.rect(0, 0, W, clipY); g.clip(); }
    const bl = 128;
    const gr = g.createLinearGradient(x - 5, 0, x + 6, 0);
    gr.addColorStop(0, '#9aa3b5'); gr.addColorStop(0.45, '#f4f7fb'); gr.addColorStop(1, '#7b8496');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(x - 5, tip - bl); g.lineTo(x + 5, tip - bl); g.lineTo(x + 5, tip - 10); g.lineTo(x, tip); g.lineTo(x - 5, tip - 6); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 1, tip - bl + 4); g.lineTo(x - 1, tip - 12); g.stroke();
    g.restore();
    g.save(); g.globalAlpha = alpha;
    const hg = g.createLinearGradient(x - 7, 0, x + 8, 0);
    hg.addColorStop(0, '#5a3a22'); hg.addColorStop(0.5, '#9a6a40'); hg.addColorStop(1, '#4a2e1a');
    g.fillStyle = hg;
    g.beginPath(); g.roundRect?.(x - 7, tip - bl - 58, 15, 60, 6); if (!g.roundRect) g.rect(x - 7, tip - bl - 58, 15, 60); g.fill();
    g.fillStyle = '#c9cfd8'; g.fillRect(x - 7, tip - bl - 2, 15, 5);
    g.restore();
  }

  layout(); newBlock();
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
