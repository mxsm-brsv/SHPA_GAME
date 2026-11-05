// Общая карта: Лефортово и кампус МЭИ. Адреса — со страницы «Схема корпусов» mpei.ru, план — по OpenStreetMap.
// xy — координаты на схеме в метрах (север сверху, мир CAMPUS.W × CAMPUS.H), geo — те же точки в широте и долготе
// для Яндекс Карт (организатор может уточнить перетаскиванием в режиме разметки).
import type { FactionId } from './factions';
import type { GameId } from './minigames';
import { toGeo } from '../map/campusData';

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

const P = (id: string, name: string, short: string, address: string, xy: [number, number], icon: MapPoint['icon'], influence: number): MapPoint =>
  ({ id, name, short, address, xy, geo: toGeo(xy[0], xy[1]), contested: influence > 0, influence, icon });

export const MAP_POINTS: MapPoint[] = [
  P('main', 'Главный корпус (ГК, А–Д)', 'ГК', 'Красноказарменная ул., 17', [1080, 1148], 'main', 14),
  P('admin', 'Корпуса Ж–Л', 'Корпус Ж–Л', 'Красноказарменная ул., 14', [1078, 1292], 'lab', 10),
  P('bastille', 'Корпус Е', 'Корпус Е', 'Красноказарменная ул., 13, стр. 1', [758, 995], 'lab', 10),
  P('library', 'Научно-техническая библиотека МЭИ', 'НТБ', 'Красноказарменная ул., 13, стр. 3', [846, 1062], 'book', 10),
  P('dk', 'Дом культуры МЭИ', 'ДК МЭИ', 'Энергетический пр., 3, стр. 1', [1080, 880], 'culture', 12),
  P('steklyashka', 'Столовая № 10', 'Столовая №10', 'Красноказарменная ул., 17В', [1300, 988], 'food', 12),
  P('tec', 'Учебная ТЭЦ МЭИ', 'ТЭЦ МЭИ', 'Красноказарменная ул., 17, стр. 5', [1160, 1048], 'power', 10),
  P('dorms', 'Студгородок МЭИ: общежитие №14', 'Студгородок', 'Энергетическая ул., 14', [1130, 735], 'dorm', 14),
  P('stadium', 'Спорткомбинат «Энергия» МЭИ', 'СК «Энергия»', '2-й Краснокурсантский пр., 12', [655, 290], 'stadium', 12),
  P('park', 'Лефортовский парк', 'Лефортовский парк', 'Красноказарменная ул., 1', [150, 230], 'park', 10),
  // ориентиры (не захватываются)
  P('metro_aviamotornaya', 'Метро «Авиамоторная»', 'Авиамоторная', 'Авиамоторная ул.', [1622, 1395], 'metro', 0),
  P('metro_lefortovo', 'Метро «Лефортово» (БКЛ)', 'Лефортово', 'Наличная ул.', [993, 74], 'metro', 0),
];

export const CONTESTED = MAP_POINTS.filter((p) => p.contested);

/** Ратуши ПБ — в настоящих аудиториях профбюро: корпус и номер. */
const R = (xy: [number, number], room: string) => ({ xy, geo: toGeo(xy[0], xy[1]), room });
export const RATUSHA_SPOTS: Record<Exclude<FactionId, 'profkom'>, { xy: [number, number]; geo: [number, number]; room: string }> = {
  inei: R([1188, 1322], 'К-304'),
  ivti: R([866, 908], 'М-200к'),
  gpi: R([920, 958], 'М-917м'),
  ire: R([902, 1012], 'М-103'),
  itae: R([1008, 1112], 'Б-203'),
  enmi: R([1026, 1176], 'Б-405'),
  igvie: R([1128, 1210], 'Г-315'),
  ievt: R([1170, 1236], 'Г-402'),
  iete: R([1218, 1136], 'Д-403'),
  iee: R([1240, 1186], 'Д-407'),
};

/** Профком на карте — цель штурма (между ДК, ТЭЦ и ГК, чтобы не накрывать соседние метки). */
export const PROFKOM_XY: [number, number] = [1060, 990];

/** Центр кампуса — «дом» профкома на карте. */
export const CAMPUS_HOME: [number, number] = [1070, 1060];

export const MAP_CENTER: [number, number] = toGeo(1070, 1060);
export const MAP_BOUNDS: [[number, number], [number, number]] = [toGeo(0, 1610), toGeo(1690, 0)];

// ---------- Внешние мероприятия ----------
export interface MapEvent { id: string; name: string; game: GameId; trophy: string; xy: [number, number]; geo: [number, number] }
const E = (id: string, name: string, game: GameId, trophy: string, xy: [number, number]): MapEvent => ({ id, name, game, trophy, xy, geo: toGeo(xy[0], xy[1]) });
export const MAP_EVENTS: MapEvent[] = [
  E('stipkom', 'Школа «Стипком»', 'ring', 'Кодекс', [330, 1450]),
  E('sparta', 'Спартакиада', 'runner', 'Кубок', [430, 640]),
  E('priem', 'Приёмная комиссия', 'stamp', 'Золотая печать', [1480, 300]),
  E('region', 'Выезд в регион', 'bus', 'Вымпел', [1430, 1545]),
  E('forum', 'Форум студлидеров', 'blocks', 'Бейдж спикера', [740, 1410]),
  E('granty', 'Ярмарка грантов', 'merge', 'Сундук', [1560, 800]),
  E('olymp', 'Профсоюзная олимпиада', 'crossword', 'Лавровый венок', [360, 990]),
];

/** Сколько длится мероприятие и сколько активистов нужно отправить. */
export const EVENT_MINUTES = 60;
export const EVENT_SQUAD = 5;
