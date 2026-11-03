// Логика кликера: энергия, тап, улучшения, бусты, вложение профкоинов в здания ПБ.
import { CLICKER, UPGRADES, type UpgradeId } from '../config/clicker';
import { CLAN, type BuildingId } from '../config/clan';
import { clanNow, coinsPerHour } from './logic';
import { mskDay, type GameState } from './state';

export const maxEnergy = (s: GameState) => CLICKER.baseEnergy + s.clicker.lvl.energy * CLICKER.energyPerLvl + clanNow().energy;
export const regenMs = (s: GameState) => (1000 * CLICKER.regenSeconds) / (1 + s.clicker.lvl.regen * CLICKER.regenPerLvl);

/** Досчитывает восстановленную энергию к моменту now. */
export function syncEnergy(s: GameState, now = Date.now()) {
  const c = s.clicker;
  const max = maxEnergy(s);
  if (c.energy >= max) { c.energy = Math.min(c.energy, max); c.energyAt = now; return; }
  const step = regenMs(s);
  const add = Math.floor((now - c.energyAt) / step);
  if (add > 0) {
    c.energy = Math.min(max, c.energy + add);
    c.energyAt = c.energy >= max ? now : c.energyAt + add * step;
  }
}

/** Профкоинов за обычный тап (без комбо). */
export const tapValue = (s: GameState) => Math.max(1, Math.round((coinsPerHour(s) / CLICKER.tapDiv) * (1 + s.clicker.lvl.tap * CLICKER.tapPerLvl)));
export const goldenChance = () => CLICKER.goldenBase + clanNow().golden;
export const comboMult = (combo: number) => Math.min(CLICKER.comboMax, 1 + Math.floor(combo / 10) * 0.1);

const recent: number[] = [];

export type TapResult = { ok: true; coins: number; xp: number; golden: boolean; combo: number; mult: number } | { ok: false; reason: 'energy' | 'rate' };

export function tap(s: GameState, now = Date.now(), rnd = Math.random): TapResult {
  while (recent.length && now - recent[0] > 1000) recent.shift();
  if (recent.length >= CLICKER.maxTapsPerSecond) return { ok: false, reason: 'rate' };
  syncEnergy(s, now);
  const c = s.clicker;
  if (c.energy < 1) return { ok: false, reason: 'energy' };
  recent.push(now);
  if (c.energy >= maxEnergy(s)) c.energyAt = now; // отсчёт восстановления — с первого тапа после полного запаса
  c.energy -= 1;
  c.combo = now - c.lastTapAt < CLICKER.comboGapMs ? c.combo + 1 : 0;
  c.lastTapAt = now;
  const mult = comboMult(c.combo);
  const golden = rnd() < goldenChance();
  const coins = Math.round(tapValue(s) * mult * (golden ? CLICKER.goldenMult : 1));
  const xp = golden ? CLICKER.goldenXp : 1;
  s.coins += coins;
  c.taps++;
  addContribution(s, xp);
  return { ok: true, coins, xp, golden, combo: c.combo, mult };
}

export function addContribution(s: GameState, xp: number) {
  if (xp <= 0) return;
  s.clicker.contributed += xp;
  s.clicker.pendingXp += xp;
}

export const upgradeLevel = (s: GameState, id: UpgradeId) => s.clicker.lvl[id];
export const upgradeCostOf = (s: GameState, id: UpgradeId) => UPGRADES.find((u) => u.id === id)!.cost(s.clicker.lvl[id]);

export function buyUpgrade(s: GameState, id: UpgradeId): { ok: true } | { error: string } {
  const lvl = s.clicker.lvl[id];
  if (lvl >= CLICKER.maxUpgrade) return { error: 'Максимальный уровень' };
  const cost = upgradeCostOf(s, id);
  if (s.coins < cost) return { error: `Нужно ${cost} профкоинов` };
  syncEnergy(s);
  s.coins -= cost;
  s.clicker.lvl[id] = lvl + 1;
  return { ok: true };
}

export function boostsLeft(s: GameState) {
  const d = mskDay();
  return s.clicker.boosts.day === d ? Math.max(0, CLICKER.boostsPerDay - s.clicker.boosts.used) : CLICKER.boostsPerDay;
}

export function useBoost(s: GameState): boolean {
  const d = mskDay();
  if (s.clicker.boosts.day !== d) s.clicker.boosts = { day: d, used: 0 };
  if (s.clicker.boosts.used >= CLICKER.boostsPerDay) return false;
  s.clicker.boosts.used++;
  s.clicker.energy = maxEnergy(s);
  s.clicker.energyAt = Date.now();
  return true;
}

/** Вложить профкоины в здание ПБ: 25 монет = 1 опыт. Возвращает опыт. */
export function donate(s: GameState, coins: number, building?: BuildingId) {
  const xp = Math.floor(Math.min(coins, s.coins) / CLAN.coinsPerXp);
  if (xp <= 0) return 0;
  if (building) s.clicker.building = building;
  s.coins -= xp * CLAN.coinsPerXp;
  addContribution(s, xp);
  return xp;
}
