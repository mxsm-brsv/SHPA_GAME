// Мини-игры. status: ready — играбельна, soon — в разработке (показывается карточка «скоро»).
export type GameId =
  | 'fever' | 'ring' | 'runner' | 'stamp' | 'alias' | 'wordle' | 'bus' | 'blocks' | 'merge' | 'crossword' | 'categories' | 'stack' | 'flappy';

export interface MiniGame {
  id: GameId;
  name: string;
  mech: string;      // на что похожа механика
  text: string;
  color: string;
  icon: string;      // ключ иконки из art/icons
  status: 'ready' | 'soon';
  live?: boolean;    // живая игра на вечерке (без рейтинга в приложении)
}

export const MINIGAMES: MiniGame[] = [
  { id: 'fever', name: 'Профбюро-лихорадка', mech: 'тайм-менеджмент', text: 'Принимай студентов: справки, печати, матпомощь. Успей, пока не кончилось терпение', color: '#f08c2e', icon: 'desk', status: 'ready' },
  { id: 'ring', name: 'Правовой ринг', mech: 'квиз на время', text: '10 вопросов по 15 секунд, серия верных ответов умножает очки', color: '#7b4fd6', icon: 'scales', status: 'ready' },
  { id: 'runner', name: 'Бегом на пару', mech: 'раннер по коридорам', text: 'Беги по коридору МЭИ, собирай профкоины', color: '#2f8f5b', icon: 'run', status: 'ready' },
  { id: 'stamp', name: 'Печать', mech: 'на ловкость', text: 'Печати, ручки, кнопки и степлер — в вращающиеся документы. Каждый 5-й уровень — босс', color: '#c0442f', icon: 'stamp', status: 'ready' },
  { id: 'alias', name: 'Объясни', mech: 'объясни слово', text: 'Объясняй профсоюзные слова команде', color: '#b8860b', icon: 'chat', status: 'ready', live: true },
  { id: 'wordle', name: 'Профвордл', mech: 'слово дня', text: 'Угадай слово дня из 5 букв за 6 попыток', color: '#2f7f3f', icon: 'grid', status: 'ready' },
  { id: 'bus', name: 'Автобус на выезд', mech: 'головоломка', text: 'Рассади активистов по автобусам', color: '#1f6fae', icon: 'bus', status: 'ready' },
  { id: 'blocks', name: 'Расписание', mech: 'блоки', text: 'Собирай пары в расписании без окон', color: '#a2357a', icon: 'calendar', status: 'ready' },
  { id: 'merge', name: 'Слияние', mech: 'слияние', text: 'Скрепка → степлер → … → путёвка', color: '#b5651d', icon: 'merge', status: 'ready' },
  { id: 'crossword', name: 'Профкроссворд', mech: 'кроссворд дня', text: 'Кроссворд по профсоюзным терминам', color: '#3a4f7a', icon: 'cross', status: 'ready' },
  { id: 'categories', name: 'Категории', mech: 'буква и 5 категорий', text: 'За 60 секунд назови слова на букву', color: '#1f7a7a', icon: 'list', status: 'ready' },
  { id: 'stack', name: 'Профбашня', mech: 'как Stack', text: 'Строй башню профкома: тап — поставить этаж, свисающее отпиливается', color: '#d0632f', icon: 'stack', status: 'ready' },
  { id: 'flappy', name: 'Молния', mech: 'как Flappy Bird', text: 'Молния профкома летит над кампусом между трубами ТЭЦ', color: '#0a83c0', icon: 'bolt', status: 'ready' },
];

export const gameById = (id: GameId) => MINIGAMES.find((g) => g.id === id)!;
