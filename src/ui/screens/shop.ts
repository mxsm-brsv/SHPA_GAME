// Магазин: мерч за баллы (ограниченное количество, автоскидка на то, что не берут) и игровые товары за профкоины.
import { SHOP } from '../../config/economy';
import { merchPrice, nextDiscountIn, nextTier, type MerchItem, type MerchOrder } from '../../config/merch';
import { factionById } from '../../config/factions';
import type { Goal } from '../../core/backend';
import { coinSvg, icon, scrollSvg, starSvg } from '../../art/icons';
import { haptic } from '../../core/telegram';
import { $, el, esc, fmt, hm, modal, onAct, toast } from '../../lib/dom';
import type { App } from '../app';
import { openMyQr } from './tasks';

let tab: 'merch' | 'coins' = 'merch';
let lastGoals: Goal[] = [];
let lastBalance = 0;

/** Сбор как на DonationAlerts: большая полоса, сумма, топ спонсоров. */
function goalCard(g: Goal, staff: boolean) {
  const pct = Math.min(100, Math.round((g.raised / Math.max(1, g.target)) * 1000) / 10);
  const done = g.status === 'done';
  const medal = ['#ffd76a', '#cfd8e3', '#d9a066'];
  const pbs = g.factions?.length ? g.factions.map((f) => factionById(f as never)?.short ?? f).join(', ') : '';
  return `<div class="card col goal ${done ? 'done' : ''}" style="gap:8px">
    <div class="row" style="gap:8px;align-items:flex-start"><div class="grow"><div class="goal-kicker">${done ? 'Цель собрана' : 'Общий сбор'}${pbs ? ` · ${esc(pbs)}` : ''}</div><b style="font-size:18px">${esc(g.title)}</b></div>
      <div class="goal-sum"><b>${fmt(g.raised)}</b><span>из ${fmt(g.target)}</span></div></div>
    ${g.text ? `<div class="small">${esc(g.text)}</div>` : ''}
    <div class="goal-bar"><i style="width:${pct}%"></i><span>${pct}%</span></div>
    <div class="small muted">${fmt(g.donors)} ${g.donors % 10 === 1 && g.donors % 100 !== 11 ? 'спонсор' : 'спонсоров'}${g.mine ? ` · твой вклад <b class="gold">${fmt(g.mine)}</b>` : ''}</div>
    ${g.top.length ? `<div class="goal-top"><div class="small"><b>Топ спонсоров</b> — лучших наградим!</div>${g.top.slice(0, 5).map((t, i) => `<div class="row small" style="gap:8px"><span class="goal-place" style="background:${medal[i] ?? '#ffffff22'}">${i + 1}</span><span class="grow">${esc(t.name)} <span class="muted">${esc(factionById(t.faction as never)?.short ?? '')}</span></span><b>${fmt(t.amount)}</b></div>`).join('')}</div>` : ''}
    ${done || staff ? '' : `<button class="btn btn-gold btn-block" data-act="donate" data-id="${g.id}">${starSvg(16)} Задонатить баллы</button>`}
  </div>`;
}

