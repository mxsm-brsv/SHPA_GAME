// Правовуха: «Правовой ринг» (на время, в рейтинг), тренировка по темам, карточки как в Quizlet и «Дело дня».
import { DAILY_MINIGAME_CAP } from '../config/economy';
import { icon, starSvg } from '../art/icons';
import { TOPICS_ORDER, shuffle, shuffledOptionOrder, type CheckResult, type Question } from '../core/questions';
import { mskDay } from '../core/state';
import { haptic } from '../core/telegram';
import { $, el, esc, modal, onAct, toast } from '../lib/dom';
import type { App } from '../ui/app';
import { reportResult, type PlayCtx } from './kit';

const FORMAT_LABEL = { yesno: 'Да или нет', choice: 'Выбери ответ', input: 'Впиши ответ' } as const;
const RING_N = 10;
const RATING_PER_RIGHT = 3;
const CASE_RATING = 20;

/** Вопрос дня — одинаковый для всех: по номеру дня из отсортированного списка. */
export function caseOfDay(qs: Question[]): Question | null {
  if (!qs.length) return null;
  const sorted = [...qs].sort((a, b) => (a.id < b.id ? -1 : 1));
  const day = Math.floor((Date.now() + 3 * 3600_000) / 86400_000);
  return sorted[day % sorted.length];
}

interface AskOpts {
  q: Question;
  n?: string;                 // «3 / 10»
  timeLimit?: number;         // секунд, если ринг
  onDone: (r: CheckResult & { timeLeft: number; timedOut: boolean }) => void;
  nextLabel?: string;
  onNext: () => void;
}

/** Рисует один вопрос в контейнер и возвращает функцию остановки таймера. */
function ask(app: App, box: HTMLElement, o: AskOpts) {
  const { q } = o;
  const order = q.format === 'choice' ? shuffledOptionOrder(q) : [];
  const letters = ['А', 'Б', 'В', 'Г'];
  box.innerHTML = `
    ${o.timeLimit ? '<div class="timer"><i data-tm style="width:100%"></i></div>' : ''}
    <div class="qcard"><div class="qm">${FORMAT_LABEL[q.format]} · ${esc(q.topic)}${o.n ? ` · ${o.n}` : ''}</div><div class="qt">${esc(q.question)}</div></div>
    <div data-ans>${
      q.format === 'yesno' ? `<div class="yn"><button class="ans" data-v="true">Да</button><button class="ans" data-v="false">Нет</button></div>`
      : q.format === 'choice' ? `<div class="answers">${order.map((oi, k) => `<button class="ans" data-v="${oi}"><b>${letters[k]})</b> ${esc(q.options![oi])}</button>`).join('')}</div>`
      : `<div class="col"><input class="input-ans" data-in placeholder="Твой ответ" autocomplete="off" autocapitalize="off" enterkeyhint="done"><button class="btn btn-gold btn-block" data-send>Ответить</button></div>`
    }</div>
    <div data-after></div>`;
  let answered = false;
  let timer = 0;
  const start = performance.now();
  const limit = (o.timeLimit ?? 0) * 1000;
  const timeLeft = () => (limit ? Math.max(0, limit - (performance.now() - start)) / 1000 : 0);

  const submit = async (given: string | number | boolean, btn?: HTMLElement) => {
    if (answered) return;
    answered = true;
    clearInterval(timer);
    const tl = timeLeft();
    box.querySelectorAll<HTMLButtonElement>('.ans, [data-send]').forEach((b) => (b.disabled = true));
    const res = await app.backend.checkAnswer(q, given);
    const s = app.state;
    (res.correct ? s.law.right : s.law.wrong)[q.id] = ((res.correct ? s.law.right : s.law.wrong)[q.id] ?? 0) + 1;
    haptic(res.correct ? 'ok' : 'bad');
    if (btn) btn.classList.add(res.correct ? 'ok' : 'no');
    if (!res.correct && q.format !== 'input') {
      // подсветить верный, если знаем (демо) — в онлайне хватит текста ответа
      box.querySelectorAll<HTMLElement>('.ans').forEach((b) => {
        const v = b.dataset.v!;
        const isRight = q.format === 'yesno' ? (res.right === 'Да') === (v === 'true') : q.options?.[Number(v)] === res.right;
        if (isRight) b.classList.add('ok');
      });
    }
    if (q.format === 'input') ($(box, '[data-in]') as HTMLInputElement).disabled = true;
    $(box, '[data-after]').innerHTML = `
      <div class="explain"><div style="font-family:var(--head);font-size:17px;margin-bottom:4px;color:${res.correct ? '#6dffb0' : '#ff8a8a'}">${res.correct ? 'Верно!' : given === '__timeout__' ? 'Время вышло' : 'Неверно'}</div>
      ${!res.correct ? `<div>Правильный ответ: <b>${esc(res.right)}</b></div>` : ''}
      <div class="small" style="margin-top:6px">${esc(res.explanation)}</div>
      <div class="small muted" style="margin-top:4px">Документ: ${esc(q.source)}</div></div>
      <button class="btn btn-gold btn-block" data-next style="margin-top:10px">${o.nextLabel ?? 'Дальше'}</button>`;
    $(box, '[data-next]').addEventListener('click', () => o.onNext());
    o.onDone({ ...res, timeLeft: tl, timedOut: given === '__timeout__' });
  };

  box.querySelectorAll<HTMLElement>('.ans').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.v!;
    submit(q.format === 'yesno' ? v === 'true' : Number(v), b);
  }));
  const inp = box.querySelector<HTMLInputElement>('[data-in]');
  if (inp) {
    const send = () => { if (inp.value.trim()) submit(inp.value.trim()); };
    $(box, '[data-send]').addEventListener('click', send);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    if (!o.timeLimit) setTimeout(() => inp.focus(), 50);
  }
  if (limit) {
    const bar = $(box, '[data-tm]');
    timer = window.setInterval(() => {
      const left = timeLeft();
      bar.style.width = `${(left / (o.timeLimit ?? 1)) * 100}%`;
      bar.style.backgroundPosition = `${(1 - left / (o.timeLimit ?? 1)) * 100}% 0`;
      if (left <= 0) submit('__timeout__');
    }, 100);
  }
  return () => clearInterval(timer);
}

