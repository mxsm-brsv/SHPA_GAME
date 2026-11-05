// QR-станция организатора: открыть отметку и показать QR на своём телефоне. Участники подходят и сканируют.
// Виды: блок/лекция (всем, кто пришёл), «Я — скорость» (первые N, статичный QR для печати), своя активность.
import { LECTURE, LECTURE_PRESETS } from '../../config/lectures';
import { icon } from '../../art/icons';
import type { LectureSession, QrKind } from '../../core/backend';
import { LECTURE_ROTATE_S, currentCode } from '../../core/codes';
import { qrSvg } from '../../core/qr';
import { haptic } from '../../core/telegram';
import { $, el, esc, hm, mmss, toast } from '../../lib/dom';

/** Сколько осталось: минуты:секунды, а больше часа — часы и минуты. */
const leftText = (ms: number) => (ms >= 3600_000 ? hm(ms) : mmss(ms));
import type { App } from '../app';
import { lectureQrText, openProjector } from './projector';

const KINDS: { id: QrKind; name: string; text: string; points: number; minutes: number; max: number; rotating: boolean }[] = [
  { id: 'lecture', name: 'Блок / лекция', text: 'Всем, кто пришёл. QR и код меняются каждые 20 с — фото в чат не поможет', points: LECTURE.defaultPoints, minutes: LECTURE.defaultMinutes, max: 0, rotating: true },
  { id: 'speed', name: '«Я — скорость»', text: 'Баллы только первым N. Статичный QR — распечатай или спрячь на базе', points: 30, minutes: 12 * 60, max: 5, rotating: false },
  { id: 'activity', name: 'Своя активность', text: 'Мастер-класс, вечерка, дежурство — любое событие с отметкой', points: 10, minutes: 15, max: 0, rotating: true },
];

/** Форма открытия отметки. Встраивается во вкладку панели организатора. */
export async function drawQrStation(app: App, body: HTMLElement, onChange: () => void) {
  const cfg = await app.backend.config().catch(() => app.cfg);
  // отмечает один назначенный организатор: остальным доступен только «Я — скорость»
  const only = cfg.checkinHost && cfg.canCheckin === false ? cfg.checkinHost.name : null;
  const kinds = only ? KINDS.filter((k) => k.id === 'speed') : KINDS;
  let kind: QrKind = kinds[0].id;
  body.innerHTML = `${only ? `<div class="card small" style="border-color:var(--gold)">Отметки на блоках ведёт <b class="gold">${esc(only)}</b> — участники отмечаются у него. Тебе доступен «Я — скорость» (спрятанный QR).</div>` : ''}<div class="card col" style="gap:8px">
      <b>Открыть отметку по QR</b>
      <div class="small muted">QR появится у тебя на телефоне во весь экран. Участники подходят к тебе и сканируют его в игре (кнопка «QR» на базе) или вводят код под ним.</div>
      <div class="qk" data-kinds>${kinds.map((k) => `<button class="qk-b ${k.id === kind ? 'on' : ''}" data-k="${k.id}"><b>${esc(k.name)}</b><span>${esc(k.text)}</span></button>`).join('')}</div>
      <div data-titlebox></div>
      <div class="mgrid">
        <label>Баллов<input class="input-ans" type="number" data-pts min="1" max="${LECTURE.maxPoints}"></label>
        <label>Минут открыто<input class="input-ans" type="number" data-min min="1" max="1440"></label>
        <label>Первым N (0 — всем)<input class="input-ans" type="number" data-max min="0" max="500"></label>
        <label class="row small" style="gap:6px;align-self:end"><input type="checkbox" data-rot> обновляемый QR</label>
      </div>
      <button class="btn btn-gold btn-block" data-open>${icon('qr', 18)} Открыть и показать QR</button>
    </div>
    <div class="section-h">Открытые и прошедшие</div><div data-ll class="col" style="gap:8px"><div class="muted">Загрузка…</div></div>`;
  const setKind = (k: QrKind) => {
    kind = k;
    const d = KINDS.find((x) => x.id === k)!;
    body.querySelectorAll<HTMLElement>('.qk-b').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    ($(body, '[data-pts]') as HTMLInputElement).value = String(d.points);
    ($(body, '[data-min]') as HTMLInputElement).value = String(d.minutes);
    ($(body, '[data-max]') as HTMLInputElement).value = String(d.max);
    ($(body, '[data-rot]') as HTMLInputElement).checked = d.rotating;
    $(body, '[data-titlebox]').innerHTML = k === 'lecture'
      ? `<select class="input-ans" data-title>${LECTURE_PRESETS.map((p) => `<option>${esc(p)}</option>`).join('')}<option value="">Другое…</option></select><input class="input-ans hidden" data-custom placeholder="Название блока" style="margin-top:6px">`
      : `<input class="input-ans" data-custom placeholder="${k === 'speed' ? 'Например: Я — скорость, 7 ноября' : 'Например: Мастер-класс по SMM'}" value="${k === 'speed' ? `Я — скорость, ${new Date(Date.now() + 3 * 3600_000).toISOString().slice(8, 10)}.11` : ''}">`;
    const sel = body.querySelector<HTMLSelectElement>('[data-title]');
    sel?.addEventListener('change', () => $(body, '[data-custom]').classList.toggle('hidden', sel.value !== ''));
  };
  body.querySelectorAll<HTMLElement>('.qk-b').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.k as QrKind)));
  setKind(kind);

  $(body, '[data-open]').addEventListener('click', async () => {
    const sel = body.querySelector<HTMLSelectElement>('[data-title]');
    const title = (sel && sel.value) || (body.querySelector<HTMLInputElement>('[data-custom]')?.value ?? '').trim();
    if (!title) { toast('Напиши название', 'bad'); return; }
    const num = (q: string, d: number) => { const v = Number(($(body, q) as HTMLInputElement).value); return Number.isFinite(v) ? v : d; };
    try {
      const l = await app.backend.staffLectureOpen({
        title, kind, points: num('[data-pts]', 15), minutes: num('[data-min]', 7), maxClaims: num('[data-max]', 0),
        rotating: ($(body, '[data-rot]') as HTMLInputElement).checked,
      });
      haptic('ok');
      if (l.existing) toast(`Такая отметка уже открыта${l.openedByName ? ` (${l.openedByName})` : ''} — показываю её QR`, 'info');
      showQr(app, l, onChange);
      onChange();
    } catch (e) { toast((e as Error).message, 'bad'); }
  });

  const ls = await app.backend.staffLectures().catch(() => [] as LectureSession[]);
  const now = Date.now();
  const box = $(body, '[data-ll]');
  box.innerHTML = ls.slice(0, 30).map((l) => {
    const open = l.closesAt > now;
    return `<div class="card row" style="${open ? 'border-color:var(--green)' : ''}"><div class="grow"><b>${esc(l.title)}</b> <span class="small muted">· +${l.points}${l.maxClaims ? ` · первым ${l.maxClaims}` : ''}${l.rotating === false ? ' · статичный' : ''}${l.openedByName ? ` · ${esc(l.openedByName)}` : ''}</span>
      <div class="small ${open ? 'gold' : 'muted'}">${open ? `открыта ещё ${leftText(l.closesAt - now)}` : `закрыта · ${new Date(l.openedAt + 3 * 3600_000).toISOString().slice(11, 16)}`} · отметились ${l.claims}</div></div>
      ${open ? `<button class="btn btn-gold btn-sm" data-show="${l.id}">QR</button><button class="btn btn-ghost btn-sm" data-close="${l.id}">Закрыть</button>` : ''}</div>`;
  }).join('') || '<div class="muted small">Ещё не открывали</div>';
  box.querySelectorAll<HTMLElement>('[data-show]').forEach((b) => b.addEventListener('click', () => { const l = ls.find((x) => x.id === b.dataset.show); if (l) showQr(app, l, onChange); }));
  box.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', async () => { await app.backend.staffLectureClose(b.dataset.close!); toast('Отметка закрыта', 'info'); onChange(); }));
}

