// Отряд — стратегия: до 4 активистов с перками, умения в ячейках (качаются кристаллами), снаряжение командира.
import { CLASS_INFO, CLASS_ADVANTAGE, RARITY_INFO, heroDef, type HeroClass } from '../../config/heroes';
import { MAX_HERO_LEVEL, SQUAD_SIZE } from '../../config/economy';
import { ITEM_RARITY, SLOTS, STAT_CAP, itemSellPrice, statText, type ItemInst, type ItemStat } from '../../config/items';
import { SKILLS, SKILL_MAX, SKILL_UP_COST, commanderLevel, loadoutSlots, skillById, type SkillId } from '../../config/skills';
import { heroSvg } from '../../art/hero';
import { coinSvg, icon, scrollSvg, starSvg } from '../../art/icons';
import { sanitizeLoadout, skillAvailable, skillLevel, toggleLoadout, upgradeSkill } from '../../core/commander';
import {
  PERK, autoPerks, autoSquad, equipItem, heroPower, heroStats, heroUpgradeCost, hire, hireCostCoins, itemBonus, perkFree, perkPoints, perksOf,
  sellItem, squadPower, toggleSquad, upgrade, upgradeAll,
} from '../../core/logic';
import type { HeroInst, Perks } from '../../core/state';
import { haptic } from '../../core/telegram';
import { $, el, esc, fmt, modal, onAct, toast } from '../../lib/dom';
import type { App } from '../app';

let filter: HeroClass | 'all' = 'all';

const pc = (x: number) => (Math.round(x * 1000) / 10).toLocaleString('ru-RU');
const stars = (n: number, size = 11) => `<div class="stars">${Array.from({ length: n }, () => starSvg(size)).join('')}</div>`;

function heroCard(h: HeroInst, inSquad: boolean) {
  const d = heroDef(h.id);
  const r = RARITY_INFO[d.rarity];
  const c = CLASS_INFO[d.cls];
  const free = perkFree(h);
  return `<button class="hero ${inSquad ? 'in' : ''}" data-act="hero" data-uid="${h.uid}" style="border-color:${r.color}">
    <span class="lv">ур. ${h.level}</span><span class="cls" style="background:${c.color}">${c.name[0]}</span>
    <div class="pic" style="box-shadow:0 0 0 2px ${r.color}">${heroSvg(h.id, 64)}</div>
    <div class="nm">${esc(d.name)}</div>${stars(h.stars)}
    ${inSquad ? '<span class="in-badge">в отряде</span>' : ''}${free > 0 ? `<span class="perk-badge">+${free}</span>` : ''}
  </button>`;
}

export function renderSquad(app: App) {
  const s = app.state;
  sanitizeLoadout(s, false);
  const pw = squadPower(s);
  const tab = app.squadTab;
  const freePerks = s.squad.map((u) => s.heroes.find((h) => h.uid === u)).filter(Boolean).reduce((a, h) => a + perkFree(h!), 0);
  const node = el(`<div class="screen"><div class="page">
    <div class="page-title"><h1>Отряд</h1><div class="row"><span class="pill">${coinSvg(18)}${fmt(s.coins)}</span><span class="pill" title="Кристаллы — только на умения">💎 ${s.crystals}</span><span class="pill">${scrollSvg(18)}${s.scrolls}</span></div></div>
    <div class="power-card">${icon('sword', 40, '#ffd76a')}<div class="grow"><div class="small muted">Сила отряда · ${s.squad.length}/${SQUAD_SIZE} · командир ур. ${commanderLevel(s.stage)}</div><div class="big">${fmt(pw.total)}</div>
      <div class="small muted">Состав ${fmt(pw.raw)}${pw.bonus ? ` · фракция и снаряжение +${Math.round(pw.bonus * 100)}%` : ''}</div></div></div>
    <div class="tabs3">
      <button class="${tab === 'heroes' ? 'on' : ''}" data-act="tab" data-v="heroes">Активисты${freePerks ? ` <b class="dot">${freePerks}</b>` : ''}</button>
      <button class="${tab === 'skills' ? 'on' : ''}" data-act="tab" data-v="skills">Умения ${s.loadout.length}/${loadoutSlots(s.stage)}</button>
      <button class="${tab === 'gear' ? 'on' : ''}" data-act="tab" data-v="gear">Снаряжение</button>
    </div>
    <div data-body class="col" style="gap:10px"></div>
  </div></div>`);
  const body = $(node, '[data-body]');
  if (tab === 'heroes') drawHeroes(app, body);
  else if (tab === 'skills') drawSkills(app, body);
  else drawGear(app, body);
  onAct(node, { tab: (t) => { app.squadTab = t.dataset.v as App['squadTab']; app.render(); } });
  return node;
}