function shell(title: string, sub = '') {
  return el(`<div class="screen full"><div class="quiz">
    <div class="row"><button class="btn btn-ghost btn-sm" data-act="exit" aria-label="Назад">${icon('back', 18)}</button>
      <div class="grow"><div style="font-family:var(--head);font-size:18px">${title}</div>${sub ? `<div class="small muted" data-sub>${sub}</div>` : '<div class="small muted" data-sub></div>'}</div>
      <div data-score style="font-family:var(--head);color:var(--gold2)"></div></div>
    <div class="col" data-box style="gap:12px"></div>
  </div></div>`);
}

const needQuestions = (app: App) => {
  if (!app.questions.length) { toast('Вопросы ещё загружаются', 'info'); return false; }
  return true;
};

// ---------------- Хаб правовухи ----------------
export function openLaw(app: App) {
  if (!needQuestions(app)) return;
  const s = app.state;
  const total = app.questions.length;
  const learned = app.questions.filter((q) => (s.law.right[q.id] ?? 0) > 0).length;
  const cod = caseOfDay(app.questions);
  const caseDone = s.daily.byGame['case_day'] !== undefined;
  const topics = TOPICS_ORDER.filter((t) => app.questions.some((q) => q.topic === t));
  const node = el(`<div class="screen full"><div class="page">
    <div class="row"><button class="btn btn-ghost btn-sm" data-act="exit" aria-label="Назад">${icon('back', 18)}</button><h1 class="grow" style="font-size:24px">Правовуха</h1></div>
    <div class="card row">${icon('book', 34, '#ffd76a')}<div class="grow"><b>${learned} из ${total}</b> вопросов отвечено верно<div class="xp" style="margin-top:6px"><i style="width:${(learned / Math.max(1, total)) * 100}%"></i></div></div></div>
    <button class="card row" data-act="case" style="text-align:left;${caseDone ? 'opacity:.6' : 'border-color:var(--gold)'}">${icon('scales', 30, '#ffc83d')}
      <div class="grow"><b>Дело дня</b><div class="small muted">${caseDone ? 'Уже решено сегодня — новое завтра' : `Один вопрос в день · +${CASE_RATING} баллов за верный ответ`}</div></div>${starSvg(18)}</button>
    <button class="card row" data-act="ring" style="text-align:left">${icon('target', 30, '#b26bff')}
      <div class="grow"><b>Правовой ринг</b><div class="small muted">${RING_N} вопросов на время, серия умножает очки · ${RATING_PER_RIGHT} баллов за верный, до ${DAILY_MINIGAME_CAP} в день</div></div></button>
    <button class="card row" data-act="cards" data-topic="" style="text-align:left">${icon('cards', 30, '#4fd1a5')}
      <div class="grow"><b>Карточки</b><div class="small muted">Как в Quizlet: вопрос → переверни → ответ и норма</div></div></button>
    <div class="section-h">Тренировка по темам</div>
    <div class="small muted">Без таймера и без баллов — чтобы выучить.</div>
    <div class="list">${topics.map((t) => {
      const qs = app.questions.filter((q) => q.topic === t);
      const ok = qs.filter((q) => (s.law.right[q.id] ?? 0) > 0).length;
      return `<div class="li"><div class="grow"><b>${esc(t)}</b><div class="small muted">${ok} / ${qs.length} верно</div></div>
        <button class="btn btn-ghost btn-sm" data-act="cards" data-topic="${esc(t)}" aria-label="Карточки по теме">${icon('cards', 16)}</button>
        <button class="btn btn-blue btn-sm" data-act="train" data-topic="${esc(t)}">Учить</button></div>`;
    }).join('')}</div>
  </div></div>`);
  onAct(node, {
    exit: () => app.closeOverlay(),
    ring: () => openRing(app),
    train: (t) => openTrain(app, t.dataset.topic!),
    cards: (t) => openCards(app, t.dataset.topic || ''),
    case: () => { if (caseDone) { toast('Дело дня уже решено', 'info'); return; } if (cod) openCase(app, cod); },
  });
  app.openOverlay(node);
}