const codeOf = (l: LectureSession) => (l.rotating === false && l.code ? { code: l.code, left: 0 } : currentCode(l.secret ?? '', LECTURE_ROTATE_S));

/** QR во весь экран телефона организатора. */
export function showQr(app: App, l: LectureSession, onChange?: () => void) {
  const node = el(`<div class="qr-full">
    <div class="row" style="width:100%;gap:8px"><div class="grow"><div class="small muted">${l.kind === 'speed' ? 'Я — скорость' : l.kind === 'activity' ? 'Активность' : 'Блок'} · +${l.points} баллов${l.maxClaims ? ` · первым ${l.maxClaims}` : ''}</div><b style="font-size:18px">${esc(l.title)}</b></div>
      <button class="btn btn-ghost btn-sm" data-x aria-label="Свернуть">${icon('x', 18)}</button></div>
    <div class="qr-full-box" data-qr></div>
    <div class="code-big" data-code></div>
    ${l.rotating === false ? '<div class="small muted center">Статичный QR: сделай скриншот, распечатай или спрячь. Работает, пока отметка открыта.</div>' : '<div class="ring-bar" style="width:100%"><i data-left></i></div>'}
    <div class="row" style="gap:16px;justify-content:center"><div class="center"><div class="small muted">Отметились</div><b style="font-size:26px" data-n>${l.claims}</b></div>
      <div class="center"><div class="small muted">Закроется через</div><b style="font-size:26px" data-t></b></div></div>
    <div class="small muted center">Участник: база → кнопка «QR» → «Сканировать» или ввести код.</div>
    <div class="row" style="gap:8px;width:100%"><button class="btn btn-blue grow" data-big>${icon('trophy', 16)} На большой экран</button><button class="btn btn-red grow" data-stop>Закрыть отметку</button></div>
  </div>`);
  let shown = '';
  let n = 0;
  const draw = () => {
    if (l.closesAt <= Date.now()) { $(node, '[data-t]').textContent = 'закрыта'; return; }
    const c = codeOf(l);
    if (c.code !== shown) {
      shown = c.code;
      $(node, '[data-qr]').innerHTML = qrSvg(lectureQrText(c.code));
      $(node, '[data-code]').textContent = `${c.code.slice(0, 3)} ${c.code.slice(3)}`;
    }
    const left = node.querySelector<HTMLElement>('[data-left]');
    if (left) left.style.width = `${(c.left / LECTURE_ROTATE_S) * 100}%`;
    $(node, '[data-t]').textContent = leftText(l.closesAt - Date.now());
    if (++n % 20 === 0) refresh();
  };
  const refresh = async () => {
    const ls = await app.backend.staffLectures().catch(() => null);
    const x = ls?.find((y) => y.id === l.id);
    if (x) { l = { ...l, claims: x.claims, closesAt: x.closesAt }; $(node, '[data-n]').textContent = String(x.claims); }
  };
  const timer = window.setInterval(draw, 250);
  const close = () => { clearInterval(timer); node.remove(); onChange?.(); };
  $(node, '[data-x]').addEventListener('click', close);
  $(node, '[data-big]').addEventListener('click', () => { close(); openProjector(app, l); });
  $(node, '[data-stop]').addEventListener('click', async () => { await app.backend.staffLectureClose(l.id); toast('Отметка закрыта', 'info'); close(); });
  app.root.appendChild(node);
  draw();
}
