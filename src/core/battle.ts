// Бой кампании — стратегия в реальном времени. Отряд (до 4 активистов) бьёт сам, враги бьют в ответ.
// Игрок тапает по врагам (выбирает цель для всего отряда) и включает умения из своих ячеек.
// Движок без DOM: им пользуется экран боя и проверка баланса (scripts/balance).
import { bossMechOf, chapterOf, stagePlan, stagePower, type BossMech, type EnemyDef } from '../config/campaign';
import { CLASS_ADVANTAGE, CLASS_INFO, heroDef, type HeroClass } from '../config/heroes';
import { SK, skillById, type SkillId } from '../config/skills';
import { battleStats, itemBonus, squadHeroes } from './logic';
import type { GameState } from './state';

/** Баланс (проверен симуляцией): запас здоровья и урон врагов на единицу силы этапа, сила тапа. */
export const BAL = { kh: 6.4, kd: 0.055, tap: 0.45, twoWaveHp: 1.35, bossHp: 1.4, bossDps: 0.68, enrageDmg: 1.3, enrageRate: 1.1 };
const ENEMY_RATE: Record<HeroClass, number> = { agit: 0.9, org: 0.7, law: 0.6 };
const AGGRO: Record<HeroClass, number> = { agit: 1, org: 1.2, law: 3 };

export interface FUnit {
  key: string; side: 'ally' | 'enemy'; name: string; cls: HeroClass;
  heroId?: string; def?: EnemyDef; boss: boolean; minion: boolean;
  atk: number; hp: number; max: number; rate: number; crit: number; dr: number;
  next: number; stunUntil: number; markUntil: number; markPct: number; dead: boolean;
}

export type FEvent =
  | { type: 'hit'; src: string; dst: string; dmg: number; crit: boolean; tap?: boolean }
  | { type: 'heal'; dst: string; amount: number }
  | { type: 'die'; dst: string }
  | { type: 'revive'; dst: string }
  | { type: 'wave'; n: number }
  | { type: 'spawn'; keys: string[] }
  | { type: 'boss'; what: 'shield' | 'shieldBreak' | 'enrage' | 'heal' | 'summon' | 'blocked'; amount?: number }
  | { type: 'skill'; id: SkillId };

interface Buff { until: number; v: number }

export class Fight {
  readonly stage: number;
  readonly mech: BossMech | null;
  t = 0;
  limit: number;
  done = false;
  win = false;
  allies: FUnit[];
  enemies: FUnit[] = [];
  waves: FUnit[][];
  wave = 0;
  focus: string | null = null;
  tapDmg: number;
  coinsBonus = 0;
  taps = 0;
  tapDealt = 0;
  dealt = 0;
  events: FEvent[] = [];
  private frozenUntil = 0;
  private waveAt = 0;
  private uid = 0;
  private rng: () => number;
  private buffs: Record<'rally' | 'wall' | 'stories' | 'shield' | 'charter' | 'volunteers' | 'audit', Buff> = {
    rally: { until: 0, v: 0 }, wall: { until: 0, v: 0 }, stories: { until: 0, v: 0 }, shield: { until: 0, v: 0 },
    charter: { until: 0, v: 0 }, volunteers: { until: 0, v: 0 }, audit: { until: 0, v: 0 },
  };
  private cdUntil: Partial<Record<SkillId, number>> = {};
  private used: Partial<Record<SkillId, number>> = {};
  boss = { shield: 0, nextShield: 4, nextSummon: 6, nextHeal: 9, enraged: false };
  private cdr: number;
  private lv: (id: SkillId) => number;
  readonly loadout: SkillId[];
  private squadDps: number;

