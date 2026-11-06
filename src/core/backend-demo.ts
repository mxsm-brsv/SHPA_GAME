// Демо-режим: всё хранится в браузере, остальные игроки — боты. Нужен для превью и теста без сервера.
import { PLAYABLE_FACTIONS, type FactionId } from '../config/factions';
import { BUILDINGS, CLAN, clanBonuses, pbScore, type BuildingId } from '../config/clan';
import { DEMO_MERCH, merchPrice, type MerchItem, type MerchOrder } from '../config/merch';
import { LECTURE } from '../config/lectures';
import { taskById } from '../config/tasks';
import { DEMO_CACHES, DEMO_EGG_CODES, DEMO_STAFF_CODE, TEST_MODE } from '../config/test';
import { DEMO_ROSTER, ROSTER_SALT } from '../config/roster-demo';
import { sha256Hex } from '../lib/sha256';
import { LECTURE_ROTATE_S, PERSONAL_ROTATE_S, cleanCode, codeMatches, groupDigits, normFio, normGroup, parseScanned, randomCode, randomSecret } from './codes';
import { checkLocal, rightAnswerText, type CheckResult, type Question } from './questions';
import { markDone, taskAvailable } from './rules';
import { mskDay, migrate, newState, type GameState, type Role } from './state';
import { squadPower } from './logic';
import { botEventScores, closeEvent, eventKey, eventSlot, forceEvent, newWorld, nextRoundAt, payWarCoins, resolveRoundDemo, type Order, type WorldState } from './world';
import { SKIRMISH_WIN_COINS } from '../config/economy';
import { plural } from '../lib/dom';
import { VOTE_DEFAULT_TITLE, defaultVoteTeams, type VoteAction, type VoteState } from './vote';
import type { RaidHit, RaidState } from './raid';
import type { CasinoStats } from './casino';
import type { Duel, DuelAnswer, DuelList } from './duel';
import type {
  Announcement, Backend, ClanMember, ClanView, FactionRow, GameConfig, LeaderRow, LectureSession, LoginParams, LoginResult,
  MySubmission, Note, PlayerRef, QrSessionInput, RosterRow, SharedTest, Submission, SubmitResult, TaskPayload, UserQuestion, Wallet,
  DutyZone, TeamMember,
} from './backend';
import bank from '@bank';

const LS_KEY = 'pbgame.v1';
const LS_SESSION = 'pbgame.session';
const LS_WORLD = 'pbgame.world';
const LS_SUBS = 'pbgame.subs';
const LS_CLAN = 'pbgame.clan';
const LS_MERCH = 'pbgame.merch';
const LS_ORDERS = 'pbgame.orders';
const LS_LECT = 'pbgame.lectures';
const LS_LIVE = 'pbgame.live';
const LS_CFG = 'pbgame.cfg';
const LS_EXTRA = 'pbgame.rosterExtra';
const LS_NOTES = 'pbgame.notes';
const LS_SHARED = 'pbgame.sharedTests';
const LS_UQ = 'pbgame.userQuestions';
const LS_BANKX = 'pbgame.bankExtra';
const LS_DUTY = 'pbgame.duty';
const LS_VOTE = 'pbgame.vote';
const LS_RAID = 'pbgame.raid';
const LS_DUELS = 'pbgame.duels';
/** Поединок в демо: соперник — бот, отвечает по одному вопросу раз в несколько секунд. */
interface DemoDuel { id: string; code: string; qids: string[]; created: number; mine: boolean; my: { ans: Record<string, boolean>; start?: number; end?: number }; bot: { name: string; faction: FactionId; join: number; per: number; acc: number } }
/** Сколько заданий квиза засчитывать: intro — 10 вопросов, docs — 3. */
const QUIZ_N: Record<string, number> = { intro_quiz: 10, docs_quiz: 3 };
const QUIZ_TOPICS: Record<string, string[] | null> = { intro_quiz: ['Устав Профсоюза', 'Профсоюз: закон', 'Профсоюз: устройство и учёт', 'СКС Профсоюза'], docs_quiz: null };
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } };
const lsDel = (k: string) => { try { localStorage.removeItem(k); } catch { /* приватный режим */ } };
const lsJson = <T>(k: string, d: T): T => { try { const r = lsGet(k); return r ? (JSON.parse(r) as T) : d; } catch { return d; } };

// ---------- боты ----------
const NAMES = ['Алина', 'Тимур', 'Соня', 'Егор', 'Вера', 'Марк', 'Лиза', 'Даня', 'Ника', 'Артём', 'Полина', 'Глеб', 'Яна', 'Рома', 'Катя', 'Илья', 'Маша', 'Олег', 'Аня', 'Сева', 'Дина', 'Лёва', 'Ира', 'Миша'];
const BOTS_PER_PB = 6;
interface Bot { i: number; name: string; faction: FactionId; secret: string }
const BOTS: Bot[] = PLAYABLE_FACTIONS.flatMap((f, fi) => Array.from({ length: BOTS_PER_PB }, (_, j) => {
  const i = fi * BOTS_PER_PB + j;
  return { i, name: `${NAMES[(fi * 5 + j * 7) % NAMES.length]} (бот)`, faction: f.id, secret: `demo-bot-${i}` };
}));
const hash01 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };

async function blobToDataUrl(b: Blob, max = 360): Promise<string> {
  const url = URL.createObjectURL(b);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } finally { URL.revokeObjectURL(url); }
}

const cap = (w: string) => w ? w[0].toUpperCase() + w.slice(1) : w;
const rosterKey = (s: string) => sha256Hex(ROSTER_SALT + s).slice(0, 16);

interface DemoSession { key: string; role: Role; faction: FactionId; name: string }
interface ClanStore { anchor: number; mine: Partial<Record<FactionId, Record<BuildingId, number>>>; lastAt: number }
interface DemoLecture extends LectureSession { secret: string; by: string[] }
interface ExtraRow { fio: string; group: string; faction: FactionId; role: Role }

/** Голосование в демо: голоса ботов, размеры команд и кто куда вписан (по ФИО). */
type DemoVote = VoteState & { bots: Record<string, [number, number]>; sizes?: Record<string, number>; people?: Record<string, string> };

export class DemoBackend implements Backend {
  mode = 'demo' as const;
  staff = TEST_MODE; // в тесте панель организатора открыта всем, чтобы проверить весь путь
  admin = TEST_MODE;
  private state: GameState | null = null;
  /** Квизы заданий: какие вопросы выданы и первый ответ на каждый. */
  private quizzes = new Map<string, { task: string; ids: string[]; answers: Record<string, boolean>; at: number }>();

  private note(text: string, kind: Note['kind']) {
    const list = lsJson<Note[]>(LS_NOTES, []);
    list.unshift({ id: randomCode(8), text, kind, at: Date.now() });
    lsSet(LS_NOTES, JSON.stringify(list.slice(0, 60)));
  }
  private bankAll(): Question[] { return [...(bank as Question[]), ...lsJson<Question[]>(LS_BANKX, [])]; }

  // ---------- вход ----------
  async login(): Promise<LoginResult> {
    const sess = lsJson<DemoSession | null>(LS_SESSION, null);
    const raw = lsGet(LS_KEY);
    const st = raw ? migrate(JSON.parse(raw)) : null;
    if (!sess || !st) return { state: null, needLogin: true };
    this.applyRole(sess.role);
    this.state = st;
    return { state: st, staff: this.staff, admin: this.admin };
  }

  private applyRole(role: Role) {
    this.staff = TEST_MODE || role === 'staff' || role === 'admin';
    this.admin = TEST_MODE || role === 'admin';
  }

  private startSession(sess: DemoSession): LoginResult {
    const prev = lsJson<DemoSession | null>(LS_SESSION, null);
    const raw = lsGet(LS_KEY);
    let st = prev && prev.key === sess.key && raw ? migrate(JSON.parse(raw)) : null;
    if (!st) { st = newState(sess.name); lsDel(LS_SUBS); lsDel(LS_ORDERS); }
    st.username = sess.name;
    st.fio = sess.name;
    st.faction = sess.faction;
    st.role = sess.role;
    lsSet(LS_SESSION, JSON.stringify(sess));
    lsSet(LS_KEY, JSON.stringify(st));
    this.applyRole(sess.role);
    this.state = st;
    return { state: st, staff: this.staff, admin: this.admin };
  }

