// Хранилище и сервер. Без ключей Supabase игра работает в демо-режиме (всё в браузере, соперники — боты).
import type { FactionId } from '../config/factions';
import type { BuildingId, ClanBonuses } from '../config/clan';
import type { MerchItem, MerchOrder } from '../config/merch';
import { TEST_MODE } from '../config/test';
import type { CheckResult, Question } from './questions';
import type { GameState, Role } from './state';
import type { Order, WorldState } from './world';
import type { VoteAction, VoteState } from './vote';
import type { RaidHit, RaidState } from './raid';
import type { CasinoStats } from './casino';
import type { Duel, DuelAnswer, DuelList } from './duel';

export interface LeaderRow { name: string; faction: FactionId | null; rating: number; contributed: number; power: number; me?: boolean; bot?: boolean }
export interface FactionRow { faction: FactionId; players: number; limit: number; rating: number; influence: number; xp: number; ratusha: number; score: number }
export interface LoginParams { fio: string; group: string; staffCode?: string }
export interface LoginResult { state: GameState | null; tgName?: string; needLogin?: boolean; error?: string; staff?: boolean; admin?: boolean }
export interface Submission { id: string; player: string; playerId?: string; faction: FactionId | null; task: string; text?: string; photo?: string; at: number; status: 'pending' | 'approved' | 'rejected'; rating?: number; note?: string; /** кто из организаторов взял сдачу в работу (на 10 минут) */ claimedBy?: string | null; claimedMine?: boolean }
/** Зона дежурства организатора: чтобы не делать одно и то же вдвоём. */
export type DutyZone = 'mod' | 'qr' | 'merch' | 'live' | 'map' | 'help' | 'free';
export interface TeamMember { id: string; name: string; role: Role; me: boolean; zone: DutyZone; note: string; at: number; reviewed: number; holding: number; qrOpen: number }
/** Кодовое слово (пасхалка) в панели организатора. Слова из списка организаторов в базе только отпечатками — у них hidden и подпись вместо текста. */
export interface CodeWord { id: string; text: string; hidden: boolean; points: number; gold: boolean; max: number | null; expires: number | null; active: boolean; found: number; by: string | null; created: number }
export interface SubmitResult { status: 'approved' | 'pending' | 'rejected' | 'error'; granted?: number; message: string }
export interface PlayerRef { id: string; name: string; faction: FactionId | null; rating: number }
export interface TaskPayload { text?: string; link?: string; photo?: Blob; value?: number; quiz?: string }
export interface Note { id: string; text: string; kind: 'ok' | 'bad' | 'info'; at: number; read?: boolean }
export interface MySubmission { id: string; task: string; at: number; status: 'pending' | 'approved' | 'rejected'; rating?: number; note?: string }
export interface UserQuestion extends Question { status?: 'pending' | 'approved' | 'rejected'; author?: string; at?: number }
export interface SharedTest { code?: string; name: string; ids: string[]; extra: Question[]; timer: number; author?: string; created: number }
export type QrKind = 'lecture' | 'speed' | 'activity';
export interface QrSessionInput { title: string; points: number; minutes: number; kind: QrKind; maxClaims: number; rotating: boolean }

export interface ClanMember { name: string; rating: number; contributed: number; me?: boolean; bot?: boolean }
export interface ClanView { faction: FactionId; xp: Record<BuildingId, number>; members: ClanMember[]; bonuses: ClanBonuses; limit: number }
export interface LectureSession {
  id: string; title: string; points: number; openedAt: number; closesAt: number; claims: number; secret?: string; mine?: boolean;
  kind: QrKind; maxClaims: number; rotating: boolean;
  /** Статичный код (для печати) — только у организатора */
  code?: string;
  /** Кто открыл (видят организаторы) и признак «такая уже была открыта — показана она» */
  openedByName?: string; existing?: boolean;
}
export interface Announcement { id: string; text: string; kind: 'info' | 'alert' | 'win'; at: number; until?: number | null; author?: string; source?: 'staff' | 'claude' }
export interface RosterRow { id: string; fio: string; faction: FactionId; group: string; role: Role; bound: boolean; tg?: boolean }
/** Баллы на мерч: заработано (рейтинг) − потрачено (заказы и проигрыш в колесе). casino — сколько из потраченного ушло в колесо. */
export interface Wallet { earned: number; spent: number; balance: number; casino?: number }
export interface GameConfig {
  shopOpen: boolean; testMode: boolean; requireGroup: boolean;
  /** Кто отмечает на блоках и начисляет баллы (null — все организаторы) */
  checkinHost?: { id: number | string; name: string } | null;
  /** Могу ли я открывать отметки на блоках и начислять баллы */
  canCheckin?: boolean;
  /** Организаторы раскрыли, как подкручено колесо профкома */
  casinoReveal?: boolean;
}