  constructor(s: GameState, stage: number, rng: () => number = Math.random) {
    this.stage = stage;
    this.rng = rng;
    const plan = stagePlan(stage);
    const ib = itemBonus(s);
    this.limit = plan.time + ib.time;
    this.cdr = ib.cdr;
    this.lv = (id) => Math.max(1, Math.min(5, s.skillLv[id] ?? 1));
    this.mech = plan.boss ? bossMechOf(stage) : null;
    this.allies = squadHeroes(s).map((h, i) => {
      const d = heroDef(h.id);
      const st = battleStats(s, h);
      return { key: `a${i}`, side: 'ally', name: d.name, cls: d.cls, heroId: h.id, boss: false, minion: false, atk: st.atk, hp: st.hp, max: st.hp,
        rate: st.rate, crit: st.crit, dr: st.dr, next: 0.3 + i * 0.15, stunUntil: 0, markUntil: 0, markPct: 0, dead: false };
    });
    const avgAtk = this.allies.reduce((a, u) => a + u.atk, 0) / Math.max(1, this.allies.length);
    this.tapDmg = Math.max(1, Math.round(avgAtk * BAL.tap * (1 + s.clicker.lvl.tap * 0.15) * (1 + ib.tap)));
    this.squadDps = this.allies.reduce((a, u) => a + u.atk * u.rate * (1 + u.crit * 0.6), 0);
    this.waves = this.buildWaves(stage);
    this.loadout = (s.loadout as SkillId[]).filter((id) => !!skillById(id));
    this.nextWave();
  }

  // ---------- враги ----------
  private buildWaves(stage: number): FUnit[][] {
    const plan = stagePlan(stage);
    const ch = chapterOf(stage);
    const E = stagePower(stage);
    const hpTotal = E * BAL.kh * (plan.boss ? BAL.bossHp : plan.waves.length > 1 ? BAL.twoWaveHp : 1);
    const dps = E * BAL.kd;
    return plan.waves.map((n, w) => {
      const bossWave = plan.boss && w === plan.waves.length - 1;
      const hpShare = plan.boss ? (bossWave ? 0.7 : 0.3) : 1 / plan.waves.length;
      const waveHp = hpTotal * hpShare;
      const waveDps = dps * (bossWave ? BAL.bossDps : 1);
      return Array.from({ length: n }, (_, i) => {
        const isBoss = bossWave && i === 0;
        const def: EnemyDef = isBoss ? ch.boss : ch.enemies[(i + stage + w) % ch.enemies.length];
        const share = bossWave ? (isBoss ? 0.7 : 0.3 / (n - 1)) : 1 / n;
        const dShare = bossWave ? (isBoss ? 0.6 : 0.4 / (n - 1)) : 1 / n;
        const rate = isBoss ? 0.8 : ENEMY_RATE[def.cls];
        const hp = Math.round(waveHp * share * (0.9 + this.rng() * 0.2));
        return this.unit(def, isBoss, false, hp, (waveDps * dShare) / rate, rate);
      });
    });
  }

  private unit(def: EnemyDef, boss: boolean, minion: boolean, hp: number, atk: number, rate: number): FUnit {
    return { key: `e${this.uid++}`, side: 'enemy', name: def.name, cls: def.cls, def, boss, minion, atk: Math.max(1, atk), hp, max: hp, rate,
      crit: 0.05, dr: boss ? 0.1 : 0, next: this.t + 0.6 + this.rng() * 0.8, stunUntil: 0, markUntil: 0, markPct: 0, dead: false };
  }

  private nextWave() {
    this.enemies = this.waves[this.wave] ?? [];
    this.enemies.forEach((e) => { e.next = this.t + 0.6 + this.rng() * 0.8; });
    if (this.enemies.some((e) => e.boss)) this.boss = { shield: 0, nextShield: this.t + 4, nextSummon: this.t + 6, nextHeal: this.t + 9, enraged: false };
    if (this.focus && !this.enemies.some((e) => e.key === this.focus)) this.focus = null;
    this.events.push({ type: 'wave', n: this.wave + 1 });
  }

  get bossUnit() { return this.enemies.find((e) => e.boss && !e.dead) ?? null; }
  aliveAllies() { return this.allies.filter((u) => !u.dead); }
  aliveEnemies() { return this.enemies.filter((u) => !u.dead); }
  get wavesTotal() { return this.waves.length; }
  /** Сколько секунд осталось (таймер стоит, пока действует «Тайм-аут»). */
  get left() { return Math.max(0, this.limit - this.t); }
  get frozen() { return this.t < this.frozenUntil; }
  get enemyHpLeft() { return this.waves.slice(this.wave).flat().reduce((a, e) => a + (e.dead ? 0 : e.hp), 0) + (this.boss.shield || 0); }
  get enemyHpTotal() { return this.waves.flat().reduce((a, e) => a + e.max, 0); }
  buffLeft(k: keyof Fight['buffs']) { return Math.max(0, this.buffs[k].until - this.t); }

