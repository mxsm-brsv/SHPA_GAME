// Нарисованная карта: SVG-мир по настоящему плану (1 единица = 1 метр) с перетаскиванием и масштабом
// (пальцами, колесом, кнопками). Метки игры держат постоянный размер на экране — при приближении не раздуваются.
import { mapBaseSvg } from '../art/mapArt';
import { MARKER_CSS } from '../art/mapMarkers';
import { CAMPUS } from './campusData';

const W = CAMPUS.W, H = CAMPUS.H;
/** При такой ширине видимой области метки рисуются в своём «родном» размере. */
const MK_REF = 640;
const MIN_W = 170;
let baseCache = '';

export interface DrawnView {
  setOverlay(svg: string): void;
  focus(xy: [number, number], zoom?: number): void;
  zoomBy(k: number): void;
  destroy(): void;
}

export function createDrawnMap(container: HTMLElement, onSelect: (sel: string) => void): DrawnView {
  if (!baseCache) baseCache = mapBaseSvg();
  container.innerHTML = `<svg class="drawn-map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Карта кампуса МЭИ и Лефортово">
    <style>${MARKER_CSS}</style><g data-base>${baseCache}</g><g data-overlay></g></svg>`;
  const svg = container.querySelector('svg')!;
  const overlay = svg.querySelector('[data-overlay]')!;

  // видимая область в координатах мира
  const vb = { x: 820, y: 860, w: 420, h: 420 };
  let mk = 0;
  /** Масштаб меток: обратно пропорционален приближению, в разумных пределах. */
  const scaleMarkers = (force = false) => {
    const k = Math.max(0.28, Math.min(1.5, vb.w / MK_REF));
    if (!force && Math.abs(k - mk) < 0.004) return;
    mk = k;
    overlay.querySelectorAll('.mks').forEach((g) => g.setAttribute('transform', `scale(${k.toFixed(3)})`));
  };
  const fit = () => {
    const r = container.getBoundingClientRect();
    const aspect = r.width / Math.max(1, r.height);
    vb.h = vb.w / aspect;
    clamp();
    apply();
  };
  const clamp = () => {
    vb.w = Math.max(MIN_W, Math.min(W, vb.w));
    const r = container.getBoundingClientRect();
    vb.h = vb.w / (r.width / Math.max(1, r.height));
    if (vb.h > H) { vb.h = H; vb.w = H * (r.width / Math.max(1, r.height)); }
    vb.x = Math.max(-40, Math.min(W - vb.w + 40, vb.x));
    vb.y = Math.max(-40, Math.min(H - vb.h + 40, vb.y));
  };
  const apply = () => { svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); scaleMarkers(); };
  const toWorld = (cx: number, cy: number) => {
    const r = container.getBoundingClientRect();
    return { x: vb.x + ((cx - r.left) / r.width) * vb.w, y: vb.y + ((cy - r.top) / r.height) * vb.h };
  };
  const zoomAt = (k: number, cx: number, cy: number) => {
    const before = toWorld(cx, cy);
    vb.w /= k;
    clamp();
    const r = container.getBoundingClientRect();
    vb.x = before.x - ((cx - r.left) / r.width) * vb.w;
    vb.y = before.y - ((cy - r.top) / r.height) * vb.h;
    clamp();
    apply();
  };

  const ptrs = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let downTarget: Element | null = null;
  let pinch0 = 0;

  const onDown = (e: PointerEvent) => {
    svg.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { moved = 0; downTarget = e.target as Element; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); }
  };
  const onMove = (e: PointerEvent) => {
    const prev = ptrs.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    ptrs.set(e.pointerId, cur);
    const r = container.getBoundingClientRect();
    if (ptrs.size === 1) {
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      moved += Math.abs(dx) + Math.abs(dy);
      vb.x -= (dx / r.width) * vb.w;
      vb.y -= (dy / r.height) * vb.h;
      clamp(); apply();
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) zoomAt(d / pinch0, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch0 = d;
      moved += 20;
    }
  };
  const onUp = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0 && moved < 8 && downTarget) {
      const hit = downTarget.closest('[data-sel]');
      if (hit) onSelect(hit.getAttribute('data-sel')!);
      else onSelect('');
    }
    if (ptrs.size < 2) pinch0 = 0;
  };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); };

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  svg.addEventListener('wheel', onWheel, { passive: false });
  const ro = new ResizeObserver(() => fit());
  ro.observe(container);
  requestAnimationFrame(fit);

  return {
    setOverlay(s) { overlay.innerHTML = s; scaleMarkers(true); },
    focus([x, y], zoom) {
      if (zoom) vb.w = W / zoom;  // zoom — во сколько раз уже всей карты
      clamp();
      vb.x = x - vb.w / 2; vb.y = y - vb.h / 2;
      clamp(); apply();
    },
    zoomBy(k) { const r = container.getBoundingClientRect(); zoomAt(k, r.left + r.width / 2, r.top + r.height / 2); },
    destroy() { ro.disconnect(); },
  };
}
