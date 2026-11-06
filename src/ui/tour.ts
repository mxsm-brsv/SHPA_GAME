// Обучение: пошаговые подсказки с подсветкой кнопок. Отдельно для участников (база и нижнее меню)
// и для организаторов (вкладки панели). Плюс окно «Помощь» с короткими ответами и повтором обучения.
import { icon } from '../art/icons';
import { el, esc, modal } from '../lib/dom';
import type { App } from './app';
import { openStaff } from './screens/staff';

export interface TourStep { sel?: string; title: string; text: string }

// v2: после общего сброса 4 ноября обучение показывается всем заново (и у организаторов — своё).
const KEY_PLAYER = 'shpa.tour.player.v2';
const KEY_ORG = 'shpa.tour.org.v2';
const KEY_STAFF = 'shpa.tour.staff.v2';
/** Организатор или админ — по роли из списка выезда (в демо все тестеры видят панель, но обучение — участника). */
export const isOrg = (app: App) => app.state?.role === 'staff' || app.state?.role === 'admin';
const seen = (k: string) => { try { return localStorage.getItem(k) === '1'; } catch { return true; } };
const mark = (k: string) => { try { localStorage.setItem(k, '1'); } catch { /* приватный режим */ } };

export const PLAYER_TOUR: TourStep[] = [
  { title: 'Привет! Это игра ШПА ⚡', text: 'Внизу — всё главное для школы: задания, отметки на блоках, подготовка и мерч. По бокам базы — развлечения. Покажу за минуту.' },
  { sel: '.nav [data-tab="tasks"]', title: 'Задания', text: 'Основной источник баллов. Выбери задание, нажми «Сдать» — организатор проверит. Ответ «принято / не принято» придёт сюда, в «Ответы», и сообщением бота.' },
  { sel: '.nav [data-tab="qr"]', title: 'QR — отметка на блоке', text: 'На каждом блоке организатор показывает QR. Открой эту вкладку → «Сканировать». Не сканируется — введи 6 знаков под QR. Красный значок — сейчас есть открытая отметка.' },
  { sel: '.nav [data-tab="prep"]', title: 'Подготовка', text: '1000+ правовых вопросов и тренажёры конкурса «Ты — лидер»: аттестация, головоломки, «2 к 1», биатлон, конкурс председателей, заседание профбюро.' },
  { sel: '.nav [data-tab="shop"]', title: 'Мерч за баллы', text: 'Покупай мерч ППО за баллы. Покупка не уменьшает рейтинг. Забрать — у стола выдачи по «Моему QR».' },
  { sel: '.base [data-act="rating"]', title: 'Твои баллы', text: 'Это рейтинг — за задания и отметки на блоках. Нажми, чтобы увидеть рейтинг участников и профбюро.' },
  { sel: '.base [data-tap]', title: 'База твоего ПБ', text: 'Тапай по ратуше: профкоины — тебе, опыт — общему зданию профбюро (Касса, Штаб, Медиацентр). Здания дают бонусы всему ПБ.' },
  { sel: '.base .side.l', title: 'Развлечения', text: 'Бой отрядом активистов, карта кампуса МЭИ с битвой профбюро, мини-игры и колесо. Они приносят профкоины, а баллы — только задания и блоки.' },
  { sel: '.base [data-act="clan"]', title: 'Моё ПБ', text: 'Твоя команда: кто в игре, кто сколько вложил, уровни зданий.' },
  { sel: '.base [data-act="help"]', title: 'Помощь', text: 'Если что-то непонятно — здесь короткие ответы и это обучение заново. Удачи на ШПА!' },
];

