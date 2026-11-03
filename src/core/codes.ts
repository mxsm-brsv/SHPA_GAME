// Обновляемые коды (личный QR и QR лекции) и нормализация ФИО/группы.
// Алгоритм кода повторён на сервере (supabase/migrations/*_shpa_v2.sql, функция rot_code) — менять только вместе.
import { hmacSha256 } from '../lib/sha256';

/** Латиница и цифры без похожих символов (нет 0/O, 1/I/L). 31 символ. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 6;
/** Личный QR меняется раз в 30 с, QR лекции — раз в 20 с. Принимается текущий и предыдущий код. */
export const PERSONAL_ROTATE_S = 30;
export const LECTURE_ROTATE_S = 20;

export const slotOf = (periodS: number, t = Date.now()) => Math.floor(t / 1000 / periodS);

export function rotCode(secret: string, slot: number): string {
  const h = hmacSha256(secret, String(slot));
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[h[i] % CODE_ALPHABET.length];
  return out;
}

/** Код сейчас и сколько секунд он ещё будет показываться. */
export function currentCode(secret: string, periodS: number, t = Date.now()) {
  const slot = slotOf(periodS, t);
  const left = periodS - ((t / 1000) % periodS);
  return { code: rotCode(secret, slot), slot, left };
}

/** Подходит ли код: текущий или предыдущий интервал (запас на ввод вручную). */
export function codeMatches(secret: string, periodS: number, code: string, t = Date.now()) {
  const c = cleanCode(code);
  const slot = slotOf(periodS, t);
  return c.length === CODE_LEN && (rotCode(secret, slot) === c || rotCode(secret, slot - 1) === c);
}

/** Чистит ввод кода: верхний регистр, кириллица-двойники → латиница, убирает пробелы и дефисы. */
export function cleanCode(raw: string) {
  const map: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };
  return raw.toUpperCase().replace(/[АВЕКМНОРСТУХ]/g, (ch) => map[ch] ?? ch).replace(/[^A-Z0-9]/g, '');
}

/** Разбирает содержимое QR: ссылку t.me/...?startapp=lec_XXXX, «SHPA:L:XXXX», «SHPA:P:XXXX» или просто код. */
export function parseScanned(raw: string): { kind: 'lecture' | 'person' | 'any'; code: string; text: string } {
  const s = raw.trim();
  const m = s.match(/startapp=(lec|p)_([A-Za-z0-9]+)/) ?? s.match(/SHPA:(L|P):([A-Za-z0-9]+)/i);
  if (m) return { kind: /^(lec|l)$/i.test(m[1]) ? 'lecture' : 'person', code: cleanCode(m[2]), text: s };
  return { kind: 'any', code: s, text: s };
}

export function randomSecret(n = 16) {
  const a = new Uint8Array(n);
  (globalThis.crypto ?? { getRandomValues: (x: Uint8Array) => x.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(a);
  return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Короткий случайный код (латиница+цифры) — для заказов мерча и т. п. */
export function randomCode(len = 6) {
  const a = new Uint8Array(len);
  if (globalThis.crypto && 'getRandomValues' in globalThis.crypto) crypto.getRandomValues(a);
  else a.forEach((_, i) => (a[i] = Math.floor(Math.random() * 256)));
  return Array.from(a, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

// ---------- ФИО и группа ----------
/** ФИО: нижний регистр, ё→е, только буквы и пробелы. Так же на сервере (norm_fio). */
export const normFio = (s: string) =>
  s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

/** Группа: латинские двойники → кириллица, без дефисов и пробелов. «ЭРэ-41-24» → «эрэ4124». */
export const normGroup = (s: string) => {
  const map: Record<string, string> = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[abcehkmoptxy]/g, (ch) => map[ch] ?? ch).replace(/[^0-9а-я]/g, '');
};

export const groupDigits = (s: string) => s.replace(/\D/g, '');
