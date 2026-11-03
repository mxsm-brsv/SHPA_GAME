// Проверка баланса кампании: тысячи боёв движком игры с «ботом-игроком» трёх типов.
// Запуск: node scripts/balance/run.mjs  — печатает долю побед, время и остаток здоровья по этапам и силе отряда.
import { Fight } from '../../src/core/battle';
import { newState, type GameState } from '../../src/core/state';
import { autoPerks, squadPower } from '../../src/core/logic';
import { stagePower, stagePlan, MAX_STAGE } from '../../src/config/campaign';
import { loadoutSlots, skillById, type SkillId } from '../../src/config/skills';

function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const SQUAD = ['megaphone', 'starosta', 'reader', 'stipend'];
const PREF: SkillId[] = ['shout', 'heal', 'appeal', 'article', 'rally', 'shield', 'roll'];

/** Отряд нужной силы: одинаковые уровни, перки по классу. */
export function squadFor(stage: number, ratio: number): GameState {
  const s = newState('bot');
  s.faction = 'ire';
  s.heroes = SQUAD.map((id, i) => ({ uid: `h${i}`, id, level: 1, stars: 1 }));
  s.squad = s.heroes.map((h) => h.uid);
  const target = stagePower(stage) * ratio;
  for (let L = 1; L <= 400; L++) {
    s.heroes.forEach((h) => { h.level = L; autoPerks(h); });
    if (squadPower(s).total >= target) break;
  }
  s.stage = stage;
  s.loadout = PREF.slice(0, loadoutSlots(stage));
  return s;
}

type Policy = 'active' | 'lazy' | 'idle';

export function play(s: GameState, stage: number, policy: Policy, seed: number) {
  const f = new Fight(s, stage, rng(seed));
  const dt = 0.05;
  let tapAcc = 0;
  const tps = policy === 'active' ? 3 : policy === 'lazy' ? 1.5 : 0;
  while (!f.done && f.t < 200) {
    f.step(dt);
    f.drain();
    tapAcc += tps * dt;
    while (tapAcc >= 1) { tapAcc -= 1; f.tap(); }
    if (policy === 'idle') continue;
    const hpFrac = f.aliveAllies().reduce((a, u) => a + u.hp, 0) / f.allies.reduce((a, u) => a + u.max, 0);
    for (const id of f.loadout) {
      const st = f.skillState(id);
      if (!st.ready) continue;
      const sk = skillById(id)!;
      if (policy === 'lazy') { f.useSkill(id); continue; }
      const low = f.aliveAllies().some((u) => u.hp < u.max * 0.55);
      const want =
        id === 'heal' ? low :
        id === 'shield' || id === 'wall' || id === 'timeout' ? hpFrac < 0.7 || f.boss.enraged :
        id === 'settle' ? f.allies.some((u) => u.dead) :
        id === 'gather' ? f.allies.some((u) => u.dead) || hpFrac < 0.4 :
        id === 'appeal' ? !f.bossUnit || f.boss.shield > 0 :
        id === 'audit' ? !!f.bossUnit :
        id === 'roll' ? f.left < 8 :
        id === 'checklist' ? true : !!sk;
      if (want) f.useSkill(id);
    }
  }
  const hpLeft = f.aliveAllies().reduce((a, u) => a + u.hp, 0) / f.allies.reduce((a, u) => a + u.max, 0);
  return { win: f.win, t: f.t, hpLeft, tapShare: f.tapDealt / Math.max(1, f.dealt), timeout: !f.win && f.aliveAllies().length > 0 };
}

export function report(stages = [1, 3, 5, 9, 10, 15, 20, 25, 30, 40, 50], ratios = [0.8, 1, 1.2, 1.5], n = 40) {
  const rows: string[] = [];
  for (const st of stages.filter((x) => x <= MAX_STAGE)) {
    const plan = stagePlan(st);
    for (const r of ratios) {
      const s = squadFor(st, r);
      const res = (['active', 'lazy', 'idle'] as Policy[]).map((p) => {
        let w = 0, t = 0, hp = 0, to = 0, ts = 0;
        for (let i = 0; i < n; i++) { const x = play(JSON.parse(JSON.stringify(s)), st, p, i * 7919 + st); w += +x.win; t += x.t; hp += x.hpLeft; to += +x.timeout; ts += x.tapShare; }
        return `${p[0]}:${Math.round((w / n) * 100)}% ${Math.round(t / n)}с hp${Math.round((hp / n) * 100)} to${Math.round((to / n) * 100)} tap${Math.round((ts / n) * 100)}`;
      });
      rows.push(`этап ${String(st).padStart(2)} r${(squadPower(s).total / stagePower(st)).toFixed(2)} (${plan.boss ? 'босс' : plan.waves.length + 'в'} ${plan.time}с) ×${r.toFixed(1)}  ${res.join(' | ')}`);
    }
  }
  return rows.join('\n');
}
