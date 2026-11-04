// Бот «ШПА»: принимает обновления Telegram (вебхук) и отвечает на /start, /help, /me, /channel и кнопки.
// Вебхук ставит GitHub Actions (scripts/bot-setup.sh) с секретом — чужие запросы без него отбрасываются.
import { BOT_TOKEN, TG_CHANNEL, serviceRpc, tg } from '../_shared/env.ts';

const GAME_URL = (Deno.env.get('GAME_URL') ?? '').replace(/\/?$/, '/');
const CHANNEL = TG_CHANNEL || 'mpei_profcom';

const FACTION: Record<string, string> = {
  inei: 'ИнЭИ', ire: 'ИРЭ', gpi: 'ГПИ', igvie: 'ИГВИЭ', ievt: 'ИЭВТ', iete: 'ИЭТЭ', enmi: 'ЭнМИ', itae: 'ИТАЭ', ivti: 'ИВТИ', iee: 'ИЭЭ', profkom: 'Профком',
};

interface Profile { name: string; faction: string; role: string; rating: number; place: number; total: number; fplace: number | null; unread: number }

/** Секрет вебхука выводится из токена бота: sha256(token + ':webhook'), первые 48 hex-символов. */
async function webhookSecret() {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${BOT_TOKEN}:webhook`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const playRow = () => (GAME_URL ? [{ text: '🎮 Играть', web_app: { url: GAME_URL } }] : []);
const keyboard = () => ({
  inline_keyboard: [
    playRow(),
    [{ text: '🏆 Мои баллы', callback_data: 'me' }, { text: '❓ Как играть', callback_data: 'help' }],
    [{ text: '📣 Канал профкома', url: `https://t.me/${CHANNEL}` }],
  ].filter((r) => r.length),
});

async function profile(tgId: number): Promise<Profile | null> {
  return await serviceRpc<Profile | null>('service_bot_profile', { p_tg: tgId }).catch(() => null);
}

function meText(p: Profile | null, first: string) {
  if (!p) {
    return `Ты ещё не вошёл в игру, ${esc(first)}.\n\nНажми <b>«Играть»</b> и введи ФИО и группу так, как в списке выезда — профбюро подставится само.`;
  }
  const f = FACTION[p.faction] ?? p.faction;
  if (p.role !== 'participant') return `<b>${esc(p.name)}</b>, ты организатор (${f}). Панель организатора — кнопка «Орг.» на базе.`;
  return [
    `<b>${esc(p.name)}</b> · профбюро <b>${f}</b>`,
    `⭐ Баллы: <b>${p.rating}</b> — ${p.place}-е место из ${p.total}`,
    p.fplace ? `🏰 ${f} сейчас на ${p.fplace}-м месте среди профбюро` : '',
    p.unread ? `🔔 Непрочитанных уведомлений: ${p.unread} — загляни в игру` : '',
  ].filter(Boolean).join('\n');
}

const HELP = [
  '<b>Как играть в «ШПА»</b>',
  '',
  '1. Жми «Играть», входи по ФИО и группе — профбюро подставится само (в каждом ПБ до 7 человек).',
  '2. <b>Задания</b> — подписка на канал, квизы, творческие задания. Организатор проверит и пришлёт сюда ✅ или ❌.',
  '3. <b>QR</b> — на каждом блоке организатор показывает QR: сканируй в игре и получай баллы за присутствие.',
  '4. <b>Подготовка</b> — 1000+ вопросов к правовому конкурсу: тесты, карточки, свой тест.',
  '5. <b>Карта</b> — настоящий кампус МЭИ: ратуши ПБ стоят в ваших аудиториях, точки захватывают в стычках.',
  '6. <b>Игры</b> — мини-игры каждый день, лучший результат дня идёт в зачёт.',
  '7. <b>Магазин</b> — мерч ППО за баллы. Покупка не уменьшает рейтинг.',
  '',
  'Команды: /start — меню, /me — мои баллы, /channel — канал профкома.',
].join('\n');

