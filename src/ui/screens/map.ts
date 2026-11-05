// Общая карта: Лефортово и кампус МЭИ. Ратуши ПБ, спорные точки, стычки, внешние мероприятия.
import { CAMPUS_HOME, CONTESTED, EVENT_SQUAD, MAP_EVENTS, MAP_POINTS, PROFKOM_XY, RATUSHA_SPOTS, type MapEvent } from '../../config/map';
import { PLAYABLE_FACTIONS, factionById, type FactionId } from '../../config/factions';
import { gameById } from '../../config/minigames';
import { TEST_MODE, TEST_ROUND_MINUTES } from '../../config/test';
import { SKIRMISH_WIN_COINS } from '../../config/economy';
import { eventMarker, pointMarker, ratushaMarker } from '../../art/mapMarkers';
import { totemSvg } from '../../art/totems';
import { openRaid } from './raid';
import { toGeo } from '../../map/campusData';
import { icon } from '../../art/icons';
import { createDrawnMap, type DrawnView } from '../../map/drawn';
import { createYandexMap, yandexKey, type YandexView } from '../../map/yandex';
import { eventKey, eventStandings, factionName, nextEventInfo, pointById, ratushaLevel, strike, type Order, type WorldState } from '../../core/world';
import type { FactionRow } from '../../core/backend';
import { haptic } from '../../core/telegram';
import { $, el, esc, fmt, mmss, modal, onAct, toast } from '../../lib/dom';
import { openGame } from '../../games';
import { openLawDuel } from '../../games/law';
import type { App } from '../app';

/** Поехать на текущее мероприятие: 5 активистов пропускают ближайший раунд, открывается мини-игра. */
export function joinEvent(app: App, world: WorldState) {
  const s = app.state;
  if (!world.event) { toast('Сейчас мероприятий нет', 'info'); return; }
  const e = MAP_EVENTS.find((x) => x.id === world.event!.id)!;
  const key = eventKey(world.event.id, world.event.startAt);
  if (s.events.played[key] === undefined) {
    if (s.heroes.length < EVENT_SQUAD) {
      if (!TEST_MODE) { toast(`Нужно хотя бы ${EVENT_SQUAD} активистов — найми ещё в «Отряде»`, 'bad'); return; }
      toast(`На выезде нужно ${EVENT_SQUAD} активистов — в тесте пускаем и с ${s.heroes.length}`, 'info');
    }
    s.war.cooldownRound = world.round;
    if (s.war.order && s.war.orderRound === world.round) app.backend.setOrder(s, null).catch(() => {}); // отряд уехал — приказ снимается
    s.events.played[key] = 0;
  }
  openGame(app, e.game, { eventKey: key, eventName: e.name });
}

const hhmm = (t: number) => new Date(t + 3 * 3600_000).toISOString().slice(11, 16);