// ---------------- Правовой ринг ----------------
export function openRing(app: App, ctx?: PlayCtx) {
  if (!needQuestions(app)) return;
  const s = app.state;
  // меньше повторов: сначала вопросы, на которые ещё не отвечали верно
  const fresh = shuffle(app.questions.filter((q) => !s.law.right[q.id]));
  const pool = [...fresh, ...shuffle(app.questions.filter((q) => s.law.right[q.id]))].slice(0, RING_N);
  const node = shell(ctx?.eventName ? `Правовой ринг · ${esc(ctx.eventName)}` : 'Правовой ринг', 'Серия из 3 верных — ×1,5, из 5 — ×2');
  const box = $(node, '[data-box]');
  let i = 0, score = 0, right = 0, streak = 0;
  let stop = () => {};
  const scoreEl = $(node, '[data-score]');
  // ринг: ты против «Правового нигилизма» — верный ответ бьёт его, ошибка — тебя
  let hpMe = 100, hpFoe = 100;
  const hud = el(`<div class="ring-hud"><div class="rh-side"><div class="rh-name">${esc(s.username.split(' ')[0])}</div><div class="rh-hp"><i data-me style="width:100%"></i></div></div>
    <div class="rh-mid"><div class="rh-fighter me" data-fme>🥊</div><div class="rh-vs" data-combo>VS</div><div class="rh-fighter foe" data-ffoe>😈</div></div>
    <div class="rh-side r"><div class="rh-name">Нигилизм</div><div class="rh-hp foe"><i data-foe style="width:100%"></i></div></div></div>`);
  box.before(hud);
  const hit = (ok: boolean, mult: number) => {
    const who = hud.querySelector<HTMLElement>(ok ? '[data-ffoe]' : '[data-fme]')!;
    const att = hud.querySelector<HTMLElement>(ok ? '[data-fme]' : '[data-ffoe]')!;
    if (ok) hpFoe = Math.max(0, hpFoe - 10 * mult); else hpMe = Math.max(0, hpMe - 12);
    hud.querySelector<HTMLElement>('[data-me]')!.style.width = `${hpMe}%`;
    hud.querySelector<HTMLElement>('[data-foe]')!.style.width = `${hpFoe}%`;
    att.classList.remove('punch'); who.classList.remove('hurt'); void who.offsetWidth;
    att.classList.add('punch'); who.classList.add('hurt');
    hud.querySelector<HTMLElement>('[data-combo]')!.innerHTML = streak >= 3 ? `🔥×${streak >= 5 ? 2 : 1.5}` : 'VS';
    if (hpFoe <= 0) hud.querySelector<HTMLElement>('[data-ffoe]')!.textContent = '😵';
  };
  const next = () => {
    if (i >= pool.length) return finish();
    const q = pool[i];
    stop = ask(app, box, {
      q, n: `${i + 1} / ${pool.length}`, timeLimit: q.format === 'input' ? 25 : 15,
      nextLabel: i + 1 < pool.length ? 'Следующий вопрос' : 'Итоги',
      onDone: (r) => {
        if (r.correct) {
          right++; streak++;
          const mult = streak >= 5 ? 2 : streak >= 3 ? 1.5 : 1;
          score += Math.round((100 + r.timeLeft * 4) * mult);
          hit(true, mult);
        } else { streak = 0; hit(false, 1); }
        scoreEl.textContent = `${score}`;
      },
      onNext: () => { i++; next(); },
    });
  };
  const finish = async () => {
    const value = right * RATING_PER_RIGHT;
    const got = await reportResult(app, 'ring', score, value, ctx);
    box.innerHTML = `<div class="card center col" style="gap:10px;padding:20px">
      <div style="font-size:44px">${hpFoe <= 0 ? '🏆' : hpMe <= 0 ? '🤕' : '🥊'}</div>
      <h2 style="font-size:26px">${hpFoe <= 0 ? 'Нокаут! Нигилизм повержен' : right >= 8 ? 'Чемпион ринга!' : right >= 5 ? 'Хороший бой' : 'Есть куда расти'}</h2>
      <div style="font-family:var(--head);font-size:40px;color:var(--gold2)">${score}</div>
      <div>${right} из ${pool.length} верно</div>
      <div class="row" style="justify-content:center;gap:6px">${starSvg(18)}<b>+${got} баллов</b></div>
      ${got < value ? `<div class="small muted">В зачёт идёт лучший результат дня — до ${DAILY_MINIGAME_CAP} баллов, и не больше 100 от игры в сутки.</div>` : ''}
      <button class="btn btn-gold btn-block" data-again>Ещё раунд</button>
      <button class="btn btn-ghost btn-block" data-act="exit">Выйти</button></div>`;
    $(box, '[data-again]').addEventListener('click', () => { app.closeOverlay(); openRing(app, ctx); });
    app.update(false);
  };
  onAct(node, { exit: () => { stop(); app.closeOverlay(); } });
  node.addEventListener('close', () => stop());
  app.openOverlay(node);
  next();
}

