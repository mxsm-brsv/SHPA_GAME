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
  maxUpgrade: 15,
};

export type UpgradeId = 'tap' | 'energy' | 'regen';

export const UPGRADES: { id: UpgradeId; name: string; icon: string; text: (lvl: number) => string; cost: (lvl: number) => number }[] = [
  { id: 'tap', name: 'Сила тапа', icon: 'bolt', text: (l) => `+${Math.round(l * CLICKER.tapPerLvl * 100)}% профкоинов за тап`, cost: (l) => Math.round(200 * Math.pow(1.6, l)) },
  { id: 'energy', name: 'Выносливость', icon: 'heart', text: (l) => `+${l * CLICKER.energyPerLvl} к запасу энергии`, cost: (l) => Math.round(300 * Math.pow(1.7, l)) },
  { id: 'regen', name: 'Кофе-брейк', icon: 'cup', text: (l) => `энергия восстанавливается на ${Math.round(l * CLICKER.regenPerLvl * 100)}% быстрее`, cost: (l) => Math.round(400 * Math.pow(1.8, l)) },
];

/** Звания активиста по личному вкладу в ПБ (опыт зданиям). */
export const CONTRIB_TITLES = [
  { min: 0, name: 'Новичок' },
  { min: 300, name: 'Помощник' },
  { min: 1000, name: 'Опора ПБ' },
  { min: 2500, name: 'Мотор ПБ' },
  { min: 5000, name: 'Сердце ПБ' },
];
export const contribTitle = (xp: number) => [...CONTRIB_TITLES].reverse().find((t) => xp >= t.min)!.name;
