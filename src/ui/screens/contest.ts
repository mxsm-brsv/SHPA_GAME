// Тренажёры конкурса «Ты — лидер» по Положению: все 7 испытаний. Работают без сервера — на банке «Подготовки».
// Проф-аттестация, Головоломки, «2 к 1» (Профбатл), Правовой биатлон, Конкурс председателей (тексты со ставкой «+1»),
// Заседание профбюро с шаблоном протокола, репетиции «Визитной карточки» и «Приёмной кампании», «Командность» (через «Объясни»).
import {
  ABBRS, ADMISSION_EXPERTS, ADMISSION_JURY, ADMISSION_LETTER, AGENDA, CARD_CHECKLIST, CARD_CRITERIA, MEETING_CRITERIA, MEETING_FLOW,
  ODDS, REBUSES, STAGES, type Stage,
} from '../../config/contest';
import { CROSS_WORDS } from '../../config/words';
import { icon } from '../../art/icons';
import { checkLocal, normalize, rightAnswerText, shuffle, shuffledOptionOrder, type Question } from '../../core/questions';
import { haptic } from '../../core/telegram';
import { $, el, esc, modal, toast } from '../../lib/dom';
import { openAlias } from '../../games/party';
import type { App } from '../app';

const LETTERS = ['1', '2', '3', '4', '5'];
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const pick = <T>(a: T[], n: number) => shuffle(a).slice(0, n);

/** Экран поверх хаба: назад закрывает только его. */
function sub(host: HTMLElement, title: string, onClose?: () => void) {
  const node = el(`<div class="screen full" style="z-index:36"><div class="quiz">
    <div class="row"><button class="btn btn-ghost btn-sm" data-back aria-label="Назад">${icon('back', 18)}</button>
      <div class="grow"><div style="font-family:var(--head);font-size:18px">${esc(title)}</div><div class="small muted" data-sub></div></div>
      <div data-score style="font-family:var(--head);color:var(--gold2);font-size:20px"></div></div>
    <div class="col" data-box style="gap:12px"></div></div></div>`);
  const timers: number[] = [];
  const close = () => { timers.forEach((t) => clearInterval(t)); node.remove(); onClose?.(); };
  $(node, '[data-back]').addEventListener('click', close);
  host.appendChild(node);
  return {
    node, box: $(node, '[data-box]'), close,
    setSub: (t: string) => { $(node, '[data-sub]').textContent = t; },
    setScore: (t: string) => { $(node, '[data-score]').textContent = t; },
    /** Таймер обратного отсчёта (секунды), возвращает «стоп». */
    countdown(sec: number, onTick: (left: number) => void, onEnd: () => void) {
      const end = Date.now() + sec * 1000;
      const id = window.setInterval(() => { const left = (end - Date.now()) / 1000; onTick(left); if (left <= 0) { clearInterval(id); onEnd(); } }, 100);
      timers.push(id);
      onTick(sec);
      return () => clearInterval(id);
    },
  };
}

// ---------- Отбор вопросов ----------
const isCase = (q: Question) => q.format === 'choice' && (q.question.length > 110 || /студент|обучающ|первокурсник|член профсоюза/i.test(q.question.slice(0, 40)));
const isNumberQ = (q: Question) => q.format === 'input' && /^\d+$/.test((q.answer ?? '').trim());
/** Норма-цитата из объяснения: ссылка + текст в кавычках. */
function quoteOf(q: Question): { ref: string; text: string } | null {
  const ex = q.explanation ?? '';
  const m = ex.match(/^(?:Да|Нет|[^—]{0,40})\s*—\s*(?:в норме[^.]*\.\s*)?(.{6,160}?):\s*«(.{80,700})»\s*$/s);
  if (!m) return null;
  return { ref: m[1].replace(/^[Пп]\. |^[Чч]\. /, (x) => x), text: m[2].replace(/\.?»?$/, '.') };
}

// ---------- Хаб ----------
export function openContest(app: App, bank: Question[]) {
  const node = el(`<div class="screen full"><div class="page">
    <div class="row"><button class="btn btn-ghost btn-sm" data-x aria-label="Назад">${icon('back', 18)}</button>
      <div class="grow"><h1 style="font-size:22px">«Ты — лидер»</h1><div class="small muted">Конкурс на лучшее профбюро МЭИ · 27–28 ноября · ДК МЭИ</div></div></div>
    <div class="howto small">Команда — 5 человек, капитан — председатель профбюро. Здесь тренажёры <b>всех испытаний</b> по Положению: правила, таймеры и задания в том же формате. Баллы игры за них не начисляются — это тренировка.</div>
    ${STAGES.map((st) => stageCard(st)).join('')}
  </div></div>`);
  const host = app.overlay ?? null;
  const close = () => { if (host) node.remove(); else app.closeOverlay(); };
  $(node, '[data-x]').addEventListener('click', close);
  if (host) { node.style.zIndex = '35'; host.appendChild(node); } else app.openOverlay(node);
  node.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-run]');
    if (!b) return;
    haptic();
    const run = b.dataset.run!;
    const T: Record<string, () => void> = {
      attest: () => attestation(node, bank),
      puzzles: () => puzzles(node, bank),
      twoone: () => twoOne(node, bank),
      biathlon: () => biathlon(node, bank),
      chairs: () => chairs(node, bank),
      meeting: () => meeting(node),
      card: () => rehearsal(node, 'card'),
      admission: () => rehearsal(node, 'admission'),
      team: () => openAlias(app, undefined, { contest: true }),
    };
    T[run]?.();
  });
}

