// Голосование «Работа со спонсорами»: за / против по командам, итог = за − против.
import { PLAYABLE_FACTIONS, type FactionId } from '../config/factions';

export interface VoteTeam { id: string; name: string; faction?: FactionId | null; za: number; protiv: number }
export interface VoteState {
  round: number;
  title: string;
  status: 'idle' | 'open' | 'closed';
  current: string | null;      // команда на сцене; null — голосуем за все сразу
  reveal: boolean;             // показать победителя на экране
  teams: VoteTeam[];
  my: Record<string, 1 | -1>;
  myFaction?: FactionId | null;
  voters: number;
  at: number;
}
export type VoteAction = 'open' | 'close' | 'reveal' | 'hide' | 'reset';

export const VOTE_DEFAULT_TITLE = 'Работа со спонсорами';

/** Команды по умолчанию — 10 профбюро. */
export const defaultVoteTeams = () => PLAYABLE_FACTIONS.map((f) => ({ id: f.id, name: f.short, faction: f.id as FactionId }));

export const voteScore = (t: VoteTeam) => t.za - t.protiv;

/** Места: по итогу (за − против), при равенстве — у кого больше «за». */
export function voteRank(teams: VoteTeam[]) {
  return [...teams].sort((a, b) => voteScore(b) - voteScore(a) || b.za - a.za || a.name.localeCompare(b.name, 'ru'));
}

/** Список команд из текста: по строке на команду; строка с названием профбюро привязывается к нему. */
export function parseVoteTeams(text: string) {
  const out: { id: string; name: string; faction: FactionId | null }[] = [];
  for (const raw of text.split(/\n+/)) {
    const name = raw.trim().slice(0, 40);
    if (!name) continue;
    const f = PLAYABLE_FACTIONS.find((x) => x.short.toLowerCase() === name.toLowerCase());
    const id = f ? f.id : `t${out.length + 1}`;
    if (out.some((x) => x.id === id)) continue;
    out.push({ id, name, faction: f ? (f.id as FactionId) : null });
  }
  return out;
}
