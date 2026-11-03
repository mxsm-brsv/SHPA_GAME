// Сообщение от бота участнику после проверки задания: «✅ Принято …» или «❌ Не принято …».
// Вызывает панель организатора сразу после решения. Уведомление в игре уже создано базой — здесь только дубль в Telegram.
import { CORS, json, serviceRpc, tg, userRpc } from '../_shared/env.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { submission } = await req.json().catch(() => ({})) as { submission?: number };
    if (!submission) return json({ error: 'нет submission' }, 400);
    // только организатор: проверяем его токеном
    const me = await userRpc<{ role?: string }>(req, 'me', {}).catch(() => null);
    if (!me || (me.role !== 'staff' && me.role !== 'admin')) return json({ error: 'staff only' }, 403);
    const n = await serviceRpc<{ text: string; tg: number | null } | null>('service_note_for', { p_sub: submission });
    if (!n || !n.tg) return json({ sent: false });
    const r = await tg('sendMessage', { chat_id: n.tg, text: n.text, disable_web_page_preview: true });
    return json({ sent: !!r.ok });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
