// @ts-check
// «Кнопка» — интерфейс: телефон команды, панель ведущего (?host) и экран для зала (?screen).
import { Api, ApiError, Clock, Poller, TeamLink, roundPhase, syncBurst } from './core.js';

/** @type {{url:string, key:string, bot?:string}} */
const CFG = /** @type {any} */ (window).KNOPKA_CFG || { url: '', key: '' };
const root = /** @type {HTMLElement} */ (document.getElementById('app'));
const qs = new URLSearchParams(location.search);
const BOT = (CFG.bot || 'shpa_game_bot').replace(/^@/, '');
const JOIN_URL = `https://t.me/${BOT}?startapp=knopka`;

const LS = {
  /** @param {string} k */ get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  /** @param {string} k @param {string|null} v */ set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

// ───────────────────────── мелочи ─────────────────────────

/**
 * @param {string} tag @param {Record<string, any>|null} [props] @param {...any} kids
 * @returns {HTMLElement}
 */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.setAttribute('style', v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
/** Кнопка со скошенными углами. @param {string} cls @param {string|Node} label @param {(e:Event)=>void} on @param {Record<string,any>} [extra] */
const bv = (cls, label, on, extra = {}) => h('button', { class: `bv ${cls}`, type: 'button', onclick: on, ...extra }, h('span', null, label));
const num = (n, cls = '') => h('span', { class: `num ${cls}` }, String(n));
/** @param {number} ms */
const sec = (ms) => (ms / 1000).toFixed(Math.abs(ms) < 10000 ? 3 : Math.abs(ms) < 100000 ? 2 : 1).replace('.', ',');
const rel = (ms) => `+${sec(Math.max(0, ms))}\u00a0с`;
const sec1 = (ms) => (ms / 1000).toFixed(1).replace('.', ',');
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
const pts = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} ${plural(n, 'балл', 'балла', 'баллов')}`;

let toastTimer = /** @type {any} */ (null);
/** @param {string} text */
function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

/** Окно поверх. Возвращает функцию закрытия. @param {(close: () => void) => Node[]} build */
function sheet(build) {
  const wrap = h('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === wrap) close(); } });
  const close = () => wrap.remove();
  wrap.append(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, ...build(close)));
  document.body.append(wrap);
  /** @type {HTMLElement|null} */ (wrap.querySelector('input, textarea, select'))?.focus();
  return close;
}

/** @param {string} title @param {string} text @param {string} yes @returns {Promise<boolean>} */
function confirmSheet(title, text, yes) {
  return new Promise((resolve) => {
    sheet((close) => [
      h('h2', null, title), h('p', null, text),
      h('div', { class: 'row' },
        bv('sun', yes, () => { close(); resolve(true); }),
        bv('', 'Отмена', () => { close(); resolve(false); })),
    ]);
  });
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано'); }
  catch {
    const i = /** @type {HTMLInputElement} */ (h('input', { value: text, style: 'position:fixed;opacity:0' }));
    document.body.append(i); i.select();
    try { document.execCommand('copy'); toast('Скопировано'); } catch { toast(text); }
    i.remove();
  }
}

function deviceKey() {
  let k = LS.get('knopka.device');
  if (!k) {
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    k = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    LS.set('knopka.device', k);
  }
  return k;
}

// ───────────────────────── Telegram ─────────────────────────

const inTg = /tgWebAppData|tgWebAppVersion|tgWebAppPlatform/.test(location.hash + location.search);
/** @type {any} */ let tg = null;

async function initTelegram() {
  if (!inTg) return;
  await new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = resolve; s.onerror = resolve;
    document.head.append(s);
    setTimeout(resolve, 4000);
  });
  tg = /** @type {any} */ (window).Telegram?.WebApp ?? null;
  if (!tg) return;
  try {
    tg.ready(); tg.expand();
    tg.setHeaderColor?.('#4BA1D2'); tg.setBackgroundColor?.('#4BA1D2'); tg.setBottomBarColor?.('#4BA1D2');
    // свайп вниз по кнопке не должен сворачивать приложение
    tg.disableVerticalSwipes?.();
  } catch { /* старый Telegram */ }
}

/** @param {'press'|'ok'|'bad'|'tap'} kind */
function haptic(kind) {
  try {
    const hf = tg?.HapticFeedback;
    if (hf) {
      if (kind === 'press') hf.impactOccurred('heavy');
      else if (kind === 'tap') hf.impactOccurred('light');
      else hf.notificationOccurred(kind === 'ok' ? 'success' : 'error');
    } else if (navigator.vibrate) navigator.vibrate(kind === 'bad' ? [40, 40, 40] : kind === 'press' ? 35 : 15);
  } catch { /* без вибро */ }
}

/** @type {any} */ let wakeLock = null;
async function keepAwake() {
  try { if (!wakeLock && document.visibilityState === 'visible') { wakeLock = await /** @type {any} */ (navigator).wakeLock?.request('screen'); wakeLock?.addEventListener?.('release', () => { wakeLock = null; }); } } catch { /* нет */ }
}

function appInfo() {
  const p = tg ? `tg ${tg.platform ?? ''} ${tg.version ?? ''}` : 'web';
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : '';
  return `${p} ${os}`.trim().slice(0, 80);
}

// ───────────────────────── общий каркас ─────────────────────────

const api = new Api(CFG.url || location.origin, CFG.key || '');

/** @param {string} title @param {string} text */
function fatal(title, text) {
  root.className = '';
  root.replaceChildren(h('div', { class: 'card-form' }, h('h1', null, title), h('p', null, text)));
}

/** Логотип на белой плашке: на голубом фоне голубой круг с «1» иначе теряется. */
const logoPlate = (cls = '') => h('span', { class: `plate ${cls}` }, h('span', null, h('img', { class: 'logo', src: 'logo.svg', alt: 'Ты — лидер', width: 162, height: 26 })));

function topBar(extra) {
  const net = h('span', { class: 'net', title: 'Связь с сервером' }, h('i'), h('span', null, '…'));
  return { el: h('div', { class: 'top' }, logoPlate(), extra ?? null, net), net };
}
/** @param {HTMLElement} net @param {boolean} online @param {string} text */
function setNet(net, online, text) {
  net.classList.toggle('off', !online);
  const s = /** @type {HTMLElement} */ (net.lastChild);
  if (s.textContent !== text) s.textContent = text;
}

// ───────────────────────── телефон команды ─────────────────────────

async function teamAuth() {
  // 1) Telegram: подпись initData проверяет функция knopka
  if (tg?.initData) {
    try {
      const r = await fetch(`${api.url}/functions/v1/knopka`, { method: 'POST', headers: api.headers, body: JSON.stringify({ initData: tg.initData }) });
      const j = await r.json().catch(() => null);
      if (j?.token) return /** @type {string} */ (j.token);
    } catch { /* ниже — запасной путь */ }
    // функция недоступна — входим как «браузер» с именем из Telegram (ведущий увидит значок 🌐)
    const u = tg.initDataUnsafe?.user;
    const name = [u?.first_name, u?.last_name].filter(Boolean).join(' ') || 'Капитан';
    const j = await api.rpc('bz_register_web', { p_device: deviceKey(), p_name: name }).catch(() => null);
    if (j?.token) return /** @type {string} */ (j.token);
  }
  // 2) Браузер: спрашиваем имя
  return await new Promise((resolve) => {
    root.className = '';
    const inp = /** @type {HTMLInputElement} */ (h('input', { autocomplete: 'name', maxlength: 40, placeholder: 'Например, Аня Смирнова', enterkeyhint: 'go' }));
    const err = h('p', { class: 'err' });
    const go = async () => {
      err.textContent = '';
      const j = await api.rpc('bz_register_web', { p_device: deviceKey(), p_name: inp.value }).catch((e) => ({ error: e.message }));
      if (j?.token) resolve(j.token); else err.textContent = j?.error || 'Не получилось войти';
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    root.replaceChildren(
      topBar().el,
      h('div', { class: 'card-form' },
        h('h1', null, 'Кнопка для ответов'),
        h('p', null, 'Удобнее открыть через Telegram-бота — там вход без имени. Если играешь из браузера, напиши, как тебя зовут: ведущий увидит это имя рядом с командой.'),
        h('label', { class: 'field' }, h('span', null, 'Имя и фамилия'), inp),
        err,
        bv('sun big wide', 'Войти', go),
        h('p', { class: 'small muted', style: 'margin:14px 0 0' }, 'Бот: ', h('a', { href: JOIN_URL }, `@${BOT}`))),
    );
    inp.focus();
  });
}

async function teamMode() {
  let token = LS.get('knopka.token');
  if (!token) {
    token = await teamAuth();
    LS.set('knopka.token', token);
  }
  root.className = 'team-app';
  const clock = new Clock();
  /** @type {TeamLink} */ let link;

  // ── разметка: строится один раз, дальше меняются только тексты и классы ──
  const top = topBar();
  const tilesGrid = h('div', { class: 'grid' });
  const pick = h('section', { class: 'pick' },
    h('h1', { class: 'outlined' }, 'Выбери команду'),
    h('p', { class: 'lead' }, 'От каждой команды отмечается один человек — тот, кто будет нажимать кнопку, когда у команды готов ответ.'),
    tilesGrid,
    h('div', { class: 'foot' }, h('button', { class: 'link', type: 'button', onclick: () => switchToHost() }, 'Я ведущий')));
  const tName = h('div', { class: 'name' });
  const tNum = num('–', 'sun lg');
  const tScore = h('b', null, '0');
  const tScoreWord = h('span', null, 'баллов');
  const btnLbl = h('span', { class: 'lbl' }, '');
  const btnSub = h('span', { class: 'sub' }, '');
  const btn = h('button', { class: 'big-btn wait', type: 'button', 'aria-live': 'polite' }, h('span', null, btnLbl, btnSub));
  const stMain = h('div', { class: 'main' });
  const stHint = h('div', { class: 'hint' });
  const orderList = h('ol');
  const orderTitle = h('h3');
  const order = h('div', { class: 'order hidden' }, orderTitle, orderList);
  const leaveBtn = h('button', { class: 'link', type: 'button', onclick: () => leave() }, 'Сменить команду');
  const game = h('section', { class: 'hidden', style: 'display:flex;flex-direction:column;flex:1' },
    h('div', { class: 'team-head' }, tNum, tName, h('div', { class: 'score' }, tScore, tScoreWord)),
    h('div', { class: 'stage' }, btn),
    h('div', { class: 'status' }, stMain, stHint),
    order,
    h('div', { class: 'foot' }, leaveBtn));
  root.replaceChildren(top.el, pick, game);

  /** @type {{round:number, ms:number, status:string}|null} */ let lastPress = null;
  let dead = false; // после «открыто на другом устройстве» старые обработчики молчат
  let earlyUntil = 0;
  let lastSig = '';

  const myTeam = () => link.state?.teams?.find((t) => t.mine) ?? null;
  const teamName = (id) => link.state?.teams?.find((t) => t.id === id)?.name ?? '—';

  function renderTiles() {
    const s = link.state;
    const sig = JSON.stringify([s?.teams?.map((t) => [t.id, t.name, t.claimed, t.mine]), s?.game?.locked]);
    if (sig === lastSig) return;
    lastSig = sig;
    tilesGrid.replaceChildren(...(s?.teams ?? []).map((t) => {
      const taken = t.claimed && !t.mine;
      return h('button', { class: `tile${taken ? ' taken' : ''}${t.mine ? ' mine' : ''}`, type: 'button', onclick: () => choose(t) },
        num(t.num), h('span', null, h('b', null, t.name), h('small', null, t.mine ? 'это вы' : taken ? 'занята' : 'свободна')));
    }));
  }

  /** @param {any} t */
  async function choose(t) {
    if (t.claimed && !t.mine) { toast(`За «${t.name}» уже играют. Если это ваша команда — попросите ведущего освободить её.`); return; }
    const ok = await confirmSheet(`Команда «${t.name}»`, 'Ты отвечаешь за кнопку этой команды: нажимаешь, когда у команды готов ответ. Других участников команды отмечать не нужно.', 'Да, играю');
    if (!ok) return;
    const r = await api.rpc('bz_claim', { p_token: token, p_team: t.id }).catch((e) => ({ error: e.message }));
    if (r?.code === 'auth') return authLost();
    if (!r?.ok) { toast(r?.error || 'Не получилось'); return; }
    haptic('ok');
    try { tg?.enableClosingConfirmation?.(); } catch { /* нет */ }
    link.kick();
  }

  async function leave() {
    const t = myTeam();
    if (!(await confirmSheet('Сменить команду?', `Кнопка команды «${t?.name ?? ''}» освободится, и её сможет взять другой человек.`, 'Сменить'))) return;
    const r = await api.rpc('bz_unclaim', { p_token: token }).catch((e) => ({ error: e.message }));
    if (!r?.ok) { toast(r?.error || 'Не получилось'); return; }
    try { tg?.disableClosingConfirmation?.(); } catch { /* нет */ }
    link.kick();
  }

  function renderGame() {
    const s = link.state, t = myTeam();
    if (!t) return;
    if (tName.textContent !== t.name) tName.textContent = t.name;
    if (tNum.textContent !== String(t.num)) tNum.textContent = String(t.num);
    if (tScore.textContent !== String(t.score)) { tScore.textContent = String(t.score); tScoreWord.textContent = plural(t.score, 'балл', 'балла', 'баллов'); }
    leaveBtn.classList.toggle('hidden', !!s.game?.locked);
    const r = s.round, pr = r?.presses ?? [];
    order.classList.toggle('hidden', !pr.length);
    if (pr.length) {
      orderTitle.textContent = `Вопрос ${r.n}: кто нажал`;
      // на телефоне — первые пять и своя строка, полный список у ведущего и на экране
      const shown = pr.filter((p) => p.place <= 5 || p.team === t.id);
      orderList.replaceChildren(...shown.map((p) => h('li', { class: p.team === t.id ? 'me' : '' },
        num(p.place, p.place === 1 ? 'sun' : ''), h('span', null, teamName(p.team)),
        p.tie || p.unsure ? h('span', { class: 'wait', title: 'Почти одновременно — решит ведущий' }, '≈') : null,
        p.verdict ? h('span', { class: p.verdict === 'ok' ? 'v-ok' : 'v-bad' }, p.verdict === 'ok' ? '✓' : '✗') : null,
        h('span', { class: 't' }, rel(p.rel_ms)), p.confirmed ? null : h('span', { class: 'wait' }, '…'))),
        ...(pr.length > shown.length ? [h('li', { class: 'wait' }, `и ещё ${pr.length - shown.length}`)] : []));
    }
  }

  /** Своё нажатие в текущем вопросе: ещё в пути, принято сервером или видно в списке. */
  function myPress() {
    const r = link.round, t = myTeam();
    if (!r || !t) return null;
    const inList = r.presses?.find((p) => p.team === t.id);
    if (inList) return { ms: inList.press_ms, status: 'ok', entry: inList };
    if (link.pending?.round === r.id) return { ms: link.pending.ms, status: 'sending', entry: null };
    const res = link.results.get(r.id);
    if (res) return { ms: res.press_ms, status: res.code, entry: null };
    return null;
  }

  /** Кнопка и подписи — каждый кадр (обратный отсчёт и «ЖМИ» загораются по часам сервера). */
  function paint() {
    const r = link?.round;
    const now = clock.ready ? clock.server() : NaN;
    const ph = !clock.ready ? 'nosync' : roundPhase(r, now);
    const mp = myPress();
    let cls = 'wait', lbl = '', sub = '', main = '', hint = '', placeCls = false;
    if (performance.now() < earlyUntil) {
      cls = 'early'; lbl = 'Рано!'; sub = 'старта ещё не было';
      main = 'Подожди старта'; hint = 'Нажатие до старта не считается';
    } else if (mp && r) {
      cls = 'pressed';
      lbl = rel(mp.ms - r.opens_ms);
      const e = mp.entry;
      if (mp.status === 'sending') {
        sub = 'отправляем…';
        main = 'Нажато!';
        hint = link.online ? 'Время касания записано — отправляем' : 'Нет связи. Время касания сохранено и уйдёт само, не закрывай приложение';
      } else if (mp.status !== 'ok') {
        cls = 'wait'; lbl = 'Не засчитано'; sub = '';
        main = 'Нажатие не засчитано';
        hint = mp.status === 'closed' || mp.status === 'timeout' ? 'Приём ответов уже был закрыт' : mp.status === 'void' ? 'Вопрос отменён' : 'Сервер не принял нажатие';
      } else if (e && e.confirmed) {
        sub = `${e.place}-е место`;
        main = e.place === 1 ? 'Вы первые!' : `${e.place}-е место`;
        placeCls = true;
        const prev = r.presses.find((p) => p.place === e.place - 1);
        hint = e.verdict === 'ok' ? `Верно! ${pts(e.points)}` : e.verdict === 'bad' ? `Неверно: ${pts(e.points)}`
          : (e.tie || e.unsure) && prev ? `Почти одновременно с «${teamName(prev.team)}» — решит ведущий`
          : prev ? `На ${sec(e.gap_ms)} с позже «${teamName(prev.team)}»` : 'Готовьте ответ';
      } else {
        sub = 'принято';
        main = 'Нажато!';
        hint = 'Сверяем время остальных команд…';
      }
    } else {
      switch (ph) {
        case 'nosync': lbl = 'Подключаемся'; main = 'Сверяем часы с сервером'; hint = 'Пара секунд'; break;
        case 'idle': lbl = 'Ждём вопрос'; main = 'Ждём вопрос'; hint = 'Когда ведущий запустит вопрос, кнопка станет жёлтой. Не блокируй экран'; break;
        case 'countdown': cls = 'count'; lbl = String(Math.max(1, Math.ceil((r.opens_ms - now) / 1000))); main = 'Приготовьтесь'; hint = 'Нажатие до старта не считается'; break;
        case 'open':
          cls = 'go'; lbl = 'Жми';
          sub = r.closes_ms ? `осталось ${Math.max(0, Math.ceil((r.closes_ms - now) / 1000))} с` : '';
          main = 'Жми, когда готов ответ';
          hint = r.closes_ms ? `На ответ ${Math.round((r.closes_ms - r.opens_ms) / 1000)} с` : `Идёт ${sec1(now - r.opens_ms)} с`;
          break;
        case 'closed': {
          lbl = 'Приём закрыт'; main = 'Приём закрыт';
          const f = r.presses?.[0];
          hint = f ? `Первыми нажали «${teamName(f.team)}». Ждём следующий вопрос` : 'Ждём следующий вопрос';
          break;
        }
        case 'void': lbl = 'Вопрос отменён'; main = 'Вопрос отменён'; hint = 'Ведущий переиграет его'; break;
      }
    }
    const want = `big-btn ${cls}`;
    if (btn.className !== want) btn.className = want;
    if (btnLbl.textContent !== lbl) btnLbl.textContent = lbl;
    if (btnSub.textContent !== sub) btnSub.textContent = sub;
    if (stMain.textContent !== main) stMain.textContent = main;
    stMain.classList.toggle('place', placeCls);
    if (stHint.textContent !== hint) stHint.textContent = hint;
    const netText = !link?.online ? 'нет связи' : Number.isFinite(clock.lastRtt) ? `${Math.round(clock.lastRtt)} мс` : '…';
    setNet(top.net, link?.online ?? true, netText);
  }

  function frame() { if (dead) return; if (link?.state?.me?.team) paint(); requestAnimationFrame(frame); }

  /** Касание: время берём из события (момент касания), а не из обработчика. @param {Event} e */
  function onPress(e) {
    e.preventDefault();
    keepAwake();
    const now = performance.now();
    const ts = e.timeStamp;
    const t = ts > 0 && ts <= now + 1 && now - ts < 1000 ? ts : now;
    const res = link.press(t);
    if (res === 'pressed') { haptic('press'); paint(); }
    else if (res === 'early') { haptic('bad'); earlyUntil = performance.now() + (link.state?.game?.lockout_ms || 600); paint(); }
    else if (res === 'nosync') toast('Ещё сверяем часы с сервером — секунду');
  }
  if ('PointerEvent' in window) btn.addEventListener('pointerdown', onPress, { passive: false });
  else btn.addEventListener('touchstart', onPress, { passive: false });
  btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) onPress(e); });
  btn.addEventListener('click', (e) => e.preventDefault());
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  function onState() {
    const hasTeam = !!link.state?.me?.team;
    pick.classList.toggle('hidden', hasTeam);
    game.classList.toggle('hidden', !hasTeam);
    // случайный свайп или «назад» не должны закрыть кнопку посреди игры
    try { if (hasTeam) tg?.enableClosingConfirmation?.(); else tg?.disableClosingConfirmation?.(); } catch { /* старый Telegram */ }
    if (hasTeam) renderGame(); else { renderTiles(); setNet(top.net, link.online, link.online ? `${Math.round(clock.lastRtt || 0)} мс` : 'нет связи'); }
  }

  function authLost() {
    dead = true;
    link?.stop();
    LS.set('knopka.token', null);
    root.replaceChildren(topBar().el, h('div', { class: 'card-form' },
      h('h1', null, 'Кнопка открыта на другом устройстве'),
      h('p', null, 'Нажимать можно только с одного телефона. Если хочешь играть с этого — войди здесь, и кнопка на другом устройстве отключится.'),
      bv('sun big wide', 'Играть на этом устройстве', () => { root.replaceChildren(); teamMode(); })));
  }

  link = new TeamLink({
    api, clock, token, app: appInfo(),
    store: { get: (k) => LS.get(k), set: (k, v) => LS.set(k, v) },
    onState, onAuthLost: authLost,
    onPress: (p) => { lastPress = p; if (p.status === 'ok') haptic('ok'); else if (p.status !== 'sending') haptic('bad'); },
    onNet: () => paint(),
  });
  link.start();
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    if (dead) return;
    if (document.visibilityState === 'visible') { link.start(); keepAwake(); } else link.stop();
  });
  addEventListener('pageshow', () => { if (!dead) link.start(); });
  void lastPress;
}

// ───────────────────────── ведущий ─────────────────────────

function switchToHost() {
  LS.set('knopka.mode', 'host');
  root.replaceChildren();
  hostMode();
}

/** @returns {Promise<string>} */
function hostLogin() {
  return new Promise((resolve) => {
    root.className = 'host';
    const inp = /** @type {HTMLInputElement} */ (h('input', { autocomplete: 'off', autocapitalize: 'characters', maxlength: 60, enterkeyhint: 'go' }));
    const err = h('p', { class: 'err' });
    const go = async () => {
      err.textContent = '';
      const r = await api.rpc('bz_host_login', { p_code: inp.value, p_key: deviceKey() }).catch((e) => ({ error: e.message }));
      if (r?.token) { LS.set('knopka.host', r.token); resolve(r.token); } else err.textContent = r?.error || 'Не получилось';
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    root.replaceChildren(topBar().el, h('div', { class: 'host-wrap' }, h('div', { class: 'card-form', style: 'margin:20px 0' },
      h('h1', null, 'Вход ведущего'),
      h('p', null, 'Код организатора игры ШПА или отдельный код кнопки, если его задали в настройках.'),
      h('label', { class: 'field' }, h('span', null, 'Код'), inp), err,
      bv('sun big wide', 'Войти', go),
      h('p', { style: 'margin:14px 0 0' }, h('button', { class: 'link dark', type: 'button', onclick: () => { LS.set('knopka.mode', null); location.search = ''; root.replaceChildren(); teamMode(); } }, 'Я капитан команды')))));
    inp.focus();
  });
}

async function hostMode() {
  root.className = 'host';
  let token = LS.get('knopka.host') || await hostLogin();
  const clock = new Clock();
  let tab = LS.get('knopka.tab') || 'game';
  /** @type {any} */ let S = null;
  let busy = false;
  const top = topBar(h('span', { class: 'tag', style: 'margin-right:auto' }, h('span', null, 'Ведущий')));
  const tabsEl = h('nav', { class: 'tabs', 'aria-label': 'Разделы' });
  const body = h('div');
  root.replaceChildren(top.el, h('div', { class: 'host-wrap' }, tabsEl, body));
  const TABS = [['game', 'Игра'], ['teams', 'Команды'], ['score', 'Счёт'], ['settings', 'Настройки']];
  function renderTabs() {
    tabsEl.replaceChildren(...TABS.map(([id, label]) => bv('', label, () => { tab = id; LS.set('knopka.tab', id); sig = ''; renderTabs(); render(); }, { 'aria-current': String(tab === id) })));
  }
  renderTabs();

  /** @param {string} name @param {Record<string, unknown>} [arg] */
  let lastActAt = 0;
  async function act(name, arg = {}) {
    // двойной клик по «Старт» не должен сразу нажать появившийся на его месте «Стоп»
    const guarded = ['start', 'stop', 'void'].includes(name);
    if (busy || (guarded && performance.now() - lastActAt < 700)) return null;
    busy = true;
    if (guarded) lastActAt = performance.now();
    try {
      const r = await api.rpc('bz_host', { p_host: token, p_act: name, p_arg: arg });
      if (r?.error === 'auth') { lost(); return null; }
      if (r?.error) { toast(r.error); return null; }
      S = r; poller.state = r; sig = ''; render(); haptic('tap');
      return r;
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); return null; }
    finally { busy = false; poller.kick(); }
  }

  const team = (id) => S?.teams?.find((t) => t.id === id);
  const tname = (id) => team(id)?.name ?? '—';
  let sig = '';
  const phaseEl = h('span', { class: 'phase' });

  function render() {
    if (!S) return;
    if (tab === 'settings') { if (sig !== 'settings') { sig = 'settings'; body.replaceChildren(...settingsTab()); } return; }
    // перерисовываем, только когда поменялось что-то значимое (иначе клик может попасть в исчезнувшую кнопку)
    const r = S.round;
    const k = JSON.stringify([tab, S.v, r?.status, r?.presses?.map((p) => [p.team, p.confirmed, p.verdict, p.tie]), r?.waiting, r?.offline,
      r?.presses?.map((p) => p.unsure),
      S.teams.map((t) => [t.id, t.online, tab === 'teams' ? [Math.round((t.rtt ?? 0) / 20), Math.round(t.err ?? 0), t.seen_lag > 150] : t.seen_lag > 150])]);
    if (k === sig) return;
    sig = k;
    body.replaceChildren(...(tab === 'game' ? gameTab() : tab === 'teams' ? teamsTab() : scoreTab()));
  }

  function gameTab() {
    const r = S.round;
    const st = r ? roundPhase(r, clock.ready ? clock.server() : Date.now()) : 'idle';
    const live = st === 'open' || st === 'countdown';
    const next = r ? (r.status === 'void' ? r.n : r.n + 1) : 1;
    const claimed = S.teams.filter((t) => t.claimed).length;
    const ctl = h('section', { class: 'panel' },
      h('div', { class: 'ctl-head' }, h('h2', null, r ? `Вопрос ${r.n}` : 'Вопросов ещё не было'), phaseEl),
      h('div', { class: 'ctl-grid' },
        live ? bv('ink big', 'Стоп приёма', () => act('stop')) : bv('sun big', `Старт вопроса ${next}`, () => act('start')),
        live ? bv('sun', `Сразу вопрос ${r.n + 1}`, () => act('start')) : null,
        bv('', 'Переиграть вопрос', async () => { if (await confirmSheet(`Переиграть вопрос ${r.n}?`, 'Нажатия и баллы этого вопроса не будут считаться. Следующий старт будет снова этим номером.', 'Переиграть')) act('void'); }, { disabled: !r || r.status === 'void' ? true : null })),
      h('p', { class: 'small muted', style: 'margin:12px 0 0' },
        `Отсчёт ${S.game.countdown_ms / 1000} с`, S.game.limit_ms ? `, на ответ ${S.game.limit_ms / 1000} с` : ', без лимита времени',
        `. Команд с капитаном: ${claimed} из ${S.teams.length}.`));
    const out = [ctl];
    if (r) {
      const pr = r.presses;
      const rows = pr.map((p) => {
        const t = team(p.team);
        const flags = [];
        if (!p.confirmed) flags.push(h('span', { class: 'pill wait', title: 'Ждём, пока все команды на связи отчитаются за этот момент' }, '⏳ сверяем'));
        else flags.push(h('span', { class: 'pill ok' }, '✓ точно'));
        if (p.tie) flags.push(h('span', { class: 'pill warn', title: 'Разница с предыдущей командой меньше 30 мс — в пределах точности' }, '≈ одновременно'));
        else if (p.unsure) flags.push(h('span', { class: 'pill warn', title: 'Разница с предыдущей командой меньше, чем погрешность часов двух телефонов (плохая связь у кого-то из них) — порядок не гарантирован' }, '? порядок под вопросом'));
        if (p.flags?.includes('asof')) flags.push(h('span', { class: 'pill bad', title: 'Телефон сначала сообщил, что не нажимал, а потом прислал более раннее нажатие. У исправного телефона так почти не бывает — стоит проверить' }, 'нажатие задним числом'));
        if (p.flags?.includes('late') || p.delivery_ms > Math.max(800, 2.5 * (p.rtt ?? 0))) flags.push(h('span', { class: 'pill warn', title: 'Нажатие шло до сервера дольше обычного (потери или обрыв связи). Время касания сохранено, но при споре стоит учесть' }, `дошло через ${sec1(p.delivery_ms)} с`));
        if (p.flags?.includes('future')) flags.push(h('span', { class: 'pill bad', title: 'Метка времени была из будущего — засчитано время прихода' }, 'сбой часов'));
        if (p.flags?.includes('sync') || p.err > 150) flags.push(h('span', { class: 'pill warn', title: 'Плохая связь: время измерено с большой погрешностью' }, `точность ±${Math.round(p.err)} мс`));
        if (t?.seen_lag > 150) flags.push(h('span', { class: 'pill warn', title: 'Телефон узнал о старте позже остальных' }, `старт увидели на ${sec1(t.seen_lag)} с позже`));
        return h('div', { class: `prow${p.place === 1 ? ' first' : ''}` },
          num(p.place, p.place === 1 ? 'sun' : ''),
          h('div', { class: 'who' }, h('b', null, tname(p.team)),
            h('div', { class: 'meta' }, t?.captain ? h('span', null, t.captain.name) : null, h('span', null, `пинг ${p.rtt ?? '—'} мс, точность ±${Math.round(p.err ?? 0)} мс`))),
          h('div', { class: 'time' }, rel(p.rel_ms), p.gap_ms != null ? h('small', null, `+${sec(p.gap_ms)} к пред.`) : null),
          h('div', { class: 'acts' },
            bv(`small vbtn ${p.verdict === 'ok' ? 'ok' : ''}`, `✓ Верно +${S.game.pts_ok}`, () => act('verdict', { team: p.team, round: r.id, v: p.verdict === 'ok' ? null : 'ok' }), { 'aria-pressed': String(p.verdict === 'ok') }),
            bv(`small vbtn ${p.verdict === 'bad' ? 'bad' : ''}`, `✗ Неверно −${S.game.pts_bad}`, () => act('verdict', { team: p.team, round: r.id, v: p.verdict === 'bad' ? null : 'bad' }), { 'aria-pressed': String(p.verdict === 'bad') }),
            ...flags));
      });
      out.push(h('section', { class: 'panel' }, h('h2', null, 'Порядок нажатий'),
        rows.length ? h('div', { class: 'rows' }, rows) : h('p', { class: 'muted', style: 'margin:0' }, live ? 'Пока никто не нажал' : 'Никто не нажал'),
        r.waiting?.length ? h('p', { class: 'small', style: 'margin:12px 0 0' }, h('b', null, 'Ещё не нажали: '), r.waiting.map(tname).join(', ')) : null,
        r.offline?.length ? h('p', { class: 'small', style: 'margin:6px 0 0;color:var(--bad)' }, h('b', null, 'Нет связи: '), r.offline.map(tname).join(', '),
          '. Если такая команда нажала без связи, её нажатие придёт позже и встанет на своё место по времени касания.') : null));
    }
    const hist = S.history ?? [];
    if (hist.length) {
      out.push(h('section', { class: 'panel' }, h('h2', null, 'Прошлые вопросы'),
        h('div', { class: 'rows' }, hist.slice(0, 12).map((q) => h('div', { class: 'small' },
          h('b', null, `Вопрос ${q.n}${q.status === 'void' ? ' (переигран)' : ''}: `),
          q.order.length ? q.order.map((o, i) => `${i + 1}. ${tname(o.team)} ${rel(o.rel_ms)}${o.verdict === 'ok' ? ' ✓' : o.verdict === 'bad' ? ' ✗' : ''}`).join('   ') : 'никто не нажал')))));
    }
    return out;
  }

  function teamsTab() {
    const rows = S.teams.map((t) => h('div', { class: 'trow' }, num(t.num),
      h('div', null, h('b', null, t.name),
        h('div', { class: 'meta' },
          t.captain ? [h('span', null, h('span', { class: `dot${t.online ? ' on' : ''}` }), ' ', t.captain.name, t.captain.username ? ` @${t.captain.username}` : '', t.captain.kind === 'web' ? ' 🌐 браузер' : ''),
            t.online ? h('span', null, `пинг ${t.rtt ?? '—'} мс, точность ±${t.err ?? '—'} мс`) : h('span', { style: 'color:var(--bad)' }, 'нет связи')]
            : h('span', null, 'капитана нет'))),
      t.captain ? bv('small', 'Освободить', async () => { if (await confirmSheet(`Освободить «${t.name}»?`, `${t.captain.name} больше не сможет нажимать за эту команду. Команду сможет взять другой человек.`, 'Освободить')) act('release', { team: t.id }); }) : h('span')));
    return [
      h('section', { class: 'panel' }, h('h2', null, 'Как капитанам подключиться'),
        h('div', { class: 'join' },
          BOT === 'shpa_game_bot' ? h('img', { src: 'qr-join.svg', alt: 'QR-код: открыть кнопку в Telegram', width: 150, height: 150 }) : h('span'),
          h('div', null,
            h('p', { style: 'margin:0 0 10px' }, 'Капитан сканирует QR или открывает ссылку — в Telegram откроется кнопка, он выбирает свою команду.'),
            h('p', { style: 'margin:0 0 12px' }, h('span', { class: 'code' }, JOIN_URL)),
            h('div', { class: 'row' }, bv('small', 'Скопировать ссылку', () => copy(JOIN_URL)),
              bv('small', 'Ссылка на экран для зала', () => copy(`${location.origin}${location.pathname}?screen`)))))),
      h('section', { class: 'panel' }, h('h2', null, 'Если Telegram не открывается'),
        h('div', { class: 'join' },
          location.hostname === 'mxsm-brsv.github.io' ? h('img', { src: 'qr-web.svg', alt: 'QR-код: кнопка в браузере', width: 150, height: 150 }) : h('span'),
          h('div', null,
            h('p', { style: 'margin:0 0 10px' }, 'Та же кнопка открывается в обычном браузере телефона: капитан вводит имя и выбирает команду. У ведущего такой капитан отмечен «браузер». Честность та же — время касания и часы сервера.'),
            h('p', { style: 'margin:0 0 12px' }, h('span', { class: 'code' }, `${location.origin}${location.pathname}`)),
            bv('small', 'Скопировать ссылку', () => copy(`${location.origin}${location.pathname}`))))),
      h('section', { class: 'panel' },
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, h('h2', { style: 'margin:0' }, 'Команды'),
          h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: S.game.locked, onchange: (e) => act('lock', { on: e.target.checked }) }), 'Закрыть выбор команд')),
        h('div', null, rows),
        h('div', { class: 'row', style: 'margin-top:14px' },
          bv('', 'Изменить список', () => editTeams()),
          bv('', 'Освободить все', async () => { if (await confirmSheet('Освободить все команды?', 'Все капитаны отключатся от команд и выберут их заново.', 'Освободить все')) act('release_all'); }))),
    ];
  }

  function editTeams() {
    const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', { spellcheck: 'false' }));
    ta.value = S.teams.map((t) => t.name).join('\n');
    sheet((close) => [
      h('h2', null, 'Список команд'),
      h('p', null, 'По одной в строке, до 20. Номер команды — номер строки; капитан остаётся за номером.'),
      h('label', { class: 'field' }, ta),
      h('div', { class: 'row' },
        bv('sun', 'Сохранить список', async () => { const names = ta.value.split('\n').map((x) => x.trim()).filter(Boolean); if (await act('teams', { names })) close(); }),
        bv('', 'Отмена', close)),
    ]);
  }

  function scoreTab() {
    const list = S.teams.slice().sort((a, b) => b.score - a.score || a.num - b.num);
    return [h('section', { class: 'panel' }, h('h2', null, 'Счёт'),
      h('div', null, list.map((t) => h('div', { class: 'trow' }, num(t.num), h('b', null, t.name),
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:nowrap' },
          bv('small', '−1', () => act('adjust', { team: t.id, delta: -1 }), { 'aria-label': `Минус балл: ${t.name}` }),
          h('span', { class: 'score-n' }, String(t.score)),
          bv('small', '+1', () => act('adjust', { team: t.id, delta: 1 }), { 'aria-label': `Плюс балл: ${t.name}` })))))),
      h('section', { class: 'panel' }, h('h2', null, 'Новая игра'),
        h('p', { style: 'margin:0 0 12px' }, 'Счёт и вопросы с нуля. Команды и капитаны остаются.'),
        bv('ink', 'Начать новую игру', async () => { if (await confirmSheet('Начать новую игру?', 'Счёт всех команд и история вопросов обнулятся.', 'Начать заново')) act('new_game'); }))];
  }

  function settingsTab() {
    const g = S.game;
    /** @param {string} label @param {string} key @param {[number,string][]} opts @param {number} cur */
    const sel = (label, key, opts, cur) => h('label', { class: 'field' }, h('span', null, label),
      h('select', { onchange: (e) => act('settings', { [key]: Number(e.target.value) }) },
        ...opts.map(([v, t]) => h('option', { value: v, selected: v === cur }, t))));
    const codeInp = /** @type {HTMLInputElement} */ (h('input', { maxlength: 60, autocomplete: 'off', placeholder: g.own_code ? 'Задан — введите новый, чтобы сменить' : 'Не задан' }));
    const title = /** @type {HTMLInputElement} */ (h('input', { maxlength: 60, value: g.title }));
    return [
      h('section', { class: 'panel' }, h('h2', null, 'Вопрос'),
        h('div', { class: 'set-grid' },
          sel('Обратный отсчёт перед стартом', 'countdown_ms', [[0, 'Без отсчёта'], [1000, '1 с'], [2000, '2 с'], [3000, '3 с'], [5000, '5 с']], g.countdown_ms),
          sel('Время на ответ', 'limit_ms', [[0, 'Без лимита'], [10000, '10 с'], [15000, '15 с'], [20000, '20 с'], [30000, '30 с'], [45000, '45 с'], [60000, '1 мин'], [90000, '1,5 мин'], [120000, '2 мин']], g.limit_ms),
          sel('Верный ответ', 'pts_ok', [[1, '+1'], [2, '+2'], [3, '+3'], [5, '+5']], g.pts_ok),
          sel('Неверный ответ', 'pts_bad', [[0, '0'], [1, '−1'], [2, '−2'], [3, '−3']], g.pts_bad),
          sel('Блок за нажатие до старта', 'lockout_ms', [[0, 'Нет'], [500, '0,5 с'], [1000, '1 с'], [2000, '2 с']], g.lockout_ms)),
        h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: g.auto_close, onchange: (e) => act('settings', { auto_close: e.target.checked }) }),
          'Закрывать приём, когда нажали все команды'),
        h('p', { class: 'small muted', style: 'margin:10px 0 0' }, 'Отсчёт даёт всем телефонам узнать о старте заранее: кнопка загорается у всех в один момент по часам сервера. Рекомендуем 3 с.')),
      h('section', { class: 'panel' }, h('h2', null, 'Название на экране'),
        h('label', { class: 'field' }, title), bv('small', 'Сохранить название', () => act('settings', { title: title.value }))),
      h('section', { class: 'panel' }, h('h2', null, 'Код ведущего'),
        h('p', { style: 'margin:0 0 12px' }, 'Код организатора ШПА подходит всегда. Можно задать отдельный код — только для кнопки, чтобы передать его ведущему вечера.'),
        h('label', { class: 'field' }, codeInp),
        h('div', { class: 'row' },
          bv('small', 'Задать код', async () => { if (await act('host_code', { code: codeInp.value })) { codeInp.value = ''; toast('Код ведущего сохранён'); } }),
          g.own_code ? bv('small', 'Убрать свой код', () => act('host_code', { code: '' })) : null,
          bv('small', 'Выйти на других устройствах', () => act('logout_others').then((r) => r && toast('Другие ведущие вышли'))))),
      h('section', { class: 'panel' }, h('h2', null, 'Это устройство'),
        h('div', { class: 'row' },
          bv('small', 'Открыть экран для зала', () => { location.href = `${location.pathname}?screen`; }),
          bv('small', 'Перейти к кнопке капитана', () => { LS.set('knopka.mode', null); location.href = location.pathname + location.hash; }),
          bv('small', 'Выйти', () => { LS.set('knopka.host', null); LS.set('knopka.mode', null); location.reload(); }))),
    ];
  }

  let dead = false;
  function lost() {
    dead = true;
    poller.stop();
    LS.set('knopka.host', null);
    toast('Вход ведущего истёк — введите код ещё раз');
    root.replaceChildren();
    hostMode();
  }

  const poller = new Poller({ api, clock, fn: 'bz_host_state', args: { p_host: token }, onState: (s) => { S = s; render(); }, onAuthLost: lost,
    onNet: (ok) => setNet(top.net, ok, ok ? 'на связи' : 'нет связи') });
  poller.start();

  // секундомер вопроса — каждый кадр, без перерисовки списка
  const tickPhase = () => {
    if (dead) return;
    const r = S?.round;
    if (r && clock.ready) {
      const now = clock.server(), ph = roundPhase(r, now);
      const txt = ph === 'countdown' ? `старт через ${Math.ceil((r.opens_ms - now) / 1000)}` : ph === 'open' ? `идёт ${sec1(now - r.opens_ms)} с${r.closes_ms ? `, осталось ${Math.max(0, Math.ceil((r.closes_ms - now) / 1000))} с` : ''}`
        : ph === 'void' ? 'переигран' : `приём закрыт${r.settled ? '' : ', сверяем время'}`;
      if (phaseEl.textContent !== txt) phaseEl.textContent = txt;
      phaseEl.classList.toggle('live', ph === 'open' || ph === 'countdown');
      // смена фазы (отсчёт → идёт → закрыт по лимиту) меняет кнопки
      if (lastPh !== ph) { lastPh = ph; sig = ''; render(); }
      if (Number.isFinite(clock.lastRtt) && poller.online) setNet(top.net, true, `${Math.round(clock.lastRtt)} мс`);
    }
    requestAnimationFrame(tickPhase);
  };
  let lastPh = '';
  requestAnimationFrame(tickPhase);
}

// ───────────────────────── экран зала ─────────────────────────

async function screenMode() {
  root.className = 'screen';
  const clock = new Clock();
  const qEl = h('div', { class: 'q' });
  const clockEl = h('div', { class: 'clock' });
  const msg = h('div', { class: 'msg' });
  const list = h('div', { class: 'list' });
  root.replaceChildren(
    h('div', { class: 'side' }, logoPlate('lg'), qEl, clockEl, msg),
    list);
  /** @type {any} */ let S = null;
  let sig = '';
  const tname = (id) => S?.teams?.find((t) => t.id === id)?.name ?? '—';
  const tnum = (id) => S?.teams?.find((t) => t.id === id)?.num ?? '';

  function renderList() {
    const r = S.round;
    const ph = r && clock.ready ? roundPhase(r, clock.server()) : 'idle';
    const showBoard = !r || ph === 'void' || (ph === 'closed' && !r.presses.length);
    const k = JSON.stringify([showBoard, S.teams.map((t) => [t.id, t.name, t.score]), r?.id, r?.presses?.map((p) => [p.team, p.confirmed, p.verdict])]);
    if (k === sig) return;
    sig = k;
    if (showBoard) {
      const teams = S.teams.slice().sort((a, b) => b.score - a.score || a.num - b.num);
      list.replaceChildren(h('h2', { class: 'board' }, 'Счёт'), ...teams.map((t, i) => h('div', { class: `bar${i === 0 && t.score > 0 ? ' first' : ''}` },
        num(t.num), h('b', null, t.name), h('span', { class: 't' }, String(t.score)))));
    } else {
      list.replaceChildren(h('h2', { class: 'board' }, 'Кто нажал'), ...(r.presses.length ? [] : [h('div', { class: 'msg' }, 'Пока никто')]), ...r.presses.map((p) => h('div', { class: `bar${p.place === 1 ? ' first' : ''}` },
        num(p.place, p.place === 1 ? 'ink' : ''), h('b', null, tname(p.team)),
        h('span', { class: 't' }, rel(p.rel_ms), h('small', null, p.verdict === 'ok' ? 'верно' : p.verdict === 'bad' ? 'неверно' : p.confirmed ? '' : 'сверяем…')))));
    }
  }

  function paint() {
    if (S) {
      const r = S.round;
      const now = clock.ready ? clock.server() : NaN;
      const ph = r && clock.ready ? roundPhase(r, now) : 'idle';
      let cls = 'clock closed', txt = '', q = S.game.title, m = '';
      if (r) q = `Вопрос ${r.n}`;
      if (ph === 'countdown') { cls = 'clock count'; txt = String(Math.max(1, Math.ceil((r.opens_ms - now) / 1000))); m = 'Приготовьтесь'; }
      else if (ph === 'open') {
        cls = 'clock open';
        txt = r.closes_ms ? String(Math.max(0, Math.ceil((r.closes_ms - now) / 1000))) : sec1(now - r.opens_ms);
        m = r.closes_ms ? 'Секунд на ответ' : 'Жмите, когда готов ответ';
      } else if (ph === 'closed') {
        txt = 'Стоп';
        const okP = r.presses.find((p) => p.verdict === 'ok'), nextP = r.presses.find((p) => p.verdict !== 'bad');
        m = okP ? `Верный ответ: «${tname(okP.team)}»` : nextP ? `Отвечает «${tname(nextP.team)}»` : r.presses.length ? 'Верного ответа нет' : 'Никто не нажал';
      }
      else if (ph === 'void') { txt = 'Пауза'; m = 'Вопрос переиграем'; }
      else { txt = 'Скоро'; m = 'Капитаны, откройте кнопку в Telegram'; }
      if (clockEl.className !== cls) clockEl.className = cls;
      if (clockEl.textContent !== txt) clockEl.textContent = txt;
      if (qEl.textContent !== q) qEl.textContent = q;
      if (msg.textContent !== m) msg.textContent = m;
      renderList();
    }
    requestAnimationFrame(paint);
  }
  void tnum;
  const poller = new Poller({ api, clock, fn: 'bz_screen', onState: (s) => { S = s; } });
  poller.start();
  requestAnimationFrame(paint);
  await syncBurst(api, clock, 4);
}

// ───────────────────────── старт ─────────────────────────

(async () => {
  if (!CFG.url) { fatal('Кнопка не настроена', 'Нет адреса сервера. Его подставляет сборка на GitHub (Deploy game) из deploy.env.'); return; }
  await initTelegram();
  const mode = qs.has('screen') ? 'screen' : qs.has('host') || LS.get('knopka.mode') === 'host' ? 'host' : 'team';
  try {
    if (mode === 'screen') await screenMode();
    else if (mode === 'host') await hostMode();
    else await teamMode();
  } catch (e) {
    console.error(e);
    fatal('Не получилось открыть кнопку', `${e instanceof Error ? e.message : e}. Проверь интернет и открой ещё раз.`);
  }
})();
