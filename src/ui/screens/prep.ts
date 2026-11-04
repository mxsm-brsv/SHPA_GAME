// «Подготовка» — открытый для всех блок: банк вопросов, тест, свой тест, карточки, ошибки, шпаргалка и свои вопросы.
// Работает без входа и без баллов. Прогресс, свои вопросы и тесты хранятся на устройстве; тестом можно поделиться кодом.
import { icon } from '../../art/icons';
import { TOPICS_ORDER, checkLocal, rightAnswerText, shuffle, shuffledOptionOrder, type QFormat, type Question } from '../../core/questions';
import type { SharedTest } from '../../core/backend';
import { haptic } from '../../core/telegram';
import { $, el, esc, modal, onAct, toast } from '../../lib/dom';
import { openCaseOfDay, openRing } from '../../games/law';
import type { App } from '../app';
import { openContest } from './contest';

const LS = 'pbgame.prep';
const LS_MY = 'pbgame.myq';
const LS_TESTS = 'pbgame.tests';
interface Progress { right: Record<string, number>; wrong: Record<string, number> }
interface MyQ extends Question { mine: true; sent?: 'pending' | 'sent' }
const read = <T>(k: string, d: T): T => { try { const r = localStorage.getItem(k); return r ? { ...(Array.isArray(d) ? {} : d), ...JSON.parse(r) } as T : d; } catch { return d; } };
const readArr = <T>(k: string): T[] => { try { const r = JSON.parse(localStorage.getItem(k) ?? '[]'); return Array.isArray(r) ? r : []; } catch { return []; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } };
const load = (): Progress => read<Progress>(LS, { right: {}, wrong: {} });
const store = (p: Progress) => write(LS, p);
const myQs = () => readArr<MyQ>(LS_MY);
const myTests = () => readArr<SharedTest>(LS_TESTS);
const FORMAT = { yesno: 'Да или нет', choice: 'Выбери ответ', input: 'Впиши ответ' } as const;
const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];
const MY_TOPIC = 'Мои вопросы';

let bankCache: Question[] | null = null;