  async loginFio(p: LoginParams): Promise<LoginResult> {
    const t = normFio(p.fio).split(' ').filter(Boolean);
    if (t.length < 2) return { state: null, error: 'Напиши фамилию и имя (можно с отчеством)' };
    const gd = groupDigits(p.group);
    const staffCode = (p.staffCode ?? '').trim().replace(/\s+/g, ' ').toUpperCase().replace(/Ё/g, 'Е');
    // организатор: фамилия+имя без группы и код организатора
    if (staffCode) {
      if (staffCode !== DEMO_STAFF_CODE) return { state: null, error: 'Неверный код организатора' };
      for (let i = 0; i < t.length; i++) for (let j = 0; j < t.length; j++) {
        if (i === j) continue;
        const k = rosterKey(`${t[i]} ${t[j]}|`);
        const row = DEMO_ROSTER.find((r) => r.r !== 'p' && r.k[0] === k);
        if (row) return this.startSession({ key: k, role: row.r === 'a' ? 'admin' : 'staff', faction: 'profkom', name: `${cap(t[j])} ${cap(t[i])}` });
      }
      return { state: null, error: 'Не нашли тебя в составе. Проверь фамилию и имя.' };
    }
    if (!gd) return { state: null, error: 'Укажи учебную группу — например, ЭР-23-24' };
    // участник: пары «фамилия имя» и «имя отчество» + цифры группы
    for (let i = 0; i < t.length; i++) for (let j = 0; j < t.length; j++) {
      if (i === j) continue;
      const k = rosterKey(`${t[i]} ${t[j]}|${gd}`);
      const row = DEMO_ROSTER.find((r) => r.k.includes(k));
      if (row) {
        if (row.r !== 'p') return { state: null, error: 'Это организатор — войди с кодом организатора' };
        const isFirst = row.k[0] === k;
        const rest = t.find((_, idx) => idx !== i && idx !== j);
        const name = isFirst ? `${cap(t[j])} ${cap(t[i])}` : `${cap(t[i])}${rest ? ` ${cap(rest)}` : ''}`;
        return this.startSession({ key: row.k[0], role: 'participant', faction: row.f as FactionId, name });
      }
    }
    // строки, загруженные организатором в этой демо-сессии
    const extra = lsJson<ExtraRow[]>(LS_EXTRA, []).find((r) => {
      const rt = normFio(r.fio).split(' ');
      return rt[0] === t[0] && rt[1] === t[1] && (!r.group || groupDigits(r.group) === gd || normGroup(r.group) === normGroup(p.group));
    });
    if (extra) {
      if (extra.role !== 'participant') return { state: null, error: 'Это организатор — войди с кодом организатора' };
      return this.startSession({ key: `x:${normFio(extra.fio)}`, role: 'participant', faction: extra.faction, name: `${cap(t[1])} ${cap(t[0])}` });
    }
    return { state: null, error: 'Не нашли тебя в списке выезда. Проверь ФИО и группу. Если всё верно — подойди к организаторам.' };
  }

  async loginTester(faction: FactionId, name: string) {
    return this.startSession({ key: `tester:${faction}:${name}`, role: 'tester', faction, name: name || 'Тестер' });
  }

  async logout() { lsDel(LS_SESSION); this.state = null; }

  /** После «Обнулить прогресс всех» до перезагрузки не сохраняем старое состояние из памяти. */
  private frozen = false;
  async save(s: GameState) { if (this.frozen) return; this.state = s; lsSet(LS_KEY, JSON.stringify(s)); }

  async config(): Promise<GameConfig> {
    const c = lsJson<Partial<GameConfig>>(LS_CFG, {});
    const host = c.checkinHost ?? null;
    return { shopOpen: c.shopOpen ?? TEST_MODE, testMode: TEST_MODE, requireGroup: c.requireGroup ?? true, checkinHost: host, canCheckin: this.staff && (!host || host.id === 'me'), casinoReveal: c.casinoReveal ?? false };
  }
  async staffSetCheckinHost(rosterId: string | null) {
    if (!this.admin) throw new Error('Только админы');
    const c = lsJson<Partial<GameConfig>>(LS_CFG, {});
    c.checkinHost = rosterId ? { id: rosterId, name: rosterId === 'me' ? (this.state?.username ?? 'Я') : 'Другой организатор' } : null;
    lsSet(LS_CFG, JSON.stringify(c));
    return this.config();
  }


  async claimTask(s: GameState, task: string, payload: TaskPayload = {}): Promise<SubmitResult> {
    const t = taskById(task);
    if (!t) return { status: 'error', message: 'Нет такого задания' };
    if (!taskAvailable(s, task)) return { status: 'rejected', message: 'Это задание уже засчитано' };
    if (task === 'tg_channel') return { status: 'error', message: 'Подписку бот проверяет только в Telegram-версии игры. Здесь — отправь скриншот подписки.' };
    let amount = t.amount;
    if (t.form === 'quiz') {
      const q = payload.quiz ? this.quizzes.get(payload.quiz) : undefined;
      if (!q || q.task !== task) return { status: 'error', message: 'Квиз не найден — открой его заново' };
      const right = q.ids.filter((id) => q.answers[id] === true).length;
      this.quizzes.delete(payload.quiz!);
      amount = t.amount * Math.min(QUIZ_N[task] ?? 3, right);
    }
    if (t.form === 'thought' && (payload.text ?? '').trim().length < 80) return { status: 'rejected', message: 'Нужно хотя бы 80 символов' };
    markDone(s, task);
    s.rating += amount;
    return { status: 'approved', granted: amount, message: amount ? `+${amount} баллов` : 'Засчитано' };
  }

  async submitTask(s: GameState, task: string, p: TaskPayload): Promise<SubmitResult> {
    if (!taskAvailable(s, task)) return { status: 'rejected', message: 'Уже сдано или на проверке' };
    const subs = this.subs();
    const t = taskById(task);
    if (!t) return { status: 'error', message: 'Нет такого задания' };
    const text = [p.link, p.text].filter(Boolean).join('\n');
    if (t.minText && (p.text ?? '').trim().length < t.minText) return { status: 'error', message: `Нужно от ${t.minText} символов` };
    if (t.maxText && (p.text ?? '').trim().length > t.maxText) return { status: 'error', message: `Не больше ${t.maxText} символов` };
    const sub: Submission = { id: `${Date.now()}`, player: s.username, faction: s.faction, task, text, at: Date.now(), status: 'pending' };
    if (p.photo) sub.photo = await blobToDataUrl(p.photo).catch(() => undefined);
    subs.unshift(sub);
    lsSet(LS_SUBS, JSON.stringify(subs.slice(0, 40)));
    s.tasks.pending[task] = (s.tasks.pending[task] ?? 0) + 1;
    return { status: 'pending', message: 'Отправлено на проверку — придёт уведомление «принято» или «не принято»' };
  }

  async quizStart(_s: GameState, task: string) {
    const n = QUIZ_N[task] ?? 3;
    const topics = QUIZ_TOPICS[task] ?? null;
    const pool = this.bankAll().filter((q) => !topics || topics.includes(q.topic));
    const questions = [...pool].sort(() => Math.random() - 0.5).slice(0, n);
    const id = randomCode(10);
    this.quizzes.set(id, { task, ids: questions.map((q) => q.id), answers: {}, at: Date.now() });
    return { id, questions };
  }

  async checkSub(): Promise<SubmitResult> {
    return { status: 'error', message: 'Подписку бот проверяет только в Telegram-версии игры. Здесь — отправь скриншот подписки.' };
  }