// ---------- Активисты ----------
function drawHeroes(app: App, body: HTMLElement) {
  const s = app.state;
  const list = s.heroes
    .filter((h) => filter === 'all' || heroDef(h.id).cls === filter)
    .sort((a, b) => Number(s.squad.includes(b.uid)) - Number(s.squad.includes(a.uid)) || heroPower(b) - heroPower(a));
  body.innerHTML = `<div class="chips">
      <button class="chip ${filter === 'all' ? 'on' : ''}" data-act="f" data-v="all">Все · ${s.heroes.length}</button>
      ${(Object.keys(CLASS_INFO) as HeroClass[]).map((k) => `<button class="chip ${filter === k ? 'on' : ''}" data-act="f" data-v="${k}" style="border-color:${CLASS_INFO[k].color}">${CLASS_INFO[k].plural}</button>`).join('')}
    </div>
    <div class="small muted">В отряде до ${SQUAD_SIZE}. Агитаторы бьют организаторов, организаторы — юристов, юристы — агитаторов (+${CLASS_ADVANTAGE * 100}%). Юристы держат удар — враги бьют их чаще. Каждый уровень и звезда дают очки перков.</div>
    <div class="heroes">${list.map((h) => heroCard(h, s.squad.includes(h.uid))).join('')}</div>
    <div class="row" style="gap:10px;align-items:stretch">
      <button class="btn btn-gold btn-col grow" data-act="hire">Нанять активиста<span class="sub">${s.scrolls > 0 ? `свиток · есть ${s.scrolls}` : `${hireCostCoins(s)} профкоинов`}</span></button>
      <button class="btn btn-blue btn-col" data-act="upall" style="width:42%">Улучшить отряд<span class="sub">на все монеты</span></button>
    </div>
    <div class="row" style="gap:8px"><button class="btn btn-ghost btn-sm grow" data-act="auto">${icon('sparkle', 16)} Сильнейший отряд</button><button class="btn btn-ghost btn-sm grow" data-act="perkall">${icon('plus', 16)} Раздать перки всем</button></div>`;
  onAct(body, {
    f: (t) => { filter = t.dataset.v as HeroClass | 'all'; app.render(); },
    hero: (t) => openHero(app, t.dataset.uid!),
    hire: () => doHire(app),
    upall: () => {
      const n = upgradeAll(s);
      if (!n) { toast('Не хватает профкоинов на улучшение', 'bad'); return; }
      haptic('ok'); toast(`Улучшений: ${n}. Новые очки перков — в карточках активистов`, 'ok'); app.update();
    },
    auto: () => { autoSquad(s); sanitizeLoadout(s); haptic(); toast('Собран сильнейший отряд', 'ok'); app.update(); },
    perkall: () => {
      let n = 0;
      for (const u of s.squad) { const h = s.heroes.find((x) => x.uid === u); if (h && perkFree(h) > 0) { autoPerks(h); n++; } }
      toast(n ? 'Очки перков разложены по классу каждого' : 'Свободных очков нет', n ? 'ok' : 'info'); app.update();
    },
  });
}