function stageCard(st: Stage) {
  const runs: Record<string, [string, string][]> = {
    card: [['card', 'Репетиция с таймером']],
    battle: [['attest', 'Проф-аттестация'], ['puzzles', 'Головоломки'], ['twoone', '«2 к 1»']],
    biathlon: [['biathlon', 'Биатлон']],
    meeting: [['meeting', 'Заседание + протокол']],
    team: [['team', 'Объяснялка «Командность»']],
    chairs: [['chairs', 'Тексты со ставкой']],
    admission: [['admission', 'Репетиция и письмо']],
  };
  return `<div class="card col st-card" style="gap:8px;--sc:${st.color}">
    <div class="row" style="gap:10px"><div class="st-n">${st.n}</div><div class="grow"><b style="font-size:16px">${esc(st.name)}</b><div class="small muted">${esc(st.who)}</div></div>${icon(st.icon, 24, st.color)}</div>
    <div class="small">${esc(st.format)}</div>
    <details class="faq"><summary>Правила по Положению</summary><div class="small"><b>Цель.</b> ${esc(st.goal)}<ul class="guide-ol">${st.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><b>Оценка.</b> ${esc(st.scoring)}</div></details>
    <div class="row" style="gap:8px;flex-wrap:wrap">${runs[st.id].map(([k, n]) => `<button class="btn btn-gold btn-sm grow" data-run="${k}">${icon('play', 14)} ${n}</button>`).join('')}</div>
  </div>`;
}

// ---------- Общий рендер вопроса ----------
function answerUi(q: Question, order: number[]) {
  if (q.format === 'yesno') return '<div class="yn"><button class="ans" data-v="true">Да</button><button class="ans" data-v="false">Нет</button></div>';
  if (q.format === 'choice') return `<div class="answers">${order.map((oi, k) => `<button class="ans" data-v="${oi}"><b>${LETTERS[k]})</b> ${esc(q.options![oi])}</button>`).join('')}</div>`;
  return '<div class="col"><input class="input-ans" data-in placeholder="Ответ" autocomplete="off"><button class="btn btn-gold btn-block" data-send>Ответить</button></div>';
}
function bindAnswer(box: HTMLElement, q: Question, cb: (given: string | number | boolean) => void) {
  box.querySelectorAll<HTMLElement>('.ans').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.v!;
    cb(q.format === 'yesno' ? v === 'true' : Number(v));
  }));
  const inp = box.querySelector<HTMLInputElement>('[data-in]');
  if (inp) {
    const send = () => { if (inp.value.trim()) cb(inp.value.trim()); };
    box.querySelector('[data-send]')!.addEventListener('click', send);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    setTimeout(() => inp.focus(), 50);
  }
}
function markAnswers(box: HTMLElement, q: Question, given: string | number | boolean | null) {
  box.querySelectorAll<HTMLButtonElement>('.ans').forEach((b) => {
    const v = q.format === 'yesno' ? b.dataset.v === 'true' : Number(b.dataset.v);
    b.disabled = true;
    if (v === q.correct) b.classList.add('ok'); else if (given !== null && v === given) b.classList.add('no');
  });
  const inp = box.querySelector<HTMLInputElement>('[data-in]');
  if (inp) inp.disabled = true;
}

// ---------- 1. Проф-аттестация ----------
function attestation(host: HTMLElement, bank: Question[]) {
  const v = sub(host, 'Проф-аттестация');
  v.box.innerHTML = `<div class="howto small">Как на конкурсе: вопросы с выбором ответа, открытые вопросы и кейсы. За ошибки баллы не снимаются. Без подсказок и телефонов — честно 🙂 Рейтинг команды на конкурсе — средний балл участников.</div>
    <button class="btn btn-gold btn-block" data-len="40" data-min="60">Как на конкурсе: 40 вопросов · 60 минут</button>
    <button class="btn btn-blue btn-block" data-len="15" data-min="20">Короткая: 15 вопросов · 20 минут</button>`;
  v.box.querySelectorAll<HTMLElement>('[data-len]').forEach((b) => b.addEventListener('click', () => start(Number(b.dataset.len), Number(b.dataset.min))));
  function start(n: number, min: number) {
    const cases = shuffle(bank.filter(isCase));
    const choice = shuffle(bank.filter((q) => q.format === 'choice' && !isCase(q)));
    const open = shuffle(bank.filter((q) => q.format === 'input'));
    const qs = shuffle([...cases.slice(0, Math.round(n * 0.3)), ...open.slice(0, Math.round(n * 0.25)), ...choice]).slice(0, n);
    const kinds = qs.map((q) => (isCase(q) ? 'кейс' : q.format === 'input' ? 'открытый' : 'выбор'));
    const orders = qs.map((q) => (q.format === 'choice' ? shuffledOptionOrder(q) : []));
    const given: (string | number | null)[] = qs.map(() => null);
    let i = 0, finished = false;
    const stop = v.countdown(min * 60, (left) => { v.setScore(mmss(left)); }, () => { if (!finished) { toast('Время вышло', 'info'); finish(); } });
    const draw = () => {
      const q = qs[i];
      v.setSub(`Вопрос ${i + 1} из ${qs.length} · ответов ${given.filter((x) => x !== null).length}`);
      v.box.innerHTML = `<div class="att-grid">${qs.map((_, k) => `<button class="att-n ${k === i ? 'cur' : ''} ${given[k] !== null ? 'done' : ''}" data-go="${k}">${k + 1}</button>`).join('')}</div>
        <div class="qcard"><div class="qm">${kinds[i]} · ${esc(q.topic)}</div><div class="qt">${esc(q.question)}</div></div>
        ${q.format === 'choice' ? `<div class="answers">${orders[i].map((oi, k) => `<button class="ans ${given[i] === oi ? 'sel' : ''}" data-v="${oi}"><b>${LETTERS[k]})</b> ${esc(q.options![oi])}</button>`).join('')}</div>`
          : `<input class="input-ans" data-in placeholder="Ответ своими словами или числом" value="${esc(String(given[i] ?? ''))}" autocomplete="off">`}
        <div class="row" style="gap:8px"><button class="btn btn-ghost grow" data-prev ${i ? '' : 'disabled'}>← Назад</button><button class="btn btn-blue grow" data-next>${i < qs.length - 1 ? 'Дальше →' : 'К началу'}</button></div>
        <button class="btn btn-gold btn-block" data-fin>Завершить и проверить</button>`;
      v.box.querySelectorAll<HTMLElement>('.ans').forEach((b) => b.addEventListener('click', () => { given[i] = Number(b.dataset.v); haptic(); draw(); }));
      const inp = v.box.querySelector<HTMLInputElement>('[data-in]');
      inp?.addEventListener('input', () => { given[i] = inp.value.trim() || null; v.box.querySelectorAll('.att-n')[i].classList.toggle('done', !!given[i]); });
      v.box.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => { i = Number(b.dataset.go); draw(); }));
      $(v.box, '[data-prev]').addEventListener('click', () => { i = Math.max(0, i - 1); draw(); });
      $(v.box, '[data-next]').addEventListener('click', () => { i = (i + 1) % qs.length; draw(); });
      $(v.box, '[data-fin]').addEventListener('click', (e) => {
        const left = given.filter((x) => x === null).length;
        const b = e.currentTarget as HTMLElement;
        if (left && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = `Без ответа ${left} — нажми ещё раз, чтобы завершить`; return; }
        finish();
      });
    };
    const finish = () => {
      finished = true; stop();
      const res = qs.map((q, k) => (given[k] === null ? false : checkLocal(q, given[k] as string | number).correct));
      const right = res.filter(Boolean).length;
      const byKind = ['выбор', 'открытый', 'кейс'].map((k) => ({ k, n: kinds.filter((x) => x === k).length, ok: kinds.filter((x, j) => x === k && res[j]).length })).filter((x) => x.n);
      v.setScore(`${right}/${qs.length}`);
      v.box.innerHTML = `<div class="card center col" style="gap:6px;padding:18px"><h2 style="font-size:28px">${right} из ${qs.length}</h2>
          <div class="muted">${Math.round((right / qs.length) * 100)}% · ${right / qs.length >= 0.8 ? 'уровень финалиста' : right / qs.length >= 0.6 ? 'хорошо, есть что подтянуть' : 'повтори темы ниже'}</div>
          <div class="row small" style="justify-content:center;gap:12px">${byKind.map((x) => `<span>${x.k}: <b>${x.ok}/${x.n}</b></span>`).join('')}</div></div>
        <div class="section-h">Ошибки и пропуски</div>
        ${qs.map((q, k) => (res[k] ? '' : `<div class="explain"><div class="small muted">${k + 1}. ${esc(q.topic)}</div><div>${esc(q.question)}</div>
          <div class="small">Твой ответ: ${given[k] === null ? '—' : esc(q.format === 'choice' ? q.options![given[k] as number] : String(given[k]))}</div>
          <div class="small">Верно: <b>${esc(rightAnswerText(q))}</b></div>${q.explanation ? `<div class="small muted">${esc(q.explanation)}</div>` : ''}</div>`)).join('') || '<div class="card center">Ни одной ошибки! 🏆</div>'}
        <button class="btn btn-gold btn-block" data-again>Ещё раз</button>`;
      $(v.box, '[data-again]').addEventListener('click', () => { v.close(); attestation(host, bank); });
    };
    draw();
  }
}

