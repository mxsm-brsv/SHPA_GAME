// Экран для актового зала: рейтинг ПБ, лучшие участники, эфир, таймер стычки и QR отметки на блоке.
// Открывается из панели организатора (или по ссылке ?screen=1 после входа организатора). Обновляется сам.
import { factionById } from '../../config/factions';
import { contribTitle } from '../../config/clicker';
import { totemSvg } from '../../art/totems';
import { icon } from '../../art/icons';
import { LECTURE_ROTATE_S, currentCode } from '../../core/codes';
import { qrSvg } from '../../core/qr';
import { nextRoundAt } from '../../core/world';
import type { LectureSession } from '../../core/backend';
import { $, el, esc, fmt, mmss } from '../../lib/dom';
import type { App } from '../app';

export function lectureQrText(code: string) {
  const bot = import.meta.env.VITE_BOT_USERNAME as string | undefined;
  return bot ? `https://t.me/${bot}?startapp=lec_${code}` : `SHPA:L:${code}`;
}

export function openProjector(app: App, focusLecture?: LectureSession) {
  const node = el(`<div class="screen full projector">
    <div class="pj-top"><div class="row" style="gap:12px">${totemSvg(factionById('profkom'), 54)}<div><div class="pj-title">Школа профсоюзного актива</div><div class="muted">Рейтинг игры · обновляется сам</div></div></div>
      <div class="row" style="gap:14px"><div class="pj-clock" data-clock></div><button class="btn btn-ghost btn-sm" data-x aria-label="Закрыть">${icon('x', 18)}</button></div></div>
    <div class="pj-grid">
      <div class="pj-card"><div class="pj-h">Профбюро</div><div data-pb class="pj-list"></div></div>
      <div class="pj-card" data-right><div class="pj-h" data-rh>Участники</div><div data-pl class="pj-list"></div></div>
    </div>
    <div class="pj-ticker"><span class="pj-tag" data-round></span><div class="pj-run" data-live></div></div>
  </div>`);
  let sort: 'rating' | 'contributed' = 'rating';
  let lect: LectureSession | null = focusLecture ?? null;
  let tick = 0;

  const drawBoards = async () => {
    const d = await app.backend.leaderboard(app.state).catch(() => null);
    if (!d) return;
    const max = Math.max(1, ...d.factions.map((r) => r.score));
    $(node, '[data-pb]').innerHTML = d.factions.map((r, i) => {
      const f = factionById(r.faction);
      return `<div class="pj-row"><b class="pj-n">${i + 1}</b>${totemSvg(f, 44)}<div class="grow"><div class="row" style="justify-content:space-between"><b>${f.short}</b><b class="gold">${fmt(r.score)}</b></div>
        <div class="pj-bar"><i style="width:${(r.score / max) * 100}%;background:${f.color}"></i></div><div class="small muted">ратуша ур. ${r.ratusha} · ${r.players}/${r.limit} игроков · влияние ${fmt(r.influence)}</div></div></div>`;
    }).join('');
    if (!lect) {
      const rows = [...d.players].sort((a, b) => b[sort] - a[sort]).slice(0, 10);
      $(node, '[data-rh]').textContent = sort === 'rating' ? 'Лучшие по баллам' : 'Больше всех вложились в своё ПБ';
      $(node, '[data-pl]').innerHTML = rows.map((p, i) => {
        const f = factionById(p.faction);
        return `<div class="pj-row"><b class="pj-n">${i + 1}</b>${totemSvg(f, 36)}<div class="grow"><b>${esc(p.name)}</b><div class="small muted">${f.short} · ${esc(contribTitle(p.contributed))}</div></div><b class="gold">${fmt(p[sort])}</b></div>`;
      }).join('');
    }
  };

  const drawLecture = () => {
    if (!lect || (!lect.secret && !lect.code)) return;
    if (lect.closesAt <= Date.now()) { lect = null; $(node, '[data-right]').classList.remove('pj-qr'); drawBoards(); return; }
    const c = lect.rotating === false && lect.code ? { code: lect.code, left: 0 } : currentCode(lect.secret ?? '', LECTURE_ROTATE_S);
    const r = $(node, '[data-right]');
    r.classList.add('pj-qr');
    if (r.dataset.code !== c.code) {
      r.dataset.code = c.code;
      r.innerHTML = `<div class="pj-h">Отметься: «${esc(lect.title)}» · +${lect.points}${lect.maxClaims ? ` · первым ${lect.maxClaims}` : ''}</div>
        <div class="pj-qrbox">${qrSvg(lectureQrText(c.code))}</div>
        <div class="pj-code">${c.code.slice(0, 3)} ${c.code.slice(3)}</div>
        <div class="muted center">В игре: кнопка «QR» на базе → сканируй или введи код.${lect.rotating === false ? '' : ` Код меняется каждые ${LECTURE_ROTATE_S} с.`}</div>
        <div class="ring-bar"><i data-left></i></div><div class="center small muted" data-lc></div>`;
    }
    const left = r.querySelector<HTMLElement>('[data-left]');
    if (left) left.style.width = `${(c.left / LECTURE_ROTATE_S) * 100}%`;
    const lc = r.querySelector('[data-lc]');
    if (lc) lc.textContent = `Отметка закроется через ${mmss(lect.closesAt - Date.now())}`;
  };

  const drawLive = async () => {
    await app.refreshLive();
    $(node, '[data-live]').innerHTML = app.live.slice(0, 5).map((a) => `<span class="pj-msg ${a.kind}">${esc(a.text)}</span>`).join('') || '<span class="muted">Следите за эфиром</span>';
  };

  const findLecture = async () => {
    if (focusLecture || !app.backend.staff) return;
    const ls = await app.backend.staffLectures().catch(() => []);
    const open = ls.find((l) => l.closesAt > Date.now() && (l.secret || l.code));
    if (open && (!lect || lect.id !== open.id)) { lect = open; drawLecture(); }
  };

  const loop = () => {
    tick++;
    $(node, '[data-clock]').textContent = new Date(Date.now() + 3 * 3600_000).toISOString().slice(11, 16);
    const nr = nextRoundAt();
    $(node, '[data-round]').textContent = nr ? `Стычка через ${mmss(nr - Date.now())}` : 'Стычки завершены';
    drawLecture();
    if (tick % 15 === 0) { sort = sort === 'rating' ? 'contributed' : 'rating'; drawBoards(); }
    if (tick % 20 === 0) findLecture();
    if (tick % 60 === 0) drawLive();
  };
  const timer = window.setInterval(loop, 1000);
  const close = () => { clearInterval(timer); node.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  $(node, '[data-x]').addEventListener('click', close);
  app.root.appendChild(node);
  try { node.requestFullscreen?.().catch(() => {}); } catch { /* браузер не дал */ }
  loop(); drawBoards(); drawLive(); findLecture(); drawLecture();
}
