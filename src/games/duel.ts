// Поединки в правовухе: участник против участника. Вызов — код, ссылка в Telegram или открытый вызов для всех.
// Оба отвечают на одни и те же 7 вопросов (по 20 секунд), проверяет сервер. Можно одновременно — видно,
// как идёт соперник, — или по очереди: итог придёт обоим и в бота. За поединок — профкоины.
import { factionById } from '../config/factions';
import { coinSvg, icon } from '../art/icons';
import { DUEL_COINS, DUEL_Q_SECONDS, duelLink, type Duel, type DuelList } from '../core/duel';
import type { CheckResult, Question } from '../core/questions';
import { haptic, telegram } from '../core/telegram';
import { $, el, esc, fmt, onAct, toast } from '../lib/dom';
import type { App } from '../ui/app';
import { ask } from './law';

const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : `${Math.floor(m / 60)} ч назад`; };
const fshort = (f: string) => { try { return factionById(f as never).short; } catch { return ''; } };

function status(d: Duel) {
  if (d.result) return d.result === 'win' ? `победа ${d.score![0]}:${d.score![1]}` : d.result === 'loss' ? `поражение ${d.score![0]}:${d.score![1]}` : `ничья ${d.score![0]}:${d.score![1]}`;
  if (!d.my.done) return d.my.started ? `ты ответил на ${d.my.answered} из ${d.n}` : 'ты ещё не отвечал';
  if (!d.opp) return 'ждём соперника';
  return d.opp.done ? 'считаем итог' : `соперник отвечает: ${d.opp.answered} из ${d.n}`;
}

/** Профкоины за поединок — один раз за каждый. */
function payDuel(app: App, d: Duel) {
  const s = app.state;
  if (!d.result || s.duelsPaid.includes(d.id)) return 0;
  const c = DUEL_COINS[d.result];
  s.coins += c;
  s.duelsPaid = [...s.duelsPaid.slice(-60), d.id];
  app.update(false);
  return c;
}