/** «Кнопка» для вечерних игр: открывается отдельной страницей рядом с игрой. */
async function knopka(chat: number) {
  if (!GAME_URL) return await send(chat, 'Кнопка ещё не настроена.');
  return await tg('sendMessage', {
    chat_id: chat, parse_mode: 'HTML',
    text: '<b>Кнопка «Ты — лидер»</b>\n\nВыбери свою команду и жми, когда у команды готов ответ. Кто нажал первым, решают время касания и часы сервера, а не скорость интернета.',
    reply_markup: { inline_keyboard: [[{ text: '🟡 Открыть кнопку', web_app: { url: `${GAME_URL}knopka/` } }]] },
  });
}

async function send(chat: number, text: string, withKb = true) {
  return await tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(withKb ? { reply_markup: keyboard() } : {}) });
}

async function start(chat: number, from: { id: number; first_name?: string }) {
  const p = await profile(from.id);
  const hello = p && p.role === 'participant'
    ? `Привет, <b>${esc(p.name.split(' ')[0] || p.name)}</b>! ⚡\nТы в профбюро <b>${FACTION[p.faction] ?? p.faction}</b>: ${p.rating} баллов, ${p.place}-е место из ${p.total}.`
    : `Привет${from.first_name ? `, <b>${esc(from.first_name)}</b>` : ''}! ⚡\nЭто игра <b>Школы профсоюзного актива МЭИ</b>.`;
  const caption = `${hello}\n\nЗадания, QR-отметки на блоках, подготовка к правовому конкурсу, битва профбюро за кампус и мерч ППО за баллы.\n\nЖми <b>«Играть»</b> 👇`;
  const photo = GAME_URL ? `${GAME_URL}bot/start.jpg` : '';
  if (photo) {
    const r = await tg('sendPhoto', { chat_id: chat, photo, caption, parse_mode: 'HTML', reply_markup: keyboard() });
    if (r.ok) return;
  }
  await send(chat, caption);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  if (!BOT_TOKEN || req.headers.get('x-telegram-bot-api-secret-token') !== await webhookSecret()) return new Response('forbidden', { status: 403 });
  const u = await req.json().catch(() => null) as Record<string, any> | null;
  try {
    const msg = u?.message;
    if (msg?.chat?.type === 'private' && typeof msg.text === 'string') {
      const chat = msg.chat.id as number;
      const parts = msg.text.trim().split(/\s+/);
      const cmd = parts[0].replace(/@\w+$/, '').toLowerCase();
      if (cmd === '/knopka' || cmd === '/кнопка' || (cmd === '/start' && parts[1] === 'knopka')) await knopka(chat);
      else if (cmd === '/start' || cmd === '/menu') await start(chat, msg.from);
      else if (cmd === '/help') await send(chat, HELP);
      else if (cmd === '/me') await send(chat, meText(await profile(msg.from.id), msg.from.first_name ?? ''));
      else if (cmd === '/channel') await send(chat, `Канал профкома МЭИ: https://t.me/${CHANNEL}\nПодпишись — это одно из заданий игры.`);
      else await send(chat, 'Я бот игры ШПА: всё самое интересное — в игре. Нажми «Играть» 👇\n/help — как играть, /me — мои баллы.');
    }
    const cb = u?.callback_query;
    if (cb?.message?.chat?.id) {
      await tg('answerCallbackQuery', { callback_query_id: cb.id });
      const chat = cb.message.chat.id as number;
      if (cb.data === 'help') await send(chat, HELP);
      else if (cb.data === 'me') await send(chat, meText(await profile(cb.from.id), cb.from.first_name ?? ''));
    }
  } catch (e) {
    console.error('bot', (e as Error).message);
  }
  // Telegram ждёт 200, иначе будет повторять обновление
  return new Response('ok');
});
