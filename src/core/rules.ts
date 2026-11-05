// Общие правила начисления (одинаковы в демо и в клиенте онлайн-режима).
import { DAILY_GAME_COINS, DAILY_MINIGAME_COINS, GAME_COINS_PER_POINT } from '../config/economy';
import { taskById } from '../config/tasks';
import { mskDay, rollDay, type GameState } from './state';

/** Бонус профкоинов за игру: лучший результат дня (value 0–30 → до 300), за все игры — до 1500 в сутки.
 *  Баллы (рейтинг) игры не дают — только задания и образовалка. */
export function grantGameCoins(s: GameState, source: string, value: number, perSourceCap = DAILY_MINIGAME_COINS) {
  rollDay(s);
  const already = s.daily.byGame[source] ?? 0;
  const wanted = Math.max(0, Math.min(perSourceCap, Math.round(value * GAME_COINS_PER_POINT)) - already);
  const left = Math.max(0, DAILY_GAME_COINS - s.daily.game);
  const g = Math.min(wanted, left);
  if (g > 0) {
    s.daily.byGame[source] = already + g;
    s.daily.game += g;
    s.coins += g;
  }
  return g;
}

/** Можно ли ещё выполнить задание (с учётом лимита). */
export function taskAvailable(s: GameState, task: string): boolean {
  const t = taskById(task);
  if (!t) return false;
  const key = t.limit === 'daily' ? `${task}@${mskDay()}` : task;
  const done = s.tasks.done[key] ?? 0;
  const max = t.limit === 'once' || t.limit === 'daily' ? 1 : t.limit;
  return done < max && !(s.tasks.pending[task] ?? 0);
}

export function markDone(s: GameState, task: string, n = 1) {
  const t = taskById(task);
  const key = t?.limit === 'daily' ? `${task}@${mskDay()}` : task;
  s.tasks.done[key] = (s.tasks.done[key] ?? 0) + n;
}

