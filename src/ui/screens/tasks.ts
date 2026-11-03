// Задания выезда: сдача, QR, кодовые слова, квизы, формы. Статусы — выполнено / на проверке / доступно.
import { DAY_TITLES, TASKS, type TaskDef } from '../../config/tasks';
import { DAILY_GAME_RATING_CAP } from '../../config/economy';
import { icon } from '../../art/icons';
import { taskAvailable, type MySubmission } from '../../core/backend';
import { qrSvg } from '../../core/qr';
import { PERSONAL_ROTATE_S, currentCode } from '../../core/codes';
import { mskDay } from '../../core/state';
import { haptic, openExternal, telegram } from '../../core/telegram';
import { canScanAny, scanAny } from '../../lib/scan';
import { compressImage } from '../../lib/image';
import { $, el, esc, modal, onAct, toast } from '../../lib/dom';
import { openCaseOfDay, quizFlow } from '../../games/law';
import type { App } from '../app';
import { openScan, redeemAny } from './scan';
import { openNotes } from './notes';

const CHECK_TEXT: Record<TaskDef['check'], string> = {
  auto: 'засчитается само', moderation: 'на модерацию', host: 'отметит ведущий', qr: 'по QR', code: 'кодовое слово',
};

function doneCount(app: App, t: TaskDef) {
  const key = t.limit === 'daily' ? `${t.id}@${mskDay()}` : t.id;
  return app.state.tasks.done[key] ?? 0;
}

let subsCache: MySubmission[] = [];

function lastSub(t: TaskDef) { return subsCache.find((x) => x.task === t.id); }

function status(app: App, t: TaskDef): 'done' | 'pending' | 'open' | 'host' {
  if (app.state.tasks.pending[t.id] || lastSub(t)?.status === 'pending') return 'pending';
  if (!taskAvailable(app.state, t.id)) return 'done';
  if (t.check === 'host') return 'host';
  return 'open';
}

export function openTasks(app: App) {
  const node = el(`<div class="screen full"><div class="page">
    <div class="row"><button class="btn btn-ghost btn-sm" data-act="exit" aria-label="Назад">${icon('back', 18)}</button><h1 class="grow" style="font-size:24px">Задания выезда</h1></div>
    <div class="row" style="gap:8px">
      <button class="btn btn-gold grow btn-col" data-act="scan">${icon('camera', 22)}<span class="sub">${canScanAny() ? 'Сканировать' : 'Ввести код'}</span></button>
      <button class="btn btn-blue grow btn-col" data-act="myqr">${icon('qr', 22)}<span class="sub">Мой QR</span></button>
      <button class="btn btn-blue grow btn-col" data-act="code">${icon('sparkle', 22)}<span class="sub">Кодовое слово</span></button>
      <button class="btn btn-blue grow btn-col" data-act="notes">${icon('info', 22)}<span class="sub">Ответы</span></button>
    </div>
    <div class="small muted">Баллы за задания — сверх лимита игры (${DAILY_GAME_RATING_CAP} в сутки). Сдачи проверяют организаторы — придёт уведомление «принято» или «не принято».</div>
    <div data-list></div>
  </div></div>`);
  const draw = () => {
    $(node, '[data-list]').innerHTML = (['before', 'nov7', 'nov8', 'both', 'creative'] as const).map((d) => `<div class="section-h">${DAY_TITLES[d]}</div><div class="list" style="margin-top:6px">${TASKS.filter((t) => t.day === d).map((t) => {
      const st = status(app, t);
      const n = doneCount(app, t);
      const last = lastSub(t);
      const btn = st === 'done' ? `<span class="tag" style="background:#2fbf7133;color:#6dffb0">✓ ${n > 1 ? `×${n}` : 'готово'}</span>`
        : st === 'pending' ? '<span class="tag" style="background:#e0a10033;color:#ffd76a">на проверке</span>'
        : st === 'host' ? '<span class="tag">ведущий</span>'
        : `<button class="btn btn-gold btn-sm" data-act="do" data-id="${t.id}">${last?.status === 'rejected' ? 'Ещё раз' : actLabel(t)}</button>`;
      const rej = st === 'open' && last?.status === 'rejected' ? `<div class="small" style="color:#ff8a8a">Не принято${last.note ? `: ${esc(last.note)}` : ''}</div>` : '';
      return `<div class="li ${st === 'done' ? 'task-done' : ''}" style="align-items:flex-start">
        <div class="grow col" style="gap:3px"><div class="small muted">${esc(t.when)} · ${CHECK_TEXT[t.check]}</div>
          <div style="font-weight:600;line-height:1.3">${esc(t.title)}</div><div class="small muted">${esc(t.how)} · <b class="gold">${esc(t.rating)}</b></div>${rej}</div>${btn}</div>`;
    }).join('')}</div>`).join('');
  };
  draw();
  app.backend.mySubmissions(app.state).then((x) => { subsCache = x.sort((a, b) => b.at - a.at); draw(); }).catch(() => {});
  onAct(node, {
    exit: () => app.closeOverlay(),
    myqr: () => openMyQr(app),
    scan: async () => {
      const code = canScanAny() ? await scanAny() : null;
      if (code === null) return openCodeInput(app, 'Код под QR, код тайника или знакомого', draw);
      redeemAny(app, code, draw);
    },
    code: () => openCodeInput(app, 'Кодовое слово из презентации', draw),
    notes: () => openNotes(app),
    do: (t) => doTask(app, TASKS.find((x) => x.id === t.dataset.id)!, draw),
  });
  app.openOverlay(node);
}