  private target(): FUnit | undefined {
    const al = this.aliveEnemies();
    return (this.focus && al.find((e) => e.key === this.focus)) || al.find((e) => !e.minion) || al[0];
  }

  /** Урон по врагу с учётом метки, «Устава» и щита босса. */
  private damage(e: FUnit, raw: number, src: string, crit: boolean, tap = false, vsShield = 1) {
    if (e.dead) return 0;
    let dmg = raw * (1 + (this.t < e.markUntil ? e.markPct : 0)) * (1 + (this.t < this.buffs.charter.until ? this.buffs.charter.v : 0)) * (1 - e.dr);
    if (e.boss && this.boss.shield > 0) {
      const toShield = Math.min(this.boss.shield, dmg * vsShield);
      this.boss.shield -= toShield;
      dmg -= toShield / vsShield;
      if (this.boss.shield <= 0) { this.boss.shield = 0; this.events.push({ type: 'boss', what: 'shieldBreak' }); }
    }
    dmg = Math.max(0, Math.round(dmg));
    if (dmg <= 0) { this.events.push({ type: 'hit', src, dst: e.key, dmg: 0, crit, tap }); return 0; }
    e.hp = Math.max(0, e.hp - dmg);
    this.dealt += dmg;
    if (tap) this.tapDealt += dmg;
    this.events.push({ type: 'hit', src, dst: e.key, dmg, crit, tap });
    if (e.hp <= 0) { e.dead = true; this.events.push({ type: 'die', dst: e.key }); if (this.focus === e.key) this.focus = null; }
    return dmg;
  }

  // ---------- такт ----------
  step(dt: number) {
    if (this.done) return;
    if (this.frozen) this.limit += dt; // «Тайм-аут»: таймер стоит
    this.t += dt;
    const t = this.t;
    // смена волны
    if (!this.aliveEnemies().length) {
      if (this.wave + 1 < this.waves.length) {
        if (!this.waveAt) this.waveAt = t + 0.8;
        if (t >= this.waveAt) { this.wave++; this.waveAt = 0; this.nextWave(); }
      } else { this.finish(true); return; }
    }
    if (!this.aliveAllies().length || t >= this.limit) { this.finish(false); return; }
    // отряд
    const rally = t < this.buffs.rally.until ? this.buffs.rally.v : 0;
    for (const u of this.aliveAllies()) {
      if (t < u.next) continue;
      u.next = t + 1 / u.rate * (0.9 + this.rng() * 0.2);
      const e = this.target();
      if (!e) break;
      const crit = this.rng() < u.crit;
      const adv = CLASS_INFO[u.cls].beats === e.cls ? 1 + CLASS_ADVANTAGE : 1;
      this.damage(e, u.atk * (crit ? 1.6 : 1) * adv * (1 + rally) * (0.9 + this.rng() * 0.2), u.key, crit);
    }
    // волонтёры: +30% урона отряда
    if (t < this.buffs.volunteers.until) { const e = this.target(); if (e) this.damageSilent(e, this.squadDps * 0.3 * dt); }
    // враги
    const frozen = this.frozen;
    const weak = t < this.buffs.wall.until ? 0.6 : 1;
    const guard = (t < this.buffs.shield.until ? 0.5 : 1) * (1 - (t < this.buffs.charter.until ? this.buffs.charter.v : 0));
    if (!frozen) {
      for (const e of this.aliveEnemies()) {
        if (t < e.next || t < e.stunUntil) continue;
        const enr = e.boss && this.boss.enraged ? BAL.enrageRate : 1;
        e.next = t + 1 / (e.rate * enr) * (0.85 + this.rng() * 0.3);
        const al = this.aliveAllies();
        if (!al.length) break;
        let r = this.rng() * al.reduce((a, u) => a + AGGRO[u.cls], 0);
        let tgt = al[0];
        for (const u of al) { r -= AGGRO[u.cls]; if (r <= 0) { tgt = u; break; } }
        const crit = this.rng() < e.crit;
        const adv = CLASS_INFO[e.cls].beats === tgt.cls ? 1 + CLASS_ADVANTAGE : 1;
        const dmg = Math.max(1, Math.round(e.atk * (crit ? 1.5 : 1) * adv * weak * guard * (e.boss && this.boss.enraged ? BAL.enrageDmg : 1) * (1 - tgt.dr) * (0.9 + this.rng() * 0.2)));
        tgt.hp = Math.max(0, tgt.hp - dmg);
        this.events.push({ type: 'hit', src: e.key, dst: tgt.key, dmg, crit });
        if (tgt.hp <= 0) { tgt.dead = true; this.events.push({ type: 'die', dst: tgt.key }); }
      }
      this.bossTick();
    }
  }

