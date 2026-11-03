// Активисты — герои отряда. Правьте имена, классы, редкость и внешность.

export type HeroClass = 'agit' | 'org' | 'law';
export type Rarity = 'common' | 'rare' | 'epic' | 'legend';

export const CLASS_INFO: Record<HeroClass, { name: string; plural: string; beats: HeroClass; color: string; text: string }> = {
  agit: { name: 'Агитатор', plural: 'Агитаторы', beats: 'org', color: '#ff8a5b', text: 'Много урона, мало здоровья' },
  org: { name: 'Организатор', plural: 'Организаторы', beats: 'law', color: '#4fd1a5', text: 'Лечит отряд и бьёт ровно' },
  law: { name: 'Юрист', plural: 'Юристы', beats: 'agit', color: '#7ea8ff', text: 'Держит удар, защищает отряд' },
};

export const RARITY_INFO: Record<Rarity, { name: string; color: string; mult: number; weight: number }> = {
  common: { name: 'Обычный', color: '#9aa3c7', mult: 1, weight: 68 },
  rare: { name: 'Редкий', color: '#4aa8ff', mult: 1.35, weight: 24 },
  epic: { name: 'Эпический', color: '#b26bff', mult: 1.8, weight: 7 },
  legend: { name: 'Легендарный', color: '#ffc83d', mult: 2.4, weight: 1 },
};

/** Преимущество класса над классом, который он «бьёт». */
export const CLASS_ADVANTAGE = 0.25;

export interface HeroDef {
  id: string;
  name: string;
  cls: HeroClass;
  rarity: Rarity;
  /** Внешность для SVG-портрета */
  look: { skin: string; hair: string; hairStyle: 0 | 1 | 2 | 3; top: string; extra?: 'glasses' | 'cap' | 'headset' | 'tie' | 'badge' | 'crown' };
  quote: string;
}

export const HEROES: HeroDef[] = [
  // Агитаторы
  { id: 'megaphone', name: 'Громкоговоритель', cls: 'agit', rarity: 'common', look: { skin: '#f1c7a5', hair: '#3b2a20', hairStyle: 0, top: '#ff7a59', extra: 'headset' }, quote: 'Все на собрание!' },
  { id: 'poster', name: 'Плакатница', cls: 'agit', rarity: 'common', look: { skin: '#f6d2b8', hair: '#c0532d', hairStyle: 2, top: '#ffb347' }, quote: 'Нарисую так, что не пройдёшь мимо' },
  { id: 'memer', name: 'Мем-мейкер', cls: 'agit', rarity: 'rare', look: { skin: '#e8b48f', hair: '#1d1d1d', hairStyle: 1, top: '#ff5fa2', extra: 'cap' }, quote: 'Мемы — тоже агитация' },
  { id: 'stories', name: 'Сторисмейкер', cls: 'agit', rarity: 'rare', look: { skin: '#f3cfb3', hair: '#e2b04a', hairStyle: 3, top: '#ff6b6b' }, quote: 'Снято, смонтировано, выложено' },
  { id: 'speaker', name: 'Спикер выезда', cls: 'agit', rarity: 'epic', look: { skin: '#d9a07a', hair: '#2a1a12', hairStyle: 0, top: '#e8453c', extra: 'tie' }, quote: 'Дайте мне микрофон' },
  { id: 'legend_agit', name: 'Голос кампуса', cls: 'agit', rarity: 'legend', look: { skin: '#f0c9a8', hair: '#7a2e1d', hairStyle: 2, top: '#ff3d2e', extra: 'crown' }, quote: 'Меня слышно в каждом корпусе' },
  // Организаторы
  { id: 'starosta', name: 'Староста', cls: 'org', rarity: 'common', look: { skin: '#f2cdb0', hair: '#4a3020', hairStyle: 2, top: '#3fbf8f' }, quote: 'Списки уже у меня' },
  { id: 'checklist', name: 'Мастер чек-листов', cls: 'org', rarity: 'common', look: { skin: '#e9be9c', hair: '#222222', hairStyle: 1, top: '#2fa67a', extra: 'glasses' }, quote: 'Пункт семь — выполнено' },
  { id: 'timekeeper', name: 'Таймкипер', cls: 'org', rarity: 'rare', look: { skin: '#f5d6bd', hair: '#8a5a2b', hairStyle: 3, top: '#20c997' }, quote: 'Осталось две минуты' },
  { id: 'treasurer', name: 'Казначей', cls: 'org', rarity: 'rare', look: { skin: '#dcaa85', hair: '#3a2416', hairStyle: 0, top: '#1fae6b', extra: 'badge' }, quote: 'Смета сходится до рубля' },
  { id: 'volunteer', name: 'Глава волонтёров', cls: 'org', rarity: 'epic', look: { skin: '#f1c6a1', hair: '#d9a441', hairStyle: 2, top: '#12b886', extra: 'cap' }, quote: 'Нас уже сорок человек' },
  { id: 'legend_org', name: 'Капитан выезда', cls: 'org', rarity: 'legend', look: { skin: '#e3b08a', hair: '#1b1b1b', hairStyle: 1, top: '#0ca678', extra: 'crown' }, quote: 'Автобусы через пять минут' },
  // Юристы
  { id: 'reader', name: 'Знаток 273-ФЗ', cls: 'law', rarity: 'common', look: { skin: '#f4d0b5', hair: '#2b2b2b', hairStyle: 0, top: '#5c7cfa', extra: 'glasses' }, quote: 'Статья 34, часть первая' },
  { id: 'stipend', name: 'Адвокат стипендии', cls: 'law', rarity: 'common', look: { skin: '#e6b693', hair: '#6b3e1f', hairStyle: 2, top: '#4c6ef5' }, quote: 'Стипендию снимут только по закону' },
  { id: 'krk', name: 'Ревизор КРК', cls: 'law', rarity: 'rare', look: { skin: '#f0cbab', hair: '#3d3d3d', hairStyle: 1, top: '#3b5bdb', extra: 'tie' }, quote: 'Покажите протокол' },
  { id: 'dorm', name: 'Защитник общаги', cls: 'law', rarity: 'rare', look: { skin: '#d8a27c', hair: '#1f140d', hairStyle: 3, top: '#4263eb' }, quote: 'Шесть метров на человека' },
  { id: 'charter', name: 'Хранитель Устава', cls: 'law', rarity: 'epic', look: { skin: '#f3d1b6', hair: '#a0a0a0', hairStyle: 0, top: '#364fc7', extra: 'glasses' }, quote: 'Согласно Уставу Профсоюза…' },
  { id: 'legend_law', name: 'Правовед СКС', cls: 'law', rarity: 'legend', look: { skin: '#eac09e', hair: '#2a1b10', hairStyle: 2, top: '#1c3faa', extra: 'crown' }, quote: 'Норма есть на всё' },
];

export const heroDef = (id: string): HeroDef => HEROES.find((h) => h.id === id) ?? HEROES[0];

/** Базовые характеристики уровня 1 по классу. */
export const CLASS_BASE: Record<HeroClass, { atk: number; hp: number }> = {
  agit: { atk: 26, hp: 110 },
  org: { atk: 19, hp: 135 },
  law: { atk: 15, hp: 175 },
};

/** Стартовый отряд нового игрока. */
export const STARTER_HEROES = ['megaphone', 'starosta', 'reader'];
