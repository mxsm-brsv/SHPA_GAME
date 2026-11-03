// Банк правовых вопросов: типы, нормализация ответов, локальная проверка (демо-режим).
export type QFormat = 'yesno' | 'choice' | 'input';

export interface Question {
  id: string;
  format: QFormat;
  topic: string;
  level: number;
  question: string;
  source: string;
  options?: string[];
  // Поля ниже есть только в демо-режиме. В онлайне ответ проверяет сервер.
  correct?: boolean | number;
  answer?: string;
  accepted?: string[];
  explanation?: string;
}

export interface CheckResult { correct: boolean; right: string; explanation: string }

export const normalize = (s: string) =>
  s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"'.,!?;:()\-–—%№]/g, ' ').replace(/\s+/g, ' ').trim();

export function rightAnswerText(q: Question): string {
  if (q.format === 'yesno') return q.correct ? 'Да' : 'Нет';
  if (q.format === 'choice') return q.options?.[q.correct as number] ?? '';
  return q.answer ?? '';
}

export function checkLocal(q: Question, given: string | number | boolean): CheckResult {
  let ok = false;
  if (q.format === 'yesno') ok = given === q.correct;
  else if (q.format === 'choice') ok = given === q.correct;
  else {
    const g = normalize(String(given));
    const pool = [q.answer ?? '', ...(q.accepted ?? [])].map(normalize).filter(Boolean);
    ok = g.length > 0 && pool.some((a) => a === g || (a.length > 5 && g.length >= a.length - 1 && levenshtein(a, g) <= 1));
  }
  return { correct: ok, right: rightAnswerText(q), explanation: q.explanation ?? '' };
}

/** Допускаем одну опечатку в длинных ответах. */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

export const TOPICS_ORDER = [
  'Учёба и аттестация', 'Права обучающихся', 'Стипендии', 'Дисциплина', 'Академический отпуск', 'Перевод и восстановление', 'Общежития',
  'Платные услуги', 'Закон об образовании', 'Профсоюз: закон', 'Устав Профсоюза', 'Профсоюз: устройство и учёт', 'СКС Профсоюза',
  'Ценности и символика Профсоюза', 'Молодёжная политика и НКО', 'Армия', 'Персональные данные', 'Целевое и практика',
  'Государственная политика', 'Соглашения', 'Проекты и сайты',
];

export function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

/** Для вопросов с выбором — перемешанный порядок вариантов (индексы исходных). */
export const shuffledOptionOrder = (q: Question) => shuffle((q.options ?? []).map((_, i) => i));
