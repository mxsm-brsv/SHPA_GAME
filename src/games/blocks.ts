// «Расписание» — как Block Blast: ставь фигуры-пары на сетку 8×8, заполненные строки и столбцы исчезают.
import { haptic } from '../core/telegram';
import { el, fmt } from '../lib/dom';
import type { App } from '../ui/app';
import { reportResult, shell, showResult, type PlayCtx } from './kit';

const N = 8;
const SHAPES: number[][][] = [
  [[1]], [[1, 1]], [[1], [1]], [[1, 1, 1]], [[1], [1], [1]], [[1, 1], [1, 1]], [[1, 1, 1, 1]], [[1], [1], [1], [1]],
  [[1, 0], [1, 1]], [[0, 1], [1, 1]], [[1, 1], [1, 0]], [[1, 1], [0, 1]], [[1, 1, 1], [0, 1, 0]], [[1, 0], [1, 0], [1, 1]],
  [[1, 1, 1], [1, 1, 1], [1, 1, 1]], [[1, 1, 1], [1, 0, 0], [1, 0, 0]],
];
const COLORS = ['#ff8a5b', '#4fd1a5', '#7ea8ff', '#ffc83d', '#b26bff', '#ff5fa2', '#45d483'];
const LABELS = ['Матан', 'Физра', 'Профком', 'Лаба', 'ТОЭ', 'Англ', 'Сопромат'];

interface Piece { cells: number[][]; color: string; label: string; used: boolean }

