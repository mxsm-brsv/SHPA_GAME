// Локальная замена Supabase REST для проверки «Кнопки»: POST /rest/v1/rpc/<функция> → вызов функции
// в PostgreSQL от роли anon (как PostgREST), плюс статика public/ под /SHPA_GAME/ с локальным config.js.
// Запуск (Bun ≥ 1.2): PG=postgres://postgres@127.0.0.1:5499/shpa_test bun scripts/knopka/rest-shim.ts 54321
import { SQL } from 'bun';
import { join, normalize } from 'node:path';

const PORT = Number(process.argv[2] ?? 54321);
const sql = new SQL(process.env.PG ?? 'postgres://postgres@127.0.0.1:5499/shpa_test', { max: 20 });
const ROOT = normalize(join(import.meta.dir, '../../public'));

type Arg = { name: string; type: string };
const fns = new Map<string, Arg[]>();
const rows = await sql`
  select p.proname as name, coalesce(p.proargnames, '{}') as names,
         array(select format_type(t, null) from unnest(p.proargtypes) t) as types
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'bz\\_%'`;
for (const r of rows as { name: string; names: string[]; types: string[] }[]) {
  fns.set(r.name, r.types.map((type, i) => ({ name: r.names[i], type })));
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};

async function rpc(fn: string, body: Record<string, unknown>) {
  const sig = fns.get(fn);
  if (!sig) return new Response(JSON.stringify({ message: `function ${fn} not found` }), { status: 404, headers: cors });
  const parts = sig.filter((a) => a.name in body).map((a) =>
    a.type === 'jsonb' ? `${a.name} => (($1::text)::jsonb->'${a.name}')` : `${a.name} => (($1::text)::jsonb->>'${a.name}')::${a.type}`);
  const q = `select to_jsonb(public.${fn}(${parts.join(', ')})) as j`;
  try {
    const r = await sql.begin(async (tx) => {
      await tx.unsafe('set local role anon');
      return parts.length ? await tx.unsafe(q, [JSON.stringify(body)]) : await tx.unsafe(q);
    });
    return new Response(JSON.stringify(r[0].j), { headers: { ...cors, 'content-type': 'application/json' } });
  } catch (e) {
    const msg = (e as Error).message;
    return new Response(JSON.stringify({ message: msg }), { status: /permission denied/.test(msg) ? 401 : 400, headers: cors });
  }
}

// Функция knopka (вход из Telegram) — для локальной проверки с тестовым токеном бота TEST_BOT_TOKEN
const BOT = process.env.TEST_BOT_TOKEN ?? '';
const enc = new TextEncoder();
async function hmac(key: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
async function knopkaAuth(body: { initData?: string }) {
  const p = new URLSearchParams(body.initData ?? '');
  const hash = p.get('hash'); p.delete('hash');
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const ok = BOT && hash && hex(await hmac(await hmac(enc.encode('WebAppData'), BOT), check)) === hash;
  if (!ok) return new Response(JSON.stringify({ error: 'Подпись Telegram не прошла проверку' }), { status: 401, headers: cors });
  const user = JSON.parse(p.get('user') ?? '{}');
  const r = await sql`select public.bz_register(${user.id}::bigint, ${[user.first_name, user.last_name].filter(Boolean).join(' ')}, ${user.username ?? null}) as j`;
  return new Response(JSON.stringify({ token: r[0].j.token, name: r[0].j.name }), { headers: { ...cors, 'content-type': 'application/json' } });
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const m = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (m && req.method === 'POST') return rpc(m[1], await req.json().catch(() => ({})));
    if (u.pathname === '/functions/v1/knopka' && req.method === 'POST') return knopkaAuth(await req.json().catch(() => ({})));
    if (u.pathname.startsWith('/SHPA_GAME/')) {
      let p = u.pathname.slice('/SHPA_GAME/'.length);
      if (p === '' || p.endsWith('/')) p += 'index.html';
      if (p === 'knopka/config.js') {
        return new Response(`window.KNOPKA_CFG = ${JSON.stringify({ url: `http://127.0.0.1:${PORT}`, key: 'local-anon-key', bot: 'shpa_game_bot' })};`,
          { headers: { 'content-type': 'text/javascript' } });
      }
      const f = normalize(join(ROOT, p));
      if (!f.startsWith(ROOT)) return new Response('no', { status: 403 });
      const file = Bun.file(f);
      if (await file.exists()) return new Response(file);
    }
    return new Response('not found', { status: 404 });
  },
});
console.log(`shim: http://127.0.0.1:${PORT} (${fns.size} функций bz_*)`);