function actLabel(t: TaskDef) {
  if (t.check === 'qr') return 'Скан';
  if (t.check === 'code') return 'Ввести';
  if (t.form === 'quiz') return 'Пройти';
  if (t.form === 'invite') return 'Ссылка';
  if (t.id === 'case_day') return 'Решить';
  if (t.id === 'daily_login') return 'Забрать';
  return 'Сдать';
}

const redeem = (app: App, code: string, after: () => void) => redeemAny(app, code, after);

/** Личный QR: меняется каждые 30 секунд, поэтому скриншот или код в чате быстро протухает. */
export async function openMyQr(app: App) {
  const secret = await app.backend.mySecret(app.state);
  if (!secret) { toast('Нет связи с сервером — QR недоступен', 'bad'); return; }
  const m = modal(`<div class="col" style="align-items:center;gap:10px;text-align:center">
    <h2 style="font-size:22px">Мой QR</h2>
    <div class="qr-box" data-qr></div>
    <div class="code-big" data-code></div>
    <div class="ring-bar"><i data-left></i></div>
    <div class="small muted">Покажи для знакомства и при выдаче мерча. Для отметки на блоке не нужен — там ты сам сканируешь QR организатора. Код можно продиктовать, он меняется каждые ${PERSONAL_ROTATE_S} секунд.</div></div>`, { cls: 'center', onClose: () => clearInterval(timer) });
  let shown = '';
  const draw = () => {
    const c = currentCode(secret, PERSONAL_ROTATE_S);
    if (c.code !== shown) {
      shown = c.code;
      $(m.root, '[data-qr]').innerHTML = qrSvg(`SHPA:P:${c.code}`);
      $(m.root, '[data-code]').textContent = `${c.code.slice(0, 3)} ${c.code.slice(3)}`;
    }
    $(m.root, '[data-left]').style.width = `${(c.left / PERSONAL_ROTATE_S) * 100}%`;
  };
  draw();
  const timer = window.setInterval(draw, 250);
}