export function renderShop(app: App) {
  const s = app.state;
  const node = el(`<div class="screen"><div class="page">
    <div class="page-title"><h1>Магазин</h1><div class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" data-act="refresh" aria-label="Обновить">${icon('refresh', 16)} Обновить</button><span class="pill">${coinSvg(18)}${fmt(s.coins)}</span></div></div>
    <div class="tabs"><button class="${tab === 'merch' ? 'on' : ''}" data-act="tab" data-v="merch">Мерч за баллы</button><button class="${tab === 'coins' ? 'on' : ''}" data-act="tab" data-v="coins">За профкоины</button></div>
    <div data-body class="col" style="gap:12px"></div>
  </div></div>`);
  const body = $(node, '[data-body]');

  const drawCoins = () => {
    body.innerHTML = `<div class="list">${SHOP.map((it) => `
      <div class="li">
        <div style="width:44px;height:44px;border-radius:12px;background:#ffffff10;display:grid;place-items:center">${scrollSvg(28)}</div>
        <div class="grow"><b>${esc(it.name)}</b><div class="small muted">${esc(it.text)}</div></div>
        <button class="btn btn-gold btn-sm" data-act="buyc" data-id="${it.id}">${coinSvg(14)} ${fmt(it.price)}</button>
      </div>`).join('')}</div>
      <div class="small muted">Профкоины зарабатываются тапами по ратуше, на блоках и в кампании. Ещё их можно вложить в здания своего ПБ — кнопка «Моё ПБ» на базе.</div>`;
  };

  const drawMerch = async () => {
    body.innerHTML = '<div class="muted center">Загружаю…</div>';
    const [items, wallet, orders, cfg, goals] = await Promise.all([app.backend.merchList(), app.backend.wallet(s), app.backend.myOrders(s), app.backend.config(), app.backend.goalsList().catch(() => [] as Goal[])]);
    lastGoals = goals; lastBalance = wallet.balance;
    app.cfg = cfg;
    const staff = s.role === 'staff' || s.role === 'admin';
    const mine = (id: string) => orders.filter((o) => o.itemId === id && o.status !== 'cancelled').length;
    const card = (it: MerchItem) => {
      const p = merchPrice(it);
      const soon = nextDiscountIn(it);
      const nt = nextTier(it);
      const out = !it.unlimited && it.stock <= 0;
      const limit = mine(it.id) >= it.perPerson;
      const can = cfg.shopOpen && !out && !limit && wallet.balance >= p.price && !staff;
      return `<div class="merch ${out ? 'out' : ''}">
        ${p.pct ? `<span class="m-sale">−${p.pct}%</span>` : ''}
        <div class="m-emoji">${esc(it.emoji)}</div>
        <b>${esc(it.name)}</b>
        ${it.text ? `<div class="small muted">${esc(it.text)}</div>` : ''}
        ${it.unlimited ? `<div class="small gold">без ограничений · купили ${fmt(it.sold ?? 0)}${it.step ? ` · каждая покупка +${it.step}` : ''}</div>` : `<div class="small ${it.stock <= 2 && !out ? 'gold' : 'muted'}">${out ? 'закончилось' : `осталось ${it.stock} из ${it.total}`}</div>`}
        <div class="m-price">${p.pct ? `<s>${fmt(p.base)}</s>` : ''}${starSvg(14)}<b>${fmt(p.price)}</b></div>
        ${!out && nt ? `<div class="small ${nt.price > p.base ? 'gold' : 'muted'}">останется ${nt.left} — цена ${nt.price > p.base ? 'вырастет до' : 'упадёт до'} ${fmt(nt.price)}</div>` : ''}
        ${soon && !out && cfg.shopOpen ? `<div class="small muted">ещё −${it.auto!.stepPct}% через ${hm(soon)}</div>` : ''}
        <button class="btn btn-gold btn-sm btn-block" data-act="buy" data-id="${it.id}" ${can ? '' : 'disabled'}>${out ? 'Нет' : limit ? 'Уже взял' : staff ? 'Вне зачёта' : wallet.balance < p.price ? `Ещё ${fmt(p.price - wallet.balance)}` : 'Купить'}</button>
      </div>`;
    };
    body.innerHTML = `
      <div class="card row wallet">${starSvg(30)}<div class="grow"><div class="small muted">Баллы на счёте</div><div style="font-family:var(--head);font-size:26px;color:var(--gold2)">${fmt(wallet.balance)}</div>
        <div class="small muted">заработано ${fmt(wallet.earned)} · потрачено ${fmt(wallet.spent)}${wallet.casino ? `, из них проиграно в колесе ${fmt(wallet.casino)}` : ''}. Рейтинг от покупок не падает.</div></div></div>
      ${goals.filter((g) => g.status !== 'hidden').map((g) => goalCard(g, staff)).join('')}
      ${cfg.shopOpen ? '' : '<div class="card small" style="border-color:var(--gold)"><b>Магазин мерча сейчас закрыт.</b> Он работает, когда его открывают организаторы, — об этом сообщат в эфире и в боте. А пока можно присмотреться и копить баллы.</div>'}
      ${orders.filter((o) => o.status === 'reserved').length ? `<div class="card col" style="gap:6px;border-color:var(--green)"><b>Мои покупки — забрать у организаторов</b>
        ${orders.filter((o) => o.status === 'reserved').map((o) => orderRow(o)).join('')}
        <button class="btn btn-blue btn-sm" data-act="qr">${icon('qr', 16)} Показать мой QR для выдачи</button></div>` : ''}
      <div class="merch-grid">${items.map(card).join('') || '<div class="muted">Товаров пока нет</div>'}</div>
      ${orders.filter((o) => o.status !== 'reserved').length ? `<div class="section-h">История</div><div class="list">${orders.filter((o) => o.status !== 'reserved').map((o) => `<div class="li small">${esc(o.emoji)} <span class="grow">${esc(o.itemName)}</span><span class="muted">${o.status === 'issued' ? 'выдано' : 'отменено, баллы вернулись'}</span></div>`).join('')}</div>` : ''}
      <div class="small muted">Скидки: если товар долго не берут, цена сама снижается (до −40%). Количество ограничено — кто первый купил, тот и забрал. Улыбки и объятия Макса — без ограничений, но дорожают с каждой покупкой.</div>`;
  };

  const draw = () => { node.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.v === tab)); if (tab === 'merch') drawMerch(); else drawCoins(); };
  draw();

  onAct(node, {
    tab: (t) => { tab = t.dataset.v as typeof tab; draw(); },
    qr: () => openMyQr(app),
    refresh: () => { haptic(); draw(); },
    donate: (t) => {
      const g = lastGoals.find((x) => x.id === Number(t.dataset.id));
      if (!g) return;
      const left = g.target - g.raised;
      const m = modal(`<div class="col" style="gap:10px"><h2 style="font-size:22px">Донат в «${esc(g.title)}»</h2>
        <div class="small muted">Баллы уходят со счёта магазина, рейтинг не падает. Осталось собрать <b class="gold">${fmt(left)}</b>. На счёте у тебя ${fmt(lastBalance)}.</div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${[50, 100, 250, 500, 1000].filter((v) => v <= Math.max(lastBalance, 50)).map((v) => `<button class="btn btn-ghost btn-sm" data-amt="${v}">${fmt(v)}</button>`).join('')}<button class="btn btn-ghost btn-sm" data-amt="${Math.max(0, Math.min(lastBalance, left))}">Всё</button></div>
        <input class="input-ans" type="number" inputmode="numeric" min="1" data-v placeholder="Сколько баллов" value="${Math.min(100, Math.max(0, Math.min(lastBalance, left)))}">
        <button class="btn btn-gold btn-block" data-ok>${starSvg(16)} Задонатить</button><button class="btn btn-ghost btn-block" data-close>Не сейчас</button>
        <div class="small muted">Лучших спонсоров из топа организаторы наградят отдельно!</div></div>`);
      const inp = $(m.root, '[data-v]') as HTMLInputElement;
      m.root.querySelectorAll<HTMLButtonElement>('[data-amt]').forEach((b) => b.addEventListener('click', () => { inp.value = b.dataset.amt!; haptic(); }));
      $(m.root, '[data-ok]').addEventListener('click', async () => {
        const amt = Math.round(Number(inp.value) || 0);
        if (amt < 1) { toast('Впиши, сколько баллов', 'bad'); return; }
        const b = $(m.root, '[data-ok]') as HTMLButtonElement;
        b.disabled = true;
        try {
          const r = await app.backend.goalDonate(g.id, amt);
          m.close(); haptic('ok');
          toast(r.status === 'done' ? `Цель собрана! Ты закрыл её донатом ${fmt(r.given)}` : `+${fmt(r.given)} в «${g.title}» — спасибо!`, 'ok');
          draw();
        } catch (e) { b.disabled = false; haptic('bad'); toast((e as Error).message, 'bad'); }
      });
    },
    buy: async (t) => {
      const items = await app.backend.merchList();
      const it = items.find((x) => x.id === t.dataset.id);
      if (!it) return;
      const p = merchPrice(it);
      const m = modal(`<div class="col center" style="gap:10px;align-items:center"><div style="font-size:56px">${esc(it.emoji)}</div>
        <h2 style="font-size:22px">${esc(it.name)}</h2><div>Списать <b class="gold">${fmt(p.price)} баллов</b>? Рейтинг не уменьшится.</div>
        <button class="btn btn-gold btn-block" data-ok>Купить</button><button class="btn btn-ghost btn-block" data-close>Не сейчас</button></div>`);
      $(m.root, '[data-ok]').addEventListener('click', async () => {
        const b = $(m.root, '[data-ok]') as HTMLButtonElement;
        b.disabled = true;
        const r = await app.backend.merchBuy(s, it.id);
        m.close();
        haptic(r.ok ? 'ok' : 'bad');
        toast(r.message, r.ok ? 'ok' : 'bad');
        drawMerch();
        app.update(false);
      });
    },
    buyc: (t) => {
      const it = SHOP.find((x) => x.id === t.dataset.id)!;
      if (s.coins < it.price) { toast(`Нужно ${fmt(it.price)} профкоинов`, 'bad'); haptic('bad'); return; }
      s.coins -= it.price;
      if (it.give.scrolls) s.scrolls += it.give.scrolls;
      haptic('ok');
      toast(`+${it.give.scrolls} свитков найма`, 'ok');
      app.update();
    },
  });
  return node;
}

const orderRow = (o: MerchOrder) => `<div class="row small"><span style="font-size:20px">${esc(o.emoji)}</span><span class="grow">${esc(o.itemName)}</span><span class="tag">код ${esc(o.id)}</span></div>`;
