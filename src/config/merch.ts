// Магазин мерча: стартовый набор для демо и теста. На сервере список ведут организаторы в панели «Мерч».
// Цена — в баллах. Покупка не уменьшает рейтинг: баллы на счёте = заработанные баллы − потраченные в магазине.
export interface AutoDiscount { afterHours: number; stepPct: number; maxPct: number }

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

export const DEMO_MERCH: Omit<MerchItem, 'lastSaleAt'>[] = [
  { id: 'removka', name: 'Ремувка ППО', emoji: '🏷️', text: 'Брелок-ремувка с молнией', price: 150, stock: 3, total: 3, perPerson: 1, discount: 0, auto: DEFAULT_AUTO, active: true },
  { id: 'stickers', name: 'Стикерпак ПБ', emoji: '✨', text: 'Тотемы всех 10 профбюро', price: 60, stock: 20, total: 20, perPerson: 2, discount: 0, auto: DEFAULT_AUTO, active: true },
  { id: 'pin', name: 'Значок «Актив»', emoji: '📍', text: 'Металлический значок выезда', price: 100, stock: 15, total: 15, perPerson: 1, discount: 0, auto: DEFAULT_AUTO, active: true },
  { id: 'notebook', name: 'Блокнот ШПА', emoji: '📓', text: 'Для конспектов и идей', price: 120, stock: 10, total: 10, perPerson: 1, discount: 0, auto: DEFAULT_AUTO, active: true },
  { id: 'shopper', name: 'Шоппер ППО', emoji: '👜', text: 'Сумка с логотипом профкома', price: 300, stock: 5, total: 5, perPerson: 1, discount: 0, auto: DEFAULT_AUTO, active: true },
  { id: 'hoodie', name: 'Худи ППО', emoji: '🧥', text: 'Главный приз магазина', price: 800, stock: 2, total: 2, perPerson: 1, discount: 0, auto: null, active: true },
];

/** Текущая цена с учётом ручной скидки и автоскидки за «простой». */
export function merchPrice(it: MerchItem, now = Date.now()) {
  let auto = 0;
  if (it.auto && it.auto.afterHours > 0 && it.stock > 0) {
    const steps = Math.floor((now - it.lastSaleAt) / (it.auto.afterHours * 3600_000));
    auto = Math.min(it.auto.maxPct, Math.max(0, steps) * it.auto.stepPct);
  }
  const pct = Math.max(it.discount, auto);
  return { price: Math.max(1, Math.ceil(it.price * (1 - pct / 100))), pct, auto: auto > it.discount };
}

/** Через сколько минут подешевеет (для подсказки «скоро скидка»). */
export function nextDiscountIn(it: MerchItem, now = Date.now()) {
  if (!it.auto || it.stock <= 0) return null;
  const { pct } = merchPrice(it, now);
  if (pct >= it.auto.maxPct) return null;
  const step = it.auto.afterHours * 3600_000;
  return step - ((now - it.lastSaleAt) % step);
}
