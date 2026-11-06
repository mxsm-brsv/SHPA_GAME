// Магазин мерча: стартовый набор для демо и теста. На сервере список ведут организаторы в панели «Мерч».
// Цена — в баллах. Покупка не уменьшает рейтинг: баллы на счёте = заработанные баллы − потраченные в магазине.
export interface AutoDiscount { afterHours: number; stepPct: number; maxPct: number }
/** Цена по остатку: когда осталось ≤ left штук, базовая цена = price. */
export interface PriceTier { left: number; price: number }

export interface MerchItem {
  id: string;
  name: string;
  emoji: string;
  text: string;
  price: number;
  stock: number;          // сколько осталось
  total: number;          // сколько было всего
  perPerson: number;      // сколько штук в одни руки
  discount: number;       // ручная скидка, %
  auto: AutoDiscount | null; // автоскидка, если товар не покупают
  tiers?: PriceTier[];       // цена по остатку (условия организаторов)
  lastSaleAt: number;     // с этого момента считается автоскидка
  active: boolean;
}

export interface MerchOrder {
  id: string;
  itemId: string;
  itemName: string;
  emoji: string;
  price: number;
  at: number;
  status: 'reserved' | 'issued' | 'cancelled';
  player?: string;
  playerId?: string;
  faction?: string | null;
}

/** Автоскидка по умолчанию: −10% за каждые 3 часа без покупок, но не больше −40%. */
export const DEFAULT_AUTO: AutoDiscount = { afterHours: 3, stepPct: 10, maxPct: 40 };

/** Мерч выезда 7–8 ноября (тот же список кладёт на сервер миграция v16). Цены подобраны так, чтобы
 *  участник, который делает всё, мог купить по одной штуке каждого вида (см. economy-plan.ts). */
