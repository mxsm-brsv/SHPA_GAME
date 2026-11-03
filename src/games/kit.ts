// Общие детали мини-игр: оболочка экрана, итог, начисление рейтинга и очков мероприятия.
import { DAILY_MINIGAME_CAP } from '../config/economy';
import { gameById, type GameId } from '../config/minigames';
import { coinSvg, icon, starSvg } from '../art/icons';
import { $, el, esc, fmt, onAct } from '../lib/dom';
import type { App } from '../ui/app';

export interface PlayCtx { eventKey?: string; eventName?: string }

export interface Shell { node: HTMLElement; body: HTMLElement; setScore(v: string): void; setSub(v: string): void; onExit(fn: () => void): void }

/** Полноэкранная оболочка мини-игры: назад, название, счёт, тело. */
export function shell(app: App, id: GameId, ctx?: PlayCtx, opts: { dark?: boolean } = {}): Shell {
  const g = gameById(id);
  const node = el(`<div class="screen full mg ${opts.dark ? 'mg-dark' : ''}" style="--gc:${g.color}">
    <div class="mg-top">
      <button class="btn btn-ghost btn-sm" data-act="exit" aria-label="Выйти">${icon('back', 18)}</button>
      <div class="grow"><div class="mg-title">${esc(g.name)}${ctx?.eventName ? ` · <span class="gold">${esc(ctx.eventName)}</span>` : ''}</div><div class="small muted" data-sub>${esc(g.mech)}</div></div>
      <div class="mg-score" data-score></div>
    </div>
    <div class="mg-body" data-body></div>
  </div>`);
  let exitFn = () => {};
  onAct(node, { exit: () => { exitFn(); app.closeOverlay(); } });
  node.addEventListener('close', () => exitFn());
  app.openOverlay(node);
  return {
    node,
    body: $(node, '[data-body]'),
    setScore: (v) => { $(node, '[data-score]').textContent = v; },
    setSub: (v) => { $(node, '[data-sub]').textContent = v; },
    onExit: (fn) => { exitFn = fn; },
  };
}

/** Записывает результат: лучший за день, рейтинг в лимите, очки мероприятия. */
export async function reportResult(app: App, id: GameId, score: number, ratingValue: number, ctx?: PlayCtx) {
  const s = app.state;
  if (score > (s.daily.best[id] ?? 0)) s.daily.best[id] = score;
  const got = await app.backend.addGameRating(s, id, Math.min(DAILY_MINIGAME_CAP, ratingValue));
  if (ctx?.eventKey) await app.backend.submitEventScore(s, ctx.eventKey, score);
  app.update(false);
  return got;
}

/** Итоговое окно поверх игры. */
export function showResult(app: App, sh: Shell, o: { title: string; good: boolean; score: number; scoreLabel?: string; lines?: string[]; coins?: number; got: number; value: number; again: () => void; ctx?: PlayCtx }) {
  if (o.coins) app.state.coins += o.coins;
  const box = el(`<div class="result"><div class="box">
    <h2 style="color:${o.good ? 'var(--gold2)' : '#ff8a8a'}">${esc(o.title)}</h2>
    <div style="font-family:var(--head);font-size:40px;color:var(--gold2)">${fmt(o.score)}</div>
    <div class="small muted">${esc(o.scoreLabel ?? 'очков')}</div>
    ${(o.lines ?? []).map((l) => `<div>${esc(l)}</div>`).join('')}
    <div class="row" style="justify-content:center;gap:14px;font-weight:800;font-size:18px">
      ${o.coins ? `<span class="row" style="gap:4px">${coinSvg(20)}+${fmt(o.coins)}</span>` : ''}
      <span class="row" style="gap:4px">${starSvg(18)}+${o.got}</span>
    </div>
    ${o.got < o.value ? `<div class="small muted">В зачёт идёт лучший результат дня — до ${DAILY_MINIGAME_CAP} баллов, всего от игры — до 100 в сутки.</div>` : ''}
    ${o.ctx?.eventKey ? `<div class="small gold">Результат ушёл в зачёт мероприятия «${esc(o.ctx.eventName ?? '')}»</div>` : ''}
    <button class="btn btn-gold btn-block" data-again>Ещё раз</button>
    <button class="btn btn-ghost btn-block" data-x>Выйти</button></div></div>`);
  $(box, '[data-again]').addEventListener('click', () => { box.remove(); o.again(); });
  $(box, '[data-x]').addEventListener('click', () => app.closeOverlay());
  sh.node.appendChild(box);
  app.update(false);
}

/** Плавный цикл анимации с паузой при скрытии вкладки. */
export function loop(step: (dt: number, t: number) => boolean | void) {
  let raf = 0, last = performance.now(), stopped = false, t = 0;
  const f = (now: number) => {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    if (step(dt, t) === false) { stopped = true; return; }
    raf = requestAnimationFrame(f);
  };
  raf = requestAnimationFrame((n) => { last = n; raf = requestAnimationFrame(f); });
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

/** Canvas под размер контейнера с учётом плотности пикселей. */
export function fitCanvas(c: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  c.style.width = `${w}px`; c.style.height = `${h}px`;
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}