function openCodeInput(app: App, title: string, after: () => void) {
  const m = modal(`<h2 style="font-size:20px;margin-bottom:8px">${esc(title)}</h2>
    <input class="input-ans" data-code placeholder="Кодовое слово или код с QR" autocomplete="off" autocapitalize="characters">
    <button class="btn btn-gold btn-block" data-ok style="margin-top:10px">Проверить</button>`);
  const inp = $(m.root, '[data-code]') as HTMLInputElement;
  setTimeout(() => inp.focus(), 50);
  const go = () => { const v = inp.value.trim(); if (!v) return; m.close(); redeem(app, v, after); };
  $(m.root, '[data-ok]').addEventListener('click', go);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

async function doTask(app: App, t: TaskDef, after: () => void) {
  const s = app.state;
  const claim = async (payload?: Parameters<App['backend']['claimTask']>[2]) => {
    const r = await app.backend.claimTask(s, t.id, payload);
    haptic(r.status === 'approved' ? 'ok' : 'bad');
    toast(r.message, r.status === 'approved' ? 'ok' : 'bad');
    app.update(false); after();
    return r;
  };
  if (t.check === 'qr') {
    if (t.id === 'lecture' || t.id === 'speed_qr') return openScan(app);
    const code = canScanAny() ? await scanAny() : null;
    if (code === null) return openCodeInput(app, t.id === 'caches' || t.id === 'cache_gold' ? 'Код тайника' : 'Код под QR участника', after);
    return redeem(app, code, after);
  }
  if (t.check === 'code') return openCodeInput(app, 'Кодовое слово', after);
  if (t.id === 'daily_login') return claim();
  if (t.id === 'case_day') { app.closeOverlay(); return openCaseOfDay(app); }
  switch (t.form) {
    case 'quiz': {
      // вопросы выбирает сервер и сам считает верные ответы — прислать «10 из 10» с телефона не выйдет
      const qz = await app.backend.quizStart(s, t.id).catch(() => null);
      if (!qz || !qz.questions.length) { toast('Не получилось начать квиз — проверь связь', 'bad'); return; }
      app.closeOverlay(false);
      quizFlow(app, t.title, qz.questions, () => { claim({ quiz: qz.id }); });
      return;
    }
    case 'profile': return formProfile(app, claim);
    case 'reflection': return formReflection(app, claim);
    case 'thought': return formThought(app, claim);
    case 'invite': return openInvite(app);
    case 'channel': return openChannel(app, t, after);
    default: return formSubmit(app, t, after);
  }
}

function formProfile(app: App, claim: (p?: { text?: string }) => Promise<unknown>) {
  const s = app.state;
  const m = modal(`<h2 style="font-size:22px">Профиль</h2>
    <div class="small muted" style="margin:4px 0 10px">Институт — твоё ПБ, фото — аватар Telegram.</div>
    <label class="col" style="gap:4px"><span class="small">Курс</span><input class="input-ans" data-course value="${esc(s.profile.course)}" placeholder="Например, 2 курс бакалавриата"></label>
    <label class="col" style="gap:4px;margin-top:8px"><span class="small">Три факта о себе</span><textarea class="textarea" data-facts placeholder="1. … 2. … 3. …">${esc(s.profile.facts)}</textarea></label>
    <button class="btn btn-gold btn-block" data-ok style="margin-top:10px">Сохранить</button>`);
  $(m.root, '[data-ok]').addEventListener('click', async () => {
    const course = ($(m.root, '[data-course]') as HTMLInputElement).value.trim();
    const facts = ($(m.root, '[data-facts]') as HTMLTextAreaElement).value.trim();
    if (course.length < 2 || facts.length < 20) { toast('Заполни курс и три факта (хотя бы пару предложений)', 'bad'); return; }
    s.profile = { course, facts, filled: true };
    m.close();
    await claim({ text: `${course}\n${facts}` });
  });
}

function formReflection(app: App, claim: (p?: { text?: string }) => Promise<unknown>) {
  const qs = ['Что было самым полезным на выезде?', 'Что заберёшь в работу своего ПБ?', 'Что улучшить в следующий раз?'];
  const m = modal(`<h2 style="font-size:22px">Рефлексия</h2>
    ${qs.map((q, i) => `<label class="col" style="gap:4px;margin-top:8px"><span class="small"><b>${q}</b></span><textarea class="textarea" data-r="${i}" style="min-height:70px"></textarea></label>`).join('')}
    <button class="btn btn-gold btn-block" data-ok style="margin-top:10px">Отправить</button>`);
  $(m.root, '[data-ok]').addEventListener('click', async () => {
    const a = qs.map((_, i) => ($(m.root, `[data-r="${i}"]`) as HTMLTextAreaElement).value.trim());
    if (a.some((x) => x.length < 10)) { toast('Ответь на все три вопроса', 'bad'); return; }
    m.close();
    await claim({ text: qs.map((q, i) => `${q}\n${a[i]}`).join('\n\n') });
  });
}

function formThought(app: App, claim: (p?: { text?: string }) => Promise<unknown>) {
  const m = modal(`<h2 style="font-size:22px">Мысль с блока</h2>
    <div class="small muted" style="margin:4px 0 8px">Что ты уносишь с блока? От 80 символов. Мысли видит только организатор.</div>
    <textarea class="textarea" data-t placeholder="Мысль, которую уношу…"></textarea>
    <div class="small muted" data-n style="text-align:right">0 / 80</div>
    <button class="btn btn-gold btn-block" data-ok style="margin-top:6px">Отправить</button>`);
  const ta = $(m.root, '[data-t]') as HTMLTextAreaElement;
  ta.addEventListener('input', () => { $(m.root, '[data-n]').textContent = `${ta.value.trim().length} / 80`; });
  $(m.root, '[data-ok]').addEventListener('click', async () => {
    if (ta.value.trim().length < 80) { toast('Нужно хотя бы 80 символов', 'bad'); return; }
    m.close();
    await claim({ text: ta.value.trim() });
  });
}

async function openInvite(app: App) {
  await app.refreshClan();
  const c = app.clan;
  const n = c?.members.filter((x) => !x.bot).length ?? 1;
  const bot = import.meta.env.VITE_BOT_USERNAME as string | undefined;
  const link = bot ? `https://t.me/${bot}` : location.href.split('?')[0];
  const m = modal(`<h2 style="font-size:22px">Собрать всё ПБ</h2>
    <div class="small muted" style="margin:4px 0 10px">Когда в игру войдут все участники твоего ПБ из списка выезда, каждый получит +15 баллов. Играют только участники выезда — вход по ФИО.</div>
    <div class="card">В игре: <b class="gold">${n}</b> из ${c?.limit ?? 7}</div>
    <div class="card" style="word-break:break-all;margin-top:8px">${esc(link)}</div>
    <button class="btn btn-gold btn-block" data-copy style="margin-top:10px">Скопировать ссылку для своего ПБ</button>`);
  $(m.root, '[data-copy]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована', 'ok'); } catch { toast('Скопируй ссылку вручную', 'info'); }
  });
}

