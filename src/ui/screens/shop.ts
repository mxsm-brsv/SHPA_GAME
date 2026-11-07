// Магазин: мерч за баллы (ограниченное количество, автоскидка на то, что не берут) и игровые товары за профкоины.
import { SHOP } from '../../config/economy';
import { merchPrice, nextDiscountIn, nextTier, type MerchItem, type MerchOrder } from '../../config/merch';
import { coinSvg, icon, scrollSvg, starSvg } from '../../art/icons';
import { haptic } from '../../core/telegram';
import { $, el, esc, fmt, hm, modal, onAct, toast } from '../../lib/dom';
import type { App } from '../app';
import { openMyQr } from './tasks';

let tab: 'merch' | 'coins' = 'merch';

export function renderShop(app: App) {
  const s = app.state;
  const node = el(`<div class="screen"><div class="page">
    <div class="page-title"><h1>Магазин</h1><div class="row"><span class="pill">${coinSvg(18)}${fmt(s.coins)}</span></div></div>
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
    const [items, wallet, orders, cfg] = await Promise.all([app.backend.merchList(), app.backend.wallet(s), app.backend.myOrders(s), app.backend.config()]);
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
      ${cfg.shopOpen ? '' : '<div class="card small" style="border-color:var(--gold)"><b>Магазин мерча пока закрыт.</b> Можно присмотреться и копить баллы — организаторы откроют его в конце выезда.</div>'}
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
