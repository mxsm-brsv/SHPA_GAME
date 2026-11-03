// «Печать» — как Knife Hit: втыкай канцелярию в вращающиеся документы. Попал в уже воткнутое — уровень проигран.
// Каждый уровень — новый документ и новый инструмент: печать, ручка, кнопка, степлер, маркер, штамп «Принято».
// Каждый 5-й уровень — босс: «Годовой отчёт» (рывками), «Колдоговор» (разгоняется), «Смета» (меняет направление).
import { haptic } from '../core/telegram';
import { el } from '../lib/dom';
import type { App } from '../ui/app';
import { fitCanvas, loop, reportResult, shell, showResult, type PlayCtx } from './kit';

type G = CanvasRenderingContext2D;
type Spin = 'const' | 'wave' | 'reverse' | 'jerky' | 'accel';

// ---------- Инструменты: остриё в (0,0), корпус уходит вниз (+y) ----------
const TOOLS: { id: string; name: string; draw: (g: G) => void }[] = [
  { id: 'stamp', name: 'Печать', draw: (g) => {
    g.fillStyle = '#c8553d'; rr(g, -15, -2, 30, 12, 3); g.fill();
    g.fillStyle = '#5b3a28'; g.fillRect(-7, 10, 14, 32);
    g.fillStyle = '#8a6b4a'; g.beginPath(); g.arc(0, 48, 11, 0, 7); g.fill();
    g.fillStyle = '#ffffff40'; g.fillRect(-5, 12, 3, 28);
  } },
  { id: 'pen', name: 'Ручка', draw: (g) => {
    g.fillStyle = '#2a2d4a'; g.beginPath(); g.moveTo(0, -4); g.lineTo(-5, 10); g.lineTo(5, 10); g.fill();
    g.fillStyle = '#2f6fd6'; rr(g, -5, 10, 10, 42, 3); g.fill();
    g.fillStyle = '#1b3f80'; rr(g, -6, 44, 12, 12, 3); g.fill();
    g.strokeStyle = '#c9d3ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(4, 30); g.lineTo(4, 50); g.stroke();
  } },
  { id: 'pin', name: 'Кнопка', draw: (g) => {
    g.strokeStyle = '#b9bdd8'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -3); g.lineTo(0, 16); g.stroke();
    g.fillStyle = '#e8453c'; rr(g, -9, 16, 18, 12, 4); g.fill();
    g.fillStyle = '#ff7a6e'; g.beginPath(); g.ellipse(0, 31, 13, 6, 0, 0, 7); g.fill();
    g.fillStyle = '#ffffff60'; g.fillRect(-6, 18, 3, 8);
  } },
  { id: 'stapler', name: 'Степлер', draw: (g) => {
    g.fillStyle = '#c0c4d8'; g.fillRect(-9, -2, 18, 6);
    g.fillStyle = '#3a3f9a'; rr(g, -11, 3, 22, 48, 6); g.fill();
    g.fillStyle = '#5a60c8'; rr(g, -8, 6, 16, 30, 4); g.fill();
    g.fillStyle = '#23266a'; g.beginPath(); g.arc(0, 47, 6, 0, 7); g.fill();
  } },
  { id: 'marker', name: 'Маркер', draw: (g) => {
    g.fillStyle = '#ffe14d'; g.beginPath(); g.moveTo(-3, -3); g.lineTo(3, -3); g.lineTo(6, 8); g.lineTo(-6, 8); g.fill();
    g.fillStyle = '#ffc83d'; rr(g, -7, 8, 14, 40, 4); g.fill();
    g.fillStyle = '#2a2d4a'; rr(g, -7, 22, 14, 6, 1); g.fill();
    g.fillStyle = '#d99a00'; rr(g, -8, 46, 16, 9, 3); g.fill();
  } },
  { id: 'approve', name: 'Штамп «Принято»', draw: (g) => {
    g.fillStyle = '#2fbf71'; rr(g, -16, -2, 32, 12, 3); g.fill();
    g.fillStyle = '#fff'; g.font = '800 7px Rubik'; g.textAlign = 'center'; g.fillText('ПРИНЯТО', 0, 7);
    g.fillStyle = '#1f3a5f'; g.fillRect(-6, 10, 12, 30);
    g.fillStyle = '#2f8fd6'; g.beginPath(); g.ellipse(0, 46, 12, 8, 0, 0, 7); g.fill();
  } },
];

