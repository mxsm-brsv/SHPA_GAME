import { factionById, type RpgPerk } from '../config/factions';
import { CLASS_BASE, HEROES, RARITY_INFO, heroDef, type HeroClass, type HeroDef, type Rarity } from '../config/heroes';
import { STAT_CAP, itemSellPrice, type ItemStat } from '../config/items';
import { HIRE_COST_COINS, HIRE_COST_SCROLLS, IDLE, MAX_HERO_LEVEL, MAX_STARS, PLAYER_LEVELS, SQUAD_SIZE, upgradeCost } from '../config/economy';
import { newUid, type GameState, type HeroInst, type Perks } from './state';
import { clanBonuses, type ClanBonuses } from '../config/clan';

// Бонусы общего ПБ (здания ратуши). Обновляются, когда приходит состояние клана с сервера.
let clanB: ClanBonuses = clanBonuses({});
export const clanNow = () => clanB;
export const setClanBonuses = (b: ClanBonuses) => { clanB = b; };

export const perkOf = (s: GameState): RpgPerk => factionById(s.faction).perk.effect;

// ---------- Характеристики активиста ----------
/** Атак в секунду по классу: агитаторы быстрые, юристы медленные, но крепкие. */
export const CLASS_RATE: Record<HeroClass, number> = { agit: 1.1, org: 0.9, law: 0.8 };
const CLASS_DR: Record<HeroClass, number> = { agit: 0, org: 0.05, law: 0.12 };
/** Перки: +3% атаки за очко силы, +4% здоровья и +0,4% защиты за стойкость, +2% скорости и +0,4% крита за ловкость. */
export const PERK = { str: 0.03, vit: 0.04, vitDr: 0.004, agi: 0.02, agiCrit: 0.004 };

export const perkPoints = (h: HeroInst) => Math.max(0, h.level - 1) + 2 * Math.max(0, h.stars - 1);
export const perksOf = (h: HeroInst): Perks => h.perks ?? { str: 0, vit: 0, agi: 0 };
export const perkFree = (h: HeroInst) => { const p = perksOf(h); return perkPoints(h) - p.str - p.vit - p.agi; };

/** Разложить свободные очки по классу: агитатор — в силу, юрист — в стойкость, организатор — поровну. */
export function autoPerks(h: HeroInst) {
  const d = heroDef(h.id);
  const total = perkPoints(h);
  const w = d.cls === 'agit' ? [0.6, 0.15, 0.25] : d.cls === 'law' ? [0.2, 0.6, 0.2] : [0.34, 0.33, 0.33];
  const str = Math.round(total * w[0]), vit = Math.round(total * w[1]);
  h.perks = { str, vit, agi: Math.max(0, total - str - vit) };
}

/** Базовые характеристики без перков (уровень, редкость, звёзды). */
export function heroBase(h: HeroInst) {
  const d = heroDef(h.id);
  const base = CLASS_BASE[d.cls];
  const m = RARITY_INFO[d.rarity].mult * (1 + 0.07 * (h.level - 1)) * (1 + 0.2 * (h.stars - 1));
  return { atk: base.atk * m, hp: base.hp * m };
}

export interface HeroStats { atk: number; hp: number; rate: number; crit: number; dr: number }

/** Боевые характеристики с перками (без снаряжения и бонусов ПБ). */
export function heroStats(h: HeroInst): HeroStats {
  const d = heroDef(h.id);
  const b = heroBase(h);
  const p = perksOf(h);
  return {
    atk: Math.round(b.atk * (1 + PERK.str * p.str)),
    hp: Math.round(b.hp * (1 + PERK.vit * p.vit)),
    rate: CLASS_RATE[d.cls] * Math.min(2, 1 + PERK.agi * p.agi),
    crit: Math.min(0.5, 0.1 + PERK.agiCrit * p.agi),
    dr: Math.min(0.4, CLASS_DR[d.cls] + PERK.vitDr * p.vit),
  };
}

/** Сила по характеристикам: урон в секунду с учётом крита и «живучесть». Совпадает с прежней шкалой на 1-м уровне. */
export const powerOfStats = (st: HeroStats) => Math.round(st.atk * st.rate * (1 + st.crit * 0.6) / 1.06 * 3 + (st.hp / (1 - st.dr)) * 0.5);

