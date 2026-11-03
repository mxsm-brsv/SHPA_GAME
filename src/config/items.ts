// Снаряжение командира: 4 ячейки, предметы усиливают весь отряд. Выпадают за этапы (босс — всегда), лишнее продаётся.
export type Slot = 'badge' | 'notebook' | 'thermos' | 'hoodie';
export type ItemRarity = 'common' | 'rare' | 'epic' | 'legend';
export type ItemStat = 'atk' | 'hp' | 'crit' | 'speed' | 'tap' | 'cdr' | 'time' | 'coins' | 'crystal';

export interface ItemInst { uid: string; slot: Slot; rarity: ItemRarity; stats: Partial<Record<ItemStat, number>>; name: string; stage: number }

export const SLOTS: { id: Slot; name: string; icon: string; stats: ItemStat[] }[] = [
  { id: 'badge', name: 'Значок', icon: 'star', stats: ['atk', 'crit', 'tap'] },
  { id: 'notebook', name: 'Ежедневник', icon: 'book', stats: ['cdr', 'time', 'crystal'] },
  { id: 'thermos', name: 'Термос', icon: 'cup', stats: ['hp', 'speed', 'cdr'] },
  { id: 'hoodie', name: 'Худи', icon: 'shield', stats: ['hp', 'atk', 'coins'] },
];

export const ITEM_RARITY: Record<ItemRarity, { name: string; color: string; mult: number; stats: number; sell: number }> = {
  common: { name: 'Обычный', color: '#9aa3c7', mult: 1, stats: 1, sell: 80 },
  rare: { name: 'Редкий', color: '#4aa8ff', mult: 1.6, stats: 2, sell: 200 },
  epic: { name: 'Эпический', color: '#b26bff', mult: 2.4, stats: 2, sell: 500 },
  legend: { name: 'Легендарный', color: '#ffc83d', mult: 3.4, stats: 3, sell: 1200 },
};

/** Базовые значения характеристик (обычный предмет, начало кампании). */
export const STAT_BASE: Record<ItemStat, { v: number; name: string; unit: '%' | 'с' }> = {
  atk: { v: 0.04, name: 'атака', unit: '%' },
  hp: { v: 0.05, name: 'здоровье', unit: '%' },
  crit: { v: 0.02, name: 'шанс крита', unit: '%' },
  speed: { v: 0.03, name: 'скорость атаки', unit: '%' },
  tap: { v: 0.08, name: 'сила тапа', unit: '%' },
  cdr: { v: 0.04, name: 'перезарядка умений', unit: '%' },
  time: { v: 1, name: 'к таймеру боя', unit: 'с' },
  coins: { v: 0.06, name: 'профкоины за бой', unit: '%' },
  crystal: { v: 0.05, name: 'шанс лишнего кристалла', unit: '%' },
};

/** Потолки суммарных бонусов от снаряжения, чтобы не ломать баланс. */
export const STAT_CAP: Record<ItemStat, number> = { atk: 0.6, hp: 0.7, crit: 0.25, speed: 0.4, tap: 1, cdr: 0.35, time: 10, coins: 1, crystal: 0.5 };

const NAMES: Record<Slot, string[]> = {
  badge: ['Значок новичка', 'Значок активиста', 'Значок «Лидер»', 'Золотой значок СКС'],
  notebook: ['Тетрадь в клетку', 'Ежедневник профорга', 'Планер председателя', 'Блокнот «Ты — лидер»'],
  thermos: ['Кружка с чаем', 'Термос ППО', 'Термос выездной', 'Термос легенды выезда'],
  hoodie: ['Футболка ППО', 'Худи ШПА', 'Худи «Студлидер»', 'Худи Профсоюза образования'],
};
const RIDX: Record<ItemRarity, number> = { common: 0, rare: 1, epic: 2, legend: 3 };

export const INVENTORY_MAX = 24;

/** Шансы выпадения. Первое прохождение этапа — 30%, босс — всегда (не ниже редкого), повтор — 10%. */
export function dropRoll(stage: number, first: boolean, boss: boolean, rng = Math.random): ItemInst | null {
  if (!boss && rng() > (first ? 0.3 : 0.1)) return null;
  const w: [ItemRarity, number][] = boss ? [['rare', 60], ['epic', 32], ['legend', 8]] : first ? [['common', 60], ['rare', 30], ['epic', 9], ['legend', 1]] : [['common', 80], ['rare', 20]];
  let r = rng() * w.reduce((a, [, x]) => a + x, 0);
  let rarity: ItemRarity = w[0][0];
  for (const [k, x] of w) { r -= x; if (r <= 0) { rarity = k; break; } }
  const slot = SLOTS[Math.floor(rng() * SLOTS.length)];
  const R = ITEM_RARITY[rarity];
  const scale = 1 + 0.6 * Math.min(1, stage / 50);
  const pool = [...slot.stats];
  const stats: Partial<Record<ItemStat, number>> = {};
  for (let i = 0; i < R.stats && pool.length; i++) {
    const st = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const b = STAT_BASE[st];
    const v = b.v * R.mult * scale * (0.85 + rng() * 0.3);
    stats[st] = b.unit === 'с' ? Math.max(1, Math.round(v)) : Math.round(v * 1000) / 1000;
  }
  return { uid: `i${Date.now().toString(36)}${Math.floor(rng() * 1e6).toString(36)}`, slot: slot.id, rarity, stats, name: NAMES[slot.id][RIDX[rarity]], stage };
}

export const itemSellPrice = (it: ItemInst) => Math.round(ITEM_RARITY[it.rarity].sell * (1 + it.stage / 20));

export function statText(st: ItemStat, v: number) {
  const b = STAT_BASE[st];
  return b.unit === 'с' ? `+${v} с ${b.name}` : st === 'cdr' ? `−${Math.round(v * 100)}% ${b.name}` : `+${Math.round(v * 1000) / 10}% ${b.name}`;
}
