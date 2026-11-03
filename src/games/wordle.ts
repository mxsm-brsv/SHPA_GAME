// «Профвордл» — как Wordle: слово дня из 5 букв, 6 попыток. Слово дня одно на всех; после — тренировка.
import { WORDLE_WORDS } from '../config/words';
import { haptic } from '../core/telegram';
import { mskDay } from '../core/state';
import { el, toast } from '../lib/dom';
import type { App } from '../ui/app';
import { keyboard } from './keyboard';
import { reportResult, shell, showResult, type PlayCtx } from './kit';

const norm = (w: string) => w.toUpperCase().replace(/Ё/g, 'Е');
const dayIndex = () => Math.floor((Date.now() + 3 * 3600_000) / 86400_000);

export function openWordle(app: App, ctx?: PlayCtx) {
  const s = app.state;
  const dailyKey = `wordle@${mskDay()}`;
  const daily = !s.tasks.done[dailyKey];
  const target = norm(daily ? WORDLE_WORDS[dayIndex() % WORDLE_WORDS.length] : WORDLE_WORDS[Math.floor(Math.random() * WORDLE_WORDS.length)]);
  const sh = shell(app, 'wordle', ctx);
  sh.setSub(daily ? 'Слово дня — одно на всех. Баллы — только за него' : 'Тренировка: случайное слово, без баллов');
  const rows: string[] = [];
  let cur = '';
  let over = false;
  // доска строится один раз — клетки меняются по месту, поэтому анимации не перезапускаются
  const board = el(`<div class="wd-board">${Array.from({ length: 6 }, () => `<div class="wd-row">${'<div class="wd-c"></div>'.repeat(5)}</div>`).join('')}</div>`);
  const rowEls = [...board.querySelectorAll<HTMLElement>('.wd-row')];
  const cellsOf = (r: number) => [...rowEls[r].querySelectorAll<HTMLElement>('.wd-c')];
  const drawCur = () => {
    const r = rows.length;
    if (r >= 6) return;
    cellsOf(r).forEach((c, i) => { const ch = cur[i] ?? ''; if (c.textContent !== ch) { c.textContent = ch; c.className = `wd-c ${ch ? 'fill' : ''}`; } });
  };
  const reveal = (r: number, w: string, res: ('ok' | 'near' | 'no')[]) => {
    cellsOf(r).forEach((c, i) => { c.textContent = w[i]; c.style.setProperty('--d', `${i * 0.13}s`); c.className = `wd-c ${res[i]} rev`; });
  };
  const score = (w: string): ('ok' | 'near' | 'no')[] => {
    const res: ('ok' | 'near' | 'no')[] = Array(5).fill('no');
    const left: Record<string, number> = {};
    for (let i = 0; i < 5; i++) { if (w[i] === target[i]) res[i] = 'ok'; else left[target[i]] = (left[target[i]] ?? 0) + 1; }
    for (let i = 0; i < 5; i++) if (res[i] !== 'ok' && left[w[i]]) { res[i] = 'near'; left[w[i]]--; }
    return res;
  };
  const REVEAL_MS = 1100;
  const kb = keyboard((k) => {
    if (over) return;
    if (k === '⌫') cur = cur.slice(0, -1);
    else if (k === '↵') {
      if (cur.length < 5) {
        const row = rowEls[rows.length];
        row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
        toast('Нужно 5 букв', 'bad'); haptic('bad'); return;
      }
      const w = cur, res = score(w), r = rows.length;
      rows.push(w);
      reveal(r, w, res);
      setTimeout(() => res.forEach((c, i) => kb.mark(w[i], c)), REVEAL_MS - 200);
      const won = w === target;
      cur = '';
      haptic(won ? 'ok' : 'tap');
      if (won || rows.length === 6) {
        over = true;
        if (won) setTimeout(() => { cellsOf(r).forEach((c, i) => { c.classList.remove('rev'); c.style.setProperty('--d', `${i * 0.08}s`); }); rowEls[r].classList.add('win'); }, REVEAL_MS);
        setTimeout(() => finish(won), REVEAL_MS);
        return;
      }
    } else if (cur.length < 5) cur += norm(k);
    drawCur();
  }, { enter: 'ОК' });
  const finish = async (won: boolean) => {
    const tries = rows.length;
    const value = daily && won ? Math.max(10, 30 - (tries - 1) * 4) : 0;
    if (daily) s.tasks.done[dailyKey] = 1;
    const sc = won ? (7 - tries) * 100 : 0;
    const got = await reportResult(app, 'wordle', sc, value, ctx);
    setTimeout(() => showResult(app, sh, {
      title: won ? `Угадано за ${tries}!` : 'Не угадано', good: won, score: sc, lines: [`Слово: ${target}`, daily ? '' : 'Тренировка — без баллов'].filter(Boolean),
      got, value, ctx, again: () => { app.closeOverlay(); openWordle(app, ctx); },
    }), 900);
  };
  sh.body.appendChild(board);
  sh.body.appendChild(kb.el);
}