export const DEMO_MERCH: Omit<MerchItem, 'lastSaleAt'>[] = [
  { id: 's7_removka', name: 'Ремувка', emoji: '🏷️', text: 'Брелок-ремувка ППО', price: 40, stock: 20, total: 20, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_folder', name: 'Папка «Твоя профсоюзная папка»', emoji: '📁', text: 'Папка для документов', price: 50, stock: 10, total: 10, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_socks_sachok', name: 'Носки «Встретимся на сачке»', emoji: '🧦', text: 'Пара носков', price: 70, stock: 10, total: 10, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_socks_mei', name: 'Носки «МЭИ»', emoji: '🧦', text: 'Пара носков', price: 70, stock: 5, total: 5, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_cover', name: 'Обложка на студенческий', emoji: '🪪', text: 'Обложка для студенческого билета', price: 80, stock: 3, total: 3, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_bottle', name: 'Бутылка «Первый энергетический»', emoji: '🥤', text: 'Бутылка для воды', price: 120, stock: 3, total: 3, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_shopper', name: 'Шоппер «Первый энергетический»', emoji: '👜', text: 'Сумка-шоппер', price: 120, stock: 3, total: 3, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_tee_xl', name: 'Футболка «Первый энергетический» · XL', emoji: '👕', text: 'Размер XL', price: 180, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_tee_l', name: 'Футболка «Первый энергетический» · L', emoji: '👕', text: 'Размер L', price: 180, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_tee_m', name: 'Футболка «Первый энергетический» · M', emoji: '👕', text: 'Размер M', price: 180, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_tee_mount_s', name: 'Футболка с горами · S', emoji: '👕', text: 'Размер S', price: 180, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_sweat_xl', name: 'Свитшот «Первый энергетический» · XL', emoji: '🧥', text: 'Размер XL', price: 250, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_sweat_m', name: 'Свитшот «Первый энергетический» · M', emoji: '🧥', text: 'Размер M', price: 250, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_sweat_s', name: 'Свитшот «Первый энергетический» · S', emoji: '🧥', text: 'Размер S', price: 250, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_hoodie_xl', name: 'Худи «Колонны понравились» · XL', emoji: '🧥', text: 'Размер XL', price: 300, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_hoodie_l', name: 'Худи «Колонны понравились» · L', emoji: '🧥', text: 'Размер L', price: 300, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_powerbank', name: 'Повербанк 30 000 мА·ч', emoji: '🔋', text: 'Зарядка для телефона в дорогу', price: 350, stock: 2, total: 2, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_poster', name: 'Мотивирующий плакат от Маруси', emoji: '🖼️', text: 'От организаторов: Маруся', price: 40, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_toy_nikita', name: 'Мягкая игрушка от Никиты', emoji: '🧸', text: 'От организаторов: Никита Дулинов', price: 60, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_mama', name: '«Мамин гостинец»', emoji: '🍯', text: 'От организаторов: Ренат Извеков', price: 50, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_knit', name: 'Игрушка, связанная Лизиной мамой 🥰', emoji: '🧶', text: 'От организаторов: Лиза Камнская', price: 60, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_snack', name: 'Снэк-бокс от Даши Ухачевой', emoji: '🍿', text: 'От организаторов: Даша Ухачева', price: 60, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_ustav', name: 'Кастомизированный Устав от Юлечки Сорокиной', emoji: '📜', text: 'От организаторов: Юля Сорокина', price: 50, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_pickles', name: 'Банка огурцов «Папин гостинец»', emoji: '🥒', text: 'От организаторов: Даша Батусова', price: 50, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_spinner', name: 'Крутячок от Матвея Нечаева', emoji: '🌀', text: 'От организаторов: Матвей Нечаев', price: 40, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_smile', name: 'Улыбка Макса Борисова', emoji: '😊', text: 'От организаторов: Макс Борисов', price: 20, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_hug', name: 'Объятия Макса Борисова', emoji: '🤗', text: 'От организаторов: Макс Борисов', price: 30, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_energy', name: 'Энергетик Adrenaline Rush (0,25)', emoji: '⚡', text: 'От организаторов: Катя Корякова', price: 40, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_notebook_kk', name: 'Блокнот «Профсоюз всегда поможет»', emoji: '📓', text: 'От организаторов: Катя Корякова', price: 40, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_bunny', name: '«Мальчик зайчик светлячок малыш»', emoji: '🐰', text: 'От организаторов: Ульяна Полякова', price: 50, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_shopper_stip', name: 'Шоппер Стипкома', emoji: '👜', text: 'От организаторов: Катя Шатрова', price: 60, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_bottle_stl', name: 'Бутылка СТЛ', emoji: '🥤', text: 'От организаторов: Катя Шатрова', price: 60, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_notebook_lpb', name: 'Блокнот ЛПБ', emoji: '📓', text: 'От организаторов: Катя Шатрова', price: 40, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
  { id: 's7_org_antistress', name: 'Антистресс СКС', emoji: '🫧', text: 'От организаторов: Катя Шатрова', price: 40, stock: 1, total: 1, perPerson: 1, discount: 0, auto: null, active: true },
];

/** Базовая цена с учётом остатка: из подходящих условий берётся то, где порог меньше всего (как на сервере). */
export function basePrice(it: MerchItem) {
  const t = (it.tiers ?? []).filter((x) => x.price > 0 && it.stock <= x.left).sort((a, b) => a.left - b.left)[0];
  return t ? t.price : it.price;
}

/** Следующее условие: когда останется ≤ left — цена станет price (для подсказки в магазине). */
export function nextTier(it: MerchItem) {
  const base = basePrice(it);
  return (it.tiers ?? []).filter((x) => x.price > 0 && x.left < it.stock && x.price !== base).sort((a, b) => b.left - a.left)[0] ?? null;
}

/** Текущая цена с учётом остатка, ручной скидки и автоскидки за «простой». */
export function merchPrice(it: MerchItem, now = Date.now()) {
  let auto = 0;
  if (it.auto && it.auto.afterHours > 0 && it.stock > 0) {
    const steps = Math.floor((now - it.lastSaleAt) / (it.auto.afterHours * 3600_000));
    auto = Math.min(it.auto.maxPct, Math.max(0, steps) * it.auto.stepPct);
  }
  const pct = Math.max(it.discount, auto);
  const base = basePrice(it);
  return { price: Math.max(1, Math.ceil(base * (1 - pct / 100))), pct, auto: auto > it.discount, base };
}

/** Через сколько минут подешевеет (для подсказки «скоро скидка»). */
export function nextDiscountIn(it: MerchItem, now = Date.now()) {
  if (!it.auto || it.stock <= 0) return null;
  const { pct } = merchPrice(it, now);
  if (pct >= it.auto.maxPct) return null;
  const step = it.auto.afterHours * 3600_000;
  return step - ((now - it.lastSaleAt) % step);
}