/** Организатору на базе: он тоже в игре, но работает через панель. Последний шаг открывает панель и её обучение. */
export const ORG_TOUR: TourStep[] = [
  { title: 'Привет, организатор! ⚡', text: 'У тебя та же игра, что у участников, плюс панель организатора. Ты играешь вне зачёта: рейтинг и мерч — только у участников. Сначала — что видят они, потом — твоя панель.' },
  { sel: '.nav', title: 'Меню участника', text: 'Задания · QR · База · Подготовка · Мерч. Если спросят «куда нажать» — всё главное здесь, внизу.' },
  { sel: '.nav [data-tab="qr"]', title: 'Отметка на блоке', text: 'Участник открывает «QR» → «Сканировать» и наводит камеру на твой QR. Не сканируется — вводит 6 знаков под ним. Сам QR ты открываешь в панели → «QR-отметка».' },
  { sel: '.nav [data-tab="tasks"]', title: 'Сдача заданий', text: 'Отсюда участники сдают задания. Сдачи приходят тебе в панель → «Проверка», а ответ — им в «Задания → Ответы» и сообщением бота.' },
  { sel: '.nav [data-tab="shop"]', title: 'Мерч', text: 'Участник покупает мерч за баллы и показывает «Мой QR» у стола выдачи. Ты сканируешь его в панели → «Выдача».' },
  { sel: '.base [data-act="help"]', title: 'Помощь', text: 'Короткие ответы на частые вопросы участников и повтор обучения — твоего и участника.' },
  { sel: '.base [data-act="staff"]', title: 'Твоя панель «Орг.»', text: 'Вся работа на выезде — здесь: команда, QR-отметки, проверка, начисление, мерч, эфир. Откроем её и пройдёмся по вкладкам.' },
];

export const STAFF_TOUR: TourStep[] = [
  { title: 'Панель организатора', text: 'Здесь всё для работы на выезде. Пройдёмся по вкладкам — так вы не будете делать одно и то же вдвоём.' },
  { sel: '[data-v="team"]', title: 'Команда', text: 'Отметь, на чём ты сейчас: проверка, QR на блоках, мерч, эфир, карта. Видно, кто чем занят и сколько держит на проверке.' },
  { sel: '[data-v="qr"]', title: 'QR-отметка', text: 'Открыть отметку на блоке: QR появится у тебя на телефоне во весь экран. Такая же отметка уже открыта кем-то — покажем её, вторую не создадим.' },
  { sel: '[data-v="mod"]', title: 'Проверка заданий', text: 'Нажми «Взять 5» — эти сдачи на 10 минут закрепятся за тобой, остальные их не тронут. Принять — баллы сразу, отклонить — с причиной.' },
  { sel: '[data-v="grant"]', title: 'Начислить', text: 'Баллы за то, что отмечает ведущий: активность на блоке, лучший вопрос, помощь. Найди участника по фамилии.' },
  { sel: '[data-v="merch"]', title: 'Мерч', text: 'Цены, остатки, скидки. Вверху — хватит ли баллов активному участнику на весь мерч.' },
  { sel: '[data-v="issue"]', title: 'Выдача', text: 'Участник показывает «Мой QR» — сканируешь и видишь, что он купил и ещё не забрал.' },
  { sel: '[data-v="live"]', title: 'Эфир', text: 'Сообщение всем: появится вверху базы у каждого и на экране в зале.' },
  { sel: '[data-v="help"]', title: 'Гайд', text: 'Пошаговые инструкции: как проверять, как отмечать на блоках, как выдавать мерч. И это обучение заново.' },
  { sel: '[data-act="screen"]', title: 'Экран для зала', text: 'Открой на ноутбуке у проектора: рейтинг ПБ, эфир и большой QR открытой отметки.' },
];

/** Подсказки поверх игры. Шаг без селектора или с ненайденной кнопкой — карточка по центру.
 *  last — надпись на кнопке последнего шага, onDone(true) — дошли до конца, onDone(false) — пропустили. */