export function renderMap(app: App) {
  const s = app.state;
  const node = el(`<div class="screen map-screen">
    <div class="map-holder" data-map></div>
    <div class="map-hud">
      <div class="row" style="gap:8px">
        <div class="map-chip grow"><b>Карта · кампус МЭИ</b><span class="small muted" data-round></span></div>
        <button class="map-btn" data-act="standings" aria-label="Зачёт">${icon('trophy', 20)}</button>
        <button class="map-btn" data-act="report" aria-label="Отчёт раунда">${icon('swords', 20)}</button>
      </div>
      ${TEST_MODE ? `<div class="map-chip small" style="align-self:flex-start;background:#4b2a7acc">Тест: стычки каждые ${TEST_ROUND_MINUTES} мин, мероприятия меняются каждый час</div>` : ''}
    </div>
    <div class="map-zoom"><button class="map-btn" data-act="zin" aria-label="Приблизить">${icon('plus', 20)}</button><button class="map-btn" data-act="zout" aria-label="Отдалить">${icon('minus', 20)}</button><button class="map-btn" data-act="home" aria-label="К ратуше">${icon('crosshair', 20)}</button></div>
    <div class="map-sheet" data-sheet></div>
  </div>`);

  let world: WorldState | null = null;
  let factions: FactionRow[] = [];
  let sel = '';
  let drawn: DrawnView | null = null;
  let ymap: YandexView | null = null;
  let calibrate = false;
  const moved: Record<string, [number, number]> = {};
  const holder = $(node, '[data-map]');
  const sheet = $(node, '[data-sheet]');

  const owner = (id: string) => world?.points[id]?.owner ?? null;
  const shielded = (id: string) => !!world && (world.points[id]?.shieldRound ?? 0) >= world.round;
  const myOrder = (): Order | null => (world && s.war.orderRound === world.round ? s.war.order : null);
  const lawShare = () => (world && s.war.law && (s.war.law.round === world.round || s.war.law.round === 0) ? s.war.law.share : 0);
  const cooldown = () => !!world && s.war.cooldownRound === world.round;
  const flevel = (f: FactionId) => f === s.faction ? ratushaLevel(s) : (factions.find((x) => x.faction === f)?.ratusha ?? 1);
  const neutral = s.faction === 'profkom';
  /** Точка «домой» на карте: своя ратуша, у профкома — центр кампуса. */
  const homeXy = (): [number, number] => (s.faction && s.faction !== 'profkom' ? RATUSHA_SPOTS[s.faction as Exclude<FactionId, 'profkom'>].xy : CAMPUS_HOME);

  const eventLabel = (e: MapEvent) => {
    if (world?.event?.id === e.id) return `идёт · ${mmss(world.event.endAt - Date.now())}`;
    const n = nextEventInfo();
    if (n && n.ev.id === e.id && n.startAt > Date.now()) return `в ${hhmm(n.startAt)}`;
    return TEST_MODE ? 'позже' : 'по расписанию';
  };

  // ---------- Слой объектов ----------
  const overlaySvg = () => {
    const o = myOrder();
    // .mks — масштаб метки: на схеме она держит постоянный размер на экране при любом приближении
    const pts = CONTESTED.map((p) => `<g transform="translate(${p.xy[0]} ${p.xy[1]})" data-sel="pt:${p.id}"><g class="mks">${pointMarker(p, owner(p.id), { shield: shielded(p.id), target: o?.point === p.id ? o.kind : null, selected: sel === `pt:${p.id}` })}</g></g>`).join('');
    const rts = PLAYABLE_FACTIONS.map((f) => {
      const sp = RATUSHA_SPOTS[f.id as Exclude<FactionId, 'profkom'>];
      return `<g transform="translate(${sp.xy[0]} ${sp.xy[1]})" data-sel="rt:${f.id}"><g class="mks">${ratushaMarker(f.id, flevel(f.id), world?.trophies[f.id]?.length ?? 0, f.id === s.faction, sp.room)}</g></g>`;
    }).join('');
    const evs = MAP_EVENTS.map((e) => `<g transform="translate(${e.xy[0]} ${e.xy[1]})" data-sel="ev:${e.id}"><g class="mks">${eventMarker(e, world?.event?.id === e.id, eventLabel(e))}</g></g>`).join('')
      + `<g transform="translate(${PROFKOM_XY[0]} ${PROFKOM_XY[1]})" data-sel="pk:profkom"><g class="mks">${profkomMarker()}</g></g>`;
    // стрелка приказа от ратуши к цели
    let arrow = '';
    if (o && s.faction && !neutral) {
      const from = homeXy(), to = pointById(o.point).xy;
      arrow = `<path d="M${from[0]} ${from[1]} Q ${(from[0] + to[0]) / 2} ${Math.min(from[1], to[1]) - Math.max(40, Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.35)} ${to[0]} ${to[1]}" fill="none" stroke="${o.kind === 'attack' ? '#ff5a5f' : '#45d483'}" stroke-width="4" stroke-dasharray="10 8" opacity=".9"><animate attributeName="stroke-dashoffset" from="42" to="0" dur="1s" repeatCount="indefinite"/></path>`;
    }
    return arrow + rts + pts + evs;
  };

  const ymarkers = () => {
    const wrap = (inner: string, w = 120, h = 130, oy = 70) => `<svg width="${w}" height="${h}" viewBox="${-w / 2} ${-oy} ${w} ${h}" style="overflow:visible;display:block;transform:translate(-50%,-${(oy / h) * 100}%)"><style>.mkl{font:700 13px Rubik,sans-serif;fill:#fff;paint-order:stroke;stroke:#0b0e1f;stroke-width:4px}</style>${inner}</svg>`;
    const o = myOrder();
    const list = [
      ...CONTESTED.map((p) => ({ key: `pt:${p.id}`, geo: moved[`pt:${p.id}`] ?? p.geo, html: wrap(pointMarker(p, owner(p.id), { shield: shielded(p.id), target: o?.point === p.id ? o.kind : null, selected: sel === `pt:${p.id}` }), 110, 110, 56), onClick: () => select(`pt:${p.id}`) })),
      ...PLAYABLE_FACTIONS.map((f) => { const sp = RATUSHA_SPOTS[f.id as Exclude<FactionId, 'profkom'>]; return { key: `rt:${f.id}`, geo: moved[`rt:${f.id}`] ?? sp.geo, html: wrap(ratushaMarker(f.id, flevel(f.id), world?.trophies[f.id]?.length ?? 0, f.id === s.faction, sp.room), 110, 160, 92), onClick: () => select(`rt:${f.id}`) }; }),
      ...MAP_EVENTS.map((e) => ({ key: `ev:${e.id}`, geo: moved[`ev:${e.id}`] ?? e.geo, html: wrap(eventMarker(e, world?.event?.id === e.id, eventLabel(e)), 150, 100, 36), onClick: () => select(`ev:${e.id}`) })),
      { key: 'pk:profkom', geo: moved['pk:profkom'] ?? toGeo(PROFKOM_XY[0], PROFKOM_XY[1]), html: wrap(profkomMarker(), 110, 160, 92), onClick: () => select('pk:profkom') },
      ...MAP_POINTS.filter((p) => !p.contested).map((p) => ({ key: `lm:${p.id}`, geo: moved[`lm:${p.id}`] ?? p.geo, html: '', onClick: () => {} })),
    ].filter((m) => m.html);
    return list;
  };

  const redraw = () => {
    if (drawn) drawn.setOverlay(overlaySvg());
    if (ymap) ymap.setMarkers(ymarkers());
    drawSheet();
  };

  // ---------- Нижняя панель ----------
  const drawSheet = () => {
    if (!world) { sheet.innerHTML = '<div class="muted center">Загружаю карту…</div>'; return; }
    const [kind, id] = sel.split(':');
    if (kind === 'pt') return sheetPoint(id);
    if (kind === 'rt') return sheetRatusha(id as FactionId);
    if (kind === 'ev') return sheetEvent(id);
    if (kind === 'pk') {
      sheet.innerHTML = `<div class="row">${totemSvg(factionById('profkom'), 44)}<div class="grow"><b>Профком</b><div class="small muted">Боссы — организаторы. Пройди всю цепочку своим ПБ — и профком ваш</div></div><button class="btn btn-ghost btn-sm" data-act="close" aria-label="Закрыть">✕</button></div>
        <button class="btn btn-red btn-block" data-act="raid" style="margin-top:8px">${icon('swords', 18)} Штурм профкома</button>`;
      return;
    }
    const o = myOrder();
    const cd = cooldown();
    sheet.innerHTML = `
      <div class="row" style="justify-content:space-between"><b>Раунд ${world.round}</b><span class="small gold" data-timer></span></div>
      ${cd ? '<div class="small" style="color:#ff8a8a">Твои активисты на мероприятии — этот раунд пропускают.</div>' : o
        ? `<div class="small">Приказ: <b style="color:${o.kind === 'attack' ? '#ff8a8a' : '#6dffb0'}">${o.kind === 'attack' ? 'атаковать' : 'оборонять'}</b> «${esc(pointById(o.point).short)}» · сила ${fmt(strike(s, o.kind, lawShare()))}</div>`
        : neutral ? '<div class="small muted">Профком нейтрален и в стычках не участвует. Смотри, как идут ПБ, и запускай мероприятия из панели организатора.</div>'
        : '<div class="small muted">Выбери точку на карте: атаковать чужую или оборонять свою. Без приказа отряд стоит в ратуше. Сила ПБ растёт со Штабом и ратушей.</div>'}
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="btn btn-blue btn-sm grow" data-act="law">${icon('scales', 16)} Правовой поединок${lawShare() ? ` · +${Math.round(lawShare() * 20)}%` : ''}</button>
        ${o ? '<button class="btn btn-ghost btn-sm" data-act="cancel">Отменить приказ</button>' : ''}
      </div>
      ${app.backend.staff && ymap ? `<button class="btn btn-ghost btn-sm btn-block" data-act="calib" style="margin-top:8px">${calibrate ? 'Готово: скопировать координаты' : 'Режим разметки: двигать метки'}</button>` : ''}`;
    tick();
  };

  const sheetPoint = (id: string) => {
    const p = pointById(id);
    const ow = owner(id);
    const mine = ow === s.faction;
    const kind: Order['kind'] = mine ? 'defend' : 'attack';
    const sh = shielded(id);
    const o = myOrder();
    const active = o?.point === id;
    sheet.innerHTML = `
      <div class="row"><div class="grow"><b>${esc(p.name)}</b><div class="small muted">${esc(p.address)}</div></div><button class="btn btn-ghost btn-sm" data-act="close" aria-label="Закрыть">✕</button></div>
      <div class="row small" style="gap:6px;margin:6px 0;flex-wrap:wrap">
        <span class="tag" style="background:${ow ? factionById(ow).color + '44' : '#ffffff18'}">Владелец: ${factionName(ow)}</span>
        <span class="tag">+${p.influence} влияния за раунд</span>
        ${sh ? '<span class="tag" style="background:#4aa8ff44">Щит до следующего раунда</span>' : ''}
      </div>
      <div class="small muted">${neutral ? '' : `Твоя сила: ${fmt(strike(s, kind, lawShare()))} (отряд × ратуша ПБ × бонус ПБ и Штаба × правовой поединок)`}</div>
      ${neutral ? '<div class="small muted" style="margin-top:8px">Профком нейтрален: не атакует и не обороняет, а запускает события и мероприятия.</div>' : `<button class="btn ${kind === 'attack' ? 'btn-red' : 'btn-green'} btn-block" data-act="order" data-kind="${kind}" data-pt="${id}" style="margin-top:8px" ${(sh && !mine) || cooldown() ? 'disabled' : ''}>
        ${active ? 'Приказ уже отдан' : kind === 'attack' ? `Атаковать в раунде ${world!.round}` : `Оборонять в раунде ${world!.round}`}</button>`}`;
  };

  const sheetRatusha = (fid: FactionId) => {
    const f = factionById(fid);
    const r = factions.find((x) => x.faction === fid);
    const tr = world?.trophies[fid] ?? [];
    const pts = CONTESTED.filter((p) => owner(p.id) === fid);
    sheet.innerHTML = `
      <div class="row">${totemSvg(f, 44)}<div class="grow"><b>Ратуша ${f.short} · ур. ${flevel(fid)}</b><div class="small muted">Профбюро: ауд. ${esc(RATUSHA_SPOTS[fid as Exclude<FactionId, 'profkom'>]?.room ?? '—')} · ${r ? `${r.players} игроков · ${fmt(r.rating)} баллов · ` : ''}${fmt(world?.influence[fid] ?? 0)} влияния</div></div><button class="btn btn-ghost btn-sm" data-act="close" aria-label="Закрыть">✕</button></div>
      <div class="small" style="margin-top:6px"><b>${esc(f.perk.name)}:</b> ${esc(f.perk.text)}</div>
      <div class="small muted" style="margin-top:4px">Точки: ${pts.length ? pts.map((p) => esc(p.short)).join(', ') : 'пока нет'}${tr.length ? ` · трофеи: ${tr.map(esc).join(', ')}` : ''}</div>`;
  };

  const sheetEvent = (id: string) => {
    const e = MAP_EVENTS.find((x) => x.id === id)!;
    const g = gameById(e.game);
    const active = world?.event?.id === id ? world.event : null;
    if (!active) {
      sheet.innerHTML = `<div class="row"><div class="grow"><b>${esc(e.name)}</b><div class="small muted">Мини-игра «${esc(g.name)}» · трофей «${esc(e.trophy)}»</div></div><button class="btn btn-ghost btn-sm" data-act="close" aria-label="Закрыть">✕</button></div>
        <div class="small muted" style="margin-top:6px">Мероприятие появится ${esc(eventLabel(e))}. Длится час: отправляешь ${EVENT_SQUAD} активистов, играешь — 5 лучших результатов ПБ идут в зачёт. Топ-3 ПБ получают влияние, первое место — трофей.</div>`;
      return;
    }
    const key = eventKey(active.id, active.startAt);
    const mine = s.events.played[key];
    const st = eventStandings(active.scores).slice(0, 3);
    sheet.innerHTML = `<div class="row"><div class="grow"><b>${esc(e.name)}</b> <span class="small gold" data-evt></span><div class="small muted">Мини-игра «${esc(g.name)}» · трофей «${esc(e.trophy)}»</div></div><button class="btn btn-ghost btn-sm" data-act="close" aria-label="Закрыть">✕</button></div>
      <div class="list" style="margin:8px 0;gap:4px">${st.map((r, i) => `<div class="row small"><b style="width:18px">${i + 1}</b>${totemSvg(factionById(r.faction), 22)}<span class="grow">${factionById(r.faction).short}</span><b>${fmt(r.total)}</b></div>`).join('')}</div>
      ${mine !== undefined ? `<div class="small">Твой лучший: <b class="gold">${fmt(mine)}</b></div>` : ''}
      <button class="btn btn-gold btn-block" data-act="join" data-ev="${id}" style="margin-top:6px">${mine !== undefined ? 'Сыграть ещё (в зачёт лучший)' : `Поехать · ${EVENT_SQUAD} активистов`}</button>
      ${mine === undefined ? '<div class="small muted center" style="margin-top:4px">Отправленные активисты пропустят ближайший раунд стычек</div>' : ''}`;
  };

  const select = (v: string) => {
    sel = v === sel ? '' : v;
    haptic();
    redraw();
  };

  // ---------- Таймер ----------
  let refreshing = false;
  const tick = () => {
    if (!world) return;
    const t = sheet.querySelector('[data-timer]');
    if (t) t.textContent = world.nextAt > Date.now() ? `до стычки ${mmss(world.nextAt - Date.now())}` : 'идёт раунд…';
    const r = $(node, '[data-round]');
    if (r) r.textContent = ` · раунд ${world.round} через ${mmss(Math.max(0, world.nextAt - Date.now()))}`;
    const et = sheet.querySelector('[data-evt]');
    if (et && world.event) et.textContent = `· ещё ${mmss(world.event.endAt - Date.now())}`;
    if (!refreshing && (Date.now() >= world.nextAt || (world.event && Date.now() >= world.event.endAt))) {
      refreshing = true;
      const before = world.round;
      load().then(() => {
        refreshing = false;
        const rep = world?.reports[0];
        if (world && world.round > before && rep?.my) toast(rep.my.won ? `Раунд ${rep.round}: победа! +${SKIRMISH_WIN_COINS} профкоинов` : `Раунд ${rep.round}: не удалось`, rep.my.won ? 'ok' : 'bad');
      });
    }
  };

  const load = async () => {
    const [w, lb] = await Promise.all([app.backend.getWorld(s), app.backend.leaderboard(s).catch(() => ({ factions: [] as FactionRow[] }))]);
    world = w; factions = lb.factions;
    app.update(false);
    redraw();
  };

  // ---------- Действия ----------
  onAct(node, {
    close: () => select(''),
    raid: () => openRaid(app),
    order: async (t) => {
      const o: Order = { kind: t.dataset.kind as Order['kind'], point: t.dataset.pt! };
      await app.backend.setOrder(s, o).catch((e: Error) => toast(e.message, 'bad'));
      haptic('ok');
      toast(`Приказ на раунд ${world!.round}: ${o.kind === 'attack' ? 'атака' : 'оборона'} «${pointById(o.point).short}»`, 'ok');
      sel = '';
      app.update(false);
      redraw();
    },
    cancel: async () => { await app.backend.setOrder(s, null); app.update(false); redraw(); },
    law: () => {
      if (lawShare() > 0) { toast('Правовой поединок в этом раунде уже пройден', 'info'); return; }
      openLawDuel(app, async (share) => { await app.backend.setLaw(s, share); app.update(false); redraw(); });
    },
    join: () => { if (world) joinEvent(app, world); },
    standings: () => openStandings(),
    report: () => openReport(),
    zin: () => drawn?.zoomBy(1.3),
    zout: () => drawn?.zoomBy(1 / 1.3),
    home: () => { if (drawn) drawn.focus(homeXy(), 4.2); },
    calib: async () => {
      if (!ymap) return;
      if (!calibrate) {
        calibrate = true;
        ymap.setDraggable(true, (k, g) => { moved[k] = g; });
        toast('Перетащи метки на нужные здания, потом нажми «Готово»', 'info');
      } else {
        calibrate = false;
        ymap.setDraggable(false, () => {});
        const txt = JSON.stringify(moved, null, 1);
        try { await navigator.clipboard.writeText(txt); toast('Координаты скопированы — пришли их Claude', 'ok'); }
        catch { modal(`<h2 style="font-size:20px">Координаты</h2><textarea class="input-ans" style="height:200px;font-size:12px">${esc(txt)}</textarea>`); }
      }
      drawSheet();
    },
  });

  const openStandings = () => {
    if (!world) return;
    const rows = PLAYABLE_FACTIONS.map((f) => ({ f, inf: world!.influence[f.id] ?? 0, pts: CONTESTED.filter((p) => owner(p.id) === f.id).length, tr: world!.trophies[f.id] ?? [], r: factions.find((x) => x.faction === f.id) }))
      .sort((a, b) => b.inf - a.inf || (b.r?.rating ?? 0) - (a.r?.rating ?? 0));
    modal(`<h2 style="font-size:22px;margin-bottom:8px">Командный зачёт</h2>
      <div class="small muted" style="margin-bottom:8px">Влияние дают спорные точки после каждого раунда и места на мероприятиях.</div>
      <div class="list">${rows.map((x, i) => `<div class="li ${x.f.id === s.faction ? 'me' : ''}"><div class="rank ${i < 3 ? 'top' : ''}">${i + 1}</div>${totemSvg(x.f, 34)}
        <div class="grow"><b>${x.f.short}</b><div class="small muted">${x.pts} точек${x.tr.length ? ` · трофеи: ${x.tr.map(esc).join(', ')}` : ''}</div></div><b class="gold">${fmt(x.inf)}</b></div>`).join('')}</div>`);
  };

  const openReport = () => {
    const rep = world?.reports[0];
    if (!rep) { toast('Раундов ещё не было', 'info'); return; }
    modal(`<h2 style="font-size:22px;margin-bottom:6px">Раунд ${rep.round}</h2>
      ${rep.my ? `<div class="card" style="margin-bottom:8px;border-color:${rep.my.won ? 'var(--green)' : 'var(--red)'}">Твой приказ: ${rep.my.order.kind === 'attack' ? 'атака' : 'оборона'} «${esc(pointById(rep.my.order.point).short)}» · сила ${fmt(rep.my.s)} — <b>${rep.my.won ? `победа, +${SKIRMISH_WIN_COINS} профкоинов` : 'неудача'}</b></div>` : ''}
      <div class="list">${rep.results.length ? rep.results.map((r) => `<div class="li small"><div class="grow"><b>${esc(pointById(r.point).short)}</b><div class="muted">${factionName(r.attacker)} (${fmt(r.sAtt)}) → ${factionName(r.defender)} (${fmt(r.sDef)}) · шанс ${Math.round(r.p * 100)}%</div></div><b style="color:${r.changed ? 'var(--gold2)' : 'var(--muted)'}">${r.changed ? `взяли ${factionName(r.winner)}` : 'удержали'}</b></div>`).join('') : '<div class="muted">Атак не было</div>'}</div>`);
  };

  // ---------- Запуск ----------
  const startDrawn = () => {
    drawn = createDrawnMap(holder, (v) => select(v));
    redraw();
    setTimeout(() => drawn?.focus(homeXy(), 4.2), 50);
  };
  if (yandexKey()) {
    createYandexMap(holder).then((y) => { ymap = y; redraw(); }).catch(() => startDrawn());
  } else startDrawn();
  node.addEventListener('detach', () => { drawn?.destroy(); ymap?.destroy(); });
  app.onTick(tick);
  load();
  return node;
}

/** Метка профкома в центре кампуса: замок-молния, цель штурма. */
function profkomMarker() {
  return `<g class="mk">
    <ellipse cx="0" cy="34" rx="40" ry="9" fill="#000" opacity=".35"/>
    <rect x="-34" y="-10" width="68" height="44" rx="4" fill="#0d4f7a" stroke="#ffd76a" stroke-width="2"/>
    ${[-30, -16, -2, 12, 26].map((x) => `<rect x="${x}" y="-17" width="6" height="8" fill="#0d4f7a"/>`).join('')}
    <rect x="-14" y="-52" width="28" height="44" fill="#126da8" stroke="#ffd76a" stroke-width="2"/>
    <path d="M2 -46 L-8 -28 H0 L-4 -14 L8 -32 H0 Z" fill="#ffd76a"/>
    <rect x="-7" y="16" width="14" height="18" rx="7" fill="#3a2400"/>
    <text y="56" text-anchor="middle" class="mkl" style="fill:#ffd76a">Профком</text>
  </g>`;
}
