// «Бегом на пару» — как Subway Surfers: три дорожки коридора МЭИ, свайп влево/вправо, вверх — прыжок.
import { factionById } from '../config/factions';
import { haptic } from '../core/telegram';
import { el, fmt } from '../lib/dom';
import type { App } from '../ui/app';
import { fitCanvas, loop, reportResult, shell, showResult, type PlayCtx } from './kit';

type Kind = 'coin' | 'puddle' | 'turnstile' | 'stand';
interface Obj { lane: number; z: number; kind: Kind; taken?: boolean }

export function openRunner(app: App, ctx?: PlayCtx) {
  const s = app.state;
  const fc = factionById(s.faction).color;
  const sh = shell(app, 'runner', ctx, { dark: true });
  sh.setSub('Свайп влево/вправо — дорожка, вверх или тап — прыжок');
  const wrap = el('<div class="cv-wrap"><canvas></canvas><div class="cv-hint">Беги на пару! Лужи и турникеты перепрыгивай, стенды обходи</div></div>');
  sh.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas')!;
  let W = 360, H = 560, g = fitCanvas(cv, W, H);
  const resize = () => { const r = wrap.getBoundingClientRect(); W = r.width; H = r.height; g = fitCanvas(cv, W, H); };
  requestAnimationFrame(resize);

  let lane = 0, laneX = 0, jumpT = 0, speed = 0.55, dist = 0, coins = 0, alive = true, spawnZ = 0, started = false;
  const objs: Obj[] = [];
  const hint = wrap.querySelector<HTMLElement>('.cv-hint')!;

  const proj = (z: number) => {
    const p = 1 - z;
    const hy = H * 0.24, gy = H * 0.86;
    return { y: hy + (gy - hy) * p * p, k: 0.18 + 0.82 * p * p };
  };
  const laneW = () => W * 0.3;

  const spawn = () => {
    const l = Math.floor(Math.random() * 3) - 1;
    const r = Math.random();
    if (r < 0.45) { for (let i = 0; i < 4; i++) objs.push({ lane: l, z: 1 + i * 0.06, kind: 'coin' }); }
    else if (r < 0.65) objs.push({ lane: l, z: 1, kind: 'puddle' });
    else if (r < 0.82) objs.push({ lane: l, z: 1, kind: 'turnstile' });
    else { objs.push({ lane: l, z: 1, kind: 'stand' }); if (Math.random() < 0.4) objs.push({ lane: l === 1 ? -1 : l + 1, z: 1, kind: 'stand' }); }
  };

  const move = (d: number) => { if (!alive) return; started = true; hint.style.display = 'none'; lane = Math.max(-1, Math.min(1, lane + d)); haptic(); };
  const jump = () => { if (!alive) return; started = true; hint.style.display = 'none'; if (jumpT <= 0) { jumpT = 0.75; haptic(); } };
  let sx = 0, sy = 0;
  cv.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  cv.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1);
    else if (dy < -30) jump();
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) jump();
  });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') move(-1); if (e.key === 'ArrowRight') move(1); if (e.key === 'ArrowUp' || e.key === ' ') jump(); };
  document.addEventListener('keydown', onKey);

  const drawScene = (t: number) => {
    // стены коридора и пол
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2b2f6b'); sky.addColorStop(0.3, '#3b3f8f'); sky.addColorStop(1, '#5a4a7a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const hy = H * 0.24;
    g.fillStyle = '#c9b48e';
    g.beginPath(); g.moveTo(W * 0.42, hy); g.lineTo(W * 0.58, hy); g.lineTo(W * 1.05, H); g.lineTo(-W * 0.05, H); g.closePath(); g.fill();
    g.fillStyle = '#e8d7b8';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 0.42, hy); g.lineTo(-W * 0.05, H); g.lineTo(0, H); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(W, 0); g.lineTo(W * 0.58, hy); g.lineTo(W * 1.05, H); g.lineTo(W, H); g.closePath(); g.fill();
    // двери аудиторий
    for (let i = 0; i < 6; i++) {
      const z = ((i / 6) - (t * speed * 0.6) % (1 / 6) + 1) % 1;
      const { y, k } = proj(z);
      const dh = 120 * k, dw = 40 * k;
      g.fillStyle = '#6a3d2a';
      g.fillRect(W / 2 - laneW() * 1.9 * k - dw, y - dh, dw, dh);
      g.fillRect(W / 2 + laneW() * 1.9 * k, y - dh, dw, dh);
      g.fillStyle = '#ffd76a'; g.font = `${Math.max(7, 12 * k)}px Rubik`;
      g.fillText(`А-${300 + ((i * 7 + Math.floor(t)) % 40)}`, W / 2 + laneW() * 1.9 * k, y - dh - 4);
    }
    // плитка пола
    g.strokeStyle = '#a8946e'; g.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const z = ((i / 12) - (t * speed) % (1 / 12) + 1) % 1;
      const { y } = proj(z);
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    for (const lx of [-0.5, 0.5]) {
      g.beginPath();
      const a = proj(1), b = proj(0);
      g.moveTo(W / 2 + lx * laneW() * a.k, a.y); g.lineTo(W / 2 + lx * laneW() * b.k, b.y); g.stroke();
    }
  };

  const drawObj = (o: Obj) => {
    const { y, k } = proj(o.z);
    const x = W / 2 + o.lane * laneW() * k;
    if (o.kind === 'coin') {
      if (o.taken) return;
      g.fillStyle = '#ffc83d'; g.beginPath(); g.arc(x, y - 30 * k, 14 * k, 0, 7); g.fill();
      g.fillStyle = '#f2a900'; g.beginPath(); g.arc(x, y - 30 * k, 9 * k, 0, 7); g.fill();
    } else if (o.kind === 'puddle') {
      g.fillStyle = '#4aa8ff'; g.beginPath(); g.ellipse(x, y, 48 * k, 14 * k, 0, 0, 7); g.fill();
      g.fillStyle = '#9fd6ff'; g.beginPath(); g.ellipse(x - 10 * k, y - 3 * k, 14 * k, 4 * k, 0, 0, 7); g.fill();
    } else if (o.kind === 'turnstile') {
      g.fillStyle = '#9aa3c7'; g.fillRect(x - 46 * k, y - 46 * k, 14 * k, 46 * k); g.fillRect(x + 32 * k, y - 46 * k, 14 * k, 46 * k);
      g.fillStyle = '#e8453c'; g.fillRect(x - 32 * k, y - 34 * k, 64 * k, 8 * k);
    } else {
      g.fillStyle = '#c8553d'; g.fillRect(x - 44 * k, y - 110 * k, 88 * k, 110 * k);
      g.fillStyle = '#fff'; g.font = `700 ${Math.max(8, 14 * k)}px Rubik`; g.textAlign = 'center';
      g.fillText('ДЕКАНАТ', x, y - 60 * k); g.textAlign = 'start';
    }
  };

  const drawPlayer = (t: number) => {
    const { y } = proj(0.02);
    laneX += (lane - laneX) * 0.3;
    const x = W / 2 + laneX * laneW();
    const jy = jumpT > 0 ? Math.sin((1 - jumpT / 0.75) * Math.PI) * 90 : 0;
    const bob = jumpT > 0 ? 0 : Math.sin(t * 18) * 3;
    g.fillStyle = '#00000044'; g.beginPath(); g.ellipse(x, y + 4, 26, 8, 0, 0, 7); g.fill();
    const by = y - jy + bob;
    g.fillStyle = fc; g.fillRect(x - 16, by - 62, 32, 40);
    g.fillStyle = '#1b1d4f'; g.fillRect(x - 14, by - 24, 11, 22); g.fillRect(x + 3, by - 24, 11, 22);
    g.fillStyle = '#f1c7a5'; g.beginPath(); g.arc(x, by - 74, 14, 0, 7); g.fill();
    g.fillStyle = '#3b2a20'; g.beginPath(); g.arc(x, by - 80, 14, Math.PI, 0); g.fill();
    g.fillStyle = '#ffd76a'; g.fillRect(x - 20, by - 58, 8, 26); // рюкзак
  };

  const stop = loop((dt, t) => {
    if (W !== wrap.clientWidth) resize();
    if (alive && started) {
      speed += dt * 0.012;
      dist += dt * speed * 60;
      jumpT = Math.max(0, jumpT - dt);
      spawnZ -= dt * speed;
      if (spawnZ <= 0) { spawn(); spawnZ = 0.33 + Math.random() * 0.25; }
      for (const o of objs) o.z -= dt * speed;
      for (const o of objs) {
        if (o.z < 0.06 && o.z > -0.02 && o.lane === lane) {
          if (o.kind === 'coin' && !o.taken) { o.taken = true; coins++; haptic(); }
          else if ((o.kind === 'puddle' || o.kind === 'turnstile') && jumpT <= 0.12) crash();
          else if (o.kind === 'stand') crash();
        }
      }
      while (objs.length && objs[0].z < -0.1) objs.shift();
      sh.setScore(`${fmt(Math.round(dist) + coins * 10)}`);
    }
    drawScene(t);
    [...objs].sort((a, b) => b.z - a.z).forEach(drawObj);
    drawPlayer(t);
    if (!alive) return false;
  });

  const crash = async () => {
    alive = false;
    haptic('bad');
    stop();
    document.removeEventListener('keydown', onKey);
    const score = Math.round(dist) + coins * 10;
    const value = Math.min(30, Math.floor(score / 120));
    const got = await reportResult(app, 'runner', score, value, ctx);
    showResult(app, sh, { title: score > (s.daily.best.runner ?? 0) ? 'Новый рекорд дня!' : 'Опоздал на пару', good: score > 300, score, lines: [`Пробежал ${fmt(Math.round(dist))} м, собрал ${coins} профкоинов`], coins: coins * 5, got, value, ctx, again: () => { app.closeOverlay(); openRunner(app, ctx); } });
  };
  sh.onExit(() => { stop(); document.removeEventListener('keydown', onKey); });
}
