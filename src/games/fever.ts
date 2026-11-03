// «Профбюро-лихорадка» — мини-игра в духе Cooking Fever: студенты приходят с запросами,
// игрок готовит на станциях и выдаёт, пока не кончилось терпение. Правовой посетитель задаёт вопрос из банка.
import { factionById } from '../config/factions';
import { HEROES } from '../config/heroes';
import { heroSvg } from '../art/hero';
import { coinSvg, icon, starSvg } from '../art/icons';
import { shuffle, type Question } from '../core/questions';
import { haptic } from '../core/telegram';
import { $, el, esc, fmt, onAct, toast } from '../lib/dom';
import type { App } from '../ui/app';
import { reportResult, type PlayCtx } from './kit';

interface Station { id: string; name: string; icon: string; color: string; prep: number; price: number }
const STATIONS: Station[] = [
  { id: 'spravka', name: 'Справка', icon: 'printer', color: '#4c6ef5', prep: 1.1, price: 12 },
  { id: 'pechat', name: 'Печать', icon: 'stamp', color: '#e8453c', prep: 0.8, price: 10 },
  { id: 'bilet', name: 'Профбилет', icon: 'card', color: '#12b886', prep: 1.4, price: 16 },
  { id: 'matpom', name: 'Матпомощь', icon: 'envelope', color: '#f59f00', prep: 1.7, price: 22 },
  { id: 'chai', name: 'Чай', icon: 'cup', color: '#a0522d', prep: 1.0, price: 8 },
  { id: 'putevka', name: 'Путёвка', icon: 'bus', color: '#7048e8', prep: 2.0, price: 30 },
];

const LEVEL_TIME = 75;

function levelCfg(level: number) {
  const st = Math.min(STATIONS.length, 3 + Math.floor((level - 1) / 2));
  return {
    stations: STATIONS.slice(0, st),
    spawnEvery: Math.max(2.2, 5 - level * 0.25),
    patience: Math.max(11, 22 - level * 0.9),
    maxItems: level < 3 ? 2 : 3,
    goal: Math.round(160 + level * 55),
    legal: level >= 2 ? 2 : 1,
  };
}

interface Cust { id: number; slot: number; face: string; needs: string[]; done: boolean[]; patience: number; max: number; legal?: Question; vip?: boolean }

