// База ПБ: кликер по ратуше (профкоины себе, опыт — общему ПБ), награда за блоки. По бокам — развлечения (бой, карта, игры)
// и ПБ/рейтинг/помощь; главное (задания, QR, подготовка, мерч) — в нижнем меню.
import { factionById } from '../../config/factions';
import { IDLE } from '../../config/economy';
import { BUILDINGS, buildingLevel, type BuildingId } from '../../config/clan';
import { contribTitle } from '../../config/clicker';
import { baseSceneSvg } from '../../art/scene';
import { ratushaSvg } from '../../art/ratusha';
import { totemSvg } from '../../art/totems';
import { coinSvg, icon, starSvg } from '../../art/icons';
import { coinsPerHour, idlePending, playerLevel, squadPower, clanNow } from '../../core/logic';
import { boostsLeft, maxEnergy, regenMs, syncEnergy, tap, tapValue, useBoost } from '../../core/clicker';
import { chapterOf } from '../../config/campaign';
import { haptic } from '../../core/telegram';
import { $, el, esc, floatText, fmt, mmss, onAct, toast } from '../../lib/dom';
import type { App } from '../app';
import { openGift, openRating, openTrip, giftAvailable, openLive } from './modals';
import { openClan, openUpgrades } from './clan';
import { openProfile } from './profile';
import { openStaff } from './staff';
import { openVote } from './vote';
import { isMine } from '../../core/vote';
import { openHelp } from '../tour';

const KIND_ICON = { info: 'info', alert: 'bolt', win: 'trophy' } as const;

