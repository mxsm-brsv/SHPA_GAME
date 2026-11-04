// Отметка по QR для участника: подойди к организатору и отсканируй QR с его телефона (или с экрана). Есть пример, как он выглядит.
import { icon } from '../../art/icons';
import { qrSvg } from '../../core/qr';
import { haptic } from '../../core/telegram';
import { canScanAny, scanAny } from '../../lib/scan';
import { $, el, esc, modal, onAct, toast } from '../../lib/dom';
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

/** Старый вход: открыть вкладку QR. */
export function openScan(app: App) { app.go('qr'); }

/** Вкладка «QR» нижнего меню: отметка на блоке. */
export function renderQr(app: App) {
  const cam = canScanAny();
  const node = el(`<div class="screen"><div class="page">
    <h1 style="font-size:24px">Отметка на блоке</h1>
    <div class="qr-hero">
      ${cam ? `<button class="btn btn-gold btn-block qr-big" data-act="scan">${icon('camera', 28)}<span>Сканировать QR</span></button>` : '<div class="small muted">Камера здесь недоступна — введи код под QR. В Telegram работает встроенный сканер.</div>'}
      <div class="row" style="gap:8px"><input class="input-ans grow" data-code placeholder="Или код под QR: K7M 2QX" autocomplete="off" autocapitalize="characters" maxlength="24"><button class="btn btn-blue" data-act="ok">OK</button></div>
    </div>
    <div class="section-h">Сейчас открыто</div>
    <div data-open class="col" style="gap:8px"><div class="muted small">Загрузка…</div></div>
    <div class="section-h">Как отметиться</div>
    <div class="scan-how card">
      <div class="scan-sample">${qrSvg('SHPA:L:PRIMER')}<span>пример</span></div>
      <div class="small">1. На блоке организатор показывает QR — на телефоне или на экране зала.<br>2. Нажми «Сканировать» и наведи камеру.<br>3. Не сканируется — введи 6 знаков под QR.<br><span class="muted">Баллы — раз за блок. «Я — скорость» — только первым.</span></div>
    </div>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn btn-blue grow btn-col" data-act="word">${icon('sparkle', 20)}<span class="sub">Кодовое слово</span></button>
      <button class="btn btn-blue grow btn-col" data-act="my">${icon('qr', 20)}<span class="sub">Мой QR</span></button>
    </div>
    <div class="small muted center" style="margin:8px 0">«Мой QR» — для знакомств и выдачи мерча. Кодовые слова звучат на блоках и в презентациях.</div>
  </div></div>`);
  const inp = $(node, '[data-code]') as HTMLInputElement;
  const drawOpen = async () => {
    const open = await app.backend.lecturesOpen().catch(() => []);
    const box = $(node, '[data-open]');
    box.innerHTML = open.length ? open.map((l) => {
      const mine = l.mine || app.state.lectures.includes(l.id);
      return `<div class="card row" style="gap:10px;${mine ? 'opacity:.7' : 'border-color:var(--gold)'}">${icon(l.kind === 'speed' ? 'run' : 'qr', 26, mine ? '#6dffb0' : '#ffd76a')}
        <div class="grow"><b>${esc(l.title)}</b><div class="small muted">+${l.points} баллов${l.maxClaims ? ` · первым ${l.maxClaims}` : ''} · до ${new Date(l.closesAt + 3 * 3600_000).toISOString().slice(11, 16)}</div></div>
        ${mine ? '<span class="tag" style="background:#2fbf7133;color:#6dffb0">✓ есть</span>' : '<span class="tag" style="background:#ffc83d33;color:#ffd76a">ждёт</span>'}</div>`;
    }).join('') : '<div class="card muted small center">Открытых отметок нет. Организатор откроет её на блоке — здесь появится строка.</div>';
  };
  drawOpen();
  let n = 0;
  app.onTick(() => { if (++n % 20 === 0) drawOpen(); });
  const go = async (v: string) => { if (!v.trim()) return; await redeemAny(app, v); inp.value = ''; drawOpen(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(inp.value); });
  onAct(node, {
    scan: async () => { const c = await scanAny('Наведи камеру на QR организатора'); if (c) go(c); },
    ok: () => go(inp.value),
    my: () => openMyQr(app),
    word: () => {
      const m = modal(`<h2 style="font-size:22px">Кодовое слово</h2><div class="small muted" style="margin:4px 0 10px">Слово называют на блоке или показывают в презентации.</div>
        <input class="input-ans" data-w placeholder="Слово" autocomplete="off"><button class="btn btn-gold btn-block" data-w-ok style="margin-top:10px">Проверить</button>`);
      const w = $(m.root, '[data-w]') as HTMLInputElement;
      const ok = async () => { m.close(); await go(w.value); };
      $(m.root, '[data-w-ok]').addEventListener('click', ok);
      w.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      setTimeout(() => w.focus(), 50);
    },
  });
  return node;
}
