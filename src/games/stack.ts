// «Профбашня» — как Stack: этажи въезжают по очереди слева и справа, тап — опустить. Что свесилось — отпиливается.
// Ровно в край («Идеально!») — этаж не уменьшается, серия из трёх идеальных расширяет башню обратно.
// Каждые 10 этажей — новый «уровень» здания: общежитие → ГК → башня профкома → космос.
import { haptic } from '../core/telegram';
import { el } from '../lib/dom';
import type { App } from '../ui/app';
import { fitCanvas, loop, reportResult, shell, showResult, type PlayCtx } from './kit';

interface Floor { x: number; w: number; color: string; label?: string }
interface Chip { x: number; y: number; w: number; vy: number; vx: number; rot: number; color: string }

const PALETTE = ['#e8824f', '#ffc83d', '#4fd1a5', '#7ea8ff', '#b26bff', '#ff5fa2', '#2b9fcb', '#45d483', '#f5b82e', '#ff8a5b'];
const ZONES = [
  { at: 0, sky: ['#2a5f9e', '#9fd3f5'], name: 'Студгородок' },
  { at: 10, sky: ['#3b3fae', '#f0a87a'], name: 'Главный корпус' },
  { at: 20, sky: ['#1d2056', '#7a4fb4'], name: 'Башня профкома' },
  { at: 30, sky: ['#05061a', '#1d2056'], name: 'Орбита ШПА' },
];
const LABELS = ['Профбюро', 'Штаб', 'Медиа', 'Касса', 'Актовый зал', 'Коворкинг', 'Столовая', 'Лаборатория', 'Библиотека', 'Ратуша'];

