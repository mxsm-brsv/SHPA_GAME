// Общий мир: спорные точки, раунды стычек, влияние ПБ, внешние мероприятия.
// В демо-режиме мир считается в браузере (соперники — боты), в онлайне — на сервере по тем же правилам.
import { CONTESTED, EVENT_MINUTES, MAP_EVENTS, MAP_POINTS, type MapEvent } from '../config/map';
import { PLAYABLE_FACTIONS, factionById, type FactionId } from '../config/factions';
import { TEST_EVENT_MINUTES, TEST_MODE, TEST_ROUND_MINUTES } from '../config/test';
import { clanNow, perkOf, squadPower } from './logic';
import type { GameState } from './state';

export interface Order { kind: 'attack' | 'defend'; point: string }
export interface PointState { owner: FactionId | null; shieldRound: number }
export interface RoundResult { point: string; attacker: FactionId | null; defender: FactionId | null; sAtt: number; sDef: number; p: number; winner: FactionId | null; changed: boolean }
export interface RoundReport { round: number; at: number; results: RoundResult[]; my?: { order: Order; won: boolean; rating: number; s: number } }
export interface EventScore { name: string; faction: FactionId; score: number; me?: boolean }
export interface ActiveEvent { id: string; startAt: number; endAt: number; scores: EventScore[] }
export interface EventResult { id: string; endAt: number; places: { faction: FactionId; total: number }[] }

export interface WorldState {
  v: 1;
  round: number;
  nextAt: number;
  points: Record<string, PointState>;
  influence: Record<string, number>;
  trophies: Record<string, string[]>;
  reports: RoundReport[];
  event: ActiveEvent | null;
  eventResults: EventResult[];
}

// ---------- Расписание ----------
const msk = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h - 3, m);
const REAL_ROUNDS: number[] = [
  ...[5, 6].flatMap((d) => [10, 14, 18, 22].map((h) => msk(d, h))),
  ...[10, 12, 14, 16, 18, 20, 22].map((h) => msk(7, h)),
  msk(8, 10), msk(8, 11, 30),
];
const REAL_EVENTS: { at: number; id: string }[] = [
  { at: msk(5, 13), id: 'stipkom' }, { at: msk(5, 19), id: 'sparta' },
  { at: msk(6, 13), id: 'priem' }, { at: msk(6, 19), id: 'granty' },
  { at: msk(7, 13), id: 'forum' }, { at: msk(7, 18), id: 'region' },
  { at: msk(8, 9), id: 'olymp' },
];

export function nextRoundAt(now = Date.now()): number | null {
  if (TEST_MODE) {
    const step = TEST_ROUND_MINUTES * 60_000;
    return Math.floor(now / step) * step + step;
  }
  return REAL_ROUNDS.find((t) => t > now) ?? null;
}

// Тест: организатор может запустить любое мероприятие прямо сейчас (на TEST_EVENT_MINUTES минут).
const LS_FORCE = 'pbgame.forceEvent';
export function forceEvent(id: string, now = Date.now()) {
  try { localStorage.setItem(LS_FORCE, JSON.stringify({ id, startAt: now })); } catch { /* приватный режим */ }
}
function forced(now: number) {
  try {
    const f = JSON.parse(localStorage.getItem(LS_FORCE) ?? 'null') as { id: string; startAt: number } | null;
    const ev = f && MAP_EVENTS.find((e) => e.id === f.id);
    if (f && ev && now < f.startAt + TEST_EVENT_MINUTES * 60_000) return { ev, startAt: f.startAt, endAt: f.startAt + TEST_EVENT_MINUTES * 60_000 };
  } catch { /* битые данные */ }
  return null;
}

export function eventSlot(now = Date.now()): { ev: MapEvent; startAt: number; endAt: number } | null {
  if (TEST_MODE) {
    const f = forced(now);
    if (f) return f;
    const step = TEST_EVENT_MINUTES * 60_000;
    const n = Math.floor(now / step);
    return { ev: MAP_EVENTS[n % MAP_EVENTS.length], startAt: n * step, endAt: n * step + step };
  }
  const s = REAL_EVENTS.find((e) => now >= e.at && now < e.at + EVENT_MINUTES * 60_000);
  if (!s) return null;
  return { ev: MAP_EVENTS.find((e) => e.id === s.id)!, startAt: s.at, endAt: s.at + EVENT_MINUTES * 60_000 };
}

