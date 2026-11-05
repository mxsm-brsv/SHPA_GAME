// Экономика: уровни игрока, лимиты рейтинга, цены, награды. Все числа правятся здесь.
import type { Rarity } from './heroes';

/** Уровни игрока по рейтингу (из концепции). */
export const PLAYER_LEVELS = [
  { name: 'Первокурсник', min: 0 },
  { name: 'Профорг группы', min: 100 },
  { name: 'Член профбюро', min: 300 },
  { name: 'Зам. председателя профбюро', min: 600 },
  { name: 'Председатель профбюро', min: 1000 },
  { name: 'Член профкома', min: 1500 },
  { name: 'Легенда ППО', min: 2500 },
];

// Баллы (рейтинг) — только за образовалку и задания. Мини-игры, кампания и стычки дают профкоины.
/** Сколько профкоинов за одно «очко результата» мини-игры (результат дня 0–30 → до 300 профкоинов). */
export const GAME_COINS_PER_POINT = 10;
/** Бонус за лучший результат дня в одной игре — не больше. */
export const DAILY_MINIGAME_COINS = 300;
/** Все бонусы мини-игр и кампании за сутки — не больше. */
export const DAILY_GAME_COINS = 1500;
/** Победа в стычке на карте. */
export const SKIRMISH_WIN_COINS = 200;
/** @deprecated оставлено для старых подсказок: баллов от игр больше нет */
export const DAILY_GAME_RATING_CAP = 0;

/** Награда за лекцию (idle). */
export const IDLE = {
  maxHours: 8,
  /** профкоинов в час на этапе 1; растёт с этапом */
  coinsPerHourBase: 160,
  coinsGrowth: 1.09,
  /** один свиток найма за столько часов */
  scrollEveryHours: 2,
};

export const HIRE_COST_COINS = 300;
export const HIRE_COST_SCROLLS = 1;

/** Цена улучшения активиста с уровня L на L+1. */
export function upgradeCost(level: number, rarity: Rarity): number {
  const r = { common: 1, rare: 1.3, epic: 1.7, legend: 2.2 }[rarity];
  return Math.round(40 * Math.pow(level, 1.45) * r);
}

export const MAX_HERO_LEVEL = 60;
export const MAX_STARS = 5;
/** Отряд небольшой — 4 активиста, чтобы все их умения помещались в ячейки. */
export const SQUAD_SIZE = 4;

/** Ежедневный подарок по дням подряд. */
export const DAILY_GIFT = [
  { coins: 300, scrolls: 0 },
  { coins: 400, scrolls: 1 },
  { coins: 500, scrolls: 0 },
  { coins: 600, scrolls: 1 },
  { coins: 800, scrolls: 2 },
];
/** «Зайти в игру» — 10 рейтинга в день (задание из концепции). */
export const DAILY_LOGIN_RATING = 10;

// «Кофе с собой» убран: он стоил 60% от того, что давал (1,2 ч дохода → 2 ч), и его можно было крутить бесконечно.
// Профкоины больше не превращаются в профкоины: их тратят на отряд, улучшения кликера и вклад в здания ПБ.
export interface ShopItem { id: string; name: string; text: string; price: number; give: { scrolls?: number } }
export const SHOP: ShopItem[] = [
  { id: 'scroll1', name: 'Свиток найма', text: 'Нанять одного активиста', price: 300, give: { scrolls: 1 } },
  { id: 'scroll10', name: '10 свитков', text: 'Десять наймов со скидкой', price: 2600, give: { scrolls: 10 } },
];
