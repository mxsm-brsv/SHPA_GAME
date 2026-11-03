// Вход по ФИО: участник пишет ФИО и группу — ПБ подставляется из списка выезда. Состав — с кодом организатора.
// «Подготовка» открыта всем без входа.
import { FACTIONS, PLAYABLE_FACTIONS, factionById, readable, type FactionId } from '../../config/factions';
import { DEMO_STAFF_CODE, TEST_MODE } from '../../config/test';
import { CLAN } from '../../config/clan';
import { totemSvg } from '../../art/totems';
import { icon } from '../../art/icons';
import { $, el, esc, modal } from '../../lib/dom';
import { haptic } from '../../core/telegram';
import type { LoginResult } from '../../core/backend';
import type { App } from '../app';
import { openPrep } from './prep';

export function renderLogin(app: App, error?: string) {
  const bot = import.meta.env.VITE_BOT_USERNAME as string | undefined;
  const demo = app.backend.mode === 'demo';
  const node = el(`<div class="screen full login"><div class="page" style="max-width:420px;margin:0 auto;width:100%">
    <div class="login-hero">
      <div class="login-totems">${PLAYABLE_FACTIONS.slice(0, 5).map((f) => totemSvg(f, 34)).join('')}${totemSvg(factionById('profkom'), 40)}${PLAYABLE_FACTIONS.slice(5).map((f) => totemSvg(f, 34)).join('')}</div>
      <h1 style="font-size:28px;text-align:center">Игра ШПА МЭИ</h1>
      <div class="muted center small">Школа профсоюзного актива · 7–8 ноября</div>
    </div>

    <button class="card prep-cta" data-act="prep">
      ${icon('book', 34, '#ffd76a')}
      <div class="grow" style="text-align:left"><b>Подготовка — открыта всем</b>
        <div class="small muted">Вопросы по документам с пояснениями и нормами, карточки, тест. Без входа и без баллов — просто чтобы разобраться.</div></div>
      ${icon('play', 20)}
    </button>

    <div class="card col" data-form>
      <b style="font-size:17px">Войти в игру</b>
      <div class="small muted">Пиши как в списке выезда — ПБ подставится само. В каждом ПБ до ${CLAN.pbLimit} игроков, играют только участники выезда.</div>
      <label class="col" style="gap:4px"><span class="small">Фамилия Имя Отчество</span>
        <input class="input-ans" data-fio placeholder="Иванова Анна Сергеевна" autocomplete="name" autocapitalize="words" maxlength="80"></label>
      <label class="col" style="gap:4px" data-grp><span class="small">Учебная группа</span>
        <input class="input-ans" data-group placeholder="Например, ЭР-23-24" autocomplete="off" autocapitalize="characters" maxlength="16"></label>
      <label class="col hidden" style="gap:4px" data-stf><span class="small">Код организатора</span>
        <input class="input-ans" data-scode placeholder="Выдают админы" autocomplete="off" autocapitalize="characters" maxlength="24"></label>
      <label class="row small" style="gap:8px"><input type="checkbox" data-staff> Я из состава (организатор)</label>
      <div class="small err ${error ? '' : 'hidden'}" data-err>${esc(error ?? '')}</div>
      <button class="btn btn-gold btn-block" data-act="go">Войти</button>
      ${bot && !demo ? `<a class="small center" style="color:var(--muted)" href="https://t.me/${esc(bot)}">Открыть в Telegram</a>` : ''}
      <div class="small muted">ФИО и группа нужны только чтобы найти тебя в списке выезда. В рейтинге видно имя и фамилию.</div>
    </div>

    ${TEST_MODE && demo ? `<div class="card col test-login">
      <b>${icon('settings', 16)} Тестовый вход</b>
      <div class="small muted">Только в тест-сборке: войти за любое ПБ без списка. Код организатора в демо — <b>${DEMO_STAFF_CODE}</b>.</div>
      <input class="input-ans" data-tname placeholder="Имя тестера" maxlength="24" value="Тестер">
      <div class="pick-grid">${FACTIONS.map((f) => `<button class="pick-card" data-act="tester" data-id="${f.id}" style="--c:${f.color}">${totemSvg(f, 40)}<div class="pn" style="color:${readable(f.color)}">${f.short}</div></button>`).join('')}</div>
    </div>` : ''}
  </div></div>`);

  const staffBox = $(node, '[data-staff]') as HTMLInputElement;
  staffBox.addEventListener('change', () => {
    $(node, '[data-grp]').classList.toggle('hidden', staffBox.checked);
    $(node, '[data-stf]').classList.toggle('hidden', !staffBox.checked);
  });
  const err = (m: string) => { const e = $(node, '[data-err]'); e.textContent = m; e.classList.toggle('hidden', !m); };
  const done = (res: LoginResult) => {
    if (!res.state) { err(res.error || 'Не получилось войти'); haptic('bad'); return; }
    haptic('ok');
    node.remove();
    app.afterLogin(res.state, true);
  };
  const go = async () => {
    const fio = ($(node, '[data-fio]') as HTMLInputElement).value.trim();
    const group = ($(node, '[data-group]') as HTMLInputElement).value.trim();
    const staffCode = staffBox.checked ? ($(node, '[data-scode]') as HTMLInputElement).value.trim() : '';
    if (fio.split(/\s+/).length < 2) { err('Напиши фамилию и имя (лучше полностью, с отчеством)'); return; }
    if (staffBox.checked && !staffCode) { err('Введи код организатора'); return; }
    if (!staffBox.checked && app.cfg.requireGroup && !group) { err('Укажи учебную группу — так мы отличаем тебя от тёзок и посторонних'); return; }
    const b = $(node, '[data-act="go"]') as HTMLButtonElement;
    b.disabled = true; b.textContent = 'Ищу в списке…';
    const res = await app.backend.loginFio({ fio, group, staffCode }).catch((e: Error) => ({ state: null, error: e.message }));
    b.disabled = false; b.textContent = 'Войти';
    done(res);
  };
  node.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go(); }));
  node.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'go') go();
    if (t.dataset.act === 'prep') openPrep(app);
    if (t.dataset.act === 'tester') {
      const name = ($(node, '[data-tname]') as HTMLInputElement).value.trim() || 'Тестер';
      done(await app.backend.loginTester(t.dataset.id as FactionId, name));
    }
  });
  return node;
}

