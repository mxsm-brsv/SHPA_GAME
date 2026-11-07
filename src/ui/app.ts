import { factionById } from '../config/factions';
import { createBackend, type Announcement, type Backend, type ClanView, type GameConfig, type Note } from '../core/backend';
import { claimIdle, setClanBonuses } from '../core/logic';
import type { Question } from '../core/questions';
import type { VoteState } from '../core/vote';
import { mskDay, newState, rollDay, type GameState } from '../core/state';
import { haptic, initTelegram, telegram } from '../core/telegram';
import { icon } from '../art/icons';
import { el, esc, onAct, toast } from '../lib/dom';
import { renderBase } from './screens/base';
import { renderSquad } from './screens/squad';
import { renderGames } from './screens/games';
import { renderMap } from './screens/map';
import { renderShop } from './screens/shop';
import { renderTasks } from './screens/tasks';
import { renderQr } from './screens/scan';
import { renderPrep } from './screens/prep';
import { maybeStartTour } from './tour';
import { renderLogin, showWelcome } from './screens/login';
import { openProjector } from './screens/projector';

/** Нижнее меню — главное для школы; Отряд, Карта и Игры — развлечения, открываются кнопками по бокам базы. */
export type Tab = 'tasks' | 'qr' | 'base' | 'prep' | 'shop' | 'squad' | 'map' | 'games';
export const SECONDARY: Tab[] = ['squad', 'map', 'games'];

