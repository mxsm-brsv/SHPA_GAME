import type { FactionId } from '../config/factions';
import { STARTER_HEROES } from '../config/heroes';
import { SQUAD_SIZE } from '../config/economy';
import type { Order } from './world';
import type { BuildingId } from '../config/clan';
import type { MerchOrder } from '../config/merch';
import type { ItemInst, Slot } from '../config/items';

export type Role = 'participant' | 'staff' | 'admin' | 'tester';

export interface ClickerState {
  energy: number;
  energyAt: number;        // момент, к которому посчитана энергия
  lvl: { tap: number; energy: number; regen: number };
  building: BuildingId;    // куда идёт опыт от тапов
  taps: number;            // всего тапов
  contributed: number;     // личный вклад в ПБ (опыт зданиям)
  pendingXp: number;       // ещё не отправлено на сервер
  boosts: { day: string; used: number };
  combo: number;
  lastTapAt: number;
}

/** Перки активиста: очки за уровни и звёзды, которые игрок раскладывает по характеристикам. */
export interface Perks { str: number; vit: number; agi: number }
export interface HeroInst { uid: string; id: string; level: number; stars: number; perks?: Perks }

export interface DailyStats {
  day: string;
  game: number;                       // рейтинг от игры за сутки (в лимите)
  byGame: Record<string, number>;     // рейтинг по каждой мини-игре
  best: Record<string, number>;       // лучший счёт дня
}

export interface GameState {
  v: 1;
  username: string;
  faction: FactionId | null;
  coins: number;
  scrolls: number;
  rating: number;
  heroes: HeroInst[];
  squad: string[];
  stage: number;          // следующий этап кампании
  idleSince: number;      // с какого момента копится награда за лекцию
  streakWin: boolean;
  gift: { lastDay: string; streak: number };
  loginDay: string;
  daily: DailyStats;
  fever: { level: number; stars: Record<string, number> };
  law: { right: Record<string, number>; wrong: Record<string, number> };
  stats: { battles: number; wins: number; hires: number };
  /** Стычки: приказ на следующий раунд, правовой поединок, кулдаун после мероприятия */
  war: { order: Order | null; orderRound: number; law: { round: number; share: number } | null; cooldownRound: number; wins: number; fights: number; seenRound: number };
  /** Мероприятия: лучший результат по ключу мероприятия, выданные награды */
  events: { played: Record<string, number>; rewarded: Record<string, 1> };
  profile: { course: string; facts: string; filled: boolean };
  /** Задания: выполнено (кол-во раз), на модерации, найденные тайники, знакомства */
  tasks: { done: Record<string, number>; pending: Record<string, number>; caches: number[]; meets: string[]; eggs: string[] };
  /** В демо-режиме: смотреть игру глазами организатора */
  demoStaff: boolean;
  /** Кто играет: участник из списка выезда, организатор, админ или тестер (только тест-режим) */
  role: Role;
  fio: string;
  clicker: ClickerState;
  /** Секрет личного обновляемого QR (в онлайне приходит с сервера) */
  secret: string;
  /** Демо: покупки мерча, отметки на лекциях */
  shop: { orders: MerchOrder[] };
  lectures: string[];
  /** Кампания-стратегия: кристаллы (только на умения), уровни умений, выбранные в бой умения, снаряжение командира */
  crystals: number;
  skillLv: Record<string, number>;
  loadout: string[];
  items: ItemInst[];
  equip: Partial<Record<Slot, string>>;
  createdAt: number;
}

export const mskDay = (t = Date.now()) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);

let uidCounter = 0;
export const newUid = () => `${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newClicker(): ClickerState {
  return { energy: 100, energyAt: Date.now(), lvl: { tap: 0, energy: 0, regen: 0 }, building: 'kassa', taps: 0, contributed: 0, pendingXp: 0, boosts: { day: '', used: 0 }, combo: 0, lastTapAt: 0 };
}

export function newState(username = 'Активист'): GameState {
  const heroes = STARTER_HEROES.map((id) => ({ uid: newUid(), id, level: 1, stars: 1 }));
  return {
    v: 1,
    username,
    faction: null,
    coins: 500,
    scrolls: 2,
    rating: 0,
    heroes,
    squad: heroes.map((h) => h.uid),
    stage: 1,
    idleSince: Date.now() - 20 * 60_000,
    streakWin: false,
    gift: { lastDay: '', streak: 0 },
    loginDay: '',
    daily: { day: mskDay(), game: 0, byGame: {}, best: {} },
    fever: { level: 1, stars: {} },
    law: { right: {}, wrong: {} },
    stats: { battles: 0, wins: 0, hires: 0 },
    war: { order: null, orderRound: 0, law: null, cooldownRound: 0, wins: 0, fights: 0, seenRound: 0 },
    events: { played: {}, rewarded: {} },
    profile: { course: '', facts: '', filled: false },
    tasks: { done: {}, pending: {}, caches: [], meets: [], eggs: [] },
    demoStaff: false,
    role: 'participant',
    fio: '',
    clicker: newClicker(),
    secret: '',
    shop: { orders: [] },
    lectures: [],
    crystals: 0,
    skillLv: {},
    loadout: ['shout', 'heal', 'article'],
    items: [],
    equip: {},
    createdAt: Date.now(),
  };
}

/** Подтягивает старые сохранения к текущей схеме. */
export function migrate(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<GameState>;
  if (s.v !== 1 || !Array.isArray(s.heroes)) return null;
  const base = newState(s.username);
  const out = { ...base, ...s, daily: { ...base.daily, ...(s.daily ?? {}) }, fever: { ...base.fever, ...(s.fever ?? {}) },
    law: { ...base.law, ...(s.law ?? {}) }, stats: { ...base.stats, ...(s.stats ?? {}) }, gift: { ...base.gift, ...(s.gift ?? {}) },
    war: { ...base.war, ...(s.war ?? {}) }, events: { ...base.events, ...(s.events ?? {}) }, profile: { ...base.profile, ...(s.profile ?? {}) },
    tasks: { ...base.tasks, ...(s.tasks ?? {}) },
    clicker: { ...base.clicker, ...(s.clicker ?? {}), lvl: { ...base.clicker.lvl, ...(s.clicker?.lvl ?? {}) }, boosts: { ...base.clicker.boosts, ...(s.clicker?.boosts ?? {}) } },
    shop: { ...base.shop, ...(s.shop ?? {}) }, lectures: s.lectures ?? [], role: s.role ?? 'participant', fio: s.fio ?? '', secret: s.secret ?? '',
    crystals: Math.max(0, Math.floor(s.crystals ?? 0)), skillLv: s.skillLv ?? {}, loadout: Array.isArray(s.loadout) ? s.loadout : base.loadout,
    items: Array.isArray(s.items) ? s.items : [], equip: s.equip ?? {} } as GameState;
  fitSquad(out, SQUAD_SIZE);
  return out;
}

/** Отряд стал меньше (4): у старых сохранений лишних убираем из отряда — они остаются в коллекции. */
export function fitSquad(s: GameState, size: number) {
  s.squad = s.squad.filter((u, i, a) => a.indexOf(u) === i && s.heroes.some((h) => h.uid === u)).slice(0, size);
  if (!s.squad.length && s.heroes.length) s.squad = [s.heroes[0].uid];
}

/** Сбрасывает суточные счётчики, если начались новые сутки (по Москве). */
export function rollDay(s: GameState) {
  const d = mskDay();
  if (s.daily.day !== d) s.daily = { day: d, game: 0, byGame: {}, best: {} };
}
