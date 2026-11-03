// «Слияние» — как Merge Cooking: принтер выдаёт скрепки, две одинаковые вещи сливаются в следующую:
// скрепка → степлер → папка → протокол → печать → грамота → путёвка. Заказы сверху дают очки и профкоины.
import { haptic } from '../core/telegram';
import { el, esc, fmt, toast } from '../lib/dom';
import type { App } from '../ui/app';
import { reportResult, shell, showResult, type PlayCtx } from './kit';

const TIERS = [
  { name: 'Скрепка', icon: '📎', color: '#9aa3c7' },
  { name: 'Степлер', icon: '🔩', color: '#7ea8ff' },
  { name: 'Папка', icon: '📁', color: '#ffc83d' },
  { name: 'Протокол', icon: '📄', color: '#4fd1a5' },
  { name: 'Печать', icon: '🔖', color: '#ff8a5b' },
  { name: 'Грамота', icon: '📜', color: '#b26bff' },
  { name: 'Путёвка', icon: '🎫', color: '#ff5fa2' },
];
const COLS = 5, ROWS = 6, ENERGY = 70;

export function openMerge(app: App, ctx?: PlayCtx) {
  const sh = shell(app, 'merge', ctx);
  sh.setSub('Перетащи одинаковые вещи друг на друга. Готовую вещь — на заказ');
  const board: (number | null)[] = Array(COLS * ROWS).fill(null);
  let energy = ENERGY, score = 0, coins = 0, over = false;
  const orders: { tier: number; reward: number }[] = [];
  const newOrder = () => { const tier = 2 + Math.floor(Math.random() * Math.min(4, 1 + Math.floor(score / 300))); orders.push({ tier, reward: 15 * 2 ** tier }); };
  newOrder(); newOrder();

  const node = el(`<div class="mr-game">
    <div class="mr-orders" data-o></div>
    <div class="mr-board" data-b></div>
    <div class="row" style="gap:10px"><button class="btn btn-gold grow btn-col" data-gen>Принтер<span class="sub" data-en></span></button>
      <div class="card small" style="padding:8px 10px" data-chain></div></div>
  </div>`);
  sh.body.appendChild(node);
  const bEl = node.querySelector<HTMLElement>('[data-b]')!;
  const oEl = node.querySelector<HTMLElement>('[data-o]')!;

  const item = (t: number) => `<div class="mr-item" style="background:${TIERS[t].color}"><span>${TIERS[t].icon}</span><small>${esc(TIERS[t].name)}</small></div>`;
  const draw = () => {
    bEl.innerHTML = board.map((t, i) => `<div class="mr-cell" data-c="${i}">${t === null ? '' : item(t)}</div>`).join('');
    oEl.innerHTML = orders.map((o, i) => `<div class="mr-order" data-o="${i}">${item(o.tier)}<div class="small"><b>Заказ</b><br>+${o.reward}</div></div>`).join('');
    node.querySelector<HTMLElement>('[data-en]')!.textContent = `ещё ${energy} · выдать скрепку`;
    node.querySelector<HTMLElement>('[data-chain]')!.innerHTML = TIERS.map((t) => t.icon).join(' → ');
    sh.setScore(fmt(score));
  };

  const gen = () => {
    if (over) return;
    if (energy <= 0) { toast('Бумага в принтере закончилась', 'bad'); return; }
    const free = board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
    if (!free.length) { toast('Нет места — слей что-нибудь', 'bad'); return; }
    board[free[Math.floor(Math.random() * free.length)]] = Math.random() < 0.12 ? 1 : 0;
    energy--;
    haptic();
    draw();
    checkEnd();
  };
  node.querySelector('[data-gen]')!.addEventListener('click', gen);

  const canMerge = () => board.some((v, i) => v !== null && v < TIERS.length - 1 && board.some((w, j) => j !== i && w === v));
  const canOrder = () => orders.some((o) => board.includes(o.tier));
  const checkEnd = () => {
    const full = board.every((v) => v !== null);
    if ((energy <= 0 || full) && !canMerge() && !canOrder()) finish();
  };

  // перетаскивание
  let drag: { from: number; ghost: HTMLElement } | null = null;
  bEl.addEventListener('pointerdown', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
    if (!c || over) return;
    const i = Number(c.dataset.c);
    if (board[i] === null) return;
    const ghost = el(`<div class="mr-ghost">${item(board[i]!)}</div>`);
    document.body.appendChild(ghost);
    drag = { from: i, ghost };
    mv(e);
  });
  const mv = (e: PointerEvent) => { if (drag) drag.ghost.style.transform = `translate(${e.clientX - 32}px, ${e.clientY - 60}px)`; };
  const up = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.ghost.remove();
    const target = document.elementFromPoint(e.clientX, e.clientY - 28) as HTMLElement | null;
    const cell = target?.closest<HTMLElement>('[data-c]');
    const ord = target?.closest<HTMLElement>('[data-o]');
    const t = board[d.from]!;
    if (ord) {
      const oi = Number(ord.dataset.o);
      const o = orders[oi];
      if (o && o.tier === t) {
        board[d.from] = null; score += o.reward; coins += Math.round(o.reward / 5);
        orders.splice(oi, 1); newOrder(); haptic('ok');
        toast(`Заказ выполнен: +${o.reward}`, 'ok');
      } else { haptic('bad'); toast('Заказу нужна другая вещь', 'bad'); }
    } else if (cell) {
      const j = Number(cell.dataset.c);
      if (j !== d.from) {
        if (board[j] === null) { board[j] = t; board[d.from] = null; }
        else if (board[j] === t && t < TIERS.length - 1) { board[j] = t + 1; board[d.from] = null; score += 5 * 2 ** (t + 1); haptic('ok'); }
        else { const tmp = board[j]; board[j] = t; board[d.from] = tmp; }
      }
    }
    draw();
    checkEnd();
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  const cleanup = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); drag?.ghost.remove(); };
  sh.onExit(cleanup);

  const finish = async () => {
    if (over) return;
    over = true;
    cleanup();
    const best = Math.max(-1, ...board.map((v) => v ?? -1));
    const value = Math.min(30, Math.floor(score / 40));
    const got = await reportResult(app, 'merge', score, value, ctx);
    showResult(app, sh, { title: best >= 6 ? 'Путёвка на выезд собрана!' : 'Ходы закончились', good: score > 500, score, lines: [`Лучшая вещь: ${best >= 0 ? TIERS[best].name : '—'}`], coins, got, value, ctx, again: () => { app.closeOverlay(); openMerge(app, ctx); } });
  };
  draw();
  const endBtn = el('<button class="btn btn-ghost btn-sm btn-block" style="margin-top:8px">Завершить и посчитать очки</button>');
  endBtn.addEventListener('click', () => finish());
  node.appendChild(endBtn);
}
