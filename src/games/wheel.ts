// «Колесо профкома» — урок «казино всегда выигрывает». Колесо намеренно подкручено, как настоящие слоты:
//  • ×10 нарисован крупно, но не выпадает никогда;
//  • первая ставка всегда выигрывает ×2 («везение новичка»);
//  • после выигрыша ×2 всегда проигрыш, после серии из 3–5 проигрышей — снова ×2, чтобы игрок не ушёл;
//  • стрелка замирает на ×10 (или ×2) и переползает на соседний сектор — «почти выиграл»;
//  • тапы ускоряют анимацию, но не меняют результат — чувство контроля тоже приманка.
// В среднем колесо возвращает ~63% ставок. Когда организаторы включают «Разоблачение» (Орг. → Настройки),
// каждый видит, как его подкручивали и сколько он проиграл, а экран в зале — общий итог казино.
import { coinSvg, icon } from '../art/icons';
import { haptic } from '../core/telegram';
import { newCasino, type CasinoState, type CasinoStats } from '../core/casino';
import { esc, el, fmt, toast } from '../lib/dom';
import type { App } from '../ui/app';
import { shell, type PlayCtx } from './kit';

export type Mult = 0 | 1 | 2 | 10;
export interface Sector { mult: Mult; pct: number }

/** Секторы по часовой стрелке от верха. ×10 занимает почти пятую часть колеса — чтобы манить; выпасть он не может.
 *  Порядок подобран так, чтобы рядом с каждым ×0 и ×2 стоял ×10, а рядом с ×1 — ×2: есть где «почти выиграть». */
export const WHEEL: Sector[] = [
  { mult: 2, pct: 8.94 }, { mult: 10, pct: 6.5 }, { mult: 0, pct: 8.94 }, { mult: 1, pct: 8.94 }, { mult: 2, pct: 8.94 }, { mult: 0, pct: 8.94 },
  { mult: 10, pct: 6.5 }, { mult: 2, pct: 8.94 }, { mult: 1, pct: 8.94 }, { mult: 0, pct: 8.94 }, { mult: 10, pct: 6.5 }, { mult: 0, pct: 8.98 },
];

export const BETS = [50, 100, 250, 500, 1000];
export const MAX_BET = 1000;

const COLOR: Record<Mult, [string, string]> = {
  0: ['#2a2d6e', '#8b8fd6'], 1: ['#1f6fae', '#cfe7ff'], 2: ['#2f8f5b', '#d6ffe7'], 10: ['#ffc83d', '#3a2400'],
};

/** Подкрутка: какой множитель выпадет. ×10 — никогда. */
export function rigPick(c: CasinoState, rnd = Math.random): Exclude<Mult, 10> {
  if (c.spins === 0) return 2;               // везение новичка
  if (c.last === 2) return 0;                // после выигрыша — проигрыш
  if (c.streak >= c.need) return 2;          // после серии проигрышей — подачка, чтобы не ушёл
  return rnd() < 0.62 ? 0 : 1;
}
/** Учесть результат в статистике игрока. */
export function rigRecord(c: CasinoState, m: Mult, stake: number, near: boolean, rnd = Math.random) {
  c.spins++; c.bet += stake; c.won += stake * m; c.last = m;
  if (near) c.near++;
  if (m === 2) { c.streak = 0; c.need = 3 + Math.floor(rnd() * 3); } else c.streak++;
  c.best = Math.max(c.best, stake);
}

/** Угол (в градусах от верха, по часовой) начала и конца сектора. */
function sectorSpan(i: number) {
  const a0 = WHEEL.slice(0, i).reduce((a, s) => a + s.pct, 0) * 3.6;
  return [a0, a0 + WHEEL[i].pct * 3.6] as const;
}
const at = (i: number) => (i + WHEEL.length) % WHEEL.length;

/** Где остановиться, чтобы было «почти»: сектор результата рядом с более ценным, стрелка у самой границы.
 *  creep — колесо замирает на ценном секторе и переползает на результат; bounce — проскакивает на ценный и откатывается. */
