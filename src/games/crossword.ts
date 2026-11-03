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

function seeded(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Простой генератор: кладём слова по одному, каждое новое — через пересечение с уже стоящими. */
export function buildCrossword(seed: number, want = 8): Placed[] {
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
    let best: Placed | null = null;
    for (const p of placed) for (let i = 0; i < p.w.length; i++) for (let j = 0; j < item.w.length; j++) {
      if (p.w[i] !== item.w[j]) continue;
      const dir = p.dir === 'h' ? 'v' : 'h';
      const r = p.dir === 'h' ? p.r - j : p.r + i;
      const c = p.dir === 'h' ? p.c + i : p.c - j;
      const cr = canPlace(item.w, r, c, dir);
      if (cr > 0 && (!best || rnd() < 0.5)) best = { ...item, r, c, dir, n: 0 };
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
  sh.setSub(s.tasks.done[doneKey] ? 'Кроссворд дня уже решён — можно пройти ещё раз без баллов' : 'Нажми на клетку, впиши слово. Подсказка открывает букву');
  sh.body.innerHTML = `<div class="cw-wrap"><div class="cw-grid" style="grid-template-columns:repeat(${cols},1fr)" data-g></div>
    <div class="cw-clue" data-clue></div><div class="row" style="gap:8px"><button class="btn btn-ghost btn-sm grow" data-prev>← Пред.</button><button class="btn btn-blue btn-sm grow" data-hint>Подсказка</button><button class="btn btn-ghost btn-sm grow" data-nextw>След. →</button></div></div>`;
  const gEl = sh.body.querySelector<HTMLElement>('[data-g]')!;
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
    sh.body.querySelector('[data-clue]')!.innerHTML = `<b>${w.n}. ${w.dir === 'h' ? 'По горизонтали' : 'По вертикали'}</b> (${w.w.length} букв)<br>${esc(w.clue)}`;
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
  sh.body.querySelector('[data-hint]')!.addEventListener('click', () => {
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
  sh.body.appendChild(kb.el);
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