export function runTour(app: App, steps: TourStep[], key?: string, opts: { last?: string; onDone?: (finished: boolean) => void } = {}) {
  let i = 0;
  const node = el(`<div class="tour" role="dialog" aria-label="Обучение"><div class="tour-hole"></div>
    <div class="tour-card"><div class="small muted" data-n></div><h3 data-t></h3><p data-x></p>
      <div class="row" style="gap:8px"><button class="btn btn-ghost btn-sm" data-skip>Пропустить</button><div class="grow"></div>
      <button class="btn btn-ghost btn-sm" data-prev>Назад</button><button class="btn btn-gold btn-sm" data-next>Далее</button></div></div></div>`);
  const hole = node.querySelector<HTMLElement>('.tour-hole')!;
  const card = node.querySelector<HTMLElement>('.tour-card')!;
  const show = () => {
    const st = steps[i];
    (node.querySelector('[data-n]') as HTMLElement).textContent = `${i + 1} из ${steps.length}`;
    (node.querySelector('[data-t]') as HTMLElement).innerHTML = esc(st.title);
    (node.querySelector('[data-x]') as HTMLElement).innerHTML = esc(st.text);
    (node.querySelector('[data-next]') as HTMLElement).textContent = i === steps.length - 1 ? (opts.last ?? 'Понятно') : 'Далее';
    (node.querySelector('[data-prev]') as HTMLElement).classList.toggle('hidden', i === 0);
    const t = st.sel ? Array.from(app.root.querySelectorAll<HTMLElement>(st.sel)).find((x) => x.getBoundingClientRect().width > 0) : null;
    const R = app.root.getBoundingClientRect();
    card.style.top = card.style.bottom = '';
    if (!t) {
      node.classList.add('center');
      hole.style.cssText = `left:${R.width / 2}px;top:${R.height / 2}px;width:0;height:0`;
      return;
    }
    node.classList.remove('center');
    t.scrollIntoView({ block: 'nearest' });
    const r = t.getBoundingClientRect();
    // рамка (с обводкой 4px) целиком внутри экрана, даже у кнопок у самого края и у нижнего меню
    const pad = 6, edge = 6;
    const L = Math.max(edge, r.left - R.left - pad), T = Math.max(edge, r.top - R.top - pad);
    const Rt = Math.min(R.width - edge, r.right - R.left + pad), B = Math.min(R.height - edge, r.bottom - R.top + pad);
    hole.style.cssText = `left:${L}px;top:${T}px;width:${Math.max(0, Rt - L)}px;height:${Math.max(0, B - T)}px`;
    const below = r.top + r.height / 2 - R.top < R.height / 2;
    if (below) card.style.top = `${Math.min(R.height - 200, r.bottom - R.top + 16)}px`;
    else card.style.bottom = `${Math.min(R.height - 200, R.bottom - r.top + 16)}px`;
  };
  const finish = (done: boolean) => { if (key) mark(key); node.remove(); window.removeEventListener('resize', show); opts.onDone?.(done); };
  node.querySelector('[data-next]')!.addEventListener('click', () => { if (++i >= steps.length) finish(true); else show(); });
  node.querySelector('[data-prev]')!.addEventListener('click', () => { i = Math.max(0, i - 1); show(); });
  node.querySelector('[data-skip]')!.addEventListener('click', () => finish(false));
  window.addEventListener('resize', show);
  app.root.appendChild(node);
  requestAnimationFrame(show);
}

/** Обучение участника на базе. */
export function runPlayerTour(app: App) {
  if (app.tab !== 'base') app.go('base');
  setTimeout(() => runTour(app, PLAYER_TOUR, KEY_PLAYER), 250);
}

/** Обучение организатора: база глазами участника → панель «Орг.» → вкладки панели. */
export function runOrgTour(app: App) {
  if (app.tab !== 'base') app.go('base');
  setTimeout(() => runTour(app, ORG_TOUR, KEY_ORG, {
    last: 'Открыть панель',
    onDone: (finished) => {
      if (!finished) return;
      mark(KEY_STAFF); // обучение по вкладкам запускаем сами, чтобы не было двух подряд
      openStaff(app);
      setTimeout(() => runTour(app, STAFF_TOUR, KEY_STAFF), 450);
    },
  }), 250);
}

/** Первый вход: дождаться, пока закроются приветственные окна, и показать обучение по роли. */
export function maybeStartTour(app: App) {
  const org = isOrg(app);
  if (seen(org ? KEY_ORG : KEY_PLAYER)) return;
  let tries = 0;
  const wait = () => {
    if (++tries > 240) return;
    // окна (приветствие, подарок) живут в body, а не в #app — ждём, пока закроют все
    if (document.querySelector('.modal-back') || app.overlay) { setTimeout(wait, 500); return; }
    if (org) runOrgTour(app); else runPlayerTour(app);
  };
  setTimeout(wait, 800);
}

/** Первое открытие панели организатора (если обучение на базе пропустили). */
export function maybeStaffTour(app: App) {
  if (seen(KEY_STAFF)) return;
  setTimeout(() => { if (!app.root.querySelector('.tour')) runTour(app, STAFF_TOUR, KEY_STAFF); }, 400);
}

