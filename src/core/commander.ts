// Командир (игрок): ячейки умений, уровни умений за кристаллы, награды этапа и выпадение снаряжения.
import { MAX_STAGE, isBossStage, stageReward } from '../config/campaign';
import { heroDef } from '../config/heroes';
import { INVENTORY_MAX, dropRoll, type ItemInst } from '../config/items';
import { SKILLS, SKILL_MAX, SKILL_UP_COST, commanderLevel, loadoutSlots, skillById, type SkillDef, type SkillId } from '../config/skills';
import { itemBonus, squadHeroes } from './logic';
import type { GameState } from './state';

export const skillLevel = (s: GameState, id: string) => Math.max(1, Math.min(SKILL_MAX, s.skillLv[id] ?? 1));

/** Можно ли взять умение в бой: владелец в отряде и уровень командира достаточен. */
export function skillAvailable(s: GameState, sk: SkillDef): { ok: boolean; reason: string } {
  const lvl = commanderLevel(s.stage);
  if (lvl < sk.minLvl) return { ok: false, reason: `с ${sk.minLvl} уровня командира` };
  const squad = squadHeroes(s).map((h) => heroDef(h.id));
  if (sk.hero ? !squad.some((d) => d.id === sk.hero) : !squad.some((d) => d.cls === sk.cls)) {
    return { ok: false, reason: sk.hero ? (s.heroes.some((h) => h.id === sk.hero) ? `возьми в отряд: ${heroDef(sk.hero).name}` : `нужен активист «${heroDef(sk.hero).name}»`) : 'нужен активист этого класса в отряде' };
  }
  return { ok: true, reason: '' };
}

/** Убирает из ячеек недоступные умения и лишние сверх числа ячеек. Пустые ячейки заполняет доступными. */
export function sanitizeLoadout(s: GameState, fill = true) {
  const slots = loadoutSlots(s.stage);
  const seen = new Set<string>();
  s.loadout = s.loadout.filter((id) => {
    const sk = skillById(id);
    if (!sk || seen.has(id) || !skillAvailable(s, sk).ok) return false;
    seen.add(id);
    return true;
  }).slice(0, slots);
  if (fill) for (const sk of SKILLS) {
    if (s.loadout.length >= slots) break;
    if (!s.loadout.includes(sk.id) && skillAvailable(s, sk).ok) s.loadout.push(sk.id);
  }
}

export function toggleLoadout(s: GameState, id: SkillId): string | null {
  const sk = skillById(id);
  if (!sk) return 'Нет такого умения';
  const i = s.loadout.indexOf(id);
  if (i >= 0) { s.loadout.splice(i, 1); return null; }
  const a = skillAvailable(s, sk);
  if (!a.ok) return `Пока нельзя: ${a.reason}`;
  if (s.loadout.length >= loadoutSlots(s.stage)) return `Все ${loadoutSlots(s.stage)} ячейки заняты — сначала убери умение. Новая ячейка — за каждого босса главы`;
  s.loadout.push(id);
  return null;
}

export function upgradeSkill(s: GameState, id: SkillId): string | null {
  const l = skillLevel(s, id);
  if (l >= SKILL_MAX) return 'Максимальный уровень';
  const cost = SKILL_UP_COST[l];
  if (s.crystals < cost) return `Нужно ${cost} кристаллов (есть ${s.crystals}). Кристаллы дают за прохождение этапов`;
  s.crystals -= cost;
  s.skillLv[id] = l + 1;
  return null;
}

export interface StageRewards { coins: number; scrolls: number; rating: number; crystals: number; item: ItemInst | null; sold: number; first: boolean }

/** Награда за победу: первое прохождение — полная, повтор — 20% профкоинов и шанс предмета. */
export function winRewards(s: GameState, stage: number, coinsBonus: number, rng = Math.random): StageRewards {
  const first = stage === s.stage && s.stage <= MAX_STAGE;
  const base = stageReward(stage);
  const ib = itemBonus(s);
  const coins = Math.round((first ? base.coins : base.coins * 0.2) * (1 + coinsBonus + ib.coins));
  let crystals = first ? base.crystals : 0;
  if (rng() < ib.crystal) crystals += 1;
  const item = dropRoll(stage, first, first && isBossStage(stage), rng);
  let sold = 0;
  s.coins += coins;
  s.scrolls += first ? base.scrolls : 0;
  s.crystals += crystals;
  if (item) {
    if (s.items.length >= INVENTORY_MAX) {
      // рюкзак полон — продаём самый слабый неэкипированный, чтобы не терять новый
      const equipped = new Set(Object.values(s.equip));
      const order = ['common', 'rare', 'epic', 'legend'];
      const weakest = s.items.filter((x) => !equipped.has(x.uid)).sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity))[0];
      if (weakest) { s.items.splice(s.items.indexOf(weakest), 1); sold = 1; }
    }
    if (s.items.length < INVENTORY_MAX) s.items.push(item);
  }
  if (first) s.stage++;
  return { coins, scrolls: first ? base.scrolls : 0, rating: first ? base.rating : 0, crystals, item, sold, first };
}
