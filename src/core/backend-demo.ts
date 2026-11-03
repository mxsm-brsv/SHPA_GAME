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
import { grantByCaps, markDone, taskAvailable } from './rules';
import { mskDay, migrate, newState, type GameState, type Role } from './state';
import { squadPower } from './logic';
import { botEventScores, closeEvent, eventKey, eventSlot, forceEvent, newWorld, nextRoundAt, resolveRoundDemo, type Order, type WorldState } from './world';
import type {
  Announcement, Backend, ClanMember, ClanView, FactionRow, GameConfig, LeaderRow, LectureSession, LoginParams, LoginResult,
  MySubmission, Note, PlayerRef, QrSessionInput, RosterRow, SharedTest, Submission, SubmitResult, TaskPayload, UserQuestion, Wallet,
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
    const staffCode = (p.staffCode ?? '').trim().toUpperCase();
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

  async save(s: GameState) { this.state = s; lsSet(LS_KEY, JSON.stringify(s)); }

  async config(): Promise<GameConfig> {
    const c = lsJson<Partial<GameConfig>>(LS_CFG, {});
    return { shopOpen: c.shopOpen ?? TEST_MODE, testMode: TEST_MODE, requireGroup: c.requireGroup ?? true };
  }

  async addGameRating(s: GameState, source: string, value: number) { return grantByCaps(s, source, value); }

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
        if (rep.my.won) { s.war.wins++; rep.my.rating = grantByCaps(s, 'skirmish', (s.daily.byGame.skirmish ?? 0) + 10); }
      }
      w.nextAt = nextRoundAt(Math.max(w.nextAt, now - 1)) ?? w.nextAt + 3600_000;
    }
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

  // ---------- эфир ----------
  async liveFeed(): Promise<Announcement[]> {
    const now = Date.now();
    const own = lsJson<Announcement[]>(LS_LIVE, []).filter((a) => !a.until || a.until > now);
    const fromRepo = await fetchLiveJson();
    return [...own, ...fromRepo].sort((a, b) => b.at - a.at);
  }

  // ---------- организатор (в демо — на самом себе) ----------
  private subs(): Submission[] { return lsJson<Submission[]>(LS_SUBS, []); }
  async staffSubmissions() { return this.subs(); }
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
  async staffGrant(playerId: string, task: string, amount: number) {
    const s = this.state;
    if (playerId === 'me' && s) {
      s.rating += amount; markDone(s, task); await this.save(s);
      this.note(`⭐ Организатор начислил +${amount} баллов: ${taskById(task)?.title ?? 'бонус'}`, 'ok');
      return `Начислено ${amount} баллов: ${s.username}`;
    }
    return `Начислено ${amount} (бот, в демо не сохраняется)`;
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
  async staffSetSetting(key: 'shop_open' | 'require_group', value: boolean) {
    const c = lsJson<Partial<GameConfig>>(LS_CFG, {});
    if (key === 'shop_open') c.shopOpen = value; else c.requireGroup = value;
    lsSet(LS_CFG, JSON.stringify(c));
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