function openChannel(app: App, t: TaskDef, after: () => void) {
  const ch = (import.meta.env.VITE_TG_CHANNEL as string | undefined)?.replace(/^@/, '') ?? '';
  const url = ch ? `https://t.me/${ch}` : 'https://t.me/';
  const inTg = !!telegram()?.initData;
  const m = modal(`<h2 style="font-size:22px">Канал ППО</h2>
    <div class="small muted" style="margin:4px 0 10px">${inTg ? 'Подпишись на канал и нажми «Проверить» — бот сам посмотрит, есть ли ты в подписчиках. Без подписки баллы не начислятся.' : 'Подпишись на канал. Вне Telegram бот не может проверить подписку — отправь скриншот, его проверят организаторы.'}</div>
    <button class="btn btn-blue btn-block" data-open>${ch ? `Открыть @${esc(ch)}` : 'Открыть канал'}</button>
    ${inTg ? '<button class="btn btn-gold btn-block" data-check style="margin-top:8px">Проверить подписку</button>' : ''}
    <button class="btn ${inTg ? 'btn-ghost btn-sm' : 'btn-gold'} btn-block" data-shot style="margin-top:8px">Отправить скриншот подписки</button>`);
  $(m.root, '[data-open]').addEventListener('click', () => openExternal(url));
  m.root.querySelector('[data-check]')?.addEventListener('click', async () => {
    const r = await app.backend.checkSub(app.state);
    haptic(r.status === 'approved' ? 'ok' : 'bad');
    toast(r.message, r.status === 'approved' ? 'ok' : 'bad');
    if (r.status === 'approved') { m.close(); app.update(false); after(); }
  });
  $(m.root, '[data-shot]').addEventListener('click', () => { m.close(); formSubmit(app, { ...t, form: 'photo', hint: 'Скриншот: видно, что ты подписан на канал' }, after); });
}