// ---------- Документы ----------
interface Target { name: string; boss?: boolean; paper: string; ink: string; edge: string; title: string; spin: Spin; deco: (g: G, r: number) => void }
const lines = (g: G, r: number, col: string, n = 5) => { g.fillStyle = col; for (let i = -n / 2; i < n / 2; i++) g.fillRect(-r * 0.55, i * r * 0.17 + r * 0.05, r * 1.1, 3); };
const TARGETS: Target[] = [
  { name: 'Отчёт', paper: '#f1e3c8', ink: '#c8553d', edge: '#8a6b4a', title: 'ОТЧЁТ', spin: 'const', deco: (g, r) => lines(g, r, '#8a6b4a') },
  { name: 'Профбилет', paper: '#2b9fcb', ink: '#fff', edge: '#0f4a60', title: 'ПРОФБИЛЕТ', spin: 'wave', deco: (g, r) => {
    g.fillStyle = '#ffffffdd'; rr(g, -r * 0.55, -r * 0.25, r * 0.45, r * 0.55, 6); g.fill();
    g.fillStyle = '#ffd76a'; g.beginPath(); g.moveTo(r * 0.2, -r * 0.2); g.lineTo(r * 0.05, r * 0.08); g.lineTo(r * 0.2, r * 0.08); g.lineTo(r * 0.1, r * 0.38); g.lineTo(r * 0.42, -0.02 * r); g.lineTo(r * 0.26, -0.02 * r); g.lineTo(r * 0.38, -r * 0.2); g.fill();
  } },
  { name: 'Зачётка', paper: '#23266a', ink: '#ffd76a', edge: '#ffc83d', title: 'ЗАЧЁТКА', spin: 'reverse', deco: (g, r) => lines(g, r, '#ffffff30', 4) },
  { name: 'Протокол собрания', paper: '#ffffff', ink: '#3a3f9a', edge: '#9aa3c7', title: 'ПРОТОКОЛ', spin: 'wave', deco: (g, r) => {
    g.strokeStyle = '#c9cff0'; g.lineWidth = 1.5;
    for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(-r * 0.7, i * r * 0.16); g.lineTo(r * 0.7, i * r * 0.16); g.stroke(); }
  } },
  { name: 'Заявление на матпомощь', paper: '#d8f5e3', ink: '#1f7a4a', edge: '#2fbf71', title: 'ЗАЯВЛЕНИЕ', spin: 'accel', deco: (g, r) => {
    lines(g, r, '#9fd8b8', 3);
    g.strokeStyle = '#1f3a8a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-r * 0.1, r * 0.5);
    for (let i = 0; i < 6; i++) g.quadraticCurveTo(i * 8 - r * 0.05, r * (i % 2 ? 0.38 : 0.6), i * 8 + 4 - r * 0.05, r * 0.5);
    g.stroke();
  } },
];
const BOSSES: Target[] = [
  { name: 'Годовой отчёт', boss: true, paper: '#c8553d', ink: '#fff', edge: '#6b1f12', title: 'ГОДОВОЙ', spin: 'jerky', deco: (g, r) => lines(g, r, '#ffffffaa') },
  { name: 'Коллективный договор', boss: true, paper: '#4b2a7a', ink: '#ffd76a', edge: '#ffc83d', title: 'КОЛДОГОВОР', spin: 'accel', deco: (g, r) => {
    g.strokeStyle = '#ffd76a'; g.lineWidth = 3; g.beginPath(); g.arc(0, r * 0.22, r * 0.28, 0, 7); g.stroke();
    g.fillStyle = '#ffd76a'; g.font = `800 ${Math.round(r * 0.16)}px Rubik`; g.textAlign = 'center'; g.fillText('ППО', 0, r * 0.28);
  } },
  { name: 'Смета профкома', boss: true, paper: '#1f5a3a', ink: '#c6f6d5', edge: '#45d483', title: 'СМЕТА', spin: 'reverse', deco: (g, r) => {
    g.strokeStyle = '#45d48366'; g.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(-r * 0.6, i * r * 0.18); g.lineTo(r * 0.6, i * r * 0.18); g.stroke(); g.beginPath(); g.moveTo(i * r * 0.22, -r * 0.4); g.lineTo(i * r * 0.22, r * 0.5); g.stroke(); }
    g.fillStyle = '#c6f6d5'; g.font = `800 ${Math.round(r * 0.3)}px Rubik`; g.textAlign = 'center'; g.fillText('₽', 0, r * 0.32);
  } },
];