// ---------- 2. Головоломки ----------
interface Puzzle { kind: string; show: string; hint: string; answer: string; alt?: string[]; options?: string[]; correct?: number; why?: string }

function makePuzzles(bank: Question[], n: number): Puzzle[] {
  const out: Puzzle[] = [];
  const terms = CROSS_WORDS.map((x) => ({ w: x.w.toUpperCase().replace(/Ё/g, 'Е'), clue: x.clue })).filter((x) => x.w.length >= 5 && x.w.length <= 12 && !/\s/.test(x.w));
  for (const r of pick(REBUSES, 4)) out.push({ kind: 'Ребус', show: `<div class="pz-emoji">${r.e}</div>`, hint: `${r.clue} · ${r.a.length} букв${r.a.includes(' ') ? ' (два слова)' : ''}`, answer: r.a, alt: r.alt });
  for (const a of pick(ABBRS, 2)) {
    const opts = shuffle([a.full, ...pick(ABBRS.filter((x) => x.s !== a.s), 3).map((x) => x.full)]);
    out.push({ kind: 'Расшифруй', show: `<div class="pz-big">${esc(a.s)}</div>`, hint: 'выбери расшифровку', answer: a.full, options: opts, correct: opts.indexOf(a.full) });
  }
  for (const o of pick(ODDS, 2)) out.push({ kind: 'Что лишнее?', show: '', hint: 'одно слово выбивается', answer: o.items[o.odd], options: o.items, correct: o.odd, why: o.why });
  for (const t of pick(terms, 2)) {
    let mix = t.w;
    for (let k = 0; k < 6 && mix === t.w; k++) mix = shuffle([...t.w]).join('');
    out.push({ kind: 'Анаграмма', show: `<div class="pz-big">${mix}</div>`, hint: t.clue, answer: t.w });
  }
  for (const t of pick(terms, 1)) out.push({ kind: 'Без гласных', show: `<div class="pz-big">${t.w.replace(/[АЕЁИОУЫЭЮЯ]/g, '·')}</div>`, hint: `${t.clue} · гласные спрятаны`, answer: t.w });
  for (const q of pick(bank.filter(isNumberQ), 2)) out.push({ kind: 'Число из нормы', show: '', hint: esc(q.question), answer: q.answer!.trim(), alt: q.accepted, why: q.explanation });
  // пропущенное слово в цитате нормы
  for (const q of pick(bank.filter((x) => quoteOf(x)), 6)) {
    if (out.filter((x) => x.kind === 'Пропуск в норме').length >= 1) break;
    const qt = quoteOf(q)!;
    const words = qt.text.match(/[А-Яа-яЁё]{8,}/g) ?? [];
    if (!words.length || qt.text.length > 320) continue;
    const w = words.sort((a, b) => b.length - a.length)[0] ?? '';
    if (!w) continue;
    out.push({ kind: 'Пропуск в норме', show: `<div class="small" style="line-height:1.45">«${esc(qt.text.replace(w, `${w[0]}${'_'.repeat(w.length - 1)}`))}»</div>`, hint: esc(qt.ref), answer: w });
  }
  return shuffle(out).slice(0, n);
}

