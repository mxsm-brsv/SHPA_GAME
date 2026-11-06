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
  let score = 0, lines = 0, combo = 0, over = false, busy = false;
  const best = app.state.daily.best.blocks ?? 0;
  const node = el(`<div class="bl-game">
    <div class="bl-info"><span>Лучший сегодня <b>${fmt(best)}</b></span><span data-combo></span></div>
    <div class="bl-board"><div class="bl-grid" data-g></div><div class="bl-fx" data-fx></div></div>
    <div class="bl-tray" data-t></div></div>`);
  sh.body.appendChild(node);
  const gEl = node.querySelector<HTMLElement>('[data-g]')!;
  const tEl = node.querySelector<HTMLElement>('[data-t]')!;
  const fxEl = node.querySelector<HTMLElement>('[data-fx]')!;
  const comboEl = node.querySelector<HTMLElement>('[data-combo]')!;

  const fits = (p: Pick<Piece, 'cells'>, r: number, c: number) => p.cells.every((row, i) => row.every((v, j) => !v || (r + i < N && c + j < N && r + i >= 0 && c + j >= 0 && !grid[r + i][c + j])));
  const fitsSomewhere = (p: Pick<Piece, 'cells'>) => grid.some((_, r) => grid[r].some((__, c) => fits(p, r, c)));
  const anyFit = () => pieces.some((p) => !p.used && fitsSomewhere(p));
  /** Новая тройка: из нескольких случайных берём ту, где помещаются все фигуры (или хотя бы больше всего) —
   *  чтобы игра не обрывалась тройкой, в которой ничего не встаёт, хотя место на поле ещё есть. */
  const deal = () => {
    const filled = grid.flat().filter(Boolean).length / (N * N);
    const roll = () => Array.from({ length: 3 }, () => {
      // на тесном поле крупные фигуры (3×3, «уголок» 3×3) выпадают реже
      let i = Math.floor(Math.random() * SHAPES.length);
      if (filled > 0.45 && SHAPES[i].flat().filter(Boolean).length >= 5 && Math.random() < 0.7) i = Math.floor(Math.random() * 8);
      const k = Math.floor(Math.random() * COLORS.length);
      return { cells: SHAPES[i], color: COLORS[k], label: LABELS[k], used: false };
    });
    let best = roll(), bestFit = best.filter(fitsSomewhere).length;
    for (let t = 0; t < 40 && bestFit < 3; t++) {
      const cand = roll();
      const f = cand.filter(fitsSomewhere).length;
      if (f > bestFit) { best = cand; bestFit = f; }
    }
    pieces = best;
  };

  /** Какие строки и столбцы заполнятся, если поставить фигуру сюда. */
  const fullAfter = (p: Piece | null, r: number, c: number) => {
    const has = (i: number, j: number) => !!grid[i][j] || !!(p && p.cells[i - r]?.[j - c]);
    const rows: number[] = [], cols: number[] = [];
    for (let i = 0; i < N; i++) if (Array.from({ length: N }, (_, j) => has(i, j)).every(Boolean)) rows.push(i);
    for (let j = 0; j < N; j++) if (Array.from({ length: N }, (_, i) => has(i, j)).every(Boolean)) cols.push(j);
    return { rows, cols };
  };

  const drawGrid = (ghost?: { p: Piece; r: number; c: number; ok: boolean }) => {
    const hint = ghost?.ok ? fullAfter(ghost.p, ghost.r, ghost.c) : { rows: [], cols: [] };
    gEl.innerHTML = grid.map((row, r) => row.map((v, c) => {
      const g = ghost && ghost.p.cells[r - ghost.r]?.[c - ghost.c];
      const lit = hint.rows.includes(r) || hint.cols.includes(c);
      const color = v ?? (g ? ghost!.p.color : '');
      const cls = v ? 'on' : g ? (ghost!.ok ? 'ghost' : 'bad') : '';
      return `<div class="bl-c ${cls} ${lit ? 'lit' : ''}" style="${color ? `--c:${color}` : ''}"></div>`;
    }).join('')).join('');
  };
  const drawTray = () => {
    tEl.innerHTML = pieces.map((p, i) => {
      const can = !p.used && grid.some((_, r) => grid[r].some((__, c) => fits(p, r, c)));
      return `<div class="bl-piece ${p.used ? 'used' : ''} ${can || p.used ? '' : 'stuck'}" data-i="${i}" style="grid-template-columns:repeat(${p.cells[0].length},1fr)">${p.cells.map((row) => row.map((v) => `<div class="bl-pc" style="${v ? `--c:${p.color}` : 'visibility:hidden'}"></div>`).join('')).join('')}</div>`;
    }).join('');
  };
  const PRAISE = ['Без окон!', 'Чистый день!', 'Супер-расписание!', 'Идеальная неделя!', 'Деканат доволен!'];

  // ---------- эффекты как в Block Blast: кубики разлетаются осколками, счёт — крупно на весь экран ----------
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Кубик лопается: несколько осколков его цвета разлетаются и падают. */
  const shards = (k: number, color: string, delay: number, budget: { n: number }) => {
    const i = Math.floor(k / N), j = k % N;
    const w = fxEl.clientWidth || 300;
    const cnt = calm ? 0 : Math.min(3, budget.n);
    budget.n -= cnt;
    for (let q = 0; q < cnt; q++) {
      const sh2 = el(`<i class="bl-shard" style="left:${((j + 0.5) / N) * 100}%;top:${((i + 0.5) / N) * 100}%;--c:${color}"></i>`);
      fxEl.appendChild(sh2);
      const dx = (Math.random() * 2 - 1) * w * 0.28, dy = -(w * (0.08 + Math.random() * 0.22)), rot = (Math.random() * 2 - 1) * 540;
      const a = sh2.animate([
        { transform: 'translate(-50%, -50%) translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(-50%, -50%) translate(${dx * 0.55}px, ${dy}px) rotate(${rot / 2}deg) scale(.95)`, opacity: 1, offset: 0.35 },
        { transform: `translate(-50%, -50%) translate(${dx}px, ${dy + w * 0.75}px) rotate(${rot}deg) scale(.5)`, opacity: 0 },
      ], { duration: 750 + Math.random() * 350, delay: delay * 1000, easing: 'cubic-bezier(.25,.6,.45,1)', fill: 'both' });
      a.onfinish = () => sh2.remove();
    }
  };
  /** Крупно на весь экран: похвала, очки и комбо. */
  const bigShow = (word: string, pts: number, comboN: number, tier: number) => {
    const ov = el(`<div class="bl-big t${tier}" aria-live="polite"><div class="w">${word}</div><div class="n">+${fmt(pts)}</div>${comboN > 1 ? `<div class="c">Комбо ×${comboN}</div>` : ''}</div>`);
    sh.node.appendChild(ov);
    setTimeout(() => ov.remove(), 1400);
  };
  /** Счёт в шапке «добегает» до нового значения. */
  let shown = 0, tween = 0;
  const showScore = () => {
    cancelAnimationFrame(tween);
    const from = shown, to = score, t0 = performance.now(), dur = to - from > 30 ? 650 : 250;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      shown = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      sh.setScore(fmt(shown));
      if (k < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  };

  const place = (p: Piece, r: number, c: number) => {
    p.cells.forEach((row, i) => row.forEach((v, j) => { if (v) grid[r + i][c + j] = p.color; }));
    p.used = true;
    const got = p.cells.flat().filter(Boolean).length;
    score += got;
    const { rows: fullR, cols: fullC } = fullAfter(null, 0, 0);
    const cleared = fullR.length + fullC.length;
    const cr = r + p.cells.length / 2 - 0.5, cc = c + p.cells[0].length / 2 - 0.5;
    if (pieces.every((x) => x.used)) deal();
    if (!cleared) {
      combo = 0;
      comboEl.textContent = '';
      showScore();
      drawGrid(); drawTray();
      // фигура «впечатывается» в сетку
      p.cells.forEach((row, i) => row.forEach((v, j) => { if (v) gEl.children[(r + i) * N + c + j]?.classList.add('drop'); }));
      if (!anyFit()) finish();
      return;
    }
    combo++;
    lines += cleared;
    const bonus = cleared * 10 * combo * (cleared > 1 ? cleared : 1);
    score += bonus;
    showScore();
    comboEl.innerHTML = combo > 1 ? `<b class="gold">Комбо ×${combo}</b>` : '';
    haptic(cleared > 1 ? 'heavy' : 'ok');
    // анимация: линии вспыхивают и рассыпаются волной от места, куда поставили фигуру
    drawGrid();
    const gone = new Set<number>();
    fullR.forEach((i) => { for (let j = 0; j < N; j++) gone.add(i * N + j); });
    fullC.forEach((j) => { for (let i = 0; i < N; i++) gone.add(i * N + j); });
    const budget = { n: 60 };
    gone.forEach((k) => {
      const i = Math.floor(k / N), j = k % N;
      const cell = gEl.children[k] as HTMLElement;
      const d = (Math.abs(i - cr) + Math.abs(j - cc)) * 0.035;
      cell.style.setProperty('--d', `${d}s`);
      cell.classList.add('clr');
      shards(k, grid[i][j] ?? '#fff', d + 0.1, budget);
    });
    if (cleared > 1 || combo > 2) { const b = node.querySelector<HTMLElement>('.bl-board')!; b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }
    fullR.forEach((i) => { const b = el(`<div class="bl-beam" style="top:${(i / N) * 100}%;height:${100 / N}%"></div>`); fxEl.appendChild(b); setTimeout(() => b.remove(), 600); });
    fullC.forEach((j) => { const b = el(`<div class="bl-beam v" style="left:${(j / N) * 100}%;width:${100 / N}%"></div>`); fxEl.appendChild(b); setTimeout(() => b.remove(), 600); });
    const tier = Math.min(PRAISE.length - 1, cleared - 1 + (combo > 1 ? 1 : 0) + (combo > 3 ? 1 : 0));
    bigShow(PRAISE[tier], bonus, combo, tier);
    busy = true;
    setTimeout(() => {
      gone.forEach((k) => (grid[Math.floor(k / N)][k % N] = null));
      busy = false;
      if (grid.every((row) => row.every((v) => !v))) { score += 300; showScore(); bigShow('Вся неделя свободна!', 300, 0, 4); haptic('heavy'); }
      drawGrid(); drawTray();
      if (!anyFit()) finish();
    }, 520 + gone.size * 4);
    drawTray();
  };

  // перетаскивание
  let drag: { i: number; ghostEl: HTMLElement; offR: number; offC: number; pid: number } | null = null;
  const cellAt = (x: number, y: number) => {
    const r = gEl.getBoundingClientRect();
    const cs = r.width / N;
    return { r: Math.floor((y - r.top) / cs), c: Math.floor((x - r.left) / cs), cs };
  };
  tEl.addEventListener('pointerdown', (e) => {
    const pe = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (!pe || over || busy || drag) return; // второй палец, пока тянем первую фигуру, игнорируем
    const i = Number(pe.dataset.i);
    const p = pieces[i];
    if (p.used) return;
    const cs = gEl.getBoundingClientRect().width / N;
    const ghostEl = el(`<div class="bl-drag" style="grid-template-columns:repeat(${p.cells[0].length},${cs}px)">${p.cells.map((row) => row.map((v) => `<div class="${v ? 'bl-c on' : ''}" style="width:${cs}px;height:${cs}px;${v ? `--c:${p.color}` : ''}"></div>`).join('')).join('')}</div>`);
    document.body.appendChild(ghostEl);
    drag = { i, ghostEl, offR: p.cells.length / 2, offC: p.cells[0].length / 2, pid: e.pointerId };
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
  const mv = (e: PointerEvent) => { if (drag && e.pointerId === drag.pid) move(e.clientX, e.clientY); };
  window.addEventListener('pointermove', mv);
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const p = pieces[drag.i];
    const cs = gEl.getBoundingClientRect().width / N;
    const gx = e.clientX - drag.offC * cs, gy = e.clientY - drag.offR * cs - 70;
    const at = cellAt(gx + cs / 2, gy + cs / 2);
    drag.ghostEl.remove();
    drag = null;
    if (!busy && fits(p, at.r, at.c)) place(p, at.r, at.c); else { drawGrid(); drawTray(); }
  };
  window.addEventListener('pointerup', up);
  // жест прервала система (входящий звонок, шторка, мультитач): фигура возвращается в лоток, а не «зависает»
  const cancel = () => { if (!drag) return; drag.ghostEl.remove(); drag = null; drawGrid(); drawTray(); };
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  const cleanup = () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointermove', mv); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); drag?.ghostEl.remove(); drag = null; };
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
