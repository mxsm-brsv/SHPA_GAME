// Живая игра «Объясни»: команды объясняют профсоюзные слова. Шпиона убрали по решению команды.
// Рейтинг за победу отмечает ведущий в панели организатора.
import { ALIAS_WORDS } from '../config/words';
import { shuffle } from '../core/questions';
import { haptic } from '../core/telegram';
import { $ } from '../lib/dom';
import type { App } from '../ui/app';
import { loop, shell, type PlayCtx } from './kit';

// ---------------- Объясни ----------------
export function openAlias(app: App, ctx?: PlayCtx) {
  const sh = shell(app, 'alias', ctx);
  let teams = 2, seconds = 60;
  const scores: number[] = [];
  let turn = 0;
  let deck = shuffle(ALIAS_WORDS);
  const setup = () => {
    sh.body.innerHTML = `<div class="page" style="padding-top:4px">
      <div class="card col"><b>Как играть</b><div class="small muted">Один объясняет слово своей команде, не называя его и однокоренные. Угадали — «+1», пропустили — «−1». За раунд — ${seconds} секунд, потом телефон переходит другой команде.</div></div>
      <div class="card row"><div class="grow"><b>Команд</b></div><button class="btn btn-ghost btn-sm" data-m="-">−</button><b style="width:30px;text-align:center" data-n>${teams}</b><button class="btn btn-ghost btn-sm" data-m="+">+</button></div>
      <button class="btn btn-gold btn-block" data-go>Начать</button></div>`;
    sh.body.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.addEventListener('click', () => { teams = Math.max(2, Math.min(4, teams + (b.dataset.m === '+' ? 1 : -1))); $(sh.body, '[data-n]').textContent = String(teams); }));
    $(sh.body, '[data-go]').addEventListener('click', () => { for (let i = 0; i < teams; i++) scores[i] = 0; ready(); });
  };
  const board = () => `<div class="row" style="gap:6px;flex-wrap:wrap;justify-content:center">${scores.map((v, i) => `<span class="tag" style="${i === turn ? 'background:var(--gold);color:#3a2a00' : ''}">Команда ${i + 1}: ${v}</span>`).join('')}</div>`;
  const ready = () => {
    sh.body.innerHTML = `<div class="page" style="align-items:center;text-align:center;padding-top:20px">${board()}
      <h2 style="font-size:28px">Ходит команда ${turn + 1}</h2><button class="btn btn-gold btn-block" data-go>Поехали!</button>
      <button class="btn btn-ghost btn-block" data-end>Закончить игру</button></div>`;
    $(sh.body, '[data-go]').addEventListener('click', round);
    $(sh.body, '[data-end]').addEventListener('click', final);
  };
  const round = () => {
    const end = Date.now() + seconds * 1000;
    let word = '';
    const nextWord = () => { if (!deck.length) deck = shuffle(ALIAS_WORDS); word = deck.pop()!; $(sh.body, '[data-w]').textContent = word; };
    sh.body.innerHTML = `<div class="page" style="align-items:center;text-align:center">${board()}
      <div style="font-family:var(--head);font-size:44px;color:var(--gold2)" data-clock></div>
      <div class="spy-card on" style="min-height:160px"><h2 data-w style="font-size:30px"></h2></div>
      <div class="row" style="gap:10px;width:100%"><button class="btn btn-red grow" data-skip>Пропуск −1</button><button class="btn btn-green grow" data-ok>Угадали +1</button></div></div>`;
    nextWord();
    $(sh.body, '[data-ok]').addEventListener('click', () => { scores[turn]++; haptic('ok'); nextWord(); sh.setScore(String(scores[turn])); });
    $(sh.body, '[data-skip]').addEventListener('click', () => { scores[turn]--; haptic('bad'); nextWord(); sh.setScore(String(scores[turn])); });
    const stop = loop(() => {
      const left = end - Date.now();
      $(sh.body, '[data-clock]').textContent = String(Math.max(0, Math.ceil(left / 1000)));
      if (left <= 0) { haptic('heavy'); turn = (turn + 1) % teams; ready(); return false; }
    });
    sh.onExit(() => stop());
  };
  const final = () => {
    const best = Math.max(...scores);
    sh.body.innerHTML = `<div class="page" style="align-items:center;text-align:center;padding-top:20px"><h2 style="font-size:28px">Итог</h2>
      ${scores.map((v, i) => `<div class="card row" style="width:100%"><b class="grow">Команда ${i + 1}</b><b class="gold">${v}</b>${v === best ? ' 🏆' : ''}</div>`).join('')}
      <div class="small muted">Победу на вечерке отмечает ведущий</div>
      <button class="btn btn-gold btn-block" data-again>Новая игра</button></div>`;
    $(sh.body, '[data-again]').addEventListener('click', () => { turn = 0; setup(); });
  };
  setup();
}