export function nextEventInfo(now = Date.now()) {
  if (TEST_MODE) return eventSlot(now);
  const s = REAL_EVENTS.find((e) => e.at > now);
  return s ? { ev: MAP_EVENTS.find((e) => e.id === s.id)!, startAt: s.at, endAt: s.at + EVENT_MINUTES * 60_000 } : null;
}

export const eventKey = (id: string, startAt: number) => `${id}@${startAt}`;

// ---------- Сила в стычке ----------
/** Уровень ратуши — общий для ПБ, от зданий (см. config/clan.ts). */
export const ratushaLevel = (_s?: GameState) => clanNow().ratusha;

/** S = A × (1 + 0,05·R) × (1 + B) × (1 + 0,2·Q) — формула из концепции. */
export function strike(s: GameState, kind: Order['kind'], lawShare: number) {
  const p = perkOf(s);
  const A = squadPower(s).raw;
  const B = (kind === 'attack' ? (p.atk ?? 0) + (p.bossAtk ?? 0) / 2 : (p.hp ?? 0) + (p.dmgTaken ?? 0)) + clanNow().power;
  return Math.round(A * (1 + 0.05 * ratushaLevel(s)) * (1 + B) * (1 + 0.2 * lawShare));
}

export function newWorld(now = Date.now()): WorldState {
  const points: Record<string, PointState> = {};
  for (const p of CONTESTED) points[p.id] = { owner: null, shieldRound: 0 };
  return { v: 1, round: 1, nextAt: nextRoundAt(now) ?? now + 3600_000, points, influence: {}, trophies: {}, reports: [], event: null, eventResults: [] };
}

