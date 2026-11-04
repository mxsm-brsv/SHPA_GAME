// «Профкроссворд» — кроссворд дня из профсоюзных терминов: сетка собирается автоматически из словаря.
import { CROSS_WORDS } from '../config/words';
import { haptic } from '../core/telegram';
import { mskDay } from '../core/state';
import { esc, toast } from '../lib/dom';
import type { App } from '../ui/app';
import { keyboard } from './keyboard';
import { reportResult, shell, showResult, type PlayCtx } from './kit';

interface Placed { w: string; clue: string; r: number; c: number; dir: 'h' | 'v'; n: number }

const norm = (w: string) => w.toUpperCase().replace(/Ё/g, 'Е');

function bounds(ps: Placed[]) {
  return {
    r0: Math.min(...ps.map((p) => p.r)), c0: Math.min(...ps.map((p) => p.c)),
    r1: Math.max(...ps.map((p) => p.r + (p.dir === 'v' ? p.w.length - 1 : 0))), c1: Math.max(...ps.map((p) => p.c + (p.dir === 'h' ? p.w.length - 1 : 0))),
  };
}

function seeded(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Кроссворд дня: из нескольких десятков раскладок берём самую компактную (почти квадратную),
 *  чтобы клетки были крупными и сетка вместе с клавиатурой помещалась на экран телефона. */
export function buildCrossword(seed: number, want = 8): Placed[] {
  let best: Placed[] = [], bestScore = Infinity;
  for (let k = 0; k < 48; k++) {
    const p = layoutOnce(seed * 101 + k, want);
    const rows = Math.max(...p.map((x) => x.r + (x.dir === 'v' ? x.w.length : 1)));
    const cols = Math.max(...p.map((x) => x.c + (x.dir === 'h' ? x.w.length : 1)));
    const score = (want - p.length) * 1000 + Math.max(rows, cols) * 10 + (rows * cols) / 50;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/** Одна раскладка: кладём слова по одному через пересечения; из подходящих мест — то, что меньше раздувает сетку. */
function layoutOnce(seed: number, want: number): Placed[] {
  const rnd = seeded(seed + 7);
  const pool = [...CROSS_WORDS].map((x) => ({ w: norm(x.w), clue: x.clue })).sort(() => rnd() - 0.5);
  const placed: Placed[] = [];
  const cells = new Map<string, string>();
  const key = (r: number, c: number) => `${r},${c}`;
  const canPlace = (w: string, r: number, c: number, dir: 'h' | 'v') => {
    let cross = 0;
    for (let i = 0; i < w.length; i++) {
      const rr = r + (dir === 'v' ? i : 0), cc = c + (dir === 'h' ? i : 0);
      const ex = cells.get(key(rr, cc));
      if (ex && ex !== w[i]) return -1;
      if (ex) cross++;
      else {
        // соседи сбоку не должны склеиваться
        const n1 = dir === 'h' ? cells.get(key(rr - 1, cc)) : cells.get(key(rr, cc - 1));
        const n2 = dir === 'h' ? cells.get(key(rr + 1, cc)) : cells.get(key(rr, cc + 1));
        if (n1 || n2) return -1;
      }
    }
    const before = dir === 'h' ? key(r, c - 1) : key(r - 1, c);
    const after = dir === 'h' ? key(r, c + w.length) : key(r + w.length, c);
    if (cells.has(before) || cells.has(after)) return -1;
    return cross;
  };
  const put = (p: Placed) => { placed.push(p); for (let i = 0; i < p.w.length; i++) cells.set(key(p.r + (p.dir === 'v' ? i : 0), p.c + (p.dir === 'h' ? i : 0)), p.w[i]); };
  for (const item of pool) {
    if (placed.length >= want) break;
    if (!placed.length) { put({ ...item, r: 0, c: 0, dir: 'h', n: 0 }); continue; }
    let best: Placed | null = null, bestSpan = Infinity;
    const box = bounds(placed);
    for (const p of placed) for (let i = 0; i < p.w.length; i++) for (let j = 0; j < item.w.length; j++) {
      if (p.w[i] !== item.w[j]) continue;
      const dir = p.dir === 'h' ? 'v' : 'h';
      const r = p.dir === 'h' ? p.r - j : p.r + i;
      const c = p.dir === 'h' ? p.c + i : p.c - j;
      const cr = canPlace(item.w, r, c, dir);
      if (cr <= 0) continue;
      const r2 = r + (dir === 'v' ? item.w.length - 1 : 0), c2 = c + (dir === 'h' ? item.w.length - 1 : 0);
      const span = Math.max(Math.max(box.r1, r2) - Math.min(box.r0, r), Math.max(box.c1, c2) - Math.min(box.c0, c)) - cr * 0.5 + rnd() * 0.9;
      if (span < bestSpan) { bestSpan = span; best = { ...item, r, c, dir, n: 0 }; }
    }
    if (best) put(best);
  }
  // нормализуем координаты и нумеруем
  const minR = Math.min(...placed.map((p) => p.r)), minC = Math.min(...placed.map((p) => p.c));
  placed.forEach((p) => { p.r -= minR; p.c -= minC; });
  placed.sort((a, b) => a.r - b.r || a.c - b.c).forEach((p, i) => (p.n = i + 1));
  return placed;
}

export function openCrossword(app: App, ctx?: PlayCtx) {
  const s = app.state;
  const day = Math.floor((Date.now() + 3 * 3600_000) / 86400_000);
  const words = buildCrossword(day);
  const rows = Math.max(...words.map((p) => p.r + (p.dir === 'v' ? p.w.length : 1)));
  const cols = Math.max(...words.map((p) => p.c + (p.dir === 'h' ? p.w.length : 1)));
  const sol = new Map<string, string>();
  words.forEach((p) => { for (let i = 0; i < p.w.length; i++) sol.set(`${p.r + (p.dir === 'v' ? i : 0)},${p.c + (p.dir === 'h' ? i : 0)}`, p.w[i]); });
  const typed = new Map<string, string>();
  let cur = 0, pos = 0, hints = 0, over = false;
  const doneKey = `crossword@${mskDay()}`;
  const sh = shell(app, 'crossword', ctx);
  sh.setSub(s.tasks.done[doneKey] ? 'Уже решён сегодня — можно ещё раз без баллов' : 'Тапни клетку и вводи слово');
  sh.body.innerHTML = `<div class="cw-wrap"><div class="cw-box" data-box><div class="cw-grid" data-g></div></div>
    <div class="cw-bar"><button class="cw-nav" data-prev aria-label="Предыдущее слово">‹</button><div class="cw-clue" data-clue></div><button class="cw-nav" data-nextw aria-label="Следующее слово">›</button></div></div>`;
  const gEl = sh.body.querySelector<HTMLElement>('[data-g]')!;
  const boxEl = sh.body.querySelector<HTMLElement>('[data-box]')!;
  // размер клетки — по свободному месту между шапкой и клавиатурой
  const fit = () => {
    const r = boxEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const gap = 2;
    const cs = Math.max(16, Math.min(44, Math.floor(Math.min((r.width - gap * (cols - 1)) / cols, (r.height - gap * (rows - 1)) / rows))));
    gEl.style.gridTemplateColumns = `repeat(${cols}, ${cs}px)`;
    gEl.style.gridAutoRows = `${cs}px`;
    gEl.style.setProperty('--cs', `${cs}px`);
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  ro?.observe(boxEl);
  sh.onExit(() => ro?.disconnect());
  const cellOf = (p: Placed, i: number) => `${p.r + (p.dir === 'v' ? i : 0)},${p.c + (p.dir === 'h' ? i : 0)}`;
  const solved = (p: Placed) => [...p.w].every((ch, i) => typed.get(cellOf(p, i)) === ch);
  const draw = () => {
    const w = words[cur];
    const active = new Set([...w.w].map((_, i) => cellOf(w, i)));
    const nums = new Map(words.map((p) => [`${p.r},${p.c}`, p.n]));
    let h = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${r},${c}`;
      if (!sol.has(k)) { h += '<div class="cw-c empty"></div>'; continue; }
      const t = typed.get(k) ?? '';
      const ok = words.some((p) => solved(p) && [...p.w].some((_, i) => cellOf(p, i) === k));
      h += `<button class="cw-c ${active.has(k) ? 'act' : ''} ${k === cellOf(w, pos) ? 'cur' : ''} ${ok ? 'ok' : ''}" data-k="${k}">${nums.has(k) ? `<i>${nums.get(k)}</i>` : ''}${t}</button>`;
    }
    gEl.innerHTML = h;
    sh.body.querySelector('[data-clue]')!.innerHTML = `<div class="cw-ch"><b>${w.n}. ${w.dir === 'h' ? 'По горизонтали' : 'По вертикали'}</b><span class="muted">${w.w.length} букв</span><button class="cw-hint" data-hint>💡 Буква</button></div><div class="cw-ct">${esc(w.clue)}</div>`;
    sh.setScore(`${words.filter(solved).length}/${words.length}`);
  };
  gEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
    if (!b) return;
    const k = b.dataset.k!;
    const list = words.map((p, i) => ({ p, i, at: [...p.w].findIndex((_, j) => cellOf(p, j) === k) })).filter((x) => x.at >= 0);
    const inCur = list.find((x) => x.i === cur);
    const other = list.find((x) => x.i !== cur);
    // повторный тап по текущей клетке на пересечении переключает направление
    const pick = inCur && other && cellOf(words[cur], pos) === k ? other : inCur ?? list[0];
    cur = pick.i; pos = pick.at;
    draw();
  });
  const step = (d: number) => { cur = (cur + d + words.length) % words.length; pos = 0; draw(); };
  sh.body.querySelector('[data-prev]')!.addEventListener('click', () => step(-1));
  sh.body.querySelector('[data-nextw]')!.addEventListener('click', () => step(1));
  sh.body.querySelector('[data-clue]')!.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-hint]')) return;
    const w = words[cur];
    const i = [...w.w].findIndex((ch, j) => typed.get(cellOf(w, j)) !== ch);
    if (i < 0) return;
    typed.set(cellOf(w, i), w.w[i]); hints++; pos = Math.min(w.w.length - 1, i + 1); draw(); check();
  });
  const kb = keyboard((k) => {
    if (over) return;
    const w = words[cur];
    if (k === '⌫') { typed.delete(cellOf(w, pos)); pos = Math.max(0, pos - 1); }
    else if (k === '↵') { step(1); return; }
    else { typed.set(cellOf(w, pos), norm(k)); pos = Math.min(w.w.length - 1, pos + 1); if (solved(w)) { haptic('ok'); const nx = words.findIndex((p) => !solved(p)); if (nx >= 0) { cur = nx; pos = 0; } } }
    draw(); check();
  }, { enter: '→' });
  kb.el.classList.add('kb-cw');
  sh.body.appendChild(kb.el);
  requestAnimationFrame(fit);
  const check = async () => {
    if (over || !words.every(solved)) return;
    over = true;
    const first = !s.tasks.done[doneKey];
    s.tasks.done[doneKey] = 1;
    const sc = Math.max(0, words.length - hints);
    const value = first ? Math.min(30, sc * 4) : 0;
    const got = await reportResult(app, 'crossword', sc, value, ctx);
    toast('Кроссворд решён!', 'ok');
    setTimeout(() => showResult(app, sh, { title: 'Кроссворд решён!', good: true, score: sc, scoreLabel: 'слов без подсказок', lines: [`Подсказок: ${hints}`], got, value, ctx, again: () => { app.closeOverlay(); openCrossword(app, ctx); } }), 500);
  };
  draw();
}