  async notes(): Promise<Note[]> { return lsJson<Note[]>(LS_NOTES, []); }
  async notesRead(ids: string[]) {
    const list = lsJson<Note[]>(LS_NOTES, []);
    list.forEach((n) => { if (ids.includes(n.id)) n.read = true; });
    lsSet(LS_NOTES, JSON.stringify(list));
  }
  async mySubmissions(s: GameState): Promise<MySubmission[]> {
    return this.subs().filter((x) => x.player === s.username).map((x) => ({ id: x.id, task: x.task, at: x.at, status: x.status, rating: x.rating, note: x.note }));
  }

  async shareTest(t: SharedTest) {
    const all = lsJson<Record<string, SharedTest>>(LS_SHARED, {});
    const code = randomCode(6);
    all[code] = { ...t, code, created: Date.now() };
    lsSet(LS_SHARED, JSON.stringify(all));
    return code;
  }
  async loadTest(code: string) {
    const all = lsJson<Record<string, SharedTest>>(LS_SHARED, {});
    return all[cleanCode(code)] ?? null;
  }
  async suggestQuestion(s: GameState | null, q: Question) {
    const list = lsJson<UserQuestion[]>(LS_UQ, []);
    list.unshift({ ...q, id: `u_${randomCode(8).toLowerCase()}`, status: 'pending', author: s?.username ?? 'гость', at: Date.now() });
    lsSet(LS_UQ, JSON.stringify(list.slice(0, 200)));
    return 'Вопрос отправлен организаторам. Если его примут — он появится в общем банке.';
  }

  async mySecret(s: GameState) {
    if (!s.secret) { s.secret = randomSecret(); await this.save(s); }
    return s.secret;
  }

  async redeemCode(s: GameState, raw: string): Promise<SubmitResult> {
    const up = raw.trim().toUpperCase();
    const egg = DEMO_EGG_CODES[up];
    if (egg) {
      if (s.tasks.eggs.includes(up)) return { status: 'rejected', message: 'Эту пасхалку ты уже нашёл' };
      if (!taskAvailable(s, egg.task)) return { status: 'rejected', message: 'Лимит по этому заданию исчерпан' };
      s.tasks.eggs.push(up); markDone(s, egg.task); s.rating += egg.rating;
      return { status: 'approved', granted: egg.rating, message: `Пасхалка! +${egg.rating} баллов` };
    }
    if (up in DEMO_CACHES) {
      const n = DEMO_CACHES[up];
      if (s.tasks.caches.includes(n)) return { status: 'rejected', message: `Тайник №${n} уже найден` };
      s.tasks.caches.push(n); markDone(s, 'caches');
      let g = 15;
      if (s.tasks.caches.length === 10) g += 50;
      s.rating += g;
      return { status: 'approved', granted: g, message: `Тайник №${n}: +${g} баллов${s.tasks.caches.length === 10 ? ' (все 10!)' : ''}` };
    }
    const sc = parseScanned(raw);
    const code = cleanCode(sc.code);
    if (sc.kind !== 'person') {
      const lect = this.lectures().find((l) => l.closesAt > Date.now() && (l.rotating === false ? l.code === code : codeMatches(l.secret, LECTURE_ROTATE_S, code)));
      if (lect) return this.claimLecture(s, lect);
      if (sc.kind === 'lecture') return { status: 'rejected', message: 'Код устарел или отметка закрыта. Отсканируй QR у организатора ещё раз.' };
    }
    if (s.secret && codeMatches(s.secret, PERSONAL_ROTATE_S, code)) return { status: 'rejected', message: 'Это твой собственный код' };
    const bot = BOTS.find((b) => codeMatches(b.secret, PERSONAL_ROTATE_S, code));
    if (bot) {
      const id = `bot:${bot.i}`;
      if (s.tasks.meets.includes(id)) return { status: 'rejected', message: 'С этим человеком вы уже знакомы' };
      const today = s.tasks.done[`meet@${mskDay()}`] ?? 0;
      if (today >= 20) return { status: 'rejected', message: 'На сегодня лимит знакомств — 20' };
      const g = bot.faction !== s.faction ? 10 : 5;
      s.tasks.meets.push(id); s.tasks.done[`meet@${mskDay()}`] = today + 1; s.rating += g;
      return { status: 'approved', granted: g, message: `Знакомство с ${bot.name}: +${g}${g === 10 ? ' (другое ПБ)' : ''}` };
    }
    return { status: 'error', message: 'Код не подошёл. Коды QR живут 20–30 секунд — попроси показать свежий.' };
  }

  private claimLecture(s: GameState, l: DemoLecture): SubmitResult {
    if (s.lectures.includes(l.id)) return { status: 'rejected', message: `Здесь («${l.title}») ты уже отмечен` };
    if (l.maxClaims > 0 && l.claims >= l.maxClaims) return { status: 'rejected', message: `Опоздал: баллы уже забрали первые ${l.maxClaims}` };
    const task = l.kind === 'speed' ? 'speed_qr' : l.kind === 'lecture' ? 'lecture' : null;
    if (task && !taskAvailable(s, task)) return { status: 'rejected', message: task === 'speed_qr' ? '«Я — скорость» сегодня уже засчитано' : 'Лимит отметок исчерпан' };
    s.lectures.push(l.id);
    if (task) markDone(s, task);
    s.rating += l.points;
    const all = this.lectures();
    const x = all.find((y) => y.id === l.id);
    if (x) { x.claims++; x.by.push(s.username); lsSet(LS_LECT, JSON.stringify(all)); }
    return { status: 'approved', granted: l.points, message: `Отметка «${l.title}»: +${l.points} баллов` };
  }

  async getQuestions() { return this.bankAll(); }
  async prepBank() { return this.bankAll(); }
  async checkAnswer(q: Question, given: string | number | boolean): Promise<CheckResult> {
    const r = checkLocal(q, given);
    for (const z of this.quizzes.values()) if (z.ids.includes(q.id) && !(q.id in z.answers)) z.answers[q.id] = r.correct;
    return r;
  }
  async reveal(q: Question) { return { right: rightAnswerText(q), explanation: q.explanation ?? '' }; }

  // ---------- ПБ как клан ----------
  private clanStore(): ClanStore {
    const c = lsJson<ClanStore | null>(LS_CLAN, null);
    if (c && c.anchor) return c;
    const n: ClanStore = { anchor: Date.now(), mine: {}, lastAt: 0 };
    lsSet(LS_CLAN, JSON.stringify(n));
    return n;
  }
  private hours() { return Math.max(0, (Date.now() - this.clanStore().anchor) / 3600_000); }
  private botContrib(b: Bot) { return Math.round(200 + hash01(b.secret) * 900 + this.hours() * (120 + hash01(b.secret + 'r') * 260)); }
  private botRating(b: Bot) { return Math.round(60 + hash01(b.secret + 'q') * 260 + this.hours() * (20 + hash01(b.secret + 'h') * 50)); }
  private factionXp(f: FactionId): Record<BuildingId, number> {
    const mine = this.clanStore().mine[f] ?? { kassa: 0, shtab: 0, media: 0 };
    const bots = BOTS.filter((b) => b.faction === f);
    const out = {} as Record<BuildingId, number>;
    BUILDINGS.forEach((bd, k) => {
      const share = [0.45, 0.35, 0.2][k];
      out[bd.id] = Math.round(bots.reduce((a, b) => a + this.botContrib(b), 0) * share) + (mine[bd.id] ?? 0);
    });
    return out;
  }

  async getClan(s: GameState): Promise<ClanView | null> {
    if (!s.faction) return null;
    const xp = this.factionXp(s.faction);
    const members: ClanMember[] = BOTS.filter((b) => b.faction === s.faction).map((b) => ({ name: b.name, rating: this.botRating(b), contributed: this.botContrib(b), bot: true }));
    if (s.faction === 'profkom') members.length = 0;
    members.push({ name: s.username, rating: s.rating, contributed: s.clicker.contributed, me: true });
    members.sort((a, b) => b.contributed - a.contributed);
    return { faction: s.faction, xp, members, bonuses: clanBonuses(xp), limit: CLAN.pbLimit };
  }