function puzzles(host: HTMLElement, bank: Question[]) {
  const v = sub(host, 'Головоломки');
  const list = makePuzzles(bank, 12);
  let i = 0, score = 0;
  const log: { p: Puzzle; ok: boolean | null }[] = [];
  v.box.innerHTML = `<div class="howto small">Как на втором этапе Профбатла: ребусы, расшифровки, анаграммы, числа из норм. Отвечаешь на скорость: <b>верно +1</b>, <b>неверно −1</b>, «Пас» — 0. На вопрос 25 секунд.</div><button class="btn btn-gold btn-block" data-go>Начать</button>`;
  $(v.box, '[data-go]').addEventListener('click', () => next());
  function next() {
    if (i >= list.length) return finish();
    const p = list[i];
    v.setSub(`${i + 1} из ${list.length} · ${p.kind}`);
    v.setScore(String(score));
    v.box.innerHTML = `<div class="ring-bar" style="max-width:none"><i data-tl style="width:100%"></i></div>
      <div class="qcard pz"><div class="qm">${esc(p.kind)}</div>${p.show}<div class="qt" style="font-size:15px">${p.hint}</div></div>
      ${p.options ? `<div class="answers">${p.options.map((o, k) => `<button class="ans" data-v="${k}"><b>${LETTERS[k]})</b> ${esc(o)}</button>`).join('')}</div>`
        : '<input class="input-ans" data-in placeholder="Ответ" autocomplete="off" autocapitalize="characters"><button class="btn btn-gold btn-block" data-send>Ответить</button>'}
      <button class="btn btn-ghost btn-block btn-sm" data-pass>Пас (0)</button>`;
    let done = false;
    const stop = v.countdown(25, (left) => { const tl = v.box.querySelector<HTMLElement>('[data-tl]'); if (tl) tl.style.width = `${(left / 25) * 100}%`; }, () => resolve(null));
    const resolve = (ok: boolean | null) => {
      if (done) return; done = true; stop();
      score += ok === true ? 1 : ok === false ? -1 : 0;
      log.push({ p, ok });
      haptic(ok ? 'ok' : ok === false ? 'bad' : 'tap');
      v.setScore(String(score));
      v.box.querySelectorAll<HTMLButtonElement>('.ans').forEach((b) => { b.disabled = true; if (Number(b.dataset.v) === p.correct) b.classList.add('ok'); });
      const after = el(`<div class="explain"><b>${ok ? '+1 · верно' : ok === false ? '−1 · неверно' : 'Пас'}</b> — ответ: <b>${esc(p.answer)}</b>${p.why ? `<div class="small muted">${esc(p.why)}</div>` : ''}</div>`);
      v.box.appendChild(after);
      const nb = el('<button class="btn btn-blue btn-block">Дальше</button>');
      nb.addEventListener('click', () => { i++; next(); });
      v.box.appendChild(nb);
    };
    const check = (s: string) => {
      const g = normalize(s);
      return [p.answer, ...(p.alt ?? [])].some((a) => normalize(a) === g);
    };
    v.box.querySelectorAll<HTMLElement>('.ans').forEach((b) => b.addEventListener('click', () => resolve(Number(b.dataset.v) === p.correct)));
    const inp = v.box.querySelector<HTMLInputElement>('[data-in]');
    if (inp) {
      const send = () => { if (inp.value.trim()) resolve(check(inp.value)); };
      $(v.box, '[data-send]').addEventListener('click', send);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
      setTimeout(() => inp.focus(), 50);
    }
    $(v.box, '[data-pass]').addEventListener('click', () => resolve(null));
  }
  function finish() {
    const ok = log.filter((x) => x.ok).length, bad = log.filter((x) => x.ok === false).length;
    v.box.innerHTML = `<div class="card center col" style="gap:6px;padding:18px"><h2 style="font-size:30px">${score > 0 ? '+' : ''}${score}</h2><div class="muted">верно ${ok} · неверно ${bad} · пас ${log.length - ok - bad}</div>
      <div class="small">${score >= 8 ? 'Готовы к финалу «2 к 1»!' : score >= 4 ? 'Хорошо. На сцене решает скорость — тренируйтесь нажимать первыми.' : 'На сцене за ошибку −1: если не уверены — лучше пас.'}</div></div>
      <button class="btn btn-gold btn-block" data-again>Новые головоломки</button>`;
    $(v.box, '[data-again]').addEventListener('click', () => { v.close(); puzzles(host, bank); });
  }
}

// ---------- 3. «2 к 1» ----------
function readTwice(v: ReturnType<typeof sub>, q: Question, onReady: () => void) {
  // ведущий читает вопрос дважды: сначала текст, потом «повтор» — и только после него можно отвечать
  const readSec = Math.min(6, 2 + q.question.length / 60);
  v.box.innerHTML = `<div class="qcard"><div class="qm" data-ph>Ведущий читает вопрос…</div><div class="qt">${esc(q.question)}</div></div><div class="ring-bar" style="max-width:none"><i data-tl style="width:100%"></i></div><div data-ans></div>`;
  v.countdown(readSec, (l) => { const tl = v.box.querySelector<HTMLElement>('[data-tl]'); if (tl) tl.style.width = `${(1 - l / readSec) * 100}%`; }, () => {
    const ph = v.box.querySelector('[data-ph]');
    if (ph) ph.textContent = 'Повтор вопроса…';
    v.countdown(readSec * 0.7, () => {}, onReady);
  });
}

