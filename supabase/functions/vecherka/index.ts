// Бот вечерки (отдельный от «ШПА»): на любое сообщение отвечает кнопкой, открывающей мини-приложение
// «Кнопка + голосование». Вебхук и кнопку меню ставит GitHub Actions (scripts/vecherka-setup.sh).
// Секреты: VECHERKA_BOT_TOKEN, GAME_URL. Деплой: supabase functions deploy vecherka --no-verify-jwt
const TOKEN = Deno.env.get('VECHERKA_BOT_TOKEN') ?? '';
const APP_URL = `${(Deno.env.get('GAME_URL') ?? '').replace(/\/?$/, '/')}knopka/`;

async function webhookSecret() {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${TOKEN}:webhook`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return await r.json().catch(() => null);
}

const TEXT = '<b>Вечерка ШПА · Ты — лидер</b>\n\n' +
  '1. Открой приложение и выбери своё профбюро — один раз (если ты зарегистрирован в игре ШПА, оно подставится само).\n' +
  '2. Один человек от команды жмёт <b>кнопку</b>, когда у команды готов ответ. Кто первый — решают время касания и часы сервера, а не скорость интернета.\n' +
  '3. После клипов — <b>голосование</b> за лучший клип. За клип своего профбюро голосовать нельзя.';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  if (!TOKEN) return new Response('no token', { status: 500 });
  if (req.headers.get('x-telegram-bot-api-secret-token') !== await webhookSecret()) return new Response('forbidden', { status: 403 });
  const upd = await req.json().catch(() => null);
  const msg = upd?.message;
  try {
    if (msg?.chat?.type === 'private') {
      await tg('sendMessage', {
        chat_id: msg.chat.id, parse_mode: 'HTML', text: TEXT,
        reply_markup: { inline_keyboard: [[{ text: '🟡 Открыть кнопку и голосование', web_app: { url: APP_URL } }]] },
      });
    } else if (upd?.callback_query) {
      await tg('answerCallbackQuery', { callback_query_id: upd.callback_query.id });
    }
  } catch (e) {
    console.error('vecherka', (e as Error).message);
  }
  return new Response('ok');
});
