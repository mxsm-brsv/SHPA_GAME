import { PLAYABLE_FACTIONS, factionById, readable, type FactionId } from '../../config/factions';
import { totemSvg } from '../../art/totems';
import { $, el, esc, modal, onAct, toast } from '../../lib/dom';
import { haptic } from '../../core/telegram';
import type { App } from '../app';

export function renderPick(app: App) {
  const s = app.state;
  const node = el(`<div class="screen full"><div class="pick">
    <div class="center col" style="gap:4px">
      <h1 style="font-size:26px">Выбери своё профбюро</h1>
      <div class="muted">За него ты играешь весь выезд. Сменить потом может только организатор.</div>
    </div>
    <label class="col" style="gap:4px"><span class="small muted">Как тебя показывать в рейтинге</span>
      <input class="input-ans" id="nick" maxlength="24" value="${esc(s.username)}" autocomplete="nickname"></label>
    <div class="pick-grid">${PLAYABLE_FACTIONS.map((f) => `
      <button class="pick-card" data-act="pick" data-id="${f.id}" style="--c:${f.color}">
        ${totemSvg(f, 64)}
        <div class="pn" style="color:${readable(f.color)}">${f.short}</div>
        <div class="small">${esc(f.totemName)}</div>
      </button>`).join('')}
    </div>
  </div></div>`);

  onAct(node, {
    pick: (t) => {
      haptic();
      const f = factionById(t.dataset.id);
      const m = modal(`<div class="col center" style="gap:10px;align-items:center">
        ${totemSvg(f, 96)}
        <h2 style="font-size:24px">${f.short} · ${esc(f.totemName)}</h2>
        <div class="card" style="text-align:left;width:100%">
          <div class="small muted">Бонус в игре</div><div><b>${esc(f.perk.name)}:</b> ${esc(f.perk.text)}</div>
          <div class="small muted" style="margin-top:8px">Способность в «Профбюро-лихорадке»</div><div><b>${esc(f.ability.name)}:</b> ${esc(f.ability.text)}</div>
        </div>
        <button class="btn btn-gold btn-block" data-ok>Играть за ${f.short}</button>
      </div>`);
      $(m.root, '[data-ok]').addEventListener('click', () => {
        const nick = ($(node, '#nick') as HTMLInputElement).value.trim().slice(0, 24);
        if (nick.length < 2) { toast('Напиши имя хотя бы из двух букв', 'bad'); return; }
        s.username = nick;
        s.faction = f.id as FactionId;
        m.close();
        haptic('ok');
        app.saveNow();
        app.enterGame();
      });
    },
  });
  return node;
}
