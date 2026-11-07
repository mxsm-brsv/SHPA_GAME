// Сообщения от бота «ШПА», которые запускает панель организатора:
//   { submission } — участнику после проверки задания: «Принято …» или «Не принято …» (без смайликов);
//   { announce }   — сообщение из «Эфира» всем, кто вошёл в игру из Telegram (один раз на сообщение).
import { CORS, json, serviceRpc, tg, userRpc } from '../_shared/env.ts';

/** Текст уведомления из базы — без смайликов: в боте он должен выглядеть ровно. */
const plain = (t: string) => t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/^\s+/gm, '').trim();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { submission, announce } = await req.json().catch(() => ({})) as { submission?: number; announce?: number };
    if (!submission && !announce) return json({ error: 'нет submission' }, 400);
    // только организатор: проверяем его токеном
    const me = await userRpc<{ role?: string }>(req, 'me', {}).catch(() => null);
    if (!me || (me.role !== 'staff' && me.role !== 'admin')) return json({ error: 'staff only' }, 403);
    if (announce) return json(await broadcast(Number(announce)));
    const n = await serviceRpc<{ text: string; tg: number | null } | null>('service_note_for', { p_sub: submission });
    if (!n || !n.tg) return json({ sent: false });
    const r = await tg('sendMessage', { chat_id: n.tg, text: plain(n.text), disable_web_page_preview: true });
    return json({ sent: !!r.ok });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

const GAME_URL = (Deno.env.get('GAME_URL') ?? '').replace(/\/?$/, '/');
const HEAD: Record<string, string> = { info: 'Эфир ШПА', alert: 'Важно — эфир ШПА', win: 'Победа — эфир ШПА' };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Рассылка сообщения «Эфира»: ~25 сообщений в секунду, при «слишком часто» — пауза и повтор. */
async function broadcast(id: number) {
  const a = await serviceRpc<{ text: string; kind: string; ids: number[] } | null>('service_announce_targets', { p_id: id });
  if (!a) return { sent: 0, total: 0, skipped: true };
  const body = (chat: number) => ({
    chat_id: chat,
    text: `${HEAD[a.kind] ?? HEAD.info}\n\n${plain(a.text)}`,
    disable_web_page_preview: true,
    ...(GAME_URL ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть игру', web_app: { url: GAME_URL } }]] } } : {}),
  });
  let sent = 0;
  for (const chat of a.ids) {
    let r = await tg('sendMessage', body(chat));
    if (!r.ok && r.error_code === 429) {
      await wait(1000 * Number((r.parameters as { retry_after?: number } | undefined)?.retry_after ?? 1));
      r = await tg('sendMessage', body(chat));
    }
    if (r.ok) sent++;
    await wait(40);
  }
  await serviceRpc('service_announce_sent', { p_id: id, p_n: sent }).catch(() => null);
  return { sent, total: a.ids.length };
}
