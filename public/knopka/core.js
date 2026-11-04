// @ts-check
// «Кнопка» — логика без интерфейса: синхронизация часов, связь с сервером, нажатие и пульс команды.
// Этот же файл гоняют тесты (scripts/knopka/): 10 «телефонов» с плохой связью против настоящей базы.

/** Запас на задержку обработки касания: пульс говорит «нажатий не было» только до (сейчас − 100 мс). */
export const ASOF_MARGIN_MS = 100;

/**
 * Часы сервера на телефоне. Каждый запрос даёт интервал, в котором точно лежит поправка:
 * [ts − t1, ts − t0] (сервер поставил метку где-то между отправкой и ответом). Берём пересечение
 * интервалов последних 90 секунд — чем больше быстрых запросов, тем точнее; ширина пересечения — честная
 * погрешность. Часы самого телефона (Date) не используются: только монотонный таймер браузера.
 */
export class Clock {
  /** @param {() => number} [now] монотонный таймер, мс */
  constructor(now = () => performance.now()) {
    this.now = now;
    /** @type {{t0:number, t1:number, ts:number, te:number}[]} */
    this.samples = [];
    this.offset = NaN;
    this.err = Infinity;
    /** лучший пинг за окно и последний пинг */
    this.rtt = NaN;
    this.lastRtt = NaN;
    this.driftPpm = 100; // запас на уход кварца телефона и сервера
  }

  /**
   * @param {number} t0 отправка (локально) @param {number} t1 ответ (локально)
   * @param {number} ts время сервера в начале обработки @param {number} [te] в конце обработки
   */
  add(t0, t1, ts, te = ts) {
    const rtt = t1 - t0;
    if (!(rtt >= 0) || rtt > 15000 || !Number.isFinite(ts) || !Number.isFinite(te) || te < ts) return;
    this.lastRtt = rtt;
    this.samples.push({ t0, t1, ts, te });
    const cut = t1 - 90000;
    this.samples = this.samples.filter((s) => s.t1 >= cut).slice(-60);
    this.recompute();
  }

  recompute() {
    const now = this.now();
    if (!this.samples.length) { this.offset = NaN; this.err = Infinity; this.rtt = NaN; return; }
    let lo = -Infinity, hi = Infinity, best = this.samples[0];
    for (const s of this.samples) {
      const drift = Math.max(0, now - s.t1) * this.driftPpm * 1e-6;
      // сервер начал обработку не раньше отправки и закончил не позже ответа
      lo = Math.max(lo, s.te - s.t1 - drift);
      hi = Math.min(hi, s.ts - s.t0 + drift);
      if (s.t1 - s.t0 < best.t1 - best.t0) best = s;
    }
    this.rtt = best.t1 - best.t0;
    if (lo <= hi) { this.offset = (lo + hi) / 2; this.err = (hi - lo) / 2; }
    else {
      // интервалы не пересеклись (скачок часов сервера или большой уход) — верим самому быстрому запросу
      this.offset = (best.ts + best.te) / 2 - (best.t0 + best.t1) / 2;
      this.err = this.rtt / 2;
    }
  }

  reset() { this.samples = []; this.recompute(); }
  get count() { return this.samples.length; }
  get ready() { return this.samples.length >= 3 && Number.isFinite(this.offset); }
  /** Перевод локального момента в часы сервера. */
  server(local = this.now()) { return local + this.offset; }
  /** Перевод момента сервера в локальный. */
  local(serverMs) { return serverMs - this.offset; }
}

export class ApiError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status = 0) { super(message); this.status = status; }
}

/** Вызовы функций базы (Supabase REST) с таймаутом. Новый ключ publishable — только в apikey. */
export class Api {
  /** @param {string} url @param {string} key @param {typeof fetch} [fetchFn] */
  constructor(url, key, fetchFn) {
    this.url = url.replace(/\/$/, '');
    this.key = key;
    this.fetch = fetchFn ?? ((...a) => fetch(...a));
    /** @type {Record<string,string>} */
    this.headers = { apikey: key, 'content-type': 'application/json' };
    if (key.split('.').length === 3) this.headers.authorization = `Bearer ${key}`;
  }