export function rigLanding(m: Exclude<Mult, 10>, rnd = Math.random) {
  const tease: Mult = m === 1 ? 2 : 10;
  const opts: { i: number; kind: 'creep' | 'bounce' }[] = [];
  WHEEL.forEach((s, i) => {
    if (s.mult !== m) return;
    if (WHEEL[at(i + 1)].mult === tease) opts.push({ i, kind: 'creep' });
    if (WHEEL[at(i - 1)].mult === tease) opts.push({ i, kind: 'bounce' });
  });
  const o = opts[Math.floor(rnd() * opts.length)];
  const [a0, a1] = sectorSpan(o.i);
  const w = a1 - a0;
  const d = w * (0.04 + rnd() * 0.12);       // в нескольких градусах от границы с ценным сектором
  const final = o.kind === 'creep' ? a1 - d : a0 + d;
  const [t0, t1] = sectorSpan(at(o.kind === 'creep' ? o.i + 1 : o.i - 1));
  const tw = t1 - t0;
  const hold = o.kind === 'creep' ? t0 + tw * (0.18 + rnd() * 0.3) : t1 - tw * (0.18 + rnd() * 0.3);
  return { sector: o.i, kind: o.kind, final, hold, tease };
}

function wheelSvg() {
  const R = 150, C = 160;
  const pt = (deg: number, r: number) => { const a = ((deg - 90) * Math.PI) / 180; return `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`; };
  const parts = WHEEL.map((s, i) => {
    const [a0, a1] = sectorSpan(i);
    const large = a1 - a0 > 180 ? 1 : 0;
    const [bg, fg] = COLOR[s.mult];
    const mid = (a0 + a1) / 2;
    const fs = s.mult === 10 ? 22 : 24;
    const lr = R - 36;
    return `<path d="M ${C} ${C} L ${pt(a0, R)} A ${R} ${R} 0 ${large} 1 ${pt(a1, R)} Z" fill="${bg}" stroke="#15173d" stroke-width="2"/>
      <text x="${pt(mid, lr).split(' ')[0]}" y="${pt(mid, lr).split(' ')[1]}" fill="${fg}" font-size="${fs}" font-family="Russo One, sans-serif" text-anchor="middle" dominant-baseline="central" transform="rotate(${mid} ${pt(mid, lr)})">×${s.mult}</text>`;
  }).join('');
  const bulbs = Array.from({ length: 24 }, (_, i) => `<circle class="wh-bulb" style="--i:${i % 2}" cx="${pt(i * 15, R + 6).split(' ')[0]}" cy="${pt(i * 15, R + 6).split(' ')[1]}" r="3.6"/>`).join('');
  return `<svg viewBox="0 0 320 320" class="wh-svg" aria-hidden="true">
    <circle cx="${C}" cy="${C}" r="${R + 10}" fill="#0c0e2e" stroke="#ffc83d" stroke-width="3"/>
    ${bulbs}
    <g data-rot>${parts}<circle cx="${C}" cy="${C}" r="34" fill="#15173d" stroke="#ffc83d" stroke-width="3"/>
      <path d="M${C + 3} ${C - 20} L${C - 10} ${C + 3} H${C} L${C - 4} ${C + 20} L${C + 11} ${C - 4} H${C + 1} Z" fill="#ffc83d"/></g>
  </svg>`;
}

/** Разные «характеры» основного вращения — каждое выглядит по-своему; все гаснут до почти полной остановки. */
const EASE: ((p: number) => number)[] = [
  (p) => 1 - Math.pow(1 - p, 3),
  (p) => 1 - Math.pow(1 - p, 4),
  (p) => 1 - Math.pow(1 - p, 5),
  (p) => (p < 0.35 ? 0.62 * (1 - Math.pow(1 - p / 0.35, 2)) : 0.62 + 0.38 * (1 - Math.pow(1 - (p - 0.35) / 0.65, 3))), // рывок и ещё круг
];

const NEAR_TEXT = ['Чуть-чуть не ×10!', 'Ещё миллиметр — и ×10!', 'Почти ×10!', 'Так близко к ×10!'];

