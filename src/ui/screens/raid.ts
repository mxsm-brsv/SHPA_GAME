// «Захват профкома»: цепочка боссов-организаторов для каждого профбюро. Штурм — бой на 15 секунд: тапай по боссу,
// серия тапов умножает урон, во время «умения» босса (щит) удары не проходят и серия сбрасывается.
// Сервер хранит общий прогресс профбюро, ограничивает урон силой отряда и даёт штурмовать раз в 20 минут.
import { factionById } from '../../config/factions';
import { coinSvg, icon } from '../../art/icons';
import { totemSvg } from '../../art/totems';
import { BOSS_SKILLS, initials, raidCoins, type RaidBoss, type RaidState } from '../../core/raid';
import { haptic } from '../../core/telegram';
import { $, el, esc, fmt, mmss, onAct, toast } from '../../lib/dom';
import type { App } from '../app';

const FIGHT_S = 15;

export function openRaid(app: App) {
  const s = app.state;
  let st: RaidState | null = null;
  const node = el(`<div class="screen full raid"><div class="page">
    <div class="row"><button class="btn btn-ghost btn-sm" data-act="exit" aria-label="Назад">${icon('back', 18)}</button>
      <div class="grow"><h1 style="font-size:24px">Захват профкома</h1><div class="small muted">Боссы — организаторы. Пройди всех — профком твоего ПБ</div></div></div>
    <div data-rb class="col" style="gap:10px"><div class="muted">Загрузка…</div></div></div>
    <div class="rd-fight hidden" data-fight></div></div>`);
  const body = $(node, '[data-rb]');
  const fight = $(node, '[data-fight]');
  let timer = 0;

  const bossCard = (b: RaidBoss, state: 'done' | 'now' | 'next', left?: number) => `<div class="rd-boss ${state}">
    <div class="rd-ava">${esc(initials(b.name))}</div>
    <div class="grow"><b>${esc(b.name)}</b><div class="small muted">${esc(b.title)} · ${esc(BOSS_SKILLS[b.i % BOSS_SKILLS.length])}</div>
      ${state === 'now' && left !== undefined ? `<div class="rd-hp"><i style="width:${Math.max(0, (left / b.hp) * 100)}%"></i></div><div class="small">${fmt(left)} из ${fmt(b.hp)}</div>` : ''}</div>
    <span class="small ${state === 'done' ? 'gold' : 'muted'}">${state === 'done' ? 'повержен' : state === 'now' ? 'сейчас' : fmt(b.hp)}</span></div>`;

  const draw = () => {
    if (!st) { body.innerHTML = '<div class="card muted">Нет связи — попробуй позже</div>'; return; }
    const r = st;
    const hold = r.holder ? factionById(r.holder.faction) : null;
    const my = r.my;
    const staff = s.role === 'staff' || s.role === 'admin' || !my;
    const cur = my && !my.done ? r.bosses[my.boss] : null;
    body.innerHTML = `<div class="card row" style="gap:10px;border-color:${hold ? hold.color : 'var(--gold)'}">${totemSvg(factionById(r.holder ? r.holder.faction : 'profkom'), 44)}
        <div class="grow">${hold ? `Профком захватили <b style="color:${hold.color}">${hold.short}</b>` : '<b>Профком пока никто не захватил</b>'}
        <div class="small muted">Всего боссов: ${r.bosses.length}. Без штурмов босс восстанавливает 10% здоровья в час. Штурм — раз в ${r.cooldownMin} мин.</div></div></div>
      ${staff ? '<div class="card small">Организаторы — боссы. Штурмуют участники своим профбюро.</div>' : ''}
      ${my && !staff ? `<div class="card col" style="gap:8px"><div class="row"><b class="grow">${factionById(my.faction).short}: ${my.done ? 'профком пройден!' : `босс ${my.boss + 1} из ${r.bosses.length}`}</b></div>
        ${cur ? bossCard(cur, 'now', cur.hp - my.dmg) : ''}
        <button class="btn btn-red btn-block rd-go" data-act="go" ${my.done || my.cooldownLeft > 0 ? 'disabled' : ''}>${my.done ? 'Все боссы повержены' : my.cooldownLeft > 0 ? `Отряд отдыхает · <span data-cd>${mmss(my.cooldownLeft)}</span>` : `${icon('swords', 18)} В бой · 15 секунд`}</button>
        <div class="small muted">Тапай по боссу: серия тапов — до ×3 урона. Когда босс применяет умение — не бей, иначе серия сгорит. За штурм — профкоины.</div></div>` : ''}
      ${r.leaders.length ? `<div class="section-h">Кто ближе к профкому</div><div class="list">${r.leaders.map((x) => `<div class="li"><span class="grow"><b style="color:${factionById(x.faction).color}">${factionById(x.faction).short}</b></span><span class="small">${x.done ? 'прошли всех' : `${x.boss} из ${r.bosses.length}`}</span></div>`).join('')}</div>` : ''}
      <div class="section-h">Боссы</div>
      <div class="col" style="gap:6px">${r.bosses.map((b) => bossCard(b, my && b.i < my.boss ? 'done' : my && b.i === my.boss && !my.done ? 'now' : 'next', my && b.i === my.boss ? b.hp - my.dmg : undefined)).join('') || '<div class="small muted">Организаторы ещё не в списке выезда</div>'}</div>`;
  };

  const load = async () => { st = await app.backend.raidState(); draw(); };

  // ---------- бой ----------
  const startFight = () => {
    const r = st;
    const my = r?.my;
    if (!r || !my || my.done) return;
    const boss = r.bosses[my.boss];
    const left0 = boss.hp - my.dmg;
    const perTap = Math.max(20, my.power / 25);
    let dealt = 0, combo = 0, shieldUntil = 0, nextSkill = 2.2 + Math.random() * 1.2, t = 0, lastTap = 0, over = false, raf = 0, last = performance.now();
    node.scrollTop = 0; node.classList.add('fighting');
    fight.classList.remove('hidden');
    fight.innerHTML = `<div class="rd-ftop"><b>${esc(boss.name)}</b><span class="small muted">${esc(boss.title)}</span>
        <div class="rd-hp big"><i data-hp style="width:${(left0 / boss.hp) * 100}%"></i></div>
        <div class="rd-time"><i data-time></i></div></div>
      <div class="rd-arena" data-arena><div class="rd-bigava" data-ava>${esc(initials(boss.name))}</div><div class="rd-skill hidden" data-skill></div>
        <div class="rd-combo" data-combo></div><div class="rd-dmg" data-dmg>0</div></div>
      <div class="small muted center" style="padding:6px">Тапай по боссу! Щит — не бей</div>`;
    const arena = $(fight, '[data-arena]'), ava = $(fight, '[data-ava]'), skill = $(fight, '[data-skill]');
    const hpEl = $(fight, '[data-hp]'), timeEl = $(fight, '[data-time]'), comboEl = $(fight, '[data-combo]'), dmgEl = $(fight, '[data-dmg]');
    const pop = (txt: string, x: number, y: number, cls = '') => { const p = el(`<div class="rd-pop ${cls}" style="left:${x}px;top:${y}px">${txt}</div>`); arena.appendChild(p); setTimeout(() => p.remove(), 700); };
    arena.addEventListener('pointerdown', (e) => {
      if (over) return;
      const now = performance.now();
      if (now - lastTap < 70) return; // не чаще ~14 тапов в секунду
      lastTap = now;
      const rect = arena.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (t < shieldUntil) { combo = 0; pop('Блок!', x, y, 'bad'); haptic('bad'); comboEl.textContent = ''; return; }
      combo++;
      const mult = 1 + Math.min(40, combo) / 20;
      const crit = Math.random() < 0.08;
      const d = Math.round(perTap * mult * (crit ? 2 : 1));
      dealt += d;
      pop(`${crit ? 'Крит! ' : ''}−${fmt(d)}`, x, y, crit ? 'crit' : '');
      ava.classList.remove('hit'); void ava.offsetWidth; ava.classList.add('hit');
      comboEl.textContent = combo >= 5 ? `серия ×${mult.toFixed(1)}` : '';
      dmgEl.textContent = fmt(dealt);
      hpEl.style.width = `${Math.max(0, ((left0 - dealt) / boss.hp) * 100)}%`;
      if (combo % 10 === 0) haptic('ok'); else haptic();
    });
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      timeEl.style.width = `${Math.max(0, (1 - t / FIGHT_S) * 100)}%`;
      if (t >= nextSkill) {
        shieldUntil = t + 1.1;
        nextSkill = t + 2.4 + Math.random() * 1.4;
        skill.textContent = `${BOSS_SKILLS[Math.floor(Math.random() * BOSS_SKILLS.length)]}!`;
        skill.classList.remove('hidden'); arena.classList.add('shield');
      } else if (t >= shieldUntil && arena.classList.contains('shield')) { skill.classList.add('hidden'); arena.classList.remove('shield'); }
      if (t >= FIGHT_S || dealt >= left0) { finish(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame((n) => { last = n; raf = requestAnimationFrame(tick); });
    const finish = async () => {
      if (over) return;
      over = true; cancelAnimationFrame(raf);
      arena.classList.remove('shield'); skill.classList.add('hidden');
      try {
        const res = await app.backend.raidHit(dealt);
        st = res.state;
        const coins = raidCoins(res.dealt);
        s.coins += coins; app.update(false);
        haptic(res.defeated ? 'heavy' : 'ok');
        fight.innerHTML = `<div class="result"><div class="box">
          <h2 style="color:var(--gold2)">${res.captured ? 'Профком захвачен!' : res.defeated ? 'Босс повержен!' : 'Штурм окончен'}</h2>
          <div>${res.captured ? `Твоё профбюро прошло всех боссов — профком ваш. Последний — ${esc(res.boss)}.` : res.defeated ? `«${esc(res.boss)}» повержен — дальше следующий босс.` : `Урон по «${esc(res.boss)}» засчитан профбюро.`}</div>
          <div style="font-family:var(--head);font-size:40px;color:var(--gold2)">−${fmt(res.dealt)}</div>
          ${res.dealt < dealt ? '<div class="small muted">Засчитано меньше: урон за штурм — не больше 6 × сила отряда (или сколько осталось у босса)</div>' : ''}
          <div class="row" style="justify-content:center;gap:6px;font-weight:800;font-size:18px">${coinSvg(20)}+${fmt(coins)}</div>
          <div class="small muted">Следующий штурм — через ${st.cooldownMin} мин. Позови своё ПБ: босс восстанавливается, если его не бить.</div>
          <button class="btn btn-gold btn-block" data-x>Хорошо</button></div></div>`;
        if (res.defeated) toast(res.captured ? 'Профком захвачен!' : 'Босс повержен!', 'ok');
      } catch (e) {
        fight.innerHTML = `<div class="result"><div class="box"><h2>Не засчитано</h2><div>${esc((e as Error).message)}</div><button class="btn btn-gold btn-block" data-x>Понятно</button></div></div>`;
      }
      fight.querySelector('[data-x]')?.addEventListener('click', () => { fight.classList.add('hidden'); fight.innerHTML = ''; node.classList.remove('fighting'); draw(); });
    };
  };

  onAct(node, {
    exit: () => app.closeOverlay(),
    go: () => startFight(),
  });
  timer = window.setInterval(() => {
    if (!st?.my || st.my.cooldownLeft <= 0) return;
    st.my.cooldownLeft = Math.max(0, st.my.cooldownLeft - 1000);
    const cd = node.querySelector('[data-cd]');
    if (cd) cd.textContent = mmss(st.my.cooldownLeft);
    if (st.my.cooldownLeft === 0 && fight.classList.contains('hidden')) draw();
  }, 1000);
  node.addEventListener('close', () => clearInterval(timer));
  app.openOverlay(node);
  load();
}