function twoOne(host: HTMLElement, bank: Question[]) {
  const v = sub(host, '«2 к 1»');
  const pool = shuffle(bank.filter((q) => q.format === 'yesno' || q.format === 'choice'));
  let i = 0, right = 0, miss = 0;
  const MAX = 6, WIN = 30, ANSWER = 10;
  v.box.innerHTML = `<div class="howto small">Финал Профбатла: ведущий читает вопрос <b>дважды</b>, ответ — после повтора (здесь 10 секунд). Можно ошибиться <b>5 раз</b>, шестая ошибка — выбывание. Продержись ${WIN} вопросов.</div><button class="btn btn-gold btn-block" data-go>Начать</button>`;
  $(v.box, '[data-go]').addEventListener('click', () => next());
  const hearts = () => `${'❤️'.repeat(MAX - 1 - Math.min(MAX - 1, miss))}${'🖤'.repeat(Math.min(MAX - 1, miss))}`;
  function next() {
    if (miss >= MAX || right >= WIN) return finish();
    const q = pool[i++ % pool.length];
    v.setSub(`Верных ${right} · ошибок ${miss} из 5 ${hearts()}`);
    v.setScore(String(right));
    readTwice(v, q, () => {
      const order = q.format === 'choice' ? shuffledOptionOrder(q) : [];
      const box = $(v.box, '[data-ans]');
      box.innerHTML = answerUi(q, order);
      let done = false;
      const stop = v.countdown(ANSWER, (l) => { const tl = v.box.querySelector<HTMLElement>('[data-tl]'); if (tl) tl.style.width = `${(l / ANSWER) * 100}%`; }, () => resolve(null));
      const resolve = (g: string | number | boolean | null) => {
        if (done) return; done = true; stop();
        const ok = g !== null && checkLocal(q, g).correct;
        if (ok) right++; else miss++;
        haptic(ok ? 'ok' : 'bad');
        markAnswers(box, q, g);
        const nb = el(`<div class="col" style="gap:8px"><div class="explain"><b>${ok ? 'Верно' : g === null ? 'Время вышло' : 'Ошибка'}</b>${ok ? '' : ` — ${esc(rightAnswerText(q))}`}${q.explanation ? `<div class="small muted">${esc(q.explanation)}</div>` : ''}</div><button class="btn btn-blue btn-block">${miss >= MAX ? 'Итог' : 'Следующий вопрос'}</button></div>`);
        nb.querySelector('button')!.addEventListener('click', next);
        v.box.appendChild(nb);
        v.setSub(`Верных ${right} · ошибок ${miss} из 5 ${hearts()}`);
      };
      bindAnswer(box, q, resolve);
    });
  }
  function finish() {
    v.box.innerHTML = `<div class="card center col" style="gap:6px;padding:18px"><h2 style="font-size:30px">${right}</h2><div class="muted">${right >= WIN ? `Вы продержались все ${WIN} вопросов — победа в Профбатле! 🏆` : 'верных ответов до выбывания'}</div></div>
      <button class="btn btn-gold btn-block" data-again>Ещё раз</button>`;
    $(v.box, '[data-again]').addEventListener('click', () => { v.close(); twoOne(host, bank); });
  }
}

// ---------- 4. Правовой биатлон ----------
function biathlon(host: HTMLElement, bank: Question[]) {
  const v = sub(host, 'Правовой биатлон');
  v.box.innerHTML = `<div class="howto small">Команда стоит колонной, игроки выходят по одному. Вопрос читается дважды, после повтора — <b>5 секунд</b> на ответ. Верно — игрок уходит в конец колонны, неверно — выбывает. Побеждает тот, кто дал больше верных ответов и остался последним.</div>
    <div class="small"><b>Состав команды</b> (можно оставить как есть):</div>
    ${[1, 2, 3, 4, 5].map((k) => `<input class="input-ans" data-pl value="Игрок ${k}" maxlength="20" style="height:44px">`).join('')}
    <button class="btn btn-gold btn-block" data-go>На старт</button>`;
  $(v.box, '[data-go]').addEventListener('click', () => {
    const names = Array.from(v.box.querySelectorAll<HTMLInputElement>('[data-pl]')).map((x, k) => x.value.trim() || `Игрок ${k + 1}`);
    run(names);
  });
  function run(queue: string[]) {
    const pool = shuffle(bank.filter((q) => q.format === 'yesno' || (q.format === 'choice' && q.question.length < 140)));
    const out: string[] = [];
    let i = 0, right = 0;
    const next = () => {
      if (!queue.length) return finish();
      const who = queue[0];
      const q = pool[i++ % pool.length];
      v.setSub(`На рубеже: ${who} · в колонне ${queue.length}`);
      v.setScore(String(right));
      readTwice(v, q, () => {
        const order = q.format === 'choice' ? shuffledOptionOrder(q) : [];
        const box = $(v.box, '[data-ans]');
        box.innerHTML = `<div class="small center" style="margin-bottom:6px">Отвечает <b class="gold">${esc(who)}</b> — 5 секунд!</div>${answerUi(q, order)}`;
        let done = false;
        const stop = v.countdown(5, (l) => { const tl = v.box.querySelector<HTMLElement>('[data-tl]'); if (tl) tl.style.width = `${(l / 5) * 100}%`; }, () => resolve(null));
        const resolve = (g: string | number | boolean | null) => {
          if (done) return; done = true; stop();
          const ok = g !== null && checkLocal(q, g).correct;
          queue.shift();
          if (ok) { right++; queue.push(who); } else out.push(who);
          haptic(ok ? 'ok' : 'bad');
          markAnswers(box, q, g);
          const nb = el(`<div class="col" style="gap:8px"><div class="explain"><b>${ok ? `${esc(who)} — в конец колонны` : `${esc(who)} выбывает`}</b>${ok ? '' : ` · верно: ${esc(rightAnswerText(q))}`}</div><button class="btn btn-blue btn-block">${queue.length ? `Следующий: ${esc(queue[0])}` : 'Итог'}</button></div>`);
          nb.querySelector('button')!.addEventListener('click', next);
          v.box.appendChild(nb);
        };
        bindAnswer(box, q, resolve);
      });
    };
    const finish = () => {
      v.box.innerHTML = `<div class="card center col" style="gap:6px;padding:18px"><h2 style="font-size:30px">${right}</h2><div class="muted">верных ответов команды</div>
        <div class="small">Выбывали: ${out.map(esc).join(' → ')}</div></div><button class="btn btn-gold btn-block" data-again>Ещё раз</button>`;
      $(v.box, '[data-again]').addEventListener('click', () => { v.close(); biathlon(host, bank); });
    };
    next();
  }
}

// ---------- 6. Конкурс председателей ----------
interface TextTask { ref: string; text: string; q: string; options: string[]; correct: number }