/** Разоблачение: как подкручивали и сколько проиграл. */
export function revealHtml(c: CasinoState, all: CasinoStats | null) {
  const lost = Math.max(0, c.bet - c.won);
  const pct = c.bet ? Math.round((lost / c.bet) * 100) : 0;
  return `<div class="wh-reveal col" style="gap:10px">
    <h2>Казино всегда выигрывает</h2>
    <div class="small">Это колесо было подкручено — так же, как настоящие слоты и онлайн-казино.</div>
    <ul class="small wh-list">
      <li><b>×10 не мог выпасть ни разу.</b> Сектора нарисованы крупно, чтобы манить.</li>
      <li><b>Стрелка специально замирала на ×10</b> и переползала на соседний сектор. «Почти выиграл» держит у экрана сильнее настоящего выигрыша.</li>
      <li><b>Первая ставка всегда выигрывала</b> — «везение новичка», чтобы втянуться.</li>
      <li><b>После выигрыша всегда шёл проигрыш</b>, а после 3–5 проигрышей подряд — снова маленький выигрыш, чтобы не уходил.</li>
      <li><b>Тапы ничего не решали.</b> Они ускоряли анимацию, но не результат: чувство контроля — тоже приманка.</li>
    </ul>
    ${c.spins ? `<div class="card col" style="gap:4px;border-color:#ff8a8a"><b>Твой итог</b>
      <div>Вращений: <b>${fmt(c.spins)}</b> · поставил <b>${fmt(c.bet)}</b> · вернулось <b>${fmt(c.won)}</b></div>
      <div>Казино забрало у тебя <b style="color:#ff8a8a">${fmt(lost)}</b> профкоинов — ${pct}% ставок.</div>
      <div class="small muted">Стрелка «почти» останавливалась на ×10: ${fmt(c.near)} раз. Выпало ×10: 0.</div></div>` : '<div class="card small">Ты ни разу не крутил — и ничего не проиграл. Это и есть единственный способ выиграть у казино.</div>'}
    ${all && all.bet ? `<div class="card col" style="gap:4px"><b>Все участники вместе</b><div>Играли ${fmt(all.players)} человек, ${fmt(all.spins)} вращений: поставили ${fmt(all.bet)}, вернулось ${fmt(all.won)}. Казино заработало <b class="gold">${fmt(all.bet - all.won)}</b>.</div></div>` : ''}
    <div class="small muted">В настоящих казино выигрыш заведения заложен в правила, а «почти выигрыши», бонусы новичкам и редкие подачки подбирают так же, как здесь. Единственный способ не проиграть — не играть.</div>
  </div>`;
}

