// «Моё ПБ»: общие здания ратуши, участники и их вклад, вложение профкоинов. Плюс личные улучшения кликера.
import { BUILDINGS, CLAN, buildingLevel, type BuildingId } from '../../config/clan';
import { UPGRADES, CLICKER, contribTitle, upgradeTier } from '../../config/clicker';
import { factionById } from '../../config/factions';
import { totemSvg } from '../../art/totems';
import { coinSvg, icon } from '../../art/icons';
import { buyUpgrade, donate, upgradeCostOf } from '../../core/clicker';
import { haptic } from '../../core/telegram';
import { $, esc, fmt, modal, onAct, toast } from '../../lib/dom';
import type { App } from '../app';

export async function openClan(app: App) {
  const s = app.state;
  const f = factionById(s.faction);
  await app.flush();
  await app.refreshClan();
  const c = app.clan;
  const m = modal(`<div data-body></div>`);
  const body = $(m.root, '[data-body]');
  const draw = () => {
    const cl = app.clan ?? c;
    const members = cl?.members ?? [];
    const participants = members.length;
    body.innerHTML = `
      <div class="row" style="gap:10px;margin-bottom:8px">${totemSvg(f, 52)}<div class="grow"><h2 style="font-size:22px">${f.short} · ${esc(f.totemName)}</h2>
        <div class="small muted">${s.faction === 'profkom' ? 'Профком — вне зачёта' : `${participants} из ${cl?.limit ?? CLAN.pbLimit} игроков · ратуша ур. ${cl?.bonuses.ratusha ?? 1}`}</div></div></div>
      <div class="small muted" style="margin-bottom:8px">Здания общие для всего ПБ: каждый тап и каждая вложенная монета любого игрока качает их, а бонусы получают все.</div>
      <div class="col" style="gap:8px">${BUILDINGS.map((b) => {
        const xp = cl?.xp[b.id] ?? 0;
        const L = buildingLevel(xp);
        return `<div class="card col" style="gap:6px;border-color:${s.clicker.building === b.id ? b.color : 'var(--line)'}">
          <div class="row">${icon(b.icon, 22, b.color)}<b class="grow">${esc(b.name)} · ур. ${L.level}</b>
            <button class="btn btn-sm ${s.clicker.building === b.id ? 'btn-gold' : 'btn-ghost'}" data-act="pick" data-id="${b.id}">${s.clicker.building === b.id ? 'Качаю' : 'Качать'}</button></div>
          <div class="xp" style="height:8px"><i style="width:${Math.round(L.progress * 100)}%;background:${b.color}"></i></div>
          <div class="small muted">${L.next ? `${fmt(xp)} / ${fmt(L.next)} опыта` : 'максимум'} · ${esc(b.text(L.level))}</div>
        </div>`;
      }).join('')}</div>
      <div class="card col" style="margin-top:10px;gap:6px">
        <b>Вложить профкоины</b>
        <div class="small muted">${CLAN.coinsPerXp} профкоинов = 1 опыт в выбранное здание. Сейчас у тебя ${fmt(s.coins)}.</div>
        <div class="row" style="gap:6px">${[0.1, 0.5, 1].map((k) => `<button class="btn btn-blue btn-sm grow" data-act="don" data-k="${k}">${k === 1 ? 'Всё' : `${k * 100}%`} · ${fmt(Math.floor((s.coins * k) / CLAN.coinsPerXp))} оп.</button>`).join('')}</div>
      </div>
      <div class="section-h" style="margin-top:10px">Кто больше вложился</div>
      <div class="list">${members.map((p, i) => `<div class="li ${p.me ? 'me' : ''}"><div class="rank ${i < 3 ? 'top' : ''}">${i + 1}</div>
        <div class="grow"><b>${esc(p.name)}</b><div class="small muted">${esc(contribTitle(p.contributed))} · ${fmt(p.rating)} баллов</div></div><b class="gold">${fmt(p.contributed)}</b></div>`).join('') || '<div class="muted small">Пока никого</div>'}</div>`;
  };
  draw();
  onAct(body, {
    pick: async (t) => {
      await app.flush();
      s.clicker.building = t.dataset.id as BuildingId;
      haptic(); draw(); app.update(false);
    },
    don: async (t) => {
      const k = Number(t.dataset.k);
      const xp = donate(s, Math.floor(s.coins * k));
      if (!xp) { toast(`Нужно хотя бы ${CLAN.coinsPerXp} профкоинов`, 'bad'); return; }
      haptic('ok');
      toast(`+${xp} опыта зданию «${BUILDINGS.find((b) => b.id === s.clicker.building)!.name}»`, 'ok');
      await app.flush();
      draw();
      app.update(false);
    },
  });
}

export function openUpgrades(app: App) {
  const s = app.state;
  const m = modal('<div data-body></div>');
  const body = $(m.root, '[data-body]');
  const draw = () => {
    body.innerHTML = `<h2 style="font-size:22px">Мой активист</h2>
      <div class="small muted" style="margin:4px 0 10px">Личные улучшения: тапы дают больше профкоинов, энергии больше. Опыт от тапов идёт всему ПБ.</div>
      <div class="list">${UPGRADES.map((u) => {
        const lvl = s.clicker.lvl[u.id];
        const max = lvl >= CLICKER.maxUpgrade;
        const cost = upgradeCostOf(s, u.id);
        const tr = upgradeTier(u, max ? lvl - 1 : lvl);
        const tierColor = ['#ffd76a', '#7cc8ff', '#c08bff', '#ff7aa2'][tr.t];
        return `<div class="li"><div style="width:40px;height:40px;border-radius:12px;background:#ffffff12;display:grid;place-items:center;box-shadow:inset 0 0 0 2px ${tierColor}66">${icon(u.icon, 22, tierColor)}</div>
          <div class="grow"><b>${esc(tr.name)} · ур. ${max ? CLICKER.tierSize : tr.inTier}${tr.t > 0 || lvl >= CLICKER.tierSize ? ` <span class="small" style="color:${tierColor}">ступень ${tr.t + 1} из ${u.tiers.length}</span>` : ''}</b><div class="small muted">${esc(u.text(lvl + (max ? 0 : 1)))}${max ? '' : ' на след. уровне'}</div></div>
          <button class="btn btn-gold btn-sm" data-act="buy" data-id="${u.id}" ${max || s.coins < cost ? 'disabled' : ''}>${max ? 'макс.' : `${coinSvg(14)} ${fmt(cost)}`}</button></div>`;
      }).join('')}</div>
      <div class="small muted" style="margin-top:8px">Золотой тап (✨): ×${CLICKER.goldenMult} монет и ×${CLICKER.goldenXp} опыта. Комбо — быстрые тапы подряд, до ×${CLICKER.comboMax}. Больше ${CLICKER.maxTapsPerSecond} тапов в секунду не засчитываются.</div>`;
  };
  draw();
  onAct(body, {
    buy: (t) => {
      const r = buyUpgrade(s, t.dataset.id as 'tap' | 'energy' | 'regen');
      if ('error' in r) { toast(r.error, 'bad'); haptic('bad'); return; }
      haptic('ok'); draw(); app.update();
    },
  });
}
