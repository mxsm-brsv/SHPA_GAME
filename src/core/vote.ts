// Голосование «Работа со спонсорами»: ✅ / ❌ по командам, итог = ✅ − ❌. Команды — не профбюро: названия любые,
// участники распределяются по ним случайно, за свою команду голосовать нельзя.
import type { FactionId } from '../config/factions';

export interface VoteTeam { id: string; name: string; faction?: FactionId | null; za: number; protiv: number; size?: number }
export interface VoteState {
  round: number;
  title: string;
  status: 'idle' | 'open' | 'closed';
  current: string | null;      // команда на сцене; null — голосуем за все сразу
  reveal: boolean;             // показать победителя на экране
  teams: VoteTeam[];
  my: Record<string, 1 | -1>;
  myFaction?: FactionId | null;
  /** Моя команда (если участников распределили) и её состав */
  myTeam?: string | null;
  mates?: string[];
  voters: number;
  at: number;
}
export type VoteAction = 'open' | 'close' | 'reveal' | 'hide' | 'reset';

export const VOTE_DEFAULT_TITLE = 'Работа со спонсорами';

/** Команды по умолчанию — шесть с номерами; организаторы переименовывают как нужно. */
export const defaultVoteTeams = () => Array.from({ length: 6 }, (_, i) => ({ id: `t${i + 1}`, name: `Команда ${i + 1}`, faction: null as FactionId | null }));

/** Цвета команд на экране — по порядку. */
export const TEAM_COLORS = ['#ffc83d', '#4fd1a5', '#ff7aa8', '#7ea8ff', '#ff9f5a', '#b78cff', '#5ad1ff', '#d4f06b', '#ff6b6b', '#8be0c0'];
export const teamColor = (teams: { id: string }[], id: string) => TEAM_COLORS[Math.max(0, teams.findIndex((t) => t.id === id)) % TEAM_COLORS.length];
/** Можно ли мне голосовать за команду: не за свою. */
export const isMine = (s: Pick<VoteState, 'myTeam' | 'myFaction'>, t: VoteTeam) => t.id === s.myTeam || (!!t.faction && t.faction === s.myFaction);

export const voteScore = (t: VoteTeam) => t.za - t.protiv;

/** Места: по итогу (за − против), при равенстве — у кого больше «за». */
export function voteRank(teams: VoteTeam[]) {
  return [...teams].sort((a, b) => voteScore(b) - voteScore(a) || b.za - a.za || a.name.localeCompare(b.name, 'ru'));
}

/** Список команд из текста: по строке на команду. Номер команды (t1, t2…) — по порядку строк,
 *  поэтому переименование не сбивает уже сделанное распределение участников. */
export function parseVoteTeams(text: string) {
  const out: { id: string; name: string; faction: FactionId | null }[] = [];
  for (const raw of text.split(/\n+/)) {
    const name = raw.trim().slice(0, 40);
    if (!name || out.length >= 30) continue;
    out.push({ id: `t${out.length + 1}`, name, faction: null });
  }
  return out;
}