export function openFever(app: App, ctx?: PlayCtx) {
  const s = app.state;
  const f = factionById(s.faction);
  const level = s.fever.level;
  const cfg = levelCfg(level);
  const yesno = shuffle(app.questions.filter((q) => q.format === 'yesno'));
  const faces = HEROES.map((h) => h.id);

  const node = el(`<div class="fever">
    <div class="fever-top">
      <button class="btn btn-ghost btn-sm" data-act="exit" aria-label="Выйти">${icon('back', 18)}</button>
      <div class="grow"><div style="font-family:var(--head)">Профбюро-лихорадка · ур. ${level}</div>
        <div class="row small" style="gap:6px"><span class="fever-goal">Цель ${fmt(cfg.goal)}</span><span class="fever-goal" data-time>${LEVEL_TIME} с</span></div></div>
      <div class="pill">${coinSvg(16)}<span data-earn>0</span></div>
    </div>
    <div class="counter" data-counter></div>
    <div class="combo" data-combo></div>
    <div class="desk"></div>
    <div class="row" style="justify-content:space-between;padding:6px 12px 0"><span class="small" style="font-weight:700">В руках</span>
      <button class="btn btn-blue btn-sm" data-act="ability" style="min-height:32px">${esc(f.ability.name)}</button></div>
    <div class="hands" data-hands></div>
    <div class="stations" data-stations>${cfg.stations.map((st) => `
      <button class="station" data-act="station" data-id="${st.id}"><div class="si" style="background:${st.color}">${icon(st.icon, 26, '#fff')}</div>${st.name}<div class="prog"><i style="width:0"></i></div></button>`).join('')}
      ${STATIONS.slice(cfg.stations.length).map((st) => `<div class="station locked"><div class="si" style="background:#555">${icon('lock', 22, '#fff')}</div>${st.name}</div>`).join('')}
    </div>
    <div data-overlay></div>
  </div>`);

  // ---------- Состояние уровня ----------
  let time = LEVEL_TIME, earned = 0, served = 0, lost = 0, combo = 0, lastServe = -10;
  let spawnT = 0.6, nextId = 1, legalLeft = cfg.legal;
  let handsCap = 3;
  const hands: string[] = [];
  const slots: (Cust | null)[] = [null, null, null];
  const prep = new Map<string, number>();   // станция → оставшееся время готовки
  let lastLeft: Cust | null = null;
  const fx = { fastUntil: 0, handsUntil: 0, calmUntil: 0, helperUntil: 0, comboX2Until: 0, preFilled: 0, helperT: 0 };
  let abilityUsed = false;
  let paused = false;
  let ended = false;
  let raf = 0;
  let last = performance.now();
  const elapsed = () => LEVEL_TIME - time;

  const counter = $(node, '[data-counter]');
  const handsEl = $(node, '[data-hands]');

  const drawHands = () => {
    const cap = elapsed() < fx.handsUntil ? 6 : handsCap;
    handsEl.innerHTML = Array.from({ length: cap }, (_, i) => {
      const it = hands[i];
      const st = STATIONS.find((x) => x.id === it);
      return `<button class="hand ${st ? 'full' : ''}" data-act="drop" data-i="${i}" aria-label="${st ? `Выбросить: ${st.name}` : 'Пусто'}">${st ? `<div class="si" style="width:34px;height:34px;border-radius:9px;display:grid;place-items:center;background:${st.color}">${icon(st.icon, 20, '#fff')}</div>` : ''}</button>`;
    }).join('');
  };

  const custHtml = (c: Cust) => `
    <div class="cust enter" data-act="serve" data-slot="${c.slot}">
      <div class="bubble">${c.legal ? `<div class="need" style="width:auto;padding:0 8px;background:#efe5ff;color:#5b2fb0;font-weight:800;font-size:12px">${icon('scales', 16, '#5b2fb0')}&nbsp;Вопрос</div>`
        : c.needs.map((n, i) => { const st = STATIONS.find((x) => x.id === n)!; return `<div class="need ${c.done[i] ? 'done' : ''}">${icon(st.icon, 18, c.done[i] ? '#22a95e' : st.color)}</div>`; }).join('')}</div>
      ${c.vip || c.legal ? `<span class="vip">${c.legal ? 'ПРАВО' : 'VIP'}</span>` : ''}
      <div style="width:84px;height:84px;border-radius:50%;overflow:hidden;background:#ffffff22">${heroSvg(c.face, 84)}</div>
      <div class="pat"><i style="width:${(c.patience / c.max) * 100}%"></i></div>
    </div>`;

  const drawSlot = (i: number) => {
    const c = slots[i];
    const cell = counter.children[i] as HTMLElement;
    cell.innerHTML = c ? custHtml(c) : '';
  };
  counter.innerHTML = '<div></div><div></div><div></div>';

  const spawn = () => {
    const free = slots.findIndex((x) => !x);
    if (free < 0) return;
    const legal = legalLeft > 0 && yesno.length > 0 && Math.random() < 0.18;
    const n = 1 + Math.floor(Math.random() * cfg.maxItems);
    const needs = legal ? [] : Array.from({ length: n }, () => cfg.stations[Math.floor(Math.random() * cfg.stations.length)].id);
    const max = cfg.patience * (legal ? 1.4 : 1) + n * 3;
    const c: Cust = { id: nextId++, slot: free, face: faces[Math.floor(Math.random() * faces.length)], needs, done: needs.map(() => false), patience: max, max, vip: !legal && Math.random() < 0.12 };
    if (legal) { c.legal = yesno.pop(); legalLeft--; }
    if (fx.preFilled > 0 && needs.length) { c.done[0] = true; fx.preFilled--; }
    slots[free] = c;
    drawSlot(free);
  };

  const pay = (c: Cust, bonus = 0) => {
    const base = c.needs.reduce((a, n) => a + STATIONS.find((x) => x.id === n)!.price, 0) + bonus;
    const tip = Math.round(base * 0.6 * (c.patience / c.max));
    if (elapsed() - lastServe < 5) combo += elapsed() < fx.comboX2Until ? 2 : 1; else combo = 1;
    lastServe = elapsed();
    const mult = 1 + Math.min(10, combo - 1) * 0.1;
    const total = Math.round((base + tip) * mult * (c.vip ? 1.5 : 1));
    earned += total;
    served++;
    $(node, '[data-earn]').textContent = fmt(earned);
    $(node, '[data-combo]').textContent = combo > 1 ? `Комбо ×${mult.toFixed(1)}` : '';
    const cell = counter.children[c.slot] as HTMLElement;
    const r = cell.getBoundingClientRect();
    const fl = el(`<div class="float-num" style="left:${r.left + r.width / 2}px;top:${r.top + 30}px">+${total}</div>`);
    document.body.appendChild(fl); setTimeout(() => fl.remove(), 1200);
    slots[c.slot] = null;
    drawSlot(c.slot);
    haptic('ok');
  };

  const leave = (c: Cust) => {
    slots[c.slot] = null;
    lastLeft = c;
    lost++;
    combo = 0;
    $(node, '[data-combo]').textContent = '';
    drawSlot(c.slot);
    haptic('bad');
  };

  const askLegal = (c: Cust) => {
    const q = c.legal!;
    paused = true;
    const ov = $(node, '[data-overlay]');
    ov.innerHTML = `<div class="result"><div class="box" style="text-align:left">
      <div class="small muted">Правовая консультация · ${esc(q.topic)}</div>
      <div style="font-size:17px;font-weight:600;line-height:1.35">${esc(q.question)}</div>
      <div class="yn"><button class="ans" data-v="true">Да</button><button class="ans" data-v="false">Нет</button></div>
      <div data-res></div></div></div>`;
    ov.querySelectorAll<HTMLElement>('.ans').forEach((b) => b.addEventListener('click', async () => {
      ov.querySelectorAll<HTMLButtonElement>('.ans').forEach((x) => (x.disabled = true));
      const r = await app.backend.checkAnswer(q, b.dataset.v === 'true');
      b.classList.add(r.correct ? 'ok' : 'no');
      (r.correct ? s.law.right : s.law.wrong)[q.id] = 1;
      haptic(r.correct ? 'ok' : 'bad');
      $(ov, '[data-res]').innerHTML = `<div class="explain"><b>${r.correct ? 'Верно! Большие чаевые' : 'Неверно — посетитель ушёл'}</b><div class="small" style="margin-top:4px">${esc(r.explanation)}</div></div>
        <button class="btn btn-gold btn-block" data-go style="margin-top:8px">Продолжить</button>`;
      $(ov, '[data-go]').addEventListener('click', () => {
        ov.innerHTML = '';
        paused = false;
        last = performance.now();
        if (slots[c.slot] !== c) return;
        if (r.correct) pay(c, 60); else leave(c);
      });
    }));
  };

  const serve = (slot: number) => {
    const c = slots[slot];
    if (!c) return;
    if (c.legal) { askLegal(c); return; }
    let gave = false;
    c.needs.forEach((n, i) => {
      if (c.done[i]) return;
      const h = hands.indexOf(n);
      if (h >= 0) { hands.splice(h, 1); c.done[i] = true; gave = true; }
    });
    if (!gave) { haptic('bad'); toast('В руках нет того, что нужно этому студенту', 'bad'); return; }
    drawHands();
    if (c.done.every(Boolean)) pay(c); else { drawSlot(slot); haptic(); }
  };

  const tapStation = (id: string) => {
    const cap = elapsed() < fx.handsUntil ? 6 : handsCap;
    if (prep.has(id)) return;
    if (hands.length + prep.size >= cap) { haptic('bad'); toast('Руки заняты — выдай или выброси', 'bad'); return; }
    const st = STATIONS.find((x) => x.id === id)!;
    prep.set(id, st.prep);
    haptic();
  };

  const useAbility = () => {
    if (abilityUsed) { toast('Способность уже использована на этом уровне', 'info'); return; }
    abilityUsed = true;
    const t = elapsed();
    const busy = slots.filter(Boolean) as Cust[];
    switch (f.id) {
      case 'inei': { const c = busy.find((x) => !x.legal); if (c) { c.done = c.done.map(() => true); pay(c); } break; }
      case 'ire': fx.fastUntil = t + 10; break;
      case 'gpi': fx.calmUntil = t + 8; break; // «видеть» очередь заменяем короткой паузой терпения
      case 'igvie': fx.handsUntil = t + 20; drawHands(); break;
      case 'ievt': if (lastLeft && slots.some((x) => !x)) { const free = slots.findIndex((x) => !x); lastLeft.slot = free; lastLeft.patience = lastLeft.max; slots[free] = lastLeft; lost--; drawSlot(free); lastLeft = null; } break;
      case 'iete': busy.forEach((c) => (c.patience = c.max)); break;
      case 'enmi': fx.helperUntil = t + 20; break;
      case 'itae': fx.comboX2Until = t + 30; break;
      case 'ivti': fx.preFilled = 5; break;
      case 'iee': fx.calmUntil = t + 20; break;
    }
    haptic('heavy');
    toast(`${f.ability.name}: ${f.ability.text}`, 'ok');
    ($(node, '[data-act="ability"]') as HTMLButtonElement).disabled = true;
  };

  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && !ended) {
      time -= dt;
      const t = elapsed();
      $(node, '[data-time]').textContent = `${Math.ceil(Math.max(0, time))} с`;
      spawnT -= dt;
      if (spawnT <= 0 && time > 6) { spawn(); spawnT = cfg.spawnEvery * (0.7 + Math.random() * 0.6); }
      // терпение
      for (const c of slots) {
        if (!c) continue;
        if (t >= fx.calmUntil) c.patience -= dt;
        const bar = counter.children[c.slot]?.querySelector<HTMLElement>('.pat > i');
        if (bar) { const p = c.patience / c.max; bar.style.width = `${p * 100}%`; bar.style.background = p > 0.5 ? '#45d483' : p > 0.25 ? '#ffc83d' : '#ff5a5f'; }
        if (c.patience <= 0) leave(c);
      }
      // готовка
      const speed = t < fx.fastUntil ? 2 : 1;
      prep.forEach((left, id) => {
        const st = STATIONS.find((x) => x.id === id)!;
        const nl = left - dt * speed;
        const stEl = node.querySelector<HTMLElement>(`.station[data-id="${id}"]`)!;
        const bar = stEl.querySelector<HTMLElement>('.prog > i')!;
        if (nl <= 0) { prep.delete(id); hands.push(id); bar.style.width = '0'; stEl.classList.add('ready'); setTimeout(() => stEl.classList.remove('ready'), 250); drawHands(); }
        else { prep.set(id, nl); bar.style.width = `${(1 - nl / st.prep) * 100}%`; }
      });
      // помощник «Стаи»
      if (t < fx.helperUntil) {
        fx.helperT -= dt;
        if (fx.helperT <= 0) {
          fx.helperT = 1.5;
          const need = (slots.filter(Boolean) as Cust[]).flatMap((c) => c.needs.filter((_, i) => !c.done[i]));
          const id = need.find((n) => !hands.includes(n) && !prep.has(n));
          if (id && hands.length < 6) { hands.push(id); drawHands(); }
        }
      }
      if (time <= 0) { finish(); return; }
    }
    raf = requestAnimationFrame(loop);
  };

  const finish = async () => {
    ended = true;
    cancelAnimationFrame(raf);
    const stars = earned >= cfg.goal * 2 ? 3 : earned >= cfg.goal * 1.5 ? 2 : earned >= cfg.goal ? 1 : 0;
    const coins = Math.round(earned * 1.5);
    s.coins += coins;
    const prev = s.fever.stars[level] ?? 0;
    if (stars > prev) s.fever.stars[level] = stars;
    if (stars > 0 && level === s.fever.level) s.fever.level++;
    const got = await reportResult(app, 'fever', earned, Math.max(stars * 10, Math.min(9, served)), ctx);
    $(node, '[data-overlay]').innerHTML = `<div class="result"><div class="box">
      <h2 style="color:${stars ? 'var(--gold2)' : '#ff8a8a'}">${stars ? 'Смена закрыта!' : 'Цель не набрана'}</h2>
      <div class="row" style="justify-content:center;gap:6px">${[1, 2, 3].map((k) => starSvg(40, k <= stars ? '#ffd76a' : '#3a3f9a')).join('')}</div>
      <div>Обслужено ${served}, ушли ${lost} · выручка ${fmt(earned)} из ${fmt(cfg.goal)}</div>
      <div class="row" style="justify-content:center;gap:14px;font-weight:800;font-size:18px"><span class="row" style="gap:4px">${coinSvg(20)}+${fmt(coins)}</span>${got ? `<span class="row" style="gap:4px">${starSvg(18)}+${got}</span>` : ''}</div>
      <button class="btn btn-gold btn-block" data-again>${stars ? `Уровень ${s.fever.level}` : 'Ещё раз'}</button>
      <button class="btn btn-ghost btn-block" data-act="exit">Выйти</button></div></div>`;
    $(node, '[data-again]').addEventListener('click', () => { app.closeOverlay(); openFever(app, ctx); });
    app.update(false);
  };

  onAct(node, {
    exit: () => app.closeOverlay(),
    station: (t) => tapStation(t.dataset.id!),
    serve: (t) => serve(Number(t.dataset.slot)),
    drop: (t) => { const i = Number(t.dataset.i); if (hands[i]) { hands.splice(i, 1); drawHands(); haptic(); } },
    ability: () => useAbility(),
  });
  node.addEventListener('close', () => { ended = true; cancelAnimationFrame(raf); });
  drawHands();
  app.openOverlay(node);
  raf = requestAnimationFrame((n) => { last = n; loop(n); });
}