const FAQ: [string, string][] = [
  ['Где брать баллы?', 'Только задания (вкладка «Задания») и образовалка — отметки на блоках (вкладка «QR»), квизы и конспекты. Мини-игры, бой, колесо и стычки на карте приносят профкоины.'],
  ['Как отметиться на блоке?', 'Вкладка «QR» → «Сканировать» → наведи камеру на QR организатора. Не получается — введи 6 знаков под QR. Баллы — один раз за блок.'],
  ['Сдал задание — что дальше?', 'Оно «на проверке». Организатор примет или отклонит с причиной: ответ придёт в «Задания → Ответы» и сообщением бота. Отклонили — можно сдать заново.'],
  ['Баллы тратятся на мерч?', 'На счёте магазина — заработанные минус потраченные. А рейтинг (место в таблице) от покупок не падает.'],
  ['Где забрать мерч?', 'У стола выдачи: покажи «Мой QR» (вкладка «QR» или «Задания»), организатор отсканирует и выдаст.'],
  ['Как захватить профком?', 'Карта → метка «Профком» → «Штурм». Боссы — организаторы: каждое профбюро проходит цепочку само, урон всех участников ПБ складывается. Штурм — раз в 20 минут, без атак босс лечится. Пройдёте всех — профком ваш.'],
  ['Что за «Колесо профкома»?', 'Игры → «Колесо профкома»: ставка профкоинами, колесо выдаёт ×0, ×1, ×2 или ×10. Тапай по колесу — закрутится быстрее. В конце выезда организаторы расскажут, как оно устроено.'],
  ['Как голосовать за команды?', 'На базе — кнопка «Голосование». Сначала впиши своё ФИО и выбери свою команду (можно записать и товарища). Когда организаторы откроют голосование — каждой команде ✅ или ❌, за свою нельзя. Итог — на экране в зале.'],
  ['Как сразиться с другим участником в правовухе?', 'Правовуха → «Поединок с участником» → «Бросить вызов». Скажи сопернику код или отправь ссылку — или прими чужой вызов из «Открытых». У обоих одни и те же 7 вопросов по 20 секунд: больше верных — победа, при равенстве — кто быстрее. Итог придёт в бота, за поединок — профкоины.'],
  ['Что такое профкоины и кристаллы?', 'Игровая валюта: профкоины — на наём и прокачку отряда, кристаллы — на умения в бою. На рейтинг и мерч они не влияют.'],
  ['Зачем тапать по ратуше?', 'Тапы дают тебе профкоины, а твоему ПБ — опыт зданий. Касса, Штаб и Медиацентр дают бонусы всему профбюро.'],
  ['Что за карта и стычки?', 'Настоящий кампус МЭИ. Раз в раунд профбюро атакуют и обороняют точки: выбери точку и отдай приказ. Ратуша твоего ПБ стоит в вашей аудитории.'],
  ['Подготовка к «Ты — лидер»', 'Вкладка «Подготовка» → «Конкурс «Ты — лидер»: тренажёры всех этапов по Положению — аттестация, головоломки, «2 к 1», биатлон, конкурс председателей, заседание с протоколом, визитка и приёмная кампания.'],
];

export function openHelp(app: App) {
  const org = isOrg(app);
  const m = modal(`<h2 style="font-size:22px">Как играть</h2>
    <div class="howto small" style="margin:6px 0 10px"><b>Главное — внизу:</b> Задания · QR · База · Подготовка · Мерч.<br><b>Развлечения — по бокам базы:</b> Бой, Карта, Игры.</div>
    <div class="col" style="gap:6px">${FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><div class="small">${esc(a)}</div></details>`).join('')}</div>
    ${org
      ? `<button class="btn btn-gold btn-block" data-org style="margin-top:12px">${icon('shield', 18)} Обучение организатора заново</button>
         <button class="btn btn-ghost btn-block" data-tour style="margin-top:8px">${icon('play', 18)} Посмотреть обучение участника</button>`
      : `<button class="btn btn-gold btn-block" data-tour style="margin-top:12px">${icon('play', 18)} Пройти обучение заново</button>
         ${app.backend.staff ? `<button class="btn btn-ghost btn-block" data-org style="margin-top:8px">${icon('shield', 18)} Обучение организатора</button>` : ''}`}`);
  m.root.querySelector('[data-tour]')!.addEventListener('click', () => { m.close(); runPlayerTour(app); });
  m.root.querySelector('[data-org]')?.addEventListener('click', () => { m.close(); runOrgTour(app); });
}
