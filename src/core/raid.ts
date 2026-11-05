// Захват профкома: боссы — организаторы, каждое профбюро проходит цепочку само. Сервер хранит прогресс и ограничивает урон.
import type { FactionId } from '../config/factions';

export interface RaidBoss { i: number; name: string; title: string; hp: number }
export interface RaidState {
  bosses: RaidBoss[];
  cooldownMin: number;
  holder: { faction: FactionId; at: number } | null;
  my: { faction: FactionId; boss: number; dmg: number; hp: number; done: boolean; cooldownLeft: number; power: number } | null;
  leaders: { faction: FactionId; boss: number; done: boolean }[];
}
export interface RaidHit { dealt: number; defeated: boolean; captured: boolean; boss: string; state: RaidState }

/** Умения боссов: во время щита урон не проходит. Подбираются по номеру босса. */
export const BOSS_SKILLS = [
  'Возвращает сдачу на доработку', 'Закрывает QR раньше времени', 'Ставит дедлайн на 23:59', 'Требует протокол заседания',
  'Созывает внеплановую планёрку', 'Не принимает скрин без ссылки', 'Отправляет на образовалку', 'Проверяет явку по списку',
  'Просит переделать презентацию', 'Включает режим «тишина в зале»', 'Перепроверяет смету', 'Объявляет перекличку',
];
/** Профкоины за штурм: урон / 40, не больше 300. */
export const raidCoins = (dealt: number) => Math.min(300, Math.round(dealt / 40));
export const initials = (name: string) => {
  const w = name.split(/\s+/).map((x) => x.replace(/[^\p{L}\d]/gu, '')).filter(Boolean);
  return ((w[0]?.[0] ?? '') + (w[1] ? (/^\d/.test(w[1]) ? w[1] : w[1][0]) : '')).toUpperCase();
};