function openHero(app: App, uid: string) {
  const s = app.state;
  const h = s.heroes.find((x) => x.uid === uid)!;
  const d = heroDef(h.id);
  const sk = SKILLS.find((x) => x.hero === h.id);
  const draw = () => {
    const st = heroStats(h);
    const cost = heroUpgradeCost(s, h);
    const inSq = s.squad.includes(uid);
    const r = RARITY_INFO[d.rarity];
    const c = CLASS_INFO[d.cls];
    const p = perksOf(h);
    const free = perkFree(h);
    const row = (k: keyof Perks, name: string, text: string) => `<div class="perk-row"><div class="grow"><b>${name}</b> <span class="gold">${p[k]}</span><div class="small muted">${text}</div></div>
      <button class="btn btn-ghost btn-sm" data-pm="${k}" ${p[k] ? '' : 'disabled'} aria-label="Убрать очко">${icon('minus', 14)}</button><button class="btn btn-green btn-sm" data-pp="${k}" ${free ? '' : 'disabled'} aria-label="Добавить очко">${icon('plus', 14)}</button></div>`;
    return `<div class="col" style="align-items:center;gap:8px">
      <div class="pic" style="width:96px;height:96px;border-radius:50%;overflow:hidden;background:#0f1030;box-shadow:0 0 0 3px ${r.color}">${heroSvg(h.id, 96)}</div>
      <h2 style="font-size:22px">${esc(d.name)}</h2>
      <div class="row"><span class="tag" style="background:${r.color}33;color:${r.color}">${r.name}</span><span class="tag" style="background:${c.color}33;color:${c.color}">${c.name}</span>${stars(h.stars, 14)}</div>
      <div class="small muted center">«${esc(d.quote)}» · ${esc(c.text)}</div>
      <div class="stat4">
        <div class="card center"><div class="small muted">Ур.</div><b>${h.level}</b></div>
        <div class="card center"><div class="small muted">Атака</div><b>${fmt(st.atk)}</b></div>
        <div class="card center"><div class="small muted">Здоровье</div><b>${fmt(st.hp)}</b></div>
        <div class="card center"><div class="small muted">Скор./крит</div><b>${st.rate.toFixed(2)}/${Math.round(st.crit * 100)}%</b></div>
      </div>
      ${sk ? `<div class="card col" style="width:100%;gap:2px;border-color:${c.color}"><div class="small muted">Суперспособность · с ${sk.minLvl} ур. командира</div><b>${icon(sk.icon, 14)} ${esc(sk.name)} · ур. ${skillLevel(s, sk.id)}</b><div class="small">${esc(sk.text(skillLevel(s, sk.id)))}</div></div>` : ''}
      <div class="col" style="width:100%;gap:6px"><div class="row"><b class="grow">Перки · свободно ${free} из ${perkPoints(h)}</b><button class="btn btn-ghost btn-sm" data-pauto>Авто</button><button class="btn btn-ghost btn-sm" data-preset>Сброс</button></div>
        ${row('str', 'Сила', `+${pc(PERK.str)}% атаки за очко`)}
        ${row('vit', 'Стойкость', `+${pc(PERK.vit)}% здоровья и +${pc(PERK.vitDr)}% защиты`)}
        ${row('agi', 'Ловкость', `+${pc(PERK.agi)}% скорости атаки и +${pc(PERK.agiCrit)}% крита`)}
        <div class="small muted">Очко — за каждый уровень, два — за звезду.</div></div>
      <div class="row" style="width:100%;gap:10px">
        <button class="btn btn-green btn-col grow" data-up ${h.level >= MAX_HERO_LEVEL ? 'disabled' : ''}>Улучшить<span class="sub row" style="gap:4px;justify-content:center">${coinSvg(12)} ${fmt(cost)}</span></button>
        <button class="btn btn-blue grow" data-sq>${inSq ? 'Убрать из отряда' : 'В отряд'}</button>
      </div></div>`;
  };
  const m = modal(draw());
  const bind = () => {
    $(m.root, '[data-up]')?.addEventListener('click', () => {
      const r = upgrade(s, uid);
      if ('error' in r) { toast(r.error, 'bad'); haptic('bad'); return; }
      haptic('ok'); refresh();
    });
    $(m.root, '[data-sq]')?.addEventListener('click', () => {
      const r = toggleSquad(s, uid);
      if (r === 'full') { toast(`В отряде уже ${SQUAD_SIZE} — сначала убери кого-то`, 'bad'); return; }
      if (r === 'last') { toast('В отряде должен остаться хотя бы один', 'bad'); return; }
      sanitizeLoadout(s);
      haptic(); refresh();
    });
    m.root.querySelectorAll<HTMLElement>('[data-pp]').forEach((b) => b.addEventListener('click', () => { const p = { ...perksOf(h) }; if (perkFree(h) <= 0) return; p[b.dataset.pp as keyof Perks]++; h.perks = p; haptic(); refresh(); }));
    m.root.querySelectorAll<HTMLElement>('[data-pm]').forEach((b) => b.addEventListener('click', () => { const p = { ...perksOf(h) }; const k = b.dataset.pm as keyof Perks; if (p[k] <= 0) return; p[k]--; h.perks = p; haptic(); refresh(); }));
    $(m.root, '[data-pauto]').addEventListener('click', () => { autoPerks(h); haptic(); refresh(); });
    $(m.root, '[data-preset]').addEventListener('click', () => { h.perks = { str: 0, vit: 0, agi: 0 }; refresh(); });
  };
  const refresh = () => {
    m.root.innerHTML = `<button class="modal-x" data-close aria-label="Закрыть">✕</button>${draw()}`;
    bind();
    app.update();
  };
  bind();
}

