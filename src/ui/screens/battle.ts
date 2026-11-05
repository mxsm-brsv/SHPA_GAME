// Бой кампании — стратегия: перед боем видно состав врагов и механику босса, в бою — тапы по цели и умения из ячеек.
// Враги бьют в ответ: активисты могут выбыть. Поражение — если выбыли все или вышло время.
import { BOSS_TIP, MAX_STAGE, bossMechOf, chapterOf, isBossStage, stageLabel, stagePlan, stagePower, stageReward } from '../../config/campaign';
import { CLASS_INFO } from '../../config/heroes';
import { CLICKER } from '../../config/clicker';
import { ITEM_RARITY, statText, type ItemStat } from '../../config/items';
import { loadoutSlots, skillById, type SkillId } from '../../config/skills';
import { enemySvg, heroSvg } from '../../art/hero';
import { coinSvg, icon, scrollSvg } from '../../art/icons';
import { Fight, type FUnit } from '../../core/battle';
import { sanitizeLoadout, skillLevel, winRewards } from '../../core/commander';
import { squadPower } from '../../core/logic';
import { addContribution } from '../../core/clicker';
import { grantGameCoins } from '../../core/rules';
import { DAILY_MINIGAME_COINS, GAME_COINS_PER_POINT } from '../../config/economy';
import { haptic } from '../../core/telegram';
import { $, el, esc, fmt, modal, onAct, plural } from '../../lib/dom';
import type { App } from '../app';

const BOSS_WHAT = { shield: 'Щит!', shieldBreak: 'Щит снят', enrage: 'Ярость!', heal: 'Лечится', summon: 'Зовёт помощников', blocked: 'Ревизия: запрещено' } as const;

/** Окно перед боем: кто против нас, чем опасен босс, какие умения взяты. */
export function openBattle(app: App) {
  const s = app.state;
  sanitizeLoadout(s);
  const stage = Math.min(s.stage, MAX_STAGE);
  const plan = stagePlan(stage);
  const ch = chapterOf(stage);
  const pw = squadPower(s).total;
  const ePow = stagePower(stage);
  const ratio = pw / ePow;
  const rw = stageReward(stage);
  const verdict = ratio >= 1.2 ? ['Отряд сильнее', '#6dffb0'] : ratio >= 0.95 ? ['Равный бой — нужны тапы и умения', '#ffd76a'] : ['Враги сильнее — улучши отряд', '#ff8a8a'];
  const m = modal(`<div class="col" style="gap:10px">
    <div class="small muted">${esc(stageLabel(stage))}</div>
    <h2 style="font-size:22px">${plan.boss ? `Босс: ${esc(ch.boss.name)}` : `${plan.waves.length > 1 ? 'Две волны' : 'Одна волна'} · ${plan.waves.reduce((a, b) => a + b, 0)} ${plural(plan.waves.reduce((a, b) => a + b, 0), 'враг', 'врага', 'врагов')}`}</h2>
    <div class="row" style="gap:6px;flex-wrap:wrap">${ch.enemies.map((e) => `<span class="tag" style="background:${CLASS_INFO[e.cls].color}33">${esc(e.name)}</span>`).join('')}</div>
    ${plan.boss ? `<div class="card small" style="border-color:var(--red)">${icon('bolt', 14, '#ff8a8a')} ${esc(BOSS_TIP[bossMechOf(stage)])}</div>` : ''}
    <div class="row" style="gap:10px"><div class="card grow center"><div class="small muted">Отряд</div><b>${fmt(pw)}</b></div><div class="card grow center"><div class="small muted">Враги</div><b>${fmt(ePow)}</b></div><div class="card grow center"><div class="small muted">Время</div><b>${plan.time} с</b></div></div>
    <div class="small" style="color:${verdict[1]}">${verdict[0]}</div>
    <div class="section-h" style="margin:0">Умения в бою · ${s.loadout.length}/${loadoutSlots(stage)}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap">${s.loadout.map((id) => { const k = skillById(id)!; return `<span class="tag" style="background:${CLASS_INFO[k.cls].color}33">${icon(k.icon, 12)} ${esc(k.name)} ${skillLevel(s, id)}</span>`; }).join('') || '<span class="small muted">нет</span>'}</div>
    <div class="small muted">За первую победу: ${coinSvg(12)} ${fmt(rw.coins)} · 💎 ${rw.crystals}${rw.scrolls ? ` · ${scrollSvg(12)} ${rw.scrolls}` : ''}${plan.boss ? ' · снаряжение' : ' · шанс снаряжения'}</div>
    <div class="row" style="gap:8px"><button class="btn btn-blue grow" data-prep>Умения и отряд</button><button class="btn btn-gold grow" data-go>В бой</button></div>
  </div>`);
  $(m.root, '[data-go]').addEventListener('click', () => { m.close(); startFight(app, stage); });
  $(m.root, '[data-prep]').addEventListener('click', () => { m.close(); app.closeOverlay(false); app.squadTab = 'skills'; app.tab = 'base'; app.go('squad'); });
}