// ---------------- Тренировка ----------------
function openTrain(app: App, topic: string) {
  const s = app.state;
  const qs = app.questions.filter((q) => q.topic === topic);
  const order = [...shuffle(qs.filter((q) => !s.law.right[q.id])), ...shuffle(qs.filter((q) => s.law.right[q.id]))];
  const node = shell(esc(topic), `${qs.length} вопросов`);
  const box = $(node, '[data-box]');
  let i = 0, right = 0;
  const next = () => {
    if (i >= order.length) {
      box.innerHTML = `<div class="card center col" style="gap:10px;padding:20px"><h2>Тема пройдена</h2><div>${right} из ${order.length} верно</div>
        <button class="btn btn-gold btn-block" data-act="exit">К темам</button></div>`;
      app.update(false);
      return;
    }
    ask(app, box, { q: order[i], n: `${i + 1} / ${order.length}`, onDone: (r) => { if (r.correct) right++; }, onNext: () => { i++; next(); } });
  };
  onAct(node, { exit: () => { app.closeOverlay(); openLaw(app); } });
  app.openOverlay(node);
  next();
}

// ---------------- Карточки ----------------
function openCards(app: App, topic: string) {
  const s = app.state;
  const qs = shuffle(app.questions.filter((q) => !topic || q.topic === topic));
  const node = shell(topic ? `Карточки · ${esc(topic)}` : 'Карточки', 'Нажми на карточку, чтобы перевернуть');
  const box = $(node, '[data-box]');
  let i = 0, known = 0;
  const draw = async () => {
    if (i >= qs.length) {
      box.innerHTML = `<div class="card center col" style="gap:10px;padding:20px"><h2>Колода пройдена</h2><div>Знаю: ${known} из ${qs.length}</div><button class="btn btn-gold btn-block" data-act="exit">Готово</button></div>`;
      return;
    }
    const q = qs[i];
    const optionsHtml = q.format === 'choice' ? `<div class="small" style="color:#4a4f8a">${q.options!.map((o, k) => `${['А', 'Б', 'В', 'Г'][k]}) ${esc(o)}`).join('<br>')}</div>` : '';
    box.innerHTML = `<div class="small muted center">${i + 1} / ${qs.length}</div>
      <div class="flip" data-flip><div class="flip-in">
        <div class="flip-face front"><div class="qm small" style="color:#6a6fa8;font-weight:700">${FORMAT_LABEL[q.format]} · ${esc(q.topic)}</div><div class="qt" style="font-size:18px;font-weight:600;line-height:1.35">${esc(q.question)}</div>${optionsHtml}<div class="small" style="color:#6a6fa8">нажми, чтобы увидеть ответ</div></div>
        <div class="flip-face back"><div class="small muted">Ответ</div><div data-right style="font-family:var(--head);font-size:22px;color:var(--gold2)">…</div><div class="small" data-expl></div></div>
      </div></div>
      <div class="row" style="gap:10px"><button class="btn btn-red grow" data-again>Повторить</button><button class="btn btn-green grow" data-know>Знаю</button></div>`;
    const flip = $(box, '[data-flip]');
    let revealed = false;
    flip.addEventListener('click', async () => {
      flip.classList.toggle('on');
      haptic();
      if (!revealed) {
        revealed = true;
        const r = await app.backend.reveal(q);
        $(box, '[data-right]').textContent = r.right;
        $(box, '[data-expl]').textContent = r.explanation;
      }
    });
    $(box, '[data-know]').addEventListener('click', () => { known++; s.law.right[q.id] = (s.law.right[q.id] ?? 0) + 1; i++; draw(); app.update(false); });
    $(box, '[data-again]').addEventListener('click', () => { qs.push(q); i++; draw(); });
  };
  onAct(node, { exit: () => { app.closeOverlay(); openLaw(app); } });
  app.openOverlay(node);
  draw();
}

