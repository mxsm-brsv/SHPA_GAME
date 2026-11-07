import { MINIGAMES, gameById, type GameId } from '../../config/minigames';
import { DAILY_GAME_COINS, DAILY_MINIGAME_COINS } from '../../config/economy';
import { MAP_EVENTS } from '../../config/map';
import { icon } from '../../art/icons';
import { $, el, esc, fmt, mmss, onAct } from '../../lib/dom';
import { openGame } from '../../games';
import { openDuelHub } from '../../games/duel';
import { eventKey, nextEventInfo, type WorldState } from '../../core/world';
import type { App } from '../app';
import { joinEvent } from './map';

export function renderGames(app: App) {
  const s = app.state;
  const left = Math.max(0, DAILY_GAME_COINS - (s.daily.day === new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10) ? s.daily.game : 0));
  const best = (id: GameId) => s.daily.best[id];
  const feat = gameById('fever');
  const rest = MINIGAMES.filter((g) => g.id !== 'fever');
  const feverStars = Object.values(s.fever.stars).reduce((a, b) => a + b, 0);
  const node = el(`<div class="screen"><div class="page">
    <div class="page-title"><h1>Игры</h1></div>
    <div class="small muted">Игры приносят профкоины, баллы — только задания и образовалка. Бонус за лучший результат дня — до ${DAILY_MINIGAME_COINS} в каждой игре, сегодня осталось <b class="gold">${fmt(left)}</b>.</div>
    <div class="event-card" data-ev><div class="muted small">Ищу мероприятия на карте…</div></div>
    <div class="feature">
      <div class="art">${icon('desk', 64, '#fff3e0', 1.6)}</div>
      <div class="txt">
        <div style="font-family:var(--head);font-size:18px">${esc(feat.name)}</div>
        <div class="small muted">${esc(feat.text)}</div>
        <div class="row" style="justify-content:space-between"><span class="small gold" style="font-weight:700">Ур. ${s.fever.level} · ★ ${feverStars}</span>
          <button class="btn btn-green btn-sm" data-act="play" data-id="fever">Играть</button></div>
      </div>
    </div>
    <div class="games">${rest.map((g) => `
      <button class="gtile" data-act="play" data-id="${g.id}">
        <div class="gi" style="background:${g.color}">${icon(g.icon, 24, '#fff')}</div>
        <div class="gn">${esc(g.name)}</div>
        ${best(g.id) ? `<div class="gs">рекорд ${fmt(best(g.id))}</div>` : ''}
      </button>`).join('')}
      <button class="gtile" data-act="duel">
        <div class="gi" style="background:#a8326e">${icon('swords', 24, '#fff')}</div>
        <div class="gn">Правовой поединок</div><div class="gs">против участника</div>
      </button>
    </div>
  </div></div>`);

  let world: WorldState | null = null;
  const drawEvent = () => {
    const box = $(node, '[data-ev]');
    const w = world;
    if (w?.event) {
      const e = MAP_EVENTS.find((x) => x.id === w.event!.id)!;
      const g = gameById(e.game);
      const mine = s.events.played[eventKey(w.event.id, w.event.startAt)];
      box.innerHTML = `${icon(g.icon, 40, '#e6d5ff')}
        <div class="grow"><div class="small" style="color:#d9c2ff;font-weight:800;letter-spacing:.04em">СЕЙЧАС НА КАРТЕ · ещё <span data-evt>${mmss(w.event.endAt - Date.now())}</span></div>
          <div style="font-family:var(--head)">${esc(e.name)}</div>
          <div class="small">«${esc(g.name)}» · 5 лучших результатов ПБ в зачёт${mine !== undefined ? ` · твой лучший ${fmt(mine)}` : ''}</div></div>
        <button class="btn btn-gold btn-sm btn-col" data-act="join">Поехать<span class="sub">весь отряд</span></button>`;
    } else {
      const n = nextEventInfo();
      box.innerHTML = `${icon('bus', 36, '#e6d5ff')}<div class="grow"><b>Внешние мероприятия</b><div class="small muted">${n ? `Следующее: «${esc(n.ev.name)}» в ${new Date(n.startAt + 3 * 3600_000).toISOString().slice(11, 16)}` : 'Расписание мероприятий закончилось'}</div></div>`;
    }
  };
  app.cached('world-ev', 60_000, () => app.backend.getWorld(s)).then((w) => { world = w; drawEvent(); }).catch(() => {});
  app.onTick(() => { const t = node.querySelector('[data-evt]'); if (t && world?.event) t.textContent = mmss(world.event.endAt - Date.now()); });

  onAct(node, {
    play: (t) => openGame(app, t.dataset.id as GameId),
    duel: () => openDuelHub(app),
    join: () => { if (world) joinEvent(app, world); },
  });
  return node;
}
