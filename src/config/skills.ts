// Умения отряда. У каждого активиста — своя суперспособность, у каждого класса — общее умение.
// Игрок сам выбирает, какие умения взять в бой: ячеек 3, после каждого босса главы — ещё одна (до 6).
// Умение доступно, если его владелец в отряде (для умения класса — любой активист этого класса), и командир достиг нужного уровня.
// Уровни умений 1–5 качаются только кристаллами (их дают за прохождение этапов).
import type { HeroClass } from './heroes';

export type SkillId =
  | 'rally' | 'heal' | 'shield'
  | 'shout' | 'wall' | 'meme' | 'stories' | 'speech' | 'voice'
  | 'roll' | 'checklist' | 'timeout' | 'budget' | 'volunteers' | 'gather'
  | 'article' | 'appeal' | 'audit' | 'settle' | 'charter' | 'verdict';

export interface SkillDef {
  id: SkillId;
  name: string;
  cls: HeroClass;
  /** id активиста-владельца; для умения класса — null */
  hero: string | null;
  icon: string;
  cd: number;
  /** уровень командира, с которого умение можно взять */
  minLvl: number;
  /** раз за бой (0 — без ограничения) */
  uses?: number;
  text: (lvl: number) => string;
  /** подсказка: против чего особенно хорошо */
  good?: string;
}