export function openDuelHub(app: App, opts: { code?: string; create?: boolean } = {}) {
  let list: DuelList | null = null;
  let created: Duel | null = null;
  const node = el(`<div class="screen full"><div class="page">
    <div class="row"><button class="btn btn-ghost btn-sm" data-act="exit" aria-label="Назад">${icon('back', 18)}</button>
      <div class="grow"><h1 style="font-size:24px">Поединки в правовухе</h1><div class="small muted">Ты против участника: 7 одинаковых вопросов, кто больше верных — тот и победил</div></div></div>
    <div data-hub class="col" style="gap:10px"></div></div></div>`);
  const hub = $(node, '[data-hub]');
  const draw = () => {
    const l = list;
    hub.innerHTML = `${created ? `<div class="card col center" style="gap:8px;border-color:var(--gold)"><b>Вызов брошен</b>
        <div class="duel-code">${esc(created.code)}</div>
        <div class="small muted">Скажи код сопернику или отправь ссылку. Вызов виден и в «Открытых вызовах» у всех.</div>
        <div class="row" style="gap:8px;width:100%"><button class="btn btn-blue grow" data-act="share" data-code="${esc(created.code)}">${icon('envelope', 16)} Отправить</button>
          <button class="btn btn-gold grow" data-act="go" data-id="${esc(created.id)}">Отвечать</button></div></div>` : ''}
      <button class="btn btn-gold btn-block" data-act="create">${icon('swords', 18)} Бросить вызов</button>
      <div class="row" style="gap:8px"><input class="input-ans grow" data-code maxlength="5" placeholder="Код вызова" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase">
        <button class="btn btn-blue" data-act="join">Принять</button></div>
      ${l?.open.length ? `<div class="section-h">Открытые вызовы</div><div class="list">${l.open.map((o) => `<div class="li"><div class="grow"><b>${esc(o.name)}</b> <span class="small muted">${esc(fshort(o.faction))}</span>
          <div class="small muted">${ago(o.created)}${o.right !== null ? ` · уже ответил: ${o.right} из 7` : ''}</div></div><button class="btn btn-gold btn-sm" data-act="accept" data-code="${esc(o.code)}">Принять</button></div>`).join('')}</div>` : ''}
      ${l?.mine.length ? `<div class="section-h">Мои поединки</div><div class="list">${l.mine.map((d) => `<button class="li duel-li ${d.result ?? ''}" data-act="open" data-id="${esc(d.id)}" style="text-align:left">
          <div class="grow"><b>${d.opp ? esc(d.opp.name) : `Вызов ${esc(d.code)}`}</b><div class="small muted">${status(d)}</div></div>
          <span class="small">${d.result === 'win' ? '🏆' : !d.my.done ? 'Отвечать →' : ''}</span></button>`).join('')}</div>` : ''}
      ${l?.board.length ? `<div class="section-h">Лучшие поединщики</div><div class="list">${l.board.map((b, i) => `<div class="li"><b style="width:22px">${i + 1}</b><div class="grow">${esc(b.name)} <span class="small muted">${esc(fshort(b.faction))}</span></div><span class="small"><b class="gold">${b.wins}</b> побед из ${b.played}</span></div>`).join('')}</div>` : ''}
      ${l && !l.open.length && !l.mine.length ? '<div class="card small muted">Пока никто не бросал вызов. Брось первым — вызов увидят все участники.</div>' : ''}`;
  };
  const load = async () => {
    list = await app.backend.duelList().catch(() => list);
    if (!(document.activeElement instanceof HTMLInputElement && hub.contains(document.activeElement))) draw();
  };
  const join = async (code: string) => {
    if (code.trim().length < 5) { toast('Код — 5 символов', 'bad'); return; }
    try { const d = await app.backend.duelJoin(code); haptic('ok'); playDuel(app, d); }
    catch (e) { toast((e as Error).message, 'bad'); haptic('bad'); }
  };
  onAct(node, {
    exit: () => { clearInterval(timer); app.closeOverlay(); },
    create: () => create(),
    share: (t) => {
      const link = duelLink(t.dataset.code!);
      const text = `Вызываю тебя на правовой поединок в игре ШПА! Код: ${t.dataset.code}`;
      const tg = telegram();
      if (link && tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
      else if (navigator.share) navigator.share({ text: `${text}${link ? ` ${link}` : ''}` }).catch(() => {});
      else { navigator.clipboard?.writeText(`${text} ${link}`).catch(() => {}); toast('Скопировано — отправь сопернику', 'ok'); }
    },
    join: () => join(($(hub, '[data-code]') as HTMLInputElement).value),
    accept: (t) => join(t.dataset.code!),
    go: (t) => { const d = list?.mine.find((x) => x.id === t.dataset.id) ?? created; if (d) playDuel(app, d); },
    open: async (t) => {
      try { const d = await app.backend.duelState(t.dataset.id!); playDuel(app, d); } catch (e) { toast((e as Error).message, 'bad'); }
    },
  });
  const timer = window.setInterval(load, 6000);
  node.addEventListener('close', () => clearInterval(timer));
  app.openOverlay(node);
  draw();
  const create = async () => {
    try { created = await app.backend.duelCreate(); haptic('ok'); await load(); }
    catch (e) { toast((e as Error).message, 'bad'); }
  };
  load().then(() => { if (opts.code) join(opts.code); else if (opts.create) create(); });
}

/** Сам поединок: вопросы по очереди, сверху — ты и соперник. В конце — итог или ожидание соперника. */
export function playDuel(app: App, start: Duel) {
  let d = start;
  const qs = (d.qids ?? []).map((id) => app.questions.find((q) => q.id === id)).filter((q): q is Question => !!q);
  const node = el(`<div class="screen full duel-play"><div class="quiz">
    <div class="row"><button class="btn btn-ghost btn-sm" data-act="exit" aria-label="Назад">${icon('back', 18)}</button>
      <div class="grow"><div style="font-family:var(--head);font-size:18px">Правовой поединок</div><div class="small muted">Код ${esc(d.code)} · ${DUEL_Q_SECONDS} секунд на вопрос</div></div></div>
    <div class="duel-vs" data-vs></div>
    <div class="col" data-box style="gap:12px"></div></div></div>`);
  const box = $(node, '[data-box]');
  let stop = () => {}, i = 0, closed = false;
  const dots = (n: number, answered: number, mine: boolean, oks: boolean[]) =>
    Array.from({ length: n }, (_, k) => `<i class="${k >= answered ? '' : mine && k < oks.length ? (oks[k] ? 'ok' : 'no') : 'on'}"></i>`).join('');
  const myOks: boolean[] = [];
  const drawVs = () => {
    const me = app.state.username.split(' ')[0];
    $(node, '[data-vs]').innerHTML = `<div class="dv-side"><b>${esc(me)}</b><div class="dv-dots">${dots(d.n, d.my.answered, true, myOks)}</div></div>
      <div class="dv-mid">VS</div>
      <div class="dv-side r"><b>${d.opp ? esc(d.opp.name.split(' ')[0]) : 'ждём…'}</b><div class="dv-dots">${d.opp ? dots(d.n, d.opp.answered, false, []) : ''}</div></div>`;
  };
  const check = async (q: Question, given: string | number | boolean): Promise<CheckResult> => {
    try {
      const r = await app.backend.duelAnswer(d.id, q, given);
      d = r.duel; myOks.push(r.correct); drawVs();
      return r;
    } catch (e) {
      toast((e as Error).message, 'bad');
      return { correct: false, right: '—', explanation: (e as Error).message };
    }
  };
  const next = () => {
    if (closed) return;
    if (d.my.done || i >= qs.length) return finish();
    const q = qs[i];
    stop = ask(app, box, {
      q, n: `${i + 1} / ${qs.length}`, timeLimit: DUEL_Q_SECONDS, check,
      nextLabel: i + 1 < qs.length ? 'Следующий вопрос' : 'Итог',
      onDone: () => {},
      onNext: () => { i++; next(); },
    });
  };
  const finish = () => {
    stop();
    if (d.result) {
      const coins = payDuel(app, d);
      const win = d.result === 'win';
      box.innerHTML = `<div class="card center col duel-result ${d.result}" style="gap:10px;padding:20px">
        <div style="font-size:52px">${win ? '🏆' : d.result === 'draw' ? '🤝' : '⚖️'}</div>
        <h2 style="font-size:28px">${win ? 'Победа!' : d.result === 'draw' ? 'Ничья' : 'Поражение'}</h2>
        <div style="font-family:var(--head);font-size:44px;color:var(--gold2)">${d.score![0]} : ${d.score![1]}</div>
        <div class="small muted">против ${esc(d.opp?.name ?? 'соперника')} · твоё время ${((d.my.ms ?? 0) / 1000).toFixed(1)} с, соперника ${((d.opp?.ms ?? 0) / 1000).toFixed(1)} с</div>
        ${coins ? `<div class="row" style="justify-content:center;gap:6px">${coinSvg(18)}<b>+${fmt(coins)} профкоинов</b></div>` : ''}
        <button class="btn btn-gold btn-block" data-act="again">${icon('swords', 18)} Ещё поединок</button>
        <button class="btn btn-ghost btn-block" data-act="exit">К поединкам</button></div>`;
      if (win) { haptic('heavy'); confetti(node); }
      return;
    }
    box.innerHTML = `<div class="card center col" style="gap:10px;padding:20px"><div style="font-size:44px">⏳</div>
      <h2>Ты ответил: ${d.my.right ?? 0} из ${d.n}</h2>
      <div class="small muted">${d.opp ? `${esc(d.opp.name)} отвечает: ${d.opp.answered} из ${d.n}. Итог появится здесь и придёт в бота.` : 'Соперник ещё не принял вызов — итог придёт в бота, когда он ответит.'}</div>
      <button class="btn btn-ghost btn-block" data-act="exit">К поединкам</button></div>`;
  };
  // соперник: прогресс вживую
  const poll = window.setInterval(async () => {
    const fresh = await app.backend.duelState(d.id).catch(() => null);
    if (!fresh) return;
    const wasResult = d.result;
    d = { ...fresh, qids: d.qids };
    drawVs();
    if (!wasResult && d.result && d.my.done) finish();
  }, 2500);
  const close = () => { closed = true; stop(); clearInterval(poll); app.closeOverlay(); openDuelHub(app); };
  onAct(node, {
    exit: close,
    again: () => { closed = true; stop(); clearInterval(poll); app.closeOverlay(); openDuelHub(app, { create: true }); },
  });
  node.addEventListener('close', () => { closed = true; stop(); clearInterval(poll); });
  app.openOverlay(node);
  drawVs();
  if (!qs.length) { box.innerHTML = '<div class="card">Вопросы ещё загружаются — открой поединок через минуту.</div>'; return; }
  // уже отвеченные вопросы пропускаем (вернулся в поединок)
  i = d.my.answered;
  if (d.my.done) { finish(); return; }
  app.backend.duelStart(d.id).then((nd) => { d = { ...nd, qids: d.qids }; drawVs(); next(); }).catch((e) => toast((e as Error).message, 'bad'));
}

function confetti(root: HTMLElement) {
  for (let i = 0; i < 60; i++) {
    const p = el(`<i class="wh-conf" style="left:50%;top:40%;--x:${(Math.random() * 2 - 1) * 180}px;--y:${-(80 + Math.random() * 220)}px;--r:${Math.random() * 720 - 360}deg;--d:${(Math.random() * 0.3).toFixed(2)}s;background:${['#ffc83d', '#4fd1a5', '#ff5fa2', '#7ea8ff', '#fff'][i % 5]}"></i>`);
    root.appendChild(p);
    setTimeout(() => p.remove(), 1700);
  }
}