export function openBlocks(app: App, ctx?: PlayCtx) {
  const sh = shell(app, 'blocks', ctx);
  sh.setSub('Перетаскивай пары в расписание. Полная строка или столбец — день без окон');
  const grid: (string | null)[][] = Array.from({ length: N }, () => Array(N).fill(null));
  let pieces: Piece[] = [];
  let score = 0, lines = 0, combo = 0, over = false;
  const node = el(`<div class="bl-game"><div class="bl-grid" data-g></div><div class="bl-tray" data-t></div></div>`);
  sh.body.appendChild(node);
  const gEl = node.querySelector<HTMLElement>('[data-g]')!;
  const tEl = node.querySelector<HTMLElement>('[data-t]')!;

  const deal = () => {
    pieces = Array.from({ length: 3 }, () => {
      const i = Math.floor(Math.random() * SHAPES.length);
      const k = Math.floor(Math.random() * COLORS.length);
      return { cells: SHAPES[i], color: COLORS[k], label: LABELS[k], used: false };
    });
  };
  const fits = (p: Piece, r: number, c: number) => p.cells.every((row, i) => row.every((v, j) => !v || (r + i < N && c + j < N && r + i >= 0 && c + j >= 0 && !grid[r + i][c + j])));
  const anyFit = () => pieces.some((p) => !p.used && grid.some((_, r) => grid[r].some((__, c) => fits(p, r, c))));

  const drawGrid = (ghost?: { p: Piece; r: number; c: number; ok: boolean }) => {
    gEl.innerHTML = grid.map((row, r) => row.map((v, c) => {
      const g = ghost && ghost.p.cells[r - ghost.r]?.[c - ghost.c];
      return `<div class="bl-c" style="${v ? `background:${v}` : g ? `background:${ghost!.ok ? ghost!.p.color + '99' : '#ff5a5f66'}` : ''}"></div>`;
    }).join('')).join('');
  };
  const drawTray = () => {
    tEl.innerHTML = pieces.map((p, i) => `<div class="bl-piece ${p.used ? 'used' : ''}" data-i="${i}" style="grid-template-columns:repeat(${p.cells[0].length},1fr)">${p.cells.map((row) => row.map((v) => `<div class="bl-pc" style="${v ? `background:${p.color}` : 'visibility:hidden'}"></div>`).join('')).join('')}</div>`).join('');
  };

  const place = (p: Piece, r: number, c: number) => {
    p.cells.forEach((row, i) => row.forEach((v, j) => { if (v) grid[r + i][c + j] = p.color; }));
    p.used = true;
    score += p.cells.flat().filter(Boolean).length;
    const fullR = grid.map((row, i) => (row.every(Boolean) ? i : -1)).filter((i) => i >= 0);
    const fullC = Array.from({ length: N }, (_, j) => (grid.every((row) => row[j]) ? j : -1)).filter((j) => j >= 0);
    const cleared = fullR.length + fullC.length;
    fullR.forEach((i) => grid[i].fill(null));
    fullC.forEach((j) => grid.forEach((row) => (row[j] = null)));
    if (cleared) { combo++; lines += cleared; score += cleared * 10 * combo; haptic('ok'); } else combo = 0;
    if (pieces.every((x) => x.used)) deal();
    sh.setScore(fmt(score));
    drawGrid(); drawTray();
    if (!anyFit()) finish();
  };

  // перетаскивание
  let drag: { i: number; ghostEl: HTMLElement; offR: number; offC: number } | null = null;
  const cellAt = (x: number, y: number) => {
    const r = gEl.getBoundingClientRect();
    const cs = r.width / N;
    return { r: Math.floor((y - r.top) / cs), c: Math.floor((x - r.left) / cs), cs };
  };
  tEl.addEventListener('pointerdown', (e) => {
    const pe = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (!pe || over) return;
    const i = Number(pe.dataset.i);
    const p = pieces[i];
    if (p.used) return;
    const cs = gEl.getBoundingClientRect().width / N;
    const ghostEl = el(`<div class="bl-drag" style="grid-template-columns:repeat(${p.cells[0].length},${cs}px)">${p.cells.map((row) => row.map((v) => `<div style="width:${cs}px;height:${cs}px;${v ? `background:${p.color};border-radius:6px` : ''}"></div>`).join('')).join('')}</div>`);
    document.body.appendChild(ghostEl);
    drag = { i, ghostEl, offR: p.cells.length / 2, offC: p.cells[0].length / 2 };
    pe.classList.add('used');
    move(e.clientX, e.clientY);
    haptic();
  });
  const move = (x: number, y: number) => {
    if (!drag) return;
    const p = pieces[drag.i];
    const cs = gEl.getBoundingClientRect().width / N;
    // фигуру поднимаем над пальцем, чтобы её было видно
    const gx = x - drag.offC * cs, gy = y - drag.offR * cs - 70;
    drag.ghostEl.style.transform = `translate(${gx}px, ${gy}px)`;
    const at = cellAt(gx + cs / 2, gy + cs / 2);
    drawGrid({ p, r: at.r, c: at.c, ok: fits(p, at.r, at.c) });
  };
  const mv = (e: PointerEvent) => move(e.clientX, e.clientY);
  window.addEventListener('pointermove', mv);
  const up = (e: PointerEvent) => {
    if (!drag) return;
    const p = pieces[drag.i];
    const cs = gEl.getBoundingClientRect().width / N;
    const gx = e.clientX - drag.offC * cs, gy = e.clientY - drag.offR * cs - 70;
    const at = cellAt(gx + cs / 2, gy + cs / 2);
    drag.ghostEl.remove();
    drag = null;
    if (fits(p, at.r, at.c)) place(p, at.r, at.c); else { drawGrid(); drawTray(); }
  };
  window.addEventListener('pointerup', up);
  const cleanup = () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointermove', mv); drag?.ghostEl.remove(); };
  sh.onExit(cleanup);

  const finish = async () => {
    over = true;
    cleanup();
    haptic('heavy');
    const value = Math.min(30, Math.floor(score / 60));
    const got = await reportResult(app, 'blocks', score, value, ctx);
    setTimeout(() => showResult(app, sh, { title: 'Места больше нет', good: score > 600, score, lines: [`Дней без окон: ${lines}`], coins: Math.round(score / 10), got, value, ctx, again: () => { app.closeOverlay(); openBlocks(app, ctx); } }), 400);
  };
  deal(); drawGrid(); drawTray(); sh.setScore('0');
}
