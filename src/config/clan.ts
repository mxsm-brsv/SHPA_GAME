// ПБ как клан: все игроки одного профбюро прокачивают общие здания ратуши.
// Вклад игрока = опыт, который он принёс зданиям (тапы, вложенные профкоины, победы в кампании).
// Все числа правятся здесь; сервер повторяет формулы (supabase/migrations/*_shpa_v2.sql).

export type BuildingId = 'kassa' | 'shtab' | 'media';

export interface BuildingDef { id: BuildingId; name: string; icon: string; color: string; text: (lvl: number) => string }

export const BUILDINGS: BuildingDef[] = [
  { id: 'kassa', name: 'Касса взаимопомощи', icon: 'coin', color: '#ffc83d', text: (l) => `+${l * CLAN.kassaIncome * 100}% к доходу всех игроков ПБ (тапы, лекции, кампания)` },
  { id: 'shtab', name: 'Штаб', icon: 'swords', color: '#ff7a6b', text: (l) => `+${l * CLAN.shtabPower * 100}% к силе ПБ в стычках на карте` },
  { id: 'media', name: 'Медиацентр', icon: 'sparkle', color: '#7fd4ff', text: (l) => `+${l * CLAN.mediaEnergy} к запасу энергии и +${(l * CLAN.mediaGolden * 100).toFixed(1).replace('.0', '')}% к шансу золотого тапа` },
];

export const CLAN = {
  /** Порог уровня L здания: 150·L^1,7 опыта (накопительно). Ур. 5 ≈ 2 300, ур. 10 ≈ 7 500. */
  levelBase: 150,
  levelPow: 1.7,
  maxLevel: 20,
  kassaIncome: 0.03,
  shtabPower: 0.04,
  mediaEnergy: 5,
  mediaGolden: 0.005,
  /** Лимит игроков в одном ПБ (участники, без организаторов). */
  pbLimit: 7,
  /** Очки ПБ = Σ баллов участников + влияние × W_INF + опыт зданий / XP_DIV. */
  scoreInfluenceWeight: 3,
  scoreXpDiv: 20,
  /** Вложить профкоины: столько монет за 1 опыт. */
  coinsPerXp: 25,
};

export const buildingById = (id: BuildingId) => BUILDINGS.find((b) => b.id === id)!;

export const levelThreshold = (lvl: number) => Math.round(CLAN.levelBase * Math.pow(lvl, CLAN.levelPow));

export function buildingLevel(xp: number) {
  let l = 0;
  while (l < CLAN.maxLevel && xp >= levelThreshold(l + 1)) l++;
  const cur = l === 0 ? 0 : levelThreshold(l);
  const next = l >= CLAN.maxLevel ? null : levelThreshold(l + 1);
  return { level: l, progress: next ? (xp - cur) / (next - cur) : 1, toNext: next ? next - xp : 0, next };
}

/** Уровень ратуши ПБ — от суммы уровней трёх зданий, 1–10. */
export const ratushaFromBuildings = (levels: number[]) => Math.min(10, 1 + Math.floor(levels.reduce((a, b) => a + b, 0) / 4));

export interface ClanBonuses { income: number; power: number; energy: number; golden: number; ratusha: number; levels: Record<BuildingId, number> }

export function clanBonuses(xp: Partial<Record<BuildingId, number>>): ClanBonuses {
  const levels = { kassa: buildingLevel(xp.kassa ?? 0).level, shtab: buildingLevel(xp.shtab ?? 0).level, media: buildingLevel(xp.media ?? 0).level };
  return {
    income: levels.kassa * CLAN.kassaIncome,
    power: levels.shtab * CLAN.shtabPower,
    energy: levels.media * CLAN.mediaEnergy,
    golden: levels.media * CLAN.mediaGolden,
    ratusha: ratushaFromBuildings([levels.kassa, levels.shtab, levels.media]),
    levels,
  };
}

export const pbScore = (ratingSum: number, influence: number, xp: number) =>
  Math.round(ratingSum + influence * CLAN.scoreInfluenceWeight + xp / CLAN.scoreXpDiv);
