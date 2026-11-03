// Общая карта: Лефортово и кампус МЭИ. Адреса — со страницы «Схема корпусов» mpei.ru.
// geo — [широта, долгота] для Яндекс Карт (примерные: организатор уточняет перетаскиванием в режиме разметки),
// xy — координаты на нарисованной схеме (мир 1000×1300).
import type { FactionId } from './factions';
import type { GameId } from './minigames';

export interface MapPoint {
  id: string;
  name: string;
  short: string;
  address: string;
  geo: [number, number];
  xy: [number, number];
  /** спорная точка — её захватывают в стычках */
  contested: boolean;
  /** влияния в час владельцу */
  influence: number;
  icon: 'dorm' | 'food' | 'sport' | 'stadium' | 'culture' | 'book' | 'main' | 'lab' | 'park' | 'metro' | 'power';
}

export const MAP_POINTS: MapPoint[] = [
  { id: 'main', name: 'Главный учебный корпус (А–Д)', short: 'Главный корпус', address: 'Красноказарменная ул., 17', geo: [55.75472, 37.70806], xy: [710, 735], contested: true, influence: 14, icon: 'main' },
  { id: 'admin', name: 'Административный корпус (Ж–Л)', short: 'Корпус Ж–Л', address: 'Красноказарменная ул., 14', geo: [55.7538, 37.7072], xy: [690, 905], contested: true, influence: 10, icon: 'lab' },
  { id: 'bastille', name: 'Корпус Е «Бастилия»', short: 'Корпус Е', address: 'Красноказарменная ул., 13, стр. 1', geo: [55.7561, 37.7038], xy: [470, 690], contested: true, influence: 10, icon: 'lab' },
  { id: 'library', name: 'Научно-техническая библиотека (корпус М)', short: 'Библиотека', address: 'Красноказарменная ул., 13', geo: [55.7556, 37.7049], xy: [545, 705], contested: true, influence: 10, icon: 'book' },
  { id: 'dk', name: 'Дом культуры МЭИ', short: 'ДК МЭИ', address: 'Энергетический пр., 3, стр. 1', geo: [55.7574, 37.7059], xy: [665, 600], contested: true, influence: 12, icon: 'culture' },
  { id: 'steklyashka', name: 'Столовая № 10 «Стекляшка»', short: 'Стекляшка', address: 'Красноказарменная ул., 17Б', geo: [55.7559, 37.7097], xy: [810, 640], contested: true, influence: 12, icon: 'food' },
  { id: 'tec', name: 'Учебная ТЭЦ МЭИ и корпус Т', short: 'ТЭЦ МЭИ', address: 'Красноказарменная ул., 17, стр. 4–5', geo: [55.7566, 37.7118], xy: [930, 740], contested: true, influence: 10, icon: 'power' },
  { id: 'dorms', name: 'Студгородок МЭИ (общежития)', short: 'Студгородок', address: 'Энергетическая ул., 6–18', geo: [55.7598, 37.7112], xy: [880, 355], contested: true, influence: 14, icon: 'dorm' },
  { id: 'stadium', name: 'Стадион «Энергия»', short: 'Стадион «Энергия»', address: '2-й Краснокурсантский пр., 12', geo: [55.7591, 37.6995], xy: [325, 590], contested: true, influence: 12, icon: 'stadium' },
  { id: 'park', name: 'Лефортовский парк', short: 'Лефортовский парк', address: 'Красноказарменная ул., 1', geo: [55.7650, 37.6925], xy: [270, 250], contested: true, influence: 10, icon: 'park' },
  // ориентиры (не захватываются)
  { id: 'metro_aviamotornaya', name: 'Метро «Авиамоторная»', short: 'Авиамоторная', address: 'Авиамоторная ул.', geo: [55.7519, 37.7171], xy: [945, 1170], contested: false, influence: 0, icon: 'metro' },
  { id: 'metro_lefortovo', name: 'Метро «Лефортово» (БКЛ)', short: 'Лефортово', address: 'угол Солдатской и Наличной ул.', geo: [55.7646, 37.7062], xy: [640, 418], contested: false, influence: 0, icon: 'metro' },
];

export const CONTESTED = MAP_POINTS.filter((p) => p.contested);

/** Ратуши ПБ — вокруг главного корпуса (игровая условность, не реальные здания институтов). */
export const RATUSHA_SPOTS: Record<Exclude<FactionId, 'profkom'>, { xy: [number, number]; geo: [number, number] }> = {
  inei: { xy: [500, 540], geo: [55.7588, 37.7025] },
  ire: { xy: [760, 520], geo: [55.7584, 37.7048] },
  gpi: { xy: [560, 600], geo: [55.7581, 37.7075] },
  igvie: { xy: [960, 560], geo: [55.7579, 37.7138] },
  ievt: { xy: [870, 980], geo: [55.7546, 37.7146] },
  iete: { xy: [520, 960], geo: [55.7530, 37.7108] },
  enmi: { xy: [380, 1000], geo: [55.7528, 37.7042] },
  itae: { xy: [700, 1060], geo: [55.7545, 37.7005] },
  ivti: { xy: [240, 820], geo: [55.7560, 37.6980] },
  iee: { xy: [400, 760], geo: [55.7548, 37.7120] },
};

export const MAP_CENTER: [number, number] = [55.7565, 37.7065];
export const MAP_BOUNDS: [[number, number], [number, number]] = [[55.7470, 37.6850], [55.7680, 37.7230]];

// ---------- Внешние мероприятия ----------
export interface MapEvent { id: string; name: string; game: GameId; trophy: string; xy: [number, number]; geo: [number, number] }
export const MAP_EVENTS: MapEvent[] = [
  { id: 'stipkom', name: 'Школа «Стипком»', game: 'ring', trophy: 'Кодекс', xy: [140, 1120], geo: [55.7505, 37.6900] },
  { id: 'sparta', name: 'Спартакиада', game: 'runner', trophy: 'Кубок', xy: [150, 160], geo: [55.7668, 37.6880] },
  { id: 'priem', name: 'Приёмная комиссия', game: 'stamp', trophy: 'Золотая печать', xy: [940, 160], geo: [55.7665, 37.7190] },
  { id: 'region', name: 'Выезд в регион', game: 'bus', trophy: 'Вымпел', xy: [760, 1240], geo: [55.7495, 37.7120] },
  { id: 'forum', name: 'Форум студлидеров', game: 'blocks', trophy: 'Бейдж спикера', xy: [380, 1220], geo: [55.7500, 37.6980] },
  { id: 'granty', name: 'Ярмарка грантов', game: 'merge', trophy: 'Сундук', xy: [960, 1000], geo: [55.7535, 37.7205] },
  { id: 'olymp', name: 'Профсоюзная олимпиада', game: 'crossword', trophy: 'Лавровый венок', xy: [80, 600], geo: [55.7600, 37.6870] },
];

/** Сколько длится мероприятие и сколько активистов нужно отправить. */
export const EVENT_MINUTES = 60;
export const EVENT_SQUAD = 5;
