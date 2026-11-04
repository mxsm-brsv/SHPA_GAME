// «Категории» — буква и пять категорий, 60 секунд. Засчитываются слова на нужную букву (честная игра —
// ответы видны в конце, можно показать соседу).
import { CATEGORIES, CATEGORY_LETTERS } from '../config/words';
import { shuffle } from '../core/questions';
import { haptic } from '../core/telegram';
import { esc } from '../lib/dom';
import type { App } from '../ui/app';
import { loop, reportResult, shell, showResult, type PlayCtx } from './kit';

const TIME = 60;

export function openCategories(app: App, ctx?: PlayCtx) {
  const sh = shell(app, 'categories', ctx);
  const letter = CATEGORY_LETTERS[Math.floor(Math.random() * CATEGORY_LETTERS.length)];
  const cats = shuffle(CATEGORIES).slice(0, 5);
  let left = TIME, over = false;
  sh.setSub(`Буква «${letter}» · по одному слову на каждую категорию`);
  sh.body.innerHTML = `<div class="page" style="padding-top:4px">
    <div class="row"><div class="ct-letter rolling" data-l>${letter}</div><div class="grow"><div class="small muted">Осталось</div><div style="font-family:var(--head);font-size:30px;color:var(--gold2)" data-t>${TIME}</div>
      <div class="al-bar"><i data-bar style="width:100%"></i></div></div></div>
    ${cats.map((c, i) => `<label class="col ct-row" style="gap:4px"><span class="small"><b>${i + 1}. ${esc(c)}</b></span><div class="ct-in"><input class="input-ans" data-i="${i}" autocomplete="off" placeholder="на «${letter}»…" disabled><i data-ok="${i}"></i></div></label>`).join('')}
    <div class="row small"><span class="grow muted">Засчитано: <b class="gold" data-cnt>0</b> из 5</span></div>
    <button class="btn btn-gold btn-block" data-done>Готово</button></div>`;
  const inputs = Array.from(sh.body.querySelectorAll<HTMLInputElement>('[data-i]'));
  const norm = (s: string) => s.trim().toUpperCase().replace(/Ё/g, 'Е');
  const valid = (s: string) => { const n = norm(s); return n.length >= 2 && n[0] === norm(letter) && /^[А-Я -]+$/.test(n); };
  // барабан: буквы мелькают 1,2 секунды, потом время пошло
  const lEl = sh.body.querySelector<HTMLElement>('[data-l]')!;
  let rolling = 1.2;
  inputs.forEach((inp, k) => inp.addEventListener('input', () => {
    const v = inp.value.trim();
    const ok = valid(v);
    sh.body.querySelector<HTMLElement>(`[data-ok="${k}"]`)!.className = v ? (ok ? 'ok' : 'no') : '';
    sh.body.querySelector('[data-cnt]')!.textContent = String(inputs.filter((x) => valid(x.value)).length);
    if (ok && inp.dataset.done !== '1') { inp.dataset.done = '1'; haptic('ok'); inputs[k + 1]?.focus(); }
  }));
  const stop = loop((dt) => {
    if (over) return false;
    if (rolling > 0) {
      rolling -= dt;
      lEl.textContent = rolling > 0 ? CATEGORY_LETTERS[Math.floor(Math.random() * CATEGORY_LETTERS.length)] : letter;
      if (rolling <= 0) { lEl.classList.remove('rolling'); haptic('heavy'); inputs.forEach((x) => (x.disabled = false)); inputs[0]?.focus(); }
      return;
    }
    (sh.body.querySelector('[data-bar]') as HTMLElement).style.width = `${(Math.max(0, left) / TIME) * 100}%`;
    left -= dt;
    sh.body.querySelector('[data-t]')!.textContent = String(Math.max(0, Math.ceil(left)));
    if (left <= 0) { finish(); return false; }
  });
  sh.body.querySelector('[data-done]')!.addEventListener('click', () => finish());
  const finish = async () => {
    if (over) return;
    over = true;
    stop();
    const answers = inputs.map((i) => i.value.trim());
    const ok = answers.filter(valid).length;
    const sc = ok * 100 + (ok > 0 ? Math.round(Math.max(0, left)) * ok : 0); // бонус за скорость — только если что-то засчитано
    haptic(ok >= 4 ? 'ok' : 'tap');
    const value = Math.min(30, ok * 6);
    const got = await reportResult(app, 'categories', sc, value, ctx);
    showResult(app, sh, { title: ok === 5 ? 'Все пять!' : `Засчитано ${ok} из 5`, good: ok >= 3, score: sc, lines: cats.map((c, i) => `${valid(answers[i]) ? '✓' : '✗'} ${c}: ${answers[i] || '—'}`), got, value, ctx, again: () => { app.closeOverlay(); openCategories(app, ctx); } });
  };
  sh.onExit(() => stop());
}
