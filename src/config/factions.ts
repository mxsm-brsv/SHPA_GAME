// 10 профбюро + профком. Правьте здесь: названия, цвета, бонусы.
// Цвета и тотемы — из таблицы фракций концепции.

export type FactionId =
  | 'inei' | 'ire' | 'gpi' | 'igvie' | 'ievt' | 'iete' | 'enmi' | 'itae' | 'ivti' | 'iee' | 'profkom';

export type Totem =
  | 'raccoon' | 'tigers' | 'panther' | 'otter' | 'fox' | 'eagle' | 'wolf' | 'fire' | 'wave' | 'penguin' | 'manul' | 'bolt';

/** Бонус фракции в RPG-части (бои кампании, отряд, награды). */
export interface RpgPerk {
  atk?: number;        // +доля к атаке отряда
  hp?: number;         // +доля к здоровью
  crit?: number;       // +шанс крита
  dodge?: number;      // +шанс уклонения
  bossAtk?: number;    // +атака против боссов
  dmgTaken?: number;   // −доля входящего урона
  idle?: number;       // +доля к награде за лекцию
  upgradeCost?: number;// −доля к цене улучшения
  hireCost?: number;   // −доля к цене найма
  streak?: number;     // +атака в следующем бою после победы
}

export interface Faction {
  id: FactionId;
  short: string;       // ИЭВТ
  totem: Totem;
  totemName: string;   // Лиса
  color: string;
  colorDark: string;
  ability: { name: string; text: string };    // в мини-игре «Профбюро-лихорадка», раз за уровень
  perk: { name: string; text: string; effect: RpgPerk }; // постоянный бонус
  playable: boolean;
}

export const FACTIONS: Faction[] = [
  { id: 'inei', short: 'ИнЭИ', totem: 'raccoon', totemName: 'Енот', color: '#b57ed3', colorDark: '#4b2a63', playable: true,
    ability: { name: 'Запасливый', text: 'Мгновенно собирает один заказ' },
    perk: { name: 'Бюджет', text: 'Улучшения активистов на 10% дешевле', effect: { upgradeCost: 0.1 } } },
  { id: 'ire', short: 'ИРЭ', totem: 'tigers', totemName: 'Тигры', color: '#04644f', colorDark: '#023a2e', playable: true,
    ability: { name: 'Рывок', text: '10 секунд станции работают вдвое быстрее' },
    perk: { name: 'Натиск', text: '+10% к атаке отряда', effect: { atk: 0.1 } } },
  { id: 'gpi', short: 'ГПИ', totem: 'panther', totemName: 'Трёхглазая пантера', color: '#e593c5', colorDark: '#6b2f55', playable: true,
    ability: { name: 'Третий глаз', text: 'Видно трёх следующих посетителей' },
    perk: { name: 'Прозорливость', text: '+10% к шансу крита', effect: { crit: 0.1 } } },
  { id: 'igvie', short: 'ИГВИЭ', totem: 'otter', totemName: 'Выдра', color: '#6b8f3a', colorDark: '#2f4219', playable: true,
    ability: { name: 'Ловкие лапы', text: '20 секунд можно нести два заказа сразу' },
    perk: { name: 'Течение', text: '+10% к награде за лекцию', effect: { idle: 0.1 } } },
  { id: 'ievt', short: 'ИЭВТ', totem: 'fox', totemName: 'Лиса', color: '#fe7f04', colorDark: '#6b3400', playable: true,
    ability: { name: 'Хитрость', text: 'Ушедший посетитель возвращается' },
    perk: { name: 'Манёвр', text: '+10% к уклонению', effect: { dodge: 0.1 } } },
  { id: 'iete', short: 'ИЭТЭ', totem: 'eagle', totemName: 'Орёл', color: '#9b090a', colorDark: '#4a0405', playable: true,
    ability: { name: 'Высота', text: 'Терпение всей очереди восстанавливается' },
    perk: { name: 'Гнездо', text: '+10% к здоровью отряда', effect: { hp: 0.1 } } },
  { id: 'enmi', short: 'ЭнМИ', totem: 'wolf', totemName: 'Волк', color: '#f5b82e', colorDark: '#6b4a00', playable: true,
    ability: { name: 'Стая', text: '20 секунд помогает второй активист' },
    perk: { name: 'Вой', text: '+12% к атаке против боссов', effect: { bossAtk: 0.12 } } },
  { id: 'itae', short: 'ИТАЭ', totem: 'fire', totemName: 'Огонь', color: '#2c2ca8', colorDark: '#0d0d6f', playable: true,
    ability: { name: 'Разогрев', text: '30 секунд комбо растёт вдвое быстрее' },
    perk: { name: 'Энергия', text: 'Найм активистов на 15% дешевле', effect: { hireCost: 0.15 } } },
  { id: 'ivti', short: 'ИВТИ', totem: 'penguin', totemName: 'Пингвин Пиня', color: '#2b9fcb', colorDark: '#0f4a60', playable: true,
    ability: { name: 'Прилив', text: 'Пять посетителей приходят с готовым бланком' },
    perk: { name: 'Девятый вал', text: 'После победы следующий бой +10% к атаке', effect: { streak: 0.1 } } },
  { id: 'iee', short: 'ИЭЭ', totem: 'manul', totemName: 'Манул', color: '#b4239a', colorDark: '#520f46', playable: true,
    ability: { name: 'Невозмутимость', text: '20 секунд терпение не падает' },
    perk: { name: 'Стойкость', text: '−15% входящего урона', effect: { dmgTaken: 0.15 } } },
  { id: 'profkom', short: 'Профком', totem: 'bolt', totemName: 'Молния', color: '#009ee3', colorDark: '#004a6b', playable: false,
    ability: { name: 'Молния', text: 'Вне зачёта' },
    perk: { name: 'Нейтралитет', text: 'Вне зачёта: запускает события на карте', effect: {} } },
];

export const factionById = (id: string | null | undefined): Faction =>
  FACTIONS.find((f) => f.id === id) ?? FACTIONS[4];

export const PLAYABLE_FACTIONS = FACTIONS.filter((f) => f.playable);

/** Цвет подписи на тёмном фоне: тёмные цвета фракций высветляем. */
export function readable(color: string) {
  const n = parseInt(color.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.45) return color;
  const k = 0.55;
  const m = (x: number) => Math.round(x + (255 - x) * k);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
