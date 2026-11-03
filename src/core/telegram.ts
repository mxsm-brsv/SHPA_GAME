// Обёртка над Telegram Mini App API. Вне Telegram всё работает как обычный сайт.
interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; username?: string; first_name?: string; last_name?: string }; start_param?: string };
  ready(): void;
  expand(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  disableVerticalSwipes?(): void;
  HapticFeedback?: { impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void; notificationOccurred(t: 'error' | 'success' | 'warning'): void };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  openTelegramLink?(url: string): void;
  openLink?(url: string): void;
  showScanQrPopup?(p: { text?: string }, cb: (data: string) => boolean | void): void;
  closeScanQrPopup?(): void;
  isVersionAtLeast?(v: string): boolean;
  version?: string;
}

declare global { interface Window { Telegram?: { WebApp?: TgWebApp } } }

let tg: TgWebApp | null = null;

export async function initTelegram(): Promise<TgWebApp | null> {
  // Скрипт Telegram грузим только внутри Telegram (есть tgWebAppData в адресе)
  const inTg = /tgWebAppData|tgWebAppVersion/.test(location.hash + location.search);
  if (!inTg) return null;
  await new Promise<void>((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
    setTimeout(resolve, 4000);
  });
  tg = window.Telegram?.WebApp ?? null;
  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor?.('#15173d'); tg.setBackgroundColor?.('#15173d'); tg.disableVerticalSwipes?.(); } catch { /* старые клиенты */ }
  }
  return tg;
}

export const telegram = () => tg;

export function haptic(kind: 'tap' | 'ok' | 'bad' | 'heavy' = 'tap') {
  try {
    const h = tg?.HapticFeedback;
    if (!h) { if (kind !== 'tap' && navigator.vibrate) navigator.vibrate(kind === 'bad' ? [30, 40, 30] : 20); return; }
    if (kind === 'tap') h.impactOccurred('light');
    else if (kind === 'heavy') h.impactOccurred('heavy');
    else h.notificationOccurred(kind === 'ok' ? 'success' : 'error');
  } catch { /* нет вибро */ }
}

/** Сканер QR в Telegram (6.4+). Вне Telegram — null, тогда код вводят вручную. */
export function canScanQr() {
  return !!tg?.showScanQrPopup && (tg.isVersionAtLeast?.('6.4') ?? true);
}

export function scanQr(text = 'Наведи камеру на QR-код'): Promise<string | null> {
  return new Promise((resolve) => {
    if (!canScanQr()) { resolve(null); return; }
    let done = false;
    try {
      tg!.showScanQrPopup!({ text }, (data) => { if (!done) { done = true; resolve(data); } return true; });
    } catch { resolve(null); }
  });
}

export function openExternal(url: string) {
  if (tg?.openTelegramLink && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
  else if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}
