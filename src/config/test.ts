// Тест-режим: всё открыто, как будто школа уже идёт: стычки каждые 10 минут, мероприятие всегда идёт, магазин и отметки открыты.
// Перед запуском 5 ноября поставить TEST_MODE = false (или задать VITE_TEST_MODE=0 при сборке).
export const TEST_MODE = !['0', 'false', 'off', 'no'].includes(String(import.meta.env.VITE_TEST_MODE ?? '1').toLowerCase());
/** Раунд стычек в тест-режиме — каждые N минут. */
export const TEST_ROUND_MINUTES = 10;
/** Мероприятия в тест-режиме: новое каждые N минут, всегда одно идёт. */
export const TEST_EVENT_MINUTES = 20;
/** Код организатора для входа состава в демо/тесте. На сервере — settings.staff_code (поменять перед выездом). */
export const DEMO_STAFF_CODE = 'ORG-TEST';
/** Кодовые слова для проверки пасхалок в демо. На сервере — таблица egg_codes. */
export const DEMO_EGG_CODES: Record<string, { task: 'egg' | 'egg_gold'; rating: number }> = {
  'ЭНЕРГИЯ': { task: 'egg', rating: 15 },
  'МОЛНИЯ': { task: 'egg', rating: 15 },
  'ЗОЛОТО': { task: 'egg_gold', rating: 50 },
};
/** Тайники в демо: код QR → номер тайника. */
export const DEMO_CACHES: Record<string, number> = {
  'CACHE-01': 1, 'CACHE-02': 2, 'CACHE-03': 3, 'CACHE-04': 4, 'CACHE-05': 5,
  'CACHE-06': 6, 'CACHE-07': 7, 'CACHE-08': 8, 'CACHE-09': 9, 'CACHE-10': 10,
};