export function heroPower(h: HeroInst) { return powerOfStats(heroStats(h)); }

// ---------- Снаряжение ----------
export function itemBonus(s: GameState): Record<ItemStat, number> {
  const out = Object.fromEntries((Object.keys(STAT_CAP) as ItemStat[]).map((k) => [k, 0])) as Record<ItemStat, number>;
  for (const uid of Object.values(s.equip)) {
    const it = s.items.find((x) => x.uid === uid);
    if (!it) continue;
    for (const [k, v] of Object.entries(it.stats) as [ItemStat, number][]) out[k] += v;
  }
  for (const k of Object.keys(out) as ItemStat[]) out[k] = Math.min(STAT_CAP[k], out[k]);
  return out;
}

export function equipItem(s: GameState, uid: string) {
  const it = s.items.find((x) => x.uid === uid);
  if (!it) return;
  s.equip[it.slot] = s.equip[it.slot] === uid ? undefined : uid;
}

export function sellItem(s: GameState, uid: string) {
  const i = s.items.findIndex((x) => x.uid === uid);
  if (i < 0) return 0;
  const it = s.items[i];
  if (s.equip[it.slot] === uid) s.equip[it.slot] = undefined;
  s.items.splice(i, 1);
  const c = itemSellPrice(it);
  s.coins += c;
  return c;
}

/** Характеристики в бою: перки + снаряжение + фракция + здания ПБ. */
export function battleStats(s: GameState, h: HeroInst): HeroStats {
  const st = heroStats(h);
  const p = perkOf(s);
  const ib = itemBonus(s);
  return {
    atk: Math.round(st.atk * (1 + (p.atk ?? 0) + ib.atk + clanB.power / 2)),
    hp: Math.round(st.hp * (1 + (p.hp ?? 0) + ib.hp)),
    rate: st.rate * (1 + ib.speed),
    crit: Math.min(0.6, st.crit + (p.crit ?? 0) + ib.crit),
    dr: Math.min(0.5, st.dr + (p.dmgTaken ?? 0)),
  };
}

export function squadHeroes(s: GameState): HeroInst[] {
  return s.squad.map((u) => s.heroes.find((h) => h.uid === u)).filter(Boolean) as HeroInst[];
}

export function squadPower(s: GameState) {
  const p = perkOf(s);
  const ib = itemBonus(s);
  const raw = squadHeroes(s).reduce((a, h) => a + heroPower(h), 0);
  const bonus = (p.atk ?? 0) + (p.hp ?? 0) + (p.crit ?? 0) / 2 + (p.dodge ?? 0) / 2 + (p.dmgTaken ?? 0) / 2 + ib.atk * 0.6 + ib.hp * 0.4 + ib.crit / 2 + ib.speed * 0.6;
  return { raw, bonus, total: Math.round(raw * (1 + bonus)) };
}

export function autoSquad(s: GameState) {
  s.squad = [...s.heroes].sort((a, b) => heroPower(b) - heroPower(a)).slice(0, SQUAD_SIZE).map((h) => h.uid);
}

export function toggleSquad(s: GameState, uid: string): 'added' | 'removed' | 'full' | 'last' {
  const i = s.squad.indexOf(uid);
  if (i >= 0) {
    if (s.squad.length <= 1) return 'last';
    s.squad.splice(i, 1);
    return 'removed';
  }
  if (s.squad.length >= SQUAD_SIZE) return 'full';
  s.squad.push(uid);
  return 'added';
}

// ---------- Уровень игрока ----------
export function playerLevel(rating: number) {
  let idx = 0;
  PLAYER_LEVELS.forEach((l, i) => { if (rating >= l.min) idx = i; });
  const cur = PLAYER_LEVELS[idx];
  const next = PLAYER_LEVELS[idx + 1];
  const progress = next ? (rating - cur.min) / (next.min - cur.min) : 1;
  return { n: idx + 1, name: cur.name, next, progress, toNext: next ? next.min - rating : 0 };
}

