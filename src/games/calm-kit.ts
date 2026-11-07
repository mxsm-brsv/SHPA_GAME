// Общее для «Антистресса»: звук (синтез в WebAudio, без файлов), вибрация, частицы, рамка сцены.
import { feel } from '../core/telegram';
import { el, esc } from '../lib/dom';

export type Feel = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' | 'select';

export interface CalmStore { mute: boolean; carpets: string[]; blocks: number; sheets: number; slime: number }
const KEY = 'pbgame.calm';
export function loadStore(): CalmStore {
  const d: CalmStore = { mute: false, carpets: [], blocks: 0, sheets: 0, slime: 0 };
  try { return { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return d; }
}
export function saveStore(s: CalmStore) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* приватный режим */ } }

export interface CalmCtx {
  sfx: Sfx;
  store: CalmStore;
  save(): void;
  /** очки спокойствия: из них — бонус профкоинов дня */
  add(n: number): void;
  /** вибрация с ограничением частоты */
  buzz(kind: Feel, gapMs?: number): void;
  toast(text: string): void;
  back(): void;
}

export interface Scene { node: HTMLElement; stop(): void }

/** Сид-генератор: одинаковый ковёр в превью и в игре. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOut = (t: number) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Канвас вне экрана в «CSS-пикселях» с заданной плотностью. */
export function offscreen(w: number, h: number, scale: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  const g = c.getContext('2d')!;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  return { c, g };
}

// ---------- Звук ----------
type Loop = { g: GainNode; f: BiquadFilterNode; s: AudioBufferSourceNode };

export class Sfx {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private loops = new Map<string, Loop>();
  muted = false;

  /** Будим звук в обработчике касания — иначе iOS его не пустит. */
  wake() {
    if (!this.ac) {
      try {
        const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ac = new C();
        const m = ac.createGain();
        m.gain.value = this.muted ? 0 : 0.8;
        m.connect(ac.destination);
        const len = ac.sampleRate * 2;
        const b = ac.createBuffer(1, len, ac.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.ac = ac; this.master = m; this.noise = b;
      } catch { return; }
    }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ac && this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ac.currentTime, 0.03);
  }

  private ok() { return !!(this.ac && this.master && this.noise && !this.muted); }

  private burst(o: { type: BiquadFilterType; f: number; f2?: number; q?: number; dur: number; vol: number; at?: number }) {
    if (!this.ok()) return;
    const ac = this.ac!;
    const t = ac.currentTime + (o.at ?? 0);
    const s = ac.createBufferSource(); s.buffer = this.noise;
    const f = ac.createBiquadFilter(); f.type = o.type; f.frequency.setValueAtTime(o.f, t); f.Q.value = o.q ?? 1;
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(f); f.connect(g); g.connect(this.master!);
    s.start(t, Math.random() * 1.5, o.dur + 0.05);
  }

  private tone(o: { type?: OscillatorType; f: number; f2?: number; dur: number; vol: number; at?: number }) {
    if (!this.ok()) return;
    const ac = this.ac!;
    const t = ac.currentTime + (o.at ?? 0);
    const osc = ac.createOscillator(); osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(this.master!);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  /** Пупырка, пузырёк в слайме. pitch ~ 0.7…2.5 */
  pop(pitch = 1, vol = 0.45) {
    this.tone({ type: 'sine', f: 620 * pitch, f2: 120 * pitch, dur: 0.06, vol });
    this.burst({ type: 'highpass', f: 2200, dur: 0.03, vol: vol * 0.7 });
  }
  /** Хруст песка и шариков. */
  crunch(vol = 0.3) { this.burst({ type: 'bandpass', f: 1300 + Math.random() * 2600, q: 0.9, dur: 0.035 + Math.random() * 0.05, vol }); }
  /** Мягкий «чвяк» слайма. */
  squish(vol = 0.35) {
    this.burst({ type: 'lowpass', f: 1100, f2: 160, q: 4, dur: 0.24, vol });
    this.tone({ type: 'sine', f: 170, f2: 80, dur: 0.2, vol: vol * 0.45 });
  }
  plop(vol = 0.45) { this.tone({ type: 'sine', f: 420, f2: 105, dur: 0.15, vol }); this.burst({ type: 'lowpass', f: 700, dur: 0.08, vol: vol * 0.4 }); }
  thud(vol = 0.45) { this.tone({ type: 'sine', f: 130, f2: 48, dur: 0.2, vol }); this.burst({ type: 'lowpass', f: 380, dur: 0.14, vol: vol * 0.7 }); }
  whoosh(vol = 0.25) { this.burst({ type: 'bandpass', f: 500, f2: 2400, q: 0.7, dur: 0.25, vol }); }
  ding(vol = 0.16) { this.tone({ type: 'sine', f: 1318, dur: 0.35, vol }); this.tone({ type: 'sine', f: 1976, dur: 0.25, vol: vol * 0.4, at: 0.03 }); }
  chime() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'triangle', f, dur: 0.55, vol: 0.13, at: i * 0.075 }));
    this.tone({ type: 'sine', f: 2093, dur: 0.6, vol: 0.05, at: 0.3 });
  }

  /** Непрерывный шум: вода, щётка, пылесос, пена. Громкость задаём каждый кадр. */
  level(name: string, vol: number, opt: { type: BiquadFilterType; f: number; q?: number } = { type: 'bandpass', f: 1500 }) {
    if (!this.ac || !this.master || !this.noise) return;
    let l = this.loops.get(name);
    if (!l) {
      if (vol <= 0.001) return;
      const ac = this.ac;
      const s = ac.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const f = ac.createBiquadFilter(); f.type = opt.type; f.frequency.value = opt.f; f.Q.value = opt.q ?? 1;
      const g = ac.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start();
      l = { g, f, s };
      this.loops.set(name, l);
    }
    const now = this.ac.currentTime;
    l.g.gain.setTargetAtTime(this.muted ? 0 : vol, now, 0.06);
    l.f.frequency.setTargetAtTime(opt.f, now, 0.08);
  }

  hush() {
    for (const [, l] of this.loops) { try { l.s.stop(); l.s.disconnect(); l.g.disconnect(); } catch { /* уже */ } }
    this.loops.clear();
  }
}