  private damageSilent(e: FUnit, raw: number) {
    // мелкий постоянный урон без всплывающих чисел
    if (e.dead) return;
    const before = this.events.length;
    this.damage(e, raw, 'vol', false);
    const ev = this.events[before];
    if (ev && ev.type === 'hit') this.events.splice(before, 1);
  }

  private bossTick() {
    const b = this.bossUnit;
    if (!b || !this.mech) return;
    const t = this.t;
    const m = this.mech;
    const audit = t < this.buffs.audit.until;
    if ((m === 'shield' || m === 'final') && t >= this.boss.nextShield) {
      this.boss.nextShield = t + (m === 'final' ? 14 : 11);
      this.boss.shield = Math.round(b.max * (m === 'final' ? 0.14 : 0.18));
      this.events.push({ type: 'boss', what: 'shield', amount: this.boss.shield });
    }
    if ((m === 'heal' || m === 'final') && t >= this.boss.nextHeal) {
      this.boss.nextHeal = t + (m === 'final' ? 12 : 9);
      if (audit) this.events.push({ type: 'boss', what: 'blocked' });
      else { const a = Math.round(Math.min(b.max - b.hp, b.max * (m === 'final' ? 0.04 : 0.06))); b.hp += a; if (a > 0) this.events.push({ type: 'boss', what: 'heal', amount: a }); }
    }
    if (m === 'summon' && t >= this.boss.nextSummon) {
      this.boss.nextSummon = t + 12;
      if (audit) this.events.push({ type: 'boss', what: 'blocked' });
      else if (this.aliveEnemies().filter((e) => e.minion).length < 4) {
        const ch = chapterOf(this.stage);
        const hp = Math.round(b.max * 0.05);
        const fresh = [0, 1].map((i) => this.unit(ch.enemies[i % ch.enemies.length], false, true, hp, (b.atk * b.rate * 0.12) / 0.8, 0.8));
        this.enemies.push(...fresh);
        this.events.push({ type: 'boss', what: 'summon' }, { type: 'spawn', keys: fresh.map((x) => x.key) });
      }
    }
    if ((m === 'enrage' || m === 'final') && !this.boss.enraged && (b.hp < b.max * (m === 'final' ? 0.4 : 0.5) || (m === 'enrage' && t > this.limit * 0.6))) {
      this.boss.enraged = true;
      this.events.push({ type: 'boss', what: 'enrage' });
    }
  }

  private finish(win: boolean) {
    this.done = true;
    this.win = win;
  }

  // ---------- действия игрока ----------
  setFocus(key: string | null) {
    if (!key || this.aliveEnemies().some((e) => e.key === key)) this.focus = key;
  }

  tap(key?: string) {
    if (this.done) return 0;
    if (key) this.setFocus(key);
    const e = this.target();
    if (!e) return 0;
    this.taps++;
    const crit = this.rng() < 0.1;
    const mult = (crit ? 2 : 1) * (this.t < this.buffs.stories.until ? 2 : 1);
    return this.damage(e, this.tapDmg * mult * (0.9 + this.rng() * 0.2), 'tap', crit, true);
  }

  /** Есть ли у умения владелец среди живых. */
  ownerAlive(id: SkillId) {
    const sk = skillById(id)!;
    return this.aliveAllies().some((u) => (sk.hero ? u.heroId === sk.hero : u.cls === sk.cls));
  }

  skillState(id: SkillId) {
    const sk = skillById(id)!;
    const usesLeft = sk.uses ? sk.uses - (this.used[id] ?? 0) : Infinity;
    const cdLeft = Math.max(0, (this.cdUntil[id] ?? 0) - this.t);
    const owner = this.ownerAlive(id);
    return { cdLeft, usesLeft, owner, ready: !this.done && owner && cdLeft <= 0 && usesLeft > 0 };
  }

