// «Антистресс» → Пупырка: лист пузырчатой плёнки. Тап или свайп лопает пузырьки, каждый — щелчок и вибрация.
// Тугие пузырьки лопаются со второго раза, золотые дают очко. Лист кончился — уезжает, приезжает новый.
import { clamp, easeInOut, frame, local, offscreen, Parts, rng, type CalmCtx, type Scene } from './calm-kit';

interface Bub { x: number; y: number; state: 0 | 1 | 2; tough: boolean; gold: boolean; print: boolean; t: number; v: number }
interface Sheet { name: string; tint: string; bg: string; print?: string }
const SHEETS: Sheet[] = [
  { name: 'Прозрачная', tint: '205,232,255', bg: '#1d2550' },
  { name: 'Розовая', tint: '255,190,222', bg: '#4a2045' },
  { name: 'Мятная', tint: '175,245,212', bg: '#173f3c' },
  { name: 'ШПА', tint: '205,232,255', bg: '#0B2A3D', print: 'ШПА' },
  { name: 'Лимонная', tint: '255,238,150', bg: '#3d3618' },
  { name: 'Сиреневая', tint: '214,196,255', bg: '#2a1d55' },
];

function domeSprite(r: number, tint: string, strong: number, dpr: number) {
  const s = Math.ceil(r * 2 + 10), o = offscreen(s, s, dpr), g = o.g, c = s / 2;
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(c + r * 0.12, c + r * 0.16, r * 0.97, 0, 7); g.fill();
  const gr = g.createRadialGradient(c - r * 0.36, c - r * 0.4, r * 0.04, c, c, r);
  gr.addColorStop(0, 'rgba(255,255,255,0.97)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.45)');
  gr.addColorStop(0.55, `rgba(${tint},${0.22 + strong})`); gr.addColorStop(0.9, `rgba(${tint},${0.42 + strong})`); gr.addColorStop(1, 'rgba(255,255,255,0.7)');
  g.fillStyle = gr; g.beginPath(); g.arc(c, c, r, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.2; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.ellipse(c - r * 0.38, c - r * 0.42, r * 0.22, r * 0.11, -0.7, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2; g.beginPath(); g.arc(c, c, r * 0.72, 0.2, 1.4); g.stroke();
  return o.c;
}
function flatSprite(r: number, seed: number, dpr: number) {
  const s = Math.ceil(r * 2 + 10), o = offscreen(s, s, dpr), g = o.g, c = s / 2, R = rng(seed);
  g.beginPath();
  for (let i = 0; i <= 11; i++) { const a = (i / 11) * Math.PI * 2, rr = r * (0.76 + R() * 0.2); const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 1; g.stroke();
  for (let i = 0; i < 3; i++) {
    const a = R() * Math.PI, l = r * (0.4 + R() * 0.4);
    g.strokeStyle = i % 2 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.28)';
    g.beginPath(); g.moveTo(c - Math.cos(a) * l, c - Math.sin(a) * l); g.lineTo(c + Math.cos(a) * l * 0.3, c + Math.sin(a) * l * 0.3 + 2); g.lineTo(c + Math.cos(a) * l, c + Math.sin(a) * l); g.stroke();
  }
  return o.c;
}

export function wrapScene(cc: CalmCtx): Scene {
  const f = frame(cc, 'Пупырка');
  const cv = f.canvas;
  let g = cv.getContext('2d')!;
  let W = 0, H = 0, dpr = 1, r = 24;
  let si = (cc.store.sheets ?? 0) % SHEETS.length;
  let sheet = SHEETS[si];
  let bubs: Bub[] = [];
  let spr: { dome: HTMLCanvasElement; tough: HTMLCanvasElement; gold: HTMLCanvasElement; print: HTMLCanvasElement; flat: HTMLCanvasElement[] } | null = null;
  let popped = 0, total = 0, out = -1, inn = 1, sx = 0, sy = 0, sw = 0, sh = 0;
  const parts = new Parts(400);

  const build = () => {
    sheet = SHEETS[si % SHEETS.length];
    r = clamp(Math.min(W, H) / 13.5, 18, 30);
    const dx = r * 2.2, dy = r * 1.92;
    sx = 12; sy = 10; sw = W - 24; sh = H - 20;
    const cols = Math.max(3, Math.floor((sw - r * 1.4) / dx)), rows = Math.max(4, Math.floor((sh - r * 0.6) / dy));
    const gx = sx + (sw - (cols - 1) * dx - dx / 2) / 2, gy = sy + (sh - (rows - 1) * dy) / 2;
    let mask: Uint8ClampedArray | null = null;
    if (sheet.print) {
      const c = document.createElement('canvas'); c.width = cols; c.height = rows;
      const m = c.getContext('2d')!;
      m.fillStyle = '#fff'; m.textAlign = 'center'; m.textBaseline = 'middle';
      m.font = `400 ${Math.min(rows * 0.5, cols * 0.42)}px 'Russo One', Rubik, sans-serif`;
      m.fillText(sheet.print, cols / 2, rows / 2 + 0.5);
      mask = m.getImageData(0, 0, cols, rows).data;
    }
    bubs = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const R = Math.random();
      bubs.push({ x: gx + i * dx + (j % 2) * (dx / 2), y: gy + j * dy, state: 0, tough: R < 0.05, gold: R > 0.965, print: !!mask && mask[(j * cols + i) * 4 + 3] > 90, t: 9, v: (Math.random() * 3) | 0 });
    }
    total = bubs.length; popped = 0;
    spr = {
      dome: domeSprite(r, sheet.tint, 0, dpr),
      tough: domeSprite(r * 1.04, sheet.tint, 0.18, dpr),
      gold: domeSprite(r, '255,200,70', 0.3, dpr),
      print: domeSprite(r, '3,150,218', 0.4, dpr),
      flat: [0, 1, 2].map((k) => flatSprite(r, 7 + k + si * 3, dpr)),
    };
    f.info(`${sheet.name} · ${total} пузырьков`);
    drawTools();
  };

  const drawTools = () => {
    f.tools.innerHTML = `<div class="row" style="gap:10px;align-items:center">
      <div class="grow"><div class="calm-prog"><i data-prog style="width:${Math.round((popped / Math.max(1, total)) * 100)}%"></i></div>
      <div class="small muted" style="margin-top:4px">Лопнуто <b data-n>${popped}</b> из ${total} · листов: ${cc.store.sheets ?? 0}</div></div>
      <button class="btn btn-ghost btn-sm" data-new>Новый лист</button></div>`;
    f.tools.querySelector('[data-new]')!.addEventListener('click', () => { if (out < 0) { cc.buzz('light'); out = 0; } });
  };
  const prog = () => {
    const b = f.tools.querySelector<HTMLElement>('[data-prog]'); if (b) b.style.width = `${Math.round((popped / Math.max(1, total)) * 100)}%`;
    const n = f.tools.querySelector('[data-n]'); if (n) n.textContent = String(popped);
  };

  const layout = () => {
    const rc = f.wrap.getBoundingClientRect();
    const nw = Math.round(rc.width) || 360, nh = Math.round(rc.height) || 520, nd = Math.min(2, window.devicePixelRatio || 1);
    if (nw === W && nh === H && nd === dpr) return;
    W = nw; H = nh; dpr = nd;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    g = cv.getContext('2d')!;
    build();
  };

  const press = (b: Bub) => {
    if (b.state === 2 || out >= 0 || inn < 1) return;
    if (b.tough && b.state === 0) { b.state = 1; b.t = 0; cc.sfx.squish(0.14); cc.buzz('soft'); return; }
    b.state = 2; b.t = 0; popped++;
    cc.sfx.pop(b.gold ? 1.6 : 0.75 + Math.random() * 0.55, b.tough ? 0.65 : 0.48);
    cc.buzz(b.tough ? 'heavy' : 'rigid');
    parts.add({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.28, size: r * 0.8, color: 'rgba(255,255,255,0.9)', grav: 0, kind: 'ring' });
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * 6.28;
      parts.add({ x: b.x, y: b.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: 0.25, size: 2 + Math.random() * 2, color: 'rgba(255,255,255,0.85)', grav: 0, kind: 'dot' });
    }
    if (b.gold) {
      cc.add(1); cc.sfx.ding(0.1);
      for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28; parts.add({ x: b.x, y: b.y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140 - 40, life: 0.6, size: 5 + Math.random() * 4, color: '#ffd24a', grav: 200, kind: 'spark' }); }
    }
    prog();
    if (popped >= total) {
      setTimeout(() => {
        cc.add(4); cc.store.sheets = (cc.store.sheets ?? 0) + 1; cc.save();
        cc.sfx.chime(); cc.buzz('medium');
        cc.toast(`Лист «${sheet.name}» — весь!`);
        out = 0;
      }, 350);
    }
  };
  const hit = (x: number, y: number) => {
    const oy = y - offY();
    for (const b of bubs) if ((b.x - x) ** 2 + (b.y - oy) ** 2 < (r * 0.98) ** 2) return b;
    return null;
  };
  const offY = () => (out >= 0 ? -easeInOut(out) * H : (1 - easeInOut(inn)) * H);

  const last = new Map<number, Bub | null>();
  const onDown = (e: PointerEvent) => {
    cc.sfx.wake();
    cv.setPointerCapture?.(e.pointerId);
    const p = local(e, cv);
    f.hint('');
    const b = hit(p.x, p.y);
    last.set(e.pointerId, b);
    if (b) press(b);
  };
  const onMove = (e: PointerEvent) => {
    if (!last.has(e.pointerId)) return;
    const p = local(e, cv);
    const b = hit(p.x, p.y);
    if (b && b !== last.get(e.pointerId)) press(b);
    last.set(e.pointerId, b);
  };
  const onUp = (e: PointerEvent) => { last.delete(e.pointerId); };
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  f.hint('Тапай и води пальцем — лопай всё. Можно несколькими пальцами');

  let alive = true, raf = 0, prev = performance.now(), t = 0;
  const step = (now: number) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now; t += dt;
    layout();
    if (out >= 0) {
      out += dt / 0.55;
      if (out >= 1) { out = -1; inn = 0; si++; build(); cc.sfx.whoosh(0.15); }
    } else if (inn < 1) inn = Math.min(1, inn + dt / 0.55);
    for (const b of bubs) b.t += dt;
    parts.step(dt);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = sheet.bg; g.fillRect(0, 0, W, H);
    const v = g.createRadialGradient(W / 2, H * 0.4, 20, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(255,255,255,0.08)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    const oy = offY();
    g.save(); g.translate(0, oy);
    // плёнка
    g.fillStyle = `rgba(${sheet.tint},0.13)`;
    g.beginPath(); g.roundRect ? g.roundRect(sx, sy, sw, sh, 10) : g.rect(sx, sy, sw, sh); g.fill();
    g.strokeStyle = `rgba(${sheet.tint},0.35)`; g.lineWidth = 1.5; g.stroke();
    const sheen = g.createLinearGradient(sx, sy, sx + sw, sy + sh);
    sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.45, 'rgba(255,255,255,0.07)'); sheen.addColorStop(0.55, 'rgba(255,255,255,0.12)'); sheen.addColorStop(0.65, 'rgba(255,255,255,0)');
    g.fillStyle = sheen; g.fillRect(sx, sy, sw, sh);
    if (spr) {
      const S = spr.dome.width / dpr;
      for (const b of bubs) {
        const x = b.x - S / 2, y = b.y - S / 2;
        if (b.state === 2) {
          if (b.t < 0.14) {
            const k = 1 + 0.16 * Math.sin((b.t / 0.14) * Math.PI);
            g.globalAlpha = 1 - b.t / 0.14;
            const sp = b.gold ? spr.gold : b.print ? spr.print : b.tough ? spr.tough : spr.dome;
            g.drawImage(sp, b.x - (S * k) / 2, b.y - (S * k) / 2, S * k, S * k);
            g.globalAlpha = b.t / 0.14;
          }
          g.drawImage(spr.flat[b.v], x, y, S, S);
          g.globalAlpha = 1;
        } else {
          const sp = b.gold ? spr.gold : b.print ? spr.print : b.tough ? spr.tough : spr.dome;
          const k = b.state === 1 ? 0.9 + 0.05 * Math.sin(b.t * 30) * Math.exp(-b.t * 4) : 1;
          g.drawImage(sp, b.x - (S * k) / 2, b.y - (S * k) / 2, S * k, S * k);
          if (b.gold && Math.sin(t * 3 + b.x) > 0.96) parts.add({ x: b.x - r * 0.3, y: b.y - r * 0.35 + oy, vx: 0, vy: 0, life: 0.35, size: 6, color: '#fff6c8', grav: 0, kind: 'spark' });
        }
      }
    }
    g.restore();
    parts.draw(g);
    raf = requestAnimationFrame(step);
  };
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