// ---------- Награда за лекцию ----------
export function coinsPerHour(s: GameState) {
  const p = perkOf(s);
  return Math.round(IDLE.coinsPerHourBase * Math.pow(IDLE.coinsGrowth, Math.min(s.stage, 51) - 1) * (1 + (p.idle ?? 0) + clanB.income));
}

export function idlePending(s: GameState, now = Date.now()) {
  const hours = Math.max(0, Math.min(IDLE.maxHours, (now - s.idleSince) / 3600_000));
  return {
    hours,
    full: hours >= IDLE.maxHours,
    coins: Math.floor(coinsPerHour(s) * hours),
    scrolls: Math.floor(hours / IDLE.scrollEveryHours),
  };
}

export function claimIdle(s: GameState, now = Date.now()) {
  const p = idlePending(s, now);
  s.coins += p.coins;
  s.scrolls += p.scrolls;
  s.idleSince = now;
  return p;
}

// ---------- Найм ----------
export const hireCostCoins = (s: GameState) => Math.round(HIRE_COST_COINS * (1 - (perkOf(s).hireCost ?? 0)));

function rollRarity(rng = Math.random): Rarity {
  const entries = Object.entries(RARITY_INFO) as [Rarity, { weight: number }][];
  const total = entries.reduce((a, [, v]) => a + v.weight, 0);
  let r = rng() * total;
  for (const [k, v] of entries) { r -= v.weight; if (r <= 0) return k; }
  return 'common';
}

export type HireResult = { def: HeroDef; kind: 'new' | 'star' | 'refund'; inst?: HeroInst; refund?: number };

export function hire(s: GameState, pay: 'scroll' | 'coins'): HireResult | { error: string } {
  if (pay === 'scroll') {
    if (s.scrolls < HIRE_COST_SCROLLS) return { error: 'Нет свитков найма' };
    s.scrolls -= HIRE_COST_SCROLLS;
  } else {
    const c = hireCostCoins(s);
    if (s.coins < c) return { error: `Нужно ${c} профкоинов` };
    s.coins -= c;
  }
  const rarity = rollRarity();
  const pool = HEROES.filter((h) => h.rarity === rarity);
  const def = pool[Math.floor(Math.random() * pool.length)];
  s.stats.hires++;
  const have = s.heroes.find((h) => h.id === def.id);
  if (!have) {
    const inst = { uid: newUid(), id: def.id, level: 1, stars: 1 };
    s.heroes.push(inst);
    if (s.squad.length < SQUAD_SIZE) s.squad.push(inst.uid);
    return { def, kind: 'new', inst };
  }
  if (have.stars < MAX_STARS) { have.stars++; return { def, kind: 'star', inst: have }; }
  const refund = 200;
  s.coins += refund;
  return { def, kind: 'refund', refund };
}

// ---------- Улучшение ----------
export const heroUpgradeCost = (s: GameState, h: HeroInst) =>
  Math.round(upgradeCost(h.level, heroDef(h.id).rarity) * (1 - (perkOf(s).upgradeCost ?? 0)));

export function upgrade(s: GameState, uid: string): { ok: true } | { error: string } {
  const h = s.heroes.find((x) => x.uid === uid);
  if (!h) return { error: 'Нет такого активиста' };
  if (h.level >= MAX_HERO_LEVEL) return { error: 'Максимальный уровень' };
  const c = heroUpgradeCost(s, h);
  if (s.coins < c) return { error: `Нужно ${c} профкоинов` };
  s.coins -= c;
  h.level++;
  return { ok: true };
}

/** Улучшает отряд по кругу, начиная с самого дешёвого, пока хватает монет. */
export function upgradeAll(s: GameState) {
  let n = 0;
  for (let guard = 0; guard < 500; guard++) {
    const cands = squadHeroes(s).filter((h) => h.level < MAX_HERO_LEVEL);
    if (!cands.length) break;
    const h = cands.sort((a, b) => heroUpgradeCost(s, a) - heroUpgradeCost(s, b))[0];
    if (s.coins < heroUpgradeCost(s, h)) break;
    upgrade(s, h.uid);
    n++;
  }
  return n;
}