  useSkill(id: SkillId): string | null {
    const sk = skillById(id);
    if (!sk || !this.loadout.includes(id)) return 'Этого умения нет в ячейках';
    const st = this.skillState(id);
    if (!st.owner) return sk.hero ? `${heroDef(sk.hero).name} выбыл — умение недоступно` : 'В отряде не осталось активистов этого класса';
    if (st.usesLeft <= 0) return 'Больше нельзя в этом бою';
    if (st.cdLeft > 0) return `Перезарядка ${Math.ceil(st.cdLeft)} с`;
    const l = this.lv(id);
    const t = this.t;
    const tgt = this.target();
    const all = this.aliveEnemies();
    switch (id) {
      case 'rally': this.buffs.rally = { until: t + 6, v: SK.rally(l) }; break;
      case 'heal': for (const u of this.aliveAllies()) { const a = Math.min(u.max - u.hp, Math.round(u.max * SK.heal(l))); u.hp += a; if (a) this.events.push({ type: 'heal', dst: u.key, amount: a }); } break;
      case 'shield': this.buffs.shield = { until: t + SK.shield(l), v: 0.5 }; break;
      case 'shout': for (const e of all) this.damage(e, this.tapDmg * SK.shout(l), 'skill', false); break;
      case 'wall': this.buffs.wall = { until: t + SK.wall(l), v: 0.4 }; break;
      case 'meme': for (const e of all) e.stunUntil = t + SK.meme(l) * (e.boss ? 0.5 : 1); break;
      case 'stories': this.buffs.stories = { until: t + SK.stories(l), v: 1 }; break;
      case 'speech': if (tgt) this.damage(tgt, this.tapDmg * SK.speech(l), 'skill', true, false, 2); break;
      case 'voice': for (const e of all) { this.damage(e, this.tapDmg * SK.voice(l), 'skill', true); e.stunUntil = t + (e.boss ? 0.75 : 1.5); } break;
      case 'roll': this.limit += SK.roll(l); break;
      case 'checklist': for (const k of Object.keys(this.cdUntil) as SkillId[]) if (k !== 'checklist') this.cdUntil[k] = Math.max(t, (this.cdUntil[k] ?? 0) - SK.checklist(l)); break;
      case 'timeout': this.frozenUntil = t + SK.timeout(l); break;
      case 'budget': this.coinsBonus += SK.budget(l); this.limit += 2; break;
      case 'volunteers': this.buffs.volunteers = { until: t + SK.volunteers(l), v: 0.3 }; break;
      case 'gather': for (const u of this.allies) { if (u.dead) { u.dead = false; u.hp = Math.round(u.max * SK.gather(l)); u.next = t + 0.5; this.events.push({ type: 'revive', dst: u.key }); } else { const a = u.max - u.hp; u.hp = u.max; if (a) this.events.push({ type: 'heal', dst: u.key, amount: a }); } } break;
      case 'article': { const e = this.bossUnit ?? tgt; if (e) { e.markUntil = t + 8; e.markPct = SK.article(l); } break; }
      case 'appeal': { const b = this.bossUnit; if (b && this.boss.shield > 0) { this.boss.shield = 0; this.events.push({ type: 'boss', what: 'shieldBreak' }); } const e = b ?? tgt; if (e) this.damage(e, this.tapDmg * SK.appeal(l), 'skill', true); break; }
      case 'audit': this.buffs.audit = { until: t + SK.audit(l), v: 1 }; for (const e of all) if (e.minion) this.damage(e, e.hp * 0.5, 'skill', false); break;
      case 'settle': { const u = this.allies.find((x) => x.dead); if (!u) return 'Все в строю — возвращать некого'; u.dead = false; u.hp = Math.round(u.max * SK.settle(l)); u.next = t + 0.5; this.events.push({ type: 'revive', dst: u.key }); break; }
      case 'charter': this.buffs.charter = { until: t + 8, v: SK.charter(l) }; break;
      case 'verdict': { const thr = SK.verdict(l); for (const e of all) { if (e.boss) this.damage(e, e.hp * 0.1, 'skill', true); else if (e.hp <= e.max * thr) this.damage(e, e.hp + 1, 'skill', true); } break; }
    }
    this.cdUntil[id] = t + sk.cd * (1 - this.cdr);
    this.used[id] = (this.used[id] ?? 0) + 1;
    this.events.push({ type: 'skill', id });
    return null;
  }

  /** Срезать накопленные события (для экрана). */
  drain() { const e = this.events; this.events = []; return e; }
}