  async contribute(s: GameState, building: BuildingId, xp: number) {
    const c = this.clanStore();
    const now = Date.now();
    // как на сервере: не больше 15 опыта в секунду с прошлой отправки (+ запас 300)
    const allowed = Math.round(Math.min(xp, 300 + ((now - (c.lastAt || now - 60_000)) / 1000) * 15));
    const f = s.faction!;
    const m = c.mine[f] ?? { kassa: 0, shtab: 0, media: 0 };
    m[building] = (m[building] ?? 0) + allowed;
    c.mine[f] = m;
    c.lastAt = now;
    lsSet(LS_CLAN, JSON.stringify(c));
    return { accepted: allowed, clan: await this.getClan(s) };
  }

  async leaderboard(s: GameState | null) {
    const bots: LeaderRow[] = BOTS.map((b) => ({ name: b.name, faction: b.faction, rating: this.botRating(b), contributed: this.botContrib(b), power: 300 + this.botRating(b) * 4, bot: true }));
    const me: LeaderRow[] = s && s.faction && s.role !== 'staff' && s.role !== 'admin' && s.faction !== 'profkom'
      ? [{ name: s.username, faction: s.faction, rating: s.rating, contributed: s.clicker.contributed, power: squadPower(s).total, me: true }] : [];
    const players = [...bots, ...me].sort((a, b) => b.rating - a.rating);
    const w = this.loadWorld();
    const factions: FactionRow[] = PLAYABLE_FACTIONS.map((f) => {
      const rows = players.filter((p) => p.faction === f.id);
      const xpRec = this.factionXp(f.id);
      const xp = Object.values(xpRec).reduce((a, b) => a + b, 0);
      const rating = rows.reduce((a, r) => a + r.rating, 0);
      const influence = w.influence[f.id] ?? 0;
      return { faction: f.id, players: rows.length, limit: CLAN.pbLimit, rating, influence, xp, ratusha: clanBonuses(xpRec).ratusha, score: pbScore(rating, influence, xp) };
    }).sort((a, b) => b.score - a.score);
    return { players, factions };
  }

  // ---------- мир ----------
  private loadWorld(): WorldState {
    const raw = lsGet(LS_WORLD);
    try { const w = raw ? JSON.parse(raw) as WorldState : null; if (w && w.v === 1) return w; } catch { /* битые данные */ }
    return newWorld();
  }
  private saveWorld(w: WorldState) { lsSet(LS_WORLD, JSON.stringify(w)); }

  async getWorld(s: GameState) {
    const w = this.loadWorld();
    const now = Date.now();
    let guard = 0;
    while (now >= w.nextAt && guard++ < 12) {
      const mineOrder = s.war.orderRound === w.round ? s.war.order : null;
      const law = s.war.law && s.war.law.round === w.round ? s.war.law.share : 0;
      const rep = resolveRoundDemo(w, { order: mineOrder, lawShare: law, me: s, cooldown: s.war.cooldownRound === w.round });
      if (rep.my) {
        s.war.fights++;
        if (rep.my.won) { s.war.wins++; rep.my.rating = 0; }
      }
      w.nextAt = nextRoundAt(Math.max(w.nextAt, now - 1)) ?? w.nextAt + 3600_000;
    }
    payWarCoins(s, w, SKIRMISH_WIN_COINS);
    if (w.event && w.event.endAt <= now) {
      const ev = w.event;
      const res = closeEvent(w);
      const key = eventKey(ev.id, ev.startAt);
      if (res && s.events.played[key] !== undefined && !s.events.rewarded[key]) { s.events.rewarded[key] = 1; s.coins += 250; }
    }
    const slot = eventSlot(now);
    if (slot && (!w.event || w.event.startAt !== slot.startAt || w.event.id !== slot.ev.id)) {
      if (w.event) closeEvent(w);
      w.event = { id: slot.ev.id, startAt: slot.startAt, endAt: slot.endAt, scores: botEventScores(slot.ev, slot.startAt) };
    }
    if (w.event) {
      const key = eventKey(w.event.id, w.event.startAt);
      const best = s.events.played[key];
      w.event.scores = w.event.scores.filter((x) => !x.me);
      if (best !== undefined && s.faction && s.faction !== 'profkom') w.event.scores.push({ name: s.username, faction: s.faction, score: best, me: true });
    }
    this.saveWorld(w);
    return w;
  }
  async setOrder(s: GameState, order: Order | null) {
    const w = this.loadWorld();
    s.war.order = order;
    s.war.orderRound = w.round;
  }
  async setLaw(s: GameState, share: number) {
    const w = this.loadWorld();
    s.war.law = { round: w.round, share };
  }
  async submitEventScore(s: GameState, key: string, score: number) {
    s.events.played[key] = Math.max(s.events.played[key] ?? 0, score);
  }

  // ---------- мерч ----------
  private items(): MerchItem[] {
    const it = lsJson<MerchItem[] | null>(LS_MERCH, null);
    if (it) return it;
    const now = Date.now();
    const fresh = DEMO_MERCH.map((x) => ({ ...x, lastSaleAt: now }));
    lsSet(LS_MERCH, JSON.stringify(fresh));
    return fresh;
  }
  private orders(): MerchOrder[] { return lsJson<MerchOrder[]>(LS_ORDERS, []); }
  async merchList() { return this.items().filter((x) => x.active); }
  async wallet(s: GameState): Promise<Wallet> {
    const spent = this.orders().filter((o) => o.status !== 'cancelled').reduce((a, o) => a + o.price, 0);
    return { earned: s.rating, spent, balance: s.rating - spent };
  }
  async merchBuy(s: GameState, itemId: string) {
    const cfg = await this.config();
    if (!cfg.shopOpen) return { ok: false, message: 'Магазин мерча ещё закрыт' };
    if (s.role === 'staff' || s.role === 'admin') return { ok: false, message: 'Организаторы играют вне зачёта и мерч не покупают' };
    const items = this.items();
    const it = items.find((x) => x.id === itemId && x.active);
    if (!it) return { ok: false, message: 'Товар не найден' };
    if (it.stock <= 0) return { ok: false, message: 'Закончилось' };
    const mine = this.orders().filter((o) => o.itemId === itemId && o.status !== 'cancelled').length;
    if (mine >= it.perPerson) return { ok: false, message: `В одни руки — ${it.perPerson} шт.` };
    const price = merchPrice(it).price;
    const w = await this.wallet(s);
    if (w.balance < price) return { ok: false, message: `Не хватает ${price - w.balance} баллов` };
    it.stock -= 1;
    it.lastSaleAt = Date.now();
    lsSet(LS_MERCH, JSON.stringify(items));
    const order: MerchOrder = { id: randomCode(6), itemId, itemName: it.name, emoji: it.emoji, price, at: Date.now(), status: 'reserved', player: s.username, playerId: 'me', faction: s.faction };
    lsSet(LS_ORDERS, JSON.stringify([order, ...this.orders()]));
    return { ok: true, message: `${it.name} — твоё! Забери у организаторов по личному QR`, order };
  }
  async myOrders() { return this.orders(); }

  // ---------- лекции ----------
  private lectures(): DemoLecture[] { return lsJson<DemoLecture[]>(LS_LECT, []); }
  async lecturesOpen() {
    const now = Date.now();
    return this.lectures().filter((l) => l.closesAt > now).map(({ secret: _s, by: _b, code: _c, ...rest }) => ({ ...rest, mine: this.state?.lectures.includes(rest.id) }));
  }