function doHire(app: App) {
  const s = app.state;
  const r = hire(s, s.scrolls > 0 ? 'scroll' : 'coins');
  if ('error' in r) { toast(r.error, 'bad'); haptic('bad'); return; }
  haptic('heavy');
  const rar = RARITY_INFO[r.def.rarity];
  const sk = SKILLS.find((x) => x.hero === r.def.id);
  const txt = r.kind === 'new' ? 'Новый активист в команде!' : r.kind === 'star' ? `Дубликат: +1 звезда (${r.inst!.stars}★) и +2 очка перков` : `Все звёзды уже есть — вернули ${r.refund} профкоинов`;
  modal(`<div class="col center" style="align-items:center;gap:10px">
    <div class="small muted" style="text-transform:uppercase;letter-spacing:.08em;color:${rar.color};font-weight:800">${rar.name}</div>
    <div style="width:140px;height:140px;border-radius:50%;overflow:hidden;background:radial-gradient(${rar.color}55,#0f1030);box-shadow:0 0 0 4px ${rar.color},0 0 40px ${rar.color}88;animation:up .4s">${heroSvg(r.def.id, 140)}</div>
    <h2 style="font-size:24px">${esc(r.def.name)}</h2>
    <div class="tag" style="background:${CLASS_INFO[r.def.cls].color}33;color:${CLASS_INFO[r.def.cls].color}">${CLASS_INFO[r.def.cls].name}</div>
    <div>${txt}</div>
    ${r.kind === 'new' && sk ? `<div class="small muted">Суперспособность: <b>${esc(sk.name)}</b> — ${esc(sk.text(1))}</div>` : ''}
    <button class="btn btn-gold btn-block" data-close>Отлично</button></div>`, { cls: 'center' });
  app.update();
}

// ---------- Умения ----------
function drawSkills(app: App, body: HTMLElement) {
  const s = app.state;
  const slots = loadoutSlots(s.stage);
  const cmd = commanderLevel(s.stage);
  const rows = SKILLS.map((k) => ({ k, a: skillAvailable(s, k), on: s.loadout.includes(k.id), lv: skillLevel(s, k.id) }))
    .sort((x, y) => Number(y.on) - Number(x.on) || Number(y.a.ok) - Number(x.a.ok) || x.k.minLvl - y.k.minLvl);
  body.innerHTML = `<div class="small muted">Ячеек ${slots} из 6 — новая за каждого босса главы. Умение доступно, если его владелец в отряде (для умения класса — любой активист этого класса) и командир (ур. ${cmd} — номер этапа) дорос до него. Уровни 2–5 — за кристаллы 💎 ${s.crystals}.</div>
    <div class="slots">${Array.from({ length: 6 }, (_, i) => {
      const id = s.loadout[i];
      const k = id ? skillById(id) : null;
      return i >= slots ? `<div class="slot lock">${icon('lock', 18)}<span>после ${(i - 2) * 10}-го этапа</span></div>`
        : k ? `<button class="slot on" data-act="tog" data-id="${k.id}" style="--cc:${CLASS_INFO[k.cls].color}">${icon(k.icon, 18)}<b>${esc(k.name)}</b><span>ур. ${skillLevel(s, k.id)}</span></button>`
        : '<div class="slot empty">пусто</div>';
    }).join('')}</div>
    <div class="list">${rows.map(({ k, a, on, lv }) => {
      const owner = k.hero ? heroDef(k.hero).name : `любой ${CLASS_INFO[k.cls].name.toLowerCase()}`;
      const cost = lv < SKILL_MAX ? SKILL_UP_COST[lv] : 0;
      return `<div class="li sk-li ${a.ok ? '' : 'locked'}" style="--cc:${CLASS_INFO[k.cls].color}">
        <div class="sk-ic">${icon(k.icon, 20)}</div>
        <div class="grow"><div class="row" style="gap:6px"><b>${esc(k.name)}</b><span class="small gold">ур. ${lv}/${SKILL_MAX}</span></div>
          <div class="small">${esc(k.text(lv))}${k.uses ? '' : ` · перезарядка ${k.cd} с`}</div>
          <div class="small muted">${esc(owner)}${a.ok ? '' : ` · ${esc(a.reason)}`}${k.good ? ` · ${esc(k.good)}` : ''}</div></div>
        <div class="col" style="gap:4px;align-items:stretch">
          <button class="btn ${on ? 'btn-blue' : 'btn-gold'} btn-sm" data-act="tog" data-id="${k.id}" ${a.ok || on ? '' : 'disabled'}>${on ? 'Убрать' : 'Взять'}</button>
          ${lv < SKILL_MAX ? `<button class="btn btn-ghost btn-sm" data-act="up" data-id="${k.id}" ${s.crystals >= cost ? '' : 'disabled'}>💎 ${cost}</button>` : '<span class="small gold center">макс.</span>'}
        </div></div>`;
    }).join('')}</div>`;
  onAct(body, {
    tog: (t) => { const err = toggleLoadout(s, t.dataset.id as SkillId); if (err) { toast(err, 'bad'); haptic('bad'); return; } haptic(); app.update(); },
    up: (t) => { const err = upgradeSkill(s, t.dataset.id as SkillId); if (err) { toast(err, 'bad'); haptic('bad'); return; } haptic('ok'); toast(`${skillById(t.dataset.id!)!.name}: уровень ${skillLevel(s, t.dataset.id!)}`, 'ok'); app.update(); },
  });
}