function textTasks(bank: Question[], n: number): TextTask[] {
  const out: TextTask[] = [];
  for (const q of shuffle(bank)) {
    if (out.length >= n) break;
    const qt = quoteOf(q);
    if (!qt || qt.text.length > 560) continue;
    if (q.format === 'yesno') {
      const st = q.question.replace(/^[^:]{3,40}:\s*/, '');
      out.push({ ref: qt.ref, text: qt.text, q: `Утверждение: «${st}»`, options: ['Верно — следует из текста', 'Неверно — противоречит тексту', 'В тексте об этом не сказано'], correct: q.correct ? 0 : 1 });
    } else if (q.format === 'choice' && q.options && typeof q.correct === 'number') {
      const order = shuffledOptionOrder(q);
      out.push({ ref: qt.ref, text: qt.text, q: q.question.replace(/^[^:]{3,40}:\s*/, ''), options: order.map((k) => q.options![k]), correct: order.indexOf(q.correct) });
    } else if (isNumberQ(q)) {
      const a = Number(q.answer);
      const vars = shuffle([...new Set([a, a + (a > 10 ? 5 : 1), Math.max(1, a - (a > 10 ? 5 : 1)), a * 2, Math.round(a / 2) || a + 2])]).filter((x) => x > 0).slice(0, 4);
      if (!vars.includes(a)) vars[0] = a;
      const opts = shuffle(vars.map(String));
      out.push({ ref: qt.ref, text: qt.text.replace(new RegExp(`\\b${a}\\b`), '___'), q: 'Какое число пропущено в тексте нормы?', options: opts, correct: opts.indexOf(String(a)) });
    }
  }
  return out;
}

function chairs(host: HTMLElement, bank: Question[]) {
  const v = sub(host, 'Конкурс председателей');
  const N = 20, READ = 30, ANSWER = 20;
  v.box.innerHTML = `<div class="howto small">20 текстовых заданий по нормам: <b>30 секунд</b> на чтение, <b>20 секунд</b> на ответ. Ставка <b>«+1»</b>: верно — 2 балла, неверно — минус 1. Без ставки: верно — 1, неверно — 0.</div>
    <button class="btn btn-gold btn-block" data-go>Начать</button>`;
  $(v.box, '[data-go]').addEventListener('click', () => run());
  function run() {
    const tasks = textTasks(bank, N);
    let i = 0, score = 0, right = 0, bets = 0;
    const next = () => {
      if (i >= tasks.length) return finish();
      const t = tasks[i];
      v.setSub(`Задание ${i + 1} из ${tasks.length} · чтение`);
      v.setScore(String(score));
      v.box.innerHTML = `<div class="ring-bar" style="max-width:none"><i data-tl style="width:100%"></i></div>
        <div class="text-task"><div class="small muted">${esc(t.ref)}</div><div>${esc(t.text)}</div></div>
        <button class="btn btn-blue btn-block" data-ready>Прочитал(а) — к вопросу</button>`;
      let stage = 0;
      const toQuestion = () => {
        if (stage) return; stage = 1; stopRead();
        v.setSub(`Задание ${i + 1} из ${tasks.length} · ответ`);
        let bet = false, done = false;
        const area = el(`<div class="col" style="gap:10px"><div class="qcard" style="min-height:0"><div class="qt" style="font-size:16px">${esc(t.q)}</div></div>
          <div class="answers">${t.options.map((o, k) => `<button class="ans" data-v="${k}"><b>${LETTERS[k]})</b> ${esc(o)}</button>`).join('')}</div>
          <button class="btn btn-ghost btn-block bet" data-bet>Поставить «+1»</button></div>`);
        v.box.querySelector('[data-ready]')!.replaceWith(area);
        // текст прячем: на сцене на ответ 20 секунд — тренируем внимательное чтение. Подсмотреть можно, но тогда без ставки
        const tt = v.box.querySelector<HTMLElement>('.text-task')!;
        tt.classList.add('hid');
        const peek = el('<button class="btn btn-ghost btn-sm btn-block" data-peek>Подсмотреть текст (ставка станет недоступна)</button>');
        tt.after(peek);
        peek.addEventListener('click', () => { tt.classList.remove('hid'); peek.remove(); bet = false; const bb = area.querySelector<HTMLButtonElement>('[data-bet]'); if (bb) { bb.disabled = true; bb.classList.remove('on'); bb.textContent = 'Ставка недоступна — текст подсмотрен'; } });
        const stop = v.countdown(ANSWER, (l) => { const tl = v.box.querySelector<HTMLElement>('[data-tl]'); if (tl) tl.style.width = `${(l / ANSWER) * 100}%`; }, () => resolve(null));
        $(area, '[data-bet]').addEventListener('click', (e) => { bet = !bet; (e.currentTarget as HTMLElement).classList.toggle('on', bet); (e.currentTarget as HTMLElement).textContent = bet ? 'Ставка «+1» ✓' : 'Поставить «+1»'; haptic(); });
        const resolve = (g: number | null) => {
          if (done) return; done = true; stop();
          const ok = g === t.correct;
          if (bet) bets++;
          score += ok ? (bet ? 2 : 1) : bet ? -1 : 0;
          if (ok) right++;
          haptic(ok ? 'ok' : 'bad');
          area.querySelectorAll<HTMLButtonElement>('.ans').forEach((b) => { b.disabled = true; const k = Number(b.dataset.v); if (k === t.correct) b.classList.add('ok'); else if (k === g) b.classList.add('no'); });
          ($(area, '[data-bet]') as HTMLButtonElement).disabled = true;
          tt.classList.remove('hid'); v.box.querySelector('[data-peek]')?.remove();
          v.setScore(String(score));
          const nb = el(`<button class="btn btn-blue btn-block">${ok ? (bet ? '+2 со ставкой!' : '+1') : bet ? '−1 за ставку' : g === null ? 'Время вышло' : '0'} · дальше</button>`);
          nb.addEventListener('click', () => { i++; next(); });
          area.appendChild(nb);
        };
        area.querySelectorAll<HTMLElement>('.ans').forEach((b) => b.addEventListener('click', () => resolve(Number(b.dataset.v))));
      };
      const stopRead = v.countdown(READ, (l) => { const tl = v.box.querySelector<HTMLElement>('[data-tl]'); if (tl && !stage) tl.style.width = `${(l / READ) * 100}%`; }, toQuestion);
      $(v.box, '[data-ready]').addEventListener('click', toQuestion);
    };
    const finish = () => {
      v.box.innerHTML = `<div class="card center col" style="gap:6px;padding:18px"><h2 style="font-size:30px">${score} балл.</h2><div class="muted">верно ${right} из ${tasks.length} · ставок ${bets}</div>
        <div class="small">${bets && score < right ? 'Ставки съели баллы — ставь только когда уверен(а).' : 'Ставка «+1» окупается при уверенности больше 2/3.'}</div></div>
        <button class="btn btn-gold btn-block" data-again>Новые тексты</button>`;
      $(v.box, '[data-again]').addEventListener('click', () => { v.close(); chairs(host, bank); });
    };
    next();
  }
}