/** Приветствие после входа: какое ПБ, что даёт фракция, как устроена игра. */
export function showWelcome(app: App) {
  const s = app.state;
  const f = factionById(s.faction);
  const staff = s.role === 'staff' || s.role === 'admin';
  modal(`<div class="col" style="align-items:center;gap:10px;text-align:center">
    ${totemSvg(f, 96)}
    <h2 style="font-size:22px">Привет, ${esc(s.username)}!</h2>
    <div>${staff ? 'Ты в составе — играешь за <b>Профком</b>, вне зачёта.' : `Ты играешь за <b style="color:${readable(f.color)}">${f.short} · ${esc(f.totemName)}</b> вместе со своим профбюро — до ${CLAN.pbLimit} человек.`}</div>
    ${staff ? '<div class="small muted">Панель организатора — справа на базе. Там отметки на блоках, мерч, эфир, модерация и экран для актового.</div>' : `<div class="card" style="text-align:left;width:100%">
      <div class="small muted">Постоянный бонус ПБ</div><div><b>${esc(f.perk.name)}:</b> ${esc(f.perk.text)}</div>
      <div class="small muted" style="margin-top:8px">Как играть</div>
      <div class="small">Тапай по ратуше — получаешь профкоины, а ПБ растёт. Все игроки ПБ качают одни и те же здания. Баллы — за задания, блоки (QR на экране), игры и правовуху. Их тратят в магазине мерча, а рейтинг от покупок не падает.</div>
    </div>`}
    <button class="btn btn-gold btn-block" data-close>Поехали</button>
  </div>`);
}
