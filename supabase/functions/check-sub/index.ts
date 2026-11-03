// Проверка подписки на Telegram-канал ППО: бот (админ канала) смотрит, есть ли игрок среди подписчиков.
// Баллы начисляет база (service_grant_task), один раз. Без Telegram — задание сдаётся скриншотом на проверку.
import { CORS, TG_CHANNEL, callerId, json, serviceRpc, tg } from '../_shared/env.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const uid = await callerId(req);
    if (!uid) return json({ error: 'Войди в игру заново' }, 401);
    if (!TG_CHANNEL) return json({ error: 'Канал ещё не настроен — отправь скриншот подписки' });
    const tgId = await serviceRpc<number | null>('service_player_tg', { p_player: uid });
    if (!tgId) return json({ error: 'Проверка работает, если играешь из Telegram. Отправь скриншот подписки' });
    const r = await tg('getChatMember', { chat_id: `@${TG_CHANNEL}`, user_id: tgId });
    if (!r.ok) return json({ error: 'Бот не может проверить канал (он должен быть админом канала). Отправь скриншот подписки' });
    const status = (r.result as { status?: string } | undefined)?.status ?? '';
    if (!['member', 'administrator', 'creator', 'restricted'].includes(status)) return json({ granted: 0, message: `Подписка не найдена. Подпишись на @${TG_CHANNEL} и нажми ещё раз` });
    const g = await serviceRpc<{ granted: number; rating: number }>('service_grant_task', { p_player: uid, p_task: 'tg_channel' });
    return json({ granted: g.granted, rating: g.rating, message: g.granted ? `Подписка подтверждена: +${g.granted} баллов` : 'Уже засчитано' });
  } catch (e) {
    return json({ error: `Ошибка проверки: ${(e as Error).message}` }, 500);
  }
});
