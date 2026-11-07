// Панель организатора: QR-отметка, проверка заданий и вопросов, начисления, мерч и выдача, эфир, список выезда, карта, настройки.
import { TASKS, taskById } from '../../config/tasks';
import { FACTIONS, factionById } from '../../config/factions';
import { MAP_EVENTS } from '../../config/map';
import { gameById } from '../../config/minigames';
import { DEFAULT_AUTO, merchPrice, type MerchItem, type MerchOrder } from '../../config/merch';
import { economyPlan } from '../../config/economy-plan';
import { icon, starSvg } from '../../art/icons';
import type { Announcement, CodeWord, DutyZone, PlayerRef, RosterRow, Submission, TeamMember, UserQuestion } from '../../core/backend';
import { rightAnswerText } from '../../core/questions';
import { haptic } from '../../core/telegram';
import { canScanAny, scanAny } from '../../lib/scan';
import { $, el, esc, fmt, onAct, toast } from '../../lib/dom';
import type { App } from '../app';
import { openProjector } from './projector';
import { openVoteBoard } from './voteboard';
import { openCasinoBoard } from '../../games/wheel';
import { VOTE_DEFAULT_TITLE, defaultVoteTeams, parseVoteTeams, voteRank, voteScore, type VoteAction, type VoteState } from '../../core/vote';
import { drawQrStation } from './qrstation';
import { STAFF_TOUR, maybeStaffTour, runTour } from '../tour';

