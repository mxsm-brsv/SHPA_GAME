// «Колесо профкома» — ставка профкоинами и колесо с множителями ×0, ×1, ×2, ×10.
// Честное: результат выбирается случайно по шансам, и ширина сектора на колесе равна его шансу.
// В среднем колесо возвращает 81% ставок (это «налог» профкома и способ тратить профкоины),
// но ×10 действительно выпадает — примерно раз в 50 вращений. Тапы по колесу во время вращения ускоряют его.
import { coinSvg } from '../art/icons';
import { haptic } from '../core/telegram';
import { el, fmt, toast } from '../lib/dom';
import type { App } from '../ui/app';
import { shell, type PlayCtx } from './kit';

export interface Sector { mult: 0 | 1 | 2 | 10; pct: number }

/** Секторы по часовой стрелке от верхней точки. Сумма — 100%. ×0: 55%, ×1: 25%, ×2: 18%, ×10: 2%. */
export const WHEEL: Sector[] = [
  { mult: 0, pct: 14 }, { mult: 1, pct: 6 }, { mult: 2, pct: 6 }, { mult: 0, pct: 13 }, { mult: 1, pct: 7 }, { mult: 10, pct: 2 },
  { mult: 2, pct: 6 }, { mult: 0, pct: 14 }, { mult: 1, pct: 6 }, { mult: 2, pct: 6 }, { mult: 0, pct: 14 }, { mult: 1, pct: 6 },
];
/** Средний возврат ставки (для расчёта экономики): Σ шанс × множитель. */
export const WHEEL_RTP = WHEEL.reduce((a, s) => a + (s.pct / 100) * s.mult, 0);

export const BETS = [50, 100, 250, 500, 1000];
export const MAX_BET = 1000;

const COLOR: Record<Sector['mult'], [string, string]> = {
  0: ['#2a2d6e', '#8b8fd6'], 1: ['#1f6fae', '#cfe7ff'], 2: ['#2f8f5b', '#d6ffe7'], 10: ['#ffc83d', '#3a2400'],
};

/** Честный выбор сектора: случайная точка на окружности, сектор под ней — результат. */
export function spinPick(rnd = Math.random) {
  let x = rnd() * 100;
  for (let i = 0; i < WHEEL.length; i++) { x -= WHEEL[i].pct; if (x < 0) return i; }
  return WHEEL.length - 1;
}

/** Угол (в градусах от верха, по часовой) начала и конца сектора. */
function sectorSpan(i: number) {
  const a0 = WHEEL.slice(0, i).reduce((a, s) => a + s.pct, 0) * 3.6;
  return [a0, a0 + WHEEL[i].pct * 3.6] as const;
}

function wheelSvg() {
  const R = 150, C = 160;
  const pt = (deg: number, r: number) => { const a = ((deg - 90) * Math.PI) / 180; return `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`; };
  const parts = WHEEL.map((s, i) => {
    const [a0, a1] = sectorSpan(i);
    const large = a1 - a0 > 180 ? 1 : 0;
    const [bg, fg] = COLOR[s.mult];
    const mid = (a0 + a1) / 2;
    const fs = s.mult === 10 ? 13 : a1 - a0 > 30 ? 26 : 20;
    const lr = s.mult === 10 ? R - 30 : R - 38;
    return `<path d="M ${C} ${C} L ${pt(a0, R)} A ${R} ${R} 0 ${large} 1 ${pt(a1, R)} Z" fill="${bg}" stroke="#15173d" stroke-width="2"/>
      <text x="${pt(mid, lr).split(' ')[0]}" y="${pt(mid, lr).split(' ')[1]}" fill="${fg}" font-size="${fs}" font-family="Russo One, sans-serif" text-anchor="middle" dominant-baseline="central" transform="rotate(${s.mult === 10 ? mid - 90 : mid} ${pt(mid, lr)})">×${s.mult}</text>`;
  }).join('');
  const bulbs = Array.from({ length: 24 }, (_, i) => `<circle class="wh-bulb" style="--i:${i % 2}" cx="${pt(i * 15, R + 6).split(' ')[0]}" cy="${pt(i * 15, R + 6).split(' ')[1]}" r="3.6"/>`).join('');
  return `<svg viewBox="0 0 320 320" class="wh-svg" aria-hidden="true">
    <circle cx="${C}" cy="${C}" r="${R + 10}" fill="#0c0e2e" stroke="#ffc83d" stroke-width="3"/>
    ${bulbs}
    <g data-rot>${parts}<circle cx="${C}" cy="${C}" r="34" fill="#15173d" stroke="#ffc83d" stroke-width="3"/>
      <path d="M${C + 3} ${C - 20} L${C - 10} ${C + 3} H${C} L${C - 4} ${C + 20} L${C + 11} ${C - 4} H${C + 1} Z" fill="#ffc83d"/></g>
  </svg>`;
}

