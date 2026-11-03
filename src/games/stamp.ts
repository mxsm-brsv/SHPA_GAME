// «Печать» — как Knife Hit: ставь печати на вращающийся отчёт. Попал в уже стоящую печать — уровень проигран.
// Каждый 5-й уровень — босс «Годовой отчёт»: крутится рывками и меняет направление.
import { haptic } from '../core/telegram';
import { el } from '../lib/dom';
import type { App } from '../ui/app';
import { fitCanvas, loop, reportResult, shell, showResult, type PlayCtx } from './kit';

interface Lvl { need: number; pre: number; speed: number; jerky: boolean; coins: number }
const lvlCfg = (n: number): Lvl => ({ need: 5 + Math.min(5, Math.floor(n / 2)), pre: Math.min(4, Math.floor((n - 1) / 2)), speed: 1.4 + n * 0.18, jerky: n % 5 === 0, coins: n % 5 === 0 ? 0 : 1 + (n % 3) });

export function openStamp(app: App, ctx?: PlayCtx) {
  const s = app.state;
  const sh = shell(app, 'stamp', ctx, { dark: true });
  const wrap = el('<div class="cv-wrap"><canvas></canvas></div>');
  sh.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas')!;
  let W = 360, H = 560, g = fitCanvas(cv, W, H);
  const resize = () => { const r = wrap.getBoundingClientRect(); W = r.width; H = r.height; g = fitCanvas(cv, W, H); };
  requestAnimationFrame(resize);

  let level = 1, total = 0, gotCoins = 0, over = false;
  let cfg = lvlCfg(level);
  let angle = 0, dir = 1, jerkT = 0;
  let stuck: number[] = [];        // углы воткнутых печатей (относительно диска)
  let coinsOn: number[] = [];      // углы профкоинов на диске
  let left = cfg.need;
  let flying: { y: number } | null = null;
  let flash = 0;
  const R = () => Math.min(W, H) * 0.24;
  const cy = () => H * 0.34;

  const startLevel = () => {
    cfg = lvlCfg(level);
    left = cfg.need;
    stuck = Array.from({ length: cfg.pre }, (_, i) => (i / Math.max(1, cfg.pre)) * Math.PI * 2 + 0.4);
    coinsOn = Array.from({ length: cfg.coins }, (_, i) => (i / Math.max(1, cfg.coins)) * Math.PI * 2 + 1.3);
    sh.setSub(cfg.jerky ? `Уровень ${level} · БОСС «Годовой отчёт»` : `Уровень ${level} · поставь ${cfg.need} печатей`);
  };
  startLevel();

  const throwIt = () => { if (over || flying) return; flying = { y: H * 0.86 }; haptic(); };
  cv.addEventListener('pointerdown', throwIt);

  const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const hitAngle = () => norm(Math.PI / 2 - angle); // нижняя точка диска в координатах диска

  const stamp = (x: number, y: number, rot: number, alpha = 1) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.globalAlpha = alpha;
    g.fillStyle = '#5b3a28'; g.fillRect(-7, 10, 14, 34);
    g.fillStyle = '#8a6b4a'; g.beginPath(); g.arc(0, 48, 11, 0, 7); g.fill();
    g.fillStyle = '#c8553d'; g.fillRect(-14, -2, 28, 12);
    g.restore();
  };

  const stop = loop((dt) => {
    if (W !== wrap.clientWidth) resize();
    if (!over) {
      if (cfg.jerky) { jerkT -= dt; if (jerkT <= 0) { jerkT = 0.6 + Math.random() * 1.1; if (Math.random() < 0.5) dir *= -1; } }
      angle += dt * cfg.speed * dir * (cfg.jerky ? 1 + Math.sin(performance.now() / 300) * 0.6 : 1);
      if (flying) {
        flying.y -= dt * 1900;
        if (flying.y <= cy() + R() + 6) {
          const a = hitAngle();
          const clash = stuck.some((b) => { const d = Math.abs(norm(a - b)); return Math.min(d, Math.PI * 2 - d) < 0.2; });
          flying = null;
          if (clash) { lose(); return; }
          stuck.push(a);
          const ci = coinsOn.findIndex((b) => { const d = Math.abs(norm(a - b)); return Math.min(d, Math.PI * 2 - d) < 0.25; });
          if (ci >= 0) { coinsOn.splice(ci, 1); gotCoins += 20; }
          total++; left--; flash = 0.12; haptic('tap');
          if (left <= 0) { level++; haptic('ok'); setTimeout(startLevel, 350); }
        }
      }
    }
    flash = Math.max(0, flash - dt);
    sh.setScore(`${total}`);
    // фон
    g.fillStyle = '#1b1d4f'; g.fillRect(0, 0, W, H);
    // диск-отчёт
    const r = R(), c = cy();
    g.save(); g.translate(W / 2, c); g.rotate(angle);
    for (const b of stuck) { g.save(); g.rotate(b - Math.PI / 2); stamp(0, r - 6, 0); g.restore(); }
    for (const b of coinsOn) { g.save(); g.rotate(b - Math.PI / 2); g.translate(0, r + 16); g.fillStyle = '#ffc83d'; g.beginPath(); g.arc(0, 0, 10, 0, 7); g.fill(); g.restore(); }
    g.fillStyle = cfg.jerky ? '#c8553d' : '#f1e3c8'; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    g.strokeStyle = '#8a6b4a'; g.lineWidth = 4; g.stroke();
    g.fillStyle = cfg.jerky ? '#fff' : '#8a6b4a';
    for (let i = -2; i <= 2; i++) g.fillRect(-r * 0.5, i * r * 0.18 - 2, r, 4);
    g.font = `800 ${Math.round(r * 0.22)}px Rubik`; g.textAlign = 'center';
    g.fillStyle = cfg.jerky ? '#fff' : '#c8553d';
    g.fillText(cfg.jerky ? 'ГОДОВОЙ' : 'ОТЧЁТ', 0, -r * 0.55);
    g.restore();
    if (flash > 0) { g.fillStyle = `rgba(255,255,255,${flash * 3})`; g.beginPath(); g.arc(W / 2, c, r + 8, 0, 7); g.fill(); }
    // печати в запасе
    for (let i = 0; i < left - (flying ? 1 : 0); i++) stamp(24, H - 40 - i * 26, -Math.PI / 2, 0.6);
    if (!over) stamp(W / 2, flying ? flying.y : H * 0.86, 0);
    g.textAlign = 'start';
    if (over) return false;
  });

  const lose = async () => {
    over = true;
    haptic('bad');
    const value = Math.min(30, (level - 1) * 5 + Math.floor(total / 4));
    const got = await reportResult(app, 'stamp', total, value, ctx);
    showResult(app, sh, { title: level > 5 ? 'Годовой отчёт сдан!' : 'Печать сорвалась', good: level > 3, score: total, scoreLabel: 'печатей поставлено', lines: [`Пройдено уровней: ${level - 1}`], coins: gotCoins, got, value, ctx, again: () => { app.closeOverlay(); openStamp(app, ctx); } });
  };
  sh.onExit(() => stop());
  void s;
}
