// @ts-check
// Вечерка ШПА — интерфейс: телефон участника (профбюро, кнопка, голосование), панель ведущего (?host)
// и экран для зала (?screen). ?demo — то же самое без сервера (demo.js), для показа и репетиции.
import { Api, ApiError, Clock, Poller, TeamLink, roundPhase, syncBurst } from './core.js';
import { qrSvg } from './qr.js';

/** @type {{url:string, key:string, bot?:string, mainApp?:boolean}} */
const CFG = /** @type {any} */ (window).KNOPKA_CFG || { url: '', key: '' };
const root = /** @type {HTMLElement} */ (document.getElementById('app'));
// демо в рамке (srcdoc) передаёт режим через window.KNOPKA_QS — у такой страницы нет своего адреса
const qs = new URLSearchParams(/** @type {any} */ (window).KNOPKA_QS ?? location.search);
const DEMO = qs.has('demo');
const BOT = (CFG.bot || '').replace(/^@/, '');
const PAGE_URL = DEMO ? 'https://mxsm-brsv.github.io/SHPA_GAME/knopka/' : `${location.origin}${location.pathname}`;
/** Ссылка для участников: бот вечерки (если настроен), иначе страница в браузере. */
const JOIN_URL = BOT ? (CFG.mainApp ? `https://t.me/${BOT}?startapp=knopka` : `https://t.me/${BOT}?start=go`) : PAGE_URL;

const memory = new Map();
const LS = DEMO
  ? { get: (k) => memory.get(k) ?? null, set: (k, v) => (v === null ? memory.delete(k) : memory.set(k, v)) }
  : {
    /** @param {string} k */ get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    /** @param {string} k @param {string|null} v */ set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* приватный режим */ } },
  };

// ───────────────────────── мелочи ─────────────────────────

