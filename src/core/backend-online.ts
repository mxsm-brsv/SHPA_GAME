// Онлайн-режим: Supabase (база + функции). Все начисления и проверки — на сервере.
import { CLAN, clanBonuses, type BuildingId } from '../config/clan';
import type { FactionId } from '../config/factions';
import type { MerchItem, MerchOrder } from '../config/merch';
import { Sb } from '../lib/sb';
import { randomSecret } from './codes';
import type { CheckResult, Question } from './questions';
import { markDone } from './rules';
import { taskById } from '../config/tasks';
import { migrate, newState, rollDay, type GameState, type Role } from './state';
import { squadPower } from './logic';
import { telegram } from './telegram';
import { newWorld, type Order, type WorldState } from './world';
import { fetchLiveJson, parseMerchLines, parseRosterLines } from './backend-demo';
import type {
  Announcement, Backend, ClanView, FactionRow, GameConfig, LeaderRow, LectureSession, LoginParams, LoginResult,
  MySubmission, Note, PlayerRef, QrSessionInput, RosterRow, SharedTest, Submission, SubmitResult, TaskPayload, UserQuestion, Wallet,
} from './backend';

interface MeRow { id: string; username: string; faction: FactionId | null; rating: number; state: unknown; role: Role; secret: string; contributed: number }
interface ClanRow { faction: FactionId; xp: Record<BuildingId, number>; members: ClanView['members']; limit?: number }
interface TaskSync { done: Record<string, number>; pending: Record<string, number>; subs: MySubmission[] }

function deviceKey() {
  try {
    let k = localStorage.getItem('pbgame.device');
    if (!k) { k = randomSecret(16); localStorage.setItem('pbgame.device', k); }
    return k;
  } catch { return ''; }
}

export class OnlineBackend implements Backend {
  mode = 'online' as const;
  staff = false;
  admin = false;
  private sb: Sb;
  private qCache: Question[] | null = null;
  private meId = '';
  private cfg: GameConfig | null = null;

  constructor(url: string, key: string) { this.sb = new Sb(url, key); }

