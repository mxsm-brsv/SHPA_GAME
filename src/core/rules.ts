// Общие правила начисления (одинаковы в демо и в клиенте онлайн-режима).
import { DAILY_GAME_RATING_CAP, DAILY_MINIGAME_CAP } from '../config/economy';
import { taskById } from '../config/tasks';
import { mskDay, rollDay, type GameState } from './state';

/** Лимиты: лучший результат дня по источнику, не больше 30, и не больше 100 в сутки в сумме. */
export function grantByCaps(s: GameState, source: string, value: number, perSourceCap = DAILY_MINIGAME_CAP) {
  rollDay(s);
  const already = s.daily.byGame[source] ?? 0;
  const wanted = Math.max(0, Math.min(perSourceCap, Math.round(value)) - already);
  const left = Math.max(0, DAILY_GAME_RATING_CAP - s.daily.game);
  const g = Math.min(wanted, left);
  if (g > 0) {
    s.daily.byGame[source] = already + g;
    s.daily.game += g;
    s.rating += g;
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

