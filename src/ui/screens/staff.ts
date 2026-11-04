// Панель организатора: QR-отметка, проверка заданий и вопросов, начисления, мерч и выдача, эфир, список выезда, карта, настройки.
import { TASKS, taskById } from '../../config/tasks';
import { FACTIONS, factionById } from '../../config/factions';
import { MAP_EVENTS } from '../../config/map';
import { gameById } from '../../config/minigames';
import { DEFAULT_AUTO, merchPrice, type MerchItem, type MerchOrder } from '../../config/merch';
import { economyPlan } from '../../config/economy-plan';
import { icon, starSvg } from '../../art/icons';
import type { Announcement, DutyZone, PlayerRef, RosterRow, Submission, TeamMember, UserQuestion } from '../../core/backend';
import { rightAnswerText } from '../../core/questions';
import { haptic } from '../../core/telegram';
import { canScanAny, scanAny } from '../../lib/scan';
import { $, el, esc, fmt, onAct, toast } from '../../lib/dom';
import type { App } from '../app';
import { openProjector } from './projector';
import { drawQrStation } from './qrstation';
import { STAFF_TOUR, maybeStaffTour, runTour } from '../tour';

type Tab = 'team' | 'qr' | 'mod' | 'grant' | 'merch' | 'issue' | 'live' | 'roster' | 'war' | 'set' | 'help';
const TABS: [Tab, string][] = [['team', 'Команда'], ['qr', 'QR-отметка'], ['mod', 'Проверка'], ['grant', 'Начислить'], ['merch', 'Мерч'], ['issue', 'Выдача'], ['live', 'Эфир'], ['roster', 'Участники'], ['war', 'Карта'], ['set', 'Настройки'], ['help', 'Гайд']];
let lastTab: Tab = 'team';
const ZONES: [DutyZone, string, string][] = [
  ['mod', 'Проверка заданий', 'clipboard'], ['qr', 'QR на блоках', 'qr'], ['merch', 'Мерч и выдача', 'bag'], ['live', 'Эфир и экран', 'chat'],
  ['map', 'Карта и мероприятия', 'map'], ['help', 'Помощь участникам', 'users'], ['free', 'Свободен', 'clock'],
];
const zoneName = (z: DutyZone) => ZONES.find((x) => x[0] === z)?.[1] ?? z;
const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : `${Math.floor(m / 60)} ч назад`; };
const REASONS = ['Не видно, что задание выполнено', 'Нужна ссылка, а не скрин', 'Не по условиям задания', 'Повтор чужой работы'];

