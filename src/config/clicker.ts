// Кликер «Работа в профбюро»: тапаешь по ратуше — профкоины тебе и опыт зданию ПБ.
// Энергия ограничивает фарм: запас ~100 тапов, восстановление ~15 в минуту.
export const CLICKER = {
  baseEnergy: 100,
  energyPerLvl: 25,
  /** секунд на 1 энергии без улучшений */
  regenSeconds: 4,
  regenPerLvl: 0.2,
  /** профкоинов за тап: доход в час / 80 (80 тапов ≈ час «награды за лекцию») */
  tapDiv: 80,
  tapPerLvl: 0.5,
  goldenBase: 0.03,
  goldenMult: 10,
  goldenXp: 5,
  /** комбо: тапы с паузой меньше 0,7 с; +10% за каждые 10 тапов, максимум ×2 */
  comboGapMs: 700,
  comboMax: 2,
  /** больше 12 тапов в секунду не засчитываются */
  maxTapsPerSecond: 12,
  /** бесплатный полный запас энергии, раз в день */
  boostsPerDay: 3,
  /** 4 ступени по 15 уровней: у каждой ступени своё название и цены */
  maxUpgrade: 60,
  tierSize: 15,
};

export type UpgradeId = 'tap' | 'energy' | 'regen';

/** Цена уровня: ступень t (по 15 уровней) стартует вдвое дороже предыдущей стартовой и дорожает быстрее. */
const tierCost = (base: number, g: number) => (l: number) => {
  const t = Math.floor(l / CLICKER.tierSize), k = l % CLICKER.tierSize;
  return Math.round(base * Math.pow(2, t) * Math.pow(g + 0.15 * t, k));
};

export const UPGRADES: { id: UpgradeId; name: string; tiers: string[]; icon: string; text: (lvl: number) => string; cost: (lvl: number) => number }[] = [
  { id: 'tap', name: 'Сила тапа', tiers: ['Сила тапа', 'Двойной клик', 'Пальцы-молнии', 'Рука профорга'], icon: 'bolt', text: (l) => `+${Math.round(l * CLICKER.tapPerLvl * 100)}% профкоинов за тап`, cost: tierCost(200, 1.6) },
  { id: 'energy', name: 'Выносливость', tiers: ['Выносливость', 'Второе дыхание', 'Железный график', 'Энергия ШПА'], icon: 'heart', text: (l) => `+${l * CLICKER.energyPerLvl} к запасу энергии`, cost: tierCost(300, 1.7) },
  { id: 'regen', name: 'Кофе-брейк', tiers: ['Кофе-брейк', 'Энергетик', 'Тихий час', 'Режим «Выезд»'], icon: 'cup', text: (l) => `энергия восстанавливается на ${Math.round(l * CLICKER.regenPerLvl * 100)}% быстрее`, cost: tierCost(400, 1.8) },
];
/** Название и номер ступени для уровня (уровень 0–14 — первая ступень и т. д.). */
export function upgradeTier(u: { tiers: string[] }, lvl: number) {
  const t = Math.min(u.tiers.length - 1, Math.floor(lvl / CLICKER.tierSize));
  return { t, name: u.tiers[t], inTier: lvl - t * CLICKER.tierSize };
}

/** Звания активиста по личному вкладу в ПБ (опыт зданиям). */
export const CONTRIB_TITLES = [
  { min: 0, name: 'Новичок' },
  { min: 300, name: 'Помощник' },
  { min: 1000, name: 'Опора ПБ' },
  { min: 2500, name: 'Мотор ПБ' },
  { min: 5000, name: 'Сердце ПБ' },
];
export const contribTitle = (xp: number) => [...CONTRIB_TITLES].reverse().find((t) => xp >= t.min)!.name;