export function openStack(app: App, ctx?: PlayCtx) {
  const sh = shell(app, 'stack', ctx, { dark: true });
  sh.setSub('Тапай, когда этаж над башней. Свисающее отпиливается');
  const best = app.state.daily.best.stack ?? 0;
  const wrap = el('<div class="cv-wrap"><canvas></canvas><div class="cv-hint" data-hint>Тап — поставить этаж</div></div>');
  sh.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas')!;
  const hint = wrap.querySelector<HTMLElement>('[data-hint]')!;
  let W = 360, H = 560, g = fitCanvas(cv, W, H);
  const resize = () => { const r = wrap.getBoundingClientRect(); W = r.width; H = r.height; g = fitCanvas(cv, W, H); };
  requestAnimationFrame(resize);

  const FH = 30;                 // высота этажа
  const baseW = () => Math.min(W * 0.62, 240);
  const floors: Floor[] = [];
  const chips: Chip[] = [];
  let cur: { x: number; w: number; dir: number; speed: number; color: string } | null = null;
  let camY = 0, camTarget = 0, perfect = 0, score = 0, coins = 0, over = false, pop = 0, popText = '', tt = 0, shake = 0;

  const reset = () => {
    floors.length = 0;
    const w = baseW();
    floors.push({ x: (W - w) / 2, w, color: '#3a3f9a', label: 'Фундамент' });
    spawn();
  };
  const spawn = () => {
    const top = floors[floors.length - 1];
    const n = floors.length;
    const dir = n % 2 ? 1 : -1;
    // этаж появляется сразу у края башни, чтобы не ждать, пока он доедет из-за экрана
    const x0 = dir > 0 ? top.x - top.w * 0.9 : top.x + top.w * 0.9;
    cur = { x: Math.max(-top.w * 0.6, Math.min(W - top.w * 0.4, x0)), w: top.w, dir, speed: Math.min(330, 150 + n * 6), color: PALETTE[n % PALETTE.length] };
  };
  requestAnimationFrame(() => { resize(); reset(); });

  const drop = () => {
    if (over || !cur) return;
    hint.classList.add('hidden');
    const top = floors[floors.length - 1];
    const l = Math.max(cur.x, top.x), r = Math.min(cur.x + cur.w, top.x + top.w);
    const yTop = H - 80 - floors.length * FH;
    if (r - l <= 0) { // мимо: этаж падает целиком
      chips.push({ x: cur.x, y: yTop, w: cur.w, vy: 0, vx: cur.dir * 60, rot: 0, color: cur.color });
      cur = null; lose(); return;
    }
    let x = l, w = r - l;
    const off = Math.abs(cur.x - top.x);
    if (off <= 5) { // идеально
      x = top.x; w = top.w; perfect++;
      if (perfect >= 3) { const grow = Math.min(baseW(), w + 14); x -= (grow - w) / 2; w = grow; }
      pop = 1; popText = perfect >= 3 ? `Идеально ×${perfect}!` : 'Идеально!';
      score += 1; coins += 2; haptic('ok');
    } else {
      perfect = 0; haptic('tap');
      // отпиленный кусок
      const cutX = cur.x < top.x ? cur.x : r, cutW = cur.w - w;
      chips.push({ x: cutX, y: yTop, w: cutW, vy: -40, vx: (cur.x < top.x ? -1 : 1) * 70, rot: 0, color: cur.color });
    }
    score += 1;
    floors.push({ x, w, color: cur.color, label: LABELS[floors.length % LABELS.length] });
    if (floors.length % 5 === 0) coins += 5;
    shake = 0.12;
    camTarget = Math.max(0, (floors.length - 8) * FH);
    sh.setScore(String(score));
    spawn();
  };
  cv.addEventListener('pointerdown', drop);

  const stop = loop((dt) => {
    if (W !== wrap.clientWidth || H !== wrap.clientHeight) resize();
    tt += dt;
    if (cur && !over) {
      cur.x += cur.dir * cur.speed * dt;
      if (cur.x > W - cur.w * 0.15) { cur.dir = -1; } else if (cur.x < -cur.w * 0.85) { cur.dir = 1; }
    }
    camY += (camTarget - camY) * Math.min(1, dt * 5);
    pop = Math.max(0, pop - dt * 1.2); shake = Math.max(0, shake - dt);
    // небо меняется с высотой
    const n = floors.length;
    const z = [...ZONES].reverse().find((x) => n >= x.at) ?? ZONES[0];
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, z.sky[0]); sky.addColorStop(1, z.sky[1]);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    if (n >= 20) { g.fillStyle = '#ffffffaa'; for (let i = 0; i < 40; i++) { const sx = (i * 97) % W, sy = ((i * 53 + camY * 0.3) % H); g.fillRect(sx, sy, 2, 2); } }
    // облака
    g.fillStyle = '#ffffff30';
    for (let i = 0; i < 4; i++) { const cx = ((i * 140 + tt * (10 + i * 4)) % (W + 160)) - 80, cyy = 80 + i * 90 + (camY * 0.4) % 400; g.beginPath(); g.ellipse(cx, cyy, 50, 14, 0, 0, 7); g.fill(); }
    g.save();
    g.translate(shake > 0 ? (Math.random() - 0.5) * 4 : 0, camY);
    // земля
    g.fillStyle = '#1f4f36'; g.fillRect(-20, H - 80 + FH, W + 40, 400);
    g.fillStyle = '#2f7a4a'; g.fillRect(-20, H - 80 + FH, W + 40, 6);
    floors.forEach((f, i) => drawFloor(f, H - 80 - i * FH, i));
    if (cur && !over) drawFloor({ x: cur.x, w: cur.w, color: cur.color }, H - 80 - floors.length * FH, floors.length, true);
    for (let i = chips.length - 1; i >= 0; i--) {
      const c = chips[i];
      c.vy += 900 * dt; c.y += c.vy * dt; c.x += c.vx * dt; c.rot += c.vx * dt * 0.01;
      if (c.y - camY > H + 200) { chips.splice(i, 1); continue; }
      g.save(); g.translate(c.x + c.w / 2, c.y + FH / 2); g.rotate(c.rot); g.fillStyle = c.color; g.fillRect(-c.w / 2, -FH / 2, c.w, FH); g.restore();
    }
    g.restore();
    // подписи
    g.textAlign = 'center';
    g.font = '800 15px Rubik'; g.fillStyle = '#ffffffcc';
    g.fillText(`${z.name} · этаж ${n - 1}`, W / 2, 26);
    g.font = '600 12px Rubik'; g.fillStyle = '#ffffff99';
    g.fillText(`лучший сегодня: ${Math.max(best, score)}`, W / 2, 44);
    if (pop > 0) { g.globalAlpha = Math.min(1, pop * 1.5); g.font = '800 26px Rubik'; g.fillStyle = '#ffd76a'; g.fillText(popText, W / 2, H * 0.3 - (1 - pop) * 30); g.globalAlpha = 1; }
    g.textAlign = 'start';
    if (over && !chips.length) return false;
  });

  function drawFloor(f: Floor, y: number, i: number, moving = false) {
    g.fillStyle = f.color; g.fillRect(f.x, y, f.w, FH);
    g.fillStyle = '#00000030'; g.fillRect(f.x, y + FH - 5, f.w, 5);
    g.fillStyle = '#ffffff40'; g.fillRect(f.x, y, f.w, 3);
    // окна
    g.fillStyle = moving ? '#fff6' : '#fff3c4';
    for (let wx = f.x + 7; wx < f.x + f.w - 10; wx += 15) g.fillRect(wx, y + 8, 8, 12);
    if (f.label && f.w > 90 && i > 0) { g.fillStyle = '#00000088'; g.font = '700 10px Rubik'; g.textAlign = 'left'; g.fillText(f.label, f.x + 6, y + FH - 9); }
  }

  const lose = async () => {
    over = true;
    haptic('bad');
    const value = Math.min(30, Math.round(score * 0.9));
    const got = await reportResult(app, 'stack', score, value, ctx);
    setTimeout(() => showResult(app, sh, {
      title: score >= 30 ? 'Башня до небес!' : 'Этаж не устоял', good: score >= 15, score, scoreLabel: 'этажей',
      lines: [`Идеальных подряд: ${perfect}`], coins, got, value, ctx, again: () => { app.closeOverlay(); openStack(app, ctx); },
    }), 600);
  };
  sh.onExit(() => stop());
}