  private rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}) { return this.sb.rpc<T>(fn, args); }

  private async loadMe(tgName?: string): Promise<LoginResult> {
    const me = await this.rpc<MeRow>('me').catch((e: Error) => ({ error: e.message }) as { error: string });
    if ('error' in me) return { state: null, needLogin: true, error: me.error };
    this.meId = me.id;
    this.staff = me.role === 'staff' || me.role === 'admin';
    this.admin = me.role === 'admin';
    const st = migrate(me.state) ?? newState(me.username);
    st.rating = me.rating;
    st.faction = me.faction;
    st.username = me.username;
    st.fio = me.username;
    st.role = me.role;
    st.secret = me.secret;
    st.clicker.contributed = Math.max(st.clicker.contributed, me.contributed ?? 0);
    await this.syncTasks(st);
    return { state: st, tgName, staff: this.staff, admin: this.admin };
  }

  private async auth(body: Record<string, unknown>): Promise<LoginResult> {
    const r = await this.sb.fn<{ access_token?: string; refresh_token?: string; needFio?: boolean; error?: string }>('auth', body);
    if (r.data.access_token && r.data.refresh_token) {
      this.sb.setSession(r.data.access_token, r.data.refresh_token);
      return this.loadMe();
    }
    if (r.data.needFio) return { state: null, needLogin: true };
    return { state: null, needLogin: true, error: r.data.error || (r.status === 0 ? 'Нет связи с сервером' : 'Не получилось войти') };
  }

  async login(): Promise<LoginResult> {
    const tg = telegram();
    if (tg?.initData) return this.auth({ initData: tg.initData, startParam: tg.initDataUnsafe.start_param ?? '' });
    if (this.sb.session) return this.loadMe();
    return { state: null, needLogin: true };
  }

  async loginFio(p: LoginParams) {
    const tg = telegram();
    return this.auth({ initData: tg?.initData || undefined, fio: p.fio, group: p.group, staffCode: p.staffCode?.trim().toUpperCase() || undefined, deviceKey: deviceKey(), startParam: tg?.initDataUnsafe.start_param ?? '' });
  }

  async loginTester(): Promise<LoginResult> { return { state: null, needLogin: true, error: 'Тестовый вход есть только в демо-сборке' }; }

  async logout() { this.sb.signOut(); }

  /** Задания считает сервер: выполненные и «на проверке» берём оттуда, чтобы после проверки статус обновлялся сам. */
  private lastNoteAt = 0;
  private async syncTasks(s: GameState) {
    const t = await this.rpc<TaskSync>('my_tasks').catch(() => null);
    if (!t) return null;
    s.tasks.done = { ...s.tasks.done, ...t.done };
    s.tasks.pending = t.pending ?? {};
    return t;
  }

  async save(s: GameState) {
    await this.rpc('save_progress', { p_state: s, p_power: squadPower(s).total, p_stage: s.stage }).catch(() => {});
  }

  async config(): Promise<GameConfig> {
    if (this.cfg) return this.cfg;
    const c = await this.rpc<GameConfig>('get_config').catch(() => null);
    this.cfg = c ?? { shopOpen: false, testMode: false, requireGroup: true };
    setTimeout(() => { this.cfg = null; }, 60_000);
    return this.cfg;
  }

  async addGameRating(s: GameState, source: string, value: number) {
    const data = await this.rpc<{ granted: number; rating: number }>('add_game_rating', { p_source: source, p_value: Math.round(value) }).catch(() => null);
    if (!data) return 0;
    rollDay(s);
    s.daily.byGame[source] = (s.daily.byGame[source] ?? 0) + data.granted;
    s.daily.game += data.granted;
    s.rating = data.rating;
    return data.granted;
  }

  async claimTask(s: GameState, task: string, p: TaskPayload = {}): Promise<SubmitResult> {
    try {
      const data = await this.rpc<{ granted: number; rating: number }>('claim_auto_task', { p_task: task, p_value: p.value ?? null, p_text: p.text ?? null, p_quiz: p.quiz ?? null });
      s.rating = data.rating;
      if (data.granted > 0) markDone(s, task);
      return { status: data.granted > 0 ? 'approved' : 'rejected', granted: data.granted, message: data.granted > 0 ? `+${data.granted} баллов` : 'Уже засчитано' };
    } catch (e) { return { status: 'error', message: (e as Error).message }; }
  }

  async submitTask(s: GameState, task: string, p: TaskPayload): Promise<SubmitResult> {
    try {
      let path: string | null = null;
      if (p.photo) {
        path = `${this.meId}/${task}-${Date.now()}.jpg`;
        await this.sb.upload('proofs', path, p.photo, 'image/jpeg').catch((e: Error) => { throw new Error('Фото не загрузилось: ' + e.message); });
      }
      await this.rpc('submit_task', { p_task: task, p_text: [p.link, p.text].filter(Boolean).join('\n') || null, p_photo: path });
      s.tasks.pending[task] = (s.tasks.pending[task] ?? 0) + 1;
      return { status: 'pending', message: 'Отправлено на проверку — придёт уведомление «принято» или «не принято»' };
    } catch (e) { return { status: 'error', message: (e as Error).message }; }
  }

  async redeemCode(s: GameState, code: string): Promise<SubmitResult> {
    try {
      const d = await this.rpc<{ granted: number; rating: number; message: string; lecture?: string }>('redeem_code', { p_code: code.trim() });
      s.rating = d.rating;
      if (d.lecture && !s.lectures.includes(d.lecture)) s.lectures.push(d.lecture);
      return { status: d.granted > 0 ? 'approved' : 'rejected', granted: d.granted, message: d.message };
    } catch (e) { return { status: 'error', message: (e as Error).message }; }
  }

  async mySecret(s: GameState) {
    if (!s.secret) s.secret = await this.rpc<string>('my_secret').catch(() => '');
    return s.secret;
  }

  async quizStart(_s: GameState, task: string) {
    return this.rpc<{ id: string; questions: Question[] }>('quiz_start', { p_task: task });
  }

  async checkSub(s: GameState): Promise<SubmitResult> {
    try {
      const d = await this.sb.fnUser<{ granted?: number; rating?: number; message?: string; error?: string }>('check-sub', {});
      if (d.error) return { status: 'error', message: d.error };
      if (typeof d.rating === 'number') s.rating = d.rating;
      if (d.granted) markDone(s, 'tg_channel');
      return { status: d.granted ? 'approved' : 'rejected', granted: d.granted ?? 0, message: d.message ?? (d.granted ? `+${d.granted} баллов` : 'Подписка не найдена') };
    } catch (e) { return { status: 'error', message: (e as Error).message }; }
  }

  async notes(s: GameState): Promise<Note[]> {
    const list = (await this.rpc<Note[]>('my_notes')) ?? [];
    const newest = list.reduce((a, n) => Math.max(a, n.at), 0);
    if (newest > this.lastNoteAt) {
      if (this.lastNoteAt) { await this.syncTasks(s); const me = await this.rpc<MeRow>('me').catch(() => null); if (me) s.rating = me.rating; }
      this.lastNoteAt = newest;
    }
    return list;
  }
  async notesRead(ids: string[]) { await this.rpc('notes_read', { p_ids: ids.map(Number).filter(Number.isFinite) }).catch(() => {}); }
  async mySubmissions(s: GameState) { return (await this.syncTasks(s))?.subs ?? []; }

  async shareTest(t: SharedTest) {
    return this.rpc<string>('share_test', { p_spec: { name: t.name, ids: t.ids.slice(0, 100), extra: t.extra.slice(0, 50), timer: t.timer, author: t.author ?? null } });
  }
  async loadTest(code: string) { return this.rpc<SharedTest | null>('get_shared_test', { p_code: code.trim().toUpperCase() }).catch(() => null); }
  async suggestQuestion(_s: GameState | null, q: Question) {
    await this.rpc('suggest_question', { p_q: q });
    return 'Вопрос отправлен организаторам. Если его примут — он появится в общем банке.';
  }
  async staffQuestions() { return (await this.rpc<UserQuestion[]>('staff_questions').catch(() => [])) ?? []; }
  async staffQuestionReview(id: string, ok: boolean) { await this.rpc('staff_question_review', { p_id: Number(id), p_ok: ok }); }

  async getQuestions() {
    if (this.qCache) return this.qCache;
    this.qCache = (await this.rpc<Question[]>('get_questions').catch(() => [])) ?? [];
    return this.qCache;
  }
  async prepBank() { return (await this.rpc<Question[]>('prep_bank').catch(() => [])) ?? []; }
  async checkAnswer(q: Question, given: string | number | boolean): Promise<CheckResult> {
    return this.rpc<CheckResult>('check_answer', { p_id: q.id, p_answer: String(given) })
      .catch(() => ({ correct: false, right: '—', explanation: 'Нет связи с сервером' }));
  }
  async reveal(q: Question) {
    return this.rpc<{ right: string; explanation: string }>('reveal_answer', { p_id: q.id }).catch(() => ({ right: '—', explanation: '' }));
  }

  async leaderboard() {
    const d = await this.rpc<{ players: LeaderRow[]; factions: FactionRow[] }>('leaderboard2').catch(() => null);
    return { players: d?.players ?? [], factions: d?.factions ?? [] };
  }

  // ---------- ПБ ----------
  private toClan(c: ClanRow | null): ClanView | null {
    if (!c) return null;
    const xp = { kassa: c.xp?.kassa ?? 0, shtab: c.xp?.shtab ?? 0, media: c.xp?.media ?? 0 };
    return { faction: c.faction, xp, members: c.members ?? [], bonuses: clanBonuses(xp), limit: c.limit ?? CLAN.pbLimit };
  }
  async getClan() { return this.toClan(await this.rpc<ClanRow>('get_clan').catch(() => null)); }
  async contribute(s: GameState, building: BuildingId, xp: number) {
    const d = await this.rpc<{ accepted: number; contributed: number; clan: ClanRow }>('contribute', { p_building: building, p_xp: Math.round(xp) }).catch(() => null);
    if (!d) return { accepted: 0, clan: null };
    s.clicker.contributed = Math.max(d.contributed, s.clicker.contributed - s.clicker.pendingXp);
    return { accepted: d.accepted, clan: this.toClan(d.clan) };
  }

  // ---------- мир ----------
  async getWorld(s: GameState) {
    const w = await this.rpc<WorldState & { my_order?: Order | null; my_order_round?: number }>('get_world').catch(() => null);
    if (!w) return newWorld();
    if (w.my_order !== undefined) { s.war.order = w.my_order ?? null; s.war.orderRound = w.my_order_round ?? 0; }
    return w;
  }
  async setOrder(s: GameState, order: Order | null) {
    await this.rpc('set_order', { p_kind: order?.kind ?? null, p_point: order?.point ?? null, p_power: squadPower(s).raw });
    s.war.order = order;
  }
  async setLaw(s: GameState, share: number) {
    await this.rpc('set_law_share', { p_share: share }).catch(() => {});
    s.war.law = { round: 0, share };
  }
  async submitEventScore(s: GameState, key: string, score: number) {
    s.events.played[key] = Math.max(s.events.played[key] ?? 0, score);
    await this.rpc('submit_event_score', { p_key: key, p_score: Math.round(score) }).catch(() => {});
  }

  // ---------- мерч ----------
  async merchList() { return (await this.rpc<MerchItem[]>('merch_list').catch(() => [])) ?? []; }
  async wallet(s: GameState): Promise<Wallet> {
    return (await this.rpc<Wallet>('my_wallet').catch(() => null)) ?? { earned: s.rating, spent: 0, balance: s.rating };
  }
  async merchBuy(_s: GameState, itemId: string) {
    try {
      const o = await this.rpc<MerchOrder>('merch_buy', { p_item: itemId });
      return { ok: true, message: `${o.itemName} — твоё! Забери у организаторов по личному QR`, order: o };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  }
  async myOrders() { return (await this.rpc<MerchOrder[]>('my_orders').catch(() => [])) ?? []; }

  async lecturesOpen() { return (await this.rpc<LectureSession[]>('lectures_open').catch(() => [])) ?? []; }

  async liveFeed() {
    const [db, repo] = await Promise.all([this.rpc<Announcement[]>('live_feed').catch(() => []), fetchLiveJson()]);
    return [...(db ?? []), ...repo].sort((a, b) => b.at - a.at);
  }

  // ---------- организатор ----------
  private subTasks = new Map<string, string>();
  async staffSubmissions() {
    const rows = (await this.rpc<Submission[]>('staff_submissions').catch(() => [])) ?? [];
    rows.forEach((r) => this.subTasks.set(r.id, r.task));
    for (const r of rows) if (r.photo) r.photo = await this.sb.signedUrl('proofs', r.photo).catch(() => '');
    return rows;
  }
  async staffReview(id: string, ok: boolean, rating: number, note?: string) {
    const title = taskById(this.subTasks.get(id) ?? '')?.title ?? null;
    await this.rpc('staff_review', { p_id: Number(id), p_ok: ok, p_rating: rating, p_note: note ?? null, p_title: title });
    // Telegram-уведомление от бота — не критично, если не дошло (в игре оно уже есть)
    this.sb.fnUser('notify', { submission: Number(id) }).catch(() => {});
  }
  async staffFindPlayers(q: string) { return (await this.rpc<PlayerRef[]>('staff_find_players', { p_q: q }).catch(() => [])) ?? []; }
  async staffGrant(playerId: string, task: string, amount: number, note?: string) {
    await this.rpc('staff_grant', { p_player: playerId, p_amount: amount, p_task: task, p_note: note ?? null });
    return `Начислено ${amount} баллов`;
  }
  async staffForceRound() { await this.rpc('staff_force_round'); }
  async staffStartEvent(id: string) { await this.rpc('staff_start_event', { p_id: id }); }
  async staffMerchSave(item: Partial<MerchItem> & { name: string }) { await this.rpc('staff_merch_save', { p_item: item }); }
  async staffMerchImport(text: string) {
    const rows = parseMerchLines(text);
    if (!rows.length) return 'Не нашли строк вида «Название; количество; цена»';
    const n = await this.rpc<number>('staff_merch_import', { p_rows: rows });
    return `Загружено позиций: ${n}`;
  }
  async staffMerchDelete(id: string) { await this.rpc('staff_merch_save', { p_item: { id, active: false } }); }
  async staffOrders() { return (await this.rpc<MerchOrder[]>('staff_orders').catch(() => [])) ?? []; }
  async staffOrderSet(id: string, status: 'issued' | 'cancelled') { await this.rpc('staff_order_set', { p_id: id, p_status: status }); }
  async staffOrdersByCode(code: string) {
    return this.rpc<{ player: string; orders: MerchOrder[] }>('staff_orders_by_code', { p_code: code.trim() }).catch((e: Error) => ({ error: e.message }));
  }
  async staffLectureOpen(p: QrSessionInput) {
    return this.rpc<LectureSession>('staff_lecture_open', { p_title: p.title, p_points: p.points, p_minutes: p.minutes, p_kind: p.kind, p_max: p.maxClaims, p_rotating: p.rotating });
  }
  async staffLectures() { return (await this.rpc<LectureSession[]>('staff_lectures').catch(() => [])) ?? []; }
  async staffLectureClose(id: string) { await this.rpc('staff_lecture_close', { p_id: id }); }
  async staffAnnounce(a: { text: string; kind: Announcement['kind']; minutes: number | null }) {
    await this.rpc('staff_announce', { p_text: a.text, p_kind: a.kind, p_minutes: a.minutes });
  }
  async staffAnnounceDelete(id: string) { await this.rpc('staff_announce_delete', { p_id: id }); }
  async staffRoster() { return (await this.rpc<RosterRow[]>('staff_roster').catch(() => [])) ?? []; }
  async staffRosterImport(text: string) {
    const rows = parseRosterLines(text);
    if (!rows.length) return 'Не нашли строк. Формат: Институт; ФИО; Группа; (Должность); (Роль)';
    return this.rpc<string>('staff_roster_import', { p_rows: rows });
  }
  async staffRosterReset(id: string) { return this.rpc<string>('staff_roster_reset', { p_id: id }); }
  async staffSetSetting(key: 'shop_open' | 'require_group', value: boolean) { await this.rpc('staff_set_setting', { p_key: key, p_value: value }); this.cfg = null; }
}
