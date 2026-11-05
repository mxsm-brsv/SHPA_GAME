// «Кнопка»: вход из Telegram. Проверяет подпись initData (HMAC от токена бота вечерки или «ШПА») и выдаёт
// токен телефона через bz_register. Один Telegram-аккаунт — один активный телефон: новый вход отключает старый.
// Секреты: VECHERKA_BOT_TOKEN, BOT_TOKEN. Деплой: supabase functions deploy knopka --no-verify-jwt
import { BOT_TOKEN, CORS, json, serviceRpc } from '../_shared/env.ts';

const MAX_AGE_S = 2 * 24 * 3600; // initData старше двух суток не принимаем
const TOKENS = [Deno.env.get('VECHERKA_BOT_TOKEN') ?? '', BOT_TOKEN].filter(Boolean);

const enc = new TextEncoder();
async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Проверка initData по документации Telegram Mini Apps. */
async function verifyInitData(initData: string) {
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  let signed = false;
  for (const token of TOKENS) {
    if (hex(await hmac(await hmac(enc.encode('WebAppData'), token), check)) === hash) { signed = true; break; }
  }
  if (!signed) return null;
  const authDate = Number(p.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_S) return null;
  const user = JSON.parse(p.get('user') ?? 'null');
  return user && typeof user.id === 'number' ? user as { id: number; username?: string; first_name?: string; last_name?: string } : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!TOKENS.length) return json({ error: 'Сервер не настроен: нет токена бота' }, 500);
  try {
    const body = await req.json().catch(() => ({}));
    const user = typeof body.initData === 'string' ? await verifyInitData(body.initData) : null;
    if (!user) return json({ error: 'Подпись Telegram не прошла проверку. Открой кнопку заново из бота.' }, 401);
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 40) || 'Капитан';
    const r = await serviceRpc<{ ok: boolean; token: string; name: string }>('bz_register', { p_tg: user.id, p_name: name, p_username: user.username ?? null });
    return json({ token: r.token, name: r.name });
  } catch (e) {
    console.error('knopka', (e as Error).message);
    return json({ error: 'Ошибка входа, попробуй ещё раз' }, 500);
  }
});