type Tab = 'team' | 'qr' | 'mod' | 'grant' | 'words' | 'merch' | 'issue' | 'live' | 'vote' | 'roster' | 'war' | 'set' | 'help';
const TABS: [Tab, string][] = [['team', 'Команда'], ['qr', 'QR-отметка'], ['mod', 'Проверка'], ['grant', 'Начислить'], ['words', 'Слова'], ['merch', 'Мерч'], ['issue', 'Выдача'], ['live', 'Эфир'], ['vote', 'Голосование'], ['roster', 'Участники'], ['war', 'Карта'], ['set', 'Настройки'], ['help', 'Гайд']];
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
  const drawGrant = async () => {
    const cfg = await app.backend.config().catch(() => app.cfg);
    if (cfg.checkinHost && cfg.canCheckin === false) {
      body.innerHTML = `<div class="card col" style="gap:6px"><b>Баллы начисляет ${esc(cfg.checkinHost.name)}</b>
        <div class="small muted">Так решили организаторы: отмечает и начисляет один человек, чтобы ничего не задвоилось. Победителей, лучших спикеров и активных — передай ему. Сменить можно в «Настройках» (админы).</div></div>`;
      return;
    }
    const hostTasks = TASKS.filter((t) => t.check === 'host' || t.id === 'thought');
    body.innerHTML = `<div class="card col">
      <b>1. Найди участника</b>
      <input class="input-ans" data-q placeholder="Имя или фамилия">
      <div class="list" data-res></div>
      <b>2. За что</b>
      <select class="input-ans" data-task>${hostTasks.map((t) => `<option value="${t.id}" data-def="${t.amount}">${esc(t.when)} — ${esc(t.title)} (${esc(t.rating)})</option>`).join('')}<option value="bonus" data-def="10">Другое (бонус)</option></select>
      <b>3. Сколько баллов</b>
      <input class="input-ans" type="number" inputmode="numeric" min="1" max="500" data-amount value="${hostTasks[0]?.amount ?? 20}">
      <input class="input-ans" data-note maxlength="200" placeholder="Комментарий или причина — увидит участник">
      <div class="row" style="gap:8px"><button class="btn btn-gold grow" data-act="grant">${icon('plus', 16)} Начислить</button>
        <button class="btn btn-red" data-act="penalty">${icon('minus', 16)} Снять</button></div>
      <div class="small muted">«Снять» убирает столько баллов (не ниже нуля) — за нарушение правил или ошибочное начисление. Причину лучше написать.</div></div>`;
    const q = $(body, '[data-q]') as HTMLInputElement;
    const sel = $(body, '[data-task]') as HTMLSelectElement;
    // поле суммы — отдельный атрибут: у <option> раньше был тот же data-amt, и начислялась сумма по умолчанию, а не введённая
    sel.addEventListener('change', () => { ($(body, '[data-amount]') as HTMLInputElement).value = sel.selectedOptions[0].dataset.def ?? '10'; });
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
      <div class="small muted">Цена — в баллах. «−10% / +10%» меняют цену сразу. «Цена по остатку» — условия: когда осталось столько-то штук, цена становится такой-то (дороже или дешевле). Автоскидка: если товар не покупают N часов, цена снижается на шаг, до потолка.</div>
      ${items.map((it) => {
        const p = merchPrice(it);
        return `<div class="card col" data-item="${it.id}" style="gap:6px">
          <div class="row"><span style="font-size:26px">${esc(it.emoji)}</span><b class="grow">${esc(it.name)}</b><span class="small">${starSvg(12)} ${fmt(p.price)}${p.pct ? ` <span class="gold">(−${p.pct}%)</span>` : ''}</span></div>
          ${it.unlimited ? `<div class="small gold">Без ограничений: купили ${fmt(it.sold ?? 0)}, старт ${fmt(it.price)} и +${it.step ?? 0} за каждую покупку. «Осталось» здесь не важно.</div>` : ''}
          <div class="mgrid">
            <label>Осталось<input class="input-ans" type="number" data-f="stock" value="${it.stock}" min="0"></label>
            <label>Цена<input class="input-ans" type="number" data-f="price" value="${it.price}" min="1"></label>
            <label>Скидка %<input class="input-ans" type="number" data-f="discount" value="${it.discount}" min="0" max="90"></label>
            <label>В одни руки<input class="input-ans" type="number" data-f="perPerson" value="${it.perPerson}" min="1"></label>
          </div>
          <div class="row" style="gap:6px"><span class="small muted grow">Цена сейчас</span>
            <button class="btn btn-ghost btn-sm" data-act="mstep" data-id="${it.id}" data-k="0.9">−10%</button>
            <button class="btn btn-ghost btn-sm" data-act="mstep" data-id="${it.id}" data-k="1.1">+10%</button></div>
          <div class="col" style="gap:4px" data-tiers><span class="small"><b>Цена по остатку</b>${p.base !== it.price ? ` · <span class="gold">сейчас действует: ${fmt(p.base)}</span>` : ''}</span>
            ${(it.tiers ?? []).map((t) => tierRow(t.left, t.price)).join('')}
            <button class="btn btn-ghost btn-sm" data-act="tadd" data-id="${it.id}">${icon('plus', 14)} Условие</button></div>
          <label class="row small" style="gap:6px"><input type="checkbox" data-f="auto" ${it.auto ? 'checked' : ''}> Автоскидка −${(it.auto ?? DEFAULT_AUTO).stepPct}% каждые ${(it.auto ?? DEFAULT_AUTO).afterHours} ч без продаж, до −${(it.auto ?? DEFAULT_AUTO).maxPct}%</label>
          <div class="row" style="gap:8px"><button class="btn btn-green btn-sm grow" data-act="msave" data-id="${it.id}">Сохранить</button><button class="btn btn-ghost btn-sm" data-act="mdel" data-id="${it.id}">Скрыть</button></div>
        </div>`;
      }).join('')}
      <div class="card col"><b>Добавить или обновить списком</b>
        <div class="small muted">По строке на товар: <b>Название; количество; цена</b>. Можно с эмодзи в начале и описанием четвёртым полем. Из Excel — просто вставь столбцы. Совпадение по названию обновляет количество и цену.</div>
        <textarea class="textarea" data-imp placeholder="🏷️ Ремувки; 3; 150&#10;Шоппер ППО; 5; 300; сумка с логотипом"></textarea>
        <button class="btn btn-gold btn-block" data-act="mimp">Загрузить</button></div>`;
  };

  const tierRow = (left: number | '', price: number | '') => `<div class="row small tier-row" style="gap:6px">Осталось ≤
    <input class="input-ans" style="height:38px;width:64px" type="number" min="0" data-tl value="${left}"> — цена
    <input class="input-ans" style="height:38px;width:84px" type="number" min="1" data-tp value="${price}">
    <button class="btn btn-ghost btn-sm" data-act="tdel" aria-label="Убрать условие">✕</button></div>`;
  const readTiers = (card: HTMLElement) => Array.from(card.querySelectorAll<HTMLElement>('.tier-row')).map((r) => ({
    left: Math.max(0, Math.round(Number((r.querySelector('[data-tl]') as HTMLInputElement).value))),
    price: Math.round(Number((r.querySelector('[data-tp]') as HTMLInputElement).value)),
  })).filter((t) => Number.isFinite(t.left) && t.price > 0);

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
      <button class="btn btn-gold btn-block" data-act="lpost">Отправить в эфир</button>
      <div class="small muted">Сообщение появится в игре и придёт в бот «ШПА» всем, кто вошёл из Telegram.</div></div>
      <div class="col" style="gap:6px">${list.map((a) => `<div class="card row small"><div class="grow"><div style="white-space:pre-wrap">${esc(a.text)}</div><div class="muted">${a.source === 'claude' ? 'Claude · live.json' : esc(a.author ?? 'организатор')} · ${new Date(a.at + 3 * 3600_000).toISOString().slice(11, 16)}${a.until ? ` · до ${new Date(a.until + 3 * 3600_000).toISOString().slice(11, 16)}` : ''}</div></div>
        ${a.source !== 'claude' ? `<button class="btn btn-ghost btn-sm" data-act="ldel" data-id="${a.id}">Убрать</button>` : ''}</div>`).join('')}</div>`;
  };

  // ---------- Голосование «Работа со спонсорами» ----------
  const drawVote = async () => {
    body.innerHTML = '<div class="muted">Загрузка…</div>';
    let v: VoteState | null = await app.backend.voteState();
    const render = () => {
      const teamsText = (v?.teams.length ? v.teams : defaultVoteTeams()).map((t) => t.name).join('\n');
      const ranked = v ? voteRank(v.teams) : [];
      const st = !v ? 'нет связи' : v.reveal ? 'итог показан на экране' : v.status === 'open' ? (v.current ? `идёт: на сцене ${esc(v.teams.find((t) => t.id === v!.current)?.name ?? '')}` : 'идёт: за все команды сразу') : v.status === 'closed' ? 'закрыто' : 'ещё не открыто';
      body.innerHTML = `<div class="card col" style="gap:8px"><div class="row"><b class="grow">${esc(v?.title ?? VOTE_DEFAULT_TITLE)}</b><span class="tag" style="background:${v?.status === 'open' ? '#2fbf7144' : '#ffffff14'}">${st}</span></div>
          <div class="small muted">Включить можно в любой момент. Участники голосуют в игре кнопкой на базе: каждой команде ✅ или ❌, за свою нельзя, передумать можно, пока открыто. Итог = ✅ − ❌. В команду человек вписывается сам: ФИО + команда (можно записать и товарища).</div>
          <button class="btn btn-gold btn-block" data-act="vscreen">${icon('trophy', 18)} На экран в зале</button>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <button class="btn btn-green btn-sm grow" data-act="vctl" data-a="open">Открыть для всех</button>
            <button class="btn btn-ghost btn-sm grow" data-act="vctl" data-a="close">Закрыть</button>
            <button class="btn btn-blue btn-sm grow" data-act="vctl" data-a="${v?.reveal ? 'hide' : 'reveal'}">${v?.reveal ? 'Скрыть итог' : 'Показать итог'}</button></div></div>
        <div class="section-h">Счёт вживую · проголосовали ${fmt(v?.voters ?? 0)}</div>
        <div class="list">${ranked.map((t, i) => `<div class="li ${v?.current === t.id ? 'me' : ''}"><b style="width:22px">${i + 1}</b><div class="grow"><b>${esc(t.name)}</b><div class="small muted">✅ ${t.za} · ❌ ${t.protiv} · итог <b class="gold">${voteScore(t) > 0 ? '+' : ''}${voteScore(t)}</b> · в команде ${t.size ?? 0}</div></div>
          <button class="btn btn-ghost btn-sm" data-act="vctl" data-a="open" data-t="${esc(t.id)}">${v?.current === t.id ? 'На сцене' : 'Голосуем'}</button></div>`).join('') || '<div class="small muted">Команд пока нет</div>'}</div>
        <div class="card col" style="gap:8px"><b>Новое голосование</b>
          <input class="input-ans" data-vtitle maxlength="60" value="${esc(v?.title ?? VOTE_DEFAULT_TITLE)}" placeholder="Название">
          <div class="small muted">Команды — по строке, названия любые. Переименование и порядок строк сохраняют, кто в какой команде; голоса обнуляются.</div>
          <textarea class="textarea" data-vteams rows="6">${esc(teamsText)}</textarea>
          <div class="row" style="gap:8px"><button class="btn btn-gold grow" data-act="vsetup">Сохранить команды (голоса обнулятся)</button><button class="btn btn-ghost btn-sm" data-act="vctl" data-a="reset">Обнулить голоса</button></div></div>
        <div class="section-h">Составы команд</div><div class="col" style="gap:6px" data-vmembers><div class="small muted">Загрузка…</div></div>`;
      drawMembers();
    };
    const drawMembers = async () => {
      const box = body.querySelector<HTMLElement>('[data-vmembers]');
      if (!box) return;
      const ms = await app.backend.staffVoteMembers().catch(() => []);
      box.innerHTML = ms.map((t) => `<details class="card"><summary><b>${esc(t.name)}</b> · ${t.people.length} чел.</summary>
        ${t.people.map((p) => `<div class="row small" style="gap:6px;margin-top:4px"><span class="grow">${esc(p.name)}</span><button class="btn btn-ghost btn-sm" data-act="vkick" data-r="${esc(String(p.id))}">Убрать</button></div>`).join('') || '<div class="small muted">Пока никто не вписался</div>'}</details>`).join('') || '<div class="small muted">Команд пока нет</div>';
    };
    render();
    const t = window.setInterval(async () => {
      if (!body.isConnected || tab !== 'vote') return;
      const fresh = await app.backend.voteState().catch(() => null);
      // не перерисовываем, пока организатор печатает в форме
      if (fresh && !body.contains(document.activeElement as Node) && !body.querySelector('details[open]')) { v = fresh; render(); } else if (fresh) v = fresh;
    }, 2500);
    stopTimer = () => clearInterval(t);
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
          ${r.bound ? `<span class="tag" style="background:#2fbf7133">${r.tg ? 'Telegram' : 'браузер'}</span><button class="btn btn-ghost btn-sm" data-act="rreset" data-id="${r.id}" title="Сбросить привязку">Сброс</button>` : `<span class="tag">не входил</span>${app.backend.admin ? `<button class="btn btn-ghost btn-sm" data-act="rremove" data-id="${r.id}" title="Убрать из списка">Убрать</button>` : ''}`}</div>`).join('')}</div>`).join('')}
      <div class="small muted">«Сброс» нужен, если человек сменил телефон или кто-то вошёл под чужим ФИО: привязка снимается, прогресс остаётся, войти можно заново по ФИО и группе. «Убрать» — для тех, кто не едет (только админ, только пока не входил).</div>`;
  };

  // ---------- Карта ----------
  const drawWar = async () => {
    const raid = await app.backend.raidState().catch(() => null);
    const base = raid?.bosses[0]?.hp ?? 45000;
    const total = raid?.bosses.reduce((a, b) => a + b.hp, 0) ?? 0;
    const LEVELS: [number, string][] = [[25000, 'Средне'], [45000, 'Очень сложно'], [70000, 'Почти невозможно']];
    body.innerHTML = `<div class="card col" style="gap:6px"><b>Захват профкома</b>
        <div class="small muted">Боссы — организаторы из списка выезда (${raid?.bosses.length ?? 0}), админы — в конце. Каждое ПБ проходит цепочку само; без атак босс лечится на 10% в час. Сейчас всего здоровья у цепочки: <b>${fmt(total)}</b>.${raid?.holder ? ` Профком у <b>${factionById(raid.holder.faction).short}</b>.` : ''}</div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${LEVELS.map(([hp, n]) => `<button class="chip ${hp === base ? 'on' : ''}" data-act="rlevel" data-hp="${hp}">${n}</button>`).join('')}</div>
        ${raid?.leaders.length ? `<div class="small">${raid.leaders.map((x) => `${factionById(x.faction).short}: ${x.done ? 'прошли' : `${x.boss}/${raid.bosses.length}`}`).join(' · ')}</div>` : ''}
        ${app.backend.admin ? '<button class="btn btn-ghost btn-sm" data-act="rreset-raid">Сбросить штурм у всех</button>' : ''}</div>
      <div class="card col"><b>Стычки</b><div class="small muted">Провести раунд прямо сейчас по текущим приказам — для теста и для финального раунда.</div>
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
      <div class="card col" style="gap:6px"><b>Кто отмечает на блоках и начисляет баллы</b>
        <div class="small muted">Если выбран человек — только он открывает QR-отметки на блоках и пользуется «Начислить / Снять». «Я — скорость» и «Проверка» сдач остаются у всех организаторов.</div>
        ${app.backend.admin ? `<select class="input-ans" data-host><option value="">Все организаторы</option></select>` : `<div><b class="gold">${c.checkinHost ? esc(c.checkinHost.name) : 'Все организаторы'}</b></div>`}</div>
      <button class="btn btn-gold btn-block" data-act="screen">${icon('trophy', 18)} Экран для актового</button>
      <div class="card col" style="gap:6px"><b>Колесо профкома — урок «казино всегда выигрывает»</b>
        <div class="small muted">Колесо подкручено: ×10 не выпадает никогда, первая ставка выигрывает, после выигрыша — проигрыш, после 3–5 проигрышей — подачка ×2, стрелка замирает на ×10. В среднем участник теряет около трети ставок.</div>
        <div class="small" data-cstats>Считаю…</div>
        <label class="row" style="gap:10px"><input type="checkbox" data-set="casino_reveal" ${c.casinoReveal ? 'checked' : ''}><div class="grow"><b>Разоблачение</b><div class="small muted">Включить — каждый, кто откроет колесо, увидит, как его подкручивали и сколько он проиграл.</div></div></label>
        <button class="btn btn-blue btn-block" data-act="cscreen">${icon('trophy', 18)} Итог казино — на экран</button></div>
      ${app.backend.admin ? `<div class="card col danger-zone" style="gap:8px"><b>Начать всё заново</b>
        <div class="small muted">Обнулит у всех баллы, сдачи, QR-отметки, заказы мерча (вернутся на склад), карту, здания ПБ <b>и регистрации</b>: все, включая организаторов и тебя, войдут заново по ФИО. Список выезда, роли, задания, вопросы и мерч останутся.</div>
        <input class="input-ans" data-reset-word placeholder="Впиши слово СБРОС" autocomplete="off">
        <button class="btn btn-red btn-block" data-act="reset-all" disabled>${icon('bolt', 18)} Сбросить всё</button></div>` : ''}`;
    app.backend.casinoStats().then((a) => {
      const el2 = body.querySelector('[data-cstats]');
      if (el2 && a) el2.innerHTML = a.spins ? `Крутили ${fmt(a.players)} чел., ${fmt(a.spins)} вращений: поставили ${fmt(a.bet)}, вернулось ${fmt(a.won)} — казино в плюсе на <b class="gold">${fmt(a.bet - a.won)}</b>.` : 'Пока никто не крутил.';
    }).catch(() => {});
    const hostSel = body.querySelector<HTMLSelectElement>('[data-host]');
    if (hostSel) {
      const staffRows = app.backend.mode === 'demo'
        ? [{ id: 'me', fio: `${app.state.username} (я)` }]
        : (await app.backend.staffRoster().catch(() => [] as RosterRow[])).filter((r) => r.role !== 'participant').map((r) => ({ id: r.id, fio: r.fio }));
      hostSel.innerHTML = '<option value="">Все организаторы</option>' + staffRows.map((r) => `<option value="${esc(String(r.id))}" ${String(c.checkinHost?.id ?? '') === String(r.id) ? 'selected' : ''}>${esc(r.fio)}</option>`).join('');
      hostSel.addEventListener('change', async () => {
        try { app.cfg = await app.backend.staffSetCheckinHost(hostSel.value || null); toast(app.cfg.checkinHost ? `Отмечает: ${app.cfg.checkinHost.name}` : 'Отмечают все организаторы', 'ok'); }
        catch (e) { toast((e as Error).message, 'bad'); }
      });
    }
    const word = body.querySelector<HTMLInputElement>('[data-reset-word]');
    const resetBtn = body.querySelector<HTMLButtonElement>('[data-act="reset-all"]');
    word?.addEventListener('input', () => { if (resetBtn) resetBtn.disabled = word.value.trim().toUpperCase() !== 'СБРОС'; });
    resetBtn?.addEventListener('click', async () => {
      resetBtn.disabled = true;
      try {
        const msg = await app.backend.adminResetProgress(word!.value);
        toast(msg, 'ok');
        setTimeout(() => location.reload(), 1800);
      } catch (e) { toast((e as Error).message, 'bad'); resetBtn.disabled = false; }
    });
    body.querySelectorAll<HTMLInputElement>('[data-set]').forEach((i) => i.addEventListener('change', async () => {
      await app.backend.staffSetSetting(i.dataset.set as 'shop_open' | 'require_group' | 'casino_reveal', i.checked).catch((e: Error) => toast(e.message, 'bad'));
      app.cfg = await app.backend.config();
      toast('Сохранено', 'ok');
    }));
  };


  // ---------- Кодовые слова: добавить в моменте ----------
  const drawWords = async () => {
    let list: CodeWord[] = [];
    let pts = 15, max = 0, mins = 0, gold = false;
    const chips = (attr: string, opts: [number, string][], cur: number) => opts.map(([v, n]) => `<button class="chip ${v === cur ? 'on' : ''}" ${attr}="${v}">${n}</button>`).join('');
    const left = (t: number) => { const m = Math.round((t - Date.now()) / 60000); return m <= 0 ? 'время вышло' : m < 60 ? `ещё ${m} мин` : `ещё ${Math.floor(m / 60)} ч ${m % 60} мин`; };
    body.innerHTML = `<div class="col" data-words style="gap:10px"><div class="card col" style="gap:8px"><b>Новое кодовое слово</b>
        <div class="small muted">Скажи его со сцены или покажи на слайде. Участники вводят слово в «Заданиях» → «Пасхалка в презентации» или на вкладке «QR». Регистр, пробелы, знаки и «ё» не важны.</div>
        <input class="input-ans" data-w maxlength="60" placeholder="Например: Двигай горы" autocomplete="off">
        <div class="small">Баллы</div><div class="chips" data-g="pts">${chips('data-pts', [[10, '10'], [15, '15'], [25, '25'], [50, '50'], [100, '100']], pts)}</div>
        <div class="small">Кому</div><div class="chips" data-g="max">${chips('data-max', [[0, 'Всем'], [5, 'Первым 5'], [10, 'Первым 10'], [20, 'Первым 20']], max)}</div>
        <div class="small">Сколько действует</div><div class="chips" data-g="mins">${chips('data-mins', [[0, 'Весь выезд'], [5, '5 минут'], [15, '15 минут'], [60, '1 час']], mins)}</div>
        <label class="row small" style="gap:8px"><input type="checkbox" data-gold> Золотая пасхалка — засчитывается один раз в день на человека</label>
        <button class="btn btn-gold btn-block" data-wadd>${icon('plus', 16)} Добавить слово</button></div>
      <div class="section-h" data-wh>Слова</div><div class="list" data-wl><div class="muted small">Загрузка…</div></div>
      <div class="howto small">Проверить слово: введи его сам — игра скажет «Слово верное» и ничего не начислит.<br>
        Слова из списка организаторов скрыты: в открытом коде игры лежат только их отпечатки, сам список — в документе организаторов.<br>
        Удалить слово — баллы у тех, кто его ввёл, останутся.</div></div>`;
    const renderList = () => {
      $(body, '[data-wh]').textContent = `Слова · ${list.length}`;
      $(body, '[data-wl]').innerHTML = list.map((w) => {
        const dead = !w.active || (w.expires !== null && w.expires < Date.now());
        return `<div class="li" style="${dead ? 'opacity:.6' : ''}"><div class="grow"><b>${esc(w.text)}</b>${w.gold ? ' <span class="tag" style="background:#ffc83d33">золотая</span>' : ''}
          <div class="small muted">+${w.points} · ввели ${w.found}${w.max ? ` из ${w.max}` : ''}${w.expires ? ` · ${left(w.expires)}` : ''}${w.active ? '' : ' · выключено'}${w.by ? ` · добавил ${esc(w.by)}` : ''}</div></div>
          <button class="btn btn-ghost btn-sm" data-wtog="${esc(w.id)}" data-on="${w.active ? 0 : 1}">${w.active ? 'Выключить' : 'Включить'}</button>
          ${w.hidden ? '' : `<button class="btn btn-ghost btn-sm" data-wdel="${esc(w.id)}" aria-label="Удалить">${icon('x', 14)}</button>`}</div>`;
      }).join('') || '<div class="muted small">Слов пока нет</div>';
    };
    const load = async () => { list = await app.backend.staffWords().catch((e: Error) => { toast(e.message, 'bad'); return list; }); renderList(); };
    // слушаем внутренний блок: при перерисовке вкладки он пересоздаётся, обработчики не копятся
    $(body, '[data-words]').addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      const pick = t.closest<HTMLElement>('[data-pts],[data-max],[data-mins]');
      if (pick) {
        if (pick.dataset.pts) pts = Number(pick.dataset.pts);
        if (pick.dataset.max) max = Number(pick.dataset.max);
        if (pick.dataset.mins) mins = Number(pick.dataset.mins);
        pick.parentElement!.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === pick));
        return;
      }
      if (t.closest('[data-wadd]')) {
        const inp = $(body, '[data-w]') as HTMLInputElement;
        const word = inp.value.trim();
        if (!word) { toast('Впиши слово', 'bad'); return; }
        gold = ($(body, '[data-gold]') as HTMLInputElement).checked;
        try {
          list = await app.backend.staffWordAdd(word, pts, max || null, mins || null, gold);
          inp.value = ''; haptic('ok');
          toast(`Слово «${word}» принимается: +${pts}${max ? `, первым ${max}` : ''}${mins ? `, ${mins} мин` : ''}`, 'ok');
          renderList();
        } catch (er) { toast((er as Error).message, 'bad'); haptic('bad'); }
        return;
      }
      const tog = t.closest<HTMLElement>('[data-wtog]');
      if (tog) { try { list = await app.backend.staffWordSet(tog.dataset.wtog!, tog.dataset.on === '1'); renderList(); } catch (er) { toast((er as Error).message, 'bad'); } return; }
      const del = t.closest<HTMLElement>('[data-wdel]');
      if (del) {
        if (!confirmTap(del, 'Удалить?')) return;
        try { list = await app.backend.staffWordDelete(del.dataset.wdel!); toast('Слово удалено', 'info'); renderList(); } catch (er) { toast((er as Error).message, 'bad'); }
      }
    });
    ($(body, '[data-gold]') as HTMLInputElement).addEventListener('change', (e) => {
      if ((e.target as HTMLInputElement).checked && pts < 50) {
        pts = 50; body.querySelectorAll<HTMLElement>('[data-pts]').forEach((c) => c.classList.toggle('on', c.dataset.pts === '50'));
      }
    });
    await load();
    const timer = window.setInterval(() => { if (body.isConnected && tab === 'words') load(); }, 5000);
    stopTimer = () => clearInterval(timer);
  };

  const draw = () => {
    stopTimer(); stopTimer = () => {};
    lastTab = tab;
    node.querySelectorAll<HTMLElement>('.chip').forEach((c) => c.classList.toggle('on', c.dataset.v === tab));
    ({ team: drawTeam, help: drawHelp, qr: () => drawQrStation(app, body, draw), mod: drawMod, grant: drawGrant, words: drawWords, merch: drawMerch, issue: drawIssue, live: drawLive, vote: drawVote, roster: drawRoster, war: drawWar, set: drawSet })[tab]();
  };

  /** Начислить (+) или снять (−) ровно столько, сколько введено в поле. */
  const grantOrTake = async (sign: 1 | -1) => {
    if (!picked) { toast('Сначала выбери участника', 'bad'); return; }
    const task = sign > 0 ? ($(body, '[data-task]') as HTMLSelectElement).value : 'penalty';
    const amt = Math.round(Math.abs(Number(($(body, '[data-amount]') as HTMLInputElement).value) || 0));
    if (amt < 1 || amt > 500) { toast('Сумма — от 1 до 500 баллов', 'bad'); return; }
    const note = ($(body, '[data-note]') as HTMLInputElement).value.trim();
    try {
      const msg = await app.backend.staffGrant(picked.id, task, sign * amt, note);
      toast(msg, 'ok'); haptic('ok'); app.update(false);
    } catch (e) { toast((e as Error).message, 'bad'); haptic('bad'); }
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
    grant: () => grantOrTake(1),
    penalty: () => grantOrTake(-1),
    msave: async (t) => {
      const card = body.querySelector<HTMLElement>(`[data-item="${t.dataset.id}"]`)!;
      const v = (f: string) => Number((card.querySelector(`[data-f="${f}"]`) as HTMLInputElement).value);
      const auto = (card.querySelector('[data-f="auto"]') as HTMLInputElement).checked;
      const items = await app.backend.merchList();
      const it = items.find((x) => x.id === t.dataset.id)!;
      const patch: Partial<MerchItem> & { name: string } = { id: it.id, name: it.name, stock: Math.max(0, v('stock')), price: Math.max(1, v('price')), discount: Math.max(0, Math.min(90, v('discount'))), perPerson: Math.max(1, v('perPerson')), auto: auto ? it.auto ?? DEFAULT_AUTO : null, tiers: readTiers(card) };
      await app.backend.staffMerchSave(patch).catch((e: Error) => toast(e.message, 'bad'));
      toast('Сохранено', 'ok'); drawMerch();
    },
    mstep: async (t) => {
      const items = await app.backend.merchList();
      const it = items.find((x) => x.id === t.dataset.id);
      if (!it) return;
      const price = Math.max(1, Math.round(it.price * Number(t.dataset.k)));
      await app.backend.staffMerchSave({ id: it.id, name: it.name, price }).catch((e: Error) => toast(e.message, 'bad'));
      toast(`«${it.name}»: ${fmt(it.price)} → ${fmt(price)}`, 'ok'); drawMerch();
    },
    tadd: (t) => {
      const box = body.querySelector<HTMLElement>(`[data-item="${t.dataset.id}"] [data-tiers]`)!;
      t.insertAdjacentHTML('beforebegin', tierRow('', ''));
      box.querySelector<HTMLInputElement>('.tier-row:last-of-type [data-tl]')?.focus();
    },
    tdel: (t) => { t.closest('.tier-row')?.remove(); },
    mdel: async (t) => { await app.backend.staffMerchDelete(t.dataset.id!); toast('Товар скрыт', 'info'); drawMerch(); },
    mimp: async () => { const msg = await app.backend.staffMerchImport(($(body, '[data-imp]') as HTMLTextAreaElement).value).catch((e: Error) => e.message); toast(msg, 'ok'); drawMerch(); },
    iscan: async () => { const c = await scanAny('QR участника'); if (c) findOrders(c); },
    ifind: () => { const v = ($(body, '[data-icode]') as HTMLInputElement).value.trim(); if (v) findOrders(v); },
    iss: async (t) => { await app.backend.staffOrderSet(t.dataset.id!, 'issued').catch((e: Error) => toast(e.message, 'bad')); haptic('ok'); toast('Выдано', 'ok'); drawIssue(); },
    icancel: async (t) => { await app.backend.staffOrderSet(t.dataset.id!, 'cancelled').catch((e: Error) => toast(e.message, 'bad')); toast('Заказ отменён, баллы и товар вернулись', 'info'); drawIssue(); },
    vscreen: () => openVoteBoard(app),
    vkick: async (t) => {
      if (!confirmTap(t, 'Точно?')) return;
      try { app.vote = await app.backend.staffVoteKick(t.dataset.r!); toast('Убран из команды', 'info'); drawVote(); } catch (e) { toast((e as Error).message, 'bad'); }
    },
    cscreen: () => openCasinoBoard(app),
    vctl: async (t) => {
      const a = t.dataset.a as VoteAction;
      if (a === 'reset' && !confirmTap(t, 'Точно обнулить?')) return;
      try {
        app.vote = await app.backend.staffVoteControl(a, t.dataset.t ?? null);
        haptic('ok');
        toast({ open: t.dataset.t ? 'Голосуем за эту команду' : 'Голосование открыто', close: 'Голосование закрыто', reveal: 'Итог — на экране', hide: 'Итог скрыт', reset: 'Голоса обнулены' }[a], 'ok');
        drawVote();
      } catch (e) { toast((e as Error).message, 'bad'); }
    },
    vsetup: async (t) => {
      if (!confirmTap(t, 'Ещё раз — голоса обнулятся')) return;
      const title = ($(body, '[data-vtitle]') as HTMLInputElement).value;
      const teams = parseVoteTeams(($(body, '[data-vteams]') as HTMLTextAreaElement).value);
      try { app.vote = await app.backend.staffVoteSetup(title, teams); toast(`Команд: ${teams.length}, голоса обнулены`, 'ok'); drawVote(); } catch (e) { toast((e as Error).message, 'bad'); }
    },
    lpost: async () => {
      const text = ($(body, '[data-lt]') as HTMLTextAreaElement).value.trim();
      if (text.length < 3) { toast('Напиши сообщение', 'bad'); return; }
      const kind = ($(body, '[data-lk]') as HTMLSelectElement).value as Announcement['kind'];
      const mv = ($(body, '[data-lm]') as HTMLSelectElement).value;
      const b = $(body, '[data-act="lpost"]') as HTMLButtonElement;
      b.disabled = true; b.textContent = 'Отправляю в эфир и в бот…';
      let r: { bot?: number; total?: number } | void = undefined, failed = false;
      try { r = await app.backend.staffAnnounce({ text, kind, minutes: mv ? Number(mv) : null }); } catch (e) { failed = true; toast((e as Error).message, 'bad'); }
      await app.refreshLive();
      if (!failed) toast(r && typeof r.bot === 'number' ? `В эфире и в боте: получили ${r.bot} из ${r.total ?? r.bot}` : 'Отправлено в эфир', 'ok');
      drawLive();
    },
    ldel: async (t) => { await app.backend.staffAnnounceDelete(t.dataset.id!); await app.refreshLive(); drawLive(); },
    rimp: async () => { const msg = await app.backend.staffRosterImport(($(body, '[data-rimp]') as HTMLTextAreaElement).value).catch((e: Error) => e.message); toast(msg, 'ok'); drawRoster(); },
    rremove: async (t) => { if (!confirmTap(t, 'Точно?')) return; const msg = await app.backend.staffRosterRemove(t.dataset.id!).catch((e: Error) => e.message); toast(msg, 'info'); drawRoster(); },
    rreset: async (t) => { const msg = await app.backend.staffRosterReset(t.dataset.id!).catch((e: Error) => e.message); toast(msg, 'info'); drawRoster(); },
    rlevel: async (t) => { await app.backend.staffRaidSet(Number(t.dataset.hp)).catch((e: Error) => toast(e.message, 'bad')); toast('Сложность сохранена', 'ok'); drawWar(); },
    'rreset-raid': async (t) => { if (!confirmTap(t, 'Точно сбросить?')) return; await app.backend.staffRaidReset().catch((e: Error) => toast(e.message, 'bad')); toast('Штурм профкома сброшен', 'info'); drawWar(); },
    force: async () => { await app.backend.staffForceRound(); toast('Раунд проведён — открой карту', 'ok'); },
    ev: async (t) => { await app.backend.staffStartEvent(t.dataset.id!).catch((e: Error) => toast(e.message, 'bad')); toast('Мероприятие запущено — оно на карте и в «Играх»', 'ok'); },
  });
  node.addEventListener('close', () => stopTimer());
  app.openOverlay(node);
  draw();
  maybeStaffTour(app);
}

/** Опасная кнопка срабатывает со второго нажатия (в течение 3 с) — без системных диалогов, они блокируют Telegram. */
function confirmTap(b: HTMLElement, ask: string) {
  if (b.dataset.armed === '1') { b.dataset.armed = ''; return true; }
  b.dataset.armed = '1';
  const was = b.textContent;
  b.textContent = ask;
  setTimeout(() => { b.dataset.armed = ''; b.textContent = was; }, 3000);
  return false;
}

/** Короткий гайд прямо в панели — полная версия в документе «Гайд организатора ШПА». */
const GUIDE: [string, string[]][] = [
  ['Перед началом смены', ['Открой «Орг.» → «Команда» и отметь свою зону: проверка, QR, мерч, эфир, карта или помощь.', 'Посмотри, кто чем занят — не берите одну и ту же зону вдвоём без нужды.', 'Проверь связь: открой «Проверка» — если список грузится, всё в порядке.']],
  ['Отметка на блоке (QR)', ['«QR-отметка» → вид «Блок / лекция» → выбери название блока → «Открыть и показать QR».', 'Покажи телефон залу или нажми «На большой экран» на ноутбуке у проектора. QR и код меняются каждые 20 секунд — фото в чат не поможет.', 'Участники: вкладка «QR» внизу → «Сканировать» или ввести 6 знаков.', 'Отметку закрой в конце блока («Закрыть отметку»). Если такая уже открыта коллегой — игра покажет её, вторую не создаст.']],
  ['«Я — скорость»', ['«QR-отметка» → «Я — скорость». Баллы получают только первые N (по умолчанию 5).', 'QR статичный: сделай скриншот, распечатай или спрячь — работает, пока открыта отметка.']],
  ['Кодовые слова (пасхалки)', ['«Слова» → впиши слово, выбери баллы, кому (всем или первым N) и сколько действует → «Добавить слово». С этой секунды участники могут его вводить.', 'Скажи слово со сцены или покажи на слайде. Вводят в «Заданиях» → «Пасхалка в презентации» или на вкладке «QR»; регистр, пробелы и знаки не важны.', 'Золотая пасхалка засчитывается один раз в день на человека.', 'Проверить слово — введи его сам: «Слово верное», баллы не начислятся. «Выключить» — слово перестаёт приниматься, удалить — баллы у нашедших останутся.']],
  ['Тайники и «Я — скорость» (распечатки)', ['10 тайников и золотой тайник — спрятать на базе в любое время: работают весь выезд. Золотой — только первому.', '«Я — скорость» 7 и 8 ноября — каждый QR работает только в свой день, баллы первым пяти. Спрятать утром своего дня.', 'Проверить распечатку: отсканируй её своим телефоном — игра скажет «Код верный» и сколько уже нашли, ничего не начислит и не потратит.', 'Новый «Я — скорость» на месте — «QR-отметка» → «Я — скорость» (QR на экране телефона).']],
  ['Проверка заданий', ['«Проверка» → «Взять 5». Сдачи закрепляются за тобой на 10 минут.', 'Смотри фото, ссылку или текст. Баллы подставлены по заданию — можно поправить.', '«Принять» — баллы сразу, участнику «✅ принято» в игре и в боте.', '«Отклонить» — обязательно напиши причину (есть готовые). Участник сможет сдать заново.', 'Уходишь — «Вернуть мои», чтобы сдачи не ждали 10 минут.']],
  ['Начислить или снять баллы', ['«Начислить» → найди участника по фамилии → выбери, за что → сколько баллов → «Начислить». Начисляется ровно введённое число.', '«Снять» — убрать баллы (не ниже нуля): за нарушение или ошибочное начисление. Напиши причину — участник её увидит.', 'Для активности на блоке, лучшего вопроса, помощи, конкурсов ведущего.']],
  ['Мерч и выдача', ['«Мерч»: цены, остатки, скидки. Вверху — хватает ли баллов активному участнику на весь набор.', '«Настройки» → «Магазин мерча открыт» — когда решите открыть покупки.', '«Выдача»: участник показывает «Мой QR» → «Сканировать QR» → «Выдать».', 'Ошиблись — «Отмена»: товар и баллы вернутся.']],
  ['Эфир и экран', ['«Эфир»: сообщение всем — вверху базы у каждого и на экране зала.', 'Кнопка «Экран» — на ноутбук у проектора: рейтинг ПБ, эфир, QR открытой отметки.']],
  ['Голосование «Работа со спонсорами»', ['«Голосование» → впиши названия команд (по строке) → «Сохранить команды». Участники сами вписываются: ФИО + команда; составы — внизу вкладки.', '«На экран в зале» — на ноутбук у проектора: «за» и «против» растут вживую, места переставляются.', 'Выступает команда — «Голосуем» в её строке: на экране она крупно, участники оценивают только её (✅ или ❌). «Открыть для всех» — оценить все команды сразу.', 'В конце — «Закрыть», потом «Показать итог»: на экране лучшая команда. Баллы победителям — «Начислить» → «Лучший питч».']],
  ['Карта и мероприятия', ['«Карта»: «Провести раунд сейчас» — для финала или теста.', 'Запустить мероприятие вручную — если расписание сдвинулось.']],
  ['Участники', ['«Участники»: список выезда по ПБ, кто вошёл.', '«Сброс» — если человек сменил телефон или вошёл под чужим ФИО. Прогресс сохраняется.']],
];