/** Как часто отправлять накопленный вклад в ПБ и сохранять прогресс (мс). Меньше запросов — легче серверу. */
const FLUSH_MS = 20000;
const SAVE_MS = 60000;
const LIVE_MS = 90000;
/** Уведомления о проверке заданий — чаще эфира, запрос лёгкий. */
const NOTES_MS = 90000;

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
  /** Голосование «Работа со спонсорами» (null — пока не загрузилось). */
  vote: VoteState | null = null;
  private voteTick = 0;
  /** Режим блока: игры, карта и бой на паузе (сервер маленький) */
  lite = false;
  liteUntil = 0;
  /** Удача колеса: normal — как обычно; win/win_all — «счастливый час» от организаторов */
  casinoMode: 'normal' | 'win' | 'win_all' = 'normal';
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
    telegram()?.BackButton?.onClick(this.backHandler);
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
      window.setInterval(() => this.refreshMode(), 60_000);
      // голосование: пока открыто — раз в 10 с, иначе раз в минуту (сервер маленький — бережём его)
      window.setInterval(() => { this.voteTick++; if ((this.vote?.status === 'open' && this.voteTick % 3 === 0) || this.voteTick % 24 === 0) this.refreshVote(); }, 5000);
      document.addEventListener('visibilitychange', () => { if (document.hidden) { this.flush(); this.saveNow(); } });
      window.addEventListener('pagehide', () => { this.flush(); this.saveNow(); });
    }
    await this.refreshMode(true);
    await this.refreshClan();
    this.refreshLive();
    this.refreshVote();
    this.enterGame();
    if (fresh) showWelcome(this);
    this.handleStartParam();
  }

  /** Ссылка из QR на экране (t.me/бот?startapp=lec_КОД) — отметка на лекции сразу после входа. */
  private async handleStartParam() {
    const p = this.startParam;
    this.startParam = '';
    const dm = p.match(/^duel_([A-Za-z0-9]{5})$/);
    if (dm) { const { openDuelHub } = await import('../games/duel'); if (!this.questions.length) this.questions = await this.backend.getQuestions().catch(() => []); openDuelHub(this, { code: dm[1] }); return; }
    // печатный QR: тайник или «Я — скорость» (t.me/бот?startapp=t_КОД)
    const tm = p.match(/^t_([A-Za-z0-9]+)$/);
    if (tm) {
      const r = await this.backend.redeemCode(this.state, `startapp=t_${tm[1]}`);
      haptic(r.status === 'approved' ? 'ok' : 'bad');
      toast(r.message, r.status === 'approved' ? 'ok' : 'bad');
      this.update();
      return;
    }
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

  /** Режим блока: узнаём у сервера, на паузе ли игры. При смене — перерисовываем экран. */
  async refreshMode(first = false) {
    if (!this.state || (!first && (document.hidden || this.backend.cooling))) return;
    const m = await this.backend.gameMode().catch(() => null);
    if (!m) return;
    const changed = m.lite !== this.lite;
    this.lite = m.lite; this.liteUntil = m.until ?? 0; this.casinoMode = m.casino ?? 'normal';
    if (changed && !first) {
      if (this.lite && SECONDARY.includes(this.tab) && !this.backend.staff) this.tab = 'base';
      this.render();
      toast(this.lite ? 'Идёт блок — игры на паузе. Задания, QR и подготовка работают' : 'Игры снова открыты!', 'info');
    }
  }
  liteText() {
    const t = this.liteUntil ? new Date(this.liteUntil).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    return `Идёт блок${t ? ` до ${t}` : ''}: мини-игры, карта и бой на паузе. Работают задания, QR, подготовка и мерч.`;
  }

  async refreshVote() {
    if (!this.state || document.hidden || this.backend.cooling) return;
    const v = await this.backend.voteState().catch(() => null);
    if (!v) return;
    const changed = !this.vote || this.vote.status !== v.status || this.vote.current !== v.current || this.vote.reveal !== v.reveal || this.vote.round !== v.round;
    this.vote = v;
    if (changed) this.root.querySelectorAll<HTMLElement>('[data-vote]').forEach((n) => n.dispatchEvent(new CustomEvent('vote')));
  }

  async refreshLive() {
    if (!this.state || document.hidden || this.backend.cooling) return;
    this.live = await this.backend.liveFeed().catch(() => this.live);
    this.root.querySelectorAll<HTMLElement>('[data-live]').forEach((n) => n.dispatchEvent(new CustomEvent('live')));
  }

  /** Уведомления «принято / не принято». Новое — всплывает сообщением. */
  async refreshNotes(silent = false) {
    if (!this.state || (document.hidden && !silent) || this.backend.cooling) return;
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
    this.drawNavBadges();
  }

  /** Отправляет накопленный вклад в здание ПБ (раз в несколько секунд, пачкой). */
  async flush() {
    const s = this.state;
    if (!s || this.flushing || s.clicker.pendingXp <= 0 || !s.faction || this.lite || this.backend.cooling) return;
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
    maybeStartTour(this);
  }

  /** Игрок вошёл и видит нижнее меню (а не экран входа). */
  get inGame() { return !!this.state && !!this.navEl; }

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
    if (this.lite && SECONDARY.includes(tab) && !this.backend.staff) { toast(this.liteText(), 'info'); haptic('bad'); return; }
    haptic();
    this.tab = tab;
    this.render();
  }

  render() {
    this.tickFns.clear();
    const s = this.state;
    rollDay(s);
    const make = { base: renderBase, squad: renderSquad, games: renderGames, map: renderMap, shop: renderShop, tasks: renderTasks, qr: renderQr, prep: renderPrep }[this.tab];
    const next = make(this);
    if (this.screenEl) { this.screenEl.dispatchEvent(new CustomEvent('detach')); this.screenEl.replaceWith(next); } else this.root.insertBefore(next, this.navEl);
    this.screenEl = next;
    // развлечения живут «на базе»: подсвечиваем её и даём кнопку «назад» Telegram
    const navTab = SECONDARY.includes(this.tab) ? 'base' : this.tab;
    this.navEl?.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === navTab));
    this.syncBack();
    this.drawNavBadges();
  }

  /** Кнопка «назад» Telegram: закрывает окно поверх игры или возвращает с развлечений на базу. */
  private syncBack() {
    const bb = telegram()?.BackButton;
    if (!bb) return;
    if (this.overlay || SECONDARY.includes(this.tab)) bb.show(); else bb.hide();
  }

  /** Значки на нижнем меню: непрочитанные ответы и открытые QR-отметки. */
  drawNavBadges() {
    if (!this.navEl || !this.state) return;
    const unread = this.notes.filter((n) => !n.read).length;
    const t = this.navEl.querySelector<HTMLElement>('[data-tab="tasks"] .nbadge');
    if (t) { t.textContent = String(unread); t.classList.toggle('hidden', !unread); }
    this.cached('lect', 120_000, () => this.backend.lecturesOpen()).then((ls) => {
      const open = ls.filter((l) => !l.mine && !this.state.lectures.includes(l.id)).length;
      const q = this.navEl?.querySelector<HTMLElement>('[data-tab="qr"] .nbadge');
      if (q) { q.textContent = open ? '!' : ''; q.classList.toggle('hidden', !open); }
    }).catch(() => {});
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
    // сервер не отвечает — сохраним позже, прогресс лежит в памяти и в телефоне
    if (this.backend.cooling) { this.saveTimer = window.setTimeout(() => this.saveNow(), 20000 + Math.random() * 20000); return; }
    this.lastSave = Date.now();
    if (this.state) this.backend.save(this.state).catch(() => {});
  }

  /** Полноэкранный слой поверх игры (бой, мини-игра, правовуха). */
  openOverlay(node: HTMLElement) {
    this.closeOverlay(false);
    this.overlay = node;
    this.root.appendChild(node);
    this.syncBack();
  }

  private backHandler = () => { if (this.overlay) this.closeOverlay(); else if (SECONDARY.includes(this.tab)) this.go('base'); };

  closeOverlay(rerender = true) {
    if (!this.overlay) return;
    this.overlay.dispatchEvent(new CustomEvent('close'));
    this.overlay.remove();
    this.overlay = null;
    this.syncBack();
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
      `<button data-tab="${tab}" data-act="tab" class="${tab === 'base' ? 'home' : ''}" aria-label="${label}">${icon(ic, tab === 'base' ? 26 : 24)}<span>${esc(label)}</span>${tab === 'tasks' || tab === 'qr' ? '<i class="nbadge hidden"></i>' : ''}</button>`;
    const nav = el(`<nav class="nav">${item('tasks', 'clipboard', 'Задания')}${item('qr', 'qr', 'QR')}${item('base', 'home', 'База')}${item('prep', 'book', 'Подготовка')}${item('shop', 'bag', 'Мерч')}</nav>`);
    onAct(nav, { tab: (t) => this.go(t.dataset.tab as Tab) });
    return nav;
  }
}