// ---------- Снаряжение ----------
function itemCard(it: ItemInst, equipped: boolean) {
  const R = ITEM_RARITY[it.rarity];
  return `<div class="li" style="border-left:4px solid ${R.color}"><div class="grow"><div class="small" style="color:${R.color}">${R.name} · ${SLOTS.find((x) => x.id === it.slot)!.name}</div><b>${esc(it.name)}</b>
    <div class="small">${(Object.entries(it.stats) as [ItemStat, number][]).map(([k, v]) => statText(k, v)).join(' · ')}</div></div>
    <div class="col" style="gap:4px"><button class="btn ${equipped ? 'btn-blue' : 'btn-gold'} btn-sm" data-act="eq" data-id="${it.uid}">${equipped ? 'Снять' : 'Надеть'}</button>
    ${equipped ? '' : `<button class="btn btn-ghost btn-sm" data-act="sell" data-id="${it.uid}">${coinSvg(11)} ${fmt(itemSellPrice(it))}</button>`}</div></div>`;
}

function drawGear(app: App, body: HTMLElement) {
  const s = app.state;
  const ib = itemBonus(s);
  const eq = new Set(Object.values(s.equip).filter(Boolean));
  const bag = s.items.filter((x) => !eq.has(x.uid)).sort((a, b) => ['legend', 'epic', 'rare', 'common'].indexOf(a.rarity) - ['legend', 'epic', 'rare', 'common'].indexOf(b.rarity));
  const sum = (Object.entries(ib) as [ItemStat, number][]).filter(([, v]) => v > 0);
  body.innerHTML = `<div class="small muted">Снаряжение командира усиливает весь отряд. Выпадает за этапы: босс — всегда, первое прохождение — в 30% случаев, повтор — в 10%. Лишнее можно продать.</div>
    <div class="gear">${SLOTS.map((sl) => {
      const it = s.items.find((x) => x.uid === s.equip[sl.id]);
      return it ? `<button class="gslot" data-act="eq" data-id="${it.uid}" style="border-color:${ITEM_RARITY[it.rarity].color}">${icon(sl.icon, 22, ITEM_RARITY[it.rarity].color)}<b>${esc(it.name)}</b><span>${(Object.entries(it.stats) as [ItemStat, number][]).map(([k, v]) => statText(k, v)).join(', ')}</span></button>`
        : `<div class="gslot empty">${icon(sl.icon, 22)}<b>${sl.name}</b><span>пусто</span></div>`;
    }).join('')}</div>
    ${sum.length ? `<div class="card small">Итого от снаряжения: ${sum.map(([k, v]) => statText(k, v) + (v >= STAT_CAP[k] ? ' (потолок)' : '')).join(' · ')}</div>` : ''}
    <div class="section-h">Рюкзак · ${s.items.length}/24</div>
    <div class="list">${bag.map((it) => itemCard(it, false)).join('') || '<div class="small muted center">Пусто. Проходи этапы кампании — предметы выпадают за победы.</div>'}</div>`;
  onAct(body, {
    eq: (t) => { equipItem(s, t.dataset.id!); haptic(); app.update(); },
    sell: (t) => { const c = sellItem(s, t.dataset.id!); if (c) { haptic('ok'); toast(`Продано: +${fmt(c)} профкоинов`, 'ok'); app.update(); } },
  });
}