export function openWheel(app: App, ctx?: PlayCtx) {
  const s = app.state;
  const c = s.casino ?? (s.casino = newCasino());
  const sh = shell(app, 'wheel', ctx, { dark: true });
  sh.setSub('Ставка профкоинами · ×10 ждёт смелых');
  let bet = Math.min(100, Math.max(10, s.coins));
  let spinning = false, angle = 0, stopAnim = () => {};
  let finishNow: (() => void) | null = null;
  const history: number[] = [];
  const node = el(`<div class="wh-game">
    <div class="wh-wrap" data-wheel><div class="wh-pointer" data-ptr></div>${wheelSvg()}<div class="wh-fx" data-fx></div></div>
    <div class="wh-hist" data-hist></div>
    <div class="wh-bets" data-bets></div>
    <button class="btn btn-gold btn-block wh-spin" data-spin>Крутить</button>
    <div class="small muted center" data-note>Во время вращения тапай по колесу — закрутится быстрее</div>
    <button class="btn btn-ghost btn-sm hidden" data-truth>${icon('info', 16)} Как устроено это колесо</button>
  </div>`);
  sh.body.appendChild(node);
  const rot = node.querySelector<SVGGElement>('[data-rot]')!;
  const ptr = node.querySelector<HTMLElement>('[data-ptr]')!;
  const fx = node.querySelector<HTMLElement>('[data-fx]')!;
  const spinBtn = node.querySelector<HTMLButtonElement>('[data-spin]')!;
  const setRot = (a: number) => rot.setAttribute('transform', `rotate(${a} 160 160)`);
  const drawTop = () => sh.setScore(`${fmt(s.coins)}`);
  const drawBets = () => {
    const box = node.querySelector<HTMLElement>('[data-bets]')!;
    box.innerHTML = BETS.map((b) => `<button class="chip ${b === bet ? 'on' : ''}" data-b="${b}" ${b > s.coins || spinning ? 'disabled' : ''}>${fmt(b)}</button>`).join('')
      + `<button class="chip ${bet === Math.min(MAX_BET, s.coins) && !BETS.includes(bet) ? 'on' : ''}" data-b="all" ${s.coins < 10 || spinning ? 'disabled' : ''}>Всё${s.coins > MAX_BET ? ` (${fmt(MAX_BET)})` : ''}</button>`;
    spinBtn.disabled = spinning || s.coins < 10 || bet > s.coins;
    spinBtn.innerHTML = spinning ? 'Крутится…' : s.coins < 10 ? 'Нужно хотя бы 10 профкоинов' : `Крутить за ${coinSvg(18)} ${fmt(bet)}`;
  };
  const drawHist = () => {
    node.querySelector<HTMLElement>('[data-hist]')!.innerHTML = history.slice(0, 10).map((m) => `<span class="wh-h m${m}">×${m}</span>`).join('') || '<span class="small muted">Здесь будут последние результаты</span>';
  };
  node.querySelector('[data-bets]')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-b]');
    if (!b || spinning) return;
    bet = b.dataset.b === 'all' ? Math.min(MAX_BET, s.coins) : Number(b.dataset.b);
    haptic(); drawBets();
  });

  // конфетти и надпись поверх колеса
  const burst = (n: number, big: boolean) => {
    for (let i = 0; i < n; i++) {
      const p = el(`<i class="wh-conf" style="--x:${(Math.random() * 2 - 1) * (big ? 190 : 130)}px;--y:${-(60 + Math.random() * (big ? 220 : 140))}px;--r:${Math.random() * 720 - 360}deg;--d:${(Math.random() * 0.25).toFixed(2)}s;background:${['#ffc83d', '#4fd1a5', '#ff5fa2', '#7ea8ff', '#fff'][i % 5]}"></i>`);
      fx.appendChild(p);
      setTimeout(() => p.remove(), 1600);
    }
  };
  const banner = (text: string, cls: string) => {
    const b = el(`<div class="wh-banner ${cls}">${text}</div>`);
    fx.appendChild(b);
    setTimeout(() => b.remove(), 1900);
  };

  const spin = () => {
    if (spinning) return;
    const stake = Math.min(bet, s.coins, MAX_BET);
    if (stake < 10) { toast('Нужно хотя бы 10 профкоинов', 'bad'); return; }
    spinning = true;
    s.coins -= stake;
    drawTop(); drawBets();
    haptic('heavy');
    const m = rigPick(c);
    const land = rigLanding(m);
    // угол колеса a показывает под стрелкой точку θ = −a (mod 360)
    const turns = 4 + Math.floor(Math.random() * 3);
    const from = angle;
    const toTheta = (base: number, theta: number) => base + ((((-theta - base) % 360) + 360) % 360);
    const aHold = toTheta(from + turns * 360, land.hold);                        // «замерли» на ценном секторе
    const mod = (x: number) => ((x % 360) + 360) % 360;
    const aFinal = land.kind === 'creep' ? aHold + mod(land.hold - land.final) : aHold - mod(land.final - land.hold);
    const ease = EASE[Math.floor(Math.random() * EASE.length)];
    const durA = 3.3 + Math.random() * 1.4;
    const holdS = 0.35 + Math.random() * 0.5;
    const creepS = 0.9 + Math.random() * 0.8;
    let phase: 'spin' | 'hold' | 'creep' = 'spin', p = 0, t = 0, rate = 1, last = performance.now(), lastSector = -1, raf = 0, done = false;
    const sectorAt = (a: number) => { const top = ((-a % 360) + 360) % 360; let acc = 0; for (let k = 0; k < WHEEL.length; k++) { acc += WHEEL[k].pct * 3.6; if (top < acc) return k; } return WHEEL.length - 1; };
    const flick = (a: number) => { const sec = sectorAt(a); if (sec !== lastSector) { lastSector = sec; ptr.classList.remove('flick'); void ptr.offsetWidth; ptr.classList.add('flick'); if (phase !== 'spin') haptic(); } };
    const end = () => {
      if (done) return;
      done = true; cancelAnimationFrame(raf);
      angle = aFinal; setRot(angle);
      const win = stake * m;
      s.coins += win;
      rigRecord(c, m, stake, land.tease === 10);
      history.unshift(m); drawHist();
      spinning = false; finishNow = null;
      drawTop(); drawBets(); app.update(false);
      if (m === 2) { haptic('ok'); burst(30, false); banner(`×2 · +${fmt(win)}! Ещё разок?`, 'win'); }
      else if (m === 1) { haptic('tap'); banner('×1 · почти ×2!', 'even'); }
      else { haptic('bad'); banner(NEAR_TEXT[Math.floor(Math.random() * NEAR_TEXT.length)], 'lose'); }
    };
    finishNow = end;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      rate = 1 + (rate - 1) * Math.pow(0.35, dt); // ускорение от тапов постепенно сходит на нет
      let a = aHold;
      if (phase === 'spin') {
        p = Math.min(1, p + (dt * rate) / durA);
        a = from + (aHold - from) * ease(p);
        if (p >= 1) { phase = 'hold'; t = 0; }
      } else if (phase === 'hold') {
        // стрелка «упирается» в ценный сектор: колесо подрагивает, будто вот-вот остановится
        t += dt * rate;
        a = aHold + Math.sin(t * 38) * 0.7 * (1 - t / holdS);
        if (t >= holdS) { phase = 'creep'; t = 0; }
      } else {
        t += dt * rate;
        const q = Math.min(1, t / creepS);
        const e = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
        a = aHold + (aFinal - aHold) * e;
        if (q >= 1) { setRot(aFinal); flick(aFinal); end(); return; }
      }
      setRot(a); flick(a);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame((n) => { last = n; raf = requestAnimationFrame(tick); });
    stopAnim = () => cancelAnimationFrame(raf);
    // тапы по колесу во время вращения
    boost = () => { rate = Math.min(4, rate + 0.55); haptic(); const r = el('<i class="wh-ring"></i>'); fx.appendChild(r); setTimeout(() => r.remove(), 500); };
  };
  let boost = () => {};
  node.querySelector('[data-wheel]')!.addEventListener('pointerdown', () => { if (spinning) boost(); else spin(); });
  spinBtn.addEventListener('click', spin);

  // разоблачение: организаторы включили — показываем сразу и по кнопке
  const showTruth = async () => {
    const all = await app.backend.casinoStats().catch(() => null);
    const box = el(`<div class="result"><div class="box" style="text-align:left;max-height:calc(100% - 30px);overflow:auto">${revealHtml(c, all)}
      <button class="btn btn-gold btn-block" data-x>Понятно</button></div></div>`);
    box.querySelector('[data-x]')!.addEventListener('click', () => box.remove());
    sh.node.appendChild(box);
  };
  const truthBtn = node.querySelector<HTMLElement>('[data-truth]')!;
  truthBtn.addEventListener('click', () => { if (!spinning) showTruth(); });
  // настройки свежие: организаторы могли включить разоблачение, пока приложение было открыто
  app.backend.config().then((cfg) => {
    app.cfg = cfg;
    if (cfg.casinoReveal) { truthBtn.classList.remove('hidden'); if (!spinning) showTruth(); }
  }).catch(() => {});

  // вышел посреди вращения — результат всё равно засчитывается (ставка уже сделана)
  sh.onExit(() => { stopAnim(); finishNow?.(); });
  setRot(0); drawTop(); drawBets(); drawHist();
}

