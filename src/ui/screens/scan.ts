// Отметка по QR для участника: подойди к организатору и отсканируй QR с его телефона (или с экрана). Есть пример, как он выглядит.
import { icon } from '../../art/icons';
import { qrSvg } from '../../core/qr';
import { haptic } from '../../core/telegram';
import { canScanAny, scanAny } from '../../lib/scan';
import { $, esc, modal, toast } from '../../lib/dom';
import type { App } from '../app';
import { openMyQr } from './tasks';

export async function redeemAny(app: App, raw: string, after?: () => void) {
  const v = raw.trim();
  if (!v) return;
  // сервер сам разберёт: QR отметки, личный код знакомого, тайник или кодовое слово
  const r = await app.backend.redeemCode(app.state, v);
  haptic(r.status === 'approved' ? 'ok' : 'bad');
  toast(r.message, r.status === 'approved' ? 'ok' : 'bad');
  app.update(false);
  after?.();
}

export async function openScan(app: App) {
  const open = await app.backend.lecturesOpen().catch(() => []);
  const fresh = open.filter((l) => !app.state.lectures.includes(l.id));
  const cam = canScanAny();
  const m = modal(`<h2 style="font-size:22px">Отметка по QR</h2>
    <div class="scan-how">
      <div class="scan-sample">${qrSvg('SHPA:L:PRIMER')}<span>пример</span></div>
      <div class="small"><b>Как отметиться</b><br>1. Подойди к организатору — QR у него на телефоне или на экране зала.<br>2. Нажми «Сканировать» и наведи камеру.<br>3. Не сканируется — введи 6 знаков под QR.</div>
    </div>
    <div class="small" style="margin:8px 0">${fresh.length ? `Сейчас открыто: ${fresh.map((l) => `<b class="gold">${esc(l.title)}</b> +${l.points}${l.maxClaims ? ` (первым ${l.maxClaims})` : ''}`).join(', ')}` : open.length ? 'Во всех открытых отметках ты уже есть.' : '<span class="muted">Сейчас открытых отметок нет. Организатор откроет её на блоке.</span>'}</div>
    ${cam ? `<button class="btn btn-gold btn-block" data-scan>${icon('camera', 18)} Сканировать QR</button>` : '<div class="small muted">Камера здесь недоступна — введи код под QR. В Telegram-версии работает сканер.</div>'}
    <div class="row" style="gap:8px;margin-top:8px"><input class="input-ans grow" data-code placeholder="Код, например K7M 2QX" autocomplete="off" autocapitalize="characters" maxlength="24"><button class="btn btn-blue" data-ok>OK</button></div>
    <button class="btn btn-ghost btn-block btn-sm" data-my style="margin-top:8px">${icon('qr', 16)} Мой QR — для знакомств и выдачи мерча</button>`);
  const go = async (v: string) => { m.close(); await redeemAny(app, v); };
  m.root.querySelector('[data-scan]')?.addEventListener('click', async () => { const c = await scanAny('Наведи камеру на QR организатора'); if (c) go(c); });
  const inp = $(m.root, '[data-code]') as HTMLInputElement;
  $(m.root, '[data-ok]').addEventListener('click', () => go(inp.value));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(inp.value); });
  $(m.root, '[data-my]').addEventListener('click', () => { m.close(); openMyQr(app); });
}
