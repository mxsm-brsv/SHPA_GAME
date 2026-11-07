// Колесо профкома: статистика игрока (в его сохранении) и общий итог казино для разоблачения.
/** pts — сколько баллов (на мерч) проиграно в колесе, ptsSpins — сколько раз ставил баллы. */
export interface CasinoState { bet: number; won: number; spins: number; near: number; streak: number; need: number; last: number; best: number; pts?: number; ptsSpins?: number; lucky?: number; luckyWon?: number; ptsWon?: number }
export const newCasino = (): CasinoState => ({ bet: 0, won: 0, spins: 0, near: 0, streak: 0, need: 4, last: -1, best: 0, pts: 0, ptsSpins: 0 });
/** Общий итог по всем участникам (считает сервер по сохранениям). */
export interface CasinoStats { players: number; spins: number; bet: number; won: number; near: number; points?: number; pointsPlayers?: number; pointsSpins?: number; lucky?: number; pointsLucky?: number }
