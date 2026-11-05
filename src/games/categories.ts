// «Категории» — буква и пять категорий, 60 секунд. Засчитывается только настоящее слово из категории на нужную
// букву (словарь — config/categories-dict.ts). В конце — что засчитано и примеры для пропущенных.
import { CATEGORIES, CATEGORY_LETTERS } from '../config/words';
import { categoryAccepts, wordsOnLetter } from '../config/categories-dict';
import { shuffle } from '../core/questions';
import { haptic } from '../core/telegram';
import { esc } from '../lib/dom';
import type { App } from '../ui/app';
import { loop, reportResult, shell, showResult, type PlayCtx } from './kit';

const TIME = 60;

export function openCategories(app: App, ctx?: PlayCtx) {
  const sh = shell(app, 'categories', ctx);
  const { letter, cats } = pickRound();
  let left = TIME, over = false;
  sh.setSub(`Буква «${letter}» · по одному слову на каждую категорию`);
  sh.body.innerHTML = `<div class="page" style="padding-top:4px">
    <div class="row"><div class="ct-letter rolling" data-l>${letter}</div><div class="grow"><div class="small muted">Осталось</div><div style="font-family:var(--head);font-size:30px;color:var(--gold2)" data-t>${TIME}</div>
      <div class="al-bar"><i data-bar style="width:100%"></i></div></div></div>
    ${cats.map((c, i) => `<label class="col ct-row" style="gap:4px"><span class="small"><b>${i + 1}. ${esc(c)}</b></span><div class="ct-in"><input class="input-ans" data-i="${i}" autocomplete="off" placeholder="на «${letter}»…" disabled><i data-ok="${i}"></i></div></label>`).join('')}
    <div class="row small"><span class="grow muted">Засчитано: <b class="gold" data-cnt>0</b> из 5</span></div>
    <button class="btn btn-gold btn-block" data-done>Готово</button></div>`;
  const inputs = Array.from(sh.body.querySelectorAll<HTMLInputElement>('[data-i]'));
  // поле знает свою категорию: «Кот» засчитается в «Животное», но не в «Документ»
  const validAt = (k: number, s: string) => categoryAccepts(cats[k], letter, s);
  const startsRight = (s: string) => s.trim().toUpperCase().replace(/Ё/g, 'Е')[0] === letter;
  // барабан: буквы мелькают 1,2 секунды, потом время пошло
  const lEl = sh.body.querySelector<HTMLElement>('[data-l]')!;
  let rolling = 1.2;
  inputs.forEach((inp, k) => inp.addEventListener('input', () => {
    const v = inp.value.trim();
    const ok = validAt(k, v);
    // пока слово набирается на нужную букву — без красного крестика, отметка появится, когда слово найдётся
    sh.body.querySelector<HTMLElement>(`[data-ok="${k}"]`)!.className = !v ? '' : ok ? 'ok' : startsRight(v) && v.length < 4 ? '' : 'no';
    sh.body.querySelector('[data-cnt]')!.textContent = String(inputs.filter((x, i) => validAt(i, x.value)).length);
    if (ok && inp.dataset.got !== '1') { inp.dataset.got = '1'; haptic('ok'); inputs[k + 1]?.focus(); }
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
    const okAt = answers.map((a, i) => validAt(i, a));
    const ok = okAt.filter(Boolean).length;
    const sc = ok * 100 + (ok > 0 ? Math.round(Math.max(0, left)) * ok : 0); // бонус за скорость — только если что-то засчитано
    haptic(ok >= 4 ? 'ok' : 'tap');
    const value = Math.min(30, ok * 6);
    const got = await reportResult(app, 'categories', sc, value, ctx);
    showResult(app, sh, { title: ok === 5 ? 'Все пять!' : `Засчитано ${ok} из 5`, good: ok >= 3, score: sc, lines: cats.map((c, i) => okAt[i] ? `✓ ${c}: ${answers[i]}` : `✗ ${c}: ${answers[i] || '—'} · можно было: ${examples(c, letter)}`), got, value, ctx, again: () => { app.closeOverlay(); openCategories(app, ctx); } });
  };
  sh.onExit(() => stop());
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
/** Пара примеров, что засчиталось бы. */
function examples(cat: string, letter: string) {
  return shuffle(wordsOnLetter(cat, letter)).slice(0, 2).map(cap).join(', ') || '—';
}

/** Пять категорий и буква, на которую в каждой есть хотя бы два слова из словаря (или хотя бы одно). */
function pickRound() {
  for (let t = 0; t < 60; t++) {
    const cats = shuffle(CATEGORIES).slice(0, 5);
    const letters = shuffle(CATEGORY_LETTERS).filter((l) => cats.every((c) => wordsOnLetter(c, l).length >= (t < 40 ? 2 : 1)));
    if (letters.length) return { cats, letter: letters[0] };
  }
  return { cats: CATEGORIES.slice(0, 5), letter: 'К' };
}
