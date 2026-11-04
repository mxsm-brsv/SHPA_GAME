// «Бегом на пару» — как Subway Surfers: три дорожки коридора МЭИ.
// Свайп влево/вправо — перестроиться (срабатывает сразу, не дожидаясь отпускания), вверх или тап — прыжок, вниз — подкат.
// Турникеты и лужи перепрыгивай, под растяжками «Профком» — подкатом, стенды и тележки — обходи.
// Магнит притягивает профкоины, «×2» удваивает их. Скорость растёт.
import { factionById } from '../config/factions';
import { haptic } from '../core/telegram';
import { el, fmt } from '../lib/dom';
import type { App } from '../ui/app';
import { fitCanvas, loop, reportResult, shell, showResult, type PlayCtx } from './kit';

type Kind = 'coin' | 'puddle' | 'turnstile' | 'banner' | 'stand' | 'cart' | 'magnet' | 'x2';
interface Obj { lane: number; d: number; kind: Kind; h?: number; taken?: boolean; vx?: number }
interface Puff { x: number; y: number; vx: number; vy: number; life: number; c: string; r: number }

const LOW: Kind[] = ['puddle', 'turnstile'];
const VIEW = 70;           // сколько метров вперёд видно
const POSTERS = ['ШПА', 'ПРОФКОМ', 'МЭИ', 'ТЫ — ЛИДЕР', 'СТИПЕНДИЯ', 'ПРОФБЮРО'];