/** Экран для зала: общий итог казино после разоблачения. */
export function openCasinoBoard(app: App) {
  const node = el(`<div class="screen full voteboard casino-board"><div class="vb-top"><div><div class="vb-kicker">Колесо профкома</div><div class="vb-title">Казино всегда выигрывает</div></div>
    <button class="btn btn-ghost btn-sm" data-x aria-label="Закрыть">${icon('x', 18)}</button></div>
    <div class="cb-grid" data-g><div class="muted">Считаю…</div></div>
    <div class="vb-foot"><span class="muted">×10 не мог выпасть ни разу. Первая ставка всегда выигрывала, после выигрыша всегда шёл проигрыш, а стрелка специально замирала на ×10.</span></div></div>`);
  const g = node.querySelector<HTMLElement>('[data-g]')!;
  const draw = (a: CasinoStats | null) => {
    if (!a) { g.innerHTML = '<div class="muted">Нет данных</div>'; return; }
    const lost = a.bet - a.won;
    g.innerHTML = [
      ['Играли', fmt(a.players), 'человек'], ['Вращений', fmt(a.spins), ''], ['Поставили', fmt(a.bet), 'профкоинов'],
      ['Вернулось', fmt(a.won), 'профкоинов'], ['Казино заработало', fmt(lost), `${a.bet ? Math.round((lost / a.bet) * 100) : 0}% ставок`], ['Стрелка замирала на ×10', fmt(a.near), 'раз'],
      ['Выпало ×10', '0', 'раз'],
    ].map(([k, v, u], i) => `<div class="cb-cell ${i === 4 ? 'big' : ''}" style="--d:${i * 0.25}s"><div class="cb-k">${esc(k)}</div><div class="cb-v">${esc(v)}</div><div class="cb-u">${esc(u)}</div></div>`).join('');
  };
  const load = async () => draw(await app.backend.casinoStats().catch(() => null));
  const timer = window.setInterval(load, 5000);
  const close = () => { clearInterval(timer); node.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  node.querySelector('[data-x]')!.addEventListener('click', close);
  app.root.appendChild(node);
  try { node.requestFullscreen?.().catch(() => {}); } catch { /* браузер не дал */ }
  load();
}
