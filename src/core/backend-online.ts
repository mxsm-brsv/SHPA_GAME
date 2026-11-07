// Онлайн-режим: Supabase (база + функции). Все начисления и проверки — на сервере.
import { CLAN, clanBonuses, type BuildingId } from '../config/clan';
import type { FactionId } from '../config/factions';
import type { MerchItem, MerchOrder } from '../config/merch';
import { Sb } from '../lib/sb';
import { randomSecret } from './codes';
import type { CheckResult, Question } from './questions';
import { markDone } from './rules';
import { taskById } from '../config/tasks';
import { migrate, newState, type GameState, type Role } from './state';
import { squadPower } from './logic';
import { telegram } from './telegram';
import { newWorld, payWarCoins, type Order, type WorldState } from './world';
import type { VoteAction, VoteState } from './vote';
import type { RaidHit, RaidState } from './raid';
import type { CasinoStats } from './casino';
import type { Duel, DuelAnswer, DuelList } from './duel';
import { SKIRMISH_WIN_COINS } from '../config/economy';
import { fetchLiveJson, parseMerchLines, parseRosterLines } from './backend-demo';
import type { CasinoMode, CodeWord, Goal, ScanRow,
  Announcement, Backend, ClanView, FactionRow, GameConfig, LeaderRow, LectureSession, LoginParams, LoginResult,
  MySubmission, Note, PlayerRef, QrSessionInput, RosterRow, SharedTest, Submission, SubmitResult, TaskPayload, UserQuestion, Wallet,
  DutyZone, TeamMember,
} from './backend';

interface MeRow { id: string; username: string; faction: FactionId | null; rating: number; state: unknown; role: Role; secret: string; contributed: number; epoch?: number }
interface ClanRow { faction: FactionId; xp: Record<BuildingId, number>; members: ClanView['members']; limit?: number }
interface TaskSync { done: Record<string, number>; pending: Record<string, number>; subs: MySubmission[] }

/** Код организатора: регистр, лишние пробелы и «ё» не важны («секретный  код» = «СЕКРЕТНЫЙ КОД»). */
const normStaffCode = (c: string) => c.trim().replace(/\s+/g, ' ').toUpperCase().replace(/Ё/g, 'Е');

