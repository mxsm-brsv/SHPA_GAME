// Кампания: главы, этапы, враги и боссы. Сила врагов растёт по формуле ниже.
import type { HeroClass } from './heroes';

export interface EnemyDef { name: string; cls: HeroClass; icon: 'cloud' | 'paper' | 'clock' | 'stamp' | 'phone' | 'bed' | 'bus' | 'boss' }

export interface Chapter {
  n: number;
  name: string;
  sky: [string, string, string]; // цвета фона боя
  enemies: EnemyDef[];
  boss: EnemyDef & { title: string };
}

export const STAGES_PER_CHAPTER = 10;

export const CHAPTERS: Chapter[] = [
  { n: 1, name: 'Общага', sky: ['#1b1d4f', '#3b3f8f', '#7d6bd1'],
    enemies: [
      { name: 'Будильник', cls: 'agit', icon: 'clock' },
      { name: 'Прокрастинация', cls: 'org', icon: 'bed' },
      { name: 'Шумный сосед', cls: 'law', icon: 'phone' },
    ],
    boss: { name: 'Комендант', title: 'Босс главы', cls: 'law', icon: 'boss' } },
  { n: 2, name: 'Сессия', sky: ['#24123d', '#5a2a6e', '#c0577a'],
    enemies: [
      { name: 'Хвост', cls: 'agit', icon: 'paper' },
      { name: 'Недосып', cls: 'org', icon: 'bed' },
      { name: 'Шпаргалка', cls: 'law', icon: 'paper' },
    ],
    boss: { name: 'Дедлайн', title: 'Босс главы', cls: 'agit', icon: 'boss' } },
  { n: 3, name: 'Профком', sky: ['#0f2a3d', '#1f5a70', '#3fa0a8'],
    enemies: [
      { name: 'Бюрократ', cls: 'law', icon: 'stamp' },
      { name: 'Потерянная справка', cls: 'org', icon: 'paper' },
      { name: 'Спам-рассылка', cls: 'agit', icon: 'phone' },
    ],
    boss: { name: 'Годовой отчёт', title: 'Босс главы', cls: 'org', icon: 'boss' } },
  { n: 4, name: 'Выезд', sky: ['#1d2b17', '#3f6b2f', '#d9a441'],
    enemies: [
      { name: 'Опоздавший автобус', cls: 'org', icon: 'bus' },
      { name: 'Нет Wi-Fi', cls: 'agit', icon: 'phone' },
      { name: 'Холодный душ', cls: 'law', icon: 'cloud' },
    ],
    boss: { name: 'Ревизия КРК', title: 'Босс главы', cls: 'law', icon: 'boss' } },
  { n: 5, name: 'Всероссийский уровень', sky: ['#2a1010', '#6b1f1f', '#e0603a'],
    enemies: [
      { name: 'Строгое жюри', cls: 'law', icon: 'stamp' },
      { name: 'Конкурент-ПБ', cls: 'agit', icon: 'phone' },
      { name: 'Бессонная ночь', cls: 'org', icon: 'clock' },
    ],
    boss: { name: 'Финал «Студлидера»', title: 'Финальный босс', cls: 'agit', icon: 'boss' } },
];

export const MAX_STAGE = CHAPTERS.length * STAGES_PER_CHAPTER;

export const chapterOf = (stage: number): Chapter =>
  CHAPTERS[Math.min(CHAPTERS.length - 1, Math.floor((stage - 1) / STAGES_PER_CHAPTER))];

export const stageInChapter = (stage: number): number => ((stage - 1) % STAGES_PER_CHAPTER) + 1;

export const isBossStage = (stage: number): boolean => stageInChapter(stage) === STAGES_PER_CHAPTER;

/** Сила врагов этапа (сумма): рост ~10,5% за этап, босс ×1,2 (и сам бой с боссом длиннее и опаснее). */
export function stagePower(stage: number): number {
  const base = 330 * Math.pow(1.105, stage - 1);
  return Math.round(base * (isBossStage(stage) ? 1.2 : 1));
}

/** Награда за первое прохождение этапа. Кристаллы — только на улучшение умений. */
export function stageReward(stage: number) {
  const boss = isBossStage(stage);
  return {
    coins: Math.round(120 * Math.pow(1.13, stage - 1) * (boss ? 3 : 1)),
    scrolls: boss ? 2 : stage % 3 === 0 ? 1 : 0,
    rating: boss ? 10 : 2,
    crystals: boss ? 5 : stageInChapter(stage) === 5 ? 2 : 1,
  };
}

/** Механика босса по главе: щит, ярость, призыв помощников, лечение; финальный — всё сразу. */
export type BossMech = 'shield' | 'enrage' | 'summon' | 'heal' | 'final';
export const BOSS_MECH: BossMech[] = ['shield', 'enrage', 'summon', 'heal', 'final'];
export const BOSS_TIP: Record<BossMech, string> = {
  shield: 'Каждые 11 с ставит щит — снимай «Апелляцией» или бей «Пламенной речью»',
  enrage: 'На половине здоровья впадает в ярость — держи «Правовую защиту», «Плакатную стену» или «Тайм-аут»',
  summon: 'Каждые 12 с зовёт помощников — «Ревизия» запрещает, удары по всем их сносят',
  heal: 'Каждые 9 с лечится — «Ревизия» запрещает, «Ссылка на статью» ускоряет',
  final: 'Щит, лечение и ярость сразу — бери «Апелляцию», «Ревизию» и защиту',
};
export const bossMechOf = (stage: number): BossMech => BOSS_MECH[Math.min(BOSS_MECH.length - 1, chapterOf(stage).n - 1)];

/** Состав этапа: сколько волн и врагов. Обычный этап — 4–7 врагов, с 4-го этапа главы — две волны, каждый 10-й — босс. */
export function stagePlan(stage: number) {
  const i = stageInChapter(stage);
  if (isBossStage(stage)) return { waves: [5, 3], boss: true, time: 60 };
  const n = Math.min(7, 4 + Math.floor(i / 3));
  return i >= 4 ? { waves: [n, n], boss: false, time: 50 } : { waves: [n], boss: false, time: 35 };
}

export const stageLabel = (stage: number) => {
  const ch = chapterOf(stage);
  return `Глава ${ch.n} «${ch.name}» · этап ${ch.n}-${stageInChapter(stage)}`;
};
