// Живая игра «Объясни» (как Alias) на одном телефоне. Два режима:
//  • Классика — слова по одному, команды по очереди, раунд на время, пропуск со штрафом или без, разбор раунда;
//  • «Командность» — как на конкурсе «Ты — лидер»: список слов, 10 секунд молча прочитать, 2 минуты объяснять в любом порядке,
//    засчитывается только точная форма; после сигнала — 3 секунды на последнее слово.
import { ALIAS_LEVELS, type AliasLevel } from '../config/contest';
import { ALIAS_WORDS } from '../config/words';
import { shuffle } from '../core/questions';
import { haptic } from '../core/telegram';
import { $, esc } from '../lib/dom';
import type { App } from '../ui/app';
import { loop, shell, type PlayCtx } from './kit';

type Level = AliasLevel | 'mix';
const LS = 'shpa.alias.v1';
interface Opts { level: Level; penalty: boolean; teams: number; seconds: number; mode: 'classic' | 'contest'; listN: number }
const load = (): Opts => { try { return { level: 'mid', penalty: true, teams: 2, seconds: 60, mode: 'classic', listN: 15, ...JSON.parse(localStorage.getItem(LS) ?? '{}') }; } catch { return { level: 'mid', penalty: true, teams: 2, seconds: 60, mode: 'classic', listN: 15 }; } };
const save = (o: Opts) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* приватный режим */ } };

const wordsOf = (lv: Level) => (lv === 'mix' ? [...new Set([...ALIAS_LEVELS.flatMap((l) => l.words), ...ALIAS_WORDS.map((w) => w[0].toUpperCase() + w.slice(1))])] : ALIAS_LEVELS.find((l) => l.id === lv)!.words);