export function renderBase(app: App) {
  const s = app.state;
  const f = factionById(s.faction);
  const lvl = playerLevel(s.rating);
  const pw = squadPower(s);
  const ch = chapterOf(s.stage);
  const cb = clanNow();
  const gift = giftAvailable(s);
  syncEnergy(s);

  const node = el(`<div class="base">
    <div class="base-scene">${baseSceneSvg(f, ch.n, false)}</div>
    <div class="base-top">
      <div class="row" style="gap:10px">
        <button class="avatar" data-act="profile" aria-label="Профиль">${totemSvg(f, 54)}<div class="lvl">${lvl.n}</div></button>
        <div class="grow col" style="gap:2px">
          <div style="font-family:var(--head);font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.username)} · ${f.short}</div>
          <div class="row small" style="gap:8px;font-weight:700"><span class="row gold" style="gap:3px">${icon('sword', 13, '#ffd76a', 2.4)}${fmt(pw.total)}</span><span class="row" style="gap:3px;color:#9fe0ff">${icon('flag', 13, '#9fe0ff', 2.4)}${esc(contribTitle(s.clicker.contributed))}</span></div>
        </div>
        <div class="col" style="gap:6px;align-items:flex-end">
          <button class="pill" data-act="shop">${coinSvg(18)}<span data-coins>${fmt(s.coins)}</span><span class="plus">+</span></button>
          <button class="pill" data-act="rating">${starSvg(15)}<span>${fmt(s.rating)} баллов</span></button>
        </div>
      </div>
      <div class="row small" style="justify-content:space-between"><span>${esc(lvl.name)}</span><span class="muted">${lvl.next ? `до «${esc(lvl.next.name)}» ${fmt(lvl.toNext)}` : 'максимальный уровень'}</span></div>
      <div class="xp"><i style="width:${Math.round(lvl.progress * 100)}%"></i></div>
      <button class="live-banner hidden" data-live data-act="live"></button>
      <button class="live-banner vote-banner hidden" data-vote data-act="vote"></button>
    </div>

    <div class="side l">
      <button data-act="squad" aria-label="Отряд и бой"><div class="sq">${icon('sword', 24)}</div><span class="lbl">Бой</span></button>
      <button data-act="map" aria-label="Карта кампуса"><div class="sq">${icon('map', 24)}</div><span class="lbl">Карта</span></button>
      <button data-act="games" aria-label="Мини-игры"><div class="sq">${icon('gamepad', 24)}</div><span class="lbl">Игры</span></button>
    </div>
    <div class="side r">
      ${app.backend.staff ? `<button data-act="staff" aria-label="Панель организатора"><div class="sq" style="border-color:var(--gold)">${icon('shield', 24, '#ffd76a')}</div><span class="lbl">Орг.</span></button>` : ''}
      <button data-act="clan" aria-label="Моё ПБ"><div class="sq hl">${icon('users', 24)}</div><span class="lbl">Моё ПБ</span></button>
      <button data-act="rating" aria-label="Рейтинг"><div class="sq">${icon('trophy', 24)}</div><span class="lbl">Рейтинг</span></button>
      <button data-act="gift" aria-label="Подарок"><div class="sq">${icon('gift', 24)}${gift ? '<span class="badge">1</span>' : ''}</div><span class="lbl">Подарок</span></button>
      <button data-act="help" aria-label="Как играть"><div class="sq">${icon('info', 24)}</div><span class="lbl">Помощь</span></button>
    </div>

    <div class="tap-zone" data-tap aria-label="Тапай по ратуше">
      <div class="tap-ratusha" data-rat>${ratushaSvg(f, { ratusha: cb.ratusha, ...cb.levels })}</div>
      <div class="ratusha-label">Ратуша ${f.short} · ур. ${cb.ratusha}<span data-place></span></div>
      <div class="tap-hint" data-hint>тапай!</div>
    </div>

    <div class="base-bottom">
      <div class="clicker">
        <div class="row" style="gap:8px">
          <div class="grow">
            <div class="row small" style="justify-content:space-between"><b class="row" style="gap:4px">${icon('bolt', 14, '#7fd4ff', 2.4)}<span data-en></span></b><span class="muted" data-tapv></span></div>
            <div class="energy"><i data-enbar></i></div>
          </div>
          <button class="btn btn-blue btn-sm en-btn" data-act="boost" aria-label="Полная энергия">${icon('bolt', 16, '#7fd4ff')}<span data-boost>${boostsLeft(s)}</span></button>
          <button class="btn btn-blue btn-sm en-btn" data-act="upg" aria-label="Улучшения">${icon('plus', 16)}</button>
        </div>
        <div class="bld" data-bld>${BUILDINGS.map((b) => {
          const L = buildingLevel(app.clan?.xp[b.id] ?? 0);
          return `<button class="bld-chip ${s.clicker.building === b.id ? 'on' : ''}" data-act="bld" data-id="${b.id}" style="--bc:${b.color}">
            ${icon(b.icon, 15, b.color, 2.4)}<span>${esc(b.name.split(' ')[0])}</span><b>${L.level}</b><i style="width:${Math.round(L.progress * 100)}%"></i></button>`;
        }).join('')}</div>
      </div>
      <div class="lecture">
        <div style="width:40px;height:40px;flex-shrink:0;display:grid;place-items:center;border-radius:12px;background:#ffc83d22">${icon('chest', 26, '#ffc83d')}</div>
        <div class="grow">
          <div class="row" style="justify-content:space-between"><b class="small">Пока ты на блоке</b><span class="gold small" style="font-weight:700" data-hours></span></div>
          <div class="bar"><i data-bar></i></div>
          <div class="small muted" data-text></div>
        </div>
        <button class="btn btn-green btn-sm" data-act="claim">Забрать</button>
      </div>
    </div>
  </div>`);

  const coinsEl = $(node, '[data-coins]');
  const drawEnergy = () => {
    syncEnergy(s);
    const max = maxEnergy(s);
    const e = Math.floor(s.clicker.energy);
    $(node, '[data-en]').textContent = `${e} / ${max}`;
    $(node, '[data-enbar]').style.width = `${(e / max) * 100}%`;
    const left = e < max ? Math.ceil(((max - e) * regenMs(s) - (Date.now() - s.clicker.energyAt)) / 1000) : 0;
    $(node, '[data-tapv]').textContent = e < 1 ? `ещё тап через ${Math.ceil(regenMs(s) / 1000)} с` : `+${fmt(tapValue(s))} за тап`;
    $(node, '[data-en]').title = left > 0 ? `Полная энергия через ${mmss(left * 1000)}` : 'Энергия полная';
    coinsEl.textContent = fmt(s.coins);
  };

  const tick = () => {
    const p = idlePending(s);
    $(node, '[data-hours]').textContent = `${Math.floor(p.hours)}:${String(Math.floor((p.hours % 1) * 60)).padStart(2, '0')} из ${IDLE.maxHours} ч`;
    $(node, '[data-bar]').style.width = `${(p.hours / IDLE.maxHours) * 100}%`;
    $(node, '[data-text]').innerHTML = p.coins > 0
      ? `Отряд заработал +${fmt(p.coins)}${p.scrolls ? `, +${p.scrolls} свит.` : ''}${p.full ? ' · <b style="color:var(--red)">полно</b>' : ''}`
      : `${fmt(coinsPerHour(s))} профкоинов в час`;
    drawEnergy();
  };
  tick();
  app.onTick(tick);

  // ---------- тапы ----------
  const zone = $(node, '[data-tap]');
  // зона тапа — от верхней панели до нижней, какой бы высоты ни были экран и панели
  const bottom = $(node, '.base-bottom');
  const top = $(node, '.base-top');
  // Боковые кнопки и ратуша — в просвете между верхней и нижней панелями. На низком окне (Telegram на компьютере,
  // маленький телефон) кнопки сжимаются: компактно → только значки → одной строкой над нижней панелью.
  const sides = Array.from(node.querySelectorAll<HTMLElement>('.side'));
  const fit = () => {
    const H = node.clientHeight;
    if (!H) return;
    const topEdge = top.offsetTop + top.offsetHeight;
    const botH = bottom.offsetHeight + 10;
    const most = Math.max(...sides.map((x) => x.children.length));
    const avail = H - topEdge - botH - 12;
    const need = (sq: number, lbl: number, gap: number) => most * (sq + lbl) + (most - 1) * gap;
    const mode = avail >= need(46, 17, 10) ? '' : avail >= need(40, 13, 4) ? 'compact' : avail >= need(36, 0, 5) ? 'tiny' : 'row';
    node.classList.toggle('compact', mode === 'compact');
    node.classList.toggle('tiny', mode === 'tiny' || mode === 'row');
    node.classList.toggle('row', mode === 'row');
    const rowH = mode === 'row' ? 50 : 0;
    sides.forEach((x) => { x.style.top = mode === 'row' ? '' : `${topEdge + 10}px`; x.style.bottom = mode === 'row' ? `${botH + 6}px` : ''; });
    zone.style.bottom = `${botH + 16 + rowH}px`;
    zone.style.top = `${topEdge + 12}px`;
    ($(node, '.base-scene') as HTMLElement).style.bottom = `${bottom.offsetHeight + 4}px`;
    node.style.setProperty('--grass', `${bottom.offsetHeight + 14}px`);
  };
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(fit); ro.observe(bottom); ro.observe(top); ro.observe(node); node.addEventListener('detach', () => ro.disconnect()); }
  else window.addEventListener('resize', fit);
  requestAnimationFrame(fit);
  const rat = $(node, '[data-rat]');
  let lastHaptic = 0;
  let hintHidden = s.clicker.taps > 20;
  if (hintHidden) $(node, '[data-hint]').classList.add('hidden');
  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = tap(s);
    if (!r.ok) {
      if (r.reason === 'energy') { toast(boostsLeft(s) ? 'Энергия кончилась — нажми ⚡, чтобы восполнить' : 'Энергия кончилась — восстановится сама', 'info'); haptic('bad'); }
      return;
    }
    rat.classList.remove('bump'); void rat.offsetWidth; rat.classList.add('bump');
    const zr = zone.getBoundingClientRect();
    const fl = el(`<div class="tap-float ${r.golden ? 'golden' : ''}" style="left:${e.clientX - zr.left}px;top:${e.clientY - zr.top}px">${r.golden ? '✨' : ''}+${fmt(r.coins)}${r.mult > 1 ? ` <small>×${r.mult.toFixed(1)}</small>` : ''}</div>`);
    zone.appendChild(fl);
    setTimeout(() => fl.remove(), 800);
    const now = Date.now();
    if (r.golden) haptic('ok'); else if (now - lastHaptic > 120) { haptic(); lastHaptic = now; }
    if (!hintHidden && s.clicker.taps > 20) { hintHidden = true; $(node, '[data-hint]').classList.add('hidden'); }
    drawEnergy();
    app.update(false);
  });

  // ---------- эфир ----------
  const live = $(node, '[data-live]');
  const drawLive = () => {
    const a = app.live[0];
    live.classList.toggle('hidden', !a);
    if (a) live.innerHTML = `${icon(KIND_ICON[a.kind], 16, a.kind === 'alert' ? '#ff8a8a' : a.kind === 'win' ? '#ffd76a' : '#9fe0ff')}<span>${esc(a.text)}</span>`;
  };
  live.addEventListener('live', drawLive);
  drawLive();

  // ---------- голосование ----------
  const voteEl = $(node, '[data-vote]');
  const drawVote = () => {
    const v = app.vote;
    const myTeam = v?.myTeam ? v.teams.find((t) => t.id === v.myTeam) : null;
    // команды заведены — можно вписаться заранее; дальше — голосование и итог
    const show = !!v && v.teams.length > 0 && (v.status !== 'closed' || v.reveal || !!myTeam);
    voteEl.classList.toggle('hidden', !show);
    if (!show || !v) return;
    const cur = v.current ? v.teams.find((t) => t.id === v.current)?.name : null;
    const left = v.teams.filter((t) => (!v.current || t.id === v.current) && !isMine(v, t) && !v.my[t.id]).length;
    voteEl.innerHTML = v.reveal
      ? `${icon('trophy', 16, '#ffd76a')}<span>${esc(v.title)}: итоги — смотри, кто лучший</span>`
      : v.status === 'open'
        ? `<i class="vb-dot"></i><span>Голосование «${esc(v.title)}»${cur ? `: выступает ${esc(cur)}` : ''}${left ? ` · оцени ✅ ❌ — ${left}` : ' · твой голос учтён'}</span>`
        : myTeam ? `${icon('users', 16)}<span>${esc(v.title)}: твоя команда — <b>${esc(myTeam.name)}</b>. Найди своих</span>`
        : `${icon('users', 16)}<span>${esc(v.title)}: впиши себя в свою команду — ФИО и команда</span>`;
  };
  voteEl.addEventListener('vote', drawVote);
  drawVote();

  // ---------- место ПБ и открытые отметки ----------
  app.cached('lb', 60_000, () => app.backend.leaderboard(s)).then(({ factions }) => {
    const i = factions.findIndex((x) => x.faction === s.faction);
    const pl = node.querySelector('[data-place]');
    if (pl && i >= 0) pl.textContent = ` · ${i + 1}-е место`;
  }).catch(() => {});
  const checkLect = () => app.drawNavBadges();
  let n = 0;
  app.onTick(() => { if (++n % 30 === 0) checkLect(); if (n % 60 === 0) refreshClan(); });
  const refreshClan = async () => {
    const before = clanNow().levels;
    await app.refreshClan();
    const after = clanNow().levels;
    const up = BUILDINGS.find((b) => after[b.id] > before[b.id]);
    if (up && !app.overlay) { toast(`${up.name} ${f.short} — уровень ${after[up.id]}!`, 'ok'); haptic('ok'); app.render(); }
  };

  onAct(node, {
    claim: (t) => {
      const p = app.claimIdle();
      if (p.coins <= 0) { toast('Пока пусто — награда копится, пока ты на блоках', 'info'); return; }
      haptic('ok');
      floatText(t, `+${fmt(p.coins)}`);
      toast(`+${fmt(p.coins)} профкоинов${p.scrolls ? ` и ${p.scrolls} свит. найма` : ''}`, 'ok');
      app.update();
    },
    bld: async (t) => {
      const id = t.dataset.id as BuildingId;
      if (s.clicker.building === id) { openClan(app); return; }
      await app.flush();
      s.clicker.building = id;
      haptic();
      toast(`Опыт от тапов теперь идёт в «${BUILDINGS.find((b) => b.id === id)!.name}»`, 'info');
      node.querySelectorAll('.bld-chip').forEach((c) => c.classList.toggle('on', (c as HTMLElement).dataset.id === id));
      app.update(false);
    },
    boost: () => {
      if (s.clicker.energy >= maxEnergy(s)) { toast('Энергия и так полная', 'info'); return; }
      if (!useBoost(s)) { toast('Бусты на сегодня кончились — завтра будет ещё 3', 'bad'); return; }
      haptic('ok'); $(node, '[data-boost]').textContent = String(boostsLeft(s)); drawEnergy(); app.update(false);
    },
    upg: () => openUpgrades(app),
    clan: () => openClan(app),
    squad: () => app.go('squad'),
    map: () => app.go('map'),
    games: () => app.go('games'),
    shop: () => app.go('shop'),
    rating: () => openRating(app),
    trip: () => openTrip(app),
    help: () => openHelp(app),
    gift: () => openGift(app),
    live: () => openLive(app),
    vote: () => openVote(app),
    profile: () => openProfile(app),
    staff: () => openStaff(app),
  });
  return node;
}
