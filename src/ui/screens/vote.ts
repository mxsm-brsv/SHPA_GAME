// Голосование для участника: каждой команде — «за» или «против», за свою (своё ПБ) нельзя. Передумать можно, пока открыто.
import { factionById } from '../../config/factions';
import { icon } from '../../art/icons';
import { haptic } from '../../core/telegram';
import { voteRank, voteScore, type VoteState, type VoteTeam } from '../../core/vote';
import { esc, fmt, modal, toast } from '../../lib/dom';
import type { App } from '../app';

export function openVote(app: App) {
  let st: VoteState | null = app.vote;
  const m = modal('<div data-vb class="col" style="gap:10px"><div class="muted">Загрузка…</div></div>', { cls: 'vote-sheet', onClose: () => clearInterval(timer) });
  const box = m.root.querySelector<HTMLElement>('[data-vb]')!;
  const row = (t: VoteTeam, s: VoteState) => {
    const mine = !!t.faction && t.faction === s.myFaction;
    const v = s.my[t.id];
    const live = s.status === 'open' && (!s.current || s.current === t.id);
    const f = t.faction ? factionById(t.faction) : null;
    return `<div class="vote-row ${s.current === t.id ? 'now' : ''}" ${f ? `style="--tc:${f.color}"` : ''}>
      <div class="grow"><b>${esc(t.name)}</b>${s.current === t.id ? ' <span class="tag vote-now">на сцене</span>' : ''}
        <div class="small muted">${mine ? 'твоя команда — голосуют другие' : v === 1 ? 'ты за' : v === -1 ? 'ты против' : live ? 'ещё не голосовал' : ''}${s.status !== 'idle' ? ` · за ${t.za} · против ${t.protiv}` : ''}</div></div>
      ${mine ? '' : `<button class="btn btn-sm vote-btn za ${v === 1 ? 'on' : ''}" data-v="1" data-t="${esc(t.id)}" ${live ? '' : 'disabled'}>${icon('check', 16)} За</button>
        <button class="btn btn-sm vote-btn pr ${v === -1 ? 'on' : ''}" data-v="-1" data-t="${esc(t.id)}" ${live ? '' : 'disabled'}>${icon('x', 16)} Против</button>`}
    </div>`;
  };
  const draw = () => {
    if (!st || !st.teams.length) { box.innerHTML = '<h2>Голосование</h2><div class="muted">Сейчас голосования нет.</div>'; return; }
    const s = st;
    const head = s.status === 'open'
      ? (s.current ? `Сейчас выступает <b class="gold">${esc(s.teams.find((t) => t.id === s.current)?.name ?? '')}</b> — оцени её проект` : 'Оцени каждую команду: «за» или «против». Передумать можно, пока голосование открыто.')
      : s.status === 'closed' ? 'Голосование закрыто — итог на экране в зале.' : 'Голосование ещё не началось.';
    const list = s.current ? [...s.teams].sort((a, b) => (a.id === s.current ? -1 : b.id === s.current ? 1 : 0)) : s.teams;
    const lead = s.reveal ? voteRank(s.teams)[0] : null;
    box.innerHTML = `<h2>${esc(s.title)}</h2><div class="small">${head}</div>
      ${lead ? `<div class="card center" style="border-color:var(--gold)">${icon('trophy', 22, '#ffd76a')} Лучшая команда: <b class="gold">${esc(lead.name)}</b> · ${voteScore(lead) > 0 ? '+' : ''}${fmt(voteScore(lead))}</div>` : ''}
      <div class="col" style="gap:6px">${list.map((t) => row(t, s)).join('')}</div>
      <div class="small muted center">Проголосовали: ${fmt(s.voters)}</div>`;
  };
  box.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-v]');
    if (!b || b.disabled || !st) return;
    const team = b.dataset.t!;
    const v = Number(b.dataset.v) as 1 | -1;
    const next = st.my[team] === v ? 0 : v; // повторный тап снимает голос
    try {
      st = await app.backend.voteCast(team, next);
      app.vote = st;
      haptic(next ? 'ok' : 'tap');
      draw();
    } catch (er) { toast((er as Error).message, 'bad'); haptic('bad'); }
  });
  const load = async () => { const s = await app.backend.voteState(); if (s) { st = s; app.vote = s; draw(); } };
  const timer = window.setInterval(load, 4000);
  draw(); load();
}