export interface Backend {
  mode: 'demo' | 'online';
  staff: boolean;
  admin: boolean;
  /** Продолжить сессию (Telegram или сохранённый вход). needLogin — нужен ввод ФИО. */
  login(): Promise<LoginResult>;
  /** Вход по ФИО (и группе) из списка выезда. ПБ подставляется сам. */
  loginFio(p: LoginParams): Promise<LoginResult>;
  /** Только тест-режим: войти тестером за любое ПБ. */
  loginTester(faction: FactionId, name: string): Promise<LoginResult>;
  logout(): Promise<void>;
  save(s: GameState): Promise<void>;
  config(): Promise<GameConfig>;
  /** value — сколько рейтинга стоит результат (0..30 для мини-игры). Возвращает начисленное. */
  claimTask(s: GameState, task: string, payload?: TaskPayload): Promise<SubmitResult>;
  submitTask(s: GameState, task: string, payload: TaskPayload): Promise<SubmitResult>;
  /** Кодовое слово, тайник, код лекции, личный QR знакомого. */
  redeemCode(s: GameState, code: string): Promise<SubmitResult>;
  /** Секрет личного обновляемого QR. */
  mySecret(s: GameState): Promise<string>;
  getQuestions(): Promise<Question[]>;
  /** Квиз задания: сервер выбирает вопросы и потом сам считает верные ответы. */
  quizStart(s: GameState, task: string): Promise<{ id: string; questions: Question[] }>;
  /** Подписка на канал: проверяет бот (только из Telegram). */
  checkSub(s: GameState): Promise<SubmitResult>;
  /** Уведомления: «принято / не принято», начисления. */
  notes(s: GameState): Promise<Note[]>;
  notesRead(ids: string[]): Promise<void>;
  mySubmissions(s: GameState): Promise<MySubmission[]>;
  // ---- подготовка: свои вопросы и тесты ----
  shareTest(t: SharedTest): Promise<string>;
  loadTest(code: string): Promise<SharedTest | null>;
  suggestQuestion(s: GameState | null, q: Question): Promise<string>;
  /** Банк для «Подготовки» — с ответами и пояснениями, доступен без входа. */
  prepBank(): Promise<Question[]>;
  checkAnswer(q: Question, given: string | number | boolean): Promise<CheckResult>;
  reveal(q: Question): Promise<{ right: string; explanation: string }>;
  leaderboard(s: GameState | null): Promise<{ players: LeaderRow[]; factions: FactionRow[] }>;
  // ---- ПБ как клан ----
  getClan(s: GameState): Promise<ClanView | null>;
  /** Отправить накопленный опыт зданию. Возвращает, сколько принято (сервер режет накрутку). */
  contribute(s: GameState, building: BuildingId, xp: number): Promise<{ accepted: number; clan: ClanView | null }>;
  // ---- мир ----
  getWorld(s: GameState): Promise<WorldState>;
  setOrder(s: GameState, order: Order | null): Promise<void>;
  setLaw(s: GameState, share: number): Promise<void>;
  submitEventScore(s: GameState, key: string, score: number): Promise<void>;
  // ---- мерч ----
  merchList(): Promise<MerchItem[]>;
  wallet(s: GameState): Promise<Wallet>;
  merchBuy(s: GameState, itemId: string): Promise<{ ok: boolean; message: string; order?: MerchOrder }>;
  myOrders(s: GameState): Promise<MerchOrder[]>;
  // ---- лекции ----
  lecturesOpen(): Promise<LectureSession[]>;
  // ---- эфир ----
  liveFeed(): Promise<Announcement[]>;
  // ---- организатор ----
  staffSubmissions(): Promise<Submission[]>;
  /** Взять в работу до n свободных сдач; ответ — сколько теперь у меня. */
  staffClaim(n: number): Promise<number>;
  staffRelease(): Promise<void>;
  staffTeam(): Promise<TeamMember[]>;
  staffSetDuty(zone: DutyZone, note: string): Promise<void>;
  staffReview(id: string, ok: boolean, rating: number, note?: string): Promise<void>;
  staffQuestions(): Promise<UserQuestion[]>;
  staffQuestionReview(id: string, ok: boolean): Promise<void>;
  staffFindPlayers(q: string): Promise<PlayerRef[]>;
  staffGrant(playerId: string, task: string, amount: number, note?: string): Promise<string>;
  staffForceRound(): Promise<void>;
  staffStartEvent(id: string): Promise<void>;
  staffMerchSave(item: Partial<MerchItem> & { name: string }): Promise<void>;
  staffMerchImport(text: string): Promise<string>;
  staffMerchDelete(id: string): Promise<void>;
  staffOrders(): Promise<MerchOrder[]>;
  staffOrderSet(id: string, status: 'issued' | 'cancelled'): Promise<void>;
  /** Заказы участника по его личному QR — для выдачи призов. */
  staffOrdersByCode(code: string): Promise<{ player: string; orders: MerchOrder[] } | { error: string }>;
  staffLectureOpen(p: QrSessionInput): Promise<LectureSession>;
  staffLectures(): Promise<LectureSession[]>;
  staffLectureClose(id: string): Promise<void>;
  staffAnnounce(a: { text: string; kind: Announcement['kind']; minutes: number | null }): Promise<void>;
  staffAnnounceDelete(id: string): Promise<void>;
  staffRoster(): Promise<RosterRow[]>;
  staffRosterImport(text: string): Promise<string>;
  staffRosterReset(id: string): Promise<string>;
  staffSetSetting(key: 'shop_open' | 'require_group' | 'casino_reveal', value: boolean): Promise<void>;
  /** Общий итог колеса профкома (после разоблачения — всем, до него — организаторам). */
  casinoStats(): Promise<CasinoStats | null>;
  /** Ставка баллами на мерч: всегда ×0, баллы уходят со счёта магазина (рейтинг не меняется). */
  casinoPointsBet(amount: number): Promise<Wallet & { mult: 0; lost: number }>;
  /** Админ: кто отмечает (id строки списка выезда) или null — все организаторы. */
  staffSetCheckinHost(rosterId: string | null): Promise<GameConfig>;
  /** Только админ: обнулить прогресс всех (подтверждение — слово «СБРОС»). */
  adminResetProgress(confirm: string): Promise<string>;
  // ---- голосование «Работа со спонсорами» ----
  voteState(): Promise<VoteState | null>;
  voteCast(team: string, v: 1 | -1 | 0): Promise<VoteState>;
  staffVoteSetup(title: string, teams: { id: string; name: string; faction: FactionId | null }[]): Promise<VoteState>;
  staffVoteControl(action: VoteAction, team?: string | null): Promise<VoteState>;
  /** Вписать человека (себя или товарища) по ФИО в команду. Группа — только если тёзки. */
  voteJoin(fio: string, team: string, group?: string): Promise<VoteState & { joined?: string }>;
  /** Составы команд с именами (только организаторам). */
  staffVoteMembers(): Promise<{ team: string; name: string; people: { id: string | number; name: string }[] }[]>;
  /** Организатор: убрать человека из команды. */
  staffVoteKick(rosterId: string | number): Promise<VoteState>;
  /** Кодовые слова: список, добавить в моменте (баллы, первым N, на M минут, золотая), включить/выключить, удалить */
  staffWords(): Promise<CodeWord[]>;
  staffWordAdd(word: string, points: number, max: number | null, minutes: number | null, gold: boolean): Promise<CodeWord[]>;
  staffWordSet(id: string, active: boolean): Promise<CodeWord[]>;
  staffWordDelete(id: string): Promise<CodeWord[]>;
  // ---- поединки в правовухе ----
  duelCreate(): Promise<Duel>;
  duelJoin(code: string): Promise<Duel>;
  duelStart(id: string): Promise<Duel>;
  duelAnswer(id: string, q: Question, given: string | number | boolean): Promise<DuelAnswer>;
  duelState(id: string): Promise<Duel>;
  duelList(): Promise<DuelList>;
  // ---- захват профкома ----
  raidState(): Promise<RaidState | null>;
  raidHit(dmg: number): Promise<RaidHit>;
  staffRaidSet(hp: number): Promise<RaidState>;
  staffRaidReset(): Promise<RaidState>;
}

export { grantGameCoins, taskAvailable, markDone } from './rules';

import { DemoBackend } from './backend-demo';
import { OnlineBackend } from './backend-online';

export function createBackend(): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && key ? new OnlineBackend(url, key) : new DemoBackend();
}

export { TEST_MODE };
