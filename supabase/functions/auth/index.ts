// Вход в игру по списку выезда: ФИО (+ группа) или код организатора. Telegram — по подписи initData.
// Первый вход закрепляет человека за аккаунтом Telegram или устройством; сбросить может организатор («Участники» → «Сброс»).
// Секреты функции: BOT_TOKEN, AUTH_PEPPER. Деплой: supabase functions deploy auth --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ANON, BOT_TOKEN, SERVICE, URL_ } from '../_shared/env.ts';

const PEPPER = Deno.env.get('AUTH_PEPPER') ?? '';
const MAX_AGE_S = 7 * 24 * 3600; // initData старше недели не принимаем

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const enc = new TextEncoder();
async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (s: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));

/** Проверка initData по документации Telegram Mini Apps. */
async function verifyInitData(initData: string) {
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(enc.encode('WebAppData'), BOT_TOKEN);
  const calc = hex(await hmac(secret, check));
  if (calc !== hash) return null;
  const authDate = Number(p.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_S) return null;
  const user = JSON.parse(p.get('user') ?? 'null');
  return user && typeof user.id === 'number' ? user as { id: number; username?: string; first_name?: string } : null;
}

async function sessionFor(email: string, seed: string) {
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const password = hex(await hmac(enc.encode(PEPPER), seed)).slice(0, 48);
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error && !/already|exists|registered/i.test(created.error.message)) throw created.error;
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error('no session');
  return { admin, session: data.session };
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!BOT_TOKEN || !PEPPER) return json({ error: 'Сервер не настроен: нет BOT_TOKEN или AUTH_PEPPER' }, 500);
  try {
    const body = await req.json().catch(() => ({}));
    let tgId: number | null = null;
    if (typeof body.initData === 'string' && body.initData) {
      const user = await verifyInitData(body.initData);
      if (!user) return json({ error: 'Подпись Telegram не прошла проверку. Открой игру заново из бота.' }, 401);
      tgId = user.id;
    }
    const device = str(body.deviceKey, 64);
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    // ключ для ограничения попыток: Telegram-аккаунт, иначе устройство, иначе IP
    const key = tgId ? `tg:${tgId}` : device ? `dev:${(await sha(device)).slice(0, 16)}` : `ip:${ip}`;
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc('roster_login', {
      p_fio: str(body.fio, 120) || null,
      p_group: str(body.group, 24) || null,
      p_staff_code: str(body.staffCode, 60).trim().replace(/\s+/g, ' ').toUpperCase().replace(/Ё/g, 'Е') || null,
      p_tg_id: tgId,
      p_device: device ? await sha(`device:${device}`) : null,
      p_key: key,
    });
    if (error) throw error;
    const r = data as { ok?: boolean; needFio?: boolean; error?: string; roster_id?: number };
    if (r.needFio) return json({ needFio: true });
    if (!r.ok || !r.roster_id) return json({ error: r.error ?? 'Не получилось войти' }, 401);
    const { session } = await sessionFor(`r${r.roster_id}@players.pbgame.app`, `roster:${r.roster_id}`);
    const { error: e2 } = await admin.rpc('roster_attach', { p_roster: r.roster_id, p_player: session.user.id });
    if (e2) throw e2;
    return json({ access_token: session.access_token, refresh_token: session.refresh_token });
  } catch (e) {
    console.error(e);
    return json({ error: 'Ошибка входа, попробуй ещё раз' }, 500);
  }
});