/** Числа умений по уровню (1–5). */
export const SK = {
  rally: (l: number) => 0.5 + 0.1 * (l - 1),          // +урон отряда
  heal: (l: number) => 0.25 + 0.05 * (l - 1),         // доля max HP
  shield: (l: number) => 5 + (l - 1),                 // секунд −50% урона
  shout: (l: number) => 4 + (l - 1),                  // ×тап по всем
  wall: (l: number) => 6 + (l - 1),                   // секунд −40% урона врагов
  meme: (l: number) => 2 + 0.5 * (l - 1),             // секунд оглушения
  stories: (l: number) => 6 + (l - 1),                // секунд двойных тапов
  speech: (l: number) => 25 + 5 * (l - 1),            // ×тап по цели
  voice: (l: number) => 12 + 3 * (l - 1),             // ×тап по всем
  roll: (l: number) => 4 + (l - 1),                   // +секунд к таймеру
  checklist: (l: number) => 5 + (l - 1),              // −секунд остальным умениям
  timeout: (l: number) => 4 + 0.5 * (l - 1),          // секунд заморозки врагов
  budget: (l: number) => 0.3 + 0.1 * (l - 1),         // +доля профкоинов
  volunteers: (l: number) => 8 + 2 * (l - 1),         // секунд помощи
  gather: (l: number) => 0.5 + 0.1 * (l - 1),         // доля HP павшим
  article: (l: number) => 0.4 + 0.1 * (l - 1),        // +урон по цели
  appeal: (l: number) => 10 + 2 * (l - 1),            // ×тап + снять щит
  audit: (l: number) => 8 + (l - 1),                  // секунд «ревизии»
  settle: (l: number) => 0.5 + 0.1 * (l - 1),         // доля HP при возвращении
  charter: (l: number) => 0.25 + 0.05 * (l - 1),      // +урон и −урон
  verdict: (l: number) => 0.25 + 0.03 * (l - 1),      // порог добивания
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const SKILLS: SkillDef[] = [
  // общие умения классов
  { id: 'rally', name: 'Митинг', cls: 'agit', hero: null, icon: 'flag', cd: 18, minLvl: 1, text: (l) => `+${pct(SK.rally(l))} к урону отряда на 6 с` },
  { id: 'heal', name: 'Перекличка', cls: 'org', hero: null, icon: 'heart', cd: 16, minLvl: 1, text: (l) => `лечит отряд на ${pct(SK.heal(l))} здоровья` },
  { id: 'shield', name: 'Правовая защита', cls: 'law', hero: null, icon: 'shield', cd: 18, minLvl: 1, text: (l) => `−50% урона по отряду на ${SK.shield(l)} с`, good: 'против ярости босса' },
  // агитаторы
  { id: 'shout', name: 'Громкий призыв', cls: 'agit', hero: 'megaphone', icon: 'bolt', cd: 12, minLvl: 1, text: (l) => `удар по всем врагам: ${SK.shout(l)} тапов`, good: 'против толпы' },
  { id: 'wall', name: 'Плакатная стена', cls: 'agit', hero: 'poster', icon: 'clipboard', cd: 20, minLvl: 2, text: (l) => `враги бьют на 40% слабее ${SK.wall(l)} с` },
  { id: 'meme', name: 'Вирусный мем', cls: 'agit', hero: 'memer', icon: 'sparkle', cd: 22, minLvl: 4, text: (l) => `оглушает врагов на ${SK.meme(l)} с (босса — вдвое меньше)` },
  { id: 'stories', name: 'Сторис-эфир', cls: 'agit', hero: 'stories', icon: 'camera', cd: 18, minLvl: 3, text: (l) => `тапы бьют вдвое сильнее ${SK.stories(l)} с` },
  { id: 'speech', name: 'Пламенная речь', cls: 'agit', hero: 'speaker', icon: 'chat', cd: 20, minLvl: 8, text: (l) => `удар по цели на ${SK.speech(l)} тапов, по щиту — вдвое`, good: 'против щита босса' },
  { id: 'voice', name: 'Голос кампуса', cls: 'agit', hero: 'legend_agit', icon: 'trophy', cd: 26, minLvl: 14, text: (l) => `удар по всем на ${SK.voice(l)} тапов и оглушение 1,5 с` },
  // организаторы
  { id: 'roll', name: 'Список явки', cls: 'org', hero: 'starosta', icon: 'list', cd: 25, minLvl: 1, uses: 2, text: (l) => `+${SK.roll(l)} с к таймеру (2 раза за бой)` },
  { id: 'checklist', name: 'Чек-лист', cls: 'org', hero: 'checklist', icon: 'check', cd: 24, minLvl: 5, text: (l) => `остальные умения готовы на ${SK.checklist(l)} с раньше` },
  { id: 'timeout', name: 'Тайм-аут', cls: 'org', hero: 'timekeeper', icon: 'clock', cd: 28, minLvl: 6, text: (l) => `враги и таймер замирают на ${SK.timeout(l)} с`, good: 'против ярости и призыва' },
  { id: 'budget', name: 'Смета', cls: 'org', hero: 'treasurer', icon: 'coin', cd: 999, minLvl: 3, uses: 1, text: (l) => `+${pct(SK.budget(l))} профкоинов за победу и +2 с к таймеру` },
  { id: 'volunteers', name: 'Волонтёры', cls: 'org', hero: 'volunteer', icon: 'users', cd: 24, minLvl: 9, text: (l) => `двое волонтёров бьют вместе с отрядом ${SK.volunteers(l)} с` },
  { id: 'gather', name: 'Сбор!', cls: 'org', hero: 'legend_org', icon: 'bus', cd: 40, minLvl: 15, text: (l) => `полностью лечит отряд и поднимает павших с ${pct(SK.gather(l))} здоровья` },
  // юристы
  { id: 'article', name: 'Ссылка на статью', cls: 'law', hero: 'reader', icon: 'book', cd: 16, minLvl: 1, text: (l) => `цель получает +${pct(SK.article(l))} урона 8 с`, good: 'против босса' },
  { id: 'appeal', name: 'Апелляция', cls: 'law', hero: 'stipend', icon: 'scales', cd: 14, minLvl: 2, text: (l) => `снимает щит босса и бьёт на ${SK.appeal(l)} тапов`, good: 'против щита (глава 1 и 5)' },
  { id: 'audit', name: 'Ревизия', cls: 'law', hero: 'krk', icon: 'stamp', cd: 22, minLvl: 7, text: (l) => `${SK.audit(l)} с босс не лечится и не зовёт помощников`, good: 'против лечения и призыва (главы 3–5)' },
  { id: 'settle', name: 'Заселение', cls: 'law', hero: 'dorm', icon: 'home', cd: 30, minLvl: 5, text: (l) => `возвращает павшего активиста с ${pct(SK.settle(l))} здоровья` },
  { id: 'charter', name: 'Устав', cls: 'law', hero: 'charter', icon: 'scroll', cd: 26, minLvl: 11, text: (l) => `8 с: враги получают +${pct(SK.charter(l))} урона, отряд — на столько же меньше` },
  { id: 'verdict', name: 'Решение суда', cls: 'law', hero: 'legend_law', icon: 'stamp', cd: 30, minLvl: 16, text: (l) => `добивает врагов ниже ${pct(SK.verdict(l))} здоровья; босс теряет 10%` },
];

export const skillById = (id: string) => SKILLS.find((s) => s.id === id);

/** Цена перехода на уровень L+1 в кристаллах (с 1 на 2 — 3 кристалла, …, с 4 на 5 — 12). */
export const SKILL_UP_COST = [0, 3, 5, 8, 12];
export const SKILL_MAX = 5;

/** Ячейки умений: 3, и +1 за каждого побеждённого босса главы, максимум 6. */
export const loadoutSlots = (stage: number) => Math.min(6, 3 + Math.floor((Math.max(1, stage) - 1) / 10));

/** Уровень командира — сколько этапов пройдено (+1). От него зависят доступные умения. */
export const commanderLevel = (stage: number) => Math.max(1, stage);