export function openRunner(app: App, ctx?: PlayCtx) {
  const s = app.state;
  const fac = factionById(s.faction);
  const fc = fac.color;
  const sh = shell(app, 'runner', ctx, { dark: true });
  sh.setSub('Свайп ←→ — дорожка · ↑ или тап — прыжок · ↓ — подкат');
  const wrap = el('<div class="cv-wrap"><canvas></canvas><div class="cv-hint">Беги на пару! Свайпай — персонаж сразу перестраивается</div></div>');
  sh.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas')!;
  const hint = wrap.querySelector<HTMLElement>('.cv-hint')!;
  let W = 360, H = 560, g = fitCanvas(cv, W, H);
  const resize = () => { const r = wrap.getBoundingClientRect(); W = r.width; H = r.height; g = fitCanvas(cv, W, H); };
  requestAnimationFrame(resize);

  // ---------- состояние ----------
  let lane = 0, laneX = 0, laneV = 0, camX = 0;
  let jumpY = 0, jumpV = 0, slideT = 0, landSquash = 0;
  let speed = 13, dist = 0, coins = 0, alive = true, started = false, deadT = 0, shake = 0, flash = 0;
  let magnetT = 0, x2T = 0, phase = 0, nextRow = 30, tilt = 0;
  const objs: Obj[] = [];
  const puffs: Puff[] = [];
  const best = s.daily.best.runner ?? 0;

  // ---------- проекция ----------
  const horizon = () => H * 0.3;
  const groundY = () => H * 0.9;
  const kOf = (d: number) => 3.2 / (Math.max(-2.5, d) + 3.2);
  const laneW = () => Math.min(W * 0.31, 150);
  const P = (lx: number, d: number, h = 0) => {
    const k = kOf(d);
    return { x: W / 2 + (lx - camX) * laneW() * k, y: horizon() + (groundY() - horizon()) * k - h * k * H * 0.11, k };
  };

  // ---------- генерация рядов ----------
  const coinLine = (l: number, d0: number, n = 6, arc = false) => {
    for (let i = 0; i < n; i++) objs.push({ lane: l, d: d0 + i * 2.6, kind: 'coin', h: arc ? Math.sin((i / (n - 1)) * Math.PI) * 1.4 + 0.5 : 0.5 });
  };
  const spawnRow = (d: number) => {
    const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5);
    const free = lanes[0];
    const r = Math.random();
    const diff = Math.min(1, dist / 2500);
    if (r < 0.22 - diff * 0.1) { coinLine(lanes[0], d); if (Math.random() < 0.5) coinLine(lanes[1], d + 6, 4); return; }
    // препятствия на 1–2 дорожках, одна всегда проходима
    const blocked = Math.random() < 0.35 + diff * 0.35 ? [lanes[1], lanes[2]] : [lanes[1]];
    for (const l of blocked) {
      const t = Math.random();
      const kind: Kind = t < 0.24 ? 'turnstile' : t < 0.42 ? 'banner' : t < 0.58 ? 'puddle' : t < 0.82 + (1 - diff) * 0.1 ? 'stand' : 'cart';
      objs.push({ lane: l, d, kind, vx: kind === 'cart' ? 7 : 0 });
      if (kind === 'turnstile' && Math.random() < 0.6) coinLine(l, d - 5, 5, true);
    }
    if (Math.random() < 0.6) coinLine(free, d - 3, 5);
    if (Math.random() < 0.09) objs.push({ lane: free, d: d + 8, kind: Math.random() < 0.6 ? 'magnet' : 'x2', h: 0.7 });
  };

  // ---------- управление ----------
  const begin = () => { if (!started) { started = true; hint.style.display = 'none'; } };
  const move = (dir: number) => {
    if (!alive) return; begin();
    const nl = Math.max(-1, Math.min(1, lane + dir));
    if (nl === lane) { shake = 0.12; haptic('bad'); return; }
    lane = nl; tilt = dir; haptic();
  };
  const jump = () => {
    if (!alive) return; begin();
    if (jumpY <= 0.01) { jumpV = 9.2; slideT = 0; haptic(); puff(0, 6, '#ffffffaa'); }
  };
  const slide = () => {
    if (!alive) return; begin();
    if (jumpY > 0.05) jumpV = -14; // в воздухе — резко вниз, как в оригинале
    slideT = 0.6; haptic();
  };
  let sx = 0, sy = 0, used = true;
  cv.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; used = false; });
  cv.addEventListener('pointermove', (e) => {
    if (used) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    used = true;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1); else if (dy < 0) jump(); else slide();
  });
  cv.addEventListener('pointerup', () => { if (!used) jump(); used = true; });
  const onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') move(-1);
    else if (k === 'arrowright' || k === 'd') move(1);
    else if (k === 'arrowup' || k === 'w' || k === ' ') jump();
    else if (k === 'arrowdown' || k === 's') slide();
  };
  document.addEventListener('keydown', onKey);

  const puff = (dx: number, n: number, c: string) => {
    const p = P(laneX, 0.4);
    for (let i = 0; i < n; i++) puffs.push({ x: p.x + dx + (Math.random() - 0.5) * 30, y: p.y, vx: (Math.random() - 0.5) * 80, vy: -Math.random() * 60, life: 0.4 + Math.random() * 0.3, c, r: 3 + Math.random() * 4 });
  };

  // ---------- сцена ----------
  const quad = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }, fill: string) => {
    g.fillStyle = fill; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath(); g.fill();
  };
  // потолок выше камеры, иначе он «проваливается» ниже горизонта
  const WALL = 1.75, CEIL = 7.2;
  const drawScene = () => {
    const hz = horizon();
    // дальний проём коридора — окно в конце
    g.fillStyle = '#1b1d4f'; g.fillRect(0, 0, W, H);
    const far = VIEW;
    const fl = P(-WALL, far), fr = P(WALL, far), cl = P(-WALL, far, CEIL), cr = P(WALL, far, CEIL);
    const sky = g.createLinearGradient(0, cl.y, 0, fl.y);
    sky.addColorStop(0, '#7ec8ff'); sky.addColorStop(1, '#ffd9a0');
    g.fillStyle = sky; g.fillRect(cl.x, cl.y, fr.x - cl.x, fl.y - cl.y);
    // пол, стены, потолок
    const n0l = P(-WALL, -2.4), n0r = P(WALL, -2.4), c0l = P(-WALL, -2.4, CEIL), c0r = P(WALL, -2.4, CEIL);
    quad(fl, fr, n0r, n0l, '#bea377');
    quad(cl, fl, n0l, c0l, '#d8c4a0');
    quad(cr, fr, n0r, c0r, '#ccb68f');
    quad(cl, cr, c0r, c0l, '#efe7d6');
    // нижняя панель стен (покраска «под МЭИ»)
    const pl = P(-WALL, far, 1.1), pr = P(WALL, far, 1.1), pl0 = P(-WALL, -2.4, 1.1), pr0 = P(WALL, -2.4, 1.1);
    quad(pl, fl, n0l, pl0, '#2f6f9e'); quad(pr, fr, n0r, pr0, '#2a6590');
    // плинтус
    g.strokeStyle = '#8a6b4a'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(fl.x, fl.y); g.lineTo(n0l.x, n0l.y); g.moveTo(fr.x, fr.y); g.lineTo(n0r.x, n0r.y); g.stroke();
    // плитка пола и разметка дорожек
    g.strokeStyle = '#b39c74'; g.lineWidth = 1;
    const step = 3;
    for (let dd = step - (dist % step); dd < far; dd += step) {
      const a = P(-WALL, dd), b = P(WALL, dd);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    g.strokeStyle = '#a58c62'; g.lineWidth = 2;
    for (const lx of [-0.5, 0.5]) { const a = P(lx, far), b = P(lx, -2.4); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    // двери, плакаты и лампы — проплывают мимо
    const seg = 9;
    for (let dd = seg - (dist % seg) + 4; dd < far; dd += seg) {
      const idx = Math.floor((dist + dd) / seg);
      for (const side of [-1, 1]) {
        const x0 = side * WALL;
        const a = P(x0, dd), b = P(x0, dd + 1.6), c = P(x0, dd + 1.6, 2.4), d = P(x0, dd, 2.4);
        if ((idx + (side > 0 ? 1 : 0)) % 3 === 0) {
          // плакат
          const pa = P(x0, dd + 0.2, 1.4), pb = P(x0, dd + 1.4, 1.4), pc = P(x0, dd + 1.4, 2.6), pd = P(x0, dd + 0.2, 2.6);
          quad(pa, pb, pc, pd, ['#009ee3', '#c8553d', '#2f8f5b', '#7b4fd6'][idx % 4]);
          const k = pa.k;
          if (k > 0.12) { g.fillStyle = '#fff'; g.font = `800 ${Math.max(6, 22 * k)}px Rubik`; g.textAlign = 'center'; g.fillText(POSTERS[idx % POSTERS.length], (pa.x + pb.x) / 2, (pa.y + pc.y) / 2 + 6 * k); g.textAlign = 'start'; }
        } else {
          quad(a, b, c, d, '#7a4a30');
          const dk = a.k;
          if (dk > 0.15) { g.fillStyle = '#ffd76a'; g.font = `700 ${Math.max(6, 16 * dk)}px Rubik`; g.textAlign = 'center'; g.fillText(`${'АБВГД'[idx % 5]}-${200 + (idx * 37) % 300}`, (d.x + c.x) / 2, d.y - 5 * dk); g.textAlign = 'start'; }
        }
      }
      // лампа на потолке
      const la = P(-0.6, dd + 0.6, CEIL - 0.05), lb = P(0.6, dd + 0.6, CEIL - 0.05), lc = P(0.6, dd + 1.4, CEIL - 0.05), ld = P(-0.6, dd + 1.4, CEIL - 0.05);
      quad(la, lb, lc, ld, '#fffbe6');
      // окна на правой стене между дверями
      if (idx % 2) { const wa = P(WALL, dd + 3.5, 3), wb = P(WALL, dd + 6, 3), wc = P(WALL, dd + 6, 5.2), wd = P(WALL, dd + 3.5, 5.2); quad(wa, wb, wc, wd, '#9fd6ff'); }
    }
    // лёгкий туман вдали
    const fog = g.createLinearGradient(0, hz - 40, 0, hz + 60);
    fog.addColorStop(0, '#ffffff00'); fog.addColorStop(0.5, '#ffffff22'); fog.addColorStop(1, '#ffffff00');
    g.fillStyle = fog; g.fillRect(0, hz - 40, W, 100);
  };

  const drawObj = (o: Obj) => {
    if (o.taken) return;
    const p = P(o.lane, o.d, o.h ?? 0);
    const k = p.k, u = laneW() * k;
    if (k < 0.05) return;
    switch (o.kind) {
      case 'coin': {
        const sp = Math.abs(Math.sin(phase * 2 + o.d));
        g.fillStyle = '#c89200'; g.beginPath(); g.ellipse(p.x, p.y, 0.16 * u * Math.max(0.15, sp), 0.16 * u, 0, 0, 7); g.fill();
        g.fillStyle = '#ffc83d'; g.beginPath(); g.ellipse(p.x, p.y, 0.13 * u * Math.max(0.15, sp), 0.13 * u, 0, 0, 7); g.fill();
        break;
      }
      case 'puddle': {
        const q = P(o.lane, o.d);
        g.fillStyle = '#3c8fe0cc'; g.beginPath(); g.ellipse(q.x, q.y, 0.42 * u, 0.12 * u, 0, 0, 7); g.fill();
        g.fillStyle = '#bfe3ff'; g.beginPath(); g.ellipse(q.x - 0.1 * u, q.y - 0.03 * u, 0.12 * u, 0.03 * u, 0, 0, 7); g.fill();
        g.fillStyle = '#ffd76a'; g.fillRect(q.x + 0.25 * u, q.y - 0.5 * u, 0.04 * u, 0.5 * u);
        g.beginPath(); g.moveTo(q.x + 0.18 * u, q.y - 0.5 * u); g.lineTo(q.x + 0.38 * u, q.y - 0.5 * u); g.lineTo(q.x + 0.28 * u, q.y - 0.72 * u); g.fill();
        break;
      }
      case 'turnstile': {
        const q = P(o.lane, o.d);
        g.fillStyle = '#5a6090'; g.fillRect(q.x - 0.45 * u, q.y - 0.55 * u, 0.12 * u, 0.55 * u); g.fillRect(q.x + 0.33 * u, q.y - 0.55 * u, 0.12 * u, 0.55 * u);
        g.fillStyle = '#e8453c'; g.fillRect(q.x - 0.33 * u, q.y - 0.42 * u, 0.66 * u, 0.09 * u);
        g.fillStyle = '#fff'; for (let i = 0; i < 3; i++) g.fillRect(q.x - 0.25 * u + i * 0.2 * u, q.y - 0.42 * u, 0.08 * u, 0.09 * u);
        g.fillStyle = '#45d483'; g.beginPath(); g.arc(q.x - 0.39 * u, q.y - 0.6 * u, 0.04 * u, 0, 7); g.fill();
        break;
      }
      case 'banner': {
        const a = P(o.lane, o.d, 1.25), q = P(o.lane, o.d);
        g.fillStyle = '#9aa3c7'; g.fillRect(q.x - 0.47 * u, a.y - 0.05 * u, 0.06 * u, q.y - a.y); g.fillRect(q.x + 0.41 * u, a.y - 0.05 * u, 0.06 * u, q.y - a.y);
        g.fillStyle = '#009ee3'; g.fillRect(q.x - 0.47 * u, a.y - 0.38 * u, 0.94 * u, 0.36 * u);
        g.fillStyle = '#fff'; g.font = `800 ${Math.max(6, 0.17 * u)}px Rubik`; g.textAlign = 'center'; g.fillText('⚡ ПРОФКОМ', q.x, a.y - 0.14 * u); g.textAlign = 'start';
        break;
      }
      case 'stand': {
        const q = P(o.lane, o.d);
        g.fillStyle = '#00000033'; g.beginPath(); g.ellipse(q.x, q.y, 0.48 * u, 0.1 * u, 0, 0, 7); g.fill();
        g.fillStyle = '#8a3f22'; g.fillRect(q.x - 0.44 * u, q.y - 1.5 * u, 0.88 * u, 1.5 * u);
        g.fillStyle = '#f1e3c8'; g.fillRect(q.x - 0.38 * u, q.y - 1.42 * u, 0.76 * u, 0.9 * u);
        g.fillStyle = '#c8553d'; g.font = `800 ${Math.max(6, 0.16 * u)}px Rubik`; g.textAlign = 'center';
        g.fillText('РАСПИСАНИЕ', q.x, q.y - 1.2 * u);
        g.fillStyle = '#8a6b4a'; for (let i = 0; i < 4; i++) g.fillRect(q.x - 0.3 * u, q.y - 1.08 * u + i * 0.13 * u, 0.6 * u, 0.04 * u);
        g.textAlign = 'start';
        break;
      }
      case 'cart': {
        const q = P(o.lane, o.d);
        g.fillStyle = '#00000033'; g.beginPath(); g.ellipse(q.x, q.y, 0.45 * u, 0.1 * u, 0, 0, 7); g.fill();
        g.fillStyle = '#2f8fd6'; g.fillRect(q.x - 0.4 * u, q.y - 0.95 * u, 0.8 * u, 0.75 * u);
        g.fillStyle = '#ffd76a'; g.fillRect(q.x - 0.32 * u, q.y - 0.85 * u, 0.25 * u, 0.3 * u);
        g.fillStyle = '#45d483'; g.fillRect(q.x + 0.05 * u, q.y - 0.8 * u, 0.25 * u, 0.25 * u);
        g.fillStyle = '#23266a'; g.beginPath(); g.arc(q.x - 0.25 * u, q.y - 0.12 * u, 0.1 * u, 0, 7); g.arc(q.x + 0.25 * u, q.y - 0.12 * u, 0.1 * u, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.font = `700 ${Math.max(6, 0.13 * u)}px Rubik`; g.textAlign = 'center'; g.fillText('ХОЗЧАСТЬ', q.x, q.y - 0.32 * u); g.textAlign = 'start';
        break;
      }
      case 'magnet': case 'x2': {
        const bob = Math.sin(phase * 3) * 0.08 * u;
        g.fillStyle = o.kind === 'magnet' ? '#ff5a5f' : '#b26bff';
        g.beginPath(); g.arc(p.x, p.y + bob, 0.2 * u, 0, 7); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, 0.03 * u); g.stroke();
        g.fillStyle = '#fff'; g.font = `800 ${Math.max(6, 0.2 * u)}px Rubik`; g.textAlign = 'center';
        g.fillText(o.kind === 'magnet' ? 'U' : '×2', p.x, p.y + bob + 0.07 * u); g.textAlign = 'start';
        break;
      }
    }
  };

  const drawPlayer = () => {
    const base = P(laneX, 0);
    const u = laneW() * base.k;
    const sliding = slideT > 0;
    const sq = landSquash;
    // тень сжимается в прыжке
    g.fillStyle = '#00000044';
    g.beginPath(); g.ellipse(base.x, base.y, 0.3 * u * (1 - Math.min(0.5, jumpY * 0.2)), 0.08 * u, 0, 0, 7); g.fill();
    const y = base.y - jumpY * H * 0.11 * base.k;
    g.save();
    g.translate(base.x, y);
    g.rotate(tilt * 0.18 + laneV * 0.02);
    g.scale(1 + sq * 0.25, 1 - sq * 0.22);
    const sc = u / 160;
    g.scale(sc, sc);
    if (sliding) {
      // подкат: лёжа, ноги вперёд
      g.fillStyle = fc; g.fillRect(-40, -40, 60, 30);
      g.fillStyle = '#1b1d4f'; g.fillRect(16, -26, 40, 14);
      g.fillStyle = '#f1c7a5'; g.beginPath(); g.arc(-52, -34, 15, 0, 7); g.fill();
      g.fillStyle = '#3b2a20'; g.beginPath(); g.arc(-56, -40, 14, Math.PI * 0.9, Math.PI * 1.9); g.fill();
      g.fillStyle = '#ffd76a'; g.fillRect(-30, -52, 30, 14);
    } else {
      const air = jumpY > 0.05;
      const sw = air ? 0.6 : Math.sin(phase * 2.4);
      // ноги
      g.strokeStyle = '#1b1d4f'; g.lineWidth = 13; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-8, -44); g.lineTo(-8 + sw * 16, -14 + (air ? -10 : Math.max(0, -sw) * 8)); g.stroke();
      g.beginPath(); g.moveTo(8, -44); g.lineTo(8 - sw * 16, -14 + (air ? -4 : Math.max(0, sw) * 8)); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(-8 + sw * 16, -10 + (air ? -10 : Math.max(0, -sw) * 8), 8, 0, 7); g.arc(8 - sw * 16, -10 + (air ? -4 : Math.max(0, sw) * 8), 8, 0, 7); g.fill();
      // туловище и рюкзак
      g.fillStyle = '#ffd76a'; g.fillRect(-26, -96, 14, 40);
      g.fillStyle = fc; g.beginPath(); g.moveTo(-20, -100); g.lineTo(20, -100); g.lineTo(18, -44); g.lineTo(-18, -44); g.closePath(); g.fill();
      g.fillStyle = '#ffffff55'; g.fillRect(-4, -96, 8, 50);
      // руки
      g.strokeStyle = '#f1c7a5'; g.lineWidth = 10;
      g.beginPath(); g.moveTo(-20, -92); g.lineTo(-24 - sw * 12, -66 + (air ? -24 : 0)); g.stroke();
      g.beginPath(); g.moveTo(20, -92); g.lineTo(24 + sw * 12, -66 + (air ? -24 : 0)); g.stroke();
      // голова
      g.fillStyle = '#f1c7a5'; g.beginPath(); g.arc(0, -116, 17, 0, 7); g.fill();
      g.fillStyle = '#3b2a20'; g.beginPath(); g.arc(0, -122, 17, Math.PI, 0); g.fill();
      g.fillStyle = fc; g.fillRect(-18, -126, 36, 6); // кепка цвета ПБ
    }
    g.restore();
    // магнит — поле вокруг
    if (magnetT > 0) { g.strokeStyle = `rgba(255,90,95,${0.3 + 0.2 * Math.sin(phase * 6)})`; g.lineWidth = 3; g.beginPath(); g.arc(base.x, y - 0.5 * u, 0.6 * u, 0, 7); g.stroke(); }
  };

  const collide = () => {
    const pl = Math.round(laneX);
    for (const o of objs) {
      if (o.taken) continue;
      const near = Math.abs(o.d) < (o.kind === 'coin' ? 0.9 : 0.7);
      if (o.kind === 'coin') {
        if (magnetT > 0 && o.d < 14 && o.d > -0.5) { o.lane += (laneX - o.lane) * 0.25; o.h = (o.h ?? 0.5) + (jumpY + 0.5 - (o.h ?? 0.5)) * 0.25; }
        if (near && Math.abs(o.lane - laneX) < 0.45 && Math.abs((o.h ?? 0.5) - (jumpY + 0.6)) < 1.2) {
          o.taken = true; coins += x2T > 0 ? 2 : 1;
          const p = P(o.lane, 0.3, o.h);
          for (let i = 0; i < 5; i++) puffs.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 120, life: 0.35, c: '#ffd76a', r: 3 });
        }
        continue;
      }
      if (o.kind === 'magnet' || o.kind === 'x2') {
        if (near && o.lane === pl) { o.taken = true; if (o.kind === 'magnet') magnetT = 9; else x2T = 12; haptic('ok'); }
        continue;
      }
      if (!near || o.lane !== pl) continue;
      if (LOW.includes(o.kind) && jumpY > 0.55) continue;
      if (o.kind === 'banner' && slideT > 0) continue;
      return crash(o.kind);
    }
  };

  const stop = loop((dt, t) => {
    if (W !== wrap.clientWidth || H !== wrap.clientHeight) resize();
    phase = t * (alive ? Math.max(4, speed * 0.55) : 0);
    // перестроение — пружина, быстро и без рывка
    const target = lane;
    const acc = (target - laneX) * 260 - laneV * 30;
    laneV += acc * dt; laneX += laneV * dt;
    tilt *= Math.pow(0.002, dt);
    camX += (laneX * 0.55 - camX) * Math.min(1, dt * 6);
    if (alive && started) {
      speed = Math.min(30, 13 + dist / 180);
      const mv = speed * dt;
      dist += mv;
      // прыжок — настоящая парабола
      if (jumpY > 0 || jumpV > 0) {
        jumpV -= 26 * dt; jumpY += jumpV * dt;
        if (jumpY <= 0) { jumpY = 0; jumpV = 0; landSquash = 1; puff(0, 6, '#ffffff99'); }
      }
      slideT = Math.max(0, slideT - dt);
      landSquash = Math.max(0, landSquash - dt * 6);
      magnetT = Math.max(0, magnetT - dt); x2T = Math.max(0, x2T - dt);
      for (const o of objs) o.d -= mv + (o.vx ?? 0) * dt;
      nextRow -= mv;
      if (nextRow <= 0) { spawnRow(VIEW); nextRow = Math.max(12, 22 - dist / 400) + Math.random() * 6; }
      collide();
      while (objs.length && objs[0].d < -3) objs.shift();
      objs.sort((a, b) => a.d - b.d);
      sh.setScore(fmt(Math.round(dist) + coins * 10));
    } else if (!alive) {
      deadT += dt;
    }
    shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
    g.save();
    if (shake > 0) g.translate((Math.random() - 0.5) * 14 * shake * 4, (Math.random() - 0.5) * 10 * shake * 4);
    drawScene();
    for (let i = objs.length - 1; i >= 0; i--) if (objs[i].d > 0.1) drawObj(objs[i]);
    drawPlayer();
    for (const o of objs) if (o.d <= 0.1) drawObj(o);
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]; p.life -= dt; if (p.life <= 0) { puffs.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt;
      g.globalAlpha = Math.min(1, p.life * 3); g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); g.globalAlpha = 1;
    }
    // линии скорости
    if (alive && started && speed > 18) {
      g.strokeStyle = `rgba(255,255,255,${Math.min(0.25, (speed - 18) / 40)})`; g.lineWidth = 2;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + t; const r1 = W * 0.45, r2 = W * 0.65; g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r1, H * 0.45 + Math.sin(a) * r1 * 0.8); g.lineTo(W / 2 + Math.cos(a) * r2, H * 0.45 + Math.sin(a) * r2 * 0.8); g.stroke(); }
    }
    g.restore();
    if (flash > 0) { g.fillStyle = `rgba(255,80,80,${flash})`; g.fillRect(0, 0, W, H); }
    // HUD
    g.fillStyle = '#0f1030aa'; g.beginPath(); g.roundRect?.(10, 10, 132, 34, 17); g.fill();
    g.fillStyle = '#ffc83d'; g.beginPath(); g.arc(28, 27, 9, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '800 16px Rubik'; g.fillText(`${coins}`, 44, 33);
    g.font = '700 12px Rubik'; g.fillStyle = '#cfd4ff'; g.fillText(`${Math.round(dist)} м`, 86, 32);
    let hx = W - 12;
    g.textAlign = 'right';
    if (x2T > 0) { g.fillStyle = '#b26bff'; g.fillText(`×2 ${Math.ceil(x2T)}с`, hx, 28); hx -= 60; }
    if (magnetT > 0) { g.fillStyle = '#ff8a8a'; g.fillText(`магнит ${Math.ceil(magnetT)}с`, hx, 28); }
    g.fillStyle = '#ffffff88'; g.font = '600 11px Rubik'; g.fillText(`лучший сегодня: ${fmt(best)}`, W - 12, H - 10);
    g.textAlign = 'start';
    if (!alive && deadT > 0.9) return false;
  });

  const crash = async (kind: Kind) => {
    if (!alive) return;
    alive = false; shake = 0.35; flash = 0.35;
    haptic('heavy');
    document.removeEventListener('keydown', onKey);
    const score = Math.round(dist) + coins * 10;
    const value = Math.min(30, Math.floor(score / 120));
    const why = kind === 'stand' ? 'врезался в стенд с расписанием' : kind === 'cart' ? 'не увернулся от тележки' : kind === 'banner' ? 'не пригнулся под растяжкой' : kind === 'turnstile' ? 'застрял в турникете' : 'поскользнулся в луже';
    const got = await reportResult(app, 'runner', score, value, ctx);
    setTimeout(() => showResult(app, sh, {
      title: score > best ? 'Новый рекорд дня!' : 'Опоздал на пару', good: score > 600, score,
      lines: [`${why[0].toUpperCase()}${why.slice(1)}`, `Пробежал ${fmt(Math.round(dist))} м, собрал ${coins} профкоинов`],
      coins: coins * 5, got, value, ctx, again: () => { app.closeOverlay(); openRunner(app, ctx); },
    }), 900);
  };
  sh.onExit(() => { stop(); document.removeEventListener('keydown', onKey); });
}