/** После общего сброса прогресса на сервере: забыть пройденное обучение и прогресс подготовки на этом устройстве. */
const LS_EPOCH = 'shpa.epoch';
const LOCAL_PROGRESS = ['shpa.tour.player.v2', 'shpa.tour.staff.v2', 'shpa.tour.org.v2', 'pbgame.prep'];
function syncEpoch(epoch: number) {
  try {
    const was = localStorage.getItem(LS_EPOCH);
    if (was !== null && Number(was) !== epoch) LOCAL_PROGRESS.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(LS_EPOCH, String(epoch));
  } catch { /* приватный режим */ }
}

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
  private epoch = 0;
  /** После общего сброса до перезагрузки не сохраняем старое состояние из памяти. */
  private frozen = false;

  constructor(url: string, key: string) { this.sb = new Sb(url, key); }

  private rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}) { return this.sb.rpc<T>(fn, args); }
  /** Сервер перегружен — фоновые опросы ждут. */
  get cooling() { return this.sb.cooling; }

  private async loadMe(tgName?: string): Promise<LoginResult> {
    const me = await this.rpc<MeRow>('me').catch((e: Error) => ({ error: e.message }) as { error: string });
    if ('error' in me) return { state: null, needLogin: true, error: me.error };
    this.meId = me.id;
    this.epoch = Number(me.epoch ?? 0);
    syncEpoch(this.epoch);
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
    return this.auth({ initData: tg?.initData || undefined, fio: p.fio, group: p.group, staffCode: p.staffCode ? normStaffCode(p.staffCode) || undefined : undefined, deviceKey: deviceKey(), startParam: tg?.initDataUnsafe.start_param ?? '' });
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
    if (this.frozen) return;
    await this.rpc('save_progress', { p_state: s, p_power: squadPower(s).total, p_stage: s.stage, p_epoch: this.epoch }).catch((e: Error) => {
      // организаторы обнулили прогресс, пока игра была открыта: не перезаписывать, а начать заново
      if (!/progress_reset/.test(e.message)) return;
      try {
        const last = Number(sessionStorage.getItem('shpa.reload') ?? 0);
        if (Date.now() - last < 60_000) return;
        sessionStorage.setItem('shpa.reload', String(Date.now()));
      } catch { /* приватный режим */ }
      location.reload();
    });
  }

  async config(): Promise<GameConfig> {
    if (this.cfg) return this.cfg;
    const c = await this.rpc<GameConfig>('get_config').catch(() => null);
    this.cfg = c ?? { shopOpen: false, testMode: false, requireGroup: true };
    setTimeout(() => { this.cfg = null; }, 60_000);
    return this.cfg;
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

  async gameMode() { return (await this.rpc<{ lite: boolean; until: number | null; casino?: CasinoMode }>('game_mode').catch(() => null)) ?? { lite: false, until: null }; }
  async staffSetCasino(mode: CasinoMode) { return this.rpc<CasinoMode>('staff_set_casino', { p_mode: mode }); }
  async staffSetLite(minutes: number) { return this.rpc<{ lite: boolean; until: number | null }>('staff_set_lite', { p_minutes: minutes }); }
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
    payWarCoins(s, w, SKIRMISH_WIN_COINS);
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

  // ---------- поединки в правовухе ----------
  async duelCreate() { return this.rpc<Duel>('law_duel_create'); }
  async duelJoin(code: string) { return this.rpc<Duel>('law_duel_join', { p_code: code }); }
  async duelStart(id: string) { return this.rpc<Duel>('law_duel_start', { p_id: id }); }
  async duelAnswer(id: string, q: Question, given: string | number | boolean) {
    return this.rpc<DuelAnswer>('law_duel_answer', { p_id: id, p_qid: q.id, p_answer: String(given) });
  }
  async duelState(id: string) { return this.rpc<Duel>('law_duel_state', { p_id: id }); }
  async duelList() { return this.rpc<DuelList>('law_duel_list'); }

  // ---------- захват профкома ----------
  async raidState() { return await this.rpc<RaidState>('raid_state').catch(() => null); }
  async raidHit(dmg: number) { return this.rpc<RaidHit>('raid_hit', { p_dmg: Math.round(dmg) }); }
  async staffRaidSet(hp: number) { return this.rpc<RaidState>('staff_raid_set', { p_hp: Math.round(hp) }); }
  async staffRaidReset() { return this.rpc<RaidState>('staff_raid_reset'); }

  // ---------- голосование ----------
  async voteState() { return await this.rpc<VoteState>('vote_state').catch(() => null); }
  async voteCast(team: string, v: 1 | -1 | 0) { return this.rpc<VoteState>('vote_cast', { p_team: team, p_v: v }); }
  async staffVoteSetup(title: string, teams: { id: string; name: string; faction: FactionId | null }[]) { return this.rpc<VoteState>('staff_vote_setup', { p_title: title, p_teams: teams }); }
  async staffVoteControl(action: VoteAction, team: string | null = null) { return this.rpc<VoteState>('staff_vote_control', { p_action: action, p_team: team }); }
  async voteJoin(fio: string, team: string, group?: string) { return this.rpc<VoteState & { joined?: string }>('vote_join', { p_fio: fio, p_team: team, p_group: group || null }); }
  async staffVoteMembers() { return this.rpc<{ team: string; name: string; people: { id: string | number; name: string }[] }[]>('staff_vote_members'); }
  async staffVoteKick(rosterId: string | number) { return this.rpc<VoteState>('staff_vote_kick', { p_roster: Number(rosterId) }); }
  async staffWords() { return this.rpc<CodeWord[]>('staff_words'); }
  async staffScanLog(kind?: string) { return (await this.rpc<ScanRow[] | null>('staff_scan_log', { p_kind: kind || null, p_limit: 800 })) ?? []; }
  async staffWordAdd(word: string, points: number, max: number | null, minutes: number | null, gold: boolean) {
    return this.rpc<CodeWord[]>('staff_word_add', { p_word: word, p_points: points, p_max: max, p_minutes: minutes, p_gold: gold });
  }
  async staffWordSet(id: string, active: boolean) { return this.rpc<CodeWord[]>('staff_word_set', { p_id: id, p_active: active }); }
  async staffWordDelete(id: string) { return this.rpc<CodeWord[]>('staff_word_delete', { p_id: id }); }

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
  async staffClaim(n: number) { return (await this.rpc<number>('staff_claim', { p_n: n })) ?? 0; }
  async staffRelease() { await this.rpc('staff_release'); }
  async staffTeam() { return (await this.rpc<TeamMember[]>('staff_team').catch(() => [])) ?? []; }
  async staffSetDuty(zone: DutyZone, note: string) { await this.rpc('staff_set_duty', { p_zone: zone, p_note: note }); }
  async staffFindPlayers(q: string) { return (await this.rpc<PlayerRef[]>('staff_find_players', { p_q: q }).catch(() => [])) ?? []; }
  async staffGrantPb(factions: string[], amount: number, task: string, note?: string) {
    return this.rpc<{ players: number; skipped: number; granted: number }>('staff_grant_pb', { p_factions: factions, p_amount: amount, p_task: task, p_note: note ?? null });
  }
  async staffGrant(playerId: string, task: string, amount: number, note?: string) {
    const r = await this.rpc<{ granted: number; rating?: number }>('staff_grant', { p_player: playerId, p_amount: amount, p_task: task, p_note: note || null });
    const g = r?.granted ?? amount;
    return g < 0 ? `Снято ${-g} баллов${typeof r?.rating === 'number' ? ` · теперь ${r.rating}` : ''}` : `Начислено ${g} баллов`;
  }
  async staffForceRound() { await this.rpc('staff_force_round'); }
  async staffStartEvent(id: string) { await this.rpc('staff_start_event', { p_id: id }); }
  async staffMerchSave(item: Partial<MerchItem> & { name: string }) { await this.rpc('staff_merch_save', { p_item: item }); }
  async staffMerchPriceAll(pct: number) { return this.rpc<number>('staff_merch_price_all', { p_pct: pct }); }
  async staffOrdersCancelPending() { return this.rpc<{ orders: number; points: number }>('staff_orders_cancel_pending'); }
  async goalsList() { return (await this.rpc<Goal[] | null>('goals_list')) ?? []; }
  async goalDonate(id: number, amount: number) { return this.rpc<Goal & { given: number; wallet: Wallet }>('goal_donate', { p_goal: id, p_amount: amount }); }
  async staffGoalSave(g: Partial<Goal> & { id?: number }) { return this.rpc<number>('staff_goal_save', { p: g }); }
  async staffMerchAll() { return (await this.rpc<MerchItem[] | null>('staff_merch_all').catch(() => null)) ?? (await this.merchList()); }
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
    const id = await this.rpc<number | null>('staff_announce', { p_text: a.text, p_kind: a.kind, p_minutes: a.minutes });
    if (!id) return {};
    const r = await this.sb.fnUser<{ sent?: number; total?: number }>('notify', { announce: Number(id) }).catch(() => null);
    return { bot: r?.sent, total: r?.total };
  }
  async staffAnnounceDelete(id: string) { await this.rpc('staff_announce_delete', { p_id: id }); }
  async staffRoster() { return (await this.rpc<RosterRow[]>('staff_roster').catch(() => [])) ?? []; }
  async staffRosterImport(text: string) {
    const rows = parseRosterLines(text);
    if (!rows.length) return 'Не нашли строк. Формат: Институт; ФИО; Группа; (Должность); (Роль)';
    return this.rpc<string>('staff_roster_import', { p_rows: rows });
  }
  async staffRosterReset(id: string) { return this.rpc<string>('staff_roster_reset', { p_id: id }); }
  async staffRosterRemove(id: string) { return this.rpc<string>('staff_roster_remove', { p_id: id }); }
  async staffSetSetting(key: 'shop_open' | 'require_group' | 'casino_reveal', value: boolean) { await this.rpc('staff_set_setting', { p_key: key, p_value: value }); this.cfg = null; }
  async casinoStats() { return await this.rpc<CasinoStats>('casino_stats'); }
  async casinoPointsBet(amount: number) { return await this.rpc<Wallet & { mult: 0 | 2; lost: number }>('casino_points_bet', { p_amount: amount }); }
  async staffSetCheckinHost(rosterId: string | null) { this.cfg = await this.rpc<GameConfig>('staff_set_checkin_host', { p_roster: rosterId === null ? null : Number(rosterId) }); return this.cfg; }
  async adminResetProgress(confirm: string) {
    const r = await this.rpc<{ players: number; submissions: number; orders: number; qr: number; epoch: number; registrations?: number }>('admin_reset_progress', { p_confirm: confirm });
    this.frozen = true;
    syncEpoch(r.epoch);
    return `Сброшено всё: игроков ${r.players}, регистраций ${r.registrations ?? 0}, сдач ${r.submissions}, заказов мерча ${r.orders} (возвращены на склад), QR-отметок ${r.qr}. Входи заново по ФИО и коду организатора.`;
  }
}