function mulberry(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Сила ботов-ПБ в демо растёт со временем и примерно равна силе игрока. */
function botArmy(f: FactionId, s: GameState, round: number) {
  const base = Math.max(600, squadPower(s).raw);
  const k = 0.75 + ((f.charCodeAt(0) * 7 + f.length * 13 + round) % 10) / 20;
  return Math.round(base * k * 2.2);
}

export interface ResolveInput {
  order: Order | null;
  lawShare: number;
  me: GameState;
  cooldown: boolean;
}

/** Считает один раунд в демо. Возвращает отчёт и меняет мир. */
export function resolveRoundDemo(w: WorldState, inp: ResolveInput): RoundReport {
  const round = w.round;
  const rnd = mulberry(round * 7919 + 17);
  const attacks = new Map<string, { f: FactionId; s: number }[]>();
  const defense = new Map<string, number>();
  const owned = (f: FactionId) => CONTESTED.filter((p) => w.points[p.id].owner === f).map((p) => p.id);

  for (const f of PLAYABLE_FACTIONS) {
    const army = botArmy(f.id, inp.me, round);
    const mine = owned(f.id);
    const targets = CONTESTED.filter((p) => w.points[p.id].owner !== f.id && w.points[p.id].shieldRound < round);
    if (targets.length && rnd() < 0.85) {
      const t = targets[Math.floor(rnd() * targets.length)];
      const list = attacks.get(t.id) ?? [];
      list.push({ f: f.id, s: Math.round(army * 0.7) });
      attacks.set(t.id, list);
    }
    const def = mine.length ? Math.round((army * 0.3) / mine.length) : 0;
    for (const id of mine) defense.set(id, (defense.get(id) ?? 0) + def);
  }

  let myS = 0;
  if (inp.order && !inp.cooldown && inp.me.faction) {
    myS = strike(inp.me, inp.order.kind, inp.lawShare);
    if (inp.order.kind === 'attack') {
      const list = attacks.get(inp.order.point) ?? [];
      const ex = list.find((x) => x.f === inp.me.faction);
      if (ex) ex.s += myS; else list.push({ f: inp.me.faction, s: myS });
      attacks.set(inp.order.point, list);
    } else if (w.points[inp.order.point]?.owner === inp.me.faction) {
      defense.set(inp.order.point, (defense.get(inp.order.point) ?? 0) + myS);
    }
  }

  const results: RoundResult[] = [];
  for (const p of CONTESTED) {
    const st = w.points[p.id];
    const list = (attacks.get(p.id) ?? []).filter((a) => a.f !== st.owner).sort((a, b) => b.s - a.s);
    if (!list.length || st.shieldRound >= round) continue;
    const att = list[0];
    const garrison = st.owner ? 0 : Math.round(380 * (1 + round * 0.08));
    const sDef = (defense.get(p.id) ?? 0) + garrison + (st.owner ? 250 : 0);
    const prob = att.s / (att.s + sDef);
    const win = rnd() < prob;
    const winner = win ? att.f : st.owner;
    results.push({ point: p.id, attacker: att.f, defender: st.owner, sAtt: att.s, sDef, p: prob, winner, changed: win });
    if (win) { st.owner = att.f; st.shieldRound = round + 1; }
  }

  // влияние за раунд
  for (const p of CONTESTED) {
    const o = w.points[p.id].owner;
    if (o) w.influence[o] = (w.influence[o] ?? 0) + p.influence;
  }

  const rep: RoundReport = { round, at: Date.now(), results };
  if (inp.order && inp.me.faction && !inp.cooldown) {
    const r = results.find((x) => x.point === inp.order!.point);
    const won = inp.order.kind === 'attack' ? r?.winner === inp.me.faction && r.changed : (r ? r.winner === inp.me.faction : w.points[inp.order.point]?.owner === inp.me.faction);
    rep.my = { order: inp.order, won: !!won, rating: won ? 10 : 0, s: myS };
  }
  w.reports = [rep, ...w.reports].slice(0, 6);
  w.round = round + 1;
  return rep;
}

// ---------- Мероприятия ----------
const BOT_NAMES = ['Алина', 'Тимур', 'Соня', 'Егор', 'Вера', 'Марк', 'Лиза', 'Даня', 'Ника', 'Артём', 'Полина', 'Глеб', 'Яна', 'Рома', 'Катя', 'Илья', 'Маша', 'Олег', 'Аня', 'Сева'];

export function botEventScores(ev: MapEvent, startAt: number): EventScore[] {
  const rnd = mulberry(startAt / 1000 + ev.id.length);
  const scale: Record<string, number> = { ring: 1400, runner: 2600, stamp: 40, bus: 60, blocks: 3000, merge: 900, crossword: 9 };
  const max = scale[ev.game] ?? 100;
  return BOT_NAMES.map((n, i) => ({ name: `${n} (бот)`, faction: PLAYABLE_FACTIONS[i % PLAYABLE_FACTIONS.length].id, score: Math.round(max * (0.25 + rnd() * 0.7)) }));
}

/** Сумма 5 лучших результатов каждого ПБ. */
export function eventStandings(scores: EventScore[]) {
  const by = new Map<FactionId, number[]>();
  for (const s of scores) by.set(s.faction, [...(by.get(s.faction) ?? []), s.score]);
  return PLAYABLE_FACTIONS.map((f) => ({ faction: f.id, total: (by.get(f.id) ?? []).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
}

/** Закрывает прошедшее мероприятие: влияние топ-3 и трофей первому. */
export function closeEvent(w: WorldState) {
  const e = w.event;
  if (!e) return null;
  const ev = MAP_EVENTS.find((x) => x.id === e.id)!;
  const places = eventStandings(e.scores);
  const bonus = [30, 20, 10];
  places.slice(0, 3).forEach((p, i) => { if (p.total > 0) w.influence[p.faction] = (w.influence[p.faction] ?? 0) + bonus[i]; });
  if (places[0]?.total > 0) w.trophies[places[0].faction] = [...(w.trophies[places[0].faction] ?? []), ev.trophy];
  const res = { id: e.id, endAt: e.endAt, places };
  w.eventResults = [res, ...w.eventResults].slice(0, 10);
  w.event = null;
  return res;
}

export const pointById = (id: string) => MAP_POINTS.find((p) => p.id === id)!;
export const factionName = (f: FactionId | null) => (f ? factionById(f).short : 'ничья');