export function openAlias(app: App, ctx?: PlayCtx, start?: { contest?: boolean }) {
  const sh = shell(app, 'alias', ctx);
  const o = load();
  if (start?.contest) { o.mode = 'contest'; o.level = 'contest'; }
  const scores: number[] = [];
  let turn = 0;
  let deck: string[] = [];
  let stopLoop = () => {};
  sh.onExit(() => stopLoop());

  // ---------- Настройка ----------
  const setup = () => {
    sh.setSub(o.mode === 'contest' ? 'Как на конкурсе «Командность»' : 'Объясняй слова своей команде');
    const lv = (id: Level, name: string, text: string, ex: string[]) => `<button class="lv ${o.level === id ? 'on' : ''}" data-lv="${id}"><b>${name}</b><span>${esc(text)}</span><i>${ex.slice(0, 4).map(esc).join(' · ')}</i></button>`;
    sh.body.innerHTML = `<div class="page" style="padding-top:4px">
      <div class="seg"><button class="${o.mode === 'classic' ? 'on' : ''}" data-mode="classic">Классика</button><button class="${o.mode === 'contest' ? 'on' : ''}" data-mode="contest">«Командность»</button></div>
      <div class="howto small">${o.mode === 'classic'
        ? 'Один объясняет слово своей команде, не называя его и однокоренные. Угадали — «+1», пропуск — по настройке. Время вышло — телефон переходит следующей команде.'
        : 'Как на конкурсе: ведущий команды 10 секунд молча читает список, потом 2 минуты объясняет в любом порядке. Засчитывается только <b>точная форма</b> (род, число, падеж, порядок слов). Нельзя однокоренные, показывать и аббревиатуры-расшифровки («СКС»). После сигнала — 3 секунды на последнее слово.'}</div>
      <div class="section-h">Уровень слов</div>
      <div class="col" style="gap:8px">${ALIAS_LEVELS.map((l) => lv(l.id, l.name, l.text, shuffle(l.words))).join('')}${lv('mix', 'Всё вперемешку', 'Все уровни и вечерочные слова', shuffle(wordsOf('mix')))}</div>
      <div class="card col" style="gap:10px">
        <div class="row"><b class="grow">Команд</b><button class="btn btn-ghost btn-sm" data-t="-">−</button><b style="width:30px;text-align:center" data-tn>${o.teams}</b><button class="btn btn-ghost btn-sm" data-t="+">+</button></div>
        ${o.mode === 'classic' ? `<div class="row"><b class="grow">Раунд</b>${[30, 60, 90].map((s) => `<button class="chip ${o.seconds === s ? 'on' : ''}" data-sec="${s}">${s} с</button>`).join('')}</div>
        <label class="row" style="gap:10px"><input type="checkbox" data-pen ${o.penalty ? 'checked' : ''}><div class="grow"><b>Штраф за пропуск</b><div class="small muted">${o.penalty ? 'Пропуск слова — минус 1 балл' : 'Пропускать можно без штрафа'}</div></div></label>`
        : `<div class="row"><b class="grow">Слов в списке</b>${[10, 15, 20].map((n) => `<button class="chip ${o.listN === n ? 'on' : ''}" data-ln="${n}">${n}</button>`).join('')}</div>`}
      </div>
      <button class="btn btn-gold btn-block" data-go>Начать</button></div>`;
    const re = () => { save(o); setup(); };
    sh.body.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => { o.mode = b.dataset.mode as Opts['mode']; if (o.mode === 'contest' && o.level !== 'contest' && o.level !== 'hard') o.level = 'contest'; re(); }));
    sh.body.querySelectorAll<HTMLElement>('[data-lv]').forEach((b) => b.addEventListener('click', () => { o.level = b.dataset.lv as Level; haptic(); re(); }));
    sh.body.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.addEventListener('click', () => { o.teams = Math.max(1, Math.min(6, o.teams + (b.dataset.t === '+' ? 1 : -1))); re(); }));
    sh.body.querySelectorAll<HTMLElement>('[data-sec]').forEach((b) => b.addEventListener('click', () => { o.seconds = Number(b.dataset.sec); re(); }));
    sh.body.querySelectorAll<HTMLElement>('[data-ln]').forEach((b) => b.addEventListener('click', () => { o.listN = Number(b.dataset.ln); re(); }));
    sh.body.querySelector<HTMLInputElement>('[data-pen]')?.addEventListener('change', (e) => { o.penalty = (e.target as HTMLInputElement).checked; re(); });
    $(sh.body, '[data-go]').addEventListener('click', () => {
      save(o);
      scores.length = 0; for (let i = 0; i < o.teams; i++) scores[i] = 0;
      turn = 0; deck = shuffle(wordsOf(o.level));
      ready();
    });
  };

  const board = () => `<div class="row" style="gap:6px;flex-wrap:wrap;justify-content:center">${scores.map((v, i) => `<span class="tag" style="${i === turn ? 'background:var(--gold);color:#3a2a00' : ''}">Команда ${i + 1}: ${v}</span>`).join('')}</div>`;
  const takeWord = () => { if (!deck.length) deck = shuffle(wordsOf(o.level)); return deck.pop()!; };

  const ready = () => {
    sh.setScore('');
    sh.body.innerHTML = `<div class="page" style="align-items:center;text-align:center;padding-top:20px">${board()}
      <div class="al-turn">Ходит<br><b>команда ${turn + 1}</b></div>
      <div class="small muted">${o.mode === 'contest' ? 'Телефон — ведущему команды. Остальные не подглядывают!' : 'Телефон — объясняющему. Команда садится напротив.'}</div>
      <button class="btn btn-gold btn-block" data-go>${o.mode === 'contest' ? 'Показать список (10 с)' : 'Поехали!'}</button>
      <button class="btn btn-ghost btn-block" data-end>Закончить игру</button></div>`;
    $(sh.body, '[data-go]').addEventListener('click', o.mode === 'contest' ? contestRound : classicRound);
    $(sh.body, '[data-end]').addEventListener('click', final);
  };

  // ---------- Классика ----------
  const classicRound = () => {
    const log: { w: string; ok: boolean }[] = [];
    let word = takeWord();
    let end = Date.now() + o.seconds * 1000;
    let last = false;
    sh.body.innerHTML = `<div class="page" style="align-items:center;text-align:center">${board()}
      <div class="al-clock"><b data-clock></b><div class="al-bar"><i data-bar></i></div></div>
      <div class="al-stack"><div class="al-card" data-card><span class="small muted" data-lvl></span><h2 data-w></h2></div></div>
      <div class="small gold hidden" data-last>Время! Последнее слово — 3 секунды</div>
      <div class="row al-btns" style="gap:10px;width:100%"><button class="btn btn-red grow" data-skip>${o.penalty ? 'Пропуск −1' : 'Пропуск'}</button><button class="btn btn-green grow" data-ok>Угадали +1</button></div>
      <div class="small muted" data-cnt>угадано 0</div></div>`;
    const card = $(sh.body, '[data-card]');
    const show = () => { $(sh.body, '[data-w]').textContent = word; $(sh.body, '[data-lvl]').textContent = ALIAS_LEVELS.find((l) => l.words.includes(word))?.name ?? ''; card.classList.remove('fly-ok', 'fly-no'); card.classList.add('in'); setTimeout(() => card.classList.remove('in'), 250); };
    show();
    const answer = (ok: boolean) => {
      log.push({ w: word, ok });
      haptic(ok ? 'ok' : 'bad');
      card.classList.add(ok ? 'fly-ok' : 'fly-no');
      $(sh.body, '[data-cnt]').textContent = `угадано ${log.filter((x) => x.ok).length}${o.penalty ? ` · пропущено ${log.filter((x) => !x.ok).length}` : ''}`;
      if (last) { finishRound(); return; }
      setTimeout(() => { word = takeWord(); show(); }, 180);
    };
    $(sh.body, '[data-ok]').addEventListener('click', () => answer(true));
    $(sh.body, '[data-skip]').addEventListener('click', () => answer(false));
    // свайп по карточке: вправо — угадали, влево — пропуск
    let sx = 0;
    card.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    card.addEventListener('pointerup', (e) => { const d = e.clientX - sx; if (Math.abs(d) > 60) answer(d > 0); });
    stopLoop = loop(() => {
      const left = end - Date.now();
      $(sh.body, '[data-clock]').textContent = String(Math.max(0, Math.ceil(left / 1000)));
      ($(sh.body, '[data-bar]') as HTMLElement).style.width = `${Math.max(0, left / ((last ? 3 : o.seconds) * 1000)) * 100}%`;
      if (left <= 0) {
        if (!last) { last = true; end = Date.now() + 3000; haptic('heavy'); $(sh.body, '[data-last]').classList.remove('hidden'); return; }
        finishRound(); return false; // недообъяснённое последнее слово не штрафуем
      }
    });
    const finishRound = () => {
      stopLoop();
      // разбор раунда: можно поправить отметки, если нажали не то
      const render = () => {
        const pts = log.filter((x) => x.ok).length - (o.penalty ? log.filter((x) => !x.ok).length : 0);
        sh.body.innerHTML = `<div class="page"><h2 style="font-size:22px;text-align:center">Команда ${turn + 1}: ${pts > 0 ? '+' : ''}${pts}</h2>
          <div class="small muted center">Нажми на слово, чтобы поправить</div>
          <div class="list">${log.map((x, k) => `<button class="li al-log ${x.ok ? 'ok' : ''}" data-k="${k}"><span class="grow" style="text-align:left">${esc(x.w)}</span><b>${x.ok ? '+1' : o.penalty ? '−1' : '—'}</b></button>`).join('')}</div>
          <button class="btn btn-gold btn-block" data-next>Засчитать</button></div>`;
        sh.body.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => b.addEventListener('click', () => { const x = log[Number(b.dataset.k)]; x.ok = !x.ok; haptic(); render(); }));
        $(sh.body, '[data-next]').addEventListener('click', () => { scores[turn] += pts; turn = (turn + 1) % o.teams; ready(); });
      };
      render();
    };
  };

  // ---------- «Командность» ----------
  const contestRound = () => {
    const list = Array.from({ length: o.listN }, takeWord);
    const got = new Set<number>();
    let phase: 'read' | 'go' | 'grace' = 'read';
    let end = Date.now() + 10_000;
    sh.body.innerHTML = `<div class="page" style="gap:10px">${board()}
      <div class="al-clock"><span class="small muted" data-ph>Читаем молча — 10 секунд</span><b data-clock></b><div class="al-bar"><i data-bar></i></div></div>
      <div class="al-list">${list.map((w, k) => `<button class="al-w" data-k="${k}">${esc(w)}</button>`).join('')}</div>
      <div class="row"><span class="grow small muted" data-hint>Во время объяснения отмечай угаданные слова (точная форма!)</span><b class="gold" data-cnt>0</b></div></div>`;
    sh.body.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => b.addEventListener('click', () => {
      if (phase === 'read') return;
      const k = Number(b.dataset.k);
      if (got.has(k)) got.delete(k); else { got.add(k); haptic('ok'); }
      b.classList.toggle('ok', got.has(k));
      $(sh.body, '[data-cnt]').textContent = String(got.size);
      if (phase === 'grace') finish();
    }));
    const finish = () => {
      stopLoop();
      scores[turn] += got.size;
      sh.body.innerHTML = `<div class="page" style="align-items:center;text-align:center;padding-top:16px"><h2 style="font-size:26px">Команда ${turn + 1}: ${got.size} из ${list.length}</h2>
        <div class="list" style="width:100%">${list.map((w, k) => `<div class="li small"><span class="grow" style="text-align:left">${esc(w)}</span>${got.has(k) ? '<b style="color:#6dffb0">✓</b>' : '<span class="muted">—</span>'}</div>`).join('')}</div>
        <button class="btn btn-gold btn-block" data-next>${o.teams > 1 ? 'Следующая команда' : 'Ещё раунд'}</button><button class="btn btn-ghost btn-block" data-end>Итог</button></div>`;
      $(sh.body, '[data-next]').addEventListener('click', () => { turn = (turn + 1) % o.teams; ready(); });
      $(sh.body, '[data-end]').addEventListener('click', final);
    };
    stopLoop = loop(() => {
      const left = end - Date.now();
      const total = phase === 'read' ? 10 : phase === 'go' ? 120 : 3;
      $(sh.body, '[data-clock]').textContent = phase === 'go' ? `${Math.floor(Math.max(0, left) / 60000)}:${String(Math.ceil(Math.max(0, left) / 1000) % 60).padStart(2, '0')}` : String(Math.max(0, Math.ceil(left / 1000)));
      ($(sh.body, '[data-bar]') as HTMLElement).style.width = `${Math.max(0, left / (total * 1000)) * 100}%`;
      if (left > 0) return;
      if (phase === 'read') { phase = 'go'; end = Date.now() + 120_000; haptic('heavy'); $(sh.body, '[data-ph]').textContent = 'Объясняй! 2 минуты'; sh.body.querySelector('.al-list')!.classList.add('live'); return; }
      if (phase === 'go') { phase = 'grace'; end = Date.now() + 3000; haptic('heavy'); $(sh.body, '[data-ph]').textContent = 'Стоп! 3 секунды на последнее слово'; return; }
      finish(); return false;
    });
  };

  const final = () => {
    stopLoop();
    const best = Math.max(...scores);
    sh.body.innerHTML = `<div class="page" style="align-items:center;text-align:center;padding-top:20px"><h2 style="font-size:28px">Итог</h2>
      ${scores.map((v, i) => `<div class="card row" style="width:100%"><b class="grow">Команда ${i + 1}</b><b class="gold">${v}</b>${v === best ? ' 🏆' : ''}</div>`).join('')}
      <div class="small muted">Победу на вечерке отмечает ведущий</div>
      <button class="btn btn-gold btn-block" data-again>Новая игра</button></div>`;
    $(sh.body, '[data-again]').addEventListener('click', setup);
  };
  setup();
}