function rr(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

interface Lvl { n: number; need: number; pre: number; speed: number; boss: boolean; target: Target; tool: number; coins: number; stars: number }
const lvlCfg = (n: number): Lvl => {
  const boss = n % 5 === 0;
  return {
    n, boss,
    need: boss ? 9 + Math.min(4, Math.floor(n / 5)) : 5 + Math.min(5, Math.floor(n / 2)),
    pre: boss ? Math.min(5, 1 + Math.floor(n / 5)) : Math.min(4, Math.floor((n - 1) / 2)),
    speed: 1.3 + Math.min(14, n) * 0.16,
    target: boss ? BOSSES[(n / 5 - 1) % BOSSES.length] : TARGETS[(n - 1 - Math.floor(n / 5)) % TARGETS.length],
    tool: (n - 1) % TOOLS.length,
    coins: boss ? 3 : 1 + (n % 3),
    stars: n >= 3 && !boss ? 1 : 0,
  };
};

interface Stuck { a: number; tool: number; foe: boolean }
interface Bit { x: number; y: number; vx: number; vy: number; rot: number; vr: number; life: number; size: number; color: string; kind: 'dot' | 'shard' | 'tool'; tool?: number }

export function openStamp(app: App, ctx?: PlayCtx) {
  const sh = shell(app, 'stamp', ctx, { dark: true });
  const best = app.state.daily.best.stamp ?? 0;
  const wrap = el('<div class="cv-wrap"><canvas></canvas></div>');
  sh.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas')!;
  let W = 360, H = 560, g = fitCanvas(cv, W, H);
  const resize = () => { const r = wrap.getBoundingClientRect(); W = r.width; H = r.height; g = fitCanvas(cv, W, H); };
  requestAnimationFrame(resize);

  let lv = lvlCfg(1);
  let total = 0, gotCoins = 0, over = false, clearing = 0, banner = 0;
  let angle = 0, w = 0, wTarget = 0, spinT = 0, dir = 1, bump = 0, flash = 0, tt = 0;
  let stuck: Stuck[] = [];
  let items: { a: number; kind: 'coin' | 'star' }[] = [];
  let left = lv.need;
  let flying: { y: number } | null = null;
  const bits: Bit[] = [];
  const R = () => Math.min(W * 0.27, H * 0.2);
  const cy = () => H * 0.36;
  const restY = () => H - Math.max(70, H * 0.13);

  const startLevel = (n: number) => {
    lv = lvlCfg(n);
    left = lv.need;
    stuck = Array.from({ length: lv.pre }, (_, i) => ({ a: (i / Math.max(1, lv.pre)) * Math.PI * 2 + 0.4, tool: (lv.tool + 2 + i) % TOOLS.length, foe: true }));
    const free = (a: number) => stuck.every((s) => Math.abs(Math.atan2(Math.sin(a - s.a), Math.cos(a - s.a))) > 0.45);
    items = [];
    for (let i = 0, tries = 0; i < lv.coins + lv.stars && tries < 60; tries++) {
      const a = Math.random() * Math.PI * 2;
      if (free(a) && items.every((x) => Math.abs(Math.atan2(Math.sin(a - x.a), Math.cos(a - x.a))) > 0.5)) { items.push({ a, kind: i < lv.coins ? 'coin' : 'star' }); i++; }
    }
    dir = Math.random() < 0.5 ? 1 : -1;
    spinT = 0; banner = 1.4;
    sh.setSub(lv.boss ? `Уровень ${n} · БОСС «${lv.target.name}»` : `Уровень ${n} · ${TOOLS[lv.tool].name} → ${lv.target.name}`);
  };
  startLevel(1);

  const throwIt = () => { if (over || flying || clearing > 0) return; flying = { y: restY() }; haptic(); };
  cv.addEventListener('pointerdown', throwIt);

  const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const diff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const hitAngle = () => norm(Math.PI / 2 - angle); // нижняя точка диска в координатах диска

  const burst = (x: number, y: number, n: number, color: string, speed = 220) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random());
      bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, rot: 0, vr: 0, life: 0.5 + Math.random() * 0.4, size: 2 + Math.random() * 3, color, kind: 'dot' });
    }
  };
  const shatter = () => {
    const r = R(), c = cy();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      bits.push({ x: W / 2 + Math.cos(a) * r * 0.5, y: c + Math.sin(a) * r * 0.5, vx: Math.cos(a) * (160 + Math.random() * 160), vy: Math.sin(a) * 160 - 120, rot: a, vr: (Math.random() - 0.5) * 10, life: 1.1, size: r * 0.42, color: lv.target.paper, kind: 'shard' });
    }
    for (const s of stuck) {
      const a = s.a + angle;
      bits.push({ x: W / 2 + Math.cos(a) * r, y: c + Math.sin(a) * r, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200 - 100, rot: a - Math.PI / 2, vr: (Math.random() - 0.5) * 12, life: 1.1, size: 1, color: '', kind: 'tool', tool: s.tool });
    }
    burst(W / 2, c, 30, '#ffd76a', 320);
  };

  const spinStep = (dt: number) => {
    spinT += dt;
    const base = lv.speed;
    switch (lv.target.spin) {
      case 'const': wTarget = base * dir; break;
      case 'wave': wTarget = base * dir * (0.55 + 0.75 * (0.5 + 0.5 * Math.sin(spinT * 1.6))); break;
      case 'reverse': if (spinT > 1.7 + Math.random() * 0.02) { spinT = 0; dir *= -1; } wTarget = base * 1.15 * dir; break;
      case 'accel': wTarget = base * dir * (0.4 + ((spinT % 3.2) / 3.2) * 1.5); break;
      case 'jerky': if (spinT > 0.5 + Math.random() * 0.03) { spinT = Math.random() * 0.3 - 0.6 * Math.random(); if (Math.random() < 0.5) dir *= -1; wTarget = base * dir * (0.5 + Math.random() * 1.6); } break;
    }
    w += (wTarget - w) * Math.min(1, dt * (lv.target.spin === 'jerky' ? 9 : 3));
    angle += w * dt;
  };

  const stop = loop((dt) => {
    if (W !== wrap.clientWidth || H !== wrap.clientHeight) resize();
    tt += dt;
    if (!over) {
      if (clearing > 0) {
        clearing -= dt;
        if (clearing <= 0) startLevel(lv.n + 1);
      } else spinStep(dt);
      if (flying) {
        flying.y -= dt * 2000;
        if (flying.y <= cy() + R()) {
          const a = hitAngle();
          flying = null;
          if (stuck.some((b) => diff(a, b.a) < 0.2)) { lose(); return; }
          stuck.push({ a, tool: lv.tool, foe: false });
          const ii = items.findIndex((b) => diff(a, b.a) < 0.26);
          if (ii >= 0) {
            const it = items.splice(ii, 1)[0];
            if (it.kind === 'coin') { gotCoins += 20; burst(W / 2, cy() + R() + 10, 12, '#ffc83d'); } else { total += 3; burst(W / 2, cy() + R() + 10, 14, '#b26bff'); }
          }
          total++; left--; flash = 0.1; bump = 1; haptic('tap');
          burst(W / 2, cy() + R(), 6, lv.target.ink, 120);
          if (left <= 0) { clearing = 0.9; haptic('ok'); shatter(); }
        }
      }
    }
    flash = Math.max(0, flash - dt); bump = Math.max(0, bump - dt * 6); banner = Math.max(0, banner - dt);
    sh.setScore(`${total}`);

    // ---------- рисуем ----------
    const r = R(), c = cy() - bump * 7;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, lv.boss ? '#3a1530' : '#1b1d4f'); bg.addColorStop(1, '#0f1030');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // лучи за документом
    g.save(); g.translate(W / 2, c); g.rotate(tt * 0.2);
    g.fillStyle = lv.boss ? '#ff5a5f14' : '#ffffff08';
    for (let i = 0; i < 12; i++) { g.rotate(Math.PI / 6); g.beginPath(); g.moveTo(0, 0); g.lineTo(-r * 0.3, -H); g.lineTo(r * 0.3, -H); g.fill(); }
    g.restore();

    if (clearing <= 0 || clearing > 0.85) {
      g.save(); g.translate(W / 2, c); g.rotate(angle);
      for (const b of stuck) { g.save(); g.rotate(b.a - Math.PI / 2); g.translate(0, r - 7); if (b.foe) g.globalAlpha = 0.9; TOOLS[b.tool].draw(g); if (b.foe) { g.globalAlpha = 0.35; g.fillStyle = '#000'; g.fillRect(-16, -4, 32, 64); } g.restore(); }
      for (const it of items) {
        g.save(); g.rotate(it.a - Math.PI / 2); g.translate(0, r + 16);
        if (it.kind === 'coin') { g.fillStyle = '#ffc83d'; g.beginPath(); g.arc(0, 0, 10, 0, 7); g.fill(); g.fillStyle = '#c89200'; g.font = '800 11px Rubik'; g.textAlign = 'center'; g.fillText('П', 0, 4); }
        else { g.fillStyle = '#b26bff'; star(g, 0, 0, 11, 5); g.fill(); }
        g.restore();
      }
      // документ
      g.shadowColor = '#000a'; g.shadowBlur = 18; g.shadowOffsetY = 6;
      g.fillStyle = lv.target.paper; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      g.shadowColor = 'transparent';
      g.strokeStyle = lv.target.edge; g.lineWidth = 5; g.stroke();
      g.save(); lv.target.deco(g, r); g.restore();
      g.font = `800 ${Math.round(r * (lv.target.title.length > 8 ? 0.16 : 0.2))}px Rubik`; g.textAlign = 'center'; g.fillStyle = lv.target.ink;
      g.fillText(lv.target.title, 0, -r * 0.55);
      g.restore();
      if (flash > 0) { g.fillStyle = `rgba(255,255,255,${flash * 3})`; g.beginPath(); g.arc(W / 2, c, r + 6, 0, 7); g.fill(); }
    }
    // осколки, брызги, падающее
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.life -= dt; if (b.life <= 0) { bits.splice(i, 1); continue; }
      b.vy += 700 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt;
      g.save(); g.globalAlpha = Math.min(1, b.life * 2); g.translate(b.x, b.y); g.rotate(b.rot);
      if (b.kind === 'dot') { g.fillStyle = b.color; g.fillRect(-b.size / 2, -b.size / 2, b.size, b.size); }
      else if (b.kind === 'shard') { g.fillStyle = b.color; g.beginPath(); g.moveTo(0, -b.size * 0.5); g.lineTo(b.size * 0.45, b.size * 0.35); g.lineTo(-b.size * 0.4, b.size * 0.3); g.fill(); g.strokeStyle = lv.target.edge; g.lineWidth = 2; g.stroke(); }
      else TOOLS[b.tool ?? 0].draw(g);
      g.restore();
    }
    // запас инструментов: точки слева
    const tool = TOOLS[lv.tool];
    for (let i = 0; i < lv.need; i++) {
      const used = i >= left - (flying ? 1 : 0) ? 0 : 1;
      g.fillStyle = used ? '#ffd76a' : '#ffffff22';
      g.beginPath(); g.arc(22, H - 34 - i * 18, 6, 0, 7); g.fill();
    }
    if (!over && clearing <= 0) { g.save(); g.translate(W / 2, flying ? flying.y : restY()); tool.draw(g); g.restore(); }
    // надписи
    g.textAlign = 'center';
    if (banner > 0) {
      g.globalAlpha = Math.min(1, banner * 2);
      g.font = `800 ${lv.boss ? 26 : 20}px Rubik`; g.fillStyle = lv.boss ? '#ff8a8a' : '#ffd76a';
      g.fillText(lv.boss ? `БОСС: ${lv.target.name}` : lv.target.name, W / 2, cy() + r + 70);
      g.font = '600 14px Rubik'; g.fillStyle = '#cfd4ff';
      g.fillText(`${tool.name} × ${lv.need}`, W / 2, cy() + r + 92);
      g.globalAlpha = 1;
    }
    if (clearing > 0) { g.font = '800 24px Rubik'; g.fillStyle = '#6dffb0'; g.fillText(lv.boss ? 'Босс сдался!' : 'Документ оформлен!', W / 2, cy() + 8); }
    g.font = '600 12px Rubik'; g.fillStyle = '#9aa3c7'; g.textAlign = 'right';
    g.fillText(`лучший сегодня: ${Math.max(best, total)}`, W - 12, H - 14);
    g.textAlign = 'start';
    if (over && !bits.length) return false;
  });

  const lose = async () => {
    over = true;
    haptic('bad');
    // инструмент отскакивает и падает
    bits.push({ x: W / 2, y: cy() + R() + 10, vx: (Math.random() - 0.5) * 160, vy: 120, rot: 0, vr: (Math.random() < 0.5 ? -1 : 1) * 9, life: 1.2, size: 1, color: '', kind: 'tool', tool: lv.tool });
    const level = lv.n;
    const value = Math.min(30, (level - 1) * 5 + Math.floor(total / 4));
    const got = await reportResult(app, 'stamp', total, value, ctx);
    setTimeout(() => showResult(app, sh, {
      title: level > 5 ? 'Годовой отчёт сдан!' : 'Попал в чужую печать', good: level > 3, score: total, scoreLabel: 'отметок поставлено',
      lines: [`Пройдено уровней: ${level - 1}`, `Документ: ${lv.target.name}`], coins: gotCoins, got, value, ctx, again: () => { app.closeOverlay(); openStamp(app, ctx); },
    }), 700);
  };
  sh.onExit(() => stop());
}

function star(g: G, x: number, y: number, r: number, n: number) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, rr2 = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
  }
  g.closePath();
}
