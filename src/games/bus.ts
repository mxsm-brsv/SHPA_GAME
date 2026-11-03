// «Автобус на выезд» — как Bus Fever: рассаживай активистов по автобусам своего цвета.
// Тап по автобусу — в него садятся все стоящие первыми пассажиры его цвета. Не тот цвет — в зал ожидания (5 мест).
import { PLAYABLE_FACTIONS } from '../config/factions';
import { haptic } from '../core/telegram';
import { $, el, toast } from '../lib/dom';
import type { App } from '../ui/app';
import { loop, reportResult, shell, showResult, type PlayCtx } from './kit';

const TIME = 75, SEATS = 4, WAIT = 5;

export function openBus(app: App, ctx?: PlayCtx) {
  const colors = [...PLAYABLE_FACTIONS].sort(() => Math.random() - 0.5).slice(0, 4).map((f) => ({ id: f.id, c: f.color, name: f.short }));
  const sh = shell(app, 'bus', ctx);
  sh.setSub('Тап по автобусу — сажай первых в очереди. Не тот цвет — в зал ожидания');
  const rnd = () => colors[Math.floor(Math.random() * colors.length)].id;
  const queue: string[] = Array.from({ length: 18 }, rnd);
  const waiting: string[] = [];
  const bays: { color: string; seats: number; leaving: number }[] = [0, 1, 2].map(() => ({ color: rnd(), seats: 0, leaving: 0 }));
  let seated = 0, combo = 0, left = TIME, over = false;
  const col = (id: string) => colors.find((c) => c.id === id)!;

  const node = el(`<div class="bus-game">
    <div class="row small" style="justify-content:space-between"><b>Очередь</b><span class="gold" data-time></span></div>
    <div class="bus-queue" data-q></div>
    <div class="row small" style="justify-content:space-between"><b>Зал ожидания</b><span class="muted" data-wn></span></div>
    <div class="bus-wait" data-w></div>
    <div class="bus-bays" data-b></div>
    <button class="btn btn-blue btn-block" data-act-wait>Первого — в зал ожидания</button>
  </div>`);
  sh.body.appendChild(node);
  const person = (id: string, big = false) => `<div class="bus-p ${big ? 'big' : ''}" style="background:${col(id).c}"><span></span></div>`;

  const draw = () => {
    $(node, '[data-q]').innerHTML = queue.slice(0, 10).map((p, i) => person(p, i === 0)).join('');
    $(node, '[data-w]').innerHTML = Array.from({ length: WAIT }, (_, i) => waiting[i] ? person(waiting[i]) : '<div class="bus-p empty"></div>').join('');
    $(node, '[data-wn]').textContent = `${waiting.length}/${WAIT}`;
    $(node, '[data-b]').innerHTML = bays.map((b, i) => `<button class="bus-bay ${b.leaving ? 'leaving' : ''}" data-bay="${i}" style="--bc:${col(b.color).c}">
      <svg viewBox="0 0 120 70" width="100%"><rect x="4" y="8" width="112" height="46" rx="10" fill="${col(b.color).c}"/><rect x="12" y="16" width="96" height="16" rx="4" fill="#cfe6ff"/>
      ${Array.from({ length: SEATS }, (_, k) => `<circle cx="${24 + k * 24}" cy="24" r="6" fill="${k < b.seats ? '#15173d' : '#ffffff55'}"/>`).join('')}
      <circle cx="30" cy="58" r="8" fill="#15173d"/><circle cx="90" cy="58" r="8" fill="#15173d"/></svg>
      <div class="small"><b>${col(b.color).name}</b> · ${b.seats}/${SEATS}</div></button>`).join('');
  };

  const board = (i: number) => {
    const b = bays[i];
    if (over || b.leaving) return;
    let n = 0;
    // сначала из зала ожидания
    for (let k = 0; k < waiting.length && b.seats < SEATS; k++) if (waiting[k] === b.color) { waiting.splice(k, 1); k--; b.seats++; n++; }
    while (queue.length && queue[0] === b.color && b.seats < SEATS) { queue.shift(); b.seats++; n++; }
    if (!n) { haptic('bad'); combo = 0; left = Math.max(0, left - 2); toast('Первый в очереди не из этого ПБ: −2 с', 'bad'); draw(); return; }
    seated += n; combo++;
    haptic('ok');
    if (b.seats >= SEATS) { b.leaving = 0.7; seated += combo >= 3 ? 2 : 0; }
    refill(); draw();
  };
  const refill = () => { while (queue.length < 18) queue.push(rnd()); };

  node.addEventListener('click', (e) => {
    const bay = (e.target as HTMLElement).closest<HTMLElement>('[data-bay]');
    if (bay) board(Number(bay.dataset.bay));
    if ((e.target as HTMLElement).closest('[data-act-wait]')) {
      if (over) return;
      if (waiting.length >= WAIT) { haptic('bad'); toast('Зал ожидания полон', 'bad'); return; }
      waiting.push(queue.shift()!); refill(); combo = 0; haptic(); draw();
    }
  });

  const stop = loop((dt) => {
    if (over) return false;
    left -= dt;
    $(node, '[data-time]').textContent = `${Math.ceil(Math.max(0, left))} с`;
    sh.setScore(String(seated));
    let changed = false;
    for (const b of bays) if (b.leaving) { b.leaving -= dt; if (b.leaving <= 0) { b.leaving = 0; b.seats = 0; b.color = queue[Math.floor(Math.random() * 3)] ?? rnd(); changed = true; } }
    if (changed) draw();
    if (left <= 0) { finish(); return false; }
  });
  const finish = async () => {
    over = true;
    const value = Math.min(30, Math.floor(seated / 3));
    const got = await reportResult(app, 'bus', seated, value, ctx);
    showResult(app, sh, { title: seated >= 60 ? 'Все уехали на выезд!' : 'Автобусы ушли', good: seated >= 30, score: seated, scoreLabel: 'активистов рассажено', got, value, coins: seated * 3, ctx, again: () => { app.closeOverlay(); openBus(app, ctx); } });
  };
  sh.onExit(() => stop());
  draw();
}
