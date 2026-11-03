import { factionById } from '../config/factions';
import { createBackend, type Announcement, type Backend, type ClanView, type GameConfig, type Note } from '../core/backend';
import { claimIdle, setClanBonuses } from '../core/logic';
import type { Question } from '../core/questions';
import { mskDay, newState, rollDay, type GameState } from '../core/state';
import { haptic, initTelegram, telegram } from '../core/telegram';
import { icon } from '../art/icons';
import { el, esc, onAct, toast } from '../lib/dom';
import { renderBase } from './screens/base';
import { renderSquad } from './screens/squad';
import { renderGames } from './screens/games';
import { renderMap } from './screens/map';
import { renderShop } from './screens/shop';
import { renderLogin, showWelcome } from './screens/login';
import { openProjector } from './screens/projector';

export type Tab = 'squad' | 'map' | 'base' | 'games' | 'shop';

/** Как часто отправлять накопленный вклад в ПБ и сохранять прогресс (мс). Меньше запросов — легче серверу. */
const FLUSH_MS = 6000;
const SAVE_MS = 15000;
const LIVE_MS = 60000;
/** Уведомления о проверке заданий — чаще эфира, запрос лёгкий. */
const NOTES_MS = 30000;

export class App {
  state!: GameState;
  backend: Backend = createBackend();
  root: HTMLElement;
  tab: Tab = 'base';
  /** Вкладка экрана «Отряд»: активисты, умения, снаряжение */
  squadTab: 'heroes' | 'skills' | 'gear' = 'heroes';
  questions: Question[] = [];
  clan: ClanView | null = null;
  cfg: GameConfig = { shopOpen: false, testMode: false, requireGroup: true };
  live: Announcement[] = [];
  notes: Note[] = [];
  private seenNotes = new Set<string>();
  private saveTimer = 0;
  private lastSave = 0;
  private screenEl: HTMLElement | null = null;
  private navEl: HTMLElement | null = null;
  overlay: HTMLElement | null = null;
  private tickFns = new Set<() => void>();
  private started = false;
  private flushing = false;
  private startParam = '';

  constructor(root: HTMLElement) { this.root = root; }

