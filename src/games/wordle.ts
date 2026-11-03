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
  const board = el('<div class="wd-board"></div>');
  const draw = () => {
    board.innerHTML = Array.from({ length: 6 }, (_, r) => {
      const word = r < rows.length ? rows[r] : r === rows.length ? cur : '';
      const res = r < rows.length ? score(rows[r]) : [];
      return `<div class="wd-row">${Array.from({ length: 5 }, (_, i) => `<div class="wd-c ${res[i] ?? (word[i] ? 'fill' : '')}">${word[i] ?? ''}</div>`).join('')}</div>`;
    }).join('');
  };
  const score = (w: string): ('ok' | 'near' | 'no')[] => {
    const res: ('ok' | 'near' | 'no')[] = Array(5).fill('no');
    const left: Record<string, number> = {};
    for (let i = 0; i < 5; i++) { if (w[i] === target[i]) res[i] = 'ok'; else left[target[i]] = (left[target[i]] ?? 0) + 1; }
    for (let i = 0; i < 5; i++) if (res[i] !== 'ok' && left[w[i]]) { res[i] = 'near'; left[w[i]]--; }
    return res;
  };
  const kb = keyboard((k) => {
    if (over) return;
    if (k === '⌫') cur = cur.slice(0, -1);
    else if (k === '↵') {
      if (cur.length < 5) { toast('Нужно 5 букв', 'bad'); return; }
      rows.push(cur);
      score(cur).forEach((c, i) => kb.mark(cur[i], c));
      const won = cur === target;
      cur = '';
      haptic(won ? 'ok' : 'tap');
      if (won || rows.length === 6) { draw(); finish(won); return; }
    } else if (cur.length < 5) cur += norm(k);
    draw();
  }, { enter: 'ОК' });
  const finish = async (won: boolean) => {
    over = true;
    const tries = rows.length;
    const value = daily && won ? Math.max(10, 30 - (tries - 1) * 4) : 0;
    if (daily) s.tasks.done[dailyKey] = 1;
    const sc = won ? (7 - tries) * 100 : 0;
    const got = await reportResult(app, 'wordle', sc, value, ctx);
    setTimeout(() => showResult(app, sh, {
      title: won ? `Угадано за ${tries}!` : 'Не угадано', good: won, score: sc, lines: [`Слово: ${target}`, daily ? '' : 'Тренировка — без баллов'].filter(Boolean),
      got, value, ctx, again: () => { app.closeOverlay(); openWordle(app, ctx); },
    }), 700);
  };
  sh.body.appendChild(board);
  sh.body.appendChild(kb.el);
  draw();
}