// ---------------- Дело дня ----------------
function openCase(app: App, q: Question) {
  const s = app.state;
  const node = shell('Дело дня', `${mskDay().split('-').reverse().slice(0, 2).join('.')} · один шанс`);
  const box = $(node, '[data-box]');
  ask(app, box, {
    q, nextLabel: 'Готово',
    onDone: async (r) => {
      s.daily.byGame['case_day'] = r.correct ? CASE_RATING : 0;
      if (r.correct) {
        const g = await app.backend.claimTask(s, 'case_day');
        if (g.granted) toast(`+${g.granted} баллов за дело дня`, 'ok');
      }
      app.update(false);
    },
    onNext: () => { app.closeOverlay(); openLaw(app); },
  });
  onAct(node, { exit: () => { app.closeOverlay(); openLaw(app); } });
  app.openOverlay(node);
}

// ---------------- Правовой поединок перед стычкой ----------------
/** 3 вопроса «да/нет». Доля верных Q даёт до +20% к силе в ближайшем раунде. */
export function openLawDuel(app: App, done: (share: number) => void) {
  const pool = shuffle(app.questions.filter((q) => q.format === 'yesno')).slice(0, 3);
  if (!pool.length) { toast('Вопросы ещё загружаются', 'info'); return; }
  let i = 0, right = 0;
  const m = modal('<div data-duel class="col" style="gap:10px"></div>', { cls: 'duel' });
  const box = $(m.root, '[data-duel]');
  const next = () => {
    if (i >= pool.length) {
      const share = right / pool.length;
      box.innerHTML = `<h2 style="font-size:24px">Поединок окончен</h2><div>${right} из ${pool.length} верно</div>
        <div class="card"><b class="gold">+${Math.round(share * 20)}% к силе</b> в ближайшем раунде стычек</div>
        <button class="btn btn-gold btn-block" data-close>К карте</button>`;
      done(share);
      return;
    }
    box.innerHTML = `<div class="small muted">Правовой поединок · ${i + 1} из ${pool.length}</div>`;
    const inner = document.createElement('div');
    inner.className = 'col';
    inner.style.gap = '10px';
    box.appendChild(inner);
    ask(app, inner, { q: pool[i], nextLabel: i + 1 < pool.length ? 'Дальше' : 'Итог', onDone: (r) => { if (r.correct) right++; }, onNext: () => { i++; next(); } });
  };
  next();
}

/** Дело дня — открыть напрямую (из списка заданий). */
export function openCaseOfDay(app: App) {
  if (!needQuestions(app)) return;
  if (app.state.daily.byGame['case_day'] !== undefined) { toast('Дело дня уже решено — новое завтра', 'info'); return; }
  const q = caseOfDay(app.questions);
  if (q) openCase(app, q);
}

/** Квиз из нескольких вопросов без таймера (задания «Что ты знаешь о профсоюзе», квиз по документам). */
export function quizFlow(app: App, title: string, pool: Question[], onDone: (right: number) => void) {
  if (!pool.length) { toast('Вопросы ещё загружаются', 'info'); return; }
  const node = shell(esc(title), `${pool.length} вопросов`);
  const box = $(node, '[data-box]');
  let i = 0, right = 0, reported = false;
  const next = () => {
    if (i >= pool.length) {
      box.innerHTML = `<div class="card center col" style="gap:10px;padding:20px"><h2>Готово</h2><div>${right} из ${pool.length} верно</div>
        <button class="btn btn-gold btn-block" data-act="exit">Вернуться</button></div>`;
      if (!reported) { reported = true; onDone(right); }
      return;
    }
    ask(app, box, { q: pool[i], n: `${i + 1} / ${pool.length}`, onDone: (r) => { if (r.correct) right++; }, onNext: () => { i++; next(); } });
  };
  onAct(node, { exit: () => app.closeOverlay() });
  app.openOverlay(node);
  next();
}