function formSubmit(app: App, t: TaskDef, after: () => void) {
  const needText = t.form === 'text' || t.form === 'text+photo';
  const needLink = t.form === 'link' || t.form === 'link+photo';
  const needPhoto = t.form === 'photo' || t.form === 'text+photo';
  const allowPhoto = needPhoto || t.form === 'link+photo';
  const minT = t.minText ?? 20, maxT = t.maxText ?? 4000;
  let photo: Blob | null = null;
  const m = modal(`<h2 style="font-size:20px">${esc(t.title)}</h2>
    <div class="small muted" style="margin:4px 0 10px">${esc(t.hint ?? t.how)} · проверят организаторы, начислится <b class="gold">${esc(t.rating)}</b>. Ответ придёт уведомлением.</div>
    ${needText ? `<textarea class="textarea" data-text placeholder="Текст…" maxlength="${maxT}"></textarea><div class="small muted" data-tn style="text-align:right">0 / ${minT}–${maxT}</div>` : ''}
    ${needLink ? `<input class="input-ans" data-link inputmode="url" placeholder="${t.form === 'link' ? 'Ссылка, https://…' : 'Ссылка (или прикрепи скрин)'}" style="margin-bottom:8px">` : ''}
    ${allowPhoto ? `<label class="btn btn-blue btn-block" style="margin-top:8px">${icon('camera', 18)} <span data-pl>${needPhoto ? 'Прикрепить фото' : 'Прикрепить скрин (необязательно)'}</span><input type="file" accept="image/*" data-file hidden></label><img class="sub-photo hidden" data-prev alt="Предпросмотр" style="margin-top:8px">` : ''}
    <button class="btn btn-gold btn-block" data-ok style="margin-top:10px">Отправить на проверку</button>`);
  const ta = m.root.querySelector<HTMLTextAreaElement>('[data-text]');
  ta?.addEventListener('input', () => { $(m.root, '[data-tn]').textContent = `${ta.value.trim().length} / ${minT}–${maxT}`; });
  const file = m.root.querySelector<HTMLInputElement>('[data-file]');
  file?.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    photo = await compressImage(f).catch(() => f);
    const prev = $(m.root, '[data-prev]') as HTMLImageElement;
    prev.src = URL.createObjectURL(photo);
    prev.classList.remove('hidden');
    $(m.root, '[data-pl]').textContent = 'Заменить фото';
  });
  $(m.root, '[data-ok]').addEventListener('click', async () => {
    const text = (m.root.querySelector<HTMLTextAreaElement>('[data-text]')?.value ?? '').trim();
    const link = (m.root.querySelector<HTMLInputElement>('[data-link]')?.value ?? '').trim();
    if (needText && text.length < minT) { toast(`Нужно от ${minT} символов`, 'bad'); return; }
    if (needText && text.length > maxT) { toast(`Не больше ${maxT} символов`, 'bad'); return; }
    if (needPhoto && !photo) { toast('Прикрепи фото', 'bad'); return; }
    if (t.form === 'link' && !/^https?:\/\/\S+\.\S+/.test(link)) { toast('Нужна ссылка, которая начинается с https://', 'bad'); return; }
    if (needLink && !link && !photo) { toast('Нужна ссылка или скриншот', 'bad'); return; }
    const btn = $(m.root, '[data-ok]') as HTMLButtonElement;
    btn.disabled = true; btn.textContent = 'Отправляю…';
    const r = await app.backend.submitTask(app.state, t.id, { text, link, photo: photo ?? undefined });
    if (r.status === 'error') { toast(r.message, 'bad'); btn.disabled = false; btn.textContent = 'Отправить на проверку'; return; }
    m.close();
    toast(r.message, 'ok');
    subsCache.unshift({ id: `local${Date.now()}`, task: t.id, at: Date.now(), status: 'pending' });
    app.update(false); after();
  });
}