  /**
   * @param {string} fn @param {Record<string, unknown>} [args] @param {number} [timeoutMs]
   * @param {{onHeaders?: () => void}} [hooks] onHeaders — момент прихода ответа (для синхронизации часов)
   */
  async rpc(fn, args = {}, timeoutMs = 8000, hooks) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), timeoutMs);
    let r;
    try {
      r = await this.fetch(`${this.url}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: this.headers, body: JSON.stringify(args), cache: 'no-store', signal: ctl?.signal,
      });
      hooks?.onHeaders?.();
      const txt = await r.text();
      const j = txt ? JSON.parse(txt) : null;
      if (!r.ok) throw new ApiError((j && (j.message || j.error)) || `Ошибка сервера ${r.status}`, r.status);
      return j;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('Нет связи с сервером', 0);
    } finally { clearTimeout(timer); }
  }
}

/**
 * Серия коротких запросов времени: первый прогревает соединение и не идёт в расчёт.
 * @param {Api} api @param {Clock} clock @param {number} [n]
 */
export async function syncBurst(api, clock, n = 8) {
  let ok = 0;
  for (let i = 0; i < n + 1; i++) {
    const t0 = clock.now();
    let t1 = NaN;
    try {
      const ts = await api.rpc('bz_time', {}, 5000, { onHeaders: () => { t1 = clock.now(); } });
      if (i > 0 && typeof ts === 'number') { clock.add(t0, Number.isFinite(t1) ? t1 : clock.now(), ts); ok++; }
    } catch { /* следующая попытка */ }
  }
  return ok;
}

/** Что телефон знает о вопросе: статус по своим часам (обратный отсчёт и лимит считаются локально). */
export function roundPhase(round, serverNow) {
  if (!round) return 'idle';
  if (round.status === 'void') return 'void';
  if (round.status === 'closed') return 'closed';
  if (round.closes_ms && serverNow >= round.closes_ms) return 'closed';
  if (serverNow < round.opens_ms) return 'countdown';
  return 'open';
}

/**
 * Телефон команды: пульс, нажатие, повторы, восстановление после перезапуска.
 * Хранилище (store) — localStorage или его замена в тестах.
 */
export class TeamLink {
  /**
   * @param {{api: Api, clock: Clock, token: string, store?: {get(k:string):string|null, set(k:string, v:string|null):void},
   *   app?: string, onState?: (s:any)=>void, onPress?: (p:any)=>void, onAuthLost?: ()=>void, onNet?: (ok:boolean)=>void,
   *   wallNow?: () => number, fastMs?: number, idleMs?: number}} o
   */
  constructor(o) {
    this.api = o.api; this.clock = o.clock; this.token = o.token;
    this.store = o.store ?? { get: () => null, set: () => {} };
    this.app = o.app ?? '';
    this.onState = o.onState ?? (() => {});
    this.onPress = o.onPress ?? (() => {});
    this.onAuthLost = o.onAuthLost ?? (() => {});
    this.onNet = o.onNet ?? (() => {});
    this.wallNow = o.wallNow ?? (() => Date.now());
    this.fastMs = o.fastMs ?? 500;
    this.idleMs = o.idleMs ?? 1000;
    /** @type {any} */ this.state = null;
    this.v = 0;
    /** неподтверждённое нажатие @type {{round:number, ms:number, rtt:number, err:number, n:number, at:number}|null} */
    this.pending = null;
    /** ответы сервера по нажатиям: round → {code, press_ms} */
    this.results = new Map();
    /** когда телефон впервые узнал о вопросе (часы сервера) */
    this.seen = new Map();
    this.lockedUntil = 0;
    this.running = false;
    this.online = true;
    this.lastOk = 0;
    this.timer = /** @type {any} */ (null);
    this.pressTimer = /** @type {any} */ (null);
    this.wall0 = this.wallNow(); this.mono0 = this.clock.now();
    this.inflight = 0;          // пульсов в пути (потерянный пакет не должен останавливать остальные)
    this.lastTickAt = -1e9;
    this.seq = 0; this.appliedSeq = 0;
    this.pressInflight = 0;
    this.looping = false;
    this.urgent = false;
    try { const p = JSON.parse(this.store.get('knopka.pending') || 'null'); if (p && p.round && p.ms) this.pending = p; } catch { /* нет */ }
  }

  start() { if (this.running) return; this.running = true; this.kick(); if (this.pending) this.sendPress(); }
  stop() { this.running = false; clearTimeout(this.timer); clearTimeout(this.pressTimer); }
  /** Пульс как можно скорее (после нажатия, возврата в приложение). */
  kick() {
    this.urgent = true;
    if (!this.looping) { clearTimeout(this.timer); this.timer = setTimeout(() => this.loop(), 0); }
  }

  get round() { return this.state?.round ?? null; }
  get myTeam() { return this.state?.me?.team ?? null; }

  /** Монотонный таймер «остановился» (телефон спал / вкладка была заморожена) — синхронизироваться заново. */
  checkSuspend() {
    const dw = this.wallNow() - this.wall0, dm = this.clock.now() - this.mono0;
    this.wall0 = this.wallNow(); this.mono0 = this.clock.now();
    if (Math.abs(dw - dm) > 1500) { this.clock.reset(); return true; }
    return false;
  }

  phase() {
    if (!this.clock.ready) return 'nosync';
    return roundPhase(this.round, this.clock.server());
  }

  live() {
    const p = this.phase();
    return !!this.pending || p === 'countdown' || p === 'open' || (this.round && !this.round.settled);
  }

  /**
   * Цикл пульса. Пульс не ждёт ответа предыдущего: если тот висит дольше 0,9 с (потеря пакета),
   * уходит следующий (не больше двух в пути). Ответы применяются по порядку отправки.
   */
  async loop() {
    if (!this.running || this.looping) return;
    this.looping = true;
    const urgent = this.urgent;
    this.urgent = false;
    try {
      if (this.checkSuspend()) await syncBurst(this.api, this.clock, 5);
      if (!this.clock.ready) await syncBurst(this.api, this.clock, 6);
      const now = this.clock.now();
      if (this.inflight === 0 || (this.inflight < 2 && now - this.lastTickAt > 900) || (urgent && this.inflight < 2)) this.tick();
    } finally { this.looping = false; }
    if (!this.running) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.loop(), this.urgent ? 60 : this.live() ? this.fastMs : this.idleMs);
  }

  async tick() {
    this.inflight++;
    const seq = ++this.seq;
    const c = this.clock, r = this.round;
    const t0 = c.now();
    this.lastTickAt = t0;
    const live = this.live();
    const args = {
      p_token: this.token, p_v: this.v,
      p_asof: c.ready ? c.server(t0 - ASOF_MARGIN_MS) : null,
      p_rtt: Number.isFinite(c.rtt) ? Math.round(c.rtt) : null,
      p_err: Number.isFinite(c.err) ? Math.round(c.err * 10) / 10 : null,
      p_round: r?.id ?? null, p_seen: r ? this.seen.get(r.id) ?? null : null,
      p_press: this.pending ? { round: this.pending.round, ms: this.pending.ms, rtt: this.pending.rtt, err: this.pending.err, n: ++this.pending.n } : null,
      p_app: this.app,
    };
    let t1 = NaN;
    try {
      const res = await this.api.rpc('bz_tick', args, live ? 2500 : 5000, { onHeaders: () => { t1 = c.now(); } });
      if (!Number.isFinite(t1)) t1 = c.now();
      this.net(true);
      if (res?.error === 'auth') { this.stop(); this.onAuthLost(); return; }
      if (typeof res?.t0 === 'number' && typeof res?.t === 'number') c.add(t0, t1, res.t0, res.t);
      if (res?.press) this.pressResult(res.press);
      // устаревший ответ (обогнал более новый) не откатывает состояние
      if (seq > this.appliedSeq) {
        if (res?.round !== undefined) { this.appliedSeq = seq; this.apply(res, t1); }
        else if (typeof res?.v === 'number' && res.v === this.v) this.appliedSeq = seq;
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) this.net(false);
    } finally { this.inflight--; }
  }

  /** @param {boolean} ok */
  net(ok) {
    if (ok) this.lastOk = this.clock.now();
    const online = ok || this.clock.now() - this.lastOk < 2500;
    if (online !== this.online) { this.online = online; this.onNet(online); }
  }

  apply(s, recvLocal) {
    this.state = s; this.v = s.v;
    const r = s.round;
    if (r && !this.seen.has(r.id) && this.clock.ready) this.seen.set(r.id, this.clock.server(recvLocal));
    this.onState(s);
  }

  /**
   * Касание кнопки. localT — момент касания по монотонному таймеру (event.timeStamp).
   * @returns {'pressed'|'early'|'locked'|'closed'|'nosync'|'done'|'no_team'}
   */
  press(localT = this.clock.now()) {
    const c = this.clock, r = this.round;
    if (!c.ready) return 'nosync';
    if (!this.myTeam) return 'no_team';
    if (localT < this.lockedUntil) return 'locked';
    if (!r) return 'closed';
    if (this.pending?.round === r.id || this.results.has(r.id) || r.presses?.some((p) => p.team === this.myTeam)) return 'done';
    const ms = c.server(localT);
    const ph = roundPhase(r, ms);
    if (ph === 'countdown') {
      this.lockedUntil = localT + (this.state?.game?.lockout_ms ?? 1000);
      return 'early';
    }
    if (ph !== 'open') return 'closed';
    this.pending = { round: r.id, ms, rtt: Math.round(c.rtt), err: Math.round(c.err * 10) / 10, n: 0, at: this.wallNow() };
    this.store.set('knopka.pending', JSON.stringify(this.pending));
    this.onPress({ round: r.id, ms, status: 'sending' });
    this.sendPress();
    return 'pressed';
  }

  /** Отправка нажатия: попытка каждые 0,5 с, не дожидаясь зависших (до трёх в пути), пока сервер не ответит. */
  sendPress() {
    clearTimeout(this.pressTimer);
    const p = this.pending;
    if (!p || !this.running) return;
    // старое нажатие (телефон пролежал выключенным больше 10 минут) уже не нужно
    if (this.wallNow() - p.at > 600000) { this.pending = null; this.store.set('knopka.pending', null); return; }
    if (this.pressInflight < 3) {
      this.pressInflight++;
      this.api.rpc('bz_press', { p_token: this.token, p_round: p.round, p_ms: p.ms, p_rtt: p.rtt, p_err: p.err, p_attempts: ++p.n }, 3000)
        .then((res) => {
          this.net(true);
          if (res?.code === 'auth') { this.stop(); this.onAuthLost(); return; }
          this.pressResult(res);
        })
        .catch(() => this.net(false))
        .finally(() => { this.pressInflight--; });
    }
    this.pressTimer = setTimeout(() => { if (this.pending && this.pending.round === p.round) this.sendPress(); }, 500);
  }

  pressResult(res) {
    if (!res || !this.pending || res.round !== this.pending.round) return;
    if (res.ok || ['early', 'closed', 'timeout', 'void', 'no_team', 'bad'].includes(res.code)) {
      this.results.set(this.pending.round, { code: res.ok ? 'ok' : res.code, press_ms: res.press_ms ?? this.pending.ms });
      const done = { round: this.pending.round, ms: res.press_ms ?? this.pending.ms, status: res.ok ? 'ok' : res.code };
      this.pending = null; this.store.set('knopka.pending', null);
      clearTimeout(this.pressTimer);
      this.onPress(done);
      this.kick(); // сразу узнать своё место
    }
  }
}

/** Опрос состояния ведущим и экраном зала (с синхронизацией часов для обратного отсчёта). */
export class Poller {
  /**
   * @param {{api: Api, clock: Clock, fn: string, args?: Record<string, unknown>, onState: (s:any)=>void,
   *   onAuthLost?: ()=>void, onNet?: (ok:boolean)=>void, fastMs?: number, idleMs?: number}} o
   */
  constructor(o) {
    Object.assign(this, { fastMs: 400, idleMs: 1500, onAuthLost: () => {}, onNet: () => {}, args: {} }, o);
    /** @type {any} */ this.state = null;
    this.running = false; this.timer = /** @type {any} */ (null); this.online = true; this.lastOk = 0; this.looping = false;
  }
  start() { if (!this.running) { this.running = true; this.loop(); } }
  stop() { this.running = false; clearTimeout(this.timer); }
  kick() { if (!this.looping) { clearTimeout(this.timer); this.timer = setTimeout(() => this.loop(), 0); } }
  async loop() {
    if (!this.running || this.looping) return;
    this.looping = true;
    try { await this.poll(); } finally { this.looping = false; }
    if (!this.running) return;
    const r = this.state?.round;
    const live = r && (r.status === 'open' || r.status === 'countdown' || !r.settled);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.loop(), live ? /** @type {any} */ (this).fastMs : /** @type {any} */ (this).idleMs);
  }
  async poll() {
    const o = /** @type {any} */ (this);
    if (!o.clock.ready) await syncBurst(o.api, o.clock, 5);
    const t0 = o.clock.now(); let t1 = NaN;
    try {
      const s = await o.api.rpc(o.fn, o.args, 6000, { onHeaders: () => { t1 = o.clock.now(); } });
      if (s?.error === 'auth') { this.running = false; o.onAuthLost(); return; }
      if (typeof s?.t0 === 'number') o.clock.add(t0, Number.isFinite(t1) ? t1 : o.clock.now(), s.t0, s.t);
      this.lastOk = o.clock.now();
      if (!this.online) { this.online = true; o.onNet(true); }
      this.state = s; o.onState(s);
    } catch {
      if (this.online && o.clock.now() - this.lastOk > 2500) { this.online = false; o.onNet(false); }
    }
  }
}
