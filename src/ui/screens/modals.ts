import { DAILY_GIFT } from '../../config/economy';
import { FACTIONS, factionById } from '../../config/factions';
import { totemSvg } from '../../art/totems';
import { coinSvg, icon, scrollSvg } from '../../art/icons';
import { CLAN } from '../../config/clan';
import { mskDay, type GameState } from '../../core/state';
import { haptic } from '../../core/telegram';
import { $, esc, fmt, modal, onAct, toast } from '../../lib/dom';
import type { App } from '../app';

export const giftAvailable = (s: GameState) => s.gift.lastDay !== mskDay();

export function openGift(app: App) {
  const s = app.state;
  const today = mskDay();
  const yesterday = mskDay(Date.now() - 86400_000);
  const nextStreak = s.gift.lastDay === yesterday ? s.gift.streak + 1 : 1;
  const idx = (Math.min(nextStreak, DAILY_GIFT.length) - 1);
  const can = s.gift.lastDay !== today;
  const cells = DAILY_GIFT.map((g, i) => {
    const got = can ? i < idx : i <= (Math.min(s.gift.streak, DAILY_GIFT.length) - 1);
    const cur = can && i === idx;
    return `<div class="card center col" style="gap:4px;padding:8px 4px;${cur ? 'border-color:var(--gold)' : ''};${got ? 'opacity:.5' : ''}">
      <div class="small muted">День ${i + 1}</div>
      <div class="row" style="justify-content:center;gap:3px">${coinSvg(14)}<b class="small">${g.coins}</b></div>
      ${g.scrolls ? `<div class="row" style="justify-content:center;gap:3px">${scrollSvg(14)}<b class="small">${g.scrolls}</b></div>` : ''}
    </div>`;
  }).join('');
  const m = modal(`<h2 style="font-size:22px">Ежедневный подарок</h2>
    <div class="small muted" style="margin:4px 0 12px">Заходи каждый день — подарок растёт. Пропуск сбрасывает серию.</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:14px">${cells}</div>
    <button class="btn ${can ? 'btn-gold' : 'btn-blue'} btn-block" data-take ${can ? '' : 'disabled'}>${can ? 'Забрать' : 'Приходи завтра'}</button>`);
  $(m.root, '[data-take]').addEventListener('click', () => {
    if (!can) return;
    const g = DAILY_GIFT[idx];
    s.coins += g.coins; s.scrolls += g.scrolls;
    s.gift = { lastDay: today, streak: nextStreak };
    haptic('ok');
    toast(`+${g.coins} профкоинов${g.scrolls ? ` и ${g.scrolls} свиток` : ''}`, 'ok');
    m.close();
    app.update();
  });
}

/** Рейтинг: отдельно профбюро (очки ПБ) и участники (баллы или вклад в своё ПБ). */
export async function openRating(app: App, start: 'f' | 'p' = 'f') {
  const s = app.state;
  let pSort: 'rating' | 'contributed' = 'rating';
  const m = modal(`<h2 style="font-size:22px;margin-bottom:10px">Рейтинг</h2>
    <div class="tabs" style="margin-bottom:10px"><button data-act="t" data-v="f">Профбюро</button><button data-act="t" data-v="p">Участники</button></div>
    <div data-body class="list"><div class="muted center">Загрузка…</div></div>`);
  await app.flush();
  const data = await app.backend.leaderboard(s).catch(() => null);
  const body = $(m.root, '[data-body]');
  const draw = (v: string) => {
    m.root.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.v === v));
    if (!data) { body.innerHTML = '<div class="muted center">Нет связи</div>'; return; }
    if (v === 'p') {
      const rows = [...data.players].sort((a, b) => b[pSort] - a[pSort]);
      body.innerHTML = `<div class="chips" style="margin-bottom:4px"><button class="chip ${pSort === 'rating' ? 'on' : ''}" data-act="ps" data-v="rating">По баллам</button><button class="chip ${pSort === 'contributed' ? 'on' : ''}" data-act="ps" data-v="contributed">Кто больше вложился в ПБ</button></div>`
        + rows.slice(0, 100).map((p, i) => {
          const f = factionById(p.faction);
          return `<div class="li ${p.me ? 'me' : ''}"><div class="rank ${i < 3 ? 'top' : ''}">${i + 1}</div>${totemSvg(f, 32)}
            <div class="grow"><div style="font-weight:700">${esc(p.name)}</div><div class="small muted">${f.short} · ${pSort === 'rating' ? `вклад ${fmt(p.contributed)}` : `${fmt(p.rating)} баллов`}</div></div>
            <b class="gold">${fmt(p[pSort])}</b></div>`;
        }).join('') + `<div class="small muted center">${pSort === 'rating' ? 'Баллы — за задания и образовалку (блоки, квизы). Игры дают профкоины.' : 'Вклад — опыт, который участник принёс зданиям своего ПБ: тапы, вложенные профкоины, победы.'}${app.backend.mode === 'demo' ? ' Демо: соперники — боты.' : ''}</div>`;
    } else {
      const max = Math.max(1, ...data.factions.map((r) => r.score));
      body.innerHTML = data.factions.map((r, i) => {
        const f = factionById(r.faction);
        return `<div class="li ${r.faction === s.faction ? 'me' : ''}" style="flex-wrap:wrap"><div class="rank ${i < 3 ? 'top' : ''}">${i + 1}</div>${totemSvg(f, 36)}
          <div class="grow"><div style="font-weight:700">${f.short} · ${esc(f.totemName)}</div><div class="small muted">${r.players}/${r.limit} игроков · ратуша ур. ${r.ratusha}</div></div>
          <b class="gold" style="font-size:18px">${fmt(r.score)}</b>
          <div style="flex-basis:100%;height:6px;border-radius:3px;background:#ffffff14;overflow:hidden"><i style="display:block;height:100%;width:${(r.score / max) * 100}%;background:${f.color}"></i></div>
          <div class="small muted" style="flex-basis:100%">баллы ${fmt(r.rating)} + влияние ${fmt(r.influence)} (×${CLAN.scoreInfluenceWeight}) + опыт зданий ${fmt(r.xp)} (÷${CLAN.scoreXpDiv})</div></div>`;
      }).join('') + `<div class="small muted center">Очки ПБ = сумма баллов участников + влияние на карте ×${CLAN.scoreInfluenceWeight} + опыт зданий ÷${CLAN.scoreXpDiv}. Профком — вне зачёта.</div>`;
    }
  };
  let cur: string = start;
  draw(cur);
  onAct(m.root, {
    t: (t) => { cur = t.dataset.v!; draw(cur); },
    ps: (t) => { pSort = t.dataset.v as typeof pSort; draw('p'); },
  });
}