export const sfx = new Sfx();

/** Вибрация не чаще, чем раз в gap мс для каждого вида. */
export function buzzer() {
  const last: Record<string, number> = {};
  return (kind: Feel, gapMs = 0) => {
    const now = performance.now();
    if (gapMs && now - (last[kind] ?? 0) < gapMs) return;
    last[kind] = now;
    feel(kind);
  };
}

// ---------- Частицы ----------
export interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; grav: number; kind: 'dot' | 'spark' | 'ring' | 'rect' | 'drop'; rot?: number; vr?: number }

export class Parts {
  list: Part[] = [];
  constructor(private cap = 700) {}
  add(p: Omit<Part, 'max'> & { max?: number }) {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push({ ...p, max: p.max ?? p.life });
  }
  step(dt: number) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.vr) p.rot = (p.rot ?? 0) + p.vr * dt;
    }
  }
  draw(g: CanvasRenderingContext2D) {
    for (const p of this.list) {
      const a = clamp(p.life / p.max, 0, 1);
      g.globalAlpha = p.kind === 'ring' ? a * 0.7 : Math.min(1, a * 1.6);
      if (p.kind === 'ring') {
        g.strokeStyle = p.color; g.lineWidth = 2 * a + 0.5;
        g.beginPath(); g.arc(p.x, p.y, p.size * (1.6 - a), 0, 7); g.stroke();
      } else if (p.kind === 'spark') {
        const s = p.size * (0.4 + a * 0.6);
        g.fillStyle = p.color;
        g.beginPath();
        g.moveTo(p.x, p.y - s); g.quadraticCurveTo(p.x, p.y, p.x + s, p.y); g.quadraticCurveTo(p.x, p.y, p.x, p.y + s);
        g.quadraticCurveTo(p.x, p.y, p.x - s, p.y); g.quadraticCurveTo(p.x, p.y, p.x, p.y - s); g.fill();
      } else if (p.kind === 'rect') {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot ?? 0); g.fillStyle = p.color; g.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9); g.restore();
      } else if (p.kind === 'drop') {
        g.fillStyle = p.color;
        g.beginPath(); g.ellipse(p.x, p.y, p.size * 0.7, p.size * (1 + Math.min(1.2, Math.abs(p.vy) / 500)), 0, 0, 7); g.fill();
      } else {
        g.fillStyle = p.color;
        g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    g.globalAlpha = 1;
  }
}

// ---------- Рамка сцены: «‹ Все», название, звук; холст; панель инструментов ----------
const SPK_ON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const SPK_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="m16 9 6 6"/><path d="m22 9-6 6"/></svg>';
export const speaker = (muted: boolean) => (muted ? SPK_OFF : SPK_ON);

export function frame(cc: CalmCtx, title: string, opt: { back?: () => boolean } = {}) {
  const node = el(`<div class="calm-scene">
    <div class="calm-bar">
      <button class="calm-back" data-back>‹ Все</button>
      <b class="grow">${esc(title)}</b>
      <span class="calm-info" data-info></span>
      <button class="calm-mute" data-mute aria-label="Звук">${speaker(cc.store.mute)}</button>
    </div>
    <div class="cv-wrap calm-cv"><canvas></canvas><div class="calm-hint" data-hint></div></div>
    <div class="calm-tools" data-tools></div>
  </div>`);
  const backBtn = node.querySelector<HTMLElement>('[data-back]')!;
  backBtn.addEventListener('click', () => { cc.buzz('light'); if (opt.back?.()) return; cc.back(); });
  const mute = node.querySelector<HTMLElement>('[data-mute]')!;
  mute.addEventListener('click', () => {
    cc.store.mute = !cc.store.mute; cc.save();
    cc.sfx.setMuted(cc.store.mute);
    mute.innerHTML = speaker(cc.store.mute);
  });
  const wrap = node.querySelector<HTMLElement>('.calm-cv')!;
  const hint = node.querySelector<HTMLElement>('[data-hint]')!;
  return {
    node, wrap,
    canvas: wrap.querySelector('canvas')!,
    tools: node.querySelector<HTMLElement>('[data-tools]')!,
    info: (t: string) => { node.querySelector('[data-info]')!.textContent = t; },
    hint: (t: string) => { hint.textContent = t; hint.classList.toggle('hidden', !t); },
    backLabel: (t: string) => { backBtn.textContent = t; },
  };
}

/** Точка касания в координатах холста. */
export function local(e: PointerEvent, c: HTMLElement) {
  const r = c.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
