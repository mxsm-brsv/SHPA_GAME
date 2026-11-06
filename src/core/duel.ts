// Поединки в правовухе: двое отвечают на одни и те же 7 вопросов, проверяет сервер.
// Больше верных — победа; при равенстве — кто быстрее.
import type { FactionId } from '../config/factions';
import type { CheckResult } from './questions';

export interface DuelSide { answered: number; right: number | null; started?: boolean; done: boolean; ms: number | null }
export interface Duel {
  id: string;
  code: string;
  n: number;
  qids?: string[];
  created: number;
  me: 'a' | 'b' | null;
  my: DuelSide;
  opp: (DuelSide & { name: string; faction: FactionId }) | null;
  result: 'win' | 'loss' | 'draw' | null;
  score: [number, number] | null;
}
export interface DuelOpen { code: string; name: string; faction: FactionId; created: number; right: number | null }
export interface DuelBoardRow { name: string; faction: FactionId; wins: number; played: number }
export interface DuelList { mine: Duel[]; open: DuelOpen[]; board: DuelBoardRow[] }
export interface DuelAnswer extends CheckResult { duel: Duel }

/** Профкоины за поединок (игры баллов не дают). */
export const DUEL_COINS = { win: 150, draw: 60, loss: 30 } as const;
export const DUEL_Q_SECONDS = 20;

/** Ссылка-приглашение: открывает игру сразу на этом поединке. */
export function duelLink(code: string) {
  const bot = import.meta.env.VITE_BOT_USERNAME as string | undefined;
  return bot ? `https://t.me/${bot}?startapp=duel_${code}` : '';
}