/** Эфир: объявления организаторов и сообщения, которые Claude публикует через репозиторий. */
export async function openLive(app: App) {
  await app.refreshLive();
  const list = app.live;
  modal(`<h2 style="font-size:22px;margin-bottom:8px">Эфир</h2>
    <div class="list">${list.map((a) => `<div class="li" style="align-items:flex-start;border-color:${a.kind === 'alert' ? 'var(--red)' : a.kind === 'win' ? 'var(--gold)' : 'var(--line)'}">
      ${icon(a.kind === 'alert' ? 'bolt' : a.kind === 'win' ? 'trophy' : 'info', 20, a.kind === 'alert' ? '#ff8a8a' : a.kind === 'win' ? '#ffd76a' : '#9fe0ff')}
      <div class="grow"><div style="white-space:pre-wrap">${esc(a.text)}</div><div class="small muted">${new Date(a.at + 3 * 3600_000).toISOString().slice(11, 16)}${a.author ? ` · ${esc(a.author)}` : ''}</div></div></div>`).join('') || '<div class="muted center">Пока тихо</div>'}</div>`);
}

export function openFaction(app: App) {
  const f = factionById(app.state.faction);
  modal(`<div class="col" style="align-items:center;gap:10px">
    ${totemSvg(f, 96)}
    <h2 style="font-size:24px">${f.short} · ${esc(f.totemName)}</h2>
    <div class="card" style="width:100%">
      <div class="small muted">Постоянный бонус</div><div><b>${esc(f.perk.name)}:</b> ${esc(f.perk.text)}</div>
      <div class="small muted" style="margin-top:8px">В «Профбюро-лихорадке», раз за уровень</div><div><b>${esc(f.ability.name)}:</b> ${esc(f.ability.text)}</div>
    </div>
    <div class="small muted center">Сменить профбюро может только организатор.</div>
    <div class="section-h" style="align-self:flex-start">Все фракции</div>
    <div class="list" style="width:100%">${FACTIONS.filter((x) => x.playable).map((x) => `<div class="li">${totemSvg(x, 34)}<div class="grow"><b>${x.short}</b> <span class="small muted">${esc(x.perk.name)} — ${esc(x.perk.text)}</span></div></div>`).join('')}</div>
  </div>`);
}

export function openTrip(_app: App) {
  const start = Date.UTC(2026, 10, 7, 5, 0);
  const left = start - Date.now();
  const days = Math.max(0, Math.ceil(left / 86400_000));
  modal(`<h2 style="font-size:22px">Выезд ШПА · 7–8 ноября</h2>
    <div class="card row" style="margin:10px 0">${icon('bus', 28, '#ffc83d')}<div class="grow">${left > 0 ? `До заезда <b class="gold">${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}</b>` : '<b>Выезд идёт!</b>'}<div class="small muted">Заезд 7 ноября в 08:00. Отметься на регистрации по личному QR — +30 баллов.</div></div></div>
    <div class="section-h">Внешние мероприятия</div>
    <div class="small muted" style="margin:4px 0 10px">На карте будут появляться выезды на 60 минут: «Стипком», Спартакиада, Приёмная комиссия и другие. Отправляешь 5 активистов, играешь мини-игру — 5 лучших результатов ПБ идут в зачёт.</div>
    <div class="list">${[['Школа «Стипком»', 'Правовой ринг'], ['Спартакиада', 'Бегом на пару'], ['Приёмная комиссия', 'Печать'], ['Выезд в регион', 'Автобус на выезд'], ['Форум студлидеров', 'Расписание'], ['Ярмарка грантов', 'Слияние'], ['Профсоюзная олимпиада', 'Профкроссворд']].map(([a, b]) => `<div class="li"><div class="grow"><b>${a}</b><div class="small muted">мини-игра «${b}»</div></div><span class="tag">идёт по кругу</span></div>`).join('')}</div>`);
}