// ---------- 4. Заседание профбюро ----------
function meeting(host: HTMLElement) {
  const v = sub(host, 'Заседание профбюро');
  const agenda = pick(AGENDA, 2);
  const notes: string[] = ['', ''];
  v.box.innerHTML = `<div class="howto small">Как на конкурсе: <b>1 минута</b> на повестку (молча), <b>5 минут</b> на заседание, <b>20 минут</b> на протокол. Протокол оформляет один участник — только по записям с заседания.</div>
    <div class="card col" style="gap:6px"><b>Повестка</b>${agenda.map((a, k) => `<div>${k + 1}. ${esc(a)}</div>`).join('')}</div>
    <button class="btn btn-ghost btn-sm" data-new>Другая повестка</button>
    <button class="btn btn-gold btn-block" data-go>Старт: 1 минута на повестку</button>`;
  $(v.box, '[data-new]').addEventListener('click', () => { v.close(); meeting(host); });
  $(v.box, '[data-go]').addEventListener('click', () => phaseRead());
  const bigTimer = (sec: number, label: string, done: () => void) => {
    const t = el(`<div class="big-timer"><div class="small muted">${label}</div><b data-t></b><div class="ring-bar" style="max-width:none"><i data-tl></i></div><button class="btn btn-ghost btn-sm" data-skip>Дальше</button></div>`);
    let fin = false;
    const finish = () => { if (fin) return; fin = true; stop(); haptic('ok'); done(); };
    const stop = v.countdown(sec, (l) => { $(t, '[data-t]').textContent = mmss(Math.ceil(l)); ($(t, '[data-tl]') as HTMLElement).style.width = `${(l / sec) * 100}%`; }, finish);
    $(t, '[data-skip]').addEventListener('click', finish);
    return t;
  };
  function phaseRead() {
    v.setSub('1/3 · ознакомление');
    v.box.innerHTML = `<div class="card col" style="gap:6px"><b>Повестка</b>${agenda.map((a, k) => `<div>${k + 1}. ${esc(a)}</div>`).join('')}</div>`;
    v.box.prepend(bigTimer(60, 'Читаем молча', phaseMeet));
  }
  function phaseMeet() {
    v.setSub('2/3 · заседание');
    v.box.innerHTML = `<div class="card col" style="gap:6px"><b>Ход заседания</b>${MEETING_FLOW.map((s, k) => `<label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox"> <span>${k + 1}. ${esc(s)}</span></label>`).join('')}</div>
      ${agenda.map((a, k) => `<div class="small"><b>Записи по вопросу ${k + 1}</b> — ${esc(a)}</div><textarea class="textarea" data-n="${k}" placeholder="Кто докладывал, кто выступил, какое решение, как голосовали (за / против / воздержались)" style="min-height:80px"></textarea>`).join('')}`;
    v.box.querySelectorAll<HTMLTextAreaElement>('[data-n]').forEach((ta) => ta.addEventListener('input', () => { notes[Number(ta.dataset.n)] = ta.value; }));
    v.box.prepend(bigTimer(300, 'Заседание идёт', phaseProtocol));
  }
  function phaseProtocol() {
    v.setSub('3/3 · протокол');
    const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('.');
    v.box.innerHTML = `<div class="card col" style="gap:8px"><b>Шаблон протокола</b>
      <div class="mgrid"><label>№<input class="input-ans" data-f="no" value="1"></label><label>Дата<input class="input-ans" data-f="date" value="${today}"></label>
        <label>Присутствовали<input class="input-ans" data-f="here" value="5"></label><label>Всего членов<input class="input-ans" data-f="all" value="5"></label></div>
      <input class="input-ans" data-f="inst" placeholder="Профбюро какого института (например, ИРЭ)">
      <input class="input-ans" data-f="chair" placeholder="Председательствующий — ФИО">
      <input class="input-ans" data-f="sec" placeholder="Секретарь — ФИО">
      ${agenda.map((a, k) => `<div class="small"><b>${k + 1}. ${esc(a)}</b></div>
        <input class="input-ans" data-f="sl${k}" placeholder="СЛУШАЛИ: ФИО докладчика — о чём">
        <input class="input-ans" data-f="vy${k}" placeholder="ВЫСТУПИЛИ: ФИО — суть выступления">
        <textarea class="textarea" data-f="po${k}" style="min-height:70px" placeholder="ПОСТАНОВИЛИ: 1. … 2. … (срок, ответственный)">${esc(notes[k])}</textarea>
        <div class="mgrid"><label>За<input class="input-ans" data-f="za${k}" value="5"></label><label>Против<input class="input-ans" data-f="pr${k}" value="0"></label><label>Воздерж.<input class="input-ans" data-f="vz${k}" value="0"></label></div>`).join('')}
      </div>
      <button class="btn btn-gold btn-block" data-make>Собрать протокол</button>
      <div class="text-task hidden" data-out style="white-space:pre-wrap"></div>
      <button class="btn btn-blue btn-block hidden" data-copy>Скопировать текст</button>
      <div class="card col" style="gap:6px"><b>Самопроверка по критериям жюри</b>${MEETING_CRITERIA.map((c) => `<label class="row small" style="gap:8px"><input type="checkbox"> ${esc(c)}</label>`).join('')}</div>`;
    v.box.prepend(bigTimer(1200, 'Оформление протокола', () => toast('20 минут прошли — на конкурсе протокол забирают', 'info')));
    const f = (k: string) => (v.box.querySelector<HTMLInputElement>(`[data-f="${k}"]`)?.value ?? '').trim();
    $(v.box, '[data-make]').addEventListener('click', () => {
      const here = Number(f('here')) || 0, all = Number(f('all')) || 0;
      const txt = [`ПРОТОКОЛ № ${f('no')}`, `заседания профсоюзного бюро ${f('inst') || '_____'} ППО обучающихся НИУ «МЭИ»`, '', `г. Москва${' '.repeat(10)}${f('date')}`, '',
        `Присутствовали: ${here} из ${all} членов профбюро. Кворум ${here * 2 > all ? 'имеется' : 'отсутствует'}.`, `Председательствующий — ${f('chair') || '_____'}.`, `Секретарь — ${f('sec') || '_____'}.`, '',
        'ПОВЕСТКА ДНЯ:', ...agenda.map((a, k) => `${k + 1}. ${a}.`), '',
        ...agenda.flatMap((a, k) => [`${k + 1}. СЛУШАЛИ: ${f(`sl${k}`) || '_____'}`, `ВЫСТУПИЛИ: ${f(`vy${k}`) || '_____'}`, `ПОСТАНОВИЛИ: ${f(`po${k}`) || '_____'}`,
          `Голосовали: «за» — ${f(`za${k}`)}, «против» — ${f(`pr${k}`)}, «воздержались» — ${f(`vz${k}`)}. Решение ${Number(f(`za${k}`)) > Number(f(`pr${k}`)) + Number(f(`vz${k}`)) ? 'принято' : 'не принято'}.`, '']),
        `Председательствующий ________ ${f('chair')}`, `Секретарь ________ ${f('sec')}`].join('\n');
      const out = $(v.box, '[data-out]');
      out.textContent = txt; out.classList.remove('hidden');
      v.box.querySelector('[data-copy]')!.classList.remove('hidden');
      haptic('ok');
    });
    $(v.box, '[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($(v.box, '[data-out]').textContent ?? ''); toast('Протокол скопирован', 'ok'); } catch { toast('Не получилось скопировать — выдели текст вручную', 'bad'); }
    });
  }
}

// ---------- 1 и 7. Репетиции выступлений ----------
function rehearsal(host: HTMLElement, kind: 'card' | 'admission') {
  const card = kind === 'card';
  const v = sub(host, card ? 'Визитная карточка' : 'Приёмная кампания');
  const speech = card ? 300 : 180, qa = card ? 180 : 300;
  const crit = card ? CARD_CRITERIA : [...ADMISSION_EXPERTS.map((x) => `Эксперты: ${x}`), ...ADMISSION_JURY.map((x) => `Жюри: ${x}`)];
  v.box.innerHTML = `<div class="howto small">${card ? 'Выступление — до 5 минут, вопросы жюри — до 3 минут, всего до 8 минут. Оценка — 10-балльная шкала по 6 критериям.'
      : 'Выступление — до 3 минут, вопросы жюри — до 5 минут. <b>Сопроводительное письмо — в оргкомитет не позднее чем за 4 дня (до 23 ноября)</b>, материалы за год.'}</div>
    <div class="card col" style="gap:6px"><b>${card ? 'Что показать в презентации' : 'Что включить в сопроводительное письмо'}</b>
      ${(card ? CARD_CHECKLIST : ADMISSION_LETTER).map((c) => `<label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox"> <span>${esc(c)}</span></label>`).join('')}</div>
    <div class="big-timer"><div class="small muted" data-ph>Репетиция: выступление ${mmss(speech)} + вопросы ${mmss(qa)}</div><b data-t>${mmss(speech)}</b>
      <div class="ring-bar" style="max-width:none"><i data-tl style="width:100%"></i></div>
      <div class="row" style="gap:8px"><button class="btn btn-gold grow" data-start>Старт выступления</button><button class="btn btn-blue grow" data-qa>Вопросы жюри</button></div></div>
    <div class="card col" style="gap:8px"><b>Оценка после репетиции</b><div class="small muted">Поставьте себе честно — как жюри (1–10)</div>
      ${crit.map((c, k) => `<label class="col small" style="gap:2px"><span>${esc(c)} — <b data-cv="${k}">7</b></span><input type="range" min="1" max="10" value="7" data-c="${k}"></label>`).join('')}
      <div class="row"><b class="grow">Итого</b><b class="gold" data-sum></b></div></div>`;
  let stop = () => {};
  const runTimer = (sec: number, label: string) => {
    stop();
    $(v.box, '[data-ph]').textContent = label;
    stop = v.countdown(sec, (l) => {
      $(v.box, '[data-t]').textContent = mmss(Math.ceil(l));
      ($(v.box, '[data-tl]') as HTMLElement).style.width = `${(l / sec) * 100}%`;
      $(v.box, '[data-t]').classList.toggle('warn', l < 30);
    }, () => { haptic('heavy'); toast(`${label}: время вышло`, 'info'); });
  };
  $(v.box, '[data-start]').addEventListener('click', () => runTimer(speech, 'Выступление'));
  $(v.box, '[data-qa]').addEventListener('click', () => runTimer(qa, 'Вопросы жюри'));
  const sum = () => {
    const vals = Array.from(v.box.querySelectorAll<HTMLInputElement>('[data-c]')).map((x) => Number(x.value));
    vals.forEach((x, k) => { $(v.box, `[data-cv="${k}"]`).textContent = String(x); });
    $(v.box, '[data-sum]').textContent = `${vals.reduce((a, b) => a + b, 0)} из ${vals.length * 10}`;
  };
  v.box.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('input', sum));
  sum();
}

/** Короткая справка о конкурсе — для окна помощи. */
export function contestInfo() {
  modal(`<h2 style="font-size:22px">«Ты — лидер»</h2><div class="small">${STAGES.map((s) => `<b>${s.n}. ${esc(s.name)}</b> — ${esc(s.format)}`).join('<br>')}</div>`);
}