export function openStaff(app: App) {
  let tab: Tab = lastTab;
  const node = el(`<div class="screen full"><div class="page">
    <div class="row"><button class="btn btn-ghost btn-sm" data-act="exit" aria-label="Назад">${icon('back', 18)}</button><h1 class="grow" style="font-size:24px">Организатор</h1>
      <button class="btn btn-gold btn-sm" data-act="screen">${icon('trophy', 16)} Экран</button></div>
    ${app.backend.mode === 'demo' ? '<div class="small muted">Демо: всё работает на твоём аккаунте и ботах — чтобы проверить весь путь до выезда.</div>' : ''}
    <div class="chips">${TABS.map(([k, n]) => `<button class="chip ${k === tab ? 'on' : ''}" data-act="tab" data-v="${k}">${n}</button>`).join('')}</div>
    <div data-body class="col" style="gap:10px"></div>
    <datalist id="reasons">${REASONS.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
  </div></div>`);
  const body = $(node, '[data-body]');
  let stopTimer = () => {};

  // ---------- Команда: кто на какой зоне ----------
  const drawTeam = async () => {
    body.innerHTML = '<div class="muted">Загрузка…</div>';
    const team: TeamMember[] = await app.backend.staffTeam().catch(() => []);
    const me = team.find((x) => x.me);
    let zone: DutyZone = me?.zone ?? 'free';
    body.innerHTML = `<div class="card col" style="gap:8px"><b>Я сейчас на</b>
        <div class="zone-grid">${ZONES.map(([z, n, ic]) => `<button class="zone ${z === zone ? 'on' : ''}" data-z="${z}">${icon(ic, 18)}<span>${n}</span></button>`).join('')}</div>
        <input class="input-ans" data-znote maxlength="60" placeholder="Уточнение: «ИРЭ и ИЭЭ», «блок 3, актовый», «стол у входа»" value="${esc(me?.note ?? '')}">
        <button class="btn btn-gold btn-block" data-act="zsave">Сохранить</button></div>
      <div class="howto small"><b>Как делимся, чтобы не делать одно и то же</b><br>
        • <b>Проверка:</b> «Проверка» → «Взять 5». Эти сдачи 10 минут видишь только ты, остальные их не тронут.<br>
        • <b>QR на блоке</b> открывает один человек. Если такая отметка уже открыта, игра покажет её QR, а не создаст вторую.<br>
        • <b>Мерч</b> выдаёт один стол. Остальные отправляют участников туда.<br>
        • Сменил зону — отметь здесь, чтобы все видели.</div>
      <div class="section-h">Состав · ${team.length}</div>
      <div class="list">${team.map((m) => `<div class="li ${m.me ? 'me' : ''}"><div class="grow"><b>${esc(m.name)}</b>${m.role === 'admin' ? ' <span class="small muted">админ</span>' : ''}
          <div class="small"><span class="tag" style="background:${m.zone === 'free' ? '#ffffff14' : '#ffc83d33'}">${esc(zoneName(m.zone))}</span>${m.note ? ` ${esc(m.note)}` : ''}</div>
          <div class="small muted">${m.reviewed ? `проверил сегодня ${m.reviewed}` : 'сегодня не проверял'}${m.holding ? ` · держит ${m.holding}` : ''}${m.qrOpen ? ` · открыто QR: ${m.qrOpen}` : ''} · ${ago(m.at)}</div></div></div>`).join('') || '<div class="muted small">Состав пока не входил в игру</div>'}</div>`;
    body.querySelectorAll<HTMLElement>('.zone').forEach((b) => b.addEventListener('click', () => {
      zone = b.dataset.z as DutyZone;
      body.querySelectorAll('.zone').forEach((x) => x.classList.toggle('on', x === b));
    }));
    $(body, '[data-act="zsave"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      await app.backend.staffSetDuty(zone, ($(body, '[data-znote]') as HTMLInputElement).value.trim()).catch((er: Error) => toast(er.message, 'bad'));
      toast(`Ты на зоне «${zoneName(zone)}»`, 'ok'); haptic('ok'); drawTeam();
    });
  };

  // ---------- Модерация ----------
  const drawMod = async () => {
    body.innerHTML = '<div class="muted">Загрузка…</div>';
    const [subsAll, qs] = await Promise.all([app.backend.staffSubmissions().catch(() => [] as Submission[]), app.backend.staffQuestions().catch(() => [] as UserQuestion[])]);
    const subs = subsAll.filter((x) => x.status === 'pending');
    const mine = subs.filter((x) => x.claimedMine);
    const others = subs.filter((x) => x.claimedBy && !x.claimedMine);
    const free = subs.filter((x) => !x.claimedBy);
    const pq = qs.filter((q) => q.status === 'pending');
    body.innerHTML = `<div class="card col" style="gap:8px">
        <div class="row" style="gap:10px;justify-content:space-around;text-align:center">
          <div><b style="font-size:22px">${free.length}</b><div class="small muted">свободно</div></div>
          <div><b style="font-size:22px;color:var(--gold2)">${mine.length}</b><div class="small muted">у меня</div></div>
          <div><b style="font-size:22px">${others.length}</b><div class="small muted">у других</div></div></div>
        <div class="row" style="gap:8px"><button class="btn btn-gold grow" data-act="claim" ${free.length ? '' : 'disabled'}>Взять 5 на проверку</button>
          ${mine.length ? '<button class="btn btn-ghost btn-sm" data-act="release">Вернуть мои</button>' : ''}</div>
        <div class="small muted">Взятые сдачи 10 минут закреплены за тобой — другие организаторы их не проверят. Принять — баллы сразу и «✅ принято» участнику. Отклонить — «❌» с причиной, он сдаст заново.</div></div>
      ${mine.length ? mine.map((x) => subCard(x)).join('') : `<div class="card muted center small">${free.length ? 'Нажми «Взять 5» — и проверяй.' : 'Сдач на проверку нет 🎉'}</div>`}
      ${others.length ? `<div class="section-h">Проверяют другие</div><div class="list">${others.map((x) => `<div class="li small"><span class="grow">${esc(taskById(x.task)?.title ?? x.task)} · ${esc(x.player)}</span><span class="tag">${esc(x.claimedBy ?? '')}</span></div>`).join('')}</div>` : ''}
      ${free.length ? `<div class="section-h">В очереди · ${free.length}</div><div class="list">${free.slice(0, 12).map((x) => `<div class="li small"><span class="grow">${esc(taskById(x.task)?.title ?? x.task)}</span><span class="muted">${new Date(x.at + 3 * 3600_000).toISOString().slice(11, 16)}</span></div>`).join('')}</div>` : ''}
      <div class="section-h">Вопросы от участников · ${pq.length}</div>
      ${pq.map((q) => `<div class="card col" data-q="${esc(q.id)}" style="gap:6px"><div class="small muted">${esc(q.author ?? '')} · ${esc(q.topic)} · ${q.format === 'yesno' ? 'да/нет' : q.format === 'choice' ? 'выбор' : 'ввод'}</div>
        <b>${esc(q.question)}</b>${q.format === 'choice' ? `<div class="small">${(q.options ?? []).map((o, i) => `${i === q.correct ? '✅' : '▫️'} ${esc(o)}`).join('<br>')}</div>` : `<div class="small">Ответ: <b class="gold">${esc(rightAnswerText(q))}</b></div>`}
        ${q.explanation ? `<div class="small muted">${esc(q.explanation)}</div>` : ''}
        <div class="row" style="gap:8px"><button class="btn btn-green btn-sm grow" data-act="qok" data-id="${esc(q.id)}">В общий банк</button><button class="btn btn-ghost btn-sm" data-act="qno" data-id="${esc(q.id)}">Отклонить</button></div></div>`).join('') || '<div class="small muted">Новых вопросов нет</div>'}`;
  };
  const subCard = (x: Submission) => {
    const t = taskById(x.task);
    const f = factionById(x.faction);
    return `<div class="card col" data-sub="${x.id}">
      <div class="row"><b class="grow">${esc(x.player)}</b><span class="tag" style="background:${f.color}44">${f.short}</span></div>
      <div class="small muted">${esc(t?.title ?? x.task)} · ${new Date(x.at + 3 * 3600_000).toISOString().slice(11, 16)}</div>
      ${x.text ? `<div class="explain" style="white-space:pre-wrap">${esc(x.text)}</div>` : ''}
      ${x.photo ? `<img class="sub-photo" src="${esc(x.photo)}" alt="Фото к заданию">` : ''}
      ${x.text && /https?:\/\//.test(x.text) ? `<div class="small">${x.text.split(/\s+/).filter((w) => /^https?:\/\//.test(w)).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.slice(0, 60))}</a>`).join('<br>')}</div>` : ''}
      <div class="row" style="gap:8px"><input class="input-ans" style="height:44px;width:90px" type="number" min="0" max="500" value="${t?.amount ?? 20}" data-amt aria-label="Баллы">
        <button class="btn btn-green btn-sm grow" data-act="ok" data-id="${x.id}">Принять</button></div>
      <div class="row" style="gap:8px"><input class="input-ans grow" style="height:40px" data-note list="reasons" placeholder="Причина отказа (увидит участник)"><button class="btn btn-red btn-sm" data-act="no" data-id="${x.id}">Отклонить</button></div>
    </div>`;
  };

  // ---------- Начислить ----------
  let picked: PlayerRef | null = null;
  const drawGrant = () => {
    const hostTasks = TASKS.filter((t) => t.check === 'host' || t.id === 'thought');
    body.innerHTML = `<div class="card col">
      <b>1. Найди участника</b>
      <input class="input-ans" data-q placeholder="Имя или фамилия">
      <div class="list" data-res></div>
      <b>2. За что</b>
      <select class="input-ans" data-task>${hostTasks.map((t) => `<option value="${t.id}" data-amt="${t.amount}">${esc(t.when)} — ${esc(t.title)} (${esc(t.rating)})</option>`).join('')}<option value="bonus" data-amt="10">Другое (бонус)</option></select>
      <b>3. Сколько баллов</b>
      <input class="input-ans" type="number" data-amt value="${hostTasks[0]?.amount ?? 20}">
      <input class="input-ans" data-note placeholder="Комментарий (необязательно)">
      <button class="btn btn-gold btn-block" data-act="grant">Начислить</button></div>`;
    const q = $(body, '[data-q]') as HTMLInputElement;
    const sel = $(body, '[data-task]') as HTMLSelectElement;
    sel.addEventListener('change', () => { ($(body, '[data-amt]') as HTMLInputElement).value = sel.selectedOptions[0].dataset.amt ?? '10'; });
    let timer = 0;
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const rows = q.value.trim().length >= 1 ? await app.backend.staffFindPlayers(q.value.trim()) : [];
        $(body, '[data-res]').innerHTML = rows.slice(0, 8).map((r) => `<button class="li ${picked?.id === r.id ? 'me' : ''}" data-act="pick" data-id="${r.id}" data-name="${esc(r.name)}" style="text-align:left"><span class="grow">${esc(r.name)}</span><span class="small muted">${factionById(r.faction).short} · ${fmt(r.rating)}</span></button>`).join('') || '<div class="small muted">Никого не нашли</div>';
      }, 250);
    });
  };

  // ---------- Мерч ----------
  const drawMerch = async () => {
    body.innerHTML = '<div class="muted">Загрузка…</div>';
    const items = await app.backend.merchList();
    const plan = economyPlan();
    const allKinds = items.reduce((a, it) => a + merchPrice(it).price, 0);
    body.innerHTML = `<div class="card col" style="gap:4px"><b>Хватит ли баллов на весь мерч</b>
        <div class="small">Один предмет каждого вида сейчас стоит <b class="gold">${fmt(allKinds)}</b> баллов. По расчёту заданий и игры за 5–8 ноября: минимум ~${fmt(plan.min)}, активный участник ~${fmt(plan.active)}, максимум ~${fmt(plan.max)}.</div>
        <div class="small ${allKinds <= plan.active ? 'muted' : ''}" style="${allKinds <= plan.active ? '' : 'color:#ff8a8a'}">${allKinds <= plan.active ? 'Активный участник может купить по одному каждого вида, пока товар не закончится.' : 'Дороже, чем набирает активный участник: снизьте цены или добавьте баллов за задания.'}</div></div>
      <div class="small muted">Цена — в баллах. Автоскидка: если товар не покупают N часов, цена снижается на шаг, до потолка. Ручная скидка — сразу.</div>
      ${items.map((it) => {
        const p = merchPrice(it);
        return `<div class="card col" data-item="${it.id}" style="gap:6px">
          <div class="row"><span style="font-size:26px">${esc(it.emoji)}</span><b class="grow">${esc(it.name)}</b><span class="small">${starSvg(12)} ${fmt(p.price)}${p.pct ? ` <span class="gold">(−${p.pct}%)</span>` : ''}</span></div>
          <div class="mgrid">
            <label>Осталось<input class="input-ans" type="number" data-f="stock" value="${it.stock}" min="0"></label>
            <label>Цена<input class="input-ans" type="number" data-f="price" value="${it.price}" min="1"></label>
            <label>Скидка %<input class="input-ans" type="number" data-f="discount" value="${it.discount}" min="0" max="90"></label>
            <label>В одни руки<input class="input-ans" type="number" data-f="perPerson" value="${it.perPerson}" min="1"></label>
          </div>
          <label class="row small" style="gap:6px"><input type="checkbox" data-f="auto" ${it.auto ? 'checked' : ''}> Автоскидка −${(it.auto ?? DEFAULT_AUTO).stepPct}% каждые ${(it.auto ?? DEFAULT_AUTO).afterHours} ч без продаж, до −${(it.auto ?? DEFAULT_AUTO).maxPct}%</label>
          <div class="row" style="gap:8px"><button class="btn btn-green btn-sm grow" data-act="msave" data-id="${it.id}">Сохранить</button><button class="btn btn-ghost btn-sm" data-act="mdel" data-id="${it.id}">Скрыть</button></div>
        </div>`;
      }).join('')}
      <div class="card col"><b>Добавить или обновить списком</b>
        <div class="small muted">По строке на товар: <b>Название; количество; цена</b>. Можно с эмодзи в начале и описанием четвёртым полем. Из Excel — просто вставь столбцы. Совпадение по названию обновляет количество и цену.</div>
        <textarea class="textarea" data-imp placeholder="🏷️ Ремувки; 3; 150&#10;Шоппер ППО; 5; 300; сумка с логотипом"></textarea>
        <button class="btn btn-gold btn-block" data-act="mimp">Загрузить</button></div>`;
  };

  // ---------- Выдача ----------
  const drawIssue = async () => {
    body.innerHTML = `<div class="card col"><b>Выдать по QR участника</b>
      <div class="small muted">Сканируй личный QR — покажем, что человек купил и ещё не забрал.</div>
      ${canScanAny() ? `<button class="btn btn-gold btn-block" data-act="iscan">${icon('camera', 18)} Сканировать QR</button>` : ''}
      <div class="row" style="gap:8px"><input class="input-ans grow" data-icode placeholder="Код под QR, 6 знаков" autocapitalize="characters"><button class="btn btn-blue btn-sm" data-act="ifind">Найти</button></div>
      <div data-iout></div></div>
      <div class="section-h">Все заказы</div><div data-ol class="col" style="gap:6px"><div class="muted">Загрузка…</div></div>`;
    const orders = await app.backend.staffOrders();
    $(body, '[data-ol]').innerHTML = orders.map((o) => orderCard(o)).join('') || '<div class="muted small">Заказов нет</div>';
  };
  const orderCard = (o: MerchOrder) => `<div class="card row small" style="gap:8px"><span style="font-size:22px">${esc(o.emoji)}</span>
    <div class="grow"><b>${esc(o.itemName)}</b> · ${esc(o.player ?? '')} ${o.faction ? `<span class="muted">${factionById(o.faction).short}</span>` : ''}<div class="muted">${starSvg(11)} ${fmt(o.price)} · код ${esc(o.id)} · ${o.status === 'reserved' ? 'ждёт выдачи' : o.status === 'issued' ? 'выдано' : 'отменён'}</div></div>
    ${o.status === 'reserved' ? `<button class="btn btn-green btn-sm" data-act="iss" data-id="${o.id}">Выдать</button><button class="btn btn-ghost btn-sm" data-act="icancel" data-id="${o.id}">Отмена</button>` : ''}</div>`;

  // ---------- Эфир ----------
  const drawLive = async () => {
    const list: Announcement[] = await app.backend.liveFeed();
    body.innerHTML = `<div class="card col"><b>Сообщение всем</b>
      <div class="small muted">Появится вверху базы у всех игроков и на экране в актовом. Сообщения от Claude приходят сюда же — их публикуют через файл live.json в репозитории.</div>
      <textarea class="textarea" data-lt placeholder="Например: через 10 минут финальная стычка — отдайте приказы!" maxlength="500"></textarea>
      <div class="row" style="gap:8px"><select class="input-ans grow" data-lk><option value="info">Инфо</option><option value="alert">Важно</option><option value="win">Победа</option></select>
        <select class="input-ans grow" data-lm><option value="15">15 минут</option><option value="60" selected>1 час</option><option value="240">4 часа</option><option value="">Пока не удалю</option></select></div>
      <button class="btn btn-gold btn-block" data-act="lpost">Отправить в эфир</button></div>
      <div class="col" style="gap:6px">${list.map((a) => `<div class="card row small"><div class="grow"><div style="white-space:pre-wrap">${esc(a.text)}</div><div class="muted">${a.source === 'claude' ? 'Claude · live.json' : esc(a.author ?? 'организатор')} · ${new Date(a.at + 3 * 3600_000).toISOString().slice(11, 16)}${a.until ? ` · до ${new Date(a.until + 3 * 3600_000).toISOString().slice(11, 16)}` : ''}</div></div>
        ${a.source !== 'claude' ? `<button class="btn btn-ghost btn-sm" data-act="ldel" data-id="${a.id}">Убрать</button>` : ''}</div>`).join('')}</div>`;
  };

  // ---------- Участники ----------
  const drawRoster = async () => {
    body.innerHTML = '<div class="muted">Загрузка…</div>';
    const rows: RosterRow[] = await app.backend.staffRoster();
    const by = FACTIONS.map((f) => ({ f, rows: rows.filter((r) => r.faction === f.id) })).filter((x) => x.rows.length);
    body.innerHTML = `<div class="card col"><b>Загрузить список выезда</b>
      <div class="small muted">Вставь из таблицы столбцы <b>Институт; ФИО; Группа; Должность; Роль</b> (роль: участник / организатор / админ). Телефоны не нужны. Повторная загрузка обновляет строки по ФИО. В ПБ — не больше 7 участников.</div>
      <textarea class="textarea" data-rimp placeholder="ИРЭ; Иванова Анна Сергеевна; ЭР-23-24; Активист; участник"></textarea>
      <button class="btn btn-gold btn-block" data-act="rimp">Загрузить</button></div>
      <div class="small muted">Всего ${rows.length}: участников ${rows.filter((r) => r.role === 'participant').length}, состава ${rows.filter((r) => r.role !== 'participant').length}. В игре — ${rows.filter((r) => r.bound).length}.</div>
      ${by.map(({ f, rows: rs }) => `<div class="card col" style="gap:4px"><div class="row"><b class="grow">${f.short}</b><span class="small muted">${rs.filter((r) => r.bound).length}/${rs.length} в игре</span></div>
        ${rs.map((r) => `<div class="row small" style="gap:6px"><span class="grow">${esc(r.fio)} <span class="muted">${esc(r.group)}${r.role !== 'participant' ? ` · ${r.role === 'admin' ? 'админ' : 'орг.'}` : ''}</span></span>
          ${r.bound ? `<span class="tag" style="background:#2fbf7133">${r.tg ? 'Telegram' : 'браузер'}</span><button class="btn btn-ghost btn-sm" data-act="rreset" data-id="${r.id}" title="Сбросить привязку">Сброс</button>` : '<span class="tag">не входил</span>'}</div>`).join('')}</div>`).join('')}
      <div class="small muted">«Сброс» нужен, если человек сменил телефон или кто-то вошёл под чужим ФИО: привязка снимается, прогресс остаётся, войти можно заново по ФИО и группе.</div>`;
  };

  // ---------- Карта ----------
  const drawWar = () => {
    body.innerHTML = `<div class="card col"><b>Стычки</b><div class="small muted">Провести раунд прямо сейчас по текущим приказам — для теста и для финального раунда.</div>
      <button class="btn btn-red btn-block" data-act="force">Провести раунд сейчас</button></div>
      <div class="card col"><b>Запустить мероприятие сейчас</b><div class="small muted">${app.cfg.testMode ? 'Тест-режим: мероприятие начнётся сразу и продлится 20 минут.' : 'Боевой режим: мероприятия идут по расписанию. Запуск вручную — только если что-то сдвинулось.'}</div>
      <div class="list">${MAP_EVENTS.map((e) => `<div class="li"><div class="grow"><b>${esc(e.name)}</b><div class="small muted">${esc(gameById(e.game).name)} · трофей «${esc(e.trophy)}»</div></div><button class="btn btn-blue btn-sm" data-act="ev" data-id="${e.id}">Запустить</button></div>`).join('')}</div></div>`;
  };

  // ---------- Гайд организатора ----------
  const drawHelp = () => {
    body.innerHTML = `<button class="btn btn-gold btn-block" data-act="stour">${icon('play', 18)} Пройти обучение по панели</button>
      ${GUIDE.map(([t, steps]) => `<details class="faq"><summary>${esc(t)}</summary><ol class="small guide-ol">${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>`).join('')}`;
  };

  // ---------- Настройки ----------
  const drawSet = async () => {
    const c = await app.backend.config();
    app.cfg = c;
    body.innerHTML = `<div class="card col">
      <label class="row" style="gap:10px"><input type="checkbox" data-set="shop_open" ${c.shopOpen ? 'checked' : ''}><div class="grow"><b>Магазин мерча открыт</b><div class="small muted">Пока закрыт — товары видно, купить нельзя.</div></div></label>
      <label class="row" style="gap:10px"><input type="checkbox" data-set="require_group" ${c.requireGroup ? 'checked' : ''}><div class="grow"><b>Вход по ФИО + группа</b><div class="small muted">Группа отсекает тёзок и посторонних. Выключить — вход только по ФИО.</div></div></label>
      <div class="small muted">Режим: ${c.testMode ? '<b class="gold">тестовый</b> — стычки каждые 10 минут, мероприятие всегда идёт' : 'боевой, по расписанию выезда'}.</div></div>
      <button class="btn btn-gold btn-block" data-act="screen">${icon('trophy', 18)} Экран для актового</button>`;
    body.querySelectorAll<HTMLInputElement>('[data-set]').forEach((i) => i.addEventListener('change', async () => {
      await app.backend.staffSetSetting(i.dataset.set as 'shop_open' | 'require_group', i.checked).catch((e: Error) => toast(e.message, 'bad'));
      app.cfg = await app.backend.config();
      toast('Сохранено', 'ok');
    }));
  };

  const draw = () => {
    stopTimer(); stopTimer = () => {};
    lastTab = tab;
    node.querySelectorAll<HTMLElement>('.chip').forEach((c) => c.classList.toggle('on', c.dataset.v === tab));
    ({ team: drawTeam, help: drawHelp, qr: () => drawQrStation(app, body, draw), mod: drawMod, grant: drawGrant, merch: drawMerch, issue: drawIssue, live: drawLive, roster: drawRoster, war: drawWar, set: drawSet })[tab]();
  };

  const findOrders = async (code: string) => {
    const r = await app.backend.staffOrdersByCode(code);
    const out = $(body, '[data-iout]');
    if ('error' in r) { out.innerHTML = `<div class="small" style="color:var(--red)">${esc(r.error)}</div>`; haptic('bad'); return; }
    out.innerHTML = `<div class="small"><b>${esc(r.player)}</b>: ${r.orders.length ? 'к выдаче' : 'ничего не ждёт'}</div>${r.orders.map((o) => orderCard(o)).join('')}`;
    haptic('ok');
  };

  onAct(node, {
    exit: () => app.closeOverlay(),
    screen: () => openProjector(app),
    tab: (t) => { tab = t.dataset.v as Tab; draw(); },
    claim: async () => { const n = await app.backend.staffClaim(5).catch((e: Error) => { toast(e.message, 'bad'); return -1; }); if (n >= 0) { haptic('ok'); toast(`У тебя на проверке: ${n}`, 'ok'); } drawMod(); },
    release: async () => { await app.backend.staffRelease().catch(() => {}); toast('Вернул в общую очередь', 'info'); drawMod(); },
    stour: () => runTour(app, STAFF_TOUR),
    ok: async (t) => {
      const card = t.closest('[data-sub]')!;
      const amt = Number((card.querySelector('[data-amt]') as HTMLInputElement).value) || 0;
      await app.backend.staffReview(t.dataset.id!, true, amt).catch((e: Error) => toast(e.message, 'bad'));
      haptic('ok'); toast(`Принято: +${amt}. Участнику ушло уведомление`, 'ok'); app.update(false); app.refreshNotes(); drawMod();
    },
    no: async (t) => {
      const card = t.closest('[data-sub]')!;
      const note = (card.querySelector('[data-note]') as HTMLInputElement).value.trim();
      await app.backend.staffReview(t.dataset.id!, false, 0, note || undefined).catch((e: Error) => toast(e.message, 'bad'));
      toast('Отклонено — участник получит причину', 'info'); app.refreshNotes(); drawMod();
    },
    qok: async (t) => { await app.backend.staffQuestionReview(t.dataset.id!, true).catch((e: Error) => toast(e.message, 'bad')); toast('Вопрос добавлен в банк', 'ok'); drawMod(); },
    qno: async (t) => { await app.backend.staffQuestionReview(t.dataset.id!, false).catch((e: Error) => toast(e.message, 'bad')); toast('Вопрос отклонён', 'info'); drawMod(); },
    pick: (t) => {
      picked = { id: t.dataset.id!, name: t.dataset.name!, faction: null, rating: 0 };
      body.querySelectorAll('[data-act="pick"]').forEach((b) => b.classList.toggle('me', b === t));
    },
    grant: async () => {
      if (!picked) { toast('Сначала выбери участника', 'bad'); return; }
      const task = ($(body, '[data-task]') as HTMLSelectElement).value;
      const amt = Number(($(body, '[data-amt]') as HTMLInputElement).value) || 0;
      const note = ($(body, '[data-note]') as HTMLInputElement).value.trim();
      const msg = await app.backend.staffGrant(picked.id, task, amt, note).catch((e: Error) => e.message);
      toast(msg, 'ok'); app.update(false);
    },
    msave: async (t) => {
      const card = body.querySelector<HTMLElement>(`[data-item="${t.dataset.id}"]`)!;
      const v = (f: string) => Number((card.querySelector(`[data-f="${f}"]`) as HTMLInputElement).value);
      const auto = (card.querySelector('[data-f="auto"]') as HTMLInputElement).checked;
      const items = await app.backend.merchList();
      const it = items.find((x) => x.id === t.dataset.id)!;
      const patch: Partial<MerchItem> & { name: string } = { id: it.id, name: it.name, stock: Math.max(0, v('stock')), price: Math.max(1, v('price')), discount: Math.max(0, Math.min(90, v('discount'))), perPerson: Math.max(1, v('perPerson')), auto: auto ? it.auto ?? DEFAULT_AUTO : null };
      await app.backend.staffMerchSave(patch).catch((e: Error) => toast(e.message, 'bad'));
      toast('Сохранено', 'ok'); drawMerch();
    },
    mdel: async (t) => { await app.backend.staffMerchDelete(t.dataset.id!); toast('Товар скрыт', 'info'); drawMerch(); },
    mimp: async () => { const msg = await app.backend.staffMerchImport(($(body, '[data-imp]') as HTMLTextAreaElement).value).catch((e: Error) => e.message); toast(msg, 'ok'); drawMerch(); },
    iscan: async () => { const c = await scanAny('QR участника'); if (c) findOrders(c); },
    ifind: () => { const v = ($(body, '[data-icode]') as HTMLInputElement).value.trim(); if (v) findOrders(v); },
    iss: async (t) => { await app.backend.staffOrderSet(t.dataset.id!, 'issued').catch((e: Error) => toast(e.message, 'bad')); haptic('ok'); toast('Выдано', 'ok'); drawIssue(); },
    icancel: async (t) => { await app.backend.staffOrderSet(t.dataset.id!, 'cancelled').catch((e: Error) => toast(e.message, 'bad')); toast('Заказ отменён, баллы и товар вернулись', 'info'); drawIssue(); },
    lpost: async () => {
      const text = ($(body, '[data-lt]') as HTMLTextAreaElement).value.trim();
      if (text.length < 3) { toast('Напиши сообщение', 'bad'); return; }
      const kind = ($(body, '[data-lk]') as HTMLSelectElement).value as Announcement['kind'];
      const mv = ($(body, '[data-lm]') as HTMLSelectElement).value;
      await app.backend.staffAnnounce({ text, kind, minutes: mv ? Number(mv) : null }).catch((e: Error) => toast(e.message, 'bad'));
      await app.refreshLive();
      toast('Отправлено в эфир', 'ok'); drawLive();
    },
    ldel: async (t) => { await app.backend.staffAnnounceDelete(t.dataset.id!); await app.refreshLive(); drawLive(); },
    rimp: async () => { const msg = await app.backend.staffRosterImport(($(body, '[data-rimp]') as HTMLTextAreaElement).value).catch((e: Error) => e.message); toast(msg, 'ok'); drawRoster(); },
    rreset: async (t) => { const msg = await app.backend.staffRosterReset(t.dataset.id!).catch((e: Error) => e.message); toast(msg, 'info'); drawRoster(); },
    force: async () => { await app.backend.staffForceRound(); toast('Раунд проведён — открой карту', 'ok'); },
    ev: async (t) => { await app.backend.staffStartEvent(t.dataset.id!).catch((e: Error) => toast(e.message, 'bad')); toast('Мероприятие запущено — оно на карте и в «Играх»', 'ok'); },
  });
  node.addEventListener('close', () => stopTimer());
  app.openOverlay(node);
  draw();
  maybeStaffTour(app);
}

/** Короткий гайд прямо в панели — полная версия в документе «Гайд организатора ШПА». */
const GUIDE: [string, string[]][] = [
  ['Перед началом смены', ['Открой «Орг.» → «Команда» и отметь свою зону: проверка, QR, мерч, эфир, карта или помощь.', 'Посмотри, кто чем занят — не берите одну и ту же зону вдвоём без нужды.', 'Проверь связь: открой «Проверка» — если список грузится, всё в порядке.']],
  ['Отметка на блоке (QR)', ['«QR-отметка» → вид «Блок / лекция» → выбери название блока → «Открыть и показать QR».', 'Покажи телефон залу или нажми «На большой экран» на ноутбуке у проектора. QR и код меняются каждые 20 секунд — фото в чат не поможет.', 'Участники: вкладка «QR» внизу → «Сканировать» или ввести 6 знаков.', 'Отметку закрой в конце блока («Закрыть отметку»). Если такая уже открыта коллегой — игра покажет её, вторую не создаст.']],
  ['«Я — скорость»', ['«QR-отметка» → «Я — скорость». Баллы получают только первые N (по умолчанию 5).', 'QR статичный: сделай скриншот, распечатай или спрячь — работает, пока открыта отметка.']],
  ['Проверка заданий', ['«Проверка» → «Взять 5». Сдачи закрепляются за тобой на 10 минут.', 'Смотри фото, ссылку или текст. Баллы подставлены по заданию — можно поправить.', '«Принять» — баллы сразу, участнику «✅ принято» в игре и в боте.', '«Отклонить» — обязательно напиши причину (есть готовые). Участник сможет сдать заново.', 'Уходишь — «Вернуть мои», чтобы сдачи не ждали 10 минут.']],
  ['Начислить баллы вручную', ['«Начислить» → найди участника по фамилии → выбери, за что → сколько баллов → «Начислить».', 'Для активности на блоке, лучшего вопроса, помощи, конкурсов ведущего.']],
  ['Мерч и выдача', ['«Мерч»: цены, остатки, скидки. Вверху — хватает ли баллов активному участнику на весь набор.', '«Настройки» → «Магазин мерча открыт» — когда решите открыть покупки.', '«Выдача»: участник показывает «Мой QR» → «Сканировать QR» → «Выдать».', 'Ошиблись — «Отмена»: товар и баллы вернутся.']],
  ['Эфир и экран', ['«Эфир»: сообщение всем — вверху базы у каждого и на экране зала.', 'Кнопка «Экран» — на ноутбук у проектора: рейтинг ПБ, эфир, QR открытой отметки.']],
  ['Карта и мероприятия', ['«Карта»: «Провести раунд сейчас» — для финала или теста.', 'Запустить мероприятие вручную — если расписание сдвинулось.']],
  ['Участники', ['«Участники»: список выезда по ПБ, кто вошёл.', '«Сброс» — если человек сменил телефон или вошёл под чужим ФИО. Прогресс сохраняется.']],
];
