// Загружает банк вопросов в Supabase функцией seed_questions (ключ сервиса). Запускается в GitHub Actions.
// node scripts/seed-questions.mjs /tmp/questions.json
import { readFileSync } from 'node:fs';

const [, , file] = process.argv;
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!file || !url || !key) { console.error('Нужны файл, SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const bank = JSON.parse(readFileSync(file, 'utf8'));
// Отправляем как есть: функция seed_questions сама раскладывает ответ по колонкам
const rows = bank.map((q) => ({ id: q.id, format: q.format, topic: q.topic, level: q.level, question: q.question, options: q.options ?? null,
  correct: q.correct ?? null, answer: q.answer ?? null, accepted: q.accepted ?? null, explanation: q.explanation ?? '', source: q.source ?? '' }));

// Новый секретный ключ (sb_secret_…) — только в apikey; старый service_role (JWT) — ещё и в Authorization.
const headers = { apikey: key, 'content-type': 'application/json', ...(key.split('.').length === 3 ? { authorization: `Bearer ${key}` } : {}) };
const r = await fetch(`${url}/rest/v1/rpc/seed_questions`, { method: 'POST', headers, body: JSON.stringify({ p_rows: rows }) });
if (!r.ok) { console.error('Ошибка загрузки:', r.status, await r.text()); process.exit(1); }
console.log(`Загружено вопросов: ${await r.text()} (вопросы, которых нет в файле, выключены; принятые вопросы участников сохранены)`);
