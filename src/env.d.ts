// Типы окружения. Работают и с vite/client (сборка для Pages), и без него (сборка превью через esbuild).
declare module '@bank' {
  const questions: unknown[];
  export default questions;
}
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_BOT_USERNAME?: string;
  readonly VITE_TEST_MODE?: string;
  readonly VITE_YANDEX_MAPS_KEY?: string;
  /** Telegram-канал ППО для задания «Подписаться» (без @) */
  readonly VITE_TG_CHANNEL?: string;
  /** '0' — не запрашивать live.json (превью одним файлом) */
  readonly VITE_LIVE_JSON?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