/** Без длинных серий одинаковых ответов «Да/Нет» подряд (не больше двух). */
export function spreadAnswers(qs: Question[]) {
  const out = [...qs];
  for (let i = 2; i < out.length; i++) {
    const a = out[i - 2], b = out[i - 1], c = out[i];
    if (c.correct !== undefined && a.format === 'yesno' && b.format === 'yesno' && c.format === 'yesno' && a.correct === b.correct && b.correct === c.correct) {
      const j = out.findIndex((q, k) => k > i && (q.format !== 'yesno' || q.correct !== c.correct));
      if (j > 0) [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

/** Темы в привычном порядке, новые — в конце. */
export function topicList(bank: Question[]) {
  const all = [...new Set(bank.map((q) => q.topic))];
  return [...TOPICS_ORDER.filter((t) => all.includes(t)), ...all.filter((t) => !TOPICS_ORDER.includes(t)).sort()];
}

/** Подготовка — вкладка нижнего меню (в игре) или полноэкранное окно (до входа). */
export function renderPrep(app: App) { return prepShell(app, true); }
export function openPrep(app: App) {
  if (app.inGame) { app.go('prep'); return; }
  prepShell(app, false);
}

function prepShell(app: App, tab: boolean) {
  const node = el(`<div class="screen ${tab ? '' : 'full'}"><div class="page">
    <div class="row">${tab ? '' : `<button class="btn btn-ghost btn-sm" data-act="exit" aria-label="Назад">${icon('back', 18)}</button>`}
      <div class="grow"><h1 style="font-size:24px">Подготовка</h1><div class="small muted">Правовой банк · тренажёры конкурса «Ты — лидер»</div></div></div>
    <div data-body class="col" style="gap:12px"><div class="muted center">Загружаю вопросы…</div></div>
  </div></div>`);
  if (!tab) { onAct(node, { exit: () => app.closeOverlay() }); app.openOverlay(node); }
  fillPrep(app, node);
  return node;
}

async function fillPrep(app: App, node: HTMLElement) {
  if (!bankCache || !bankCache.length) bankCache = await app.backend.prepBank().catch(() => []);
  const base = bankCache;
  const body = $(node, '[data-body]');
  if (!base.length) { body.innerHTML = '<div class="card muted center">Не получилось загрузить вопросы. Проверь связь и открой ещё раз.</div>'; return; }
  const all = () => [...base, ...myQs()];
  const byId = (ids: string[], extra: Question[] = []) => { const m = new Map([...all(), ...extra].map((q) => [q.id, q])); return ids.map((id) => m.get(id)).filter(Boolean) as Question[]; };

  const draw = () => {
    const p = load();
    const bank = all();
    const right = base.filter((q) => p.right[q.id]).length;
    const mistakes = bank.filter((q) => p.wrong[q.id] && !p.right[q.id]).length;
    const topics = topicList(base);
    const tests = myTests();
    const mine = myQs().length;
    const inGame = !!app.state;
    body.innerHTML = `
      <button class="contest-hero" data-act="contest"><div class="ch-l">${icon('trophy', 30, '#3a2a00')}</div><div class="grow"><b>Конкурс «Ты — лидер»</b><span>27–28 ноября · тренажёры всех этапов по Положению: аттестация, головоломки, «2 к 1», биатлон, председатели, заседание</span></div>${icon('play', 20, '#3a2a00')}</button>
      <div class="card row">${icon('book', 34, '#ffd76a')}<div class="grow"><b>${right} из ${base.length}</b> вопросов уже знаешь
        <div class="xp" style="margin-top:6px"><i style="width:${(right / base.length) * 100}%"></i></div></div></div>
      <div class="prep-grid">
        <button class="prep-tile" data-act="test"><div class="pi" style="background:#7b4fd6">${icon('target', 26, '#fff')}</div><b>Тест</b><span>10 случайных вопросов</span></button>
        <button class="prep-tile" data-act="build"><div class="pi" style="background:#b8860b">${icon('settings', 26, '#fff')}</div><b>Свой тест</b><span>темы, число, таймер</span></button>
        <button class="prep-tile" data-act="cards" data-topic=""><div class="pi" style="background:#1f7a7a">${icon('cards', 26, '#fff')}</div><b>Карточки</b><span>вопрос → ответ</span></button>
        <button class="prep-tile" data-act="mist" ${mistakes ? '' : 'disabled'}><div class="pi" style="background:#c0442f">${icon('x', 26, '#fff')}</div><b>Ошибки</b><span>${mistakes ? `${mistakes} на повтор` : 'пока нет'}</span></button>
        <button class="prep-tile" data-act="sheet"><div class="pi" style="background:#3a4f7a">${icon('list', 26, '#fff')}</div><b>Шпаргалка</b><span>поиск по ответам</span></button>
        <button class="prep-tile" data-act="myq"><div class="pi" style="background:#2f7a3a">${icon('pen', 26, '#fff')}</div><b>Мои вопросы</b><span>${mine ? `${mine} своих` : 'добавить свой'}</span></button>
      </div>
      ${inGame ? `<div class="section-h">Правовуха в игре</div>
        <div class="row" style="gap:8px"><button class="btn btn-blue grow btn-col" data-act="case">${icon('scales', 20)}<span class="sub">Дело дня · +20</span></button>
        <button class="btn btn-blue grow btn-col" data-act="ring">${icon('target', 20)}<span class="sub">Правовой ринг</span></button></div>` : '<div class="small muted center">После подготовки — вход в игру на первом экране.</div>'}
      <div class="section-h">Мои тесты</div>
      <div class="list">${tests.map((t, i) => `<div class="li"><div class="grow"><b>${esc(t.name)}</b><div class="small muted">${t.ids.length} вопр.${t.timer ? ` · ${t.timer} с на ответ` : ''}${t.code ? ` · код ${esc(t.code)}` : ''}${t.author ? ` · от ${esc(t.author)}` : ''}</div></div>
        <button class="btn btn-ghost btn-sm" data-act="tshare" data-i="${i}" aria-label="Поделиться">${icon('envelope', 16)}</button>
        <button class="btn btn-ghost btn-sm" data-act="tdel" data-i="${i}" aria-label="Удалить">${icon('x', 16)}</button>
        <button class="btn btn-blue btn-sm" data-act="trun" data-i="${i}">Пройти</button></div>`).join('') || '<div class="small muted">Собери свой тест — он сохранится здесь. Им можно поделиться кодом.</div>'}</div>
      <div class="row" style="gap:8px"><input class="input-ans grow" data-tcode placeholder="Код теста от друга" autocapitalize="characters" maxlength="10"><button class="btn btn-blue" data-act="topen">Открыть</button></div>
      <div class="section-h">По темам</div>
      <div class="list">${topics.map((t) => {
        const qs = base.filter((q) => q.topic === t);
        const ok = qs.filter((q) => p.right[q.id]).length;
        return `<div class="li"><div class="grow"><b>${esc(t)}</b><div class="small muted">${ok} / ${qs.length}</div><div class="xp" style="height:5px;margin-top:4px"><i style="width:${(ok / qs.length) * 100}%"></i></div></div>
          <button class="btn btn-ghost btn-sm" data-act="cards" data-topic="${esc(t)}" aria-label="Карточки">${icon('cards', 16)}</button>
          <button class="btn btn-blue btn-sm" data-act="topic" data-topic="${esc(t)}">Учить</button></div>`;
      }).join('')}</div>`;
  };

  const run = (title: string, qs: Question[], timer = 0) => quiz(app, title, qs, draw, timer);
  const runTest = (t: SharedTest) => {
    const qs = byId(t.ids, t.extra);
    if (!qs.length) { toast('В тесте нет вопросов', 'bad'); return; }
    run(t.name, qs, t.timer);
  };
  const shareTest = async (i: number) => {
    const tests = myTests();
    const t = tests[i];
    if (!t) return;
    if (!t.code) {
      if (app.backend.mode === 'online' && !app.state) { toast('Чтобы поделиться, войди в игру', 'info'); return; }
      const mineIds = new Set(myQs().map((q) => q.id));
      const extra = byId(t.ids).filter((q) => mineIds.has(q.id)).map(({ correct, answer, accepted, explanation, ...rest }) => ({ ...rest, correct, answer, accepted, explanation }));
      try { t.code = await app.backend.shareTest({ ...t, extra, author: app.state?.username }); } catch (e) { toast((e as Error).message, 'bad'); return; }
      write(LS_TESTS, tests);
      draw();
    }
    const text = `Тест «${t.name}» в игре ШПА: Подготовка → «Код теста» → ${t.code}`;
    try { await navigator.clipboard.writeText(text); toast(`Код ${t.code} скопирован — отправь другу`, 'ok'); } catch { toast(`Код теста: ${t.code}`, 'info'); }
    if (app.backend.mode === 'demo') toast('В демо код работает только на этом устройстве', 'info');
  };

  onAct(body, {
    test: () => run('Тест', spreadAnswers(shuffle(base).slice(0, 10))),
    build: () => builder(app, all(), base, draw, (t, start) => { if (start) runTest(t); }),
    mist: () => { const p = load(); run('Работа над ошибками', shuffle(all().filter((q) => p.wrong[q.id] && !p.right[q.id]))); },
    topic: (t) => { const p = load(); const qs = base.filter((q) => q.topic === t.dataset.topic); run(t.dataset.topic!, spreadAnswers([...shuffle(qs.filter((q) => !p.right[q.id])), ...shuffle(qs.filter((q) => p.right[q.id]))])); },
    cards: (t) => cards(app, t.dataset.topic || '', all().filter((q) => !t.dataset.topic || q.topic === t.dataset.topic), draw),
    sheet: () => sheet(app, all()),
    myq: () => myQuestions(app, topicList(base), draw),
    trun: (t) => { const x = myTests()[Number(t.dataset.i)]; if (x) runTest(x); },
    tdel: (t) => { const tests = myTests(); tests.splice(Number(t.dataset.i), 1); write(LS_TESTS, tests); draw(); },
    tshare: (t) => shareTest(Number(t.dataset.i)),
    topen: async () => {
      const code = ($(body, '[data-tcode]') as HTMLInputElement).value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 4) { toast('Введи код теста', 'bad'); return; }
      const t = await app.backend.loadTest(code).catch(() => null);
      if (!t) { toast('Тест с таким кодом не найден', 'bad'); return; }
      const tests = myTests();
      if (!tests.some((x) => x.code === t.code)) { tests.unshift({ ...t, code }); write(LS_TESTS, tests.slice(0, 30)); }
      haptic('ok'); draw(); runTest(t);
    },
    contest: () => openContest(app, all()),
    case: () => { app.closeOverlay(); openCaseOfDay(app); },
    ring: () => { app.closeOverlay(); openRing(app); },
  });
  draw();
}

function sub(app: App, title: string, onBack: () => void) {
  const node = el(`<div class="screen full" style="z-index:35"><div class="quiz">
    <div class="row"><button class="btn btn-ghost btn-sm" data-back aria-label="Назад">${icon('back', 18)}</button>
      <div class="grow"><div style="font-family:var(--head);font-size:18px">${esc(title)}</div><div class="small muted" data-sub></div></div>
      <div data-score style="font-family:var(--head);color:var(--gold2)"></div></div>
    <div class="col" data-box style="gap:12px"></div></div></div>`);
  const close = () => { node.dispatchEvent(new CustomEvent('close')); node.remove(); onBack(); };
  $(node, '[data-back]').addEventListener('click', close);
  (app.overlay ?? app.root).appendChild(node);
  return { node, box: $(node, '[data-box]'), close, setSub: (t: string) => { $(node, '[data-sub]').textContent = t; }, setScore: (t: string) => { $(node, '[data-score]').textContent = t; } };
}

function quiz(app: App, title: string, qs: Question[], after: () => void, timer = 0) {
  if (!qs.length) { toast('Здесь пока нет вопросов', 'info'); return; }
  const v = sub(app, title, after);
  let i = 0, right = 0, tick = 0;
  const stop = () => { clearInterval(tick); tick = 0; };
  v.node.addEventListener('close', stop);
  const next = () => {
    stop();
    if (i >= qs.length) {
      v.box.innerHTML = `<div class="card center col" style="gap:10px;padding:20px"><h2 style="font-size:26px">${right} из ${qs.length}</h2>
        <div class="muted">${right === qs.length ? 'Идеально!' : right >= qs.length * 0.7 ? 'Отлично, почти всё' : 'Ошибки попали в «Работу над ошибками»'}</div>
        <button class="btn btn-gold btn-block" data-again>Ещё раз</button></div>`;
      $(v.box, '[data-again]').addEventListener('click', () => { v.node.remove(); quiz(app, title, spreadAnswers(shuffle(qs)), after, timer); });
      return;
    }
    const q = qs[i];
    v.setSub(`${i + 1} / ${qs.length}`);
    v.setScore(`${right}`);
    const order = q.format === 'choice' ? shuffledOptionOrder(q) : [];
    v.box.innerHTML = `<div class="qcard"><div class="qm">${FORMAT[q.format]} · ${esc(q.topic)}</div><div class="qt">${esc(q.question)}</div></div>
      ${timer ? '<div class="ring-bar"><i data-tl style="width:100%"></i></div>' : ''}
      <div data-ans>${q.format === 'yesno' ? '<div class="yn"><button class="ans" data-v="true">Да</button><button class="ans" data-v="false">Нет</button></div>'
        : q.format === 'choice' ? `<div class="answers">${order.map((oi, k) => `<button class="ans" data-v="${oi}"><b>${LETTERS[k]})</b> ${esc(q.options![oi])}</button>`).join('')}</div>`
        : '<div class="col"><input class="input-ans" data-in placeholder="Твой ответ" autocomplete="off"><button class="btn btn-gold btn-block" data-send>Ответить</button><button class="btn btn-ghost btn-sm" data-skip>Не знаю — показать ответ</button></div>'}</div>
      <div data-after></div>`;
    let done = false;
    const answer = (given: string | number | boolean, btn?: HTMLElement) => {
      if (done) return;
      done = true;
      stop();
      const r = checkLocal(q, given);
      const p = load();
      (r.correct ? p.right : p.wrong)[q.id] = ((r.correct ? p.right : p.wrong)[q.id] ?? 0) + 1;
      store(p);
      if (r.correct) right++;
      haptic(r.correct ? 'ok' : 'bad');
      v.box.querySelectorAll<HTMLButtonElement>('.ans,[data-send],[data-skip]').forEach((b) => (b.disabled = true));
      btn?.classList.add(r.correct ? 'ok' : 'no');
      v.box.querySelectorAll<HTMLElement>('.ans').forEach((b) => {
        const val = b.dataset.v!;
        if ((q.format === 'yesno' && (val === 'true') === q.correct) || (q.format === 'choice' && Number(val) === q.correct)) b.classList.add('ok');
      });
      $(v.box, '[data-after]').innerHTML = `<div class="explain"><div style="font-family:var(--head);font-size:17px;margin-bottom:4px;color:${r.correct ? '#6dffb0' : '#ff8a8a'}">${r.correct ? 'Верно!' : given === '⏱' ? 'Время вышло' : 'Неверно'}</div>
        ${!r.correct ? `<div>Правильный ответ: <b>${esc(r.right)}</b></div>` : ''}
        ${r.explanation ? `<div class="small" style="margin-top:6px">${esc(r.explanation)}</div>` : ''}${q.source ? `<div class="small muted" style="margin-top:4px">Источник: ${esc(q.source)}</div>` : ''}</div>
        <button class="btn btn-gold btn-block" data-next style="margin-top:10px">${i + 1 < qs.length ? 'Дальше' : 'Итоги'}</button>`;
      $(v.box, '[data-next]').addEventListener('click', () => { i++; next(); });
      v.setScore(`${right}`);
    };
    v.box.querySelectorAll<HTMLElement>('.ans').forEach((b) => b.addEventListener('click', () => answer(q.format === 'yesno' ? b.dataset.v === 'true' : Number(b.dataset.v), b)));
    const inp = v.box.querySelector<HTMLInputElement>('[data-in]');
    if (inp) {
      const send = () => { if (inp.value.trim()) answer(inp.value.trim()); };
      $(v.box, '[data-send]').addEventListener('click', send);
      $(v.box, '[data-skip]').addEventListener('click', () => answer('—'));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    }
    if (timer) {
      const end = Date.now() + timer * 1000;
      const bar = v.box.querySelector<HTMLElement>('[data-tl]');
      tick = window.setInterval(() => {
        const left = end - Date.now();
        if (bar) bar.style.width = `${Math.max(0, left / (timer * 1000)) * 100}%`;
        if (left <= 0) answer('⏱');
      }, 200);
    }
  };
  next();
}

function cards(app: App, topic: string, list: Question[], after: () => void) {
  const qs = shuffle(list);
  if (!qs.length) { toast('Здесь пока нет вопросов', 'info'); return; }
  const v = sub(app, topic ? `Карточки · ${topic}` : 'Карточки', after);
  let i = 0, known = 0;
  const draw = () => {
    if (i >= qs.length) { v.box.innerHTML = `<div class="card center col" style="gap:10px;padding:20px"><h2>Колода пройдена</h2><div>Знаю: ${known} из ${qs.length}</div></div>`; return; }
    const q = qs[i];
    v.setSub(`${i + 1} / ${qs.length}`);
    const opts = q.format === 'choice' ? `<div class="small" style="color:#4a4f8a">${shuffledOptionOrder(q).map((oi, k) => `${LETTERS[k]}) ${esc(q.options![oi])}`).join('<br>')}</div>` : '';
    v.box.innerHTML = `<div class="flip" data-flip><div class="flip-in">
        <div class="flip-face front"><div class="small" style="color:#6a6fa8;font-weight:700">${FORMAT[q.format]} · ${esc(q.topic)}</div><div style="font-size:18px;font-weight:600;line-height:1.35">${esc(q.question)}</div>${opts}<div class="small" style="color:#6a6fa8">нажми, чтобы перевернуть</div></div>
        <div class="flip-face back"><div class="small muted">Ответ</div><div style="font-family:var(--head);font-size:22px;color:var(--gold2)">${esc(rightAnswerText(q))}</div><div class="small">${esc(q.explanation ?? '')}</div></div>
      </div></div>
      <div class="row" style="gap:10px"><button class="btn btn-red grow" data-again>Повторить</button><button class="btn btn-green grow" data-know>Знаю</button></div>`;
    const flip = $(v.box, '[data-flip]');
    flip.addEventListener('click', () => { flip.classList.toggle('on'); haptic(); });
    $(v.box, '[data-know]').addEventListener('click', () => { known++; const p = load(); p.right[q.id] = (p.right[q.id] ?? 0) + 1; store(p); i++; draw(); });
    $(v.box, '[data-again]').addEventListener('click', () => { qs.push(q); i++; draw(); });
  };
  draw();
}

function sheet(app: App, bank: Question[]) {
  const v = sub(app, 'Шпаргалка', () => {});
  v.setSub('Все вопросы с ответами и нормами');
  v.box.innerHTML = `<input class="input-ans" data-q placeholder="Поиск: стипендия, общежитие, отпуск…" autocomplete="off"><div class="list" data-list></div>`;
  const list = $(v.box, '[data-list]');
  const render = (term: string) => {
    const t = term.trim().toLowerCase().replace(/ё/g, 'е');
    const rows = bank.filter((q) => !t || `${q.question} ${q.explanation ?? ''} ${q.topic} ${rightAnswerText(q)}`.toLowerCase().replace(/ё/g, 'е').includes(t)).slice(0, 60);
    list.innerHTML = rows.map((q) => `<div class="li" style="display:block"><div class="small muted">${esc(q.topic)}</div>
      <div style="font-weight:600;margin:3px 0">${esc(q.question)}</div><div class="gold" style="font-weight:700">${esc(rightAnswerText(q))}</div>
      <div class="small muted" style="margin-top:3px">${esc(q.explanation ?? '')}</div></div>`).join('') || '<div class="muted center">Ничего не нашли</div>';
  };
  const inp = $(v.box, '[data-q]') as HTMLInputElement;
  inp.addEventListener('input', () => render(inp.value));
  render('');
}

// ---------- Свой тест ----------
function builder(app: App, bank: Question[], base: Question[], after: () => void, onSaved: (t: SharedTest, start: boolean) => void) {
  const v = sub(app, 'Свой тест', after);
  const topics = topicList(base);
  const hasMine = myQs().length > 0;
  const sel = { topics: new Set<string>(), formats: new Set<QFormat>(['yesno', 'choice', 'input']), levels: new Set<number>([1, 2, 3]), n: 15, timer: 0, unknown: false, mine: hasMine };
  let picked: Question[] = [];
  const pool = () => {
    const p = load();
    return bank.filter((q) => (q.topic !== MY_TOPIC || sel.mine) && (!sel.topics.size || sel.topics.has(q.topic) || (sel.mine && q.topic === MY_TOPIC))
      && sel.formats.has(q.format) && sel.levels.has(Math.max(1, Math.min(3, q.level || 1))) && (!sel.unknown || !p.right[q.id]));
  };
  const chip = (on: boolean, act: string, val: string, label: string) => `<button class="chip ${on ? 'on' : ''}" data-b="${act}" data-v="${esc(val)}">${esc(label)}</button>`;
  const draw = () => {
    const n = pool().length;
    v.setSub(`Подходит вопросов: ${n}`);
    v.box.innerHTML = `<input class="input-ans" data-name placeholder="Название теста" value="${esc(($(v.box, '[data-name]') as HTMLInputElement | null)?.value ?? '')}" maxlength="60">
      <div class="section-h">Темы <span class="small muted">(не выбрано — все)</span></div>
      <div class="chips wrap">${topics.map((t) => chip(sel.topics.has(t), 'topic', t, t)).join('')}${hasMine ? chip(sel.mine, 'mine', '1', `★ ${MY_TOPIC}`) : ''}</div>
      <div class="section-h">Формат</div>
      <div class="chips wrap">${(['yesno', 'choice', 'input'] as QFormat[]).map((f) => chip(sel.formats.has(f), 'fmt', f, FORMAT[f])).join('')}</div>
      <div class="section-h">Сложность</div>
      <div class="chips wrap">${[1, 2, 3].map((l) => chip(sel.levels.has(l), 'lvl', String(l), ['Лёгкие', 'Средние', 'Сложные'][l - 1])).join('')}${chip(sel.unknown, 'unk', '1', 'Только те, что ещё не знаю')}</div>
      <div class="mgrid"><label>Вопросов<select class="input-ans" data-n>${[5, 10, 15, 20, 30, 50].map((x) => `<option ${x === sel.n ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Таймер на ответ<select class="input-ans" data-timer>${[[0, 'без таймера'], [20, '20 с'], [30, '30 с'], [60, '60 с']].map(([x, l]) => `<option value="${x}" ${x === sel.timer ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <button class="btn btn-blue btn-block" data-pick ${n ? '' : 'disabled'}>Собрать ${Math.min(sel.n, n)} вопросов</button>
      <div data-picked class="col" style="gap:8px"></div>`;
    v.box.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.b!, val = b.dataset.v!;
      const tog = <T>(set: Set<T>, x: T, keep = false) => { if (set.has(x)) { if (!keep || set.size > 1) set.delete(x); } else set.add(x); };
      if (k === 'topic') tog(sel.topics, val);
      if (k === 'fmt') tog(sel.formats, val as QFormat, true);
      if (k === 'lvl') tog(sel.levels, Number(val), true);
      if (k === 'unk') sel.unknown = !sel.unknown;
      if (k === 'mine') sel.mine = !sel.mine;
      draw();
    }));
    ($(v.box, '[data-n]') as HTMLSelectElement).addEventListener('change', (e) => { sel.n = Number((e.target as HTMLSelectElement).value); draw(); });
    ($(v.box, '[data-timer]') as HTMLSelectElement).addEventListener('change', (e) => { sel.timer = Number((e.target as HTMLSelectElement).value); });
    $(v.box, '[data-pick]').addEventListener('click', () => { picked = spreadAnswers(shuffle(pool()).slice(0, sel.n)); drawPicked(); });
    if (picked.length) drawPicked();
  };
  const drawPicked = () => {
    const box = $(v.box, '[data-picked]');
    box.innerHTML = `<div class="section-h">В тесте: ${picked.length}</div>
      <div class="list">${picked.map((q, i) => `<div class="li"><div class="grow small">${esc(q.question.slice(0, 140))}${q.question.length > 140 ? '…' : ''}<div class="muted">${esc(q.topic)} · ${FORMAT[q.format]}</div></div>
        <button class="btn btn-ghost btn-sm" data-swap="${i}" aria-label="Заменить">${icon('sparkle', 14)}</button><button class="btn btn-ghost btn-sm" data-rm="${i}" aria-label="Убрать">${icon('x', 14)}</button></div>`).join('')}</div>
      <input class="input-ans" data-find placeholder="Добавить вопрос: поиск по банку" autocomplete="off"><div class="list" data-found></div>
      <div class="row" style="gap:8px"><button class="btn btn-gold grow" data-start ${picked.length ? '' : 'disabled'}>Начать</button><button class="btn btn-blue grow" data-save ${picked.length ? '' : 'disabled'}>Сохранить</button></div>`;
    box.querySelectorAll<HTMLElement>('[data-rm]').forEach((b) => b.addEventListener('click', () => { picked.splice(Number(b.dataset.rm), 1); drawPicked(); }));
    box.querySelectorAll<HTMLElement>('[data-swap]').forEach((b) => b.addEventListener('click', () => {
      const ids = new Set(picked.map((q) => q.id));
      const cand = shuffle(pool().filter((q) => !ids.has(q.id)))[0];
      if (!cand) { toast('Больше подходящих вопросов нет', 'info'); return; }
      picked[Number(b.dataset.swap)] = cand; drawPicked();
    }));
    const find = $(box, '[data-find]') as HTMLInputElement;
    find.addEventListener('input', () => {
      const t = find.value.trim().toLowerCase().replace(/ё/g, 'е');
      const ids = new Set(picked.map((q) => q.id));
      const rows = t.length < 3 ? [] : bank.filter((q) => !ids.has(q.id) && `${q.question} ${q.topic}`.toLowerCase().replace(/ё/g, 'е').includes(t)).slice(0, 8);
      $(box, '[data-found]').innerHTML = rows.map((q) => `<button class="li" data-add="${esc(q.id)}" style="text-align:left"><span class="grow small">${esc(q.question.slice(0, 120))}</span>${icon('plus', 14)}</button>`).join('');
      box.querySelectorAll<HTMLElement>('[data-add]').forEach((b) => b.addEventListener('click', () => { const q = bank.find((x) => x.id === b.dataset.add); if (q) { picked.push(q); drawPicked(); } }));
    });
    const save = (start: boolean) => {
      const name = (($(v.box, '[data-name]') as HTMLInputElement).value.trim() || `Тест на ${picked.length}`).slice(0, 60);
      const t: SharedTest = { name, ids: picked.map((q) => q.id), extra: [], timer: sel.timer, created: Date.now(), author: app.state?.username };
      const tests = myTests();
      tests.unshift(t);
      write(LS_TESTS, tests.slice(0, 30));
      v.close();
      toast(`Тест «${name}» сохранён в «Мои тесты»`, 'ok');
      onSaved(t, start);
    };
    $(box, '[data-start]').addEventListener('click', () => save(true));
    $(box, '[data-save]').addEventListener('click', () => save(false));
  };
  draw();
}

// ---------- Мои вопросы ----------
function myQuestions(app: App, topics: string[], after: () => void) {
  const v = sub(app, 'Мои вопросы', after);
  v.setSub('Видны только тебе. Хорошим вопросом можно поделиться с банком');
  const draw = () => {
    const list = myQs();
    v.box.innerHTML = `<button class="btn btn-gold btn-block" data-new>${icon('plus', 18)} Новый вопрос</button>
      ${list.length ? `<button class="btn btn-blue btn-block" data-run>Пройти свои вопросы (${list.length})</button>` : ''}
      <div class="list">${list.map((q, i) => `<div class="li" style="display:block"><div class="small muted">${esc(q.topic)} · ${FORMAT[q.format]}${q.sent ? ' · <span class="gold">отправлен в банк</span>' : ''}</div>
        <div style="font-weight:600;margin:3px 0">${esc(q.question)}</div><div class="gold small">Ответ: ${esc(rightAnswerText(q))}</div>
        <div class="row" style="gap:6px;margin-top:6px"><button class="btn btn-ghost btn-sm" data-edit="${i}">Изменить</button><button class="btn btn-ghost btn-sm" data-del="${i}">Удалить</button>
          ${q.sent ? '' : `<button class="btn btn-blue btn-sm grow" data-send="${i}">Предложить в общий банк</button>`}</div></div>`).join('') || '<div class="small muted center">Пока пусто. Добавь вопрос по норме, которую хочешь запомнить, — он попадёт в тесты и карточки.</div>'}</div>`;
    $(v.box, '[data-new]').addEventListener('click', () => editQ(app, topics, null, draw));
    v.box.querySelector('[data-run]')?.addEventListener('click', () => quiz(app, 'Мои вопросы', shuffle(myQs()), draw));
    v.box.querySelectorAll<HTMLElement>('[data-edit]').forEach((b) => b.addEventListener('click', () => editQ(app, topics, Number(b.dataset.edit), draw)));
    v.box.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => b.addEventListener('click', () => { const l = myQs(); l.splice(Number(b.dataset.del), 1); write(LS_MY, l); draw(); }));
    v.box.querySelectorAll<HTMLElement>('[data-send]').forEach((b) => b.addEventListener('click', async () => {
      const l = myQs();
      const q = l[Number(b.dataset.send)];
      if (!q) return;
      if (app.backend.mode === 'online' && !app.state) { toast('Чтобы предложить вопрос, войди в игру', 'info'); return; }
      try {
        const msg = await app.backend.suggestQuestion(app.state ?? null, { ...q, topic: q.topic === MY_TOPIC ? topics[0] : q.topic });
        q.sent = 'sent'; write(LS_MY, l); toast(msg, 'ok'); draw();
      } catch (e) { toast((e as Error).message, 'bad'); }
    }));
  };
  draw();
}

function editQ(app: App, topics: string[], idx: number | null, after: () => void) {
  void app;
  const list = myQs();
  const q: Partial<MyQ> = idx !== null ? list[idx] : { format: 'choice', topic: MY_TOPIC, options: ['', '', '', ''], correct: 0 };
  let fmt: QFormat = q.format ?? 'choice';
  const m = modal(`<h2 style="font-size:20px">${idx !== null ? 'Изменить вопрос' : 'Новый вопрос'}</h2>
    <div class="chips" data-fmt style="margin:8px 0">${(['choice', 'yesno', 'input'] as QFormat[]).map((f) => `<button class="chip ${f === fmt ? 'on' : ''}" data-f="${f}">${FORMAT[f]}</button>`).join('')}</div>
    <textarea class="textarea" data-q placeholder="Текст вопроса" maxlength="500" style="min-height:70px">${esc(q.question ?? '')}</textarea>
    <div data-ans style="margin-top:8px"></div>
    <input class="input-ans" data-ex placeholder="Норма или пояснение (необязательно), например ч. 5 ст. 58 273-ФЗ" maxlength="400" value="${esc(q.explanation ?? '')}" style="margin-top:8px">
    <select class="input-ans" data-topic style="margin-top:8px"><option>${MY_TOPIC}</option>${topics.map((t) => `<option ${t === q.topic ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <button class="btn btn-gold btn-block" data-ok style="margin-top:10px">Сохранить</button>`);
  const ans = $(m.root, '[data-ans]');
  const drawAns = () => {
    if (fmt === 'choice') {
      const opts = q.options && q.options.length >= 2 ? q.options : ['', '', '', ''];
      ans.innerHTML = `<div class="small muted">Варианты (2–6), отметь верный</div>${[0, 1, 2, 3, 4, 5].map((i) => `<label class="row" style="gap:6px;margin-top:4px"><input type="radio" name="cor" value="${i}" ${q.correct === i ? 'checked' : ''}><input class="input-ans grow" data-o="${i}" style="height:40px" maxlength="200" value="${esc(opts[i] ?? '')}" placeholder="Вариант ${LETTERS[i]}"></label>`).join('')}`;
    } else if (fmt === 'yesno') {
      ans.innerHTML = `<div class="small muted">Верный ответ</div><div class="chips"><label class="chip"><input type="radio" name="yn" value="1" ${q.correct !== false ? 'checked' : ''}> Да</label><label class="chip"><input type="radio" name="yn" value="0" ${q.correct === false ? 'checked' : ''}> Нет</label></div>`;
    } else {
      ans.innerHTML = `<input class="input-ans" data-a placeholder="Правильный ответ" maxlength="100" value="${esc(q.answer ?? '')}"><input class="input-ans" data-acc placeholder="Тоже верно (через запятую), необязательно" maxlength="300" value="${esc((q.accepted ?? []).join(', '))}" style="margin-top:6px">`;
    }
  };
  drawAns();
  m.root.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => b.addEventListener('click', () => {
    fmt = b.dataset.f as QFormat;
    m.root.querySelectorAll<HTMLElement>('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
    drawAns();
  }));
  $(m.root, '[data-ok]').addEventListener('click', () => {
    const text = ($(m.root, '[data-q]') as HTMLTextAreaElement).value.trim();
    if (text.length < 10) { toast('Вопрос слишком короткий', 'bad'); return; }
    const out: MyQ = { id: q.id ?? `my_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, mine: true, format: fmt, topic: ($(m.root, '[data-topic]') as HTMLSelectElement).value,
      level: 2, question: text, source: 'Свой вопрос', explanation: ($(m.root, '[data-ex]') as HTMLInputElement).value.trim() || undefined };
    if (fmt === 'choice') {
      const raw = [0, 1, 2, 3, 4, 5].map((i) => (m.root.querySelector<HTMLInputElement>(`[data-o="${i}"]`)?.value ?? '').trim());
      const cor = Number(m.root.querySelector<HTMLInputElement>('input[name="cor"]:checked')?.value ?? -1);
      if (cor < 0 || !raw[cor]) { toast('Отметь верный вариант (и заполни его)', 'bad'); return; }
      const opts = raw.filter(Boolean);
      if (opts.length < 2) { toast('Нужно хотя бы 2 варианта', 'bad'); return; }
      if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) { toast('Варианты повторяются', 'bad'); return; }
      out.options = opts;
      out.correct = opts.indexOf(raw[cor]);
    } else if (fmt === 'yesno') {
      out.correct = (m.root.querySelector<HTMLInputElement>('input[name="yn"]:checked')?.value ?? '1') === '1';
    } else {
      const a = ($(m.root, '[data-a]') as HTMLInputElement).value.trim();
      if (!a) { toast('Напиши правильный ответ', 'bad'); return; }
      out.answer = a;
      out.accepted = ($(m.root, '[data-acc]') as HTMLInputElement).value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    }
    const l = myQs();
    if (idx !== null) l[idx] = out; else l.unshift(out);
    write(LS_MY, l.slice(0, 300));
    m.close();
    toast('Сохранено', 'ok');
    after();
  });
}