  // ---------- поединки в правовухе (в демо соперник — бот) ----------
  private duels() { return lsJson<Record<string, DemoDuel>>(LS_DUELS, {}); }
  private saveDuels(d: Record<string, DemoDuel>) { lsSet(LS_DUELS, JSON.stringify(d)); }
  private duelOut(d: DemoDuel): Duel {
    const now = Date.now();
    const bStart = d.created + d.bot.join;
    const bAns = now < bStart ? 0 : Math.min(d.qids.length, Math.floor((now - bStart) / d.bot.per));
    const bOk = d.qids.slice(0, bAns).filter((q) => hash01(d.id + q) < d.bot.acc).length;
    const bDone = bAns >= d.qids.length;
    const bMs = bDone ? d.qids.length * d.bot.per : null;
    const myN = Object.keys(d.my.ans).length, myOk = Object.values(d.my.ans).filter(Boolean).length;
    const myDone = !!d.my.end;
    const myMs = d.my.end && d.my.start ? d.my.end - d.my.start : null;
    let result: Duel['result'] = null;
    if (myDone && bDone) result = myOk > bOk ? 'win' : myOk < bOk ? 'loss' : (myMs ?? 0) < (bMs ?? 0) ? 'win' : (myMs ?? 0) > (bMs ?? 0) ? 'loss' : 'draw';
    return {
      id: d.id, code: d.code, n: d.qids.length, qids: d.qids, created: d.created, me: d.mine ? 'a' : 'b',
      my: { answered: myN, right: myOk, started: !!d.my.start, done: myDone, ms: myMs },
      opp: now < bStart && d.mine ? null : { name: d.bot.name, faction: d.bot.faction, answered: bAns, right: myDone ? bOk : null, done: bDone, ms: bMs },
      result, score: result ? [myOk, bOk] : null,
    };
  }
  private newDemoDuel(mine: boolean, code?: string): DemoDuel {
    const pool = this.bankAll().filter((q) => q.format !== 'input');
    const qids = Array.from({ length: 7 }, () => pool[Math.floor(Math.random() * pool.length)].id);
    const bots = BOTS.filter((b) => b.faction !== this.state?.faction);
    const b = bots[Math.floor(Math.random() * bots.length)] ?? BOTS[0];
    return { id: `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, code: code ?? Math.random().toString(36).slice(2, 7).toUpperCase(), qids,
      created: mine ? Date.now() : Date.now() - 60_000, mine, my: { ans: {} },
      bot: { name: b.name, faction: b.faction, join: mine ? 4000 : -60_000, per: 2500 + Math.random() * 2500, acc: 0.45 + Math.random() * 0.4 } };
  }
  async duelCreate() {
    const all = this.duels();
    const d = this.newDemoDuel(true);
    all[d.id] = d; this.saveDuels(all);
    return this.duelOut(d);
  }
  async duelJoin(code: string) {
    const c = code.trim().toUpperCase();
    const all = this.duels();
    const ex = Object.values(all).find((x) => x.code === c);
    if (ex) return this.duelOut(ex);
    if (c.length !== 5) throw new Error('Вызов не найден или устарел — проверь код');
    const d = this.newDemoDuel(false, c);
    all[d.id] = d; this.saveDuels(all);
    return this.duelOut(d);
  }
  async duelStart(id: string) {
    const all = this.duels(); const d = all[id];
    if (!d) throw new Error('Поединок не найден');
    d.my.start ??= Date.now(); this.saveDuels(all);
    return this.duelOut(d);
  }
  async duelAnswer(id: string, q: Question, given: string | number | boolean): Promise<DuelAnswer> {
    const all = this.duels(); const d = all[id];
    if (!d || !d.my.start) throw new Error('Сначала начни поединок');
    if (q.id in d.my.ans) throw new Error('На этот вопрос уже ответил');
    const r = given === '__timeout__' ? { ...checkLocal(q, '__timeout__'), correct: false } : checkLocal(q, given);
    d.my.ans[q.id] = r.correct;
    if (Object.keys(d.my.ans).length >= d.qids.length) d.my.end = Date.now();
    this.saveDuels(all);
    return { ...r, duel: this.duelOut(d) };
  }
  async duelState(id: string) {
    const d = this.duels()[id];
    if (!d) throw new Error('Поединок не найден');
    return this.duelOut(d);
  }
  async duelList(): Promise<DuelList> {
    const mine = Object.values(this.duels()).sort((a, b) => b.created - a.created).slice(0, 15).map((d) => this.duelOut(d));
    const open = BOTS.filter((b) => b.faction !== this.state?.faction).slice(0, 2).map((b, i) => ({ code: `DEMO${i + 1}`, name: b.name, faction: b.faction, created: Date.now() - (i + 1) * 7 * 60_000, right: i === 0 ? 5 : null }));
    const wins = mine.filter((d) => d.result === 'win').length;
    const board = [{ name: BOTS[0].name, faction: BOTS[0].faction, wins: 4, played: 6 }, { name: BOTS[3].name, faction: BOTS[3].faction, wins: 2, played: 5 }];
    if (wins) board.push({ name: this.state?.username ?? 'Я', faction: (this.state?.faction ?? 'ivti') as FactionId, wins, played: mine.filter((d) => d.result).length });
    return { mine, open, board: board.sort((a, b) => b.wins - a.wins) };
  }

  // ---------- захват профкома (в демо — боссы без имён, прогресс в браузере) ----------
  private raidData() {
    return lsJson<{ hp: number; prog: Record<string, { boss: number; dmg: number; last: number; done?: number }>; hits: number[]; holder: { faction: FactionId; at: number } | null }>(LS_RAID, { hp: 45000, prog: {}, hits: [], holder: null });
  }
  private raidBosses(hp: number) {
    const titles = ['Организатор', 'Организатор', 'Организатор', 'Организатор', 'Организатор', 'Организатор', 'Организатор', 'Организатор', 'Зам. председателя', 'Председатель'];
    return titles.map((title, i, a) => ({ i, name: i === a.length - 1 ? 'Председатель профкома' : `Организатор №${i + 1}`, title, hp: Math.round(hp * (1 + 0.25 * i) * (i === a.length - 1 ? 2.5 : 1)) }));
  }
  private raidOut(): RaidState {
    const d = this.raidData();
    const bosses = this.raidBosses(d.hp);
    const per = TEST_MODE ? 2 : 20;
    const f = this.state?.faction && this.state.faction !== 'profkom' ? this.state.faction : null;
    const pr = f ? d.prog[f] ?? { boss: 0, dmg: 0, last: Date.now() } : null;
    const cur = pr ? bosses[pr.boss] : null;
    const eff = pr && cur ? Math.max(0, pr.dmg - Math.floor(cur.hp * 0.1 * Math.max(0, (Date.now() - pr.last) / 3600_000))) : 0;
    const last = d.hits[0] ?? 0;
    return {
      bosses, cooldownMin: per, holder: d.holder,
      my: f && pr ? { faction: f, boss: pr.boss, dmg: eff, hp: cur?.hp ?? 0, done: pr.boss >= bosses.length, cooldownLeft: Math.max(0, last + per * 60_000 - Date.now()), power: Math.max(600, squadPower(this.state!).raw) } : null,
      leaders: Object.entries(d.prog).map(([k, v]) => ({ faction: k as FactionId, boss: v.boss, done: !!v.done })).sort((a, b) => b.boss - a.boss),
    };
  }
  async raidState() { return this.raidOut(); }
  async raidHit(dmg: number): Promise<RaidHit> {
    const s = this.state;
    if (!s || !s.faction || s.faction === 'profkom') throw new Error('Организаторы — боссы, штурмуют участники');
    const st = this.raidOut();
    if (!st.my) throw new Error('Сначала выбери профбюро');
    if (st.my.cooldownLeft > 0) throw new Error(`Отряд отдыхает: штурм раз в ${st.cooldownMin} ${plural(st.cooldownMin, 'минуту', 'минуты', 'минут')}`);
    if (st.my.done) throw new Error('Твоё профбюро уже прошло всех боссов');
    const d = this.raidData();
    const cur = st.bosses[st.my.boss];
    const dealt = Math.max(0, Math.min(Math.round(dmg), st.my.power * 6, cur.hp - st.my.dmg));
    d.hits.unshift(Date.now()); d.hits = d.hits.slice(0, 20);
    let defeated = false, captured = false;
    if (st.my.dmg + dealt >= cur.hp) {
      defeated = true;
      const nb = st.my.boss + 1;
      d.prog[s.faction] = { boss: nb, dmg: 0, last: Date.now(), done: nb >= st.bosses.length ? Date.now() : undefined };
      if (nb >= st.bosses.length) { captured = true; d.holder = { faction: s.faction, at: Date.now() }; }
    } else d.prog[s.faction] = { boss: st.my.boss, dmg: st.my.dmg + dealt, last: Date.now() };
    lsSet(LS_RAID, JSON.stringify(d));
    return { dealt, defeated, captured, boss: cur.name, state: this.raidOut() };
  }
  async staffRaidSet(hp: number) { const d = this.raidData(); d.hp = Math.max(1000, Math.min(1_000_000, Math.round(hp))); lsSet(LS_RAID, JSON.stringify(d)); return this.raidOut(); }
  async staffRaidReset() { if (!this.admin) throw new Error('Только админы'); lsSet(LS_RAID, JSON.stringify({ hp: this.raidData().hp, prog: {}, hits: [], holder: null })); return this.raidOut(); }

  // ---------- голосование (в демо голосуют ещё 40 ботов, чтобы на экране было движение) ----------
  private vote(): DemoVote {
    const v = lsJson<DemoVote | null>(LS_VOTE, null);
    // старое демо с командами-профбюро — начинаем заново с номерными командами
    if (v && v.teams.every((t) => /^t\d+$/.test(t.id))) return v;
    return { round: 1, title: VOTE_DEFAULT_TITLE, status: 'idle', current: null, reveal: false, teams: defaultVoteTeams().map((t) => ({ ...t, za: 0, protiv: 0 })), my: {}, voters: 0, at: Date.now(), bots: {} };
  }
  private voteOut(v: DemoVote): VoteState {
    v.teams = v.teams.map((t) => ({ ...t, za: (v.bots[t.id]?.[0] ?? 0) + (v.my[t.id] === 1 ? 1 : 0), protiv: (v.bots[t.id]?.[1] ?? 0) + (v.my[t.id] === -1 ? 1 : 0), size: v.people ? Object.values(v.people).filter((x) => x === t.id).length : v.sizes?.[t.id] ?? 0 }));
    v.voters = Math.min(40, Math.max(0, ...Object.values(v.bots).map(([a, b]) => a + b))) + (Object.keys(v.my).length ? 1 : 0);
    lsSet(LS_VOTE, JSON.stringify(v));
    const { bots: _b, sizes: _s, people: _p, ...out } = v;
    return { ...out, myFaction: this.state?.faction ?? null };
  }
  async voteState() {
    const v = this.vote();
    if (v.status === 'open') {
      // боты голосуют понемногу: у каждой команды свой «характер», чтобы итог не был одинаковым
      for (const t of v.teams) {
        if (v.current && v.current !== t.id) continue;
        const b = v.bots[t.id] ?? [0, 0];
        const like = 0.35 + ((t.name.charCodeAt(0) * 37 + t.name.length * 11) % 50) / 100;
        for (let k = 0; k < 3 && b[0] + b[1] < 40; k++) if (Math.random() < 0.6) b[Math.random() < like ? 0 : 1]++;
        v.bots[t.id] = b;
      }
    }
    return this.voteOut(v);
  }
  async voteCast(team: string, val: 1 | -1 | 0) {
    const v = this.vote();
    if (v.status !== 'open') throw new Error('Голосование сейчас закрыто');
    if (v.current && v.current !== team) throw new Error('Сейчас голосуем за другую команду');
    const t = v.teams.find((x) => x.id === team);
    if (!t) throw new Error('Нет такой команды');
    if (t.id === v.myTeam || (t.faction && t.faction === this.state?.faction)) throw new Error('За свою команду голосовать нельзя');
    if (val === 0) delete v.my[team]; else v.my[team] = val;
    return this.voteOut(v);
  }
  async staffVoteSetup(title: string, teams: { id: string; name: string; faction: FactionId | null }[]) {
    if (teams.length < 2) throw new Error('Нужно хотя бы две команды');
    const v = this.vote();
    const ids = new Set(teams.map((t) => t.id));
    const vp = v as typeof v & { people?: Record<string, string> };
    const people = Object.fromEntries(Object.entries(vp.people ?? {}).filter(([, t]) => ids.has(t)));
    const keep = !!v.myTeam && ids.has(v.myTeam);
    return this.voteOut({ ...v, round: v.round + 1, title: title.trim() || VOTE_DEFAULT_TITLE, teams: teams.map((t) => ({ ...t, za: 0, protiv: 0 })), status: 'idle', current: null, reveal: false, my: {}, bots: {}, at: Date.now(),
      myTeam: keep ? v.myTeam : null, mates: keep ? v.mates : [], people } as typeof v);
  }
  /** В демо: кто вписан в команды — хранится в браузере; «я» — если вписано моё имя. */
  async voteJoin(fio: string, team: string) {
    const v = this.vote() as DemoVote;
    if (!v.teams.some((t) => t.id === team)) throw new Error('Выбери команду');
    const name = fio.trim().replace(/\s+/g, ' ');
    if (name.split(' ').length < 2) throw new Error('Нет такого ФИО в списке выезда — проверь написание (фамилия и имя)');
    const people = v.people ?? {};
    if (people[name] && people[name] !== team && v.status === 'open') throw new Error('Команду уже не поменять — голосование идёт. Попроси организатора');
    people[name] = team;
    const me = (this.state?.username ?? '').toLowerCase();
    const isMe = name.toLowerCase().split(' ').some((w) => w.length > 2 && me.includes(w));
    const sizes: Record<string, number> = {};
    Object.values(people).forEach((t) => { sizes[t] = (sizes[t] ?? 0) + 1; });
    const next = { ...v, people, sizes, myTeam: isMe ? team : v.myTeam } as typeof v;
    if (isMe) delete next.my[team];
    next.mates = next.myTeam ? Object.entries(people).filter(([, t]) => t === next.myTeam).map(([n]) => n) : [];
    return { ...this.voteOut(next), joined: name };
  }
  async staffVoteMembers() {
    const v = this.vote() as DemoVote;
    return v.teams.map((t) => ({ team: t.id, name: t.name, people: Object.entries(v.people ?? {}).filter(([, x]) => x === t.id).map(([n]) => ({ id: n, name: n })) }));
  }
  async staffVoteKick(id: string | number) {
    const v = this.vote() as DemoVote;
    if (v.people) delete v.people[String(id)];
    return this.voteOut(v);
  }
  async staffVoteControl(action: VoteAction, team: string | null = null) {
    let v = this.vote();
    if (action === 'open') v = { ...v, status: 'open', current: team, reveal: false };
    else if (action === 'close') v = { ...v, status: 'closed', current: null };
    else if (action === 'reveal') v = { ...v, status: 'closed', current: null, reveal: true };
    else if (action === 'hide') v = { ...v, reveal: false };
    else v = { ...v, round: v.round + 1, status: 'idle', current: null, reveal: false, my: {}, bots: {} };
    v.at = Date.now();
    return this.voteOut(v);
  }

  // ---------- эфир ----------
  async liveFeed(): Promise<Announcement[]> {
    const now = Date.now();
    const own = lsJson<Announcement[]>(LS_LIVE, []).filter((a) => !a.until || a.until > now);
    const fromRepo = await fetchLiveJson();
    return [...own, ...fromRepo].sort((a, b) => b.at - a.at);
  }

  // ---------- организатор (в демо — на самом себе) ----------
  private subs(): Submission[] { return lsJson<Submission[]>(LS_SUBS, []); }
  async staffSubmissions() {
    // в демо проверяет один человек: всё, что он взял, — «у меня»
    const mine = lsJson<string[]>(LS_DUTY + '.claims', []);
    return this.subs().map((x) => ({ ...x, claimedBy: mine.includes(x.id) ? this.state?.username ?? 'я' : null, claimedMine: mine.includes(x.id) }));
  }
  async staffClaim(n: number) {
    const pend = this.subs().filter((x) => x.status === 'pending').map((x) => x.id);
    const mine = lsJson<string[]>(LS_DUTY + '.claims', []).filter((id) => pend.includes(id));
    for (const id of pend) { if (mine.length >= n + mine.length || mine.includes(id)) continue; if (mine.length - 0 >= 20) break; mine.push(id); if (mine.filter((x) => pend.includes(x)).length >= n) break; }
    lsSet(LS_DUTY + '.claims', JSON.stringify(mine));
    return mine.length;
  }
  async staffRelease() { lsSet(LS_DUTY + '.claims', '[]'); }
  async staffTeam(): Promise<TeamMember[]> {
    const d = lsJson<{ zone: DutyZone; note: string; at: number }>(LS_DUTY, { zone: 'free', note: '', at: Date.now() });
    const pend = this.subs().filter((x) => x.status === 'pending').map((x) => x.id);
    const holding = lsJson<string[]>(LS_DUTY + '.claims', []).filter((id) => pend.includes(id)).length;
    const qrOpen = this.lectures().filter((l) => l.closesAt > Date.now()).length;
    const t = Date.now() - 20 * 60_000;
    return [
      { id: 'me', name: this.state?.username ?? 'Я', role: 'admin', me: true, zone: d.zone, note: d.note, at: d.at, reviewed: this.subs().filter((x) => x.status !== 'pending').length, holding, qrOpen },
      { id: 'demo1', name: 'Анна (демо)', role: 'staff', me: false, zone: 'qr', note: 'блок 2, актовый', at: t, reviewed: 0, holding: 0, qrOpen: 0 },
      { id: 'demo2', name: 'Илья (демо)', role: 'staff', me: false, zone: 'merch', note: 'стол выдачи', at: t, reviewed: 3, holding: 0, qrOpen: 0 },
    ];
  }
  async staffSetDuty(zone: DutyZone, note: string) { lsSet(LS_DUTY, JSON.stringify({ zone, note: note.slice(0, 60), at: Date.now() })); }
  async staffReview(id: string, ok: boolean, rating: number, note?: string) {
    const subs = this.subs();
    const sub = subs.find((x) => x.id === id);
    if (!sub || sub.status !== 'pending') return;
    sub.status = ok ? 'approved' : 'rejected';
    sub.rating = ok ? Math.max(0, Math.min(500, Math.round(rating))) : 0;
    if (note) sub.note = note.slice(0, 300);
    lsSet(LS_SUBS, JSON.stringify(subs));
    const s = this.state;
    const title = taskById(sub.task)?.title ?? sub.task;
    if (s && sub.player === s.username) {
      s.tasks.pending[sub.task] = Math.max(0, (s.tasks.pending[sub.task] ?? 1) - 1);
      if (ok) { markDone(s, sub.task); s.rating += sub.rating; }
      await this.save(s);
      this.note(ok ? `✅ Принято: «${title}» — +${sub.rating} баллов${note ? `. ${note}` : ''}` : `❌ Не принято: «${title}»${note ? ` — ${note}` : ''}. Можно сдать заново.`, ok ? 'ok' : 'bad');
    }
  }
  async staffQuestions() { return lsJson<UserQuestion[]>(LS_UQ, []); }
  async staffQuestionReview(id: string, ok: boolean) {
    const list = lsJson<UserQuestion[]>(LS_UQ, []);
    const q = list.find((x) => x.id === id);
    if (!q || q.status !== 'pending') return;
    q.status = ok ? 'approved' : 'rejected';
    lsSet(LS_UQ, JSON.stringify(list));
    if (ok) {
      const { status: _s, author: _a, at: _t, ...plain } = q;
      lsSet(LS_BANKX, JSON.stringify([...lsJson<Question[]>(LS_BANKX, []), { ...plain, source: `Вопрос участника (${q.author ?? 'аноним'})` }]));
      if (this.state && q.author === this.state.username) this.note(`✅ Твой вопрос добавлен в общий банк: «${q.question.slice(0, 80)}»`, 'ok');
    }
  }
  async staffFindPlayers(q: string) {
    const s = this.state;
    const rows: PlayerRef[] = s ? [{ id: 'me', name: s.username, faction: s.faction, rating: s.rating }] : [];
    BOTS.forEach((b) => rows.push({ id: `bot${b.i}`, name: b.name, faction: b.faction, rating: this.botRating(b) }));
    return rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  }
  async staffGrant(playerId: string, task: string, amount: number, note?: string) {
    const s = this.state;
    if (playerId === 'me' && s) {
      if (amount < 0) {
        const g = -Math.min(-amount, Math.max(0, s.rating));
        if (!g) throw new Error('У участника 0 баллов — снимать нечего');
        s.rating += g; await this.save(s);
        this.note(`Организатор снял ${-g} баллов${note ? `: ${note}` : ''}`, 'bad');
        return `Снято ${-g} баллов · теперь ${s.rating}`;
      }
      s.rating += amount; markDone(s, task); await this.save(s);
      this.note(`Организатор начислил +${amount} баллов: ${note || (taskById(task)?.title ?? 'бонус')}`, 'ok');
      return `Начислено ${amount} баллов: ${s.username}`;
    }
    return amount < 0 ? `Снято ${-amount} (бот, в демо не сохраняется)` : `Начислено ${amount} (бот, в демо не сохраняется)`;
  }
  async staffForceRound() {
    const w = this.loadWorld();
    w.nextAt = Date.now() - 1;
    this.saveWorld(w);
  }
  async staffStartEvent(id: string) { forceEvent(id); }

  async staffMerchSave(item: Partial<MerchItem> & { name: string }) {
    const items = this.items();
    const ex = item.id ? items.find((x) => x.id === item.id) : undefined;
    if (ex) Object.assign(ex, item, { total: Math.max(ex.total, item.stock ?? ex.stock) });
    else items.push({ id: randomCode(5).toLowerCase(), emoji: '🎁', text: '', price: 100, stock: 1, total: item.stock ?? 1, perPerson: 1, discount: 0, auto: null, active: true, ...item, lastSaleAt: Date.now() } as MerchItem);
    lsSet(LS_MERCH, JSON.stringify(items));
  }
  async staffMerchImport(text: string) {
    const rows = parseMerchLines(text);
    for (const r of rows) {
      const items = this.items();
      const ex = items.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
      await this.staffMerchSave(ex ? { ...ex, stock: r.stock, price: r.price } : { ...r, perPerson: 1, auto: { afterHours: 3, stepPct: 10, maxPct: 40 } });
    }
    return rows.length ? `Загружено позиций: ${rows.length}` : 'Не нашли строк вида «Название; количество; цена»';
  }
  async staffMerchDelete(id: string) {
    const items = this.items();
    const it = items.find((x) => x.id === id);
    if (it) it.active = false;
    lsSet(LS_MERCH, JSON.stringify(items));
  }
  async staffOrders() { return this.orders(); }
  async staffOrderSet(id: string, status: 'issued' | 'cancelled') {
    const orders = this.orders();
    const o = orders.find((x) => x.id === id);
    if (!o || o.status !== 'reserved') return;
    o.status = status;
    if (status === 'cancelled') {
      const items = this.items();
      const it = items.find((x) => x.id === o.itemId);
      if (it) { it.stock += 1; lsSet(LS_MERCH, JSON.stringify(items)); }
    }
    lsSet(LS_ORDERS, JSON.stringify(orders));
  }
  async staffOrdersByCode(code: string) {
    const s = this.state;
    const c = cleanCode(parseScanned(code).code);
    if (s && s.secret && codeMatches(s.secret, PERSONAL_ROTATE_S, c)) return { player: s.username, orders: this.orders().filter((o) => o.status === 'reserved') };
    return { error: 'Код не подошёл (в демо — только твой собственный QR)' };
  }

  async staffLectureOpen(p: QrSessionInput) {
    const now = Date.now();
    const same = this.lectures().find((l) => l.closesAt > now && l.kind === p.kind && l.title.trim().toLowerCase() === p.title.trim().toLowerCase());
    if (same) return { ...same, existing: true, openedByName: this.state?.username };
    const minutes = Math.max(1, Math.min(p.rotating ? 180 : 24 * 60, Math.round(p.minutes)));
    const l: DemoLecture = { id: randomCode(8), title: p.title.slice(0, 80), points: Math.max(1, Math.min(LECTURE.maxPoints, Math.round(p.points))), openedAt: now, closesAt: now + minutes * 60_000, claims: 0, secret: randomSecret(), by: [],
      kind: p.kind, maxClaims: Math.max(0, Math.min(500, Math.round(p.maxClaims))), rotating: p.rotating, code: p.rotating ? undefined : randomCode(6) };
    lsSet(LS_LECT, JSON.stringify([l, ...this.lectures()].slice(0, 40)));
    return l;
  }
  async staffLectures() { return this.lectures(); }
  async staffLectureClose(id: string) {
    const all = this.lectures();
    const l = all.find((x) => x.id === id);
    if (l) l.closesAt = Math.min(l.closesAt, Date.now());
    lsSet(LS_LECT, JSON.stringify(all));
  }

  async staffAnnounce(a: { text: string; kind: Announcement['kind']; minutes: number | null }) {
    const list = lsJson<Announcement[]>(LS_LIVE, []);
    list.unshift({ id: randomCode(6), text: a.text.slice(0, 500), kind: a.kind, at: Date.now(), until: a.minutes ? Date.now() + a.minutes * 60_000 : null, author: this.state?.username, source: 'staff' });
    lsSet(LS_LIVE, JSON.stringify(list.slice(0, 50)));
  }
  async staffAnnounceDelete(id: string) {
    lsSet(LS_LIVE, JSON.stringify(lsJson<Announcement[]>(LS_LIVE, []).filter((a) => a.id !== id)));
  }

  async staffRoster(): Promise<RosterRow[]> {
    const extra = lsJson<ExtraRow[]>(LS_EXTRA, []);
    const hidden: RosterRow[] = DEMO_ROSTER.map((r, i) => ({ id: `d${i}`, fio: `Участник №${i + 1} (имя скрыто в демо)`, faction: r.f as FactionId, group: '—', role: r.r === 'a' ? 'admin' : r.r === 's' ? 'staff' : 'participant', bound: false }));
    return [...extra.map((r, i) => ({ id: `x${i}`, fio: r.fio, faction: r.faction, group: r.group, role: r.role, bound: false })), ...hidden];
  }
  async staffRosterImport(text: string) {
    const rows = parseRosterLines(text);
    if (!rows.length) return 'Не нашли строк. Формат: Институт; ФИО; Группа; (Должность); (Роль)';
    const extra = lsJson<ExtraRow[]>(LS_EXTRA, []);
    for (const r of rows) {
      const i = extra.findIndex((x) => normFio(x.fio) === normFio(r.fio));
      if (i >= 0) extra[i] = r; else extra.push(r);
    }
    lsSet(LS_EXTRA, JSON.stringify(extra));
    const by = rows.reduce<Record<string, number>>((a, r) => { a[r.faction] = (a[r.faction] ?? 0) + 1; return a; }, {});
    const over = Object.entries(by).filter(([f, n]) => f !== 'profkom' && n > CLAN.pbLimit);
    return `Загружено строк: ${rows.length}${over.length ? `. Внимание: больше ${CLAN.pbLimit} человек в ${over.map(([f]) => f).join(', ')} — войдут только первые ${CLAN.pbLimit}` : ''}`;
  }
  async staffRosterReset() { return 'В демо привязок нет — сброс нужен только на сервере'; }
  async adminResetProgress(confirm: string) {
    if (!this.admin) throw new Error('Сбросить прогресс могут только админы');
    if (confirm.trim().toUpperCase() !== 'СБРОС') throw new Error('Для подтверждения введи слово СБРОС');
    this.frozen = true;
    try { [LS_WORLD, LS_SUBS, LS_CLAN, LS_ORDERS, LS_LECT, LS_LIVE, LS_NOTES, LS_DUTY, LS_VOTE, LS_RAID, LS_DUELS, 'pbgame.prep'].forEach((k) => localStorage.removeItem(k)); } catch { /* приватный режим */ }
    lsDel(LS_KEY); lsDel(LS_SESSION); // как на сервере: регистрация тоже сбрасывается — вход заново
    return 'Демо: всё сброшено, войди заново';
  }
  async staffSetSetting(key: 'shop_open' | 'require_group' | 'casino_reveal', value: boolean) {
    const c = lsJson<Partial<GameConfig>>(LS_CFG, {});
    if (key === 'shop_open') c.shopOpen = value; else if (key === 'casino_reveal') c.casinoReveal = value; else c.requireGroup = value;
    lsSet(LS_CFG, JSON.stringify(c));
  }
  /** В демо: моя статистика плюс 30 «участников», которые крутили так же. */
  async casinoStats(): Promise<CasinoStats> {
    const m = this.state?.casino ?? { bet: 0, won: 0, spins: 0, near: 0 };
    return { players: 31, spins: m.spins + 1240, bet: m.bet + 186000, won: m.won + 117200, near: m.near + 610 };
  }

  /** Для тест-панели: текущий QR-код бота, чтобы проверить знакомство. */
  botSecret(i = 7) { return BOTS[i % BOTS.length]; }
}

// ---------- общие разборщики ----------
const INST: Record<string, FactionId> = { инэи: 'inei', ирэ: 'ire', гпи: 'gpi', игвиэ: 'igvie', иэвт: 'ievt', иэтэ: 'iete', энми: 'enmi', итаэ: 'itae', ивти: 'ivti', иээ: 'iee', профком: 'profkom', состав: 'profkom', ппо: 'profkom' };

/** Строки «Институт; ФИО; Группа; Должность; Роль» (из Excel — через Tab или «;»). */
export function parseRosterLines(text: string): ExtraRow[] {
  const out: ExtraRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/\t|;/).map((x) => x.trim());
    if (cells.length < 2) continue;
    const f = INST[cells[0].toLowerCase().replace(/ё/g, 'е')];
    if (!f) continue;
    const fio = cells[1];
    if (normFio(fio).split(' ').length < 2) continue;
    const roleCell = (cells[4] ?? '').toLowerCase();
    const role: Role = /админ/.test(roleCell) ? 'admin' : /орг|состав/.test(roleCell) || f === 'profkom' ? 'staff' : 'participant';
    out.push({ fio, group: cells[2] ?? '', faction: role === 'participant' ? f : 'profkom', role });
  }
  return out;
}

/** Строки «Название; количество; цена» (можно с эмодзи в начале названия). */
export function parseMerchLines(text: string) {
  const out: { name: string; stock: number; price: number; emoji: string; text: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/\t|;/).map((x) => x.trim());
    if (cells.length < 3) continue;
    const stock = parseInt(cells[1], 10), price = parseInt(cells[2], 10);
    if (!cells[0] || !(stock >= 0) || !(price > 0)) continue;
    const m = cells[0].match(/^(\p{Extended_Pictographic}️?)\s*(.+)$/u);
    out.push({ name: (m ? m[2] : cells[0]).slice(0, 60), emoji: m ? m[1] : '🎁', stock, price, text: cells[3] ?? '' });
  }
  return out;
}

/** Сообщения, которые Claude публикует через репозиторий (public/live.json). */
export async function fetchLiveJson(): Promise<Announcement[]> {
  if (!/^https?:$/.test(location.protocol) || import.meta.env.VITE_LIVE_JSON === '0') return [];
  try {
    const r = await fetch(`./live.json?t=${Math.floor(Date.now() / 30000)}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json() as { messages?: { id?: string; text?: string; kind?: string; at?: string; until?: string }[] };
    const now = Date.now();
    return (j.messages ?? []).filter((m) => m.text).map((m, i) => ({
      id: `c-${m.id ?? i}`, text: String(m.text).slice(0, 500), kind: (['info', 'alert', 'win'].includes(m.kind ?? '') ? m.kind : 'info') as Announcement['kind'],
      at: m.at ? Date.parse(m.at) || now : now, until: m.until ? Date.parse(m.until) || null : null, source: 'claude' as const, author: 'Claude',
    })).filter((a) => !a.until || a.until > now);
  } catch { return []; }
}

