// Расчёт экономики баллов: сколько набирает участник за 5–8 ноября и хватит ли этого на мерч.
// Три профиля: «минимум» (ходит на блоки, почти ничего не сдаёт), «активный» (типичный активист), «максимум» (делает всё).
// Числа — сколько раз выполняет задание за выезд. Меняете задания — поправьте здесь, панель «Мерч» пересчитает сама.
import { TASKS } from './tasks';
import { DAILY_GAME_RATING_CAP } from './economy';

type Row = [min: number, active: number, max: number];

export const PLAN: Record<string, Row> = {
  // до выезда
  profile: [1, 1, 1], tg_channel: [1, 1, 1], vk_group: [1, 1, 1], intro_quiz: [5, 8, 10], daily_login: [4, 4, 4], story: [0, 1, 1], invite: [0, 1, 1],
  // 7 ноября
  bingo: [0, 1, 2], grant: [0, 1, 1], grant_best: [0, 0, 1], speech: [0, 1, 1], speech_best: [0, 0, 1], duel: [0, 2, 5], team: [0, 0.5, 1],
  brand: [0, 1, 1], party_game: [0, 0.5, 2], party_contest: [0, 0.5, 3],
  // 8 ноября
  sponsor: [0, 1, 1], sponsor_best: [0, 0, 1], reflection: [1, 1, 1], press: [0, 1, 1],
  // сквозные (квизы — число верных ответов; знакомства — число знакомств)
  lecture: [8, 10, 12], speed_qr: [0, 0.5, 2], thought: [0, 4, 8], egg: [0, 4, 10], egg_gold: [0, 0.5, 2], docs_quiz: [2, 8, 12], case_day: [0, 3, 4],
  meet: [10, 30, 60], caches: [0, 3, 10], cache_gold: [0, 0, 1], help: [0, 1, 3], photo: [0, 2, 4],
  // творческие
  likes: [0, 3, 4], vk_comments: [0, 3, 4], meme: [0, 2, 4], history: [0, 2, 4], morning: [0, 1, 2], letter: [0, 0.6, 1], monument: [0, 0.5, 1],
  new_contest: [0, 0.5, 1], new_merch: [0, 0.4, 1], stickers: [0, 0.3, 1], fashion: [0, 0.5, 1], edit: [0, 0.4, 1], photohunt: [0, 0.7, 1],
  cheese: [0, 0.8, 1], steps: [0, 0.4, 1], color_date: [0, 0.5, 1],
};

/** Баллы от самой игры (мини-игры, кампания, стычки) за 4 дня; лимит — DAILY_GAME_RATING_CAP в сутки. */
export const GAME_PLAN: Row = [40, 240, 4 * DAILY_GAME_RATING_CAP];

/** Средняя цена одного выполнения: знакомство из своего ПБ — 5, из другого — 10; все 10 тайников — ещё +50. */
const unit = (id: string, amount: number, k: 0 | 1 | 2) => (id === 'meet' ? [5, 7, 8][k] : id === 'caches' && k === 2 ? amount + 5 : amount);

export function economyPlan() {
  const sum = (k: 0 | 1 | 2) => Math.round(TASKS.reduce((a, t) => a + (PLAN[t.id]?.[k] ?? 0) * unit(t.id, t.amount, k), 0) + GAME_PLAN[k]);
  return { min: sum(0), active: sum(1), max: sum(2) };
}

/** Таблица для README и проверки: задание, баллы, ожидаемо у активного. */
export function economyTable() {
  return TASKS.map((t) => ({ id: t.id, title: t.title, amount: t.amount, min: PLAN[t.id]?.[0] ?? 0, active: PLAN[t.id]?.[1] ?? 0, max: PLAN[t.id]?.[2] ?? 0, activePoints: Math.round((PLAN[t.id]?.[1] ?? 0) * unit(t.id, t.amount, 1)) }));
}
