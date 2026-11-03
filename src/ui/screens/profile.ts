// Профиль игрока и тест-панель (только в тест-режиме).
import { factionById } from '../../config/factions';
import { TEST_MODE } from '../../config/test';
import { MAX_STAGE } from '../../config/campaign';
import { totemSvg } from '../../art/totems';
import { icon } from '../../art/icons';
import { playerLevel, squadPower } from '../../core/logic';
import { contribTitle } from '../../config/clicker';
import { PERSONAL_ROTATE_S, currentCode } from '../../core/codes';
import { DemoBackend } from '../../core/backend-demo';
import { $, esc, fmt, modal, toast } from '../../lib/dom';
import type { App } from '../app';
import { openMyQr } from './tasks';
import { openStaff } from './staff';

export function openProfile(app: App) {
  const s = app.state;
  const f = factionById(s.faction);
  const lvl = playerLevel(s.rating);
  const m = modal(`<div class="col" style="align-items:center;gap:8px;text-align:center">
    ${totemSvg(f, 84)}
    <h2 style="font-size:22px">${esc(s.username)}</h2>
    <div class="muted">${f.short} · ${esc(lvl.name)}${s.role === 'staff' || s.role === 'admin' ? ' · состав, вне зачёта' : s.role === 'tester' ? ' · тестер' : ''}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%">
      <div class="card"><div class="small muted">Баллы</div><b>${fmt(s.rating)}</b></div>
      <div class="card"><div class="small muted">Вклад в ПБ</div><b>${fmt(s.clicker.contributed)}</b></div>
      <div class="card"><div class="small muted">Звание</div><b class="small">${esc(contribTitle(s.clicker.contributed))}</b></div>
      <div class="card"><div class="small muted">Сила</div><b>${fmt(squadPower(s).total)}</b></div>
      <div class="card"><div class="small muted">Этап</div><b>${Math.min(s.stage, MAX_STAGE)}</b></div>
      <div class="card"><div class="small muted">Стычки</div><b>${s.war.wins}/${s.war.fights}</b></div>
      <div class="card"><div class="small muted">Активисты</div><b>${s.heroes.length}</b></div>
      <div class="card"><div class="small muted">Знакомства</div><b>${s.tasks.meets.length}</b></div>
    </div>
    ${s.profile.filled ? `<div class="card small" style="text-align:left;width:100%"><b>${esc(s.profile.course)}</b><div style="white-space:pre-wrap">${esc(s.profile.facts)}</div></div>` : ''}
    <button class="btn btn-blue btn-block" data-qr>${icon('qr', 18)} Мой QR</button>
    ${app.backend.staff ? `<button class="btn btn-gold btn-block" data-staff>${icon('shield', 18)} Панель организатора</button>` : ''}
    ${TEST_MODE ? `<button class="btn btn-ghost btn-block" data-test>${icon('settings', 18)} Тест-панель</button>` : ''}
    <button class="btn btn-ghost btn-block" data-logout>Выйти${app.backend.mode === 'demo' ? ' (сменить игрока или ПБ)' : ''}</button>
  </div>`);
  m.root.querySelector('[data-logout]')?.addEventListener('click', () => { m.close(); app.logout(); });
  $(m.root, '[data-qr]').addEventListener('click', () => { m.close(); openMyQr(app); });
  m.root.querySelector('[data-staff]')?.addEventListener('click', () => { m.close(); openStaff(app); });
  m.root.querySelector('[data-test]')?.addEventListener('click', () => { m.close(); openTestPanel(app); });
}

export function openTestPanel(app: App) {
  const s = app.state;
  const demo = app.backend instanceof DemoBackend ? app.backend : null;
  const m = modal(`<h2 style="font-size:22px">Тест-панель</h2>
    <div class="small muted" style="margin:4px 0 10px">Только в тест-сборке. Всё открыто, как будто школа уже идёт.</div>
    <div class="col">
      <button class="btn btn-blue btn-block" data-a="coins">+5 000 профкоинов</button>
      <button class="btn btn-blue btn-block" data-a="rating">+300 баллов (для магазина мерча)</button>
      <button class="btn btn-blue btn-block" data-a="scrolls">+10 свитков найма</button>
      <button class="btn btn-blue btn-block" data-a="energy">Полная энергия и бусты</button>
      <button class="btn btn-blue btn-block" data-a="xp">+500 опыта зданию ПБ</button>
      <button class="btn btn-blue btn-block" data-a="idle">Награда за лекцию: +8 часов</button>
      <button class="btn btn-blue btn-block" data-a="stage">Перейти к боссу главы</button>
      <button class="btn btn-blue btn-block" data-a="round">Провести раунд стычек сейчас</button>
      <button class="btn btn-blue btn-block" data-a="day">Сбросить дневные лимиты</button>
      ${demo ? '<button class="btn btn-blue btn-block" data-a="botqr">QR бота — проверить знакомство</button>' : ''}
      <button class="btn btn-red btn-block" data-a="reset">Начать игру заново</button>
    </div>`);
  m.root.addEventListener('click', async (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'coins') s.coins += 5000;
    if (a === 'rating') s.rating += 300;
    if (a === 'scrolls') s.scrolls += 10;
    if (a === 'energy') { s.clicker.energy = 9999; s.clicker.boosts = { day: '', used: 0 }; }
    if (a === 'xp') { s.clicker.contributed += 500; s.clicker.pendingXp += 500; await app.flush(); }
    if (a === 'idle') s.idleSince -= 8 * 3600_000;
    if (a === 'stage') s.stage = Math.min(MAX_STAGE, Math.ceil(s.stage / 10) * 10);
    if (a === 'round') { await app.backend.staffForceRound(); toast('Раунд проведён — открой карту', 'ok'); }
    if (a === 'day') { s.daily = { day: s.daily.day, game: 0, byGame: {}, best: {} }; }
    if (a === 'botqr' && demo) {
      const b = demo.botSecret(Math.floor(Math.random() * 60));
      const c = currentCode(b.secret, PERSONAL_ROTATE_S);
      modal(`<h2 style="font-size:20px">${esc(b.name)} · ${factionById(b.faction).short}</h2><div class="small muted" style="margin:6px 0">Код живёт ещё ${Math.ceil(c.left)} с. Введи его в «Задания → Сканировать / Ввести код».</div><div class="code-big">${c.code}</div>`);
      return;
    }
    if (a === 'reset') {
      const b = m.root.querySelector<HTMLElement>('[data-a="reset"]')!;
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Точно? Нажми ещё раз — прогресс удалится'; return; }
      try { ['pbgame.v1', 'pbgame.session', 'pbgame.world', 'pbgame.clan', 'pbgame.orders', 'pbgame.merch', 'pbgame.lectures', 'pbgame.subs'].forEach((k) => localStorage.removeItem(k)); } catch { /* приватный режим */ }
      location.reload();
      return;
    }
    if (a === 'energy') s.clicker.energy = Math.min(s.clicker.energy, 9999);
    toast('Готово', 'ok');
    app.update();
  });
}
