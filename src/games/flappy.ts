// «Молния» — как Flappy Bird: молния профкома летит над кампусом между трубами ТЭЦ МЭИ и проводами.
// Тап — взмах. Профкоины между трубами — бонус, каждые 10 труб — «ночная смена» быстрее и уже.
import { haptic } from '../core/telegram';
import { el } from '../lib/dom';
import type { App } from '../ui/app';
import { fitCanvas, loop, reportResult, shell, showResult, type PlayCtx } from './kit';

interface Pipe { x: number; gap: number; gy: number; passed: boolean; coin: boolean; kind: 'tec' | 'wire' }

export function openFlappy(app: App, ctx?: PlayCtx) {
  const sh = shell(app, 'flappy', ctx, { dark: true });
  sh.setSub('Тап — взмах. Пролетай между трубами ТЭЦ');
  const best = app.state.daily.best.flappy ?? 0;
  const wrap = el('<div class="cv-wrap"><canvas></canvas><div class="cv-hint" data-hint>Тапни, чтобы взлететь</div></div>');
  sh.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas')!;
  const hint = wrap.querySelector<HTMLElement>('[data-hint]')!;
  let W = 360, H = 560, g = fitCanvas(cv, W, H);
  const resize = () => { const r = wrap.getBoundingClientRect(); W = r.width; H = r.height; g = fitCanvas(cv, W, H); };
  requestAnimationFrame(resize);

  const ground = () => H - 56;
  let y = 0, vy = 0, started = false, over = false, score = 0, coins = 0, tt = 0, dist = 0, flash = 0, deadT = 0;
  const pipes: Pipe[] = [];
  const sparks: { x: number; y: number; vx: number; vy: number; life: number; c: string }[] = [];
  const PW = 58;
  const speed = () => 150 + Math.min(90, Math.floor(score / 10) * 22);
  const gapH = () => Math.max(128, 178 - Math.floor(score / 10) * 12);
  requestAnimationFrame(() => { resize(); y = H * 0.42; });

  const flap = () => {
    if (over) return;
    if (!started) { started = true; hint.classList.add('hidden'); }
    vy = -330; haptic('tap');
    for (let i = 0; i < 5; i++) sparks.push({ x: W * 0.3 - 8, y: y + 8, vx: -60 - Math.random() * 60, vy: (Math.random() - 0.3) * 80, life: 0.35, c: '#7fd0ff' });
  };
  cv.addEventListener('pointerdown', flap);

  const spawn = (x: number) => {
    const gh = gapH(), top = 70, bot = ground() - 40 - gh;
    pipes.push({ x, gap: gh, gy: top + Math.random() * Math.max(10, bot - top), passed: false, coin: Math.random() < 0.55, kind: Math.random() < 0.6 ? 'tec' : 'wire' });
  };

  const stop = loop((dt) => {
    if (W !== wrap.clientWidth || H !== wrap.clientHeight) resize();
    tt += dt;
    const bx = W * 0.3;
    if (started && !over) {
      vy += 980 * dt; y += vy * dt;
      const sp = speed();
      dist += sp * dt;
      for (const p of pipes) p.x -= sp * dt;
      if (!pipes.length || pipes[pipes.length - 1].x < W - 210) spawn(W + 20);
      while (pipes.length && pipes[0].x < -PW - 20) pipes.shift();
      for (const p of pipes) {
        if (!p.passed && p.x + PW < bx - 14) { p.passed = true; score++; sh.setScore(String(score)); if (score % 10 === 0) { flash = 0.4; haptic('ok'); } }
        if (p.coin && Math.abs(p.x + PW / 2 - bx) < 18 && Math.abs(p.gy + p.gap / 2 - y) < 24) {
          p.coin = false; coins += 10;
          for (let i = 0; i < 10; i++) sparks.push({ x: bx, y, vx: (Math.random() - 0.5) * 200, vy: (Math.random() - 0.5) * 200, life: 0.5, c: '#ffc83d' });
        }
        const inX = bx + 13 > p.x && bx - 13 < p.x + PW;
        if (inX && (y - 13 < p.gy || y + 13 > p.gy + p.gap)) die();
      }
      if (y + 14 > ground() || y < -40) die();
    } else if (!started) {
      y = H * 0.42 + Math.sin(tt * 3) * 8;
    } else if (over) {
      deadT += dt;
      if (y + 14 < ground()) { vy += 980 * dt; y += vy * dt; }
    }
    flash = Math.max(0, flash - dt);

    // ---------- фон: ночной кампус ----------
    const night = Math.min(1, Math.floor(score / 10) * 0.35);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, mix('#3b6fb6', '#0b0d2a', night)); sky.addColorStop(1, mix('#f0b27a', '#2c3080', night));
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    if (night > 0) { g.fillStyle = `rgba(255,255,255,${night * 0.8})`; for (let i = 0; i < 30; i++) g.fillRect((i * 71 - dist * 0.05) % W + (i * 71 - dist * 0.05 < 0 ? W : 0), (i * 37) % (H * 0.5), 2, 2); }
    // дальний план: силуэт ГУК и труба ТЭЦ
    const far = (dist * 0.2) % (W + 300);
    g.fillStyle = mix('#5a70b0', '#1d2056', night);
    for (let k = 0; k < 2; k++) {
      const ox = W - far + k * (W + 300);
      g.fillRect(ox, ground() - 120, 150, 120); g.fillRect(ox + 30, ground() - 150, 90, 30);
      for (let c = 0; c < 6; c++) g.fillRect(ox + 12 + c * 22, ground() - 175, 8, 25);
      g.fillRect(ox + 190, ground() - 230, 16, 230);
    }
    // ближний план: деревья
    const near = (dist * 0.5) % 60;
    g.fillStyle = mix('#2f7a4a', '#163a28', night);
    for (let x = -near; x < W + 60; x += 60) { g.beginPath(); g.arc(x, ground() - 6, 26, Math.PI, 0); g.fill(); }
    // трубы
    for (const p of pipes) drawPipe(p);
    // земля
    g.fillStyle = mix('#c9a46a', '#3a3f9a', night); g.fillRect(0, ground(), W, H - ground());
    g.fillStyle = '#00000030';
    for (let x = -((dist) % 28); x < W; x += 28) g.fillRect(x, ground() + 6, 14, 4);
    // искры
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.life -= dt; if (s.life <= 0) { sparks.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; g.globalAlpha = s.life * 2; g.fillStyle = s.c; g.fillRect(s.x, s.y, 3, 3); g.globalAlpha = 1;
    }
    // молния
    g.save(); g.translate(bx, y); g.rotate(Math.max(-0.5, Math.min(1.1, vy / 600)));
    g.fillStyle = '#009ee3'; g.beginPath(); g.arc(0, 0, 16, 0, 7); g.fill();
    g.strokeStyle = '#7fd0ff'; g.lineWidth = 2.5; g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(3, -12); g.lineTo(-7, 2); g.lineTo(0, 2); g.lineTo(-3, 12); g.lineTo(8, -3); g.lineTo(1, -3); g.lineTo(5, -12); g.closePath(); g.fill();
    g.restore();
    if (flash > 0) { g.fillStyle = `rgba(255,255,255,${flash})`; g.fillRect(0, 0, W, H); }
    // надписи
    g.textAlign = 'center';
    g.font = '800 44px Rubik'; g.fillStyle = '#ffffffdd'; g.strokeStyle = '#0006'; g.lineWidth = 5;
    if (started) { g.strokeText(String(score), W / 2, 70); g.fillText(String(score), W / 2, 70); }
    g.font = '600 12px Rubik'; g.fillStyle = '#ffffffaa';
    g.fillText(`лучший сегодня: ${Math.max(best, score)}${coins ? ` · профкоины +${coins}` : ''}`, W / 2, H - 18);
    if (score >= 10 && score % 10 < 2 && started && !over) { g.font = '800 18px Rubik'; g.fillStyle = '#ffd76a'; g.fillText('Ночная смена: быстрее!', W / 2, 100); }
    g.textAlign = 'start';
    if (over && deadT > 1.2) return false;
  });

  function drawPipe(p: Pipe) {
    const gb = ground();
    if (p.kind === 'tec') {
      // нижняя — труба ТЭЦ в красно-белую полоску, верхняя — козырёк
      const top = p.gy + p.gap;
      for (let yy = top; yy < gb; yy += 22) { g.fillStyle = Math.floor((yy - top) / 22) % 2 ? '#f1e3c8' : '#c8553d'; g.fillRect(p.x, yy, PW, Math.min(22, gb - yy)); }
      g.fillStyle = '#8a3f22'; g.fillRect(p.x - 5, top, PW + 10, 12);
      g.fillStyle = '#9aa3c7'; g.fillRect(p.x, 0, PW, p.gy);
      g.fillStyle = '#5a6090'; g.fillRect(p.x - 5, p.gy - 12, PW + 10, 12);
      g.fillStyle = '#ffffff22'; g.fillRect(p.x + 6, 0, 6, p.gy - 12);
    } else {
      // опоры ЛЭП: решётка сверху и снизу
      const draw = (y0: number, y1: number) => {
        g.fillStyle = '#3a3f9a'; g.fillRect(p.x, y0, PW, y1 - y0);
        g.strokeStyle = '#7ea8ff'; g.lineWidth = 2;
        for (let yy = y0; yy < y1; yy += 18) { g.beginPath(); g.moveTo(p.x, yy); g.lineTo(p.x + PW, Math.min(y1, yy + 18)); g.moveTo(p.x + PW, yy); g.lineTo(p.x, Math.min(y1, yy + 18)); g.stroke(); }
      };
      draw(0, p.gy); draw(p.gy + p.gap, gb);
      g.fillStyle = '#ffd76a'; g.fillRect(p.x - 6, p.gy - 8, PW + 12, 8); g.fillRect(p.x - 6, p.gy + p.gap, PW + 12, 8);
    }
    if (p.coin) {
      const cx = p.x + PW / 2, cy = p.gy + p.gap / 2 + Math.sin(tt * 4 + p.x * 0.05) * 6;
      g.fillStyle = '#ffc83d'; g.beginPath(); g.arc(cx, cy, 10, 0, 7); g.fill();
      g.fillStyle = '#c89200'; g.font = '800 11px Rubik'; g.textAlign = 'center'; g.fillText('П', cx, cy + 4); g.textAlign = 'start';
    }
  }

  function die() {
    if (over) return;
    over = true; vy = -120; haptic('bad');
    for (let i = 0; i < 20; i++) sparks.push({ x: W * 0.3, y, vx: (Math.random() - 0.5) * 300, vy: (Math.random() - 0.5) * 300, life: 0.6, c: '#7fd0ff' });
    finish();
  }
  const finish = async () => {
    const value = Math.min(30, score * 2);
    const got = await reportResult(app, 'flappy', score, value, ctx);
    setTimeout(() => showResult(app, sh, {
      title: score >= 20 ? 'Молния не гаснет!' : 'Задел трубу ТЭЦ', good: score >= 10, score, scoreLabel: 'труб пройдено',
      coins, got, value, ctx, again: () => { app.closeOverlay(); openFlappy(app, ctx); },
    }), 900);
  };
  sh.onExit(() => stop());
}

/** Смешивание двух цветов #rrggbb. */
function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
