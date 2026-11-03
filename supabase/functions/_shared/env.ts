// Ключи проекта внутри edge-функций. Supabase сам кладёт их в окружение: старые (anon / service_role)
// или новые (publishable / secret, JSON в SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS). Берём то, что есть.
const firstKey = (json: string | undefined) => {
  try { const o = JSON.parse(json ?? ''); const v = Object.values(o)[0]; return typeof v === 'string' ? v : ''; } catch { return ''; }
};
export const URL_ = Deno.env.get('SUPABASE_URL')!;
export const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || firstKey(Deno.env.get('SUPABASE_SECRET_KEYS')) || Deno.env.get('SERVICE_KEY') || '';
export const ANON = Deno.env.get('SUPABASE_ANON_KEY') || firstKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')) || Deno.env.get('ANON_KEY') || '';
export const BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? '';
export const TG_CHANNEL = (Deno.env.get('TG_CHANNEL') ?? '').replace(/^@/, '');

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

/** Вызов RPC с ключом сервиса (новые ключи — только в apikey, старые JWT — ещё и в Authorization). */
export async function serviceRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { apikey: SERVICE, 'content-type': 'application/json' };
  if (SERVICE.split('.').length === 3) headers.authorization = `Bearer ${SERVICE}`;
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${txt.slice(0, 200)}`);
  return (txt ? JSON.parse(txt) : null) as T;
}

/** Кто вызывает функцию: проверяем токен игрока через Auth API. */
export async function callerId(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || token.split('.').length !== 3) return null;
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON || SERVICE, authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null) as { id?: string } | null;
  return u?.id ?? null;
}

/** RPC от имени игрока (его токен) — для проверок вроде is_staff(). */
export async function userRpc<T>(req: Request, fn: string, args: Record<string, unknown>): Promise<T> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON || SERVICE, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const txt = await r.text();
  if (!r.ok) throw new Error(txt.slice(0, 200));
  return (txt ? JSON.parse(txt) : null) as T;
}

export async function tg(method: string, body: Record<string, unknown>) {
  if (!BOT_TOKEN) return { ok: false, description: 'BOT_TOKEN не задан' } as Record<string, unknown>;
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return await r.json().catch(() => ({ ok: false })) as Record<string, unknown>;
}