/** @param {string} tag @param {Record<string, any>|null} [props] @param {...any} kids @returns {HTMLElement} */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
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
/** @param {string} cls @param {string|Node} label @param {(e:Event)=>void} on @param {Record<string,any>} [extra] */
const bv = (cls, label, on, extra = {}) => h('button', { class: `bv ${cls}`, type: 'button', onclick: on, ...extra }, h('span', null, label));
/** replaceChildren без «null» в тексте: пустые части пропускаются. @param {Element} el @param {...any} kids */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const num = (n, cls = '') => h('span', { class: `num ${cls}` }, String(n));
const sec = (ms) => (ms / 1000).toFixed(Math.abs(ms) < 10000 ? 3 : Math.abs(ms) < 100000 ? 2 : 1).replace('.', ',');
const rel = (ms) => `+${sec(Math.max(0, ms))} с`;
const sec1 = (ms) => (ms / 1000).toFixed(1).replace('.', ',');
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
const pts = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} ${plural(n, 'балл', 'балла', 'баллов')}`;
const qrBox = (text, cls = 'qr') => h('div', { class: cls, html: qrSvg(text, '#0B2A3D', '#FFFFFF', 2), role: 'img', 'aria-label': `QR-код: ${text}` });

let toastTimer = /** @type {any} */ (null);
/** @param {string} text */
function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3400);
}

/** Окно поверх. @param {(close: () => void) => Node[]} build */
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
      h('div', { class: 'row' }, bv('sun', yes, () => { close(); resolve(true); }), bv('', 'Отмена', () => { close(); resolve(false); })),
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
    tg.setHeaderColor?.('#009FE3'); tg.setBackgroundColor?.('#009FE3'); tg.setBottomBarColor?.('#009FE3');
    tg.disableVerticalSwipes?.(); // свайп вниз по кнопке не должен сворачивать приложение
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
  const p = tg ? `tg ${tg.platform ?? ''} ${tg.version ?? ''}` : DEMO ? 'demo' : 'web';
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : '';
  return `${p} ${os}`.trim().slice(0, 80);
}

// ───────────────────────── общий каркас ─────────────────────────

/** @type {any} */ let api = null;

/** @param {string} title @param {string} text */
function fatal(title, text) {
  root.className = '';
  fill(root, h('div', { class: 'card-form' }, h('h1', null, title), h('p', null, text)));
}

/** @param {Node|null} [extra] @param {boolean} [peaks] */
function topBar(extra = null, peaks = true) {
  const net = h('span', { class: 'net', title: 'Связь с сервером' }, h('i'), h('span', null, '…'));
  const el = h('div', { class: 'top' },
    peaks ? h('div', { class: 'peaks', 'aria-hidden': 'true' }) : null,
    h('span', { class: 'mark' }, h('img', { src: 'mark.svg', alt: '', width: 30, height: 30 }), 'Вечерка ШПА'),
    extra, net);
  return { el, net };
}
/** @param {HTMLElement} net @param {boolean} online @param {string} text */
function setNet(net, online, text) {
  net.classList.toggle('off', !online);
  const s = /** @type {HTMLElement} */ (net.lastChild);
  if (s.textContent !== text) s.textContent = text;
}
const clipName = (k, teams) => k.title || (teams.find((t) => t.id === k.team)?.name ?? 'Клип');
const clipSub = (k, teams) => (k.title && k.team ? teams.find((t) => t.id === k.team)?.name ?? '' : '');

// ───────────────────────── телефон участника ─────────────────────────

async function teamAuth() {
  if (DEMO) {
    const j = await api.rpc('bz_register_web', { p_device: deviceKey(), p_name: 'Вы' });
    return /** @type {string} */ (j.token);
  }
  // 1) Telegram: подпись initData проверяет функция knopka
  if (tg?.initData) {
    try {
      const r = await fetch(`${api.url}/functions/v1/knopka`, { method: 'POST', headers: api.headers, body: JSON.stringify({ initData: tg.initData }) });
      const j = await r.json().catch(() => null);
      if (j?.token) return /** @type {string} */ (j.token);
    } catch { /* ниже — запасной путь */ }
  }
  // 2) Браузер (или Telegram без связи с функцией): телефон заводим по ключу устройства, кто это — скажет ФИО
  for (let i = 0; ; i++) {
    const j = await api.rpc('bz_register_web', { p_device: deviceKey(), p_name: tg?.initDataUnsafe?.user?.first_name || 'Браузер' }).catch((e) => ({ error: e.message }));
    if (j?.token) return /** @type {string} */ (j.token);
    if (i === 0) fill(root, topBar().el, h('div', { class: 'card-form' }, h('h1', null, 'Нет связи с сервером'), h('p', null, j?.error || 'Пробуем ещё раз…')));
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function teamMode() {
  let token = LS.get('knopka.token');
  if (!token) { token = await teamAuth(); LS.set('knopka.token', token); }
  root.className = 'team-app';
  const clock = new Clock();
  /** @type {TeamLink} */ let link;
  let dead = false;
  let tab = 'button';
  let lastVoteStatus = 'off';
  let earlyUntil = 0;
  let sigHome = '', sigVote = '';

  // ── разметка: строится один раз, дальше меняются тексты и классы ──
  const top = topBar();

  // вход по ФИО и группе — как в игре ШПА, но отдельно от неё
  let orgMode = false;
  const fioInp = /** @type {HTMLInputElement} */ (h('input', { autocomplete: 'name', maxlength: 80, placeholder: 'Фамилия Имя Отчество', enterkeyhint: 'next', autocapitalize: 'words' }));
  const grpInp = /** @type {HTMLInputElement} */ (h('input', { autocomplete: 'off', maxlength: 20, placeholder: 'Например, ЭР-01-24', enterkeyhint: 'go', autocapitalize: 'characters', spellcheck: 'false' }));
  const codeInp = /** @type {HTMLInputElement} */ (h('input', { autocomplete: 'off', maxlength: 60, placeholder: 'Код организатора', enterkeyhint: 'go', spellcheck: 'false', autocapitalize: 'off' }));
  const fioField = autocomplete(h('label', { class: 'field' }, h('span', null, 'ФИО'), fioInp), fioInp, 'fio', () => (orgMode ? codeInp : grpInp).focus());
  const grpField = autocomplete(h('label', { class: 'field' }, h('span', null, 'Группа'), grpInp), grpInp, 'grp', () => login());
  const codeField = h('label', { class: 'field hidden' }, h('span', null, 'Код организатора'), codeInp);
  const loginErr = h('p', { class: 'err', role: 'alert' });
  const loginBtn = bv('sun big wide', 'Войти', () => login());
  const orgLink = h('button', { class: 'link', type: 'button', onclick: () => setOrg(!orgMode) }, 'Я организатор');
  const LEAD_PART = 'Начни писать ФИО и группу — подскажем, как в списке выезда. Профбюро подтянется само: за его клип голосовать нельзя, а кнопку жмёт кто-то из вашей команды.';
  const loginLead = h('p', { class: 'lead' }, LEAD_PART);
  const pick = h('section', { class: 'pick login hidden' },
    h('h1', null, 'Кто ты?'), loginLead,
    h('form', { class: 'card-form', onsubmit: (e) => { e.preventDefault(); login(); } },
      fioField, grpField, codeField, loginErr, loginBtn,
      DEMO ? h('div', { class: 'demo-hint' }, h('span', null, 'Демо — попробуй начать писать «Смир», «Орл» или группу «ИРЭ». Организатор — любое ФИО и код «молния на логотипе».')) : null),
    h('div', { class: 'foot' }, orgLink));
  /** @param {boolean} on */
  function setOrg(on) {
    orgMode = on;
    grpField.classList.toggle('hidden', on);
    codeField.classList.toggle('hidden', !on);
    fioInp.placeholder = on ? 'Фамилия Имя' : 'Фамилия Имя Отчество';
    orgLink.textContent = on ? 'Я участник' : 'Я организатор';
    loginLead.textContent = on ? 'Организатор входит по ФИО и коду организатора. После входа можно стать ведущим. Кнопку за команды организатор не жмёт, голосовать может за любой клип.'
      : LEAD_PART;
    loginErr.textContent = '';
  }

  /**
   * Подсказки под полем: ФИО — из списка выезда по первым буквам слов, группа — по первым знакам.
   * @param {HTMLElement} field @param {HTMLInputElement} inp @param {'fio'|'grp'} kind @param {() => void} next
   */
  function autocomplete(field, inp, kind, next) {
    const list = h('div', { class: 'ac-list hidden', role: 'listbox' });
    let seq = 0, timer = 0, items = /** @type {string[]} */ ([]), cur = -1;
    const close = () => { list.classList.add('hidden'); items = []; cur = -1; };
    const choose = (v) => { inp.value = v; close(); loginErr.textContent = ''; next(); };
    const words = () => inp.value.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(Boolean);
    /** выделить начало слов, которые совпали с написанным */
    const mark = (v) => {
      if (kind === 'grp') { const n = inp.value.replace(/[^0-9A-Za-zА-Яа-яЁё]/g, '').length; let k = 0, i = 0; for (; i < v.length && k < n; i++) if (/[0-9A-Za-zА-Яа-яЁё]/.test(v[i])) k++; return [h('b', null, v.slice(0, i)), v.slice(i)]; }
      const ws = words();
      return v.split(' ').flatMap((w, i) => {
        const p = ws.filter((q) => w.toLowerCase().replace(/ё/g, 'е').startsWith(q)).sort((a, b) => b.length - a.length)[0];
        return [i ? ' ' : '', ...(p ? [h('b', null, w.slice(0, p.length)), w.slice(p.length)] : [w])];
      });
    };
    const paint = () => {
      fill(list, ...items.map((v, i) => h('button', { type: 'button', role: 'option', class: i === cur ? 'on' : '', tabindex: '-1',
        onpointerdown: (e) => { e.preventDefault(); choose(v); } }, ...mark(v))));
      list.classList.toggle('hidden', !items.length);
    };
    const ask = async () => {
      const q = inp.value.trim();
      if ((kind === 'fio' && orgMode) || q.replace(/[^0-9A-Za-zА-Яа-яЁё]/g, '').length < (kind === 'fio' ? 2 : 1)) { close(); return; }
      const my = ++seq;
      const r = await api.rpc('bz_suggest', { p_token: token, p_kind: kind, p_q: q }).catch(() => null);
      if (my !== seq || document.activeElement !== inp) return;
      items = (r?.items ?? []).filter((v) => v.toLowerCase() !== q.toLowerCase());
      cur = -1; paint();
    };
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(ask, 140); });
    inp.addEventListener('focus', () => { if (inp.value.trim()) ask(); });
    inp.addEventListener('blur', () => setTimeout(close, 120));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); cur = (cur + 1) % items.length; paint(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); cur = (cur - 1 + items.length) % items.length; paint(); }
      else if (e.key === 'Escape') close();
      else if (e.key === 'Enter') { e.preventDefault(); if (cur >= 0 && items[cur]) choose(items[cur]); else if (items.length === 1) choose(items[0]); else { close(); next(); } }
    });
    return h('div', { class: 'ac' }, field, list);
  }
  let loggingIn = false;
  async function login() {
    if (loggingIn) return;
    loginErr.textContent = '';
    if (fioInp.value.trim().split(/\s+/).length < 2) { loginErr.textContent = 'Напиши фамилию и имя'; fioInp.focus(); return; }
    loggingIn = true; loginBtn.setAttribute('disabled', '');
    const r = await api.rpc('bz_login', { p_token: token, p_fio: fioInp.value, p_group: orgMode ? '' : grpInp.value, p_code: orgMode ? codeInp.value : null })
      .catch((e) => ({ error: e instanceof ApiError ? e.message : 'Нет связи — попробуй ещё раз' }));
    loggingIn = false; loginBtn.removeAttribute('disabled');
    if (r?.code === 'auth') return authLost();
    if (!r?.ok) { loginErr.textContent = r?.error || 'Не получилось войти'; haptic('bad'); return; }
    haptic('ok');
    const t = r.teams?.find((x) => x.id === r.me?.team);
    toast(`${r.me?.name ?? 'Привет'}, ${t ? `ты в команде «${t.name}»` : r.me?.org ? 'ты организатор' : 'вход выполнен'}`);
    link.apply(r, performance.now());
  }
  async function becomeHost() {
    const r = await api.rpc('bz_host_enter', { p_token: token }).catch((e) => ({ error: e.message }));
    if (r?.code === 'auth') return authLost();
    if (!r?.token) { toast(r?.error || 'Не получилось'); return; }
    LS.set('knopka.host', r.token);
    dead = true; link.stop();
    switchToHost();
  }
  async function logout() {
    const m = me();
    if (!(await (m?.org ? confirmSheet('Выйти?', 'Чтобы снова войти организатором, понадобится код.', 'Выйти')
      : confirmSheet('Это не ты?', `Сейчас вход по ФИО «${m?.fio ?? ''}». Выйди и войди под своим — пока ты не голосовал, это можно.`, 'Выйти')))) return;
    const r = await api.rpc('bz_logout', { p_token: token }).catch((e) => ({ error: e.message }));
    if (r?.code === 'auth') return authLost();
    if (!r?.ok) { toast(r?.error || 'Не получилось'); return; }
    fioInp.value = ''; grpInp.value = ''; codeInp.value = '';
    link.apply(r, performance.now());
  }

  const tNum = num('–', 'sun lg');
  const tName = h('div', { class: 'name' });
  const tScore = h('b', null, '0');
  const tScoreWord = h('span', null, 'баллов');
  const scoreBox = h('div', { class: 'score' }, tScore, tScoreWord);
  const segBtn = h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => setTab('button') }, 'Кнопка');
  const segVote = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setTab('vote') }, 'Голосование');
  const seg = h('div', { class: 'seg hidden', role: 'tablist' }, segBtn, segVote);

  const btnLbl = h('span', { class: 'lbl' }, '');
  const btnSub = h('span', { class: 'sub' }, '');
  const btn = h('button', { class: 'big-btn wait', type: 'button', 'aria-live': 'polite' }, h('span', null, btnLbl, btnSub));
  const stage = h('div', { class: 'stage' }, btn);
  const presser = h('div', { class: 'card presser hidden' });
  const stMain = h('div', { class: 'main' });
  const stHint = h('div', { class: 'hint' });
  const status = h('div', { class: 'status' }, stMain, stHint);
  const orderList = h('ol');
  const orderTitle = h('h3');
  const order = h('div', { class: 'card order hidden' }, orderTitle, orderList);
  const footBtn = h('div', { class: 'foot' });
  const btnView = h('div', { style: 'display:flex;flex-direction:column;flex:1' }, stage, presser, status, order, footBtn);
  const voteView = h('section', { class: 'vote hidden' });
  const home = h('section', { class: 'hidden', style: 'display:flex;flex-direction:column;flex:1' },
    h('div', { class: 'team-head' }, tNum, tName, scoreBox), seg, btnView, voteView);
  fill(root, top.el, pick, home);

  const S = () => link.state;
  const me = () => link.state?.me;
  const myTeam = () => link.state?.teams?.find((t) => t.id === me()?.team) ?? null;
  const teamName = (id) => link.state?.teams?.find((t) => t.id === id)?.name ?? '—';

  /** @param {string} t */
  function setTab(t) {
    tab = t;
    segBtn.setAttribute('aria-pressed', String(t === 'button'));
    segVote.setAttribute('aria-pressed', String(t === 'vote'));
    btnView.classList.toggle('hidden', t !== 'button');
    voteView.classList.toggle('hidden', t !== 'vote');
    segVote.querySelector('.dot-new')?.remove();
  }

  // ── кто жмёт ──
  function chooseMate() {
    const mates = me()?.mates ?? [];
    sheet((close) => [
      h('h2', null, 'Кто жмёт кнопку?'),
      h('p', null, 'Один человек от профбюро нажимает, когда у команды готов ответ. Выбери его из тех, кто уже открыл бота.'),
      ...mates.map((m) => h('button', { class: `pickrow${m.captain ? ' on' : ''}`, type: 'button', onclick: async () => {
        const r = m.id === me()?.id
          ? await api.rpc('bz_claim', { p_token: token, p_team: me().team }).catch((e) => ({ error: e.message }))
          : await api.rpc('bz_assign', { p_token: token, p_client: m.id }).catch((e) => ({ error: e.message }));
        if (!r?.ok) { toast(r?.error || 'Не получилось'); return; }
        close(); haptic('ok'); link.kick();
        toast(m.id === me()?.id ? 'Кнопку жмёшь ты' : `Кнопку жмёт ${m.name}`);
      } }, h('span', { style: 'flex:1' }, m.name, m.id === me()?.id ? ' (это ты)' : ''), m.captain ? 'жмёт сейчас' : '')),
      mates.length < 2 ? h('p', { class: 'muted small' }, 'Остальные из профбюро появятся здесь, когда откроют бота.') : null,
      h('div', { class: 'row', style: 'margin-top:6px' }, bv('', 'Закрыть', close)),
    ]);
  }
  async function release() {
    if (!(await confirmSheet('Перестать жать кнопку?', 'Кнопка освободится — её сможет взять кто-то из твоего профбюро.', 'Освободить'))) return;
    const r = await api.rpc('bz_unclaim', { p_token: token }).catch((e) => ({ error: e.message }));
    if (!r?.ok) { toast(r?.error || 'Не получилось'); return; }
    link.kick();
  }
  function renderHome() {
    const s = S(), m = me(), t = myTeam();
    const g = s.vote;
    // голосование открылось — сразу показываем его
    if (g.status !== lastVoteStatus) {
      if ((g.status === 'open' || g.status === 'shown') && lastVoteStatus !== g.status) {
        setTab('vote');
        if (tab !== 'vote') segVote.append(h('span', { class: 'dot-new' }));
      }
      if (g.status === 'off') setTab('button');
      lastVoteStatus = g.status;
    }
    seg.classList.toggle('hidden', g.status === 'off');

    const sig = JSON.stringify([m.team, m.team_src, m.fio, m.grp, m.org, m.vote != null, m.captain, t?.claimed, t?.captain_name, t?.score, s.game.locked, (m.mates ?? []).length]);
    if (sig !== sigHome) {
      sigHome = sig;
      // кто я: имя из списка выезда и группа (или «назначил ведущий»)
      const who = [m.in ? m.name : null, m.grp, m.team_src === 'host' ? 'профбюро назначил ведущий' : null].filter(Boolean).join(' · ');
      if (t) {
        tNum.textContent = String(t.num);
        fill(tName, t.name, who ? h('small', null, who) : null);
        tScore.textContent = String(t.score); tScoreWord.textContent = plural(t.score, 'балл', 'балла', 'баллов');
        scoreBox.classList.remove('hidden'); tNum.classList.remove('hidden');
      } else {
        fill(tName, m.org ? 'Организатор' : 'Без команды', h('small', null, m.org ? `${m.name} · голосуешь за любой клип` : `${who || m.name} · твоего профбюро нет среди команд`));
        scoreBox.classList.add('hidden'); tNum.classList.add('hidden');
      }
      stage.classList.toggle('hidden', !m.captain);
      presser.classList.toggle('hidden', !!m.captain);
      if (!m.captain) {
        if (m.org) fill(presser, h('div', { class: 'muted' }, 'Кнопку жмут команды. Ведущий запускает вопросы, отмечает ответы и голосование.'),
          h('div', { class: 'row' }, bv('sun', 'Стать ведущим', becomeHost)));
        else if (!t) fill(presser, h('div', null, 'Твоего профбюро нет среди команд вечерки. Если это ошибка — подойди к ведущему.'));
        else if (t.claimed) {
          fill(presser, h('div', { class: 'muted' }, `Кнопку за «${t.name}» жмёт`), h('div', { class: 'who' }, t.captain_name ?? '—'),
            h('div', { class: 'small muted' }, 'Передать кнопку может только он или ведущий.'));
        } else {
          fill(presser, h('div', { class: 'muted' }, `За «${t.name}» ещё никто не жмёт`), h('div', { class: 'who' }, 'Кто будет нажимать?'),
            h('div', { class: 'row' },
              bv('sun', 'Буду жать я', async () => {
                const r = await api.rpc('bz_claim', { p_token: token, p_team: t.id }).catch((e) => ({ error: e.message }));
                if (!r?.ok) { toast(r?.error || 'Не получилось'); return; }
                haptic('ok'); link.kick();
              }),
              bv('', 'Выбрать из профбюро', chooseMate)));
        }
      }
      fill(footBtn, 
        m.captain && !s.game.locked ? h('button', { class: 'link', type: 'button', onclick: chooseMate }, 'Передать кнопку') : null,
        m.captain && !s.game.locked ? h('button', { class: 'link', type: 'button', onclick: release }, 'Не жать') : null,
        m.org ? h('button', { class: 'link', type: 'button', onclick: becomeHost }, 'Стать ведущим') : null,
        m.in && m.vote == null && !m.captain ? h('button', { class: 'link', type: 'button', onclick: logout }, m.org ? 'Выйти' : 'Это не я') : null);
      try { if (m.captain) tg?.enableClosingConfirmation?.(); else tg?.disableClosingConfirmation?.(); } catch { /* старый Telegram */ }
    }

    const r = s.round, pr = r?.presses ?? [];
    order.classList.toggle('hidden', !pr.length);
    if (pr.length) {
      orderTitle.textContent = `Вопрос ${r.n}: кто нажал`;
      const shown = pr.filter((p) => p.place <= 5 || p.team === m.team);
      fill(orderList, ...shown.map((p) => h('li', { class: p.team === m.team ? 'me' : '' },
        num(p.place, p.place === 1 ? 'sun' : ''), h('span', null, teamName(p.team)),
        p.tie || p.unsure ? h('span', { class: 'wait', title: 'Почти одновременно — решит ведущий' }, '≈') : null,
        p.verdict ? h('span', { class: p.verdict === 'ok' ? 'v-ok' : 'v-bad' }, p.verdict === 'ok' ? '✓' : '✗') : null,
        h('span', { class: 't' }, rel(p.rel_ms)), p.confirmed ? null : h('span', { class: 'wait' }, '…'))),
        ...(pr.length > shown.length ? [h('li', { class: 'wait' }, `и ещё ${pr.length - shown.length}`)] : []));
    }
    renderVote();
  }

  // ── голосование ──
  function renderVote() {
    const s = S(), m = me(), g = s.vote;
    const sig = JSON.stringify([g, m.vote, m.team, s.clips, s.teams.map((t) => t.name)]);
    if (sig === sigVote) return;
    sigVote = sig;
    const teams = s.teams;
    const lead = g.status === 'open' ? 'Выбери один клип. За клип своего профбюро голосовать нельзя. Передумать можно, пока голосование открыто.'
      : g.status === 'closed' ? 'Голосование закрыто — ведущий скоро покажет итоги.'
      : g.status === 'shown' ? `Итоги: ${s.vote.total} ${plural(s.vote.total, 'голос', 'голоса', 'голосов')}` : 'Голосование ещё не началось.';
    const chosen = s.clips.find((k) => k.id === m.vote);
    let list;
    if (g.status === 'shown') {
      const max = Math.max(1, ...s.clips.map((k) => k.votes ?? 0));
      const sorted = s.clips.slice().sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || a.num - b.num);
      const top = sorted[0]?.votes ?? 0;
      list = sorted.map((k) => h('div', { class: `clip result${(k.votes ?? 0) === top && top > 0 ? ' win' : ''}` },
        h('span', { class: 'bar', style: `width:${Math.round(((k.votes ?? 0) / max) * 100)}%` }),
        num(k.num), h('span', null, h('b', null, clipName(k, teams)), h('small', null, [clipSub(k, teams), k.id === m.vote ? 'твой голос' : '', k.team && k.team === m.team ? 'твоё профбюро' : ''].filter(Boolean).join(' · '))),
        h('span', { class: 'cnt' }, String(k.votes ?? 0))));
    } else {
      list = s.clips.map((k) => {
        const own = !!k.team && k.team === m.team;
        return h('button', { class: `clip${k.id === m.vote ? ' chosen' : ''}${own ? ' own' : ''}`, type: 'button',
          disabled: own || g.status !== 'open' ? true : null, onclick: () => vote(k) },
          num(k.num), h('span', null, h('b', null, clipName(k, teams)), clipSub(k, teams) ? h('small', null, clipSub(k, teams)) : null),
          h('span', { class: 'mark-v' }, own ? 'твоё ПБ' : k.id === m.vote ? '✓ твой голос' : ''));
      });
    }
    fill(voteView, 
      h('h2', null, g.title), h('p', { class: 'lead' }, lead),
      h('div', { class: 'clips' }, list),
      g.status === 'open' || g.status === 'closed'
        ? h('p', { class: 'lead', style: 'margin-top:14px' }, chosen ? `Твой голос: «${clipName(chosen, teams)}»` : g.status === 'open' ? 'Ты ещё не голосовал.' : 'Ты не голосовал.') : null,
      chosen && g.status === 'open' ? h('div', { class: 'foot' }, h('button', { class: 'link', type: 'button', onclick: () => vote(null) }, 'Забрать голос')) : null);
  }
  /** @param {any} k */
  async function vote(k) {
    const r = await api.rpc('bz_vote', { p_token: token, p_clip: k ? k.id : null }).catch((e) => ({ error: e.message }));
    if (r?.code === 'auth') return authLost();
    if (!r?.ok) { toast(r?.error || 'Не получилось'); haptic('bad'); return; }
    haptic('ok');
    toast(k ? `Голос за «${clipName(k, S().teams)}» принят` : 'Голос забран');
    link.apply(r, performance.now());
  }

  /** Своё нажатие (если жмёшь ты) или нажатие своей команды (если смотришь). */
  function teamPress() {
    const r = link.round, m = me();
    if (!r || !m?.team) return null;
    const inList = r.presses?.find((p) => p.team === m.team);
    if (inList) return { ms: inList.press_ms, status: 'ok', entry: inList };
    if (m.captain && link.pending?.round === r.id) return { ms: link.pending.ms, status: 'sending', entry: null };
    const res = m.captain ? link.results.get(r.id) : null;
    if (res) return { ms: res.press_ms, status: res.code, entry: null };
    return null;
  }

  /** Кнопка и подписи — каждый кадр (обратный отсчёт и «Жми» загораются по часам сервера). */
  function paint() {
    const r = link?.round, m = me();
    if (!m) return;
    const cap = !!m.captain;
    const now = clock.ready ? clock.server() : NaN;
    const ph = !clock.ready ? 'nosync' : roundPhase(r, now);
    const mp = teamPress();
    const capName = myTeam()?.captain_name;
    let cls = 'wait', lbl = '', sub = '', main = '', hint = '', placeCls = false;
    if (cap && performance.now() < earlyUntil) {
      cls = 'early'; lbl = 'Рано'; sub = 'старта ещё не было'; main = 'Подожди старта'; hint = 'Нажатие до старта не считается';
    } else if (mp && r) {
      cls = 'pressed'; lbl = rel(mp.ms - r.opens_ms);
      const e = mp.entry;
      if (mp.status === 'sending') {
        sub = 'отправляем…'; main = 'Нажато!';
        hint = link.online ? 'Время касания записано — отправляем' : 'Нет связи. Время касания сохранено и уйдёт само, не закрывай приложение';
      } else if (mp.status !== 'ok') {
        cls = 'wait'; lbl = 'Не засчитано'; sub = ''; main = 'Нажатие не засчитано';
        hint = mp.status === 'closed' || mp.status === 'timeout' ? 'Приём ответов уже был закрыт' : mp.status === 'void' ? 'Вопрос отменён' : 'Сервер не принял нажатие';
      } else if (e && e.confirmed) {
        sub = `${e.place}-е место`;
        main = e.place === 1 ? (cap ? 'Вы первые!' : 'Наша команда первая!') : `${e.place}-е место`;
        placeCls = true;
        const prev = r.presses.find((p) => p.place === e.place - 1);
        hint = e.verdict === 'ok' ? `Верно! ${pts(e.points)}` : e.verdict === 'bad' ? `Неверно: ${pts(e.points)}`
          : (e.tie || e.unsure) && prev ? `Почти одновременно с «${teamName(prev.team)}» — решит ведущий`
          : prev ? `На ${sec(e.gap_ms)} с позже «${teamName(prev.team)}»` : 'Готовьте ответ';
        if (!cap) main = `${capName ?? 'Наша команда'}: ${e.place}-е место`;
      } else {
        sub = 'принято'; main = cap ? 'Нажато!' : `${capName ?? 'Команда'} нажал${capName ? '(а)' : 'а'} на ${rel(mp.ms - r.opens_ms)}`; hint = 'Сверяем время остальных команд…';
      }
    } else {
      switch (ph) {
        case 'nosync': lbl = 'Подключаемся'; main = 'Сверяем часы с сервером'; hint = 'Пара секунд'; break;
        case 'idle': lbl = 'Ждём вопрос'; main = 'Ждём вопрос'; hint = cap ? 'Когда ведущий запустит вопрос, кнопка засветится. Не блокируй экран' : 'Ведущий ещё не запустил вопрос'; break;
        case 'countdown': cls = 'count'; lbl = String(Math.max(1, Math.ceil((r.opens_ms - now) / 1000))); main = 'Приготовьтесь'; hint = cap ? 'Нажатие до старта не считается' : `Старт через ${Math.max(1, Math.ceil((r.opens_ms - now) / 1000))}`; break;
        case 'open':
          cls = 'go'; lbl = 'Жми';
          sub = r.closes_ms ? `осталось ${Math.max(0, Math.ceil((r.closes_ms - now) / 1000))} с` : '';
          main = cap ? 'Жми, когда готов ответ' : `Вопрос ${r.n} идёт`;
          hint = r.closes_ms ? `На ответ ${Math.round((r.closes_ms - r.opens_ms) / 1000)} с` : `Идёт ${sec1(now - r.opens_ms)} с`;
          if (!cap && capName) hint += ` · жмёт ${capName}`;
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
    if (cap) {
      const want = `big-btn ${cls}`;
      if (btn.className !== want) btn.className = want;
      if (btnLbl.textContent !== lbl) btnLbl.textContent = lbl;
      if (btnSub.textContent !== sub) btnSub.textContent = sub;
    }
    if (stMain.textContent !== main) stMain.textContent = main;
    stMain.classList.toggle('place', placeCls);
    if (stHint.textContent !== hint) stHint.textContent = hint;
    setNet(top.net, link?.online ?? true, !link?.online ? 'нет связи' : Number.isFinite(clock.lastRtt) ? `${Math.round(clock.lastRtt)} мс` : '…');
  }

  const isIn = (m) => !!m && (m.in || m.team != null);
  function frame() { if (dead) return; if (isIn(link?.state?.me)) paint(); requestAnimationFrame(frame); }

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
    const m = me();
    const inTeam = isIn(m);
    const was = !home.classList.contains('hidden');
    pick.classList.toggle('hidden', inTeam);
    home.classList.toggle('hidden', !inTeam);
    if (inTeam) renderHome();
    else {
      if (was) { sigHome = ''; sigVote = ''; lastVoteStatus = 'off'; setTab('button'); }
      setNet(top.net, link.online, link.online ? `${Math.round(clock.lastRtt || 0)} мс` : 'нет связи');
    }
  }

  function authLost() {
    dead = true;
    link?.stop();
    LS.set('knopka.token', null);
    fill(root, topBar().el, h('div', { class: 'card-form' },
      h('h1', null, 'Бот открыт на другом устройстве'),
      h('p', null, 'Пользоваться можно с одного телефона. Если хочешь с этого — войди здесь, и на другом устройстве всё отключится.'),
      bv('sun big wide', 'Продолжить на этом устройстве', () => { fill(root); teamMode(); })));
  }

  link = new TeamLink({
    api, clock, token, app: appInfo(),
    store: { get: (k) => LS.get(k), set: (k, v) => LS.set(k, v) },
    onState, onAuthLost: authLost,
    onPress: (p) => { if (p.status === 'ok') haptic('ok'); else if (p.status !== 'sending') haptic('bad'); },
    onNet: () => paint(),
  });
  link.start();
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    if (dead) return;
    if (document.visibilityState === 'visible') { link.start(); keepAwake(); } else if (!DEMO) link.stop();
  });
  addEventListener('pageshow', () => { if (!dead) link.start(); });
}

// ───────────────────────── ведущий ─────────────────────────

function switchToHost() {
  LS.set('knopka.mode', 'host');
  fill(root);
  hostMode();
}

/** @returns {Promise<string>} */
function hostLogin() {
  return new Promise((resolve) => {
    root.className = 'host';
    const inp = /** @type {HTMLInputElement} */ (h('input', { autocomplete: 'off', autocapitalize: 'off', maxlength: 60, enterkeyhint: 'go', value: DEMO ? 'ДЕМО' : null }));
    const err = h('p', { class: 'err' });
    const go = async () => {
      err.textContent = '';
      const r = await api.rpc('bz_host_login', { p_code: inp.value, p_key: deviceKey() }).catch((e) => ({ error: e.message }));
      if (r?.token) { LS.set('knopka.host', r.token); resolve(r.token); } else err.textContent = r?.error || 'Не получилось';
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    fill(root, topBar().el, h('div', { class: 'host-wrap' }, h('div', { class: 'card-form', style: 'margin:20px 0' },
      h('h1', null, 'Вход ведущего'),
      h('p', null, DEMO ? 'Это демо — подойдёт любой код.' : 'Только для организаторов: код организатора вечерки. С телефона удобнее войти как организатор и нажать «Стать ведущим».'),
      h('label', { class: 'field' }, h('span', null, 'Код организатора'), inp), err,
      bv('sun big wide', 'Войти', go),
      h('p', { style: 'margin:14px 0 0' }, h('button', { class: 'link dark', type: 'button', onclick: () => { LS.set('knopka.mode', null); fill(root); teamMode(); } }, 'Я участник')))));
    if (DEMO) go(); else inp.focus();
  });
}

async function hostMode() {
  root.className = 'host';
  const token = LS.get('knopka.host') || await hostLogin();
  const clock = new Clock();
  let tab = LS.get('knopka.tab') || 'game';
  /** @type {any} */ let S = null;
  let busy = false;
  const top = topBar(h('span', { class: 'tag' }, h('span', null, 'Ведущий')));
  const tabsEl = h('nav', { class: 'tabs', 'aria-label': 'Разделы' });
  const body = h('div');
  fill(root, top.el, h('div', { class: 'host-wrap' }, tabsEl, body));
  const TABS = [['game', 'Игра'], ['vote', 'Голосование'], ['teams', 'Команды и люди'], ['score', 'Счёт'], ['settings', 'Настройки']];
  function renderTabs() {
    fill(tabsEl, ...TABS.map(([id, label]) => bv('', label, () => { tab = id; LS.set('knopka.tab', id); sig = ''; renderTabs(); render(); }, { 'aria-current': String(tab === id) })));
  }
  renderTabs();

  let lastActAt = 0;
  /** @param {string} name @param {Record<string, unknown>} [arg] */
  async function act(name, arg = {}) {
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
  const people = () => (S?.members ?? []).map(([id, name, fio, teamId, src, kind, online, voted, grp, org]) => ({ id, name, fio, team: teamId, src, kind, online, voted, grp, org }));
  let sig = '';
  const phaseEl = h('span', { class: 'phase' });

  function render() {
    if (!S) return;
    if (tab === 'settings') { if (sig !== 'settings') { sig = 'settings'; fill(body, ...settingsTab().filter(Boolean)); } return; }
    // перерисовываем только при значимых изменениях (иначе клик может попасть в исчезнувшую кнопку)
    const r = S.round;
    const k = JSON.stringify([tab, S.v, r?.status, r?.presses?.map((p) => [p.team, p.confirmed, p.verdict, p.tie, p.unsure]), r?.waiting, r?.offline,
      S.teams.map((t) => [t.id, t.online, tab === 'teams' ? [Math.round((t.rtt ?? 0) / 20), Math.round(t.err ?? 0)] : 0, t.seen_lag > 150]),
      tab === 'vote' ? [S.vote, S.clips] : 0, tab === 'teams' ? [S.members, S.roster] : 0]);
    if (k === sig) return;
    sig = k;
    const open = [...body.querySelectorAll('details[open]')].map((d) => /** @type {HTMLElement} */ (d).dataset.k);
    fill(body, ...(tab === 'game' ? gameTab() : tab === 'vote' ? voteTab() : tab === 'teams' ? teamsTab() : scoreTab()));
    for (const d of body.querySelectorAll('details')) if (open.includes(/** @type {HTMLElement} */ (d).dataset.k)) d.setAttribute('open', '');
  }

  function gameTab() {
    const r = S.round;
    const st = r ? roundPhase(r, clock.ready ? clock.server() : Date.now()) : 'idle';
    const live = st === 'open' || st === 'countdown';
    const next = r ? (r.status === 'void' ? r.n : r.n + 1) : 1;
    const claimed = S.teams.filter((t) => t.claimed).length;
    const out = [h('section', { class: 'panel' },
      h('div', { class: 'ctl-head' }, h('h2', null, r ? `Вопрос ${r.n}` : 'Вопросов ещё не было'), phaseEl),
      h('div', { class: 'ctl-grid' },
        live ? bv('ink big', 'Стоп приёма', () => act('stop')) : bv('sun big', `Старт вопроса ${next}`, () => act('start')),
        live ? bv('', `Сразу вопрос ${r.n + 1}`, () => act('start')) : null,
        bv('', 'Переиграть вопрос', async () => { if (await confirmSheet(`Переиграть вопрос ${r.n}?`, 'Нажатия и баллы этого вопроса не будут считаться. Следующий старт будет снова этим номером.', 'Переиграть')) act('void'); }, { disabled: !r || r.status === 'void' ? true : null })),
      h('p', { class: 'small muted', style: 'margin:12px 0 0' },
        `Отсчёт ${S.game.countdown_ms / 1000} с`, S.game.limit_ms ? `, на ответ ${S.game.limit_ms / 1000} с` : ', без лимита времени',
        `. Кто жмёт кнопку — выбран в ${claimed} из ${S.teams.length} команд.`))];
    if (r) {
      const rows = r.presses.map((p) => {
        const t = team(p.team);
        const flags = [p.confirmed ? h('span', { class: 'pill ok' }, '✓ точно') : h('span', { class: 'pill wait', title: 'Ждём, пока все команды на связи отчитаются за этот момент' }, '⏳ сверяем')];
        if (p.tie) flags.push(h('span', { class: 'pill warn', title: 'Разница с предыдущей командой меньше 30 мс' }, '≈ одновременно'));
        else if (p.unsure) flags.push(h('span', { class: 'pill warn', title: 'Разница меньше погрешности часов двух телефонов — порядок не гарантирован' }, '? порядок под вопросом'));
        if (p.flags?.includes('asof')) flags.push(h('span', { class: 'pill bad', title: 'Телефон сначала сообщил, что не нажимал, а потом прислал более раннее нажатие' }, 'нажатие задним числом'));
        if (p.flags?.includes('late') || p.delivery_ms > Math.max(800, 2.5 * (p.rtt ?? 0))) flags.push(h('span', { class: 'pill warn', title: 'Нажатие шло до сервера дольше обычного. Время касания сохранено' }, `дошло через ${sec1(p.delivery_ms)} с`));
        if (p.flags?.includes('future')) flags.push(h('span', { class: 'pill bad', title: 'Метка времени была из будущего — засчитано время прихода' }, 'сбой часов'));
        if (p.flags?.includes('sync') || p.err > 150) flags.push(h('span', { class: 'pill warn' }, `точность ±${Math.round(p.err)} мс`));
        if (t?.seen_lag > 150) flags.push(h('span', { class: 'pill warn', title: 'Телефон узнал о старте позже остальных' }, `старт увидели на ${sec1(t.seen_lag)} с позже`));
        return h('div', { class: `prow${p.place === 1 ? ' first' : ''}` },
          num(p.place),
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

  function voteTab() {
    const g = S.vote, teams = S.teams;
    const label = { off: 'не начато', open: 'идёт', closed: 'закрыто, итоги скрыты', shown: 'итоги на экране' }[g.status];
    const sorted = S.clips.slice().sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || a.num - b.num);
    const max = Math.max(1, ...S.clips.map((k) => k.votes ?? 0));
    const ppl = people();
    const voters = ppl.filter((p) => p.voted).length;
    const canVote = ppl.filter((p) => p.fio).length;
    return [
      h('section', { class: 'panel' },
        h('div', { class: 'ctl-head' }, h('h2', null, g.title), h('span', { class: `phase${g.status === 'open' ? ' live' : ''}` }, label)),
        h('div', { class: 'row' },
          g.status === 'off' || g.status === 'closed' ? bv('sun big', g.status === 'off' ? 'Открыть голосование' : 'Открыть снова', () => act('vote', { status: 'open' })) : null,
          g.status === 'open' ? bv('ink big', 'Закрыть голосование', () => act('vote', { status: 'closed' })) : null,
          g.status === 'closed' ? bv('sun big', 'Показать итоги на экране', () => act('vote', { status: 'shown' })) : null,
          g.status === 'shown' ? bv('', 'Скрыть итоги', () => act('vote', { status: 'closed' })) : null,
          g.total ? bv('', 'Сбросить голоса', async () => { if (await confirmSheet('Сбросить все голоса?', 'Голосование начнётся с нуля.', 'Сбросить')) act('vote_reset'); }) : null),
        h('p', { class: 'small muted', style: 'margin:12px 0 0' },
          `Проголосовали ${voters} из ${canVote}, кто вошёл по ФИО. Один человек из списка выезда — один голос, за клип своего профбюро голос не принимается. `,
          'Участникам итоги не видны, пока вы не нажмёте «Показать итоги».')),
      h('section', { class: 'panel' }, h('h2', null, 'Голоса (видите только вы)'),
        h('div', { class: 'res' }, sorted.map((k) => h('div', { class: 'r' }, num(k.num),
          h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.round(((k.votes ?? 0) / max) * 100)}%` }),
            h('span', { class: 'lbl' }, clipName(k, teams), clipSub(k, teams) ? ` · ${clipSub(k, teams)}` : '')),
          h('span', { class: 'n' }, String(k.votes ?? 0))))),
        h('div', { class: 'row', style: 'margin-top:14px' }, bv('small', 'Изменить список клипов', editClips))),
    ];
  }

  function editClips() {
    const rows = h('div');
    const addRow = (teamId, title) => {
      const sel = h('select', null, h('option', { value: '' }, 'без профбюро'), ...S.teams.map((t) => h('option', { value: t.id, selected: t.id === teamId }, t.name)));
      const inp = h('input', { value: title || '', maxlength: 80, placeholder: 'Название (необязательно)' });
      const row = h('div', { class: 'row', style: 'margin-bottom:8px;flex-wrap:nowrap' },
        h('label', { class: 'field', style: 'margin:0;flex:1' }, sel), h('label', { class: 'field', style: 'margin:0;flex:2' }, inp),
        bv('small', '✕', () => row.remove(), { 'aria-label': 'Убрать клип' }));
      rows.append(row);
    };
    for (const k of S.clips) addRow(k.team, k.title);
    sheet((close) => [
      h('h2', null, 'Клипы'),
      h('p', null, 'Чей клип — за него не смогут голосовать люди из этого профбюро. Название показывается вместо имени профбюро.'),
      rows,
      h('div', { class: 'row', style: 'margin:6px 0 14px' },
        bv('small', '+ Клип', () => addRow(null, '')),
        bv('small', 'По клипу от каждой команды', () => { fill(rows); for (const t of S.teams) addRow(t.id, ''); })),
      h('div', { class: 'row' },
        bv('sun', 'Сохранить', async () => {
          const items = [...rows.children].map((r) => ({ team: /** @type {HTMLSelectElement} */ (r.querySelector('select')).value || null, title: /** @type {HTMLInputElement} */ (r.querySelector('input')).value }));
          if (await act('clips', { items })) close();
        }),
        bv('', 'Отмена', close)),
    ]);
  }

  function teamsTab() {
    const ppl = people();
    const memberRow = (p, t) => h('div', { class: 'mrow' },
      h('span', { class: `dot${p.online ? ' on' : ''}` }),
      h('span', { class: 'nm' }, p.fio ?? h('i', null, `${p.name} — не вошёл по ФИО`),
        h('small', null, [p.org ? ' · организатор' : '', p.grp ? ` · ${p.grp}` : '', p.src === 'host' ? ' · перевёл ведущий' : '', p.kind === 'web' ? ' · браузер' : '', p.voted ? ' · голосовал' : ''].join(''))),
      t && t.captain?.id !== p.id ? bv('small', 'Жмёт он', () => act('captain', { team: t.id, client: p.id })) : t ? h('span', { class: 'pill ok' }, 'жмёт кнопку') : null,
      p.fio ? bv('small', 'Перевести', () => moveSheet(p)) : null,
      p.fio ? bv('small', 'Сбросить вход', async () => { if (await confirmSheet(`Сбросить вход «${p.fio}»?`, 'Телефон снова попросит ФИО и группу, голос и кнопка снимутся. Нужно, если под чужим ФИО вошёл не тот человек.', 'Сбросить')) act('unbind', { client: p.id }); }) : null,
      bv('small', 'Убрать', async () => { if (await confirmSheet(`Убрать «${p.fio ?? p.name}»?`, 'Телефон отключится, голос и кнопка снимутся. Если это настоящий участник — он сможет войти заново.', 'Убрать')) act('kick', { client: p.id }); }));
    const rows = S.teams.map((t) => {
      const mem = ppl.filter((p) => p.team === t.id);
      return h('div', { class: 'trow' }, num(t.num),
        h('div', null, h('b', null, t.name),
          h('div', { class: 'meta' },
            t.captain ? [h('span', null, h('span', { class: `dot${t.online ? ' on' : ''}` }), ' жмёт ', t.captain.name, t.captain.kind === 'web' ? ' (браузер)' : ''),
              t.online ? h('span', null, `пинг ${t.rtt ?? '—'} мс, ±${t.err ?? '—'} мс`) : h('span', { style: 'color:var(--bad)' }, 'нет связи')]
              : h('span', null, 'кто жмёт — не выбрано'),
            h('span', null, `${mem.length} ${plural(mem.length, 'человек', 'человека', 'человек')}`))),
        t.captain ? bv('small', 'Освободить кнопку', async () => { if (await confirmSheet(`Освободить кнопку «${t.name}»?`, `${t.captain.name} больше не будет жать за команду. Выбрать заново смогут в команде.`, 'Освободить')) act('release', { team: t.id }); }) : h('span'),
        mem.length ? h('details', { class: 'members', 'data-k': `t${t.id}` }, h('summary', null, 'Кто в профбюро'), mem.map((p) => memberRow(p, t))) : null);
    });
    const loose = ppl.filter((p) => p.team == null);
    const R = S.roster ?? { total: 0, in: 0, no_team: 0 };
    return [
      h('section', { class: 'panel' }, h('h2', null, 'Как участникам подключиться'),
        h('div', { class: 'join' }, qrBox(JOIN_URL),
          h('div', null,
            h('p', { style: 'margin:0 0 10px' }, BOT
              ? 'Сканируют QR — откроется бот вечерки. Каждый входит по ФИО и группе из списка выезда, профбюро подставляется само. В команде выбирают, кто жмёт кнопку.'
              : 'Бот вечерки ещё не подключён — пока QR ведёт на страницу в браузере (вход там тоже по ФИО и группе). Когда появится бот, здесь будет ссылка на него.'),
            h('p', { style: 'margin:0 0 12px' }, h('span', { class: 'code' }, JOIN_URL)),
            h('div', { class: 'row' }, bv('small', 'Скопировать ссылку', () => copy(JOIN_URL)),
              bv('small', 'Ссылка на экран для зала', () => copy(`${PAGE_URL}?screen`)))))),
      h('section', { class: 'panel' },
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, h('h2', { style: 'margin:0' }, 'Команды'),
          h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: S.game.locked, onchange: (e) => act('lock', { on: e.target.checked }) }), 'Закрыть выбор, кто жмёт')),
        h('div', null, rows),
        loose.length ? h('details', { class: 'members', 'data-k': 'loose', style: 'margin-top:12px' }, h('summary', null, `Организаторы и без команды: ${loose.length}`), loose.map((p) => memberRow(p, null))) : null,
        h('div', { class: 'row', style: 'margin-top:14px' },
          bv('', 'Изменить список команд', () => editTeams()),
          bv('', 'Освободить все кнопки', async () => { if (await confirmSheet('Освободить все кнопки?', 'В каждой команде заново выберут, кто жмёт.', 'Освободить все')) act('release_all'); }))),
      h('section', { class: 'panel' }, h('h2', null, 'Список выезда'),
        h('p', { style: 'margin:0 0 12px' }, `В списке ${R.total} ${plural(R.total, 'человек', 'человека', 'человек')}, вошли ${R.in}.`,
          R.no_team ? ` Без команды (профбюро нет среди команд): ${R.no_team}.` : '',
          ' По этому списку участники входят и получают подсказки ФИО и группы. Список вечерки отдельный от игры ШПА.'),
        h('div', { class: 'row' },
          bv('', 'Загрузить список', () => rosterSheet()),
          bv('', 'Добавить человека', () => addPersonSheet()))),
    ];
  }

  /**
   * Разбор вставленной таблицы: в строке — профбюро, ФИО и группа в любом порядке, через табуляцию (копия из таблицы)
   * или «;». Строки без ФИО (заголовки, пустые) пропускаются.
   * @param {string} text @returns {string[][]}
   */
  function parseRoster(text) {
    const PB = ['ГПИ', 'ИВТИ', 'ИГВИЭ', 'ИНЭИ', 'ИРЭ', 'ИТАЭ', 'ИЭВТ', 'ИЭТЭ', 'ИЭЭ', 'ЭНМИ', 'ПРОФКОМ'];
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const cells = line.split(/\t|;/).map((c) => c.trim()).filter(Boolean);
      if (!cells.length) continue;
      const pb = cells.find((c) => PB.includes(c.toUpperCase().replace(/Ё/g, 'Е'))) ?? '';
      const grp = cells.find((c) => c !== pb && /\d/.test(c) && /^[A-Za-zА-Яа-яЁё]{1,4}[ -]?\d/.test(c) && c.length <= 14) ?? '';
      const fio = cells.filter((c) => c !== pb && c !== grp && !/\d/.test(c) && /^[А-Яа-яЁёA-Za-z-]+(\s+[А-Яа-яЁёA-Za-z-]+)+$/.test(c))
        .sort((x, y) => y.length - x.length)[0];
      if (!fio || /^ф\.?\s*и\.?\s*о/i.test(fio)) continue;
      out.push([pb, fio.replace(/\s+/g, ' '), grp]);
    }
    return out;
  }

  function rosterSheet() {
    const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', { spellcheck: 'false', rows: 10, placeholder: 'ИРЭ\tИванова Мария Сергеевна\tЭР-01-25' }));
    const info = h('p', { class: 'small muted', style: 'margin:6px 0 10px' }, 'Вставьте строки таблицы.');
    const repl = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox' }));
    const file = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: '.txt,.tsv,.csv,text/plain,text/csv', class: 'hidden' }));
    file.addEventListener('change', async () => {
      const f = file.files?.[0]; if (!f) return;
      ta.value = await f.text(); ta.dispatchEvent(new Event('input'));
    });
    ta.addEventListener('input', () => {
      const rows = parseRoster(ta.value);
      const by = {};
      for (const [pb] of rows) by[pb || 'без профбюро'] = (by[pb || 'без профбюро'] ?? 0) + 1;
      info.textContent = rows.length ? `Узнано ${rows.length} ${plural(rows.length, 'человек', 'человека', 'человек')}: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}.` : 'Пока ни одного ФИО не узнано.';
    });
    sheet((close) => [
      h('h2', null, 'Загрузить список выезда'),
      h('p', null, 'Скопируйте из таблицы столбцы «Профбюро», «ФИО», «Группа» (порядок любой) и вставьте сюда — по человеку в строке. Номера, телефоны и размеры можно не убирать: их не сохраним.'),
      h('label', { class: 'field' }, ta), info, file,
      h('div', { class: 'row', style: 'margin:0 0 10px' }, bv('small', 'Выбрать файл .txt / .csv', () => file.click())),
      h('label', { class: 'toggle' }, repl, 'Заменить весь список (кого нет во вставленном — уберём, их вход сбросится)'),
      h('div', { class: 'row' },
        bv('sun', 'Загрузить', async () => {
          const rows = parseRoster(ta.value);
          if (!rows.length) { toast('Не нашли ни одного ФИО'); return; }
          const r = await act('roster', { rows, replace: repl.checked });
          if (r?.loaded) { close(); toast(`Список: добавлено ${r.loaded.added}, обновлено ${r.loaded.updated}${r.loaded.removed ? `, убрано ${r.loaded.removed}` : ''}. Всего ${r.loaded.total}.`); }
        }),
        bv('', 'Отмена', close)),
    ]);
  }

  function addPersonSheet() {
    const fio = /** @type {HTMLInputElement} */ (h('input', { maxlength: 80, placeholder: 'Фамилия Имя Отчество', autocapitalize: 'words' }));
    const grp = /** @type {HTMLInputElement} */ (h('input', { maxlength: 20, placeholder: 'Например, ЭР-01-24', autocapitalize: 'characters' }));
    const pb = /** @type {HTMLSelectElement} */ (h('select', null, ...S.teams.map((t) => h('option', { value: t.name }, t.name)), h('option', { value: '' }, 'Без профбюро')));
    sheet((close) => [
      h('h2', null, 'Добавить человека в список'),
      h('p', null, 'Если человека нет в списке выезда или в нём ошибка. Такое же ФИО — обновится.'),
      h('label', { class: 'field' }, h('span', null, 'ФИО'), fio),
      h('label', { class: 'field' }, h('span', null, 'Группа'), grp),
      h('label', { class: 'field' }, h('span', null, 'Профбюро'), pb),
      h('div', { class: 'row' },
        bv('sun', 'Добавить', async () => {
          if (fio.value.trim().split(/\s+/).length < 2) { toast('Напишите фамилию и имя'); return; }
          const r = await act('roster', { rows: [[pb.value, fio.value, grp.value]] });
          if (r?.loaded) { close(); toast(r.loaded.added ? 'Добавлен в список' : 'Обновлён в списке'); }
        }),
        bv('', 'Отмена', close)),
    ]);
  }

  /** @param {any} p */
  function moveSheet(p) {
    sheet((close) => [
      h('h2', null, `Профбюро: ${p.fio ?? p.name}`),
      h('p', null, 'Если в списке выезда ошибка — переведите человека в его профбюро. Если он голосовал за клип нового профбюро, голос снимется.'),
      ...S.teams.map((t) => h('button', { class: `pickrow${t.id === p.team ? ' on' : ''}`, type: 'button', onclick: async () => { if (await act('member', { client: p.id, team: t.id })) close(); } }, num(t.num), t.name)),
      h('button', { class: `pickrow${p.team == null ? ' on' : ''}`, type: 'button', onclick: async () => { if (await act('member', { client: p.id, team: null })) close(); } }, 'Без профбюро'),
      h('div', { class: 'row' }, bv('', 'Отмена', close)),
    ]);
  }

  function editTeams() {
    const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', { spellcheck: 'false' }));
    ta.value = S.teams.map((t) => t.name).join('\n');
    sheet((close) => [
      h('h2', null, 'Список команд'),
      h('p', null, 'По одной в строке, до 20. Профбюро из списка выезда узнаются по сокращению в названии (ИРЭ, ГПИ…).'),
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
        h('p', { style: 'margin:0 0 12px' }, 'Счёт и вопросы с нуля. Команды, люди и голосование остаются.'),
        bv('ink', 'Начать новую игру', async () => { if (await confirmSheet('Начать новую игру?', 'Счёт всех команд и история вопросов обнулятся.', 'Начать заново')) act('new_game'); }))];
  }

  function settingsTab() {
    const g = S.game;
    /** @param {string} label @param {string} key @param {[number,string][]} opts @param {number} cur */
    const sel = (label, key, opts, cur) => h('label', { class: 'field' }, h('span', null, label),
      h('select', { onchange: (e) => act('settings', { [key]: Number(e.target.value) }) }, ...opts.map(([v, t]) => h('option', { value: v, selected: v === cur }, t))));
    const codeInp = /** @type {HTMLInputElement} */ (h('input', { maxlength: 60, autocomplete: 'off', placeholder: 'Новый код (не меньше 6 знаков)' }));
    const title = /** @type {HTMLInputElement} */ (h('input', { maxlength: 60, value: g.title }));
    const vtitle = /** @type {HTMLInputElement} */ (h('input', { maxlength: 60, value: S.vote.title }));
    return [
      h('section', { class: 'panel' }, h('h2', null, 'Вопрос'),
        h('div', { class: 'set-grid' },
          sel('Обратный отсчёт перед стартом', 'countdown_ms', [[0, 'Без отсчёта'], [1000, '1 с'], [2000, '2 с'], [3000, '3 с'], [5000, '5 с']], g.countdown_ms),
          sel('Время на ответ', 'limit_ms', [[0, 'Без лимита'], [10000, '10 с'], [15000, '15 с'], [20000, '20 с'], [30000, '30 с'], [45000, '45 с'], [60000, '1 мин'], [90000, '1,5 мин'], [120000, '2 мин']], g.limit_ms),
          sel('Верный ответ', 'pts_ok', [[1, '+1'], [2, '+2'], [3, '+3'], [5, '+5']], g.pts_ok),
          sel('Неверный ответ', 'pts_bad', [[0, '0'], [1, '−1'], [2, '−2'], [3, '−3']], g.pts_bad),
          sel('Блок за нажатие до старта', 'lockout_ms', [[0, 'Нет'], [500, '0,5 с'], [1000, '1 с'], [2000, '2 с']], g.lockout_ms)),
        h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: g.auto_close, onchange: (e) => act('settings', { auto_close: e.target.checked }) }), 'Закрывать приём, когда нажали все команды'),
        h('p', { class: 'small muted', style: 'margin:10px 0 0' }, 'Отсчёт даёт всем телефонам узнать о старте заранее: кнопка загорается у всех в один момент по часам сервера. Рекомендуем 3 с.')),
      h('section', { class: 'panel' }, h('h2', null, 'Названия на экране'),
        h('label', { class: 'field' }, h('span', null, 'Вечер'), title),
        h('label', { class: 'field' }, h('span', null, 'Голосование'), vtitle),
        bv('small', 'Сохранить названия', () => act('settings', { title: title.value, vote_title: vtitle.value }))),
      h('section', { class: 'panel' }, h('h2', null, 'Код организатора'),
        h('p', { style: 'margin:0 0 12px' }, 'С этим кодом организаторы входят в вечерку и могут стать ведущими. Регистр, кавычки и лишние пробелы не важны. Новый код заменит старый — все, кто вошёл со старым, останутся, новые будут входить с новым.'),
        h('label', { class: 'field' }, codeInp),
        h('div', { class: 'row' },
          bv('small', 'Сменить код', async () => { if (await act('host_code', { code: codeInp.value })) { codeInp.value = ''; toast('Код организатора сменён'); } }),
          bv('small', 'Выйти на других устройствах', () => act('logout_others').then((r) => r && toast('Другие ведущие вышли'))))),
      DEMO ? null : h('section', { class: 'panel' }, h('h2', null, 'Это устройство'),
        h('div', { class: 'row' },
          bv('small', 'Открыть экран для зала', () => { location.href = `${location.pathname}?screen${DEMO ? '&demo' : ''}`; }),
          bv('small', 'Перейти к телефону участника', () => { LS.set('knopka.mode', null); location.href = location.pathname + (DEMO ? '?demo' : '') + location.hash; }),
          bv('small', 'Выйти', () => { LS.set('knopka.host', null); LS.set('knopka.mode', null); location.reload(); }))),
    ];
  }

  let dead = false;
  function lost() {
    dead = true;
    poller.stop();
    LS.set('knopka.host', null);
    toast('Вход ведущего истёк — введите код ещё раз');
    fill(root);
    hostMode();
  }

  const poller = new Poller({ api, clock, fn: 'bz_host_state', args: { p_host: token }, onState: (s) => { S = s; render(); }, onAuthLost: lost,
    onNet: (ok) => setNet(top.net, ok, ok ? 'на связи' : 'нет связи') });
  poller.start();

  let lastPh = '';
  const tickPhase = () => {
    if (dead) return;
    const r = S?.round;
    if (r && clock.ready) {
      const now = clock.server(), ph = roundPhase(r, now);
      const txt = ph === 'countdown' ? `старт через ${Math.ceil((r.opens_ms - now) / 1000)}` : ph === 'open' ? `идёт ${sec1(now - r.opens_ms)} с${r.closes_ms ? `, осталось ${Math.max(0, Math.ceil((r.closes_ms - now) / 1000))} с` : ''}`
        : ph === 'void' ? 'переигран' : `приём закрыт${r.settled ? '' : ', сверяем время'}`;
      if (phaseEl.textContent !== txt) phaseEl.textContent = txt;
      phaseEl.classList.toggle('live', ph === 'open' || ph === 'countdown');
      if (lastPh !== ph) { lastPh = ph; sig = ''; render(); }
    }
    if (clock.ready && Number.isFinite(clock.lastRtt) && poller.online) setNet(top.net, true, `${Math.round(clock.lastRtt)} мс`);
    requestAnimationFrame(tickPhase);
  };
  requestAnimationFrame(tickPhase);
}