/** Разные «характеры» замедления — каждое вращение выглядит по-своему. Все заканчиваются ровно в выпавшем секторе;
 *  покачивание в конце — несколько градусов, одинаковое при любом результате. travel — весь путь в градусах. */
const EASE: ((p: number, travel: number) => number)[] = [
  (p) => 1 - Math.pow(1 - p, 3),                                                            // плавно
  (p) => 1 - Math.pow(1 - p, 5),                                                            // долгий «хвост»
  (p, tr) => 1 - Math.pow(1 - p, 4) + (p > 0.8 ? Math.sin((Math.PI * (p - 0.8)) / 0.2) * (6 / tr) : 0), // качнулось и встало
  (p, tr) => 1 - Math.pow(1 - p, 4) + Math.sin(p * Math.PI * 8) * (3 / tr) * (1 - p),     // с дрожью
  (p) => (p < 0.35 ? 0.62 * (1 - Math.pow(1 - p / 0.35, 2)) : 0.62 + 0.38 * (1 - Math.pow(1 - (p - 0.35) / 0.65, 3))), // рывок и ещё круг
];

export function openWheel(app: App, ctx?: PlayCtx) {
  const s = app.state;
  const sh = shell(app, 'wheel', ctx, { dark: true });
  sh.setSub('Ставка профкоинами · шире сектор — чаще выпадает');
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
    setTimeout(() => b.remove(), 1700);
  };

  const spin = () => {
    if (spinning) return;
    const stake = Math.min(bet, s.coins, MAX_BET);
    if (stake < 10) { toast('Нужно хотя бы 10 профкоинов', 'bad'); return; }
    spinning = true;
    s.coins -= stake;
    drawTop(); drawBets();
    haptic('heavy');
    const i = spinPick();
    const [a0, a1] = sectorSpan(i);
    // точка внутри сектора — случайная, с небольшим отступом от границ, чтобы стрелка не стояла ровно на линии
    const inside = a0 + (a1 - a0) * (0.12 + Math.random() * 0.76);
    const turns = 4 + Math.floor(Math.random() * 4);
    const from = angle % 360;
    // колесо вращается по часовой: под стрелкой (верх) окажется точка inside
    const target = from + turns * 360 + ((360 - inside - from) % 360 + 360) % 360;
    const ease = EASE[Math.floor(Math.random() * EASE.length)];
    const dur = 3.6 + Math.random() * 1.8;
    let p = 0, rate = 1, last = performance.now(), lastSector = -1, raf = 0, done = false;
    const sectorAt = (a: number) => { const top = ((360 - (a % 360)) % 360 + 360) % 360; let acc = 0; for (let k = 0; k < WHEEL.length; k++) { acc += WHEEL[k].pct * 3.6; if (top < acc) return k; } return WHEEL.length - 1; };
    const end = () => {
      if (done) return;
      done = true; cancelAnimationFrame(raf);
      angle = target; setRot(angle);
      const m = WHEEL[i].mult;
      const win = stake * m;
      s.coins += win;
      history.unshift(m); drawHist();
      spinning = false; finishNow = null;
      drawTop(); drawBets(); app.update(false);
      if (m === 10) { haptic('heavy'); burst(70, true); banner(`×10 · +${fmt(win)}`, 'jack'); }
      else if (m === 2) { haptic('ok'); burst(28, false); banner(`×2 · +${fmt(win)}`, 'win'); }
      else if (m === 1) { haptic('tap'); banner('×1 · ставка вернулась', 'even'); }
      else { haptic('bad'); banner('×0', 'lose'); }
    };
    finishNow = end;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      rate = 1 + (rate - 1) * Math.pow(0.35, dt); // ускорение от тапов постепенно сходит на нет
      p = Math.min(1, p + (dt * rate) / dur);
      const a = from + (target - from) * ease(p, target - from);
      setRot(a);
      const sec = sectorAt(a);
      if (sec !== lastSector) { lastSector = sec; ptr.classList.remove('flick'); void ptr.offsetWidth; ptr.classList.add('flick'); }
      if (p >= 1) { end(); return; }
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
  // вышел посреди вращения — результат всё равно засчитывается (ставка уже сделана)
  sh.onExit(() => { stopAnim(); finishNow?.(); });
  setRot(0); drawTop(); drawBets(); drawHist();
}