function positions(n: number, side: 'ally' | 'enemy') {
  // враги — две колонки «ёлочкой», отряд — одна колонка слева
  if (side === 'ally') { const step = Math.min(21, 80 / Math.max(1, n)); const top = 50 - ((n - 1) * step) / 2 - 8; return Array.from({ length: n }, (_, i) => [i % 2 ? 4 : 16, top + i * step]); }
  const cols = n > 4 ? 2 : 1;
  const rows = Math.ceil(n / cols);
  const step = Math.min(21, 82 / Math.max(1, rows));
  const top = 50 - ((rows - 1) * step) / 2 - 8;
  return Array.from({ length: n }, (_, i) => { const c = cols === 2 ? i % 2 : 0; const r = cols === 2 ? Math.floor(i / 2) : i; return [cols === 2 ? (c ? 77 : 55) : 68, top + r * step + (c ? step / 2 : 0) - (cols === 2 ? step / 4 : 0)]; });
}

function startFight(app: App, stage: number) {
  const s = app.state;
  const f = new Fight(s, stage);
  const ch = chapterOf(stage);
  const boss = isBossStage(stage);
  const node = el(`<div class="battle" style="background:linear-gradient(${ch.sky[0]},${ch.sky[1]} 60%,${ch.sky[2]})">
    <div class="battle-top">
      <button class="btn btn-ghost btn-sm" data-act="exit" aria-label="Выйти">${icon('back', 18)}</button>
      <div class="grow"><div style="font-family:var(--head)">${esc(stageLabel(stage))}</div>
        <div class="small muted" data-wave></div></div>
      <div class="b-time" data-time>${Math.ceil(f.left)}</div>
    </div>
    <div class="b-bars"><div class="b-hp"><i data-hpall style="width:100%"></i><span data-hptext></span></div>
      ${boss ? '<div class="b-boss hidden" data-bossbar><i data-bhp></i><b data-bsh></b><span data-btxt></span></div>' : ''}
      <div class="b-timer"><i data-tbar style="width:100%"></i></div><div class="b-buffs" data-buffs></div></div>
    <div class="battle-field tapfield" data-field>
      <div class="b-hint" data-hint>Тапай по врагу — по нему бьёт и весь отряд. Включай умения внизу</div>
    </div>
    <div class="battle-bottom skillbar" data-skills></div>
  </div>`);
  const field = $(node, '[data-field]');
  const els = new Map<string, HTMLElement>();
  const unitHtml = (u: FUnit) => u.side === 'ally'
    ? `<div class="pic">${heroSvg(u.heroId!, 54)}</div><div class="hp"><i style="width:100%"></i></div><div class="bn"><span style="color:${CLASS_INFO[u.cls].color}">●</span> ${esc(u.name)}</div>`
    : `<div class="pic">${enemySvg(u.def!, u.boss ? 74 : 50, u.boss)}</div><div class="hp"><i style="width:100%"></i></div><div class="bn">${esc(u.name)}</div>`;
  const place = (list: FUnit[], side: 'ally' | 'enemy') => {
    const pos = positions(list.length, side);
    list.forEach((u, i) => {
      let e = els.get(u.key);
      if (!e) { e = el(`<div class="bunit ${side} ${u.boss ? 'boss' : ''} ${u.minion ? 'minion' : ''}" data-k="${u.key}">${unitHtml(u)}</div>`); field.appendChild(e); els.set(u.key, e); }
      e.style.left = `${pos[i][0]}%`; e.style.top = `${pos[i][1]}%`;
    });
  };
  place(f.allies, 'ally');
  const drawEnemies = () => {
    field.querySelectorAll('.bunit.enemy').forEach((x) => { if (!f.enemies.some((e) => e.key === (x as HTMLElement).dataset.k)) { x.remove(); els.delete((x as HTMLElement).dataset.k!); } });
    place(f.enemies, 'enemy');
  };
  drawEnemies();

  // ---------- умения ----------
  const bar = $(node, '[data-skills]');
  bar.innerHTML = f.loadout.map((id) => {
    const k = skillById(id)!;
    return `<button class="sk" data-sk="${id}" style="--cc:${CLASS_INFO[k.cls].color}">${icon(k.icon, 20)}<b>${esc(k.name)}</b><span>ур. ${skillLevel(s, id)}</span><i data-cd></i></button>`;
  }).join('') || '<div class="small muted center grow">Умения не выбраны — их можно взять в «Отряд → Умения»</div>';
  bar.querySelectorAll<HTMLElement>('[data-sk]').forEach((b) => b.addEventListener('click', () => {
    const err = f.useSkill(b.dataset.sk as SkillId);
    if (err) { flash(err); haptic('bad'); return; }
    haptic('heavy');
    b.classList.remove('fire'); void b.offsetWidth; b.classList.add('fire');
  }));
  const flash = (t: string) => { const h = $(node, '[data-hint]'); h.textContent = t; h.classList.remove('hidden'); clearTimeout(hintT); hintT = window.setTimeout(() => h.classList.add('hidden'), 1800); };
  let hintT = window.setTimeout(() => $(node, '[data-hint]').classList.add('hidden'), 6000);

  // ---------- тапы ----------
  const recent: number[] = [];
  field.addEventListener('pointerdown', (e) => {
    if (f.done) return;
    e.preventDefault();
    const now = performance.now();
    while (recent.length && now - recent[0] > 1000) recent.shift();
    if (recent.length >= CLICKER.maxTapsPerSecond) return;
    recent.push(now);
    const tapped = (e.target as HTMLElement).closest<HTMLElement>('.bunit.enemy');
    const fr = field.getBoundingClientRect();
    tapAt = [e.clientX - fr.left - 10, e.clientY - fr.top - 20];
    f.tap(tapped?.dataset.k);
    if (f.taps % 3 === 0) haptic();
  });
  let tapAt: [number, number] | null = null;

  const pop = (key: string, text: string, cls = '') => {
    const u = els.get(key);
    if (!u) return;
    const d = el(`<div class="dmg ${cls}" style="left:${u.offsetLeft + 20 + (Math.random() * 20 - 10)}px;top:${u.offsetTop - 4}px">${text}</div>`);
    field.appendChild(d);
    setTimeout(() => d.remove(), 850);
  };

  // ---------- кадр ----------
  let raf = 0, last = performance.now(), popCount = 0;
  const draw = () => {
    for (const ev of f.drain()) {
      if (ev.type === 'hit') {
        const u = els.get(ev.dst);
        if (ev.tap && tapAt) {
          const d = el(`<div class="dmg ${ev.crit ? 'crit' : ''}" style="left:${tapAt[0]}px;top:${tapAt[1]}px">-${fmt(ev.dmg)}</div>`);
          field.appendChild(d); setTimeout(() => d.remove(), 800); tapAt = null;
        } else if (ev.src === 'skill' || ev.crit || popCount++ % 3 === 0) pop(ev.dst, `-${fmt(ev.dmg)}`, ev.dst.startsWith('a') ? 'ally-hit' : ev.crit ? 'crit' : '');
        if (u) { u.classList.remove('hit'); void u.offsetWidth; u.classList.add('hit'); }
        const src = els.get(ev.src);
        if (src && ev.src.startsWith('a')) { src.classList.add('lunge-r'); setTimeout(() => src.classList.remove('lunge-r'), 110); }
      } else if (ev.type === 'heal') pop(ev.dst, `+${fmt(ev.amount)}`, 'heal');
      else if (ev.type === 'die') { els.get(ev.dst)?.classList.add('dead'); if (ev.dst.startsWith('a')) { flash(`${f.allies.find((x) => x.key === ev.dst)?.name ?? 'Активист'} выбыл`); haptic('bad'); } }
      else if (ev.type === 'revive') { els.get(ev.dst)?.classList.remove('dead'); pop(ev.dst, 'в строю!', 'heal'); }
      else if (ev.type === 'wave') { drawEnemies(); if (ev.n > 1) flash(`Волна ${ev.n} из ${f.wavesTotal}`); }
      else if (ev.type === 'spawn') drawEnemies();
      else if (ev.type === 'boss') { flash(BOSS_WHAT[ev.what]); const b = f.bossUnit; if (b) pop(b.key, BOSS_WHAT[ev.what], ev.what === 'shieldBreak' || ev.what === 'blocked' ? 'heal' : 'crit'); }
      else if (ev.type === 'skill') { const k = skillById(ev.id)!; flash(`${k.name}!`); }
    }
    for (const u of [...f.allies, ...f.enemies]) {
      const e = els.get(u.key);
      if (!e) continue;
      (e.querySelector('.hp > i') as HTMLElement).style.width = `${(u.hp / u.max) * 100}%`;
      e.classList.toggle('dead', u.dead);
      e.classList.toggle('focus', f.focus === u.key);
      e.classList.toggle('stun', !u.dead && u.stunUntil > f.t);
      e.classList.toggle('marked', !u.dead && u.markUntil > f.t);
    }
    const left = f.enemyHpLeft, total = f.enemyHpTotal;
    $(node, '[data-hpall]').style.width = `${Math.min(100, (left / total) * 100)}%`;
    $(node, '[data-hptext]').textContent = `${fmt(left)} / ${fmt(total)}`;
    $(node, '[data-wave]').textContent = `Волна ${f.wave + 1} из ${f.wavesTotal} · врагов ${f.aliveEnemies().length} · отряд ${f.aliveAllies().length}/${f.allies.length}`;
    $(node, '[data-time]').textContent = String(Math.ceil(f.left));
    $(node, '[data-time]').classList.toggle('pause', f.frozen);
    $(node, '[data-tbar]').style.width = `${Math.min(100, (f.left / f.limit) * 100)}%`;
    const bb = node.querySelector<HTMLElement>('[data-bossbar]');
    if (bb) {
      const b = f.bossUnit;
      bb.classList.toggle('hidden', !b);
      if (b) {
        $(bb, '[data-bhp]').style.width = `${(b.hp / b.max) * 100}%`;
        $(bb, '[data-bsh]').style.width = `${Math.min(100, (f.boss.shield / b.max) * 100)}%`;
        $(bb, '[data-btxt]').textContent = `${b.name}${f.boss.shield > 0 ? ` · щит ${fmt(f.boss.shield)}` : ''}${f.boss.enraged ? ' · ЯРОСТЬ' : ''}`;
      }
    }
    const buffs: [string, number][] = [['Митинг', f.buffLeft('rally')], ['Защита', f.buffLeft('shield')], ['Стена', f.buffLeft('wall')], ['Сторис ×2', f.buffLeft('stories')], ['Устав', f.buffLeft('charter')], ['Волонтёры', f.buffLeft('volunteers')], ['Ревизия', f.buffLeft('audit')], ['Тайм-аут', f.frozen ? 1 : 0]];
    $(node, '[data-buffs]').innerHTML = buffs.filter(([, v]) => v > 0).map(([n, v]) => `<span>${n}${n === 'Тайм-аут' ? '' : ` ${Math.ceil(v)}`}</span>`).join('');
    bar.querySelectorAll<HTMLElement>('[data-sk]').forEach((b) => {
      const st = f.skillState(b.dataset.sk as SkillId);
      b.classList.toggle('off', !st.ready);
      b.classList.toggle('gone', !st.owner);
      (b.querySelector('[data-cd]') as HTMLElement).textContent = !st.owner ? '✕' : st.usesLeft <= 0 ? '✓' : st.cdLeft > 0 ? String(Math.ceil(st.cdLeft)) : '';
    });
  };
  const loop = (now: number) => {
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    while (dt > 0 && !f.done) { const d = Math.min(0.05, dt); f.step(d); dt -= d; }
    draw();
    if (f.done) { setTimeout(() => showResult(), 350); return; }
    raf = requestAnimationFrame(loop);
  };

  const showResult = async () => {
    s.stats.battles++;
    let html: string;
    const tapShare = Math.round((f.tapDealt / Math.max(1, f.dealt)) * 100);
    if (f.win) {
      haptic('ok');
      s.stats.wins++;
      s.streakWin = true;
      const r = winRewards(s, stage, f.coinsBonus);
      const xp = r.first ? 10 + stage : 2;
      addContribution(s, xp);
      // баллов кампания не даёт — вместо них бонус профкоинов в дневном лимите игр
      const got = r.rating ? grantGameCoins(s, 'campaign', ((s.daily.byGame.campaign ?? 0) / GAME_COINS_PER_POINT) + r.rating, DAILY_MINIGAME_COINS * 2) : 0;
      const it = r.item;
      html = `<h2 style="color:var(--gold2)">Победа!</h2>
        ${boss ? `<div>Босс «${esc(chapterOf(stage).boss.name)}» повержен${r.first && stage < 40 ? ' · <b class="gold">+1 ячейка умений</b>' : ''}</div>` : ''}
        <div class="small muted">За ${Math.round(f.t)} с · в строю ${f.aliveAllies().length} из ${f.allies.length} · твои тапы — ${tapShare}% урона</div>
        <div class="row" style="justify-content:center;gap:14px;font-size:18px;font-weight:800;flex-wrap:wrap">
          <span class="row" style="gap:4px">${coinSvg(22)}+${fmt(r.coins)}</span>
          ${r.crystals ? `<span class="row" style="gap:4px;color:#9fe0ff">💎+${r.crystals}</span>` : ''}
          ${r.scrolls ? `<span class="row" style="gap:4px">${scrollSvg(22)}+${r.scrolls}</span>` : ''}
          ${got ? `<span class="row" style="gap:4px" title="бонус дня">${coinSvg(22)}+${fmt(got)} бонус</span>` : ''}
          <span class="row" style="gap:4px;color:#9fe0ff">${icon('flag', 18, '#9fe0ff')}+${xp} ПБ</span>
        </div>
        ${it ? `<div class="card col" style="border-color:${ITEM_RARITY[it.rarity].color};gap:2px"><div class="small" style="color:${ITEM_RARITY[it.rarity].color}">${ITEM_RARITY[it.rarity].name} · новое снаряжение</div><b>${esc(it.name)}</b><div class="small">${(Object.entries(it.stats) as [ItemStat, number][]).map(([k, v]) => statText(k, v)).join(' · ')}</div>${r.sold ? '<div class="small muted">Рюкзак был полон — самый слабый предмет продан</div>' : ''}</div>` : ''}
        ${r.crystals ? '<div class="small muted">Кристаллы — на улучшение умений: «Отряд → Умения»</div>' : ''}
        ${r.rating && !got ? '<div class="small muted">Бонус профкоинов за кампанию на сегодня набран — завтра лимит обновится</div>' : ''}
        <button class="btn btn-gold btn-block" data-act="next">${s.stage <= MAX_STAGE ? `Дальше: этап ${chapterOf(s.stage).n}-${((s.stage - 1) % 10) + 1}` : 'Кампания пройдена!'}</button>
        <div class="row" style="gap:8px"><button class="btn btn-blue grow" data-act="squad">Отряд</button><button class="btn btn-ghost grow" data-act="exit">На базу</button></div>`;
    } else {
      haptic('bad');
      s.streakWin = false;
      const wiped = !f.aliveAllies().length;
      const tip = wiped
        ? (boss ? BOSS_TIP[bossMechOf(stage)] : 'Отряд не выдержал: возьми «Перекличку» или «Правовую защиту», вложи перки в стойкость, поставь юриста — он держит удар.')
        : f.taps < f.t * 1.5 ? 'Время вышло: тапай чаще по одной цели и включай атакующие умения.' : 'Время вышло: улучши активистов, перки в силу, снаряжение на атаку, умения — кристаллами.';
      html = `<h2 style="color:#ff8a8a">${wiped ? 'Отряд выбыл' : 'Время вышло'}</h2>
        <div class="muted">Осталось ${Math.round((f.enemyHpLeft / f.enemyHpTotal) * 100)}% здоровья врагов. ${esc(tip)}</div>
        <button class="btn btn-gold btn-block" data-act="retry">Ещё раз</button>
        <button class="btn btn-blue btn-block" data-act="squad">Улучшить отряд и умения</button>
        <button class="btn btn-ghost btn-block" data-act="exit">На базу</button>`;
    }
    node.appendChild(el(`<div class="result"><div class="box">${html}</div></div>`));
    app.update(false);
  };

  onAct(node, {
    exit: () => app.closeOverlay(),
    next: () => { app.closeOverlay(); if (app.state.stage <= MAX_STAGE) openBattle(app); },
    retry: () => { app.closeOverlay(); startFight(app, stage); },
    squad: () => { app.closeOverlay(); app.go('squad'); },
  });
  node.addEventListener('close', () => { f.done = true; cancelAnimationFrame(raf); });
  app.openOverlay(node);
  raf = requestAnimationFrame((n) => { last = n; raf = requestAnimationFrame(loop); });
}