  private cache = new Map<string, { at: number; p: Promise<unknown> }>();
  /** Кэш запросов: база перерисовывается часто, а сервер и трафик бесплатного тарифа надо беречь. */
  cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < ttlMs) return c.p as Promise<T>;
    const p = fn();
    this.cache.set(key, { at: Date.now(), p });
    p.catch(() => this.cache.delete(key));
    return p;
  }

  async start() {
    await initTelegram();
    this.startParam = telegram()?.initDataUnsafe.start_param ?? new URLSearchParams(location.search).get('startapp') ?? '';
    this.root.innerHTML = `<div class="screen full" style="display:grid;place-items:center"><div class="center muted">Загрузка…</div></div>`;
    this.cfg = await this.backend.config().catch(() => this.cfg);
    const res = await this.backend.login().catch((e: Error) => ({ state: null, needLogin: true, error: e.message }));
    if (!res.state) { this.showLogin(res.error); return; }
    this.afterLogin(res.state, false);
  }

  showLogin(error?: string) {
    this.root.innerHTML = '';
    this.root.appendChild(renderLogin(this, error));
  }

  async afterLogin(st: GameState, fresh: boolean) {
    this.state = st ?? newState('Активист');
    rollDay(this.state);
    this.questions = await this.backend.getQuestions().catch(() => []);
    if (!this.state.secret) await this.backend.mySecret(this.state).catch(() => '');
    if (!this.started) {
      this.started = true;
      window.setInterval(() => this.tickFns.forEach((f) => f()), 1000);
      window.setInterval(() => this.flush(), FLUSH_MS);
      window.setInterval(() => this.refreshLive(), LIVE_MS);
      window.setInterval(() => this.refreshNotes(), NOTES_MS);
      document.addEventListener('visibilitychange', () => { if (document.hidden) { this.flush(); this.saveNow(); } });
      window.addEventListener('pagehide', () => { this.flush(); this.saveNow(); });
    }
    await this.refreshClan();
    this.refreshLive();
    this.enterGame();
    if (fresh) showWelcome(this);
    this.handleStartParam();
  }

  /** Ссылка из QR на экране (t.me/бот?startapp=lec_КОД) — отметка на лекции сразу после входа. */
  private async handleStartParam() {
    const p = this.startParam;
    this.startParam = '';
    const m = p.match(/^lec_([A-Za-z0-9]+)$/);
    if (!m) return;
    const r = await this.backend.redeemCode(this.state, `SHPA:L:${m[1]}`);
    toast(r.message, r.status === 'approved' ? 'ok' : 'bad');
    this.update();
  }

  async refreshClan() {
    const c = await this.backend.getClan(this.state).catch(() => null);
    if (c) { this.clan = c; setClanBonuses(c.bonuses); }
  }

  async refreshLive() {
    if (!this.state) return;
    this.live = await this.backend.liveFeed().catch(() => this.live);
    this.root.querySelectorAll<HTMLElement>('[data-live]').forEach((n) => n.dispatchEvent(new CustomEvent('live')));
    this.refreshNotes();
  }

  /** Уведомления «принято / не принято». Новое — всплывает сообщением. */
  async refreshNotes(silent = false) {
    if (!this.state) return;
    const list = await this.backend.notes(this.state).catch(() => null);
    if (!list) return;
    const fresh = list.filter((n) => !n.read && !this.seenNotes.has(n.id));
    list.forEach((n) => this.seenNotes.add(n.id));
    this.notes = list;
    if (fresh.length && !silent) {
      toast(fresh[0].text + (fresh.length > 1 ? ` (и ещё ${fresh.length - 1})` : ''), fresh[0].kind);
      haptic(fresh[0].kind === 'bad' ? 'bad' : 'ok');
      if (fresh.some((n) => n.kind === 'ok')) this.update(!this.overlay);
    }
    this.root.querySelectorAll<HTMLElement>('[data-notes]').forEach((n) => n.dispatchEvent(new CustomEvent('notes')));
  }

  /** Отправляет накопленный вклад в здание ПБ (раз в несколько секунд, пачкой). */
  async flush() {
    const s = this.state;
    if (!s || this.flushing || s.clicker.pendingXp <= 0 || !s.faction) return;
    this.flushing = true;
    const xp = s.clicker.pendingXp;
    s.clicker.pendingXp = 0;
    try {
      const r = await this.backend.contribute(s, s.clicker.building, xp);
      if (r.clan) {
        if (!r.clan.members.length && this.clan) r.clan.members = this.clan.members; // лёгкий ответ без списка участников
        this.clan = r.clan; setClanBonuses(r.clan.bonuses);
      }
      if (r.accepted < xp) s.clicker.contributed -= xp - r.accepted; // сервер срезал лишнее
      this.update(false);
    } catch { s.clicker.pendingXp += xp; }
    finally { this.flushing = false; }
  }

  async enterGame() {
    this.applyTheme();
    this.root.innerHTML = '';
    this.screenEl = null;
    this.navEl = this.buildNav();
    this.root.appendChild(this.navEl);
    this.render();
    await this.dailyLogin();
  }

  applyTheme() {
    const f = factionById(this.state.faction);
    document.documentElement.style.setProperty('--fc', f.color);
    document.documentElement.style.setProperty('--fcd', f.colorDark);
  }

  /** «Зайти в игру» — 10 баллов раз в сутки. */
  private async dailyLogin() {
    const d = mskDay();
    if (this.state.loginDay === d) return;
    this.state.loginDay = d;
    const r = await this.backend.claimTask(this.state, 'daily_login');
    if (r.granted) toast(`+${r.granted} баллов за вход сегодня`, 'ok');
    this.update();
  }

  onTick(fn: () => void) { this.tickFns.add(fn); return () => this.tickFns.delete(fn); }

  go(tab: Tab) {
    if (this.tab === tab) return;
    haptic();
    this.tab = tab;
    this.render();
  }

  render() {
    this.tickFns.clear();
    const s = this.state;
    rollDay(s);
    const make = { base: renderBase, squad: renderSquad, games: renderGames, map: renderMap, shop: renderShop }[this.tab];
    const next = make(this);
    if (this.screenEl) { this.screenEl.dispatchEvent(new CustomEvent('detach')); this.screenEl.replaceWith(next); } else this.root.insertBefore(next, this.navEl);
    this.screenEl = next;
    this.navEl?.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === this.tab));
  }

  /** После изменения состояния: перерисовать и сохранить не чаще раза в 15 секунд. */
  update(rerender = true) {
    if (rerender && !this.overlay) this.render();
    clearTimeout(this.saveTimer);
    const wait = Math.max(3000, SAVE_MS - (Date.now() - this.lastSave));
    this.saveTimer = window.setTimeout(() => this.saveNow(), wait);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    this.lastSave = Date.now();
    if (this.state) this.backend.save(this.state).catch(() => {});
  }

  /** Полноэкранный слой поверх игры (бой, мини-игра, правовуха). */
  openOverlay(node: HTMLElement) {
    this.closeOverlay(false);
    this.overlay = node;
    this.root.appendChild(node);
    const bb = telegram()?.BackButton;
    if (bb) { bb.show(); bb.onClick(this.backHandler); }
  }

  private backHandler = () => this.closeOverlay();

  closeOverlay(rerender = true) {
    if (!this.overlay) return;
    this.overlay.dispatchEvent(new CustomEvent('close'));
    this.overlay.remove();
    this.overlay = null;
    const bb = telegram()?.BackButton;
    if (bb) { bb.offClick(this.backHandler); bb.hide(); }
    if (rerender && this.state && this.navEl) this.render();
    if (this.state) this.update(false);
  }

  claimIdle() { return claimIdle(this.state); }

  async logout() {
    this.flush();
    this.saveNow();
    await this.backend.logout();
    location.reload();
  }

  openProjector() { openProjector(this); }

  private buildNav() {
    const item = (tab: Tab, ic: string, label: string) =>
      `<button data-tab="${tab}" data-act="tab" class="${tab === 'base' ? 'home' : ''}" aria-label="${label}">${icon(ic, tab === 'base' ? 26 : 24)}<span>${esc(label)}</span></button>`;
    const nav = el(`<nav class="nav">${item('squad', 'users', 'Отряд')}${item('map', 'map', 'Карта')}${item('base', 'home', 'База')}${item('games', 'gamepad', 'Игры')}${item('shop', 'bag', 'Магазин')}</nav>`);
    onAct(nav, { tab: (t) => this.go(t.dataset.tab as Tab) });
    return nav;
  }
}