// ───────────────────────── экран зала ─────────────────────────

async function screenMode() {
  root.className = 'screen';
  const clock = new Clock();
  const qEl = h('div', { class: 'q' });
  const clockEl = h('div', { class: 'clock' });
  const msg = h('div', { class: 'msg' });
  const qrEl = h('div', { class: 'qr hidden' });
  qrEl.innerHTML = qrSvg(JOIN_URL, '#0B2A3D', '#FFFFFF', 2);
  const list = h('div', { class: 'list' });
  fill(root, 
    h('div', { class: 'art', 'aria-hidden': 'true' }),
    h('div', { class: 'main' },
      h('div', { class: 'head' }, h('img', { src: 'mark.svg', alt: '' }), qEl),
      h('div', { class: 'body' }, h('div', { class: 'left' }, clockEl, msg, qrEl), list)));
  /** @type {any} */ let S = null;
  let sig = '';
  const tname = (id) => S?.teams?.find((t) => t.id === id)?.name ?? '—';

  /** Что показываем: вопрос, голосование или счёт. */
  function mode() {
    const r = S.round, v = S.vote;
    const ph = r && clock.ready ? roundPhase(r, clock.server()) : 'idle';
    if (ph === 'countdown' || ph === 'open') return { m: 'round', ph };
    if (v.status !== 'off') return { m: 'vote', ph };
    if (r && ph === 'closed' && r.presses.length) return { m: 'round', ph };
    return { m: 'board', ph };
  }

  function renderList(md) {
    const r = S.round, v = S.vote;
    const k = JSON.stringify([md.m, v.status, md.m === 'vote' ? S.clips : 0, S.teams.map((t) => [t.id, t.name, t.score]), r?.id, r?.presses?.map((p) => [p.team, p.confirmed, p.verdict])]);
    if (k === sig) return;
    sig = k;
    if (md.m === 'board') {
      const teams = S.teams.slice().sort((a, b) => b.score - a.score || a.num - b.num);
      fill(list, h('h2', { class: 'board' }, 'Счёт'), ...teams.map((t, i) => h('div', { class: `bar${i === 0 && t.score > 0 ? ' first' : ''}` },
        num(t.num), h('b', null, t.name), h('span', { class: 't' }, String(t.score)))));
    } else if (md.m === 'vote') {
      const shown = v.status === 'shown';
      const clips = shown ? S.clips.slice().sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || a.num - b.num) : S.clips;
      const max = Math.max(1, ...S.clips.map((c) => c.votes ?? 0));
      const top = shown ? clips[0]?.votes ?? 0 : -1;
      fill(list, h('h2', { class: 'board' }, shown ? 'Приз зрительских симпатий' : v.title),
        ...clips.map((c, i) => {
          const bar = h('div', { class: `bar${shown && (c.votes ?? 0) === top && top > 0 ? ' first' : ''}` },
            shown ? h('span', { class: 'fill', style: 'width:0%' }) : null,
            num(shown ? i + 1 : c.num), h('b', null, clipName(c, S.teams), c.title && c.team ? h('small', null, tname(c.team)) : null),
            h('span', { class: 't' }, shown ? String(c.votes ?? 0) : ''));
          if (shown) requestAnimationFrame(() => requestAnimationFrame(() => { /** @type {HTMLElement} */ (bar.querySelector('.fill')).style.width = `${Math.round(((c.votes ?? 0) / max) * 100)}%`; }));
          return bar;
        }));
    } else {
      fill(list, h('h2', { class: 'board' }, 'Кто нажал'), ...(r.presses.length ? [] : [h('div', { class: 'msg', style: 'text-align:left' }, 'Пока никто')]),
        ...r.presses.map((p) => h('div', { class: `bar${p.place === 1 ? ' first' : ''}` },
          num(p.place), h('b', null, tname(p.team)),
          h('span', { class: 't' }, rel(p.rel_ms), h('small', null, p.verdict === 'ok' ? 'верно' : p.verdict === 'bad' ? 'неверно' : p.confirmed ? '' : 'сверяем…')))));
    }
  }

  function paint() {
    if (S) {
      const r = S.round, v = S.vote, md = mode();
      const now = clock.ready ? clock.server() : NaN;
      let cls = 'clock closed', txt = /** @type {any} */ (''), sub = '', q = S.game.title, qs2 = '', m = '', showQr = false;
      if (md.m === 'vote') {
        q = v.title; qs2 = 'голосование';
        if (v.status === 'open') { cls = 'clock open'; txt = String(v.total); sub = plural(v.total, 'голос', 'голоса', 'голосов'); m = 'Голосуйте в боте вечерки. За клип своего профбюро — нельзя'; showQr = true; }
        else if (v.status === 'closed') { txt = 'Стоп'; m = 'Голосование закрыто. Итоги — скоро'; }
        else { cls = 'clock open'; txt = String(v.total); sub = plural(v.total, 'голос', 'голоса', 'голосов'); m = 'Спасибо всем, кто голосовал!'; }
      } else if (md.m === 'round') {
        q = `Вопрос ${r.n}`; qs2 = S.game.title;
        if (md.ph === 'countdown') { cls = 'clock count'; txt = String(Math.max(1, Math.ceil((r.opens_ms - now) / 1000))); m = 'Приготовьтесь'; }
        else if (md.ph === 'open') { cls = 'clock open'; txt = r.closes_ms ? String(Math.max(0, Math.ceil((r.closes_ms - now) / 1000))) : sec1(now - r.opens_ms); m = r.closes_ms ? 'Секунд на ответ' : 'Жмите, когда готов ответ'; }
        else {
          txt = 'Стоп';
          const okP = r.presses.find((p) => p.verdict === 'ok'), nextP = r.presses.find((p) => p.verdict !== 'bad');
          m = okP ? `Верный ответ: «${tname(okP.team)}»` : nextP ? `Отвечает «${tname(nextP.team)}»` : 'Верного ответа нет';
        }
      } else { txt = 'Скоро'; m = 'Откройте бота вечерки и войдите по ФИО и группе'; showQr = true; qs2 = 'кнопка и голосование'; }
      if (clockEl.className !== cls) clockEl.className = cls;
      const ck = `${txt}|${sub}`;
      if (clockEl.dataset.k !== ck) { clockEl.dataset.k = ck; fill(clockEl, h('span', null, txt, sub ? h('small', null, sub) : null)); }
      const qk = `${q}|${qs2}`;
      if (qEl.dataset.k !== qk) { qEl.dataset.k = qk; fill(qEl, q, qs2 ? h('small', null, qs2) : null); }
      if (msg.textContent !== m) msg.textContent = m;
      qrEl.classList.toggle('hidden', !showQr);
      renderList(md);
    }
    requestAnimationFrame(paint);
  }
  const poller = new Poller({ api, clock, fn: 'bz_screen', onState: (s) => { S = s; } });
  poller.start();
  requestAnimationFrame(paint);
  await syncBurst(api, clock, 4);
}

// ───────────────────────── старт ─────────────────────────

(async () => {
  if (DEMO) {
    const { DemoServer, DemoApi } = await import('./demo.js');
    let srv = null;
    try { srv = /** @type {any} */ (window.parent)?.__knopkaDemo ?? null; } catch { /* другой источник */ }
    if (!srv) { srv = /** @type {any} */ (window).__knopkaDemo ?? new DemoServer(); /** @type {any} */ (window).__knopkaDemo = srv; }
    api = new DemoApi(srv);
  } else {
    if (!CFG.url) { fatal('Кнопка не настроена', 'Нет адреса сервера. Его подставляет сборка на GitHub (Deploy game) из deploy.env.'); return; }
    api = new Api(CFG.url, CFG.key || '');
  }
  await initTelegram();
  const mode = qs.has('screen') ? 'screen' : qs.has('host') || LS.get('knopka.mode') === 'host' ? 'host' : 'team';
  try {
    if (mode === 'screen') await screenMode();
    else if (mode === 'host') await hostMode();
    else await teamMode();
  } catch (e) {
    console.error(e);
    fatal('Не получилось открыть', `${e instanceof Error ? e.message : e}. Проверь интернет и открой ещё раз.`);
  }
})();
