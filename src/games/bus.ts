// «Автобус на выезд» — как Bus Fever: рассаживай активистов по автобусам своего цвета.
// Тап по автобусу — в него садятся все стоящие первыми пассажиры его цвета. Не тот цвет — в зал ожидания (5 мест).
// Тупиков нет: у трёх автобусов всегда разные цвета, новый приезжает того цвета, кого больше всего ждут,
// а если ходов не осталось — диспетчер отправляет автобус неполным и присылает нужный.
// Полный автобус в первую минуту добавляет секунду — партия идёт около полутора минут.
import { PLAYABLE_FACTIONS } from '../config/factions';
import { haptic } from '../core/telegram';
import { $, el, toast } from '../lib/dom';
import type { App } from '../ui/app';
import { loop, reportResult, shell, showResult, type PlayCtx } from './kit';

const TIME = 60, SEATS = 4, WAIT = 5;

export function openBus(app: App, ctx?: PlayCtx) {
  const colors = [...PLAYABLE_FACTIONS].sort(() => Math.random() - 0.5).slice(0, 5).map((f) => ({ id: f.id, c: f.color, name: f.short }));
  const sh = shell(app, 'bus', ctx);
  sh.setSub('Тап по автобусу — сажай первых в очереди. Не тот цвет — в зал ожидания');
  // сколько цветов в игре: 3 на старте, 4 после 16 рассаженных, 5 — после 48
  let inPlay = 3;
  const pick = () => colors[Math.floor(Math.random() * inPlay)].id;
  // очередь — «пачками» по 1–3 одного цвета: так получаются цепочки, а не каша
  const queue: string[] = [];
  const refill = () => {
    while (queue.length < 18) {
      let c = pick();
      if (c === queue[queue.length - 1] && Math.random() < 0.5) c = pick();
      const run = 1 + (Math.random() < 0.55 ? 1 : 0) + (Math.random() < 0.25 ? 1 : 0);
      for (let k = 0; k < run && queue.length < 18; k++) queue.push(c);
    }
  };
  refill();
  const waiting: string[] = [];
  const bays: { color: string; seats: number; leaving: number; arrive?: boolean; hop?: boolean; early?: boolean }[] = [];
  /** Цвет нового автобуса: первый в очереди → кого больше в зале ожидания → кого больше в начале очереди; всегда не как у соседей. */
  const need = (): string => {
    const busy = new Set(bays.filter((b) => !b.leaving).map((b) => b.color));
    if (queue[0] && !busy.has(queue[0])) return queue[0];
    const score = new Map<string, number>();
    waiting.forEach((c) => { if (!busy.has(c)) score.set(c, (score.get(c) ?? 0) + 3); });
    queue.slice(0, 8).forEach((c, i) => { if (!busy.has(c)) score.set(c, (score.get(c) ?? 0) + (8 - i) / 8); });
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
    const free = colors.slice(0, inPlay).map((c) => c.id).filter((c) => !busy.has(c));
    return free.length ? free[Math.floor(Math.random() * free.length)] : pick();
  };
  for (let i = 0; i < 3; i++) bays.push({ color: need(), seats: 0, leaving: 0, arrive: true });
  let seated = 0, combo = 0, left = TIME, over = false, played = 0, flash = '', flashT = 0;
  const col = (id: string) => colors.find((c) => c.id === id)!;

  const node = el(`<div class="bus-game">
    <div class="row small" style="justify-content:space-between"><b>Очередь</b><span class="gold" data-combo></span><span class="gold" data-time></span></div>
    <div class="al-bar"><i data-tbar style="width:100%"></i></div>
    <div class="bus-queue" data-q></div>
    <div class="row small" style="justify-content:space-between"><b>Зал ожидания</b><span class="muted" data-wn></span></div>
    <div class="bus-wait" data-w></div>
    <div class="bus-road"><div class="bus-bays" data-b></div></div>
    <button class="btn btn-blue btn-block" data-act-wait>Первого — в зал ожидания</button>
  </div>`);
  sh.body.appendChild(node);
  const person = (id: string, big = false) => `<div class="bus-p ${big ? 'big' : ''}" style="background:${col(id).c}"><span></span></div>`;

  const draw = () => {
    $(node, '[data-q]').innerHTML = queue.slice(0, 10).map((p, i) => person(p, i === 0)).join('');
    $(node, '[data-w]').innerHTML = Array.from({ length: WAIT }, (_, i) => waiting[i] ? person(waiting[i]) : '<div class="bus-p empty"></div>').join('');
    $(node, '[data-wn]').textContent = `${waiting.length}/${WAIT}`;
    $(node, '[data-combo]').textContent = flash || (combo >= 2 ? `комбо ×${combo}` : '');
    $(node, '[data-b]').innerHTML = bays.map((b, i) => `<button class="bus-bay ${b.leaving ? 'leaving' : ''} ${b.arrive ? 'arrive' : ''} ${b.hop ? 'hop' : ''}" data-bay="${i}" style="--bc:${col(b.color).c}">
      <svg viewBox="0 0 120 70" width="100%"><rect x="4" y="8" width="112" height="46" rx="10" fill="${col(b.color).c}"/><rect x="12" y="16" width="96" height="16" rx="4" fill="#cfe6ff"/>
      ${Array.from({ length: SEATS }, (_, k) => `<circle cx="${24 + k * 24}" cy="24" r="6" fill="${k < b.seats ? '#15173d' : '#ffffff55'}"/>`).join('')}
      <rect x="100" y="36" width="10" height="8" rx="2" fill="#ffd76a"/><text x="60" y="48" text-anchor="middle" font-size="10" font-weight="800" fill="#fff" font-family="Rubik">ШПА</text>
      <circle cx="30" cy="58" r="8" fill="#15173d"/><circle cx="30" cy="58" r="3" fill="#9aa3c7"/><circle cx="90" cy="58" r="8" fill="#15173d"/><circle cx="90" cy="58" r="3" fill="#9aa3c7"/></svg>
      <div class="small"><b>${col(b.color).name}</b> · ${b.seats}/${SEATS}</div></button>`).join('');
    bays.forEach((b) => { b.arrive = false; b.hop = false; });
  };

  const board = (i: number) => {
    const b = bays[i];
    if (over || b.leaving) return;
    let n = 0;
    // сначала из зала ожидания
    for (let k = 0; k < waiting.length && b.seats < SEATS; k++) if (waiting[k] === b.color) { waiting.splice(k, 1); k--; b.seats++; n++; }
    while (queue.length && queue[0] === b.color && b.seats < SEATS) { queue.shift(); b.seats++; n++; }
    if (!n) { haptic('bad'); combo = 0; left = Math.max(0, left - 1); toast('Первый в очереди не из этого ПБ: −1 с', 'bad'); draw(); return; }
    seated += n; combo++; b.hop = true;
    haptic('ok');
    if (b.seats >= SEATS) {
      b.leaving = 0.6;
      if (combo >= 3) seated += 2;
      // полный автобус в первую минуту — +1 с: партия около полутора минут, а не бесконечная
      if (played < 60) { left += 1; flash = '+1 с'; flashT = 0.8; }
    }
    if (seated >= 16 && inPlay < 4) inPlay = 4;
    if (seated >= 48 && inPlay < 5) inPlay = Math.min(5, colors.length);
    refill(); rescue(); draw();
  };
  /** Ходов нет (никто не садится, зал ожидания полон, ни один автобус не уезжает) — диспетчер отправляет неполный автобус. */
  const rescue = () => {
    if (over || bays.some((b) => b.leaving)) return;
    const canBoard = bays.some((b) => b.color === queue[0] || waiting.includes(b.color));
    if (canBoard || waiting.length < WAIT) return;
    const b = [...bays].sort((x, y) => y.seats - x.seats)[0];
    b.leaving = 0.6; b.early = true; combo = 0;
    toast('Ходов не было — диспетчер отправил автобус неполным и пришлёт нужный', 'info');
  };

  node.addEventListener('click', (e) => {
    const bay = (e.target as HTMLElement).closest<HTMLElement>('[data-bay]');
    if (bay) board(Number(bay.dataset.bay));
    if ((e.target as HTMLElement).closest('[data-act-wait]')) {
      if (over) return;
      if (waiting.length >= WAIT) { haptic('bad'); toast('Зал ожидания полон', 'bad'); return; }
      waiting.push(queue.shift()!); refill(); combo = 0; haptic(); rescue(); draw();
    }
  });

  const stop = loop((dt) => {
    if (over) return false;
    left -= dt; played += dt;
    if (flashT > 0) { flashT -= dt; if (flashT <= 0) { flash = ''; $(node, '[data-combo]').textContent = combo >= 2 ? `комбо ×${combo}` : ''; } }
    $(node, '[data-time]').textContent = `${Math.ceil(Math.max(0, left))} с`;
    sh.setScore(String(seated));
    let changed = false;
    for (const b of bays) if (b.leaving) { b.leaving -= dt; if (b.leaving <= 0) { b.color = need(); b.leaving = 0; b.seats = 0; b.arrive = true; b.early = false; changed = true; } }
    if (changed) rescue();
    ($(node, '[data-tbar]') as HTMLElement).style.width = `${Math.min(100, (Math.max(0, left) / TIME) * 100)}%`;
    if (changed) draw();
    if (left <= 0) { finish(); return false; }
  });
  const finish = async () => {
    over = true;
    const value = Math.min(30, Math.floor(seated / 6));
    const got = await reportResult(app, 'bus', seated, value, ctx);
    showResult(app, sh, { title: seated >= 150 ? 'Все уехали на выезд!' : 'Автобусы ушли', good: seated >= 80, score: seated, scoreLabel: 'активистов рассажено', got, value, coins: seated, ctx, again: () => { app.closeOverlay(); openBus(app, ctx); } });
  };
  sh.onExit(() => stop());
  draw();
}
